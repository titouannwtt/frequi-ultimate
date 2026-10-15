//! Per-bot WebSocket client (`/api/v1/message/ws`, 03 sections 4.2 and 4.3).
//!
//! [`WsClient::connect`] starts a supervised connection: it dials, authenticates with a token
//! obtained from a [`WsAuth`], subscribes to the requested topics, forwards the messages as
//! [`WsEvent`]s, and reconnects with exponential backoff and jitter when the link drops. Dropping
//! the [`WsHandle`] stops everything. The set of topics can be changed while connected
//! ([`WsHandle::set_topics`]); freqtrade replaces the subscription set on each `subscribe`.
//!
//! The URL carries the token (`?token=`), so it is never logged: log lines only carry the bot
//! port and a failure category.

use std::fmt;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;

use crate::botrest::HttpBot;
use crate::sensitive::Secret;
use crate::traits::{BotWs, BoxFut};

/// Message types a bot can push (`RPCMessageType`). Closed: the gateway subscribes to nothing
/// else.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum WsTopic {
    Status,
    Warning,
    Exception,
    Startup,
    Entry,
    EntryFill,
    EntryCancel,
    Exit,
    ExitFill,
    ExitCancel,
    ProtectionTrigger,
    ProtectionTriggerGlobal,
    StrategyMsg,
    Whitelist,
    /// Heavy: a dataframe per pair. Only for an open chart.
    AnalyzedDf,
    /// One message per new candle (graphique ouvert).
    NewCandle,
    /// Fork: periodic live profit of the open trades.
    TradeSnapshot,
}

impl WsTopic {
    /// Name on the wire.
    #[must_use]
    pub fn wire_name(self) -> &'static str {
        match self {
            Self::Status => "status",
            Self::Warning => "warning",
            Self::Exception => "exception",
            Self::Startup => "startup",
            Self::Entry => "entry",
            Self::EntryFill => "entry_fill",
            Self::EntryCancel => "entry_cancel",
            Self::Exit => "exit",
            Self::ExitFill => "exit_fill",
            Self::ExitCancel => "exit_cancel",
            Self::ProtectionTrigger => "protection_trigger",
            Self::ProtectionTriggerGlobal => "protection_trigger_global",
            Self::StrategyMsg => "strategy_msg",
            Self::Whitelist => "whitelist",
            Self::AnalyzedDf => "analyzed_df",
            Self::NewCandle => "new_candle",
            Self::TradeSnapshot => "trade_snapshot",
        }
    }

    /// The default subscription of the gateway in steady state (no candles, no dataframes).
    #[must_use]
    pub fn steady_state() -> Vec<Self> {
        vec![
            Self::Status,
            Self::Warning,
            Self::Startup,
            Self::Entry,
            Self::EntryFill,
            Self::EntryCancel,
            Self::Exit,
            Self::ExitFill,
            Self::ExitCancel,
            Self::ProtectionTrigger,
            Self::ProtectionTriggerGlobal,
            Self::StrategyMsg,
            Self::Whitelist,
            Self::TradeSnapshot,
        ]
    }
}

/// A message pushed by a bot: `{"type": ..., "data": ...}`.
#[derive(Debug, Clone, PartialEq)]
pub struct BotMessage {
    pub kind: String,
    pub data: Value,
}

/// Why a connection ended or could not be made. No URL, no token, no raw error text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WsCloseKind {
    /// Could not connect or handshake failed (includes refused auth).
    ConnectFailed,
    /// No token available.
    NoToken,
    /// The bot closed the socket.
    ClosedByPeer,
    /// No frame for longer than the idle timeout.
    Idle,
    /// Transport error while connected.
    Error,
}

/// What the supervisor reports.
#[derive(Debug, Clone, PartialEq)]
pub enum WsEvent {
    /// Connected and subscribed.
    Connected,
    Message(BotMessage),
    Disconnected(WsCloseKind),
}

/// Provides the token for a connection attempt (fresh each time).
pub trait WsAuth: Send + Sync {
    fn ws_token(&self) -> BoxFut<'_, Option<Secret>>;
}

impl WsAuth for HttpBot {
    fn ws_token(&self) -> BoxFut<'_, Option<Secret>> {
        Box::pin(HttpBot::ws_token(self))
    }
}

