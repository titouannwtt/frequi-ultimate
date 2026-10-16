//! One fake freqtrade bot: the REST and WebSocket surface the gateway uses, under `/api/v1`.
//!
//! Reads answer from the seeded ledger and a small deterministic price model; writes are only
//! recorded (nothing is ever sent anywhere). Every request is counted by route.

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, Request, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::broadcast;

use crate::ledger::{ClosedSummary, SeedOpen, date_text, open_db};

/// What the bot answers right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Mode {
    Up,
    /// Every call, `/ping` included, fails with 503.
    Down,
    /// 502 "not in the correct state" on everything but `/ping` and the token endpoints.
    Starting,
    /// Login and refresh are refused (401); tokens already issued keep working.
    AuthFail,
    /// Every call is delayed by this many milliseconds.
    Slow(u64),
    /// `/status` answers 200 with a body that is not a list of trades; everything else works.
    OddStatus(OddBody),
}

/// The unexpected bodies of [`Mode::OddStatus`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OddBody {
    /// A JSON object (an error envelope with a success status).
    Object,
    /// A web page (a proxy or a login portal in front of the bot).
    Html,
    /// The JSON `null`.
    Null,
    /// A list, but not of trades.
    Strings,
}

/// A bot as the manifest describes it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotInfo {
    pub index: usize,
    pub name: String,
    pub port: u16,
    pub db_path: String,
    pub live: bool,
    pub wallet: Option<String>,
    pub capital: f64,
    pub user: String,
    pub password: String,
}

/// A write that reached the bot. Nothing is executed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriteRecord {
    pub method: String,
    pub path: String,
    pub body: Value,
    pub at_ms: i64,
}

pub struct Bot {
    pub info: BotInfo,
    snapshot_every: Duration,
    wallet_total: f64,
    summary: ClosedSummary,
    whitelist: Vec<String>,
    mode: Mutex<Mode>,
    state: Mutex<&'static str>,
    opens: Mutex<Vec<SeedOpen>>,
    logs: Mutex<Vec<(i64, String, String)>>,
    counts: Mutex<BTreeMap<String, u64>>,
    total: AtomicU64,
    writes: Mutex<Vec<WriteRecord>>,
    events: broadcast::Sender<(String, Arc<str>)>,
    epoch: AtomicU64,
    token_seq: AtomicU64,
    pub ws_opened: AtomicU64,
    pub ws_open: AtomicUsize,
    expected_basic: String,
}

