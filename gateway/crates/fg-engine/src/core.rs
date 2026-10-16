//! The core task: the only writer of the live state.
//!
//! It receives what the source tasks observed ([`Msg`]), keeps a [`BotRuntime`] per bot, and on
//! its own timers assembles the published entities, evaluates the alert rules, builds the health
//! and the totals, and publishes the differences as keyed upserts per channel with monotonic
//! sequence numbers. Readers never wait for it: they read the [`Published`] swapped atomically.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::Duration;

use fg_core::alerts::book::BookError;
use fg_core::alerts::{
    Alert, AlertBook, AlertRulesConfig, AlertTransition, AlertTypeId, BotAlertContext, LogLine,
    PositionCtx, TransitionKind, evaluate_bot,
};
use fg_core::identity::BotKey;
use fg_core::model::{
    BotConfigSummary, BotDetail, BotMode, BotStatus, Event, EventKind, Freshness, FreshnessSource,
    Health, HealthLevel, HealthReason, ReconSummary, Severity,
};
use fg_core::protocol::{Channel, LogScope};
use fg_core::time::normalize_ts_ms;
use fg_sources::ftcache::{DaemonEvent, DaemonStats, FleetStatus};
use tokio::sync::{mpsc, oneshot};

use crate::aggregate::{self, ScopeBots};
use crate::ledger_data::LedgerEvent;
use crate::meta::BotMeta;
use crate::msg::{Msg, Obs};
use crate::published::{BotData, Differ, Published};
use crate::runtime::{AssembleCtx, Assembled, BotRuntime, DigestObs, assemble};
use crate::shared::{LedgerTarget, Shared};
use crate::wire::LogEntry;

const MINUTE_MS: i64 = 60_000;
/// Same incident of the daemon is shown at most this often per bot.
const INCIDENT_THROTTLE_MS: i64 = 60_000;
/// Window of the 429 count attributed to a bot.
const RATE_LIMIT_WINDOW_MS: i64 = 15 * MINUTE_MS;
/// Drawdown of a mode is recomputed at most this often.
const SCOPE_DD_REFRESH_MS: i64 = 30_000;
/// The alert book is saved at least this often even without a transition.
const BOOK_SAVE_EVERY_MS: i64 = 60_000;

/// Requests from the handle that need the core's state.
pub(crate) enum Cmd {
    Ack {
        id: String,
        session: Option<String>,
        reply: oneshot::Sender<Result<(), BookError>>,
    },
    Silence {
        type_id: Option<AlertTypeId>,
        bot_key: Option<String>,
        subject: Option<String>,
        until_ms: i64,
        reply: oneshot::Sender<Result<String, BookError>>,
    },
    Unsilence {
        id: String,
        reply: oneshot::Sender<Result<(), BookError>>,
    },
    SetRules {
        rules: Box<AlertRulesConfig>,
        reply: oneshot::Sender<()>,
    },
    GetRules {
        reply: oneshot::Sender<Box<AlertRulesConfig>>,
    },
    SetRecon {
        wallet_id: String,
        summary: ReconSummary,
    },
    /// Evaluate the alert rules now and publish (tests, and the first evaluation at startup).
    EvaluateNow { reply: oneshot::Sender<()> },
    /// Assemble and publish everything now.
    PublishNow { reply: oneshot::Sender<()> },
}

#[derive(Default)]
struct DaemonState {
    digest_ok_ms: Option<i64>,
    digest_failures: u32,
    status: Option<(FleetStatus, i64)>,
    stats: Option<(DaemonStats, i64)>,
    /// daemon bot id -> API port, from `fleet_status`.
    bot_ports: HashMap<String, u16>,
    last_incident: HashMap<(String, String), i64>,
}

struct ScopeDd {
    stamp: u64,
    computed_ms: i64,
    result: Option<fg_core::calc::drawdown::DrawdownResult>,
}

pub(crate) struct Core {
    sh: Arc<Shared>,
    bots: BTreeMap<BotKey, BotRuntime>,
    assembled: BTreeMap<BotKey, Assembled>,
    cur: Published,
    differ: Differ,
    book: AlertBook,
    rules: AlertRulesConfig,
    daemon: DaemonState,
    recon: BTreeMap<String, ReconSummary>,
    pending_events: Vec<Event>,
    scope_dd: HashMap<BotMode, ScopeDd>,
    /// Dedup of log lines already published, per bot: last timestamp and hashes at that stamp.
    log_seen: HashMap<BotKey, (i64, HashSet<u64>)>,
    discovered_once: bool,
    last_book_save_ms: i64,
    data_versions: BTreeMap<BotKey, u64>,
    /// When the slow-moving figures of each bot row / position were last published.
    slow_bot_at: HashMap<BotKey, i64>,
    slow_pos_at: HashMap<String, i64>,
    scopes_at: i64,
    /// Set while `PublishNow` runs: nothing is held back.
    force_publish: bool,
    /// Bots that received something since they were last assembled, and when each was.
    dirty: HashSet<BotKey>,
    dirty_all: bool,
    assembled_at: HashMap<BotKey, i64>,
}

/// A bot nothing was heard from is assembled again at least this often: freshness (`stale`),
/// durations and the hourly sparkline depend on the clock, not only on what arrives.
const REASSEMBLE_MS: i64 = 5_000;

/// Figures that follow every price tick but that no screen needs more than every few seconds
/// (drawdown with latent profit; notional and distance to liquidation) are published at most
/// this often per entity. Snapshots carry the same throttled values as the deltas, so that a
/// client is never ahead of or behind its own snapshot.
const SLOW_FIELD_MS: i64 = 10_000;

/// Drawdown including latent profit and exposures of a bot row: statistics of table cells that
/// follow every price tick, not gauges. (The latent profit itself is not held back.)
const SLOW_BOT_MS: i64 = 30_000;

/// Scope totals are headline figures: a second is as fresh as a person can read them.
const SCOPES_EVERY_MS: i64 = 1_000;