/// Where to connect.
#[derive(Clone)]
pub struct WsTarget {
    /// `ws://host:port/api/v1`; the endpoint path is appended.
    pub base: String,
    pub auth: Arc<dyn WsAuth>,
    /// Port, for logs.
    pub label: String,
}

impl fmt::Debug for WsTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WsTarget")
            .field("label", &self.label)
            .finish_non_exhaustive()
    }
}

/// Reconnection and liveness settings.
#[derive(Debug, Clone)]
pub struct WsOptions {
    pub backoff_initial: Duration,
    pub backoff_max: Duration,
    /// A connection that lived this long resets the backoff.
    pub stable_after: Duration,
    /// No frame (data, ping or pong) for this long = dead link.
    pub idle_timeout: Duration,
    /// Our own ping cadence.
    pub ping_every: Duration,
    pub connect_timeout: Duration,
    pub events_capacity: usize,
}

impl Default for WsOptions {
    fn default() -> Self {
        Self {
            backoff_initial: Duration::from_secs(1),
            backoff_max: Duration::from_secs(60),
            stable_after: Duration::from_secs(30),
            idle_timeout: Duration::from_secs(120),
            ping_every: Duration::from_secs(30),
            connect_timeout: Duration::from_secs(5),
            events_capacity: 1024,
        }
    }
}

/// Handle of a supervised connection. Dropping it stops the supervisor.
pub struct WsHandle {
    /// Events from the bot, in order. Bounded: a consumer that stops reading is disconnected
    /// rather than letting memory grow.
    pub events: mpsc::Receiver<WsEvent>,
    topics: watch::Sender<Vec<WsTopic>>,
    task: JoinHandle<()>,
}

impl WsHandle {
    /// Replace the subscription set (sent immediately when connected, and after each reconnect).
    pub fn set_topics(&self, topics: Vec<WsTopic>) {
        self.topics.send_replace(topics);
    }
}

impl Drop for WsHandle {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Production [`BotWs`].
#[derive(Debug, Clone, Default)]
pub struct WsClient {
    opts: WsOptions,
}

impl WsClient {
    #[must_use]
    pub fn new(opts: WsOptions) -> Self {
        Self { opts }
    }
}

impl BotWs for WsClient {
    fn connect(&self, target: WsTarget, topics: Vec<WsTopic>) -> WsHandle {
        let (tx, rx) = mpsc::channel(self.opts.events_capacity);
        let (topics_tx, topics_rx) = watch::channel(topics);
        let task = tokio::spawn(supervise(target, self.opts.clone(), tx, topics_rx));
        WsHandle {
            events: rx,
            topics: topics_tx,
            task,
        }
    }
}

/// Jitter in `[0.8, 1.2)` from the clock; backoff does not need a strong random source.
fn jitter() -> f64 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.subsec_nanos());
    0.8 + f64::from(nanos % 400) / 1000.0
}

/// Backoff for the n-th consecutive failure (0-based): `initial * 2^n`, capped, jittered.
#[must_use]
pub fn backoff_delay(opts: &WsOptions, failures: u32) -> Duration {
    let base = opts
        .backoff_initial
        .saturating_mul(2u32.saturating_pow(failures.min(16)))
        .min(opts.backoff_max);
    base.mul_f64(jitter()).min(opts.backoff_max.mul_f64(1.2))
}

async fn supervise(
    target: WsTarget,
    opts: WsOptions,
    tx: mpsc::Sender<WsEvent>,
    mut topics: watch::Receiver<Vec<WsTopic>>,
) {
    let mut failures: u32 = 0;
    loop {
        let started = Instant::now();
        let kind = run_once(&target, &opts, &tx, &mut topics).await;
        if tx.send(WsEvent::Disconnected(kind)).await.is_err() {
            return;
        }
        if started.elapsed() >= opts.stable_after {
            failures = 0;
        }
        let delay = backoff_delay(&opts, failures);
        failures = failures.saturating_add(1);
        tracing::debug!(bot = %target.label, ?kind, delay_ms = delay.as_millis() as u64, "bot websocket down, will retry");
        tokio::time::sleep(delay).await;
    }
}

fn subscribe_frame(topics: &[WsTopic]) -> Message {
    let names: Vec<&str> = topics.iter().map(|t| t.wire_name()).collect();
    Message::text(json!({ "type": "subscribe", "data": names }).to_string())
}

