//! One task per bot: schedules its REST reads, listens to its WebSocket, runs the offline
//! detector and reports what it saw to the core (03 sections 4.2 and 4.3).
//!
//! Rules enforced here:
//!
//! * **One request in flight per bot.** The actor awaits its single in-flight request inside the
//!   same `select!` that serves the WebSocket, so a slow answer never delays events and a late
//!   task simply waits for its turn (no queue builds up).
//! * **Global budget.** Every request first passes [`crate::budget::RequestBudget`].
//! * **Jitter** of +-20 % on every period and a startup spread: no burst at launch.
//! * **Offline detector** (port of `createOfflineDetector`): only transport errors count (refused,
//!   timeout, reset, 5xx); three in a row mean `offline`; a 502 "not in the correct state" means
//!   `starting`; a closed WebSocket together with a failing `/ping` means `offline` at once. An
//!   offline bot is only pinged, with a backoff of 30 s, 60 s, then 120 s; coming back triggers a
//!   complete resynchronisation.
//! * **Auth failures** (`AuthFailed`, `Unauthorized`) are not outages: the bot is `auth_expired`
//!   and retried slowly.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use fg_core::identity::BotKey;
use fg_core::model::BotStatus;
use fg_sources::botrest::{ReadEndpoint, RestError};
use fg_sources::botws::{WsEvent, WsHandle, WsTopic};
use fg_sources::traits::{BotRest, BotWs};
use serde_json::Value;
use tokio::sync::mpsc;
use tokio::time::Instant;

use crate::connector::BotLink;
use crate::msg::{Msg, Obs};
use crate::shared::Shared;
use crate::views::ViewKey;
use crate::wire::{self, WsMsg};

/// Consecutive transport failures before a bot is declared offline.
const OFFLINE_AFTER: u32 = 3;
/// Retry period of a bot whose credentials are refused.
const AUTH_RETRY: Duration = Duration::from_secs(120);
/// Delay before retrying a task after a "bot is starting" answer.
const STARTING_RETRY: Duration = Duration::from_secs(10);
/// A proof-of-life message to the core at most this often.
const ALIVE_EVERY: Duration = Duration::from_secs(1);
/// Lines requested from `/logs`.
const LOG_LIMIT: u32 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Kind {
    Features,
    Status,
    Logs,
    Balance,
    Whitelist,
    Blacklist,
    Locks,
}

impl Kind {
    const ALL: [Self; 7] = [
        Self::Features,
        Self::Balance,
        Self::Status,
        Self::Logs,
        Self::Whitelist,
        Self::Blacklist,
        Self::Locks,
    ];

    /// Tokens the request costs: `/show_config` plus the probes of the fork endpoints.
    fn cost(self) -> u32 {
        match self {
            Self::Features => 3,
            _ => 1,
        }
    }

    fn endpoint(self) -> Option<ReadEndpoint> {
        Some(match self {
            Self::Features => return None,
            Self::Status => ReadEndpoint::Status,
            Self::Logs => ReadEndpoint::Logs { limit: LOG_LIMIT },
            Self::Balance => ReadEndpoint::Balance,
            Self::Whitelist => ReadEndpoint::Whitelist,
            Self::Blacklist => ReadEndpoint::Blacklist,
            Self::Locks => ReadEndpoint::Locks,
        })
    }

    /// Period of the task, normal or while the bot is being looked at.
    fn period(self, cad: &crate::config::Cadences, viewed: bool) -> Duration {
        let pick = |c: crate::config::Cadence| if viewed { c.viewed } else { c.normal };
        match self {
            Self::Features => cad.config,
            Self::Status => pick(cad.status),
            Self::Logs => pick(cad.logs),
            Self::Balance => pick(cad.balance),
            Self::Whitelist | Self::Blacklist | Self::Locks => pick(cad.pairs),
        }
    }

    /// Window of the first run after (re)start, so that the most useful reads come first and
    /// the whole fleet does not hit the budget at the same instant.
    fn startup_window(self) -> (Duration, Duration) {
        let s = Duration::from_secs;
        match self {
            Self::Features => (s(0), s(5)),
            Self::Balance => (s(5), s(15)),
            Self::Status => (s(15), s(25)),
            Self::Logs => (s(25), s(40)),
            Self::Whitelist => (s(40), s(60)),
            Self::Blacklist => (s(60), s(90)),
            Self::Locks => (s(90), s(120)),
        }
    }
}