/// Resolution of the freshness timestamps that clients see. The exact instants drive `stale`
/// (decided server-side before this rounding); publishing them to the millisecond would make
/// every group of every bot a delta on each refresh, for a figure no screen reads that finely.
const AS_OF_QUANTUM_MS: i64 = 30_000;

fn coarse(f: &mut fg_core::model::Freshness) {
    f.as_of_ms -= f.as_of_ms.rem_euclid(AS_OF_QUANTUM_MS);
}

fn hash_str(s: &str) -> u64 {
    let h = blake3::hash(s.as_bytes());
    let b = h.as_bytes();
    u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]])
}

impl Core {
    pub(crate) fn new(
        sh: Arc<Shared>,
        book: AlertBook,
        rules: AlertRulesConfig,
        recent_events: Vec<Event>,
    ) -> Self {
        let now = sh.now_ms();
        if let Ok(mut ring) = sh.events.lock() {
            ring.extend(recent_events);
        }
        Self {
            cur: Published::empty(now),
            sh,
            bots: BTreeMap::new(),
            assembled: BTreeMap::new(),
            differ: Differ::new(),
            book,
            rules,
            daemon: DaemonState::default(),
            recon: BTreeMap::new(),
            pending_events: Vec::new(),
            scope_dd: HashMap::new(),
            log_seen: HashMap::new(),
            discovered_once: false,
            last_book_save_ms: now,
            data_versions: BTreeMap::new(),
            slow_bot_at: HashMap::new(),
            slow_pos_at: HashMap::new(),
            scopes_at: 0,
            force_publish: false,
            dirty: HashSet::new(),
            dirty_all: true,
            assembled_at: HashMap::new(),
        }
    }

    // ------------------------------------------------------------------ run loop

    pub(crate) async fn run(mut self, mut rx: mpsc::Receiver<Msg>, mut cmd: mpsc::Receiver<Cmd>) {
        let p = self.sh.cfg.publication;
        let mut fleet = tokio::time::interval(p.fleet);
        let mut positions = tokio::time::interval(p.positions);
        let mut health = tokio::time::interval(p.health);
        let mut alerts = tokio::time::interval(self.sh.cfg.cadences.alert_eval);
        let mut flush = tokio::time::interval(Duration::from_secs(1));
        let mut housekeeping = tokio::time::interval(Duration::from_secs(3600));
        for t in [
            &mut fleet,
            &mut positions,
            &mut health,
            &mut alerts,
            &mut flush,
            &mut housekeeping,
        ] {
            t.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        }
        loop {
            tokio::select! {
                msg = rx.recv() => match msg {
                    Some(m) => self.apply(m),
                    None => return,
                },
                c = cmd.recv() => match c {
                    Some(c) => self.command(c),
                    None => return,
                },
                _ = fleet.tick() => self.tick_fleet(),
                _ = positions.tick() => self.tick_positions(),
                _ = health.tick() => self.tick_health(),
                _ = alerts.tick() => self.tick_alerts(),
                _ = flush.tick() => self.flush_events(),
                _ = housekeeping.tick() => self.housekeeping(),
            }
        }
    }

    fn command(&mut self, c: Cmd) {
        let now = self.sh.now_ms();
        match c {
            Cmd::Ack { id, session, reply } => {
                let r = self.book.ack(&id, session.as_deref(), now);
                if r.is_ok() {
                    self.save_book(now);
                    self.publish_alerts();
                }
                let _ = reply.send(r);
            }
            Cmd::Silence {
                type_id,
                bot_key,
                subject,
                until_ms,
                reply,
            } => {
                let r = self.book.silence(
                    type_id,
                    bot_key.as_deref(),
                    subject.as_deref(),
                    until_ms,
                    now,
                );
                if r.is_ok() {
                    self.save_book(now);
                    self.publish_alerts();
                }
                let _ = reply.send(r);
            }
            Cmd::Unsilence { id, reply } => {
                let r = self.book.unsilence(&id);
                if r.is_ok() {
                    self.save_book(now);
                    self.publish_alerts();
                }
                let _ = reply.send(r);
            }
            Cmd::SetRules { rules, reply } => {
                self.rules = *rules;
                self.sh.db.save_rules(&self.rules, now);
                let _ = reply.send(());
            }
            Cmd::GetRules { reply } => {
                let _ = reply.send(Box::new(self.rules.clone()));
            }
            Cmd::SetRecon { wallet_id, summary } => {
                self.recon.insert(wallet_id, summary);
            }
            Cmd::EvaluateNow { reply } => {
                self.tick_alerts();
                let _ = reply.send(());
            }
            Cmd::PublishNow { reply } => {
                self.force_publish = true;
                self.tick_fleet();
                self.tick_positions();
                self.tick_health();
                self.force_publish = false;
                let _ = reply.send(());
            }
        }
    }

    // ------------------------------------------------------------------ inputs