/// One connection, from dial to close.
async fn run_once(
    target: &WsTarget,
    opts: &WsOptions,
    tx: &mpsc::Sender<WsEvent>,
    topics: &mut watch::Receiver<Vec<WsTopic>>,
) -> WsCloseKind {
    let Some(token) = target.auth.ws_token().await else {
        return WsCloseKind::NoToken;
    };
    // The only place the token is put in a string; the string is not logged.
    let url = format!("{}/message/ws?token={}", target.base, token.expose());
    let connect = tokio_tungstenite::connect_async(url);
    let Ok(Ok((mut ws, _))) = tokio::time::timeout(opts.connect_timeout, connect).await else {
        return WsCloseKind::ConnectFailed;
    };

    let current = topics.borrow_and_update().clone();
    if !current.is_empty() && ws.send(subscribe_frame(&current)).await.is_err() {
        return WsCloseKind::Error;
    }
    if tx.send(WsEvent::Connected).await.is_err() {
        return WsCloseKind::Error;
    }

    let mut ping = tokio::time::interval(opts.ping_every);
    ping.tick().await;
    let mut last_frame = Instant::now();
    loop {
        tokio::select! {
            frame = ws.next() => {
                let Some(frame) = frame else { return WsCloseKind::ClosedByPeer };
                last_frame = Instant::now();
                match frame {
                    Ok(Message::Text(text)) => {
                        if let Some(msg) = parse_message(text.as_str()) {
                            // A full queue means the consumer stalled: drop the link, the
                            // consumer resynchronises from REST after the reconnect.
                            if tx.try_send(WsEvent::Message(msg)).is_err() {
                                return WsCloseKind::Error;
                            }
                        }
                    }
                    Ok(Message::Close(_)) => return WsCloseKind::ClosedByPeer,
                    Ok(_) => {}
                    Err(_) => return WsCloseKind::Error,
                }
            }
            changed = topics.changed() => {
                if changed.is_err() {
                    return WsCloseKind::Error;
                }
                let current = topics.borrow_and_update().clone();
                if ws.send(subscribe_frame(&current)).await.is_err() {
                    return WsCloseKind::Error;
                }
            }
            _ = ping.tick() => {
                if last_frame.elapsed() > opts.idle_timeout {
                    return WsCloseKind::Idle;
                }
                if ws.send(Message::Ping(Vec::new().into())).await.is_err() {
                    return WsCloseKind::Error;
                }
            }
        }
    }
}