/// Small xorshift generator: scheduling jitter does not need a strong source.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }

    /// Uniform in `[0, 1)`.
    fn unit(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }

    /// `base` randomised by +-`fraction`.
    fn jitter(&mut self, base: Duration, fraction: f64) -> Duration {
        base.mul_f64(1.0 + fraction * (2.0 * self.unit() - 1.0))
    }

    fn between(&mut self, lo: Duration, hi: Duration) -> Duration {
        lo + (hi.saturating_sub(lo)).mul_f64(self.unit())
    }
}

enum Done {
    Read(Result<Value, RestError>),
    Features(Result<fg_sources::botrest::BotFeatures, RestError>),
    Ping(Result<(), RestError>),
}

type Flight = Pin<Box<dyn Future<Output = Done> + Send>>;

/// What the in-flight request is, to account for it when it ends.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Pending {
    Task(Kind),
    Ping,
}

/// Run the actor of one bot until its task is aborted.
pub(crate) async fn run(
    key: BotKey,
    link: BotLink,
    ws_client: Arc<dyn BotWs>,
    shared: Arc<Shared>,
    mut nudge: mpsc::Receiver<()>,
) {
    let mut actor = Actor::new(key.clone(), link.rest.clone(), shared.clone());
    let mut ws: Option<WsHandle> = link
        .ws
        .clone()
        .map(|t| ws_client.connect(t, WsTopic::steady_state()));
    let mut view_rx = shared.views.watch(&ViewKey::Bot(key));
    let mut flight: Option<(Pending, Flight)> = None;
    actor.schedule_startup(Instant::now());

    loop {
        let next = actor.next_due();
        tokio::select! {
            biased;

            done = async { flight.as_mut().unwrap().1.as_mut().await }, if flight.is_some() => {
                let Some((pending, _)) = flight.take() else { continue };
                actor.finish(pending, done).await;
            }

            ev = async { ws.as_mut().unwrap().events.recv().await }, if ws.is_some() => {
                match ev {
                    Some(ev) => actor.on_ws(ev).await,
                    None => ws = None,
                }
            }

            changed = view_rx.changed() => {
                if changed.is_err() { return; }
                actor.viewed = *view_rx.borrow_and_update();
                actor.pull_in();
            }

            n = nudge.recv() => {
                if n.is_none() { return; }
                actor.nudge();
            }

            () = tokio::time::sleep_until(next), if flight.is_none() => {
                flight = actor.start_next();
            }
        }
    }
}

struct Actor {
    key: BotKey,
    rest: Arc<dyn BotRest>,
    shared: Arc<Shared>,
    rng: Rng,
    due: HashMap<Kind, Instant>,
    ping_due: Instant,
    status: BotStatus,
    fails: u32,
    offline_attempts: usize,
    viewed: bool,
    ws_connected: bool,
    snapshot_at: Option<Instant>,
    ws_whitelist_at: Option<Instant>,
    last_alive_sent: Option<Instant>,
}

impl Actor {
    fn new(key: BotKey, rest: Arc<dyn BotRest>, shared: Arc<Shared>) -> Self {
        let seed = match &key {
            BotKey::Local(p) => u64::from(*p),
            BotKey::Url(u) => u
                .bytes()
                .fold(7u64, |a, b| a.wrapping_mul(31) + u64::from(b)),
        };
        Self {
            key,
            rest,
            shared,
            rng: Rng::new(seed),
            due: HashMap::new(),
            ping_due: Instant::now(),
            status: BotStatus::Starting,
            fails: 0,
            offline_attempts: 0,
            viewed: false,
            ws_connected: false,
            snapshot_at: None,
            ws_whitelist_at: None,
            last_alive_sent: None,
        }
    }

    fn cad(&self) -> &crate::config::Cadences {
        &self.shared.cfg.cadences
    }

    fn schedule_startup(&mut self, now: Instant) {
        let scale = self.cad().time_scale.max(1e-3);
        for k in Kind::ALL {
            let (lo, hi) = k.startup_window();
            let (lo, hi) = (lo.div_f64(scale), hi.div_f64(scale));
            // A period shorter than the window (compressed time) caps the first run too.
            let hi = hi.min(k.period(self.cad(), false)).max(lo);
            let lo = lo.min(hi);
            let at = now + self.rng.between(lo, hi);
            self.due.insert(k, at);
        }
    }

    fn next_due(&self) -> Instant {
        match self.status {
            BotStatus::Offline => self.ping_due,
            _ => self
                .due
                .values()
                .copied()
                .min()
                .unwrap_or_else(|| Instant::now() + Duration::from_secs(60)),
        }
        .min(Instant::now() + Duration::from_secs(3600))
    }