    fn apply(&mut self, msg: Msg) {
        // Proofs of life only move a clock that `REASSEMBLE_MS` already covers.
        match &msg {
            Msg::Bot {
                obs: Obs::Alive, ..
            }
            | Msg::Ledger {
                ev: LedgerEvent::Alive,
                ..
            } => {}
            Msg::Bot { key, .. } | Msg::Ledger { key, .. } => {
                self.dirty.insert(key.clone());
            }
            _ => self.dirty_all = true,
        }
        match msg {
            Msg::Discovered(metas) => self.on_discovered(metas),
            Msg::Bot { key, at_ms, obs } => self.on_bot(&key, at_ms, obs),
            Msg::Ledger { key, at_ms, ev } => self.on_ledger(&key, at_ms, ev),
            Msg::Digest { at_ms, summary } => {
                self.daemon.digest_ok_ms = Some(at_ms);
                self.daemon.digest_failures = 0;
                for rt in self.bots.values_mut() {
                    let found = summary
                        .bots
                        .values()
                        .find(|d| d.api_port.is_some() && d.api_port == rt.meta.port)
                        .or_else(|| {
                            summary
                                .bots
                                .get(&rt.meta.name)
                                .filter(|d| d.api_port.is_none() || d.api_port == rt.meta.port)
                        });
                    if let Some(d) = found {
                        let age = d
                            .age_s
                            .filter(|a| a.is_finite() && *a >= 0.0)
                            .unwrap_or(0.0);
                        rt.digest = Some(DigestObs {
                            digest: d.clone(),
                            as_of_ms: at_ms - (age * 1000.0) as i64,
                        });
                    }
                }
            }
            Msg::DigestFailed { .. } => {
                self.daemon.digest_failures = self.daemon.digest_failures.saturating_add(1);
            }
            Msg::DaemonStatus { at_ms, status } => {
                self.daemon.bot_ports = status
                    .bots
                    .iter()
                    .filter_map(|b| Some((b.bot_id.clone()?, b.api_port?)))
                    .collect();
                self.daemon.status = Some((*status, at_ms));
            }
            Msg::DaemonStats { at_ms, stats } => self.daemon.stats = Some((*stats, at_ms)),
            Msg::DaemonEvents { events, .. } => {
                for e in events {
                    self.on_daemon_event(&e);
                }
            }
            Msg::Tickers { tickers, .. } => {
                self.cur.tickers = Arc::new(tickers);
                self.store_published();
            }
            Msg::PushEvent(e) => self.push_event(e),
        }
    }

    fn on_discovered(&mut self, metas: Vec<BotMeta>) {
        let now = self.sh.now_ms();
        let present: BTreeSet<BotKey> = metas.iter().map(|m| m.key.clone()).collect();
        for meta in metas {
            match self.bots.get_mut(&meta.key) {
                Some(rt) if rt.meta.incarnation != meta.incarnation => {
                    let ev = Event {
                        kind: EventKind::BotReplaced,
                        ts_ms: now,
                        bot_key: Some(meta.key.clone()),
                        trade_id: None,
                        pair: None,
                        profit_abs: None,
                        severity: Some(Severity::Warning),
                        detail: Some(format!("{} ({})", meta.name, meta.incarnation)),
                    };
                    // A different bot on the same port: the history is not carried over.
                    self.log_seen.remove(&meta.key);
                    self.bots.insert(meta.key.clone(), BotRuntime::new(meta));
                    self.push_event(ev);
                }
                Some(rt) => {
                    if rt.status == BotStatus::Stopped {
                        rt.status = BotStatus::Starting;
                        rt.status_since_ms = Some(now);
                    }
                    rt.meta = meta;
                }
                None => {
                    self.bots.insert(meta.key.clone(), BotRuntime::new(meta));
                }
            }
        }
        // A bot whose process is gone but whose ledger remains is `stopped`, not forgotten.
        let gone: Vec<BotKey> = self
            .bots
            .keys()
            .filter(|k| !present.contains(*k))
            .cloned()
            .collect();
        for k in gone {
            let keep_ledger = self.bots.get(&k).is_some_and(|rt| rt.meta.read_ledger);
            if keep_ledger {
                if let Some(rt) = self.bots.get_mut(&k)
                    && rt.status != BotStatus::Stopped
                {
                    rt.status = BotStatus::Stopped;
                    rt.status_since_ms = Some(now);
                    rt.ws_connected = false;
                    rt.snapshot.clear();
                    rt.snapshot_ms = None;
                    rt.rest_positions = None;
                    self.push_event(Event {
                        kind: EventKind::BotOffline,
                        ts_ms: now,
                        bot_key: Some(k.clone()),
                        trade_id: None,
                        pair: None,
                        profit_abs: None,
                        severity: Some(Severity::Warning),
                        detail: Some("stopped".into()),
                    });
                }
            } else {
                self.bots.remove(&k);
                self.assembled.remove(&k);
                self.log_seen.remove(&k);
            }
        }
        self.discovered_once = true;
        let targets: Vec<LedgerTarget> = self
            .bots
            .values()
            .filter(|rt| rt.meta.read_ledger)
            .filter_map(|rt| {
                Some(LedgerTarget {
                    key: rt.meta.key.clone(),
                    path: rt.meta.db_path.clone()?,
                })
            })
            .collect();
        if let Ok(mut t) = self.sh.ledger_targets.write() {
            *t = targets;
        }
    }