#[must_use]
pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Standard base64, enough for the `Authorization: Basic` comparison.
fn base64(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for c in input.chunks(3) {
        let n = (u32::from(c[0]) << 16)
            | (u32::from(*c.get(1).unwrap_or(&0)) << 8)
            | u32::from(*c.get(2).unwrap_or(&0));
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if c.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// Replace numeric path segments, so that `/trades/12` and `/trades/13` count together.
fn route_key(method: &Method, path: &str) -> String {
    let local = path.strip_prefix("/api/v1").unwrap_or(path);
    let norm: Vec<&str> = local
        .split('/')
        .map(|s| {
            if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) {
                "{id}"
            } else {
                s
            }
        })
        .collect();
    format!("{method} {}", norm.join("/"))
}

impl Bot {
    #[must_use]
    pub fn new(
        info: BotInfo,
        opens: Vec<SeedOpen>,
        summary: ClosedSummary,
        wallet_total: f64,
        snapshot_every: Duration,
    ) -> Arc<Self> {
        let (events, _) = broadcast::channel(256);
        let expected_basic = format!(
            "Basic {}",
            base64(format!("{}:{}", info.user, info.password).as_bytes())
        );
        let now = now_ms();
        let logs = vec![
            (
                now - 3000,
                "freqtrade.worker".to_owned(),
                "INFO|bot running".to_owned(),
            ),
            (
                now - 2000,
                "freqtrade.freqtradebot".to_owned(),
                "INFO|state running".to_owned(),
            ),
        ];
        Arc::new(Self {
            info,
            snapshot_every,
            wallet_total,
            summary,
            whitelist: crate::ledger::PAIRS
                .iter()
                .map(|p| (*p).to_owned())
                .collect(),
            mode: Mutex::new(Mode::Up),
            state: Mutex::new("running"),
            opens: Mutex::new(opens),
            logs: Mutex::new(logs),
            counts: Mutex::new(BTreeMap::new()),
            total: AtomicU64::new(0),
            writes: Mutex::new(Vec::new()),
            events,
            epoch: AtomicU64::new(1),
            token_seq: AtomicU64::new(1),
            ws_opened: AtomicU64::new(0),
            ws_open: AtomicUsize::new(0),
            expected_basic,
        })
    }

    pub fn set_mode(&self, mode: Mode) {
        *lock(&self.mode) = mode;
        if matches!(mode, Mode::Down) {
            // A bot that goes down drops its WebSockets.
            let _ = self.events.send(("__close__".into(), Arc::from("")));
        }
    }

    #[must_use]
    pub fn mode(&self) -> Mode {
        *lock(&self.mode)
    }

    /// Invalidate every access token issued so far (the next call gets a 401).
    pub fn expire_tokens(&self) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
    }

    /// Close the bot's WebSockets without changing its mode.
    pub fn close_websockets(&self) {
        let _ = self.events.send(("__close__".into(), Arc::from("")));
    }

    /// Push a message to the subscribed WebSocket clients.
    pub fn push(&self, kind: &str, data: &Value) {
        let frame = json!({ "type": kind, "data": data }).to_string();
        let _ = self.events.send((kind.to_owned(), Arc::from(frame)));
    }

    pub fn push_log(&self, level: &str, message: &str) {
        lock(&self.logs).push((
            now_ms(),
            "freqtrade.worker".into(),
            format!("{level}|{message}"),
        ));
    }

    #[must_use]
    pub fn requests(&self) -> u64 {
        self.total.load(Ordering::Relaxed)
    }

    #[must_use]
    pub fn route_counts(&self) -> BTreeMap<String, u64> {
        lock(&self.counts).clone()
    }

    #[must_use]
    pub fn writes(&self) -> Vec<WriteRecord> {
        lock(&self.writes).clone()
    }

    fn count(&self, method: &Method, path: &str) {
        self.total.fetch_add(1, Ordering::Relaxed);
        *lock(&self.counts)
            .entry(route_key(method, path))
            .or_insert(0) += 1;
    }

    fn new_access(&self) -> String {
        format!(
            "A-{}-{}-{}",
            self.info.port,
            self.epoch.load(Ordering::SeqCst),
            self.token_seq.fetch_add(1, Ordering::SeqCst)
        )
    }

    fn access_ok(&self, token: &str) -> bool {
        let prefix = format!(
            "A-{}-{}-",
            self.info.port,
            self.epoch.load(Ordering::SeqCst)
        );
        token.starts_with(&prefix)
    }

    fn refresh_ok(&self, token: &str) -> bool {
        token.starts_with(&format!("R-{}-", self.info.port))
    }

    /// Live figures of an open trade at `t_ms`, from a deterministic price model.
    fn live(o: &SeedOpen, t_ms: i64) -> (f64, f64, f64) {
        let phase = t_ms as f64 / 90_000.0 + o.trade_id as f64;
        let rate = o.open_rate * (1.0 + 0.02 * phase.sin());
        let side = if o.is_short { -1.0 } else { 1.0 };
        let ratio = side * (rate / o.open_rate - 1.0) * o.leverage;
        (rate, ratio, ratio * o.stake)
    }

    fn open_json(o: &SeedOpen, t_ms: i64) -> Value {
        let (rate, ratio, abs) = Self::live(o, t_ms);
        json!({
            "trade_id": o.trade_id,
            "pair": o.pair,
            "base_currency": "X",
            "quote_currency": "USDC",
            "is_open": true,
            "is_short": o.is_short,
            "leverage": o.leverage,
            "amount": o.amount,
            "stake_amount": o.stake,
            "open_rate": o.open_rate,
            "open_timestamp": o.open_ms,
            "open_date": date_text(o.open_ms),
            "current_rate": rate,
            "profit_ratio": ratio,
            "profit_pct": ratio * 100.0,
            "profit_abs": abs,
            "stop_loss_abs": if o.is_short { o.open_rate * 1.1 } else { o.open_rate * 0.9 },
            "liquidation_price": if o.is_short { o.open_rate * 1.5 } else { o.open_rate * 0.5 },
            "nr_of_successful_entries": 1,
            "trading_mode": "futures",
            "strategy": "FakeStrategy",
        })
    }

    fn snapshot(&self) -> Value {
        let t = now_ms();
        let items: Vec<Value> = lock(&self.opens)
            .iter()
            .map(|o| {
                let (rate, ratio, abs) = Self::live(o, t);
                json!({
                    "trade_id": o.trade_id,
                    "pair": o.pair,
                    "current_rate": rate,
                    "profit_ratio": ratio,
                    "profit_abs": abs,
                })
            })
            .collect();
        Value::Array(items)
    }
}