    /// Bring every task due earlier when the bot starts being viewed.
    fn pull_in(&mut self) {
        let now = Instant::now();
        let jitter = self.cad().jitter;
        for k in Kind::ALL {
            if k == Kind::Features {
                continue;
            }
            let period = k.period(self.cad(), self.viewed);
            let at = now + self.rng.jitter(period, jitter);
            if let Some(d) = self.due.get_mut(&k)
                && at < *d
            {
                *d = at;
            }
        }
    }

    /// A fill or an action happened: look again now.
    fn nudge(&mut self) {
        let now = Instant::now();
        for k in [Kind::Status, Kind::Logs] {
            self.due.insert(k, now);
        }
    }

    fn start_next(&mut self) -> Option<(Pending, Flight)> {
        let now = Instant::now();
        if self.status == BotStatus::Offline {
            if now < self.ping_due {
                return None;
            }
            return Some((Pending::Ping, self.flight_ping()));
        }
        let (&kind, &at) = self.due.iter().min_by_key(|(_, t)| **t)?;
        if now < at {
            return None;
        }
        // Reschedule first: whatever happens, the task has had its turn.
        let period = kind.period(self.cad(), self.viewed);
        let jitter = self.cad().jitter;
        let after = self.rng.jitter(period, jitter);
        self.due.insert(kind, now + after);

        // Prices pushed over the WebSocket make /status useless; the same goes for a whitelist.
        let fresh = |t: Option<Instant>, within: Duration| t.is_some_and(|t| now - t < within);
        if (kind == Kind::Status && fresh(self.snapshot_at, Duration::from_secs(90)))
            || (kind == Kind::Whitelist && fresh(self.ws_whitelist_at, period))
        {
            return None;
        }
        if self.status == BotStatus::AuthExpired && kind != Kind::Features {
            // Only the probe of the credentials runs until they work again.
            return None;
        }
        Some((Pending::Task(kind), self.flight_task(kind)))
    }

    fn flight_ping(&self) -> Flight {
        let rest = Arc::clone(&self.rest);
        let budget = Arc::clone(&self.shared.budget);
        Box::pin(async move {
            let _permit = budget.acquire(1).await;
            Done::Ping(rest.ping().await)
        })
    }

    fn flight_task(&self, kind: Kind) -> Flight {
        let rest = Arc::clone(&self.rest);
        let budget = Arc::clone(&self.shared.budget);
        Box::pin(async move {
            let _permit = budget.acquire(kind.cost()).await;
            match kind.endpoint() {
                Some(ep) => Done::Read(rest.read(ep).await),
                None => Done::Features(rest.features().await),
            }
        })
    }

    async fn send(&self, obs: Obs) {
        let at_ms = self.shared.now_ms();
        let _ = self
            .shared
            .core_tx
            .send(Msg::Bot {
                key: self.key.clone(),
                at_ms,
                obs,
            })
            .await;
    }

    async fn set_status(&mut self, status: BotStatus) {
        if self.status != status {
            self.status = status;
            self.send(Obs::Status(status)).await;
        }
    }

    /// Everything is read again, promptly but spread over the startup windows.
    fn resync(&mut self) {
        self.schedule_startup(Instant::now());
        self.fails = 0;
        self.offline_attempts = 0;
    }

    async fn finish(&mut self, pending: Pending, done: Done) {
        match (pending, done) {
            (Pending::Ping, Done::Ping(Ok(()))) => {
                // Back: say so, then read everything again before claiming `online`.
                self.set_status(BotStatus::Starting).await;
                self.resync();
                self.send(Obs::Alive).await;
            }
            (Pending::Ping, Done::Ping(Err(_))) => {
                let steps = self.cad().offline_ping;
                let step = steps[self.offline_attempts.min(steps.len() - 1)];
                self.offline_attempts = self.offline_attempts.saturating_add(1);
                let jitter = self.cad().jitter;
                self.ping_due = Instant::now() + self.rng.jitter(step, jitter);
                self.set_status(BotStatus::Offline).await;
            }
            (Pending::Task(kind), Done::Read(res)) => self.on_read(kind, res).await,
            (Pending::Task(_), Done::Features(res)) => self.on_features(res).await,
            _ => {}
        }
    }