    fn on_bot(&mut self, key: &BotKey, at_ms: i64, obs: Obs) {
        let max_logs = self.sh.cfg.log_lines;
        let Some(rt) = self.bots.get_mut(key) else {
            return;
        };
        match obs {
            Obs::Alive => rt.alive_ms = Some(at_ms),
            Obs::Status(status) => {
                rt.alive_ms = Some(at_ms);
                if rt.status != status {
                    let was = rt.status;
                    rt.status = status;
                    rt.status_since_ms = Some(at_ms);
                    let kind = match (was, status) {
                        (_, BotStatus::Online) if was != BotStatus::Online => {
                            Some((EventKind::BotOnline, Severity::Info))
                        }
                        (_, BotStatus::Offline) => Some((EventKind::BotOffline, Severity::Warning)),
                        (_, BotStatus::AuthExpired) => {
                            Some((EventKind::BotOffline, Severity::Warning))
                        }
                        _ => None,
                    };
                    if let Some((kind, severity)) = kind {
                        let name = rt.meta.name.clone();
                        let detail = if status == BotStatus::AuthExpired {
                            format!("{name}: credentials refused")
                        } else {
                            name
                        };
                        self.push_event(Event {
                            kind,
                            ts_ms: at_ms,
                            bot_key: Some(key.clone()),
                            trade_id: None,
                            pair: None,
                            profit_abs: None,
                            severity: Some(severity),
                            detail: Some(detail),
                        });
                    }
                }
            }
            Obs::Features(f) => {
                rt.alive_ms = Some(at_ms);
                rt.features = Some(f);
            }
            Obs::Positions(p) => {
                rt.alive_ms = Some(at_ms);
                rt.rest_positions = Some((p, at_ms));
            }
            Obs::Balance(b) => {
                rt.alive_ms = Some(at_ms);
                rt.balance = Some((b, at_ms));
            }
            Obs::Whitelist(w) => {
                rt.alive_ms = Some(at_ms);
                rt.whitelist = Some((w, at_ms));
            }
            Obs::Blacklist(w) => {
                rt.alive_ms = Some(at_ms);
                rt.blacklist = Some((w, at_ms));
            }
            Obs::Locks(l) => {
                rt.alive_ms = Some(at_ms);
                rt.locks = Some((l, at_ms));
            }
            Obs::Logs(entries) => {
                rt.alive_ms = Some(at_ms);
                rt.logs_ms = Some(at_ms);
                let new_lines = Self::fresh_log_lines(&mut self.log_seen, key, &entries);
                let skip = entries.len().saturating_sub(max_logs);
                rt.logs = entries.into_iter().skip(skip).collect::<VecDeque<_>>();
                self.publish_log_lines(key, new_lines);
            }
            Obs::WsConnected(up) => {
                rt.ws_connected = up;
                if up {
                    rt.alive_ms = Some(at_ms);
                    rt.ws_last_ms = Some(at_ms);
                }
            }
            Obs::WsSnapshot(entries) => {
                rt.alive_ms = Some(at_ms);
                rt.ws_last_ms = Some(at_ms);
                rt.snapshot = entries.into_iter().map(|e| (e.trade_id, e)).collect();
                rt.snapshot_ms = Some(at_ms);
            }
            Obs::WsEvent(e) => {
                rt.alive_ms = Some(at_ms);
                rt.ws_last_ms = Some(at_ms);
                let mut e = e;
                e.ts_ms = at_ms;
                self.push_event(e);
            }
        }
    }

    fn on_ledger(&mut self, key: &BotKey, at_ms: i64, ev: LedgerEvent) {
        let max = self.sh.cfg.max_closed_per_bot;
        if let Some(rt) = self.bots.get_mut(key) {
            let meta = rt.meta.clone();
            rt.ledger.apply(&meta, at_ms, ev, max);
        }
    }

    fn on_daemon_event(&mut self, e: &DaemonEvent) {
        let ts_ms = normalize_ts_ms(e.ts).unwrap_or_else(|| self.sh.now_ms());
        let bot = e.bot_id.as_ref().and_then(|id| self.bot_of_daemon_id(id));
        let throttle_key = (
            bot.as_ref().map(ToString::to_string).unwrap_or_default(),
            e.event_type.clone(),
        );
        if e.event_type == "rate_limit_429"
            && let Some(rt) = bot.as_ref().and_then(|b| self.bots.get_mut(b))
        {
            rt.rate_limit_ms.push_back(ts_ms);
        }
        let (kind_ok, severity) = match e.event_type.as_str() {
            "rate_limit_429" | "backoff_start" => (true, Severity::Warning),
            "bot_crash" | "iso_breach" => (true, Severity::Critical),
            "daemon_start" | "daemon_stop" | "admission_held" => (true, Severity::Info),
            // Connections and order reports are noise at fleet level.
            _ => (false, Severity::Info),
        };
        if !kind_ok {
            return;
        }
        if let Some(last) = self.daemon.last_incident.get(&throttle_key)
            && ts_ms - last < INCIDENT_THROTTLE_MS
        {
            return;
        }
        self.daemon.last_incident.insert(throttle_key, ts_ms);
        self.push_event(Event {
            kind: EventKind::DaemonIncident,
            ts_ms,
            bot_key: bot,
            trade_id: None,
            pair: None,
            profit_abs: None,
            severity: Some(severity),
            detail: Some(e.event_type.clone()),
        });
    }

    fn bot_of_daemon_id(&self, id: &str) -> Option<BotKey> {
        if let Some(port) = self.daemon.bot_ports.get(id)
            && let Some(rt) = self.bots.values().find(|rt| rt.meta.port == Some(*port))
        {
            return Some(rt.meta.key.clone());
        }
        self.bots
            .values()
            .find(|rt| rt.meta.name == id)
            .map(|rt| rt.meta.key.clone())
    }

    // ------------------------------------------------------------------ events and logs

    fn push_event(&mut self, e: Event) {
        let cap = self.sh.cfg.event_ring;
        if let Ok(mut ring) = self.sh.events.lock() {
            if ring.len() >= cap {
                ring.pop_front();
            }
            ring.push_back(e.clone());
        }
        self.pending_events.push(e.clone());
        self.sh.hub.publish_ev(&Channel::Events, e);
    }

    fn flush_events(&mut self) {
        let batch = std::mem::take(&mut self.pending_events);
        self.sh.db.append_events(batch);
    }

    fn housekeeping(&mut self) {
        let now = self.sh.now_ms();
        let keep = i64::from(self.sh.cfg.event_retention_days) * 24 * 3_600_000;
        self.sh.db.purge_events(now - keep);
        self.sh.db.idem_purge(now - 24 * 3_600_000);
        for rt in self.bots.values_mut() {
            while rt
                .rate_limit_ms
                .front()
                .is_some_and(|t| now - t > RATE_LIMIT_WINDOW_MS)
            {
                rt.rate_limit_ms.pop_front();
            }
        }
    }

    /// The lines of `entries` not published yet, oldest first.
    fn fresh_log_lines(
        seen: &mut HashMap<BotKey, (i64, HashSet<u64>)>,
        key: &BotKey,
        entries: &[LogEntry],
    ) -> Vec<LogEntry> {
        let (last_ts, at_last) = seen.entry(key.clone()).or_insert((0, HashSet::new()));
        let mut out = Vec::new();
        let mut new_last = *last_ts;
        let mut new_at_last: HashSet<u64> = if *last_ts == 0 {
            HashSet::new()
        } else {
            at_last.clone()
        };
        for e in entries {
            let h = hash_str(&format!("{}|{}", e.logger, e.message));
            let fresh = e.ts_ms > *last_ts || (e.ts_ms == *last_ts && !at_last.contains(&h));
            if !fresh {
                continue;
            }
            if e.ts_ms > new_last {
                new_last = e.ts_ms;
                new_at_last.clear();
            }
            if e.ts_ms == new_last {
                new_at_last.insert(h);
            }
            out.push(e.clone());
        }
        *last_ts = new_last;
        *at_last = new_at_last;
        out
    }