// ---------------------------------------------------------------------------------------------
// Gate: counting, modes, authentication
// ---------------------------------------------------------------------------------------------

fn bearer(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::to_owned)
}

fn query_token(query: Option<&str>) -> Option<String> {
    query?
        .split('&')
        .find_map(|kv| kv.strip_prefix("token=").map(str::to_owned))
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({"detail": "Could not validate credentials"})),
    )
        .into_response()
}

async fn gate(State(bot): State<Arc<Bot>>, req: Request, next: Next) -> Response {
    let path = req.uri().path().to_owned();
    bot.count(req.method(), &path);
    let local = path.strip_prefix("/api/v1").unwrap_or(&path).to_owned();
    let is_token = local.starts_with("/token");
    match bot.mode() {
        Mode::Down => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                [(header::CONNECTION, "close")],
                "down",
            )
                .into_response();
        }
        Mode::Starting if local != "/ping" && !is_token => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({"detail": "Bot is not in the correct state."})),
            )
                .into_response();
        }
        Mode::AuthFail if is_token => return unauthorized(),
        Mode::Slow(ms) => tokio::time::sleep(Duration::from_millis(ms)).await,
        _ => {}
    }
    if local != "/ping" && !is_token {
        let token = bearer(req.headers()).or_else(|| query_token(req.uri().query()));
        if !token.is_some_and(|t| bot.access_ok(&t)) {
            return unauthorized();
        }
    }
    next.run(req).await
}

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

async fn ping() -> Json<Value> {
    Json(json!({"status": "pong"}))
}

async fn login(State(bot): State<Arc<Bot>>, headers: HeaderMap) -> Response {
    let ok = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v == bot.expected_basic);
    if !ok {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"detail": "Incorrect username or password"})),
        )
            .into_response();
    }
    let seq = bot.token_seq.fetch_add(1, Ordering::SeqCst);
    Json(json!({
        "access_token": bot.new_access(),
        "refresh_token": format!("R-{}-{seq}", bot.info.port),
    }))
    .into_response()
}

async fn refresh(State(bot): State<Arc<Bot>>, headers: HeaderMap) -> Response {
    if !bearer(&headers).is_some_and(|t| bot.refresh_ok(&t)) {
        return unauthorized();
    }
    Json(json!({"access_token": bot.new_access()})).into_response()
}

async fn show_config(State(bot): State<Arc<Bot>>) -> Json<Value> {
    let state = *lock(&bot.state);
    Json(json!({
        "version": "2026.9-fake",
        "api_version": 2.45,
        "dry_run": !bot.info.live,
        "trading_mode": "futures",
        "state": state,
        "runmode": if bot.info.live { "live" } else { "dry_run" },
        "bot_name": bot.info.name,
        "strategy": "FakeStrategy",
        "max_open_trades": 3,
        "stake_currency": "USDC",
        "timeframe": "15m",
        "exchange": "hyperliquid",
    }))
}

async fn version() -> Json<Value> {
    Json(json!({"version": "2026.9-fake"}))
}

async fn fleet_status() -> Json<Value> {
    Json(json!({}))
}

async fn status(State(bot): State<Arc<Bot>>) -> Response {
    if let Mode::OddStatus(odd) = bot.mode() {
        return match odd {
            OddBody::Object => Json(json!({"detail": "unexpected"})).into_response(),
            OddBody::Html => (
                [(header::CONTENT_TYPE, "text/html")],
                "<html><body>sign in</body></html>",
            )
                .into_response(),
            OddBody::Null => Json(Value::Null).into_response(),
            OddBody::Strings => Json(json!(["a", "b", 3])).into_response(),
        };
    }
    let t = now_ms();
    let items: Vec<Value> = lock(&bot.opens)
        .iter()
        .map(|o| Bot::open_json(o, t))
        .collect();
    Json(Value::Array(items)).into_response()
}

async fn balance(State(bot): State<Arc<Bot>>) -> Json<Value> {
    let total_bot = bot.info.capital + bot.summary.profit_abs;
    Json(json!({
        "currencies": [],
        "total": bot.wallet_total.max(total_bot),
        "total_bot": total_bot,
        "starting_capital": bot.info.capital,
        "wallet_age_s": 2.0,
        "symbol": "USDC",
    }))
}