    /// Bookkeeping common to every REST outcome. Returns `true` when the answer is usable.
    async fn account<T>(&mut self, res: &Result<T, RestError>) -> bool {
        match res {
            Ok(_) => {
                self.fails = 0;
                if self.status != BotStatus::Online {
                    // The first good answer after a pause proves the bot is back.
                    let was_auth = self.status == BotStatus::AuthExpired;
                    self.set_status(BotStatus::Online).await;
                    if was_auth {
                        self.resync();
                    }
                }
                true
            }
            Err(RestError::Starting) => {
                self.set_status(BotStatus::Starting).await;
                self.delay_all(STARTING_RETRY);
                false
            }
            Err(RestError::AuthFailed | RestError::Unauthorized) => {
                self.set_status(BotStatus::AuthExpired).await;
                self.delay_all(AUTH_RETRY);
                false
            }
            Err(e) if e.counts_as_offline() => {
                self.fails += 1;
                if self.fails >= OFFLINE_AFTER {
                    self.go_offline().await;
                }
                false
            }
            // 404, undecodable body, other status: the endpoint is absent or odd, the bot lives.
            Err(_) => {
                self.fails = 0;
                false
            }
        }
    }

    fn delay_all(&mut self, by: Duration) {
        let at = Instant::now() + by;
        for d in self.due.values_mut() {
            if *d < at {
                *d = at;
            }
        }
    }

    async fn go_offline(&mut self) {
        let first = self.cad().offline_ping[0];
        let jitter = self.cad().jitter;
        self.ping_due = Instant::now() + self.rng.jitter(first, jitter);
        self.offline_attempts = 0;
        self.set_status(BotStatus::Offline).await;
    }

    async fn on_features(&mut self, res: Result<fg_sources::botrest::BotFeatures, RestError>) {
        if self.account(&res).await
            && let Ok(f) = res
        {
            self.send(Obs::Features(f)).await;
        }
    }

    async fn on_read(&mut self, kind: Kind, res: Result<Value, RestError>) {
        if !self.account(&res).await {
            return;
        }
        let Ok(v) = res else { return };
        let obs = match kind {
            Kind::Status => Obs::Positions(wire::parse_status(&v)),
            Kind::Logs => Obs::Logs(wire::parse_logs(&v)),
            Kind::Balance => Obs::Balance(wire::parse_balance(&v)),
            Kind::Whitelist => Obs::Whitelist(wire::parse_list(&v, "whitelist")),
            Kind::Blacklist => Obs::Blacklist(wire::parse_list(&v, "blacklist")),
            Kind::Locks => Obs::Locks(wire::parse_locks(&v)),
            Kind::Features => return,
        };
        self.send(obs).await;
    }

    async fn on_ws(&mut self, ev: WsEvent) {
        match ev {
            WsEvent::Connected => {
                self.ws_connected = true;
                self.send(Obs::WsConnected(true)).await;
            }
            WsEvent::Disconnected(_) => {
                self.ws_connected = false;
                self.send(Obs::WsConnected(false)).await;
                // A closed socket together with a failing /ping means offline at once.
                if self.status == BotStatus::Online {
                    self.ping_now_and_judge().await;
                }
            }
            WsEvent::Message(m) => {
                let now = self.shared.now_ms();
                match wire::parse_ws(&self.key, &m, now) {
                    WsMsg::TradeSnapshot(entries) => {
                        self.snapshot_at = Some(Instant::now());
                        self.send(Obs::WsSnapshot(entries)).await;
                    }
                    WsMsg::Whitelist(list) => {
                        self.ws_whitelist_at = Some(Instant::now());
                        self.send(Obs::Whitelist(list)).await;
                    }
                    WsMsg::Event(e) => {
                        use fg_core::model::EventKind::{EntryFill, ExitFill};
                        let fill = matches!(e.kind, EntryFill | ExitFill);
                        self.send(Obs::WsEvent(e)).await;
                        if fill {
                            // The ledger changed: read it now instead of at the next stat.
                            self.shared.ledger_nudge.notify_one();
                            self.nudge();
                        }
                    }
                    WsMsg::Other => {
                        let due = self
                            .last_alive_sent
                            .is_none_or(|t| t.elapsed() >= ALIVE_EVERY);
                        if due {
                            self.last_alive_sent = Some(Instant::now());
                            self.send(Obs::Alive).await;
                        }
                    }
                }
            }
        }
    }

    /// The socket closed: probe `/ping` right away (outside the normal schedule) and decide.
    async fn ping_now_and_judge(&mut self) {
        let _permit = self.shared.budget.acquire(1).await;
        if self.rest.ping().await.is_err() {
            self.go_offline().await;
        }
    }
}