    fn publish_log_lines(&mut self, key: &BotKey, lines: Vec<LogEntry>) {
        if lines.is_empty() {
            return;
        }
        let bot_ch = Channel::Logs(LogScope::Bot(key.clone()));
        let err_ch = Channel::Logs(LogScope::Errors);
        let events: Vec<(bool, Event)> = lines
            .into_iter()
            .map(|l| {
                let is_error = matches!(l.level.as_str(), "ERROR" | "CRITICAL");
                let severity = match l.level.as_str() {
                    "CRITICAL" | "ERROR" => Severity::Critical,
                    "WARNING" => Severity::Warning,
                    _ => Severity::Info,
                };
                (
                    is_error,
                    Event {
                        kind: EventKind::Warning,
                        ts_ms: l.ts_ms,
                        bot_key: Some(key.clone()),
                        trade_id: None,
                        pair: None,
                        profit_abs: None,
                        severity: Some(severity),
                        detail: Some(l.message.chars().take(300).collect()),
                    },
                )
            })
            .collect();
        self.sh.hub.transaction(|tx| {
            let bot_watched = tx.watched(&bot_ch);
            let err_watched = tx.watched(&err_ch);
            for (is_error, ev) in events {
                if bot_watched {
                    tx.ev(&bot_ch, ev.clone());
                }
                if is_error && err_watched {
                    tx.ev(&err_ch, ev);
                }
            }
        });
    }

    // ------------------------------------------------------------------ publication

    fn store_published(&mut self) {
        self.cur.generated_ms = self.sh.now_ms();
        self.sh.published.store(Arc::new(self.cur.clone()));
    }

    fn tick_fleet(&mut self) {
        let now = self.sh.now_ms();
        let members = aggregate::wallet_members(&self.bots);
        let tz = self.sh.cfg.tz;
        // Only the bots that heard something (or have not been assembled for a while) are
        // assembled again: the others keep their previous result.
        let everyone = self.force_publish || self.dirty_all;
        for (k, rt) in &mut self.bots {
            let recent = self
                .assembled_at
                .get(k)
                .is_some_and(|t| now - t < REASSEMBLE_MS);
            if !everyone && recent && !self.dirty.contains(k) && self.assembled.contains_key(k) {
                continue;
            }
            let wm = rt
                .meta
                .wallet_id
                .as_ref()
                .and_then(|w| members.get(w))
                .copied()
                .unwrap_or(1);
            let ctx = AssembleCtx {
                now_ms: now,
                tz,
                cadences: &self.sh.cfg.cadences,
                wallet_members: wm,
            };
            self.assembled.insert(k.clone(), assemble(rt, &ctx));
            self.assembled_at.insert(k.clone(), now);
        }
        self.assembled.retain(|k, _| self.bots.contains_key(k));
        self.assembled_at.retain(|k, _| self.bots.contains_key(k));
        self.dirty.clear();
        self.dirty_all = false;
        let wallets = aggregate::build_wallets(&self.bots, &self.assembled, &self.recon, now);
        let scopes = if self.force_publish
            || self.cur.scopes.is_empty()
            || now - self.scopes_at >= SCOPES_EVERY_MS
        {
            self.scopes_at = now;
            self.build_scopes(now)
        } else {
            (*self.cur.scopes).clone()
        };

        let mut bots: BTreeMap<BotKey, _> = self
            .assembled
            .iter()
            .map(|(k, a)| (k.clone(), a.row.clone()))
            .collect();
        for (k, row) in &mut bots {
            let Some(prev) = self.cur.bots.get(k) else {
                continue;
            };
            let at = self.slow_bot_at.entry(k.clone()).or_insert(0);
            let (m, pm) = (&mut row.metrics, &prev.metrics);
            if m.drawdown_with_open == pm.drawdown_with_open
                && m.exposure_long == pm.exposure_long
                && m.exposure_short == pm.exposure_short
            {
                continue;
            }
            if !self.force_publish && now - *at < SLOW_BOT_MS {
                m.drawdown_with_open = pm.drawdown_with_open;
                m.exposure_long = pm.exposure_long;
                m.exposure_short = pm.exposure_short;
            } else {
                *at = now;
            }
        }
        self.slow_bot_at.retain(|k, _| bots.contains_key(k));
        for row in bots.values_mut() {
            row.freshness.values_mut().for_each(coarse);
        }
        // Histories shared with the queries: rebuilt only when a ledger changed.
        let versions: BTreeMap<BotKey, u64> = self
            .bots
            .iter()
            .map(|(k, rt)| (k.clone(), rt.ledger.version))
            .collect();
        let data = if versions == self.data_versions {
            Arc::clone(&self.cur.data)
        } else {
            self.data_versions = versions;
            Arc::new(
                self.bots
                    .iter()
                    .map(|(k, rt)| {
                        (
                            k.clone(),
                            BotData {
                                closed: Arc::clone(&rt.ledger.closed),
                                mode: rt.meta.mode,
                                derived: Arc::clone(&rt.ledger.derived),
                                profit: Arc::clone(&rt.ledger.profit),
                                version: rt.ledger.version,
                            },
                        )
                    })
                    .collect(),
            )
        };
        // Rendering a row to JSON is the expensive part: only rows that differ from the ones
        // already published are rendered and diffed.
        let present: Vec<String> = bots.keys().map(ToString::to_string).collect();
        let bot_diff = self.differ.diff_changed(
            "bots",
            bots.iter()
                .filter(|(k, v)| self.cur.bots.get(*k) != Some(*v))
                .map(|(k, v)| (k.to_string(), v)),
            &present,
            &["as_of_ms"],
        );
        let wallet_diff = self.differ.diff(
            "wallets",
            wallets.iter().map(|(k, v)| (k.clone(), v)),
            &["freshness"],
        );
        let scope_diff =
            self.differ
                .diff("scopes", scopes.iter().map(|(k, v)| (k.clone(), v)), &[]);
        // Detail channels with a listener.
        let mut details = BTreeMap::new();
        let mut detail_frames = Vec::new();
        for (k, rt) in &self.bots {
            let ch = Channel::Bot(k.clone());
            if self.sh.hub.subscribers(&ch) == 0 {
                self.differ.reset(&format!("details:{k}"));
                continue;
            }
            let detail = Self::detail_of(rt, now);
            let d = self.differ.diff(
                &format!("details:{k}"),
                [(k.to_string(), &detail)],
                &["freshness"],
            );
            if !d.is_empty() {
                detail_frames.push((ch, d));
            }
            details.insert(k.clone(), detail);
        }
        self.cur.bots = Arc::new(bots);
        self.cur.wallets = Arc::new(wallets);
        self.cur.scopes = Arc::new(scopes);
        self.cur.data = data;
        // Keep the last detail of channels nobody watches right now: a snapshot is still served.
        let mut all_details = (*self.cur.details).clone();
        all_details.retain(|k, _| self.bots.contains_key(k));
        all_details.extend(details);
        self.cur.details = Arc::new(all_details);
        self.cur.generated_ms = now;

        let snapshot = Arc::new(self.cur.clone());
        let sh = Arc::clone(&self.sh);
        sh.hub.transaction(|tx| {
            tx.up_diffs(
                &Channel::Fleet,
                now,
                [
                    ("bots", bot_diff),
                    ("wallets", wallet_diff),
                    ("scopes", scope_diff),
                ],
            );
            for (ch, d) in detail_frames {
                tx.up_diffs(&ch, now, [("details", d)]);
            }
            sh.published.store(snapshot);
        });
    }