async fn whitelist(State(bot): State<Arc<Bot>>) -> Json<Value> {
    Json(json!({
        "whitelist": bot.whitelist,
        "length": bot.whitelist.len(),
        "method": ["StaticPairList"],
    }))
}

async fn blacklist() -> Json<Value> {
    Json(json!({"blacklist": [], "length": 0, "method": ["StaticPairList"], "errors": {}}))
}

async fn locks() -> Json<Value> {
    Json(json!({"lock_count": 0, "locks": []}))
}

async fn logs(
    State(bot): State<Arc<Bot>>,
    Query(q): Query<BTreeMap<String, String>>,
) -> Json<Value> {
    let limit = q
        .get("limit")
        .and_then(|l| l.parse::<usize>().ok())
        .unwrap_or(50);
    let all = lock(&bot.logs).clone();
    let rows: Vec<Value> = all
        .iter()
        .rev()
        .take(limit)
        .rev()
        .map(|(t, logger, lm)| {
            let (level, msg) = lm.split_once('|').unwrap_or(("INFO", lm));
            json!([date_text(*t), *t as f64, logger, level, msg])
        })
        .collect();
    Json(json!({"log_count": all.len(), "logs": rows}))
}

/// `GET /pair_candles`: a dataframe in the shape freqtrade answers (`columns` with an indicator
/// and `__date_ts`, `data` rows), from a deterministic price curve; the last candle is still
/// forming. The keys of the echo of the other tooling routes are kept for the tests that read them.
async fn pair_candles(
    State(bot): State<Arc<Bot>>,
    Query(q): Query<BTreeMap<String, String>>,
    uri: axum::http::Uri,
) -> Json<Value> {
    let tf = q.get("timeframe").map_or("5m", String::as_str);
    let unit_ms = match tf.chars().last() {
        Some('m') => 60_000,
        Some('h') => 3_600_000,
        Some('d') => 86_400_000,
        _ => 60_000,
    };
    let n: i64 = tf[..tf.len().saturating_sub(1)].parse().unwrap_or(5);
    let tf_ms = (n.max(1) * unit_ms).max(1_000);
    let limit = q
        .get("limit")
        .and_then(|l| l.parse::<i64>().ok())
        .unwrap_or(100)
        .clamp(1, 1_000);
    let seed = q.get("pair").map_or(0, |p| {
        p.bytes()
            .fold(bot.info.index as i64, |a, b| a + i64::from(b))
    });
    let price = |t: i64| 100.0 + 10.0 * ((t as f64) / 3_600_000.0 + seed as f64).sin();
    let now = now_ms();
    let last_open = now.div_euclid(tf_ms) * tf_ms;
    let rows: Vec<Value> = (0..limit)
        .map(|i| {
            let t = last_open - (limit - 1 - i) * tf_ms;
            let (o, c) = (price(t), price((t + tf_ms).min(now)));
            json!([
                date_text(t),
                o,
                o.max(c) + 0.5,
                o.min(c) - 0.5,
                c,
                10.0 + (t / tf_ms % 7) as f64,
                50.0 + (c - o),
                t
            ])
        })
        .collect();
    Json(json!({
        "proxied": "/pair_candles",
        "query": uri.query(),
        "strategy": "FakeStrategy",
        "pair": q.get("pair"),
        "timeframe": tf,
        "timeframe_ms": tf_ms,
        "columns": ["date", "open", "high", "low", "close", "volume", "rsi", "__date_ts"],
        "data": rows,
        "length": limit,
    }))
}

async fn profit(State(bot): State<Arc<Bot>>) -> Json<Value> {
    let s = bot.summary;
    let open = lock(&bot.opens).len();
    let wins = s.wins;
    Json(json!({
        "profit_closed_coin": s.profit_abs,
        "profit_closed_ratio_mean": 0.0,
        "profit_closed_percent_mean": 0.0,
        "profit_closed_ratio_sum": 0.0,
        "profit_closed_percent_sum": 0.0,
        "profit_closed_ratio": 0.0,
        "profit_closed_percent": 0.0,
        "profit_closed_fiat": s.profit_abs,
        "profit_all_coin": s.profit_abs,
        "profit_all_fiat": s.profit_abs,
        "trade_count": s.count + i64::try_from(open).unwrap_or(0),
        "closed_trade_count": s.count,
        "first_trade_timestamp": s.first_open_ms,
        "latest_trade_timestamp": s.last_close_ms,
        "winning_trades": wins,
        "losing_trades": s.count - wins,
        "max_drawdown": 0.0,
        "max_drawdown_abs": 0.0,
    }))
}