/// Parse a text frame. Malformed frames are dropped (and not logged: they may carry data).
#[must_use]
pub fn parse_message(text: &str) -> Option<BotMessage> {
    let v: Value = serde_json::from_str(text).ok()?;
    let kind = v.get("type")?.as_str()?.to_owned();
    Some(BotMessage {
        kind,
        data: v.get("data").cloned().unwrap_or(Value::Null),
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::sync::Mutex;

    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_hdr_async;
    use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

    use super::*;

    struct StaticAuth(Option<&'static str>);

    impl WsAuth for StaticAuth {
        fn ws_token(&self) -> BoxFut<'_, Option<Secret>> {
            let t = self.0.map(Secret::new);
            Box::pin(async move { t })
        }
    }

    fn fast() -> WsOptions {
        WsOptions {
            backoff_initial: Duration::from_millis(30),
            backoff_max: Duration::from_millis(120),
            stable_after: Duration::from_secs(60),
            idle_timeout: Duration::from_secs(5),
            ping_every: Duration::from_millis(50),
            connect_timeout: Duration::from_secs(2),
            events_capacity: 64,
        }
    }

    /// A bot-like WS server: records the handshake URI and every client frame, pushes the
    /// scripted messages once per connection, then keeps the socket open (or closes it).
    struct FakeBot {
        port: u16,
        uris: Arc<Mutex<Vec<String>>>,
        client_frames: Arc<Mutex<Vec<String>>>,
        _task: JoinHandle<()>,
    }

    #[allow(clippy::result_large_err)] // the handshake callback signature is dictated by tungstenite
    async fn fake_bot(push: Vec<&'static str>, close_after_push: bool) -> FakeBot {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let uris = Arc::new(Mutex::new(Vec::new()));
        let frames = Arc::new(Mutex::new(Vec::new()));
        let (u, f) = (Arc::clone(&uris), Arc::clone(&frames));
        let task = tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                let (u, f, push) = (Arc::clone(&u), Arc::clone(&f), push.clone());
                tokio::spawn(async move {
                    let cb = |req: &Request, resp: Response| {
                        u.lock().unwrap().push(req.uri().to_string());
                        Ok(resp)
                    };
                    let Ok(mut ws) = accept_hdr_async(stream, cb).await else {
                        return;
                    };
                    // Wait for the subscription before pushing, like a real bot would answer.
                    if let Some(Ok(Message::Text(t))) = ws.next().await {
                        f.lock().unwrap().push(t.as_str().to_owned());
                    }
                    for m in push {
                        ws.send(Message::text(m)).await.unwrap();
                    }
                    if close_after_push {
                        let _ = ws.close(None).await;
                        return;
                    }
                    while let Some(Ok(frame)) = ws.next().await {
                        if let Message::Text(t) = frame {
                            f.lock().unwrap().push(t.as_str().to_owned());
                        }
                    }
                });
            }
        });
        FakeBot {
            port,
            uris,
            client_frames: frames,
            _task: task,
        }
    }

    fn target(port: u16, token: Option<&'static str>) -> WsTarget {
        WsTarget {
            base: format!("ws://127.0.0.1:{port}/api/v1"),
            auth: Arc::new(StaticAuth(token)),
            label: port.to_string(),
        }
    }

    async fn next_event(h: &mut WsHandle) -> WsEvent {
        tokio::time::timeout(Duration::from_secs(3), h.events.recv())
            .await
            .expect("event in time")
            .expect("channel open")
    }

    #[test]
    fn topics_are_the_freqtrade_message_types() {
        let names: HashSet<&str> = [
            WsTopic::Status,
            WsTopic::Warning,
            WsTopic::Exception,
            WsTopic::Startup,
            WsTopic::Entry,
            WsTopic::EntryFill,
            WsTopic::EntryCancel,
            WsTopic::Exit,
            WsTopic::ExitFill,
            WsTopic::ExitCancel,
            WsTopic::ProtectionTrigger,
            WsTopic::ProtectionTriggerGlobal,
            WsTopic::StrategyMsg,
            WsTopic::Whitelist,
            WsTopic::AnalyzedDf,
            WsTopic::NewCandle,
            WsTopic::TradeSnapshot,
        ]
        .iter()
        .map(|t| t.wire_name())
        .collect();
        assert_eq!(names.len(), 17, "wire names are unique");
        assert!(
            WsTopic::steady_state()
                .iter()
                .all(|t| !matches!(t, WsTopic::AnalyzedDf | WsTopic::NewCandle))
        );
    }

    #[test]
    fn frames_are_parsed_leniently() {
        let m = parse_message(r#"{"type":"entry_fill","data":{"trade_id":3}}"#).unwrap();
        assert_eq!(m.kind, "entry_fill");
        assert_eq!(m.data["trade_id"], 3);
        assert_eq!(
            parse_message(r#"{"type":"startup"}"#).unwrap().data,
            Value::Null
        );
        assert!(parse_message("not json").is_none());
        assert!(parse_message(r#"{"data":1}"#).is_none());
        assert!(parse_message(r#"{"type":5}"#).is_none());
    }

    #[test]
    fn backoff_grows_then_caps() {
        let o = WsOptions::default();
        let d = |n| backoff_delay(&o, n).as_secs_f64();
        assert!((0.8..1.2).contains(&d(0)));
        assert!((1.6..2.4).contains(&d(1)));
        assert!((3.2..4.8).contains(&d(2)));
        for n in [6, 10, 100] {
            assert!(d(n) <= 72.0 && d(n) >= 48.0, "n={n}: {}", d(n));
        }
    }

    #[tokio::test]
    async fn connects_authenticates_subscribes_and_forwards_messages() {
        let bot = fake_bot(
            vec![
                r#"{"type":"whitelist","data":["BTC/USDC:USDC"]}"#,
                "garbage that is not json",
                r#"{"type":"trade_snapshot","data":[{"trade_id":1,"profit_abs":1.5}]}"#,
            ],
            false,
        )
        .await;
        let mut h = WsClient::new(fast()).connect(
            target(bot.port, Some("JWT-ACCESS")),
            vec![WsTopic::Whitelist, WsTopic::TradeSnapshot],
        );
        assert_eq!(next_event(&mut h).await, WsEvent::Connected);
        let WsEvent::Message(a) = next_event(&mut h).await else {
            panic!()
        };
        assert_eq!(a.kind, "whitelist");
        let WsEvent::Message(b) = next_event(&mut h).await else {
            panic!()
        };
        assert_eq!(b.kind, "trade_snapshot", "the malformed frame was skipped");
        assert_eq!(b.data[0]["profit_abs"], 1.5);

        assert_eq!(
            bot.uris.lock().unwrap()[0],
            "/api/v1/message/ws?token=JWT-ACCESS"
        );
        let sub: Value = serde_json::from_str(&bot.client_frames.lock().unwrap()[0]).unwrap();
        assert_eq!(
            sub,
            json!({"type": "subscribe", "data": ["whitelist", "trade_snapshot"]})
        );
    }

    #[tokio::test]
    async fn topics_can_change_while_connected() {
        let bot = fake_bot(vec![], false).await;
        let mut h =
            WsClient::new(fast()).connect(target(bot.port, Some("T")), vec![WsTopic::Status]);
        assert_eq!(next_event(&mut h).await, WsEvent::Connected);
        h.set_topics(vec![WsTopic::Status, WsTopic::NewCandle]);
        for _ in 0..40 {
            if bot.client_frames.lock().unwrap().len() >= 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        let frames = bot.client_frames.lock().unwrap().clone();
        let last: Value = serde_json::from_str(frames.last().unwrap()).unwrap();
        assert_eq!(last["data"], json!(["status", "new_candle"]));
    }

    #[tokio::test]
    async fn reconnects_with_backoff_and_resubscribes() {
        let bot = fake_bot(vec![r#"{"type":"startup","data":"hi"}"#], true).await;
        let mut h =
            WsClient::new(fast()).connect(target(bot.port, Some("T")), vec![WsTopic::Startup]);
        let mut connects = 0;
        let mut disconnects = 0;
        let started = Instant::now();
        while connects < 3 {
            match next_event(&mut h).await {
                WsEvent::Connected => connects += 1,
                WsEvent::Disconnected(k) => {
                    assert_eq!(k, WsCloseKind::ClosedByPeer);
                    disconnects += 1;
                }
                WsEvent::Message(_) => {}
            }
        }
        assert!(disconnects >= 2);
        assert!(
            started.elapsed() >= Duration::from_millis(40),
            "reconnects are spaced by the backoff"
        );
        for _ in 0..40 {
            if bot.client_frames.lock().unwrap().len() >= 3 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        assert!(
            bot.client_frames.lock().unwrap().len() >= 3,
            "re-subscribed on each connection"
        );
    }

    #[tokio::test]
    async fn no_token_or_dead_port_is_reported_and_retried() {
        let mut h = WsClient::new(fast()).connect(target(1, None), vec![WsTopic::Status]);
        assert_eq!(
            next_event(&mut h).await,
            WsEvent::Disconnected(WsCloseKind::NoToken)
        );
        assert_eq!(
            next_event(&mut h).await,
            WsEvent::Disconnected(WsCloseKind::NoToken)
        );

        let mut h = WsClient::new(fast()).connect(target(1, Some("T")), vec![WsTopic::Status]);
        assert_eq!(
            next_event(&mut h).await,
            WsEvent::Disconnected(WsCloseKind::ConnectFailed)
        );
    }

    #[tokio::test]
    async fn dropping_the_handle_stops_the_supervisor() {
        let bot = fake_bot(vec![], false).await;
        let mut h =
            WsClient::new(fast()).connect(target(bot.port, Some("T")), vec![WsTopic::Status]);
        assert_eq!(next_event(&mut h).await, WsEvent::Connected);
        let uris_before = bot.uris.lock().unwrap().len();
        drop(h);
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(
            bot.uris.lock().unwrap().len(),
            uris_before,
            "no reconnection after drop"
        );
    }

    #[test]
    fn target_debug_does_not_show_the_url_or_token() {
        let t = target(9056, Some("SECRET-TOKEN"));
        let shown = format!("{t:?}");
        assert!(
            !shown.contains("SECRET-TOKEN") && !shown.contains("ws://"),
            "{shown}"
        );
    }
}