    fn build_scopes(&mut self, now: i64) -> BTreeMap<String, fg_core::model::ScopeTotals> {
        let alerts = Arc::clone(&self.cur.alerts);
        let tz = self.sh.cfg.tz;
        let groups: Vec<ScopeBots<'_>> = aggregate::by_mode(&self.bots, &self.assembled);
        let mut out = BTreeMap::new();
        let mut dd_updates = Vec::new();
        for g in &groups {
            let stamp: u64 = g
                .members
                .iter()
                .map(|(rt, _)| rt.ledger.version)
                .fold(0u64, |a, v| a.wrapping_mul(31).wrapping_add(v));
            let has_open = g.members.iter().any(|(_, a)| !a.positions.is_empty());
            let cached = self.scope_dd.get(&g.mode);
            let due = cached.is_none_or(|c| {
                c.stamp != stamp || (has_open && now - c.computed_ms >= SCOPE_DD_REFRESH_MS)
            });
            let result = if due {
                let capital = fg_core::calc::capital::sum_starting_capital(
                    &g.members
                        .iter()
                        .map(|(_, a)| a.starting_capital)
                        .collect::<Vec<_>>(),
                );
                let r = aggregate::scope_drawdown(
                    &g.members,
                    (capital.known > 0).then_some(capital.total),
                    now,
                );
                dd_updates.push((g.mode, stamp, r));
                r
            } else {
                cached.and_then(|c| c.result)
            };
            let t = aggregate::scope_totals(g, &alerts, result, tz, now);
            out.insert(t.scope.clone(), t);
        }
        drop(groups);
        for (mode, stamp, result) in dd_updates {
            self.scope_dd.insert(
                mode,
                ScopeDd {
                    stamp,
                    computed_ms: now,
                    result,
                },
            );
        }
        out
    }

    fn detail_of(rt: &BotRuntime, now: i64) -> BotDetail {
        let f = rt.features.as_ref();
        let as_of = [
            rt.whitelist.as_ref().map(|(_, t)| *t),
            rt.locks.as_ref().map(|(_, t)| *t),
            rt.logs_ms,
        ]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or(0);
        BotDetail {
            whitelist: rt
                .whitelist
                .as_ref()
                .map(|(w, _)| w.clone())
                .unwrap_or_default(),
            blacklist: rt
                .blacklist
                .as_ref()
                .map(|(w, _)| w.clone())
                .unwrap_or_default(),
            locks: rt
                .locks
                .as_ref()
                .map(|(l, _)| l.clone())
                .unwrap_or_default(),
            config: BotConfigSummary {
                version: f.and_then(|f| f.version.clone()),
                api_version: f.and_then(|f| f.api_version),
                strategy: f
                    .and_then(|f| f.strategy.clone())
                    .or_else(|| rt.meta.strategy.clone()),
                trading_mode: f.and_then(|f| f.trading_mode.clone()),
                max_open_trades: f.and_then(|f| f.max_open_trades),
                dry_run: f.and_then(|f| f.dry_run),
                fleet_endpoints: f.is_some_and(|f| f.fleet_endpoints),
            },
            logs: rt.logs.iter().map(LogEntry::line).collect(),
            freshness: Freshness::compute(FreshnessSource::Rest, as_of, now, 300_000, false),
        }
    }