async fn count(State(bot): State<Arc<Bot>>) -> Json<Value> {
    let opens = lock(&bot.opens);
    let stake: f64 = opens.iter().map(|o| o.stake).sum();
    Json(json!({"current": opens.len(), "max": 3, "total_stake": stake}))
}

async fn health() -> Json<Value> {
    Json(json!({"last_process": date_text(now_ms()), "last_process_ts": now_ms() / 1000}))
}

async fn trades(
    State(bot): State<Arc<Bot>>,
    Query(q): Query<BTreeMap<String, String>>,
) -> Json<Value> {
    let limit = q
        .get("limit")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(50);
    let offset = q
        .get("offset")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    let path = PathBuf::from(&bot.info.db_path);
    let rows = tokio::task::spawn_blocking(move || -> rusqlite::Result<(Vec<Value>, i64)> {
        let conn = open_db(&path)?;
        let total: i64 = conn.query_row("SELECT COUNT(*) FROM trades", [], |r| r.get(0))?;
        let mut st = conn.prepare(
            "SELECT id, pair, is_open, is_short, open_date, close_date, close_profit,
                    close_profit_abs, stake_amount, exit_reason FROM trades
             ORDER BY id LIMIT ?1 OFFSET ?2",
        )?;
        let rows = st
            .query_map([limit, offset], |r| {
                Ok(json!({
                    "trade_id": r.get::<_, i64>(0)?,
                    "pair": r.get::<_, String>(1)?,
                    "is_open": r.get::<_, bool>(2)?,
                    "is_short": r.get::<_, Option<bool>>(3)?,
                    "open_date": r.get::<_, String>(4)?,
                    "close_date": r.get::<_, Option<String>>(5)?,
                    "close_profit": r.get::<_, Option<f64>>(6)?,
                    "close_profit_abs": r.get::<_, Option<f64>>(7)?,
                    "stake_amount": r.get::<_, f64>(8)?,
                    "exit_reason": r.get::<_, Option<String>>(9)?,
                }))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok((rows, total))
    })
    .await
    .ok()
    .and_then(Result::ok)
    .unwrap_or_default();
    Json(json!({
        "trades": rows.0,
        "trades_count": rows.0.len(),
        "offset": offset,
        "total_trades": rows.1,
    }))
}

/// Every mutating endpoint: record the call and answer like freqtrade would. Nothing happens.
async fn write(
    State(bot): State<Arc<Bot>>,
    method: Method,
    uri: axum::http::Uri,
    body: Bytes,
) -> Json<Value> {
    let path = uri
        .path()
        .strip_prefix("/api/v1")
        .unwrap_or(uri.path())
        .to_owned();
    let parsed = serde_json::from_slice::<Value>(&body).unwrap_or(Value::Null);
    lock(&bot.writes).push(WriteRecord {
        method: method.to_string(),
        path: path.clone(),
        body: parsed,
        at_ms: now_ms(),
    });
    match path.as_str() {
        "/stop" => *lock(&bot.state) = "stopped",
        "/start" => *lock(&bot.state) = "running",
        "/pause" | "/stopentry" => *lock(&bot.state) = "running",
        _ => {}
    }
    Json(json!({"result": "ok", "status": format!("recorded {method} {path}")}))
}

async fn delete_trade(
    State(bot): State<Arc<Bot>>,
    method: Method,
    uri: axum::http::Uri,
    Path(_id): Path<i64>,
    body: Bytes,
) -> Json<Value> {
    write(State(bot), method, uri, body).await
}

async fn ws_handler(State(bot): State<Arc<Bot>>, upgrade: WebSocketUpgrade) -> Response {
    upgrade.on_upgrade(move |socket| serve_ws(bot, socket))
}

async fn serve_ws(bot: Arc<Bot>, mut socket: WebSocket) {
    bot.ws_opened.fetch_add(1, Ordering::Relaxed);
    bot.ws_open.fetch_add(1, Ordering::Relaxed);
    let mut rx = bot.events.subscribe();
    let mut topics: HashSet<String> = HashSet::new();
    // The first snapshot comes one period after the connection, never before the client said
    // what it wants (otherwise it is a coin toss whether a long period still pushes one).
    let mut tick = tokio::time::interval_at(
        tokio::time::Instant::now() + bot.snapshot_every,
        bot.snapshot_every,
    );
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            msg = socket.recv() => match msg {
                Some(Ok(Message::Text(text))) => {
                    let v: Value = serde_json::from_str(text.as_str()).unwrap_or(Value::Null);
                    if v.get("type").and_then(Value::as_str) == Some("subscribe") {
                        topics = v
                            .get("data")
                            .and_then(Value::as_array)
                            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect())
                            .unwrap_or_default();
                        if topics.contains("whitelist") {
                            let frame = json!({"type": "whitelist", "data": bot.whitelist}).to_string();
                            if socket.send(Message::Text(frame.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                }
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
            ev = rx.recv() => match ev {
                Ok((kind, frame)) => {
                    if kind == "__close__" {
                        break;
                    }
                    if topics.contains(&kind)
                        && socket.send(Message::Text(frame.to_string().into())).await.is_err()
                    {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => break,
            },
            _ = tick.tick() => {
                if topics.contains("trade_snapshot") {
                    let frame = json!({"type": "trade_snapshot", "data": bot.snapshot()}).to_string();
                    if socket.send(Message::Text(frame.into())).await.is_err() {
                        break;
                    }
                }
            }
        }
    }
    bot.ws_open.fetch_sub(1, Ordering::Relaxed);
}

/// The families of paths the gateway proxies to the Python tooling of a bot.
const TOOLING_ROOTS: [&str; 15] = [
    "pair_candles",
    "pair_history",
    "plot_config",
    "signal_summary",
    "volume_history",
    "strategies",
    "strategy",
    "rate_metrics",
    "stratdev",
    "replay",
    "backtest",
    "download_data",
    "background",
    "pairlists",
    "fleetview",
];

/// The Python tooling the gateway proxies (`pair_candles`, `stratdev/*`, `replay`, ...). A read
/// answers with an echo; a mutation is recorded like any other write and nothing happens. Every
/// other unknown path stays a 404: the engine relies on that (`/status` is absent, for instance).
async fn any_other(
    State(bot): State<Arc<Bot>>,
    method: Method,
    uri: axum::http::Uri,
    body: Bytes,
) -> Response {
    // The router is nested under `/api/v1`: the prefix may or may not be there already.
    let path = uri.path();
    let path = path
        .strip_prefix("/api/v1")
        .unwrap_or(path)
        .trim_start_matches('/')
        .to_owned();
    let root = path.split('/').next().unwrap_or("");
    if !TOOLING_ROOTS.contains(&root) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if method == Method::GET {
        return Json(json!({"proxied": format!("/{path}"), "query": uri.query()})).into_response();
    }
    write(State(bot), method, uri, body).await.into_response()
}

/// The router of one bot.
pub fn router(bot: Arc<Bot>) -> Router {
    let v1 = Router::new()
        .route("/ping", get(ping))
        .route("/token/login", post(login))
        .route("/token/refresh", post(refresh))
        .route("/show_config", get(show_config))
        .route("/version", get(version))
        .route("/fleet/status", get(fleet_status))
        .route("/status", get(status))
        .route("/balance", get(balance))
        .route("/whitelist", get(whitelist))
        .route("/blacklist", get(blacklist).post(write).delete(write))
        .route("/locks", get(locks))
        .route("/logs", get(logs))
        .route("/pair_candles", get(pair_candles))
        .route("/profit", get(profit))
        .route("/profit_all", get(profit))
        .route("/count", get(count))
        .route("/health", get(health))
        .route("/trades", get(trades))
        .route("/message/ws", get(ws_handler))
        .route("/forceexit", post(write))
        .route("/forceenter", post(write))
        .route("/start", post(write))
        .route("/stop", post(write))
        .route("/pause", post(write))
        .route("/stopentry", post(write))
        .route("/reload_config", post(write))
        .route("/trades/{id}", delete(delete_trade))
        .route("/trades/{id}/open-order", delete(delete_trade))
        .route("/trades/{id}/reload", post(write))
        .route("/locks/{id}", delete(delete_trade))
        .fallback(any_other);
    Router::new()
        .nest("/api/v1", v1)
        .layer(middleware::from_fn_with_state(Arc::clone(&bot), gate))
        .with_state(bot)
}