    fn tick_positions(&mut self) {
        let now = self.sh.now_ms();
        if self.assembled.is_empty() && self.bots.is_empty() {
            return;
        }
        let mut positions: BTreeMap<String, _> = self
            .assembled
            .values()
            .flat_map(|a| a.positions.iter())
            .map(|p| {
                (
                    crate::ledger_data::trade_key(&p.bot_key, p.trade_id),
                    p.clone(),
                )
            })
            .collect();
        for (key, p) in &mut positions {
            let Some(prev) = self.cur.positions.get(key) else {
                continue;
            };
            let at = self.slow_pos_at.entry(key.clone()).or_insert(0);
            if p.notional == prev.notional && p.liq_distance_pct == prev.liq_distance_pct {
                continue;
            }
            if !self.force_publish && now - *at < SLOW_FIELD_MS {
                p.notional = prev.notional;
                p.liq_distance_pct = prev.liq_distance_pct;
            } else {
                *at = now;
            }
        }
        self.slow_pos_at.retain(|k, _| positions.contains_key(k));
        let seen: BTreeMap<String, i64> = positions
            .iter()
            .map(|(k, p)| (k.clone(), p.freshness.as_of_ms))
            .collect();
        for p in positions.values_mut() {
            coarse(&mut p.freshness);
        }
        let present: Vec<String> = positions.keys().cloned().collect();
        let diff = self.differ.diff_changed(
            "positions",
            positions
                .iter()
                .filter(|(k, v)| self.cur.positions.get(*k) != Some(*v))
                .map(|(k, v)| (k.clone(), v)),
            &present,
            &["as_of_ms"],
        );
        self.cur.positions = Arc::new(positions);
        self.cur.positions_seen_ms = Arc::new(seen);
        self.cur.generated_ms = now;
        let snapshot = Arc::new(self.cur.clone());
        let sh = Arc::clone(&self.sh);
        sh.hub.transaction(|tx| {
            tx.up_diffs(&Channel::Positions, now, [("positions", diff)]);
            sh.published.store(snapshot);
        });
    }

    // ------------------------------------------------------------------ health

    fn tick_health(&mut self) {
        let now = self.sh.now_ms();
        let health = self.build_health(now);
        let diff = self
            .differ
            .diff("health", [("health".to_owned(), &health)], &["freshness"]);
        self.cur.health = Arc::new(health);
        self.cur.generated_ms = now;
        let snapshot = Arc::new(self.cur.clone());
        let sh = Arc::clone(&self.sh);
        sh.hub.transaction(|tx| {
            tx.up_diffs(&Channel::Health, now, [("health", diff)]);
            sh.published.store(snapshot);
        });
    }

    fn build_health(&self, now: i64) -> Health {
        let mut reasons = Vec::new();
        let mut reason = |code: &str, severity: Severity, detail: Option<String>| {
            reasons.push(HealthReason {
                code: code.to_owned(),
                severity,
                detail,
                alert_id: None,
            });
        };
        // Daemon reachability and digest age.
        let digest_age_s = self
            .daemon
            .digest_ok_ms
            .map(|t| (now - t).max(0) as f64 / 1000.0);
        if self.daemon.digest_failures >= 3 {
            reason("daemon_unreachable", Severity::Warning, None);
        } else if digest_age_s
            .is_some_and(|a| a * 1000.0 > fg_core::calc::freshness::DIGEST_STALE_MS as f64)
        {
            reason("digest_stale", Severity::Warning, None);
        }
        // Rate budgets and backoff of the daemon.
        let mut budget_pct: Option<f64> = None;
        let mut backoff = false;
        if let Some((st, _)) = &self.daemon.status {
            for b in st.rate_limiters.values() {
                if let Some(p) = b.available_pct() {
                    budget_pct = Some(budget_pct.map_or(p, |m: f64| m.min(p)));
                }
                backoff |= b.backoff_active.unwrap_or(false);
            }
        }
        if backoff {
            reason("rate_backoff", Severity::Warning, None);
        }
        if budget_pct.is_some_and(|p| p < 20.0) {
            reason(
                "rate_budget_low",
                Severity::Warning,
                budget_pct.map(|p| format!("{p:.0}% left")),
            );
        }
        // Bots.
        let total = self.bots.len();
        let offline = self
            .bots
            .values()
            .filter(|rt| matches!(rt.status, BotStatus::Offline | BotStatus::AuthExpired))
            .count();
        if total > 0 && offline == total {
            reason(
                "all_bots_offline",
                Severity::Critical,
                Some(format!("{offline}/{total}")),
            );
        } else if offline > 0 {
            reason(
                "bots_offline",
                Severity::Warning,
                Some(format!("{offline}/{total}")),
            );
        }
        let unreadable = self
            .bots
            .values()
            .filter(|rt| rt.meta.read_ledger && rt.ledger.error.is_some())
            .count();
        if unreadable > 0 {
            reason(
                "ledger_unreadable",
                Severity::Warning,
                Some(unreadable.to_string()),
            );
        }
        let rate_limited = self
            .bots
            .values()
            .filter(|rt| {
                rt.rate_limit_ms
                    .iter()
                    .any(|t| now - t < RATE_LIMIT_WINDOW_MS)
            })
            .count();
        if rate_limited > 0 {
            reason(
                "rate_limit_events",
                Severity::Warning,
                Some(rate_limited.to_string()),
            );
        }
        let level = match reasons.iter().map(|r| r.severity).max() {
            Some(Severity::Critical) => HealthLevel::Critical,
            Some(Severity::Warning) => HealthLevel::Degraded,
            _ => HealthLevel::Ok,
        };
        Health {
            level,
            reasons,
            rate_budget_pct: budget_pct,
            backoff_active: backoff,
            hit_rate: self.daemon.stats.as_ref().and_then(|(s, _)| s.hit_rate()),
            bots_process: u32::try_from(
                self.bots
                    .values()
                    .filter(|rt| rt.status != BotStatus::Stopped)
                    .count(),
            )
            .ok(),
            digest_age_s,
            freshness: Freshness {
                as_of_ms: self.daemon.digest_ok_ms.unwrap_or(0),
                source: FreshnessSource::Digest,
                stale: self
                    .daemon
                    .digest_ok_ms
                    .is_none_or(|t| now - t > fg_core::calc::freshness::DIGEST_STALE_MS),
            },
        }
    }

    // ------------------------------------------------------------------ alerts

    fn alert_context(&self, rt: &BotRuntime, a: &Assembled, now: i64) -> BotAlertContext {
        let f = rt.features.as_ref();
        let futures = f
            .and_then(|f| f.trading_mode.as_deref())
            .or_else(|| {
                rt.digest
                    .as_ref()
                    .and_then(|d| d.digest.trading_mode.as_deref())
            })
            .is_some_and(|m| m.eq_ignore_ascii_case("futures"));
        let summary = rt.ledger.summary.as_ref();
        let logs_fresh = rt.logs_fresh(now, &self.sh.cfg.cadences);
        BotAlertContext {
            now_ms: now,
            status: rt.status,
            is_futures: futures,
            max_open_trades: a.row.state.max_open_trades,
            starting_capital: a.starting_capital,
            positions: a
                .positions
                .iter()
                .map(|p| PositionCtx {
                    trade_id: p.trade_id,
                    pair: p.pair.clone(),
                    side: p.side,
                    open_ms: p.open_ms,
                    open_rate: p.open_rate,
                    current_rate: p.current_rate,
                    profit_ratio: p.profit_ratio,
                    liquidation_price: p.liquidation_price,
                    stoploss_abs: p.stoploss_abs,
                    stake_amount: p.stake_amount,
                })
                .collect(),
            positions_stale: !a.positions_fresh,
            median_closed_duration_ms: rt.ledger.derived.median_ms,
            last_trade_ts_raw: summary
                .and_then(|s| s.last_close_ms.max(s.last_open_ms))
                .map(|t| t as f64),
            drawdown_current_abs: a.drawdown.map(|d| d.realized.current_abs),
            logs: logs_fresh.then(|| rt.logs.iter().map(LogEntry::line).collect::<Vec<LogLine>>()),
            rate_limit_events: u32::try_from(
                rt.rate_limit_ms
                    .iter()
                    .filter(|t| now - **t < RATE_LIMIT_WINDOW_MS)
                    .count(),
            )
            .unwrap_or(u32::MAX),
        }
    }

    fn tick_alerts(&mut self) {
        let now = self.sh.now_ms();
        // Make sure the assembled view is current: positions and capital feed the rules.
        self.tick_fleet();
        let mut transitions: Vec<AlertTransition> = Vec::new();
        let keys: Vec<BotKey> = self.bots.keys().cloned().collect();
        for k in &keys {
            let (Some(rt), Some(a)) = (self.bots.get(k), self.assembled.get(k)) else {
                continue;
            };
            let key_str = k.to_string();
            if rt.status == BotStatus::Stopped {
                // A stopped bot has nothing to evaluate: its alerts are resolved.
                let ev = fg_core::alerts::Evaluation {
                    disabled: AlertTypeId::ALL.into_iter().collect(),
                    ..Default::default()
                };
                transitions.extend(self.book.evaluate_bot(now, &key_str, &ev));
                continue;
            }
            let ctx = self.alert_context(rt, a, now);
            let rules = self.rules.effective_for(&key_str);
            let ev = evaluate_bot(&rules, &ctx);
            transitions.extend(self.book.evaluate_bot(now, &key_str, &ev));
        }
        // Alerts of bots that no longer exist are resolved.
        if self.discovered_once {
            let orphans: BTreeSet<String> = self
                .book
                .alerts(now)
                .into_iter()
                .filter_map(|a| a.bot_key)
                .filter(|b| !self.bots.keys().any(|k| k.to_string() == *b))
                .collect();
            for b in orphans {
                let ev = fg_core::alerts::Evaluation {
                    disabled: AlertTypeId::ALL.into_iter().collect(),
                    ..Default::default()
                };
                transitions.extend(self.book.evaluate_bot(now, &b, &ev));
            }
        }
        self.book.prune(now);

        let alerts = self.book.alerts(now);
        for rt in self.bots.values_mut() {
            let key = BTreeSet::from([rt.meta.key.to_string()]);
            rt.alerts = aggregate::alert_summary(&alerts, now, &key);
            rt.last_eval_ms = Some(now);
        }
        let changed = !transitions.is_empty();
        for t in transitions {
            self.push_event(Self::transition_event(&t, now));
        }
        if changed || now - self.last_book_save_ms >= BOOK_SAVE_EVERY_MS {
            self.save_book(now);
        }
        self.cur.alerts = Arc::new(alerts);
        // Every row shows the alert summary of its bot, which was just recomputed.
        self.dirty_all = true;
        self.publish_alerts();
    }

    fn transition_event(t: &AlertTransition, now: i64) -> Event {
        let kind = match t.kind {
            TransitionKind::Resolved => EventKind::AlertResolved,
            _ => EventKind::AlertRaised,
        };
        let a = &t.alert;
        let name = serde_json::to_value(a.type_id)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_default();
        let detail = match &a.subject {
            Some(s) => format!("{name} {s}"),
            None => name,
        };
        Event {
            kind,
            ts_ms: now,
            bot_key: a.bot_key.as_deref().and_then(|b| b.parse().ok()),
            trade_id: None,
            pair: None,
            profit_abs: None,
            severity: Some(a.severity),
            detail: Some(detail),
        }
    }

    fn save_book(&mut self, now: i64) {
        self.last_book_save_ms = now;
        self.sh.db.save_book(&self.book.to_state(), now);
    }

    /// Publish the alert list as keyed upserts.
    fn publish_alerts(&mut self) {
        let now = self.sh.now_ms();
        let alerts: Vec<Alert> = self.book.alerts(now);
        let diff = self.differ.diff(
            "alerts",
            alerts.iter().map(|a| (a.id.clone(), a)),
            &["last_seen_ms"],
        );
        self.cur.alerts = Arc::new(alerts);
        self.cur.generated_ms = now;
        let snapshot = Arc::new(self.cur.clone());
        let sh = Arc::clone(&self.sh);
        sh.hub.transaction(|tx| {
            tx.up_diffs(&Channel::Alerts, now, [("alerts", diff)]);
            sh.published.store(snapshot);
        });
    }
}
