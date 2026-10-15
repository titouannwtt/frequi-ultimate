//! Client of the ftcache daemon (03 section 4.4).
//!
//! The daemon speaks NDJSON over a Unix socket (`/tmp/ftcache-<uid>.sock`): one JSON object per
//! line, one reply per request, `req_id` echoed.
//!
//! # The allow list is the type system
//!
//! [`DaemonOp`] is a closed enum of the five read-only operations the gateway may ever send:
//! `ping`, `summary_get`, `fleet_status`, `fleet_events`, `stats`. There is no function in this
//! module that sends a free-form operation name, so any other operation (`register`,
//! `positions_get`, `tickers`, `*_put`, `acquire`, `report_*`, ...) is not representable. The
//! reason is documented in `daemon.py:_handle_positions_get`: a reader that asks for positions on
//! a cache miss arms an in-flight event and spends rate budget while waiting for *the caller* to
//! fetch and push the data, which would stall the bots that queue behind it; `register` would
//! make the gateway look like a bot. Tests fail if a variant is added or renamed, and if the
//! source ever contains the wire name of a forbidden operation outside a test.
//!
//! Connections are ephemeral and serialised (one at a time, 2 s timeout), as specified.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::Mutex;

use crate::traits::{BoxFut, DaemonClient};

/// Upper bound of one reply line. A 40-bot digest is a few tens of KB.
const MAX_REPLY_BYTES: usize = 8 * 1024 * 1024;

macro_rules! daemon_ops {
    ($( $(#[$doc:meta])* $variant:ident => $wire:literal ),+ $(,)?) => {
        /// The operations the gateway may send to the daemon. Closed on purpose.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum DaemonOp {
            $( $(#[$doc])* $variant ),+
        }

        impl DaemonOp {
            /// Every operation, generated from the same list as the enum so they cannot drift.
            pub const ALL: &'static [DaemonOp] = &[ $( DaemonOp::$variant ),+ ];

            /// Name on the wire.
            #[must_use]
            pub const fn wire_name(self) -> &'static str {
                match self { $( DaemonOp::$variant => $wire ),+ }
            }
        }
    };
}

daemon_ops! {
    /// Liveness and protocol version.
    Ping => "ping",
    /// Digest of the whole fleet, pushed by the bots.
    SummaryGet => "summary_get",
    /// Daemon health: connected bots, rate budgets, backoff.
    FleetStatus => "fleet_status",
    /// Incident log with a `since_ts` cursor.
    FleetEvents => "fleet_events",
    /// Counters (hit rate, queue depth, budgets).
    Stats => "stats",
}

/// Failure of a daemon call.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum DaemonError {
    /// No socket, or the daemon refused the connection.
    #[error("ftcache daemon unavailable")]
    Unavailable,
    #[error("ftcache daemon did not answer in time")]
    Timeout,
    /// The daemon answered `ok: false` (error type is the daemon's class name).
    #[error("ftcache daemon rejected the request: {0}")]
    Rejected(String),
    /// Reply that is not valid JSON, too large, or not the answer to our request.
    #[error("ftcache protocol error")]
    Protocol,
}

/// Default socket path of a user: `/tmp/ftcache-<uid>.sock`.
#[must_use]
pub fn default_socket_path(uid: u32) -> PathBuf {
    PathBuf::from(format!("/tmp/ftcache-{uid}.sock"))
}

// ---------------------------------------------------------------------------------------------
// Typed replies. Every field is optional: the daemon evolves and a missing field is unknown.
// ---------------------------------------------------------------------------------------------

/// Reply of `ping`.
#[derive(Debug, Clone, PartialEq, Deserialize, Default)]
pub struct DaemonPing {
    #[serde(default)]
    pub daemon_version: Option<u32>,
    #[serde(default)]
    pub uptime_s: Option<f64>,
}

/// One bot digest of `summary_get`, as pushed by the bot every cycle.
#[derive(Debug, Clone, PartialEq, Deserialize, Default)]
pub struct BotDigest {
    #[serde(default)]
    pub bot_name: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub dry_run: Option<bool>,
    #[serde(default)]
    pub exchange: Option<String>,
    #[serde(default)]
    pub strategy: Option<String>,
    #[serde(default)]
    pub stake_currency: Option<String>,
    #[serde(default)]
    pub trading_mode: Option<String>,
    #[serde(default)]
    pub open_trade_count: Option<i64>,
    #[serde(default)]
    pub max_open_trades: Option<i64>,
    #[serde(default)]
    pub closed_profit_abs: Option<f64>,
    #[serde(default)]
    pub balance_total: Option<f64>,
    #[serde(default)]
    pub wallet_age_s: Option<f64>,
    /// Absent when the bot could not price its open trades from the rate cache.
    #[serde(default)]
    pub open_profit_abs: Option<f64>,
    /// Age of the digest: a stale figure must never be shown as current.
    #[serde(default)]
    pub age_s: Option<f64>,
    /// Port the bot registered with; the key to match a digest to a discovered bot.
    #[serde(default)]
    pub api_port: Option<u16>,
}

/// Reply of `summary_get`.
#[derive(Debug, Clone, PartialEq, Deserialize, Default)]
pub struct FleetSummary {
    #[serde(default)]
    pub ts: Option<f64>,
    /// Keyed by the name the bot reports.
    #[serde(default)]
    pub bots: BTreeMap<String, BotDigest>,
}

/// Daemon section of `fleet_status`.
#[derive(Debug, Clone, PartialEq, Deserialize, Default)]
pub struct DaemonInfo {
    #[serde(default)]
    pub uptime_s: Option<f64>,
    #[serde(default)]
    pub active_connections: Option<i64>,
    #[serde(default)]
    pub total_series: Option<i64>,
    #[serde(default)]
    pub total_events: Option<i64>,
}

/// A bot as registered in the daemon.
#[derive(Debug, Clone, PartialEq, Deserialize, Default)]
pub struct RegisteredBot {
    #[serde(default)]
    pub bot_id: Option<String>,
    #[serde(default)]
    pub exchange: Option<String>,
    #[serde(default)]
    pub trading_mode: Option<String>,
    #[serde(default)]
    pub strategy: Option<String>,
    #[serde(default)]
    pub timeframe: Option<String>,
    #[serde(default)]
    pub pairs_count: Option<i64>,
    #[serde(default)]
    pub dry_run: Option<bool>,
    #[serde(default)]
    pub api_port: Option<u16>,
    #[serde(default)]
    pub pid: Option<u32>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub uptime_s: Option<f64>,
    #[serde(default)]
    pub last_heartbeat_ago_s: Option<f64>,
}

/// Rate-limit bucket of one exchange.
#[derive(Debug, Clone, PartialEq, Deserialize, Default)]
pub struct RateBudget {
    #[serde(default)]
    pub tokens_available: Option<f64>,
    #[serde(default)]
    pub tokens_max: Option<f64>,
    #[serde(default)]
    pub weight_mode: Option<bool>,
    #[serde(default)]
    pub backoff_active: Option<bool>,
    #[serde(default)]
    pub shed_count: Option<i64>,
    #[serde(default)]
    pub queued_during_backoff: Option<i64>,
    #[serde(default)]
    pub backoff_count: Option<i64>,
    #[serde(default)]
    pub weight_used_last_min: Option<f64>,
    #[serde(default)]
    pub weight_budget_per_min: Option<f64>,
}

impl RateBudget {
    /// Share of the budget still available (0 to 100), when both figures are known.
    #[must_use]
    pub fn available_pct(&self) -> Option<f64> {
        match (
            self.weight_mode,
            self.weight_used_last_min,
            self.weight_budget_per_min,
        ) {
            (Some(true), Some(used), Some(budget)) if budget > 0.0 => {
                Some(((budget - used) / budget * 100.0).clamp(0.0, 100.0))
            }
            _ => match (self.tokens_available, self.tokens_max) {
                (Some(avail), Some(max)) if max > 0.0 => {
                    Some((avail / max * 100.0).clamp(0.0, 100.0))
                }
                _ => None,
            },
        }
    }
}

/// Reply of `fleet_status`.
#[derive(Debug, Clone, PartialEq, Deserialize, Default)]
pub struct FleetStatus {
    #[serde(default)]
    pub daemon: DaemonInfo,
    #[serde(default)]
    pub bots: Vec<RegisteredBot>,
    #[serde(default)]
    pub rate_limiters: BTreeMap<String, RateBudget>,
    /// Count of incidents per type over the last hour (includes 429 events).
    #[serde(default)]
    pub recent_events_count: BTreeMap<String, i64>,
}

/// One entry of the daemon incident log.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct DaemonEvent {
    pub ts: f64,
    pub event_type: String,
    #[serde(default)]
    pub bot_id: Option<String>,
    #[serde(default)]
    pub details: Map<String, Value>,
}

/// Reply of `fleet_events` (newest first).
#[derive(Debug, Clone, PartialEq, Deserialize, Default)]
pub struct FleetEvents {
    #[serde(default)]
    pub events: Vec<DaemonEvent>,
}

/// Reply of `stats`. Counters we use are named; per-exchange budgets are collected apart.
#[derive(Debug, Clone, PartialEq, Deserialize, Default)]
pub struct DaemonStats {
    #[serde(default)]
    pub uptime_s: Option<f64>,
    #[serde(default)]
    pub active_clients: Option<i64>,
    #[serde(default)]
    pub requests_total: Option<i64>,
    #[serde(default)]
    pub cache_hits: Option<i64>,
    /// Served from cache too (stale-while-revalidate): part of the hit rate.
    #[serde(default)]
    pub cache_swr: Option<i64>,
    #[serde(default)]
    pub cache_partial: Option<i64>,
    #[serde(default)]
    pub cache_misses: Option<i64>,
    #[serde(default)]
    pub fetch_errors: Option<i64>,
    #[serde(default)]
    pub series_count: Option<i64>,
    #[serde(default)]
    pub pending_fetches: Option<i64>,
    #[serde(default)]
    pub peak_pending: Option<i64>,
    /// Everything else: scalar counters and one object per exchange (the budgets).
    #[serde(flatten)]
    pub other: BTreeMap<String, Value>,
}

impl DaemonStats {
    /// Share of requests answered from cache. The daemon's own `hit_rate_pct` omitted the SWR
    /// branch and read 13 % on a cache that answers ~100 %, so it is recomputed here.
    #[must_use]
    pub fn hit_rate(&self) -> Option<f64> {
        let total = self.requests_total?;
        if total <= 0 {
            return None;
        }
        let served = self.cache_hits.unwrap_or(0)
            + self.cache_swr.unwrap_or(0)
            + self.cache_partial.unwrap_or(0);
        Some(served as f64 / total as f64)
    }

    /// Per-exchange budget blocks found in the flattened remainder.
    #[must_use]
    pub fn exchanges(&self) -> BTreeMap<String, Value> {
        self.other
            .iter()
            .filter(|(_, v)| v.get("tokens_available").is_some())
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }
}

// ---------------------------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------------------------

/// Daemon client over the Unix socket.
pub struct UnixDaemon {
    socket: PathBuf,
    timeout: Duration,
    next_id: AtomicU64,
    /// One connection at a time (the daemon is single-threaded and has saturated before).
    gate: Mutex<()>,
}

impl UnixDaemon {
    #[must_use]
    pub fn new(socket: impl Into<PathBuf>) -> Self {
        Self::with_timeout(socket, Duration::from_secs(2))
    }

    #[must_use]
    pub fn with_timeout(socket: impl Into<PathBuf>, timeout: Duration) -> Self {
        Self {
            socket: socket.into(),
            timeout,
            next_id: AtomicU64::new(1),
            gate: Mutex::new(()),
        }
    }

    #[must_use]
    pub fn socket(&self) -> &Path {
        &self.socket
    }

    /// Build the single request line for an operation. Private: the only way to produce bytes
    /// for the socket, and it takes a [`DaemonOp`].
    fn request(&self, op: DaemonOp, extra: Value) -> (String, Vec<u8>) {
        let req_id = format!("fg-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let mut obj = Map::new();
        obj.insert("op".into(), json!(op.wire_name()));
        obj.insert("req_id".into(), json!(req_id));
        if let Value::Object(extra) = extra {
            for (k, v) in extra {
                // The operation is fixed by the enum; parameters can never override it.
                if k != "op" && k != "req_id" {
                    obj.insert(k, v);
                }
            }
        }
        let mut line = serde_json::to_vec(&Value::Object(obj)).unwrap_or_default();
        line.push(b'\n');
        (req_id, line)
    }

    async fn exchange(&self, line: &[u8]) -> Result<Value, DaemonError> {
        let _gate = self.gate.lock().await;
        let io = async {
            let mut stream = UnixStream::connect(&self.socket)
                .await
                .map_err(|_| DaemonError::Unavailable)?;
            stream
                .write_all(line)
                .await
                .map_err(|_| DaemonError::Unavailable)?;
            let mut reader = BufReader::new(stream);
            let mut buf = Vec::new();
            loop {
                let n = reader
                    .read_until(b'\n', &mut buf)
                    .await
                    .map_err(|_| DaemonError::Unavailable)?;
                if n == 0 || buf.len() > MAX_REPLY_BYTES {
                    return Err(if n == 0 {
                        DaemonError::Unavailable
                    } else {
                        DaemonError::Protocol
                    });
                }
                if buf.ends_with(b"\n") {
                    break;
                }
            }
            serde_json::from_slice::<Value>(&buf).map_err(|_| DaemonError::Protocol)
            // The stream is dropped here: the connection is ephemeral.
        };
        tokio::time::timeout(self.timeout, io)
            .await
            .map_err(|_| DaemonError::Timeout)?
    }

    async fn call<T: DeserializeOwned>(
        &self,
        op: DaemonOp,
        extra: Value,
    ) -> Result<T, DaemonError> {
        let (req_id, line) = self.request(op, extra);
        let reply = self.exchange(&line).await?;
        if reply.get("req_id").and_then(Value::as_str) != Some(req_id.as_str()) {
            return Err(DaemonError::Protocol);
        }
        if reply.get("ok").and_then(Value::as_bool) != Some(true) {
            let kind = reply
                .get("error_type")
                .and_then(Value::as_str)
                .unwrap_or("Unknown")
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
                .take(64)
                .collect();
            return Err(DaemonError::Rejected(kind));
        }
        serde_json::from_value(reply).map_err(|_| DaemonError::Protocol)
    }
}

impl DaemonClient for UnixDaemon {
    fn ping(&self) -> BoxFut<'_, Result<DaemonPing, DaemonError>> {
        Box::pin(self.call(DaemonOp::Ping, Value::Null))
    }

    fn summary_get(&self, max_age_s: Option<f64>) -> BoxFut<'_, Result<FleetSummary, DaemonError>> {
        let extra = max_age_s.map_or(Value::Null, |m| json!({ "max_age_s": m }));
        Box::pin(self.call(DaemonOp::SummaryGet, extra))
    }

    fn fleet_status(&self) -> BoxFut<'_, Result<FleetStatus, DaemonError>> {
        Box::pin(self.call(DaemonOp::FleetStatus, Value::Null))
    }

    fn fleet_events(
        &self,
        since_ts: f64,
        limit: u32,
    ) -> BoxFut<'_, Result<FleetEvents, DaemonError>> {
        Box::pin(self.call(
            DaemonOp::FleetEvents,
            json!({ "since_ts": since_ts, "limit": limit }),
        ))
    }

    fn stats(&self) -> BoxFut<'_, Result<DaemonStats, DaemonError>> {
        Box::pin(self.call(DaemonOp::Stats, Value::Null))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::sync::Arc;
    use std::sync::Mutex as StdMutex;

    use tokio::net::UnixListener;

    use super::*;

    /// Every operation the daemon implements that the gateway must never send. Taken from
    /// `daemon.py:_dispatch`.
    const FORBIDDEN: &[&str] = &[
        "register",
        "unregister",
        "state_update",
        "summary_put",
        "acquire",
        "report_429",
        "report_order",
        "report_iso_breach",
        "tickers",
        "positions_put",
        "positions_get",
        "balances_put",
        "balances_get",
        "markets",
        "funding_rates",
        "leverage_tiers",
        "fetch",
    ];

    #[test]
    fn only_the_five_read_only_operations_exist() {
        // Exhaustive match without a wildcard: adding a variant stops this test from compiling
        // until it is looked at, and the wire name check below then has to be updated on purpose.
        fn allowed(op: DaemonOp) -> bool {
            match op {
                DaemonOp::Ping
                | DaemonOp::SummaryGet
                | DaemonOp::FleetStatus
                | DaemonOp::FleetEvents
                | DaemonOp::Stats => true,
            }
        }
        assert!(DaemonOp::ALL.iter().copied().all(allowed));
        let names: BTreeSet<&str> = DaemonOp::ALL.iter().map(|o| o.wire_name()).collect();
        let expected: BTreeSet<&str> = [
            "ping",
            "summary_get",
            "fleet_status",
            "fleet_events",
            "stats",
        ]
        .into_iter()
        .collect();
        assert_eq!(
            names, expected,
            "the allow list changed: this needs an explicit decision"
        );
        assert_eq!(DaemonOp::ALL.len(), 5);
        for name in &names {
            assert!(!FORBIDDEN.contains(name), "{name} is forbidden");
        }
    }

    #[test]
    fn no_forbidden_operation_name_appears_in_the_non_test_source() {
        let src = include_str!("ftcache.rs");
        let code = src.split("#[cfg(test)]").next().unwrap();
        for name in FORBIDDEN {
            let quoted = format!("\"{name}\"");
            let hits = code
                .lines()
                .filter(|l| !l.trim_start().starts_with("//"))
                .filter(|l| l.contains(&quoted))
                .count();
            assert_eq!(
                hits, 0,
                "operation {name} must not be spelled in the client"
            );
        }
    }

    #[test]
    fn parameters_cannot_override_the_operation() {
        let client = UnixDaemon::new("/nonexistent");
        let (id, line) = client.request(
            DaemonOp::SummaryGet,
            json!({ "op": "positions_get", "req_id": "x", "max_age_s": 30 }),
        );
        let v: Value = serde_json::from_slice(&line).unwrap();
        assert_eq!(v["op"], "summary_get");
        assert_eq!(v["req_id"], Value::String(id));
        assert_eq!(v["max_age_s"], 30);
        assert!(line.ends_with(b"\n"));
    }

    /// Fake daemon: records each request line and answers with `reply(op)`.
    struct Fake {
        path: PathBuf,
        seen: Arc<StdMutex<Vec<Value>>>,
        connections: Arc<AtomicU64>,
        _dir: tempfile::TempDir,
    }

    fn fake_daemon(reply: impl Fn(&Value) -> Option<Value> + Send + Sync + 'static) -> Fake {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ftcache.sock");
        let listener = UnixListener::bind(&path).unwrap();
        let seen = Arc::new(StdMutex::new(Vec::new()));
        let connections = Arc::new(AtomicU64::new(0));
        let (s, c) = (Arc::clone(&seen), Arc::clone(&connections));
        let reply = Arc::new(reply);
        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                c.fetch_add(1, Ordering::Relaxed);
                let (s, reply) = (Arc::clone(&s), Arc::clone(&reply));
                tokio::spawn(async move {
                    let (r, mut w) = stream.into_split();
                    let mut lines = BufReader::new(r).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        let req: Value = serde_json::from_str(&line).unwrap();
                        s.lock().unwrap().push(req.clone());
                        if let Some(mut resp) = reply(&req) {
                            if resp.get("req_id").is_none() {
                                resp["req_id"] = req["req_id"].clone();
                            }
                            let mut out = serde_json::to_vec(&resp).unwrap();
                            out.push(b'\n');
                            w.write_all(&out).await.unwrap();
                        }
                    }
                });
            }
        });
        Fake {
            path,
            seen,
            connections,
            _dir: dir,
        }
    }

    #[tokio::test]
    async fn ping_and_summary_round_trip() {
        let fake = fake_daemon(|req| match req["op"].as_str().unwrap() {
            "ping" => Some(json!({"ok": true, "daemon_version": 2, "uptime_s": 12.5})),
            "summary_get" => Some(json!({
                "ok": true, "ts": 1_792_000_000.5, "bot_count": 1,
                "bots": {"hippo_a": {
                    "bot_name": "hippo_a", "state": "State.RUNNING", "dry_run": false,
                    "open_trade_count": 3, "closed_profit_abs": 12.5, "open_profit_abs": -1.25,
                    "age_s": 2.5, "api_port": 9056, "unknown_future_field": [1, 2]
                }}
            })),
            _ => None,
        });
        let client = UnixDaemon::new(&fake.path);
        let ping = client.ping().await.unwrap();
        assert_eq!(ping.daemon_version, Some(2));
        let summary = client.summary_get(Some(60.0)).await.unwrap();
        let d = &summary.bots["hippo_a"];
        assert_eq!(d.api_port, Some(9056));
        assert_eq!(d.open_trade_count, Some(3));
        assert_eq!(d.open_profit_abs, Some(-1.25));
        assert_eq!(d.age_s, Some(2.5));
        let seen = fake.seen.lock().unwrap();
        assert_eq!(seen[1]["op"], "summary_get");
        assert_eq!(seen[1]["max_age_s"], 60.0);
        assert_eq!(
            fake.connections.load(Ordering::Relaxed),
            2,
            "one ephemeral connection per call"
        );
    }

    #[tokio::test]
    async fn fleet_status_events_and_stats_parse_the_daemon_shapes() {
        let fake = fake_daemon(|req| match req["op"].as_str().unwrap() {
            "fleet_status" => Some(json!({
                "ok": true,
                "daemon": {"uptime_s": 100.0, "socket_path": "/tmp/x.sock", "active_connections": 25,
                           "total_series": 900, "total_events": 12},
                "bots": [{"bot_id": "a", "config_file": "a.json", "exchange": "hyperliquid",
                          "trading_mode": "futures", "api_port": 9056, "pid": 4242, "state": "running",
                          "uptime_s": 5.0, "last_heartbeat_ago_s": 0.5}],
                "rate_limiters": {"hyperliquid": {"tokens_available": 40.0, "tokens_max": 100.0,
                    "weight_mode": true, "backoff_active": false, "shed_count": 0,
                    "weight_used_last_min": 300.0, "weight_budget_per_min": 1200.0}},
                "recent_events_count": {"rate_limited": 2}
            })),
            "fleet_events" => Some(json!({"ok": true, "events": [
                {"ts": 1.5, "event_type": "bot_crash", "bot_id": "a", "details": {"reason": "connection_lost"}}]})),
            "stats" => Some(json!({
                "ok": true, "uptime_s": 9.0, "active_clients": 25, "requests_total": 1000,
                "cache_hits": 100, "cache_swr": 800, "cache_partial": 50, "cache_misses": 50,
                "hyperliquid": {"tokens_available": 40.0, "backoff_active": false}
            })),
            _ => None,
        });
        let client = UnixDaemon::new(&fake.path);

        let status = client.fleet_status().await.unwrap();
        assert_eq!(status.bots[0].api_port, Some(9056));
        assert_eq!(status.daemon.active_connections, Some(25));
        let hl = &status.rate_limiters["hyperliquid"];
        assert!(
            (hl.available_pct().unwrap() - 75.0).abs() < 1e-9,
            "weight mode wins"
        );
        assert_eq!(status.recent_events_count["rate_limited"], 2);

        let ev = client.fleet_events(1.0, 50).await.unwrap();
        assert_eq!(ev.events[0].event_type, "bot_crash");
        assert_eq!(ev.events[0].details["reason"], "connection_lost");
        let sent = fake
            .seen
            .lock()
            .unwrap()
            .iter()
            .find(|r| r["op"] == "fleet_events")
            .cloned()
            .unwrap();
        assert_eq!(sent["since_ts"], 1.0);
        assert_eq!(sent["limit"], 50);

        let stats = client.stats().await.unwrap();
        assert!(
            (stats.hit_rate().unwrap() - 0.95).abs() < 1e-9,
            "swr and partial count as served from cache"
        );
        assert_eq!(
            stats.exchanges().keys().collect::<Vec<_>>(),
            ["hyperliquid"]
        );
    }

    #[tokio::test]
    async fn every_request_on_the_wire_is_in_the_allow_list() {
        let fake = fake_daemon(|_| Some(json!({"ok": true})));
        let client = UnixDaemon::new(&fake.path);
        client.ping().await.unwrap();
        client.summary_get(None).await.unwrap();
        client.fleet_status().await.unwrap();
        client.fleet_events(0.0, 10).await.unwrap();
        client.stats().await.unwrap();
        let wire: BTreeSet<String> = fake
            .seen
            .lock()
            .unwrap()
            .iter()
            .map(|r| r["op"].as_str().unwrap().to_owned())
            .collect();
        let allowed: BTreeSet<String> = DaemonOp::ALL
            .iter()
            .map(|o| o.wire_name().to_owned())
            .collect();
        assert_eq!(wire, allowed);
        assert!(FORBIDDEN.iter().all(|f| !wire.contains(*f)));
    }

    #[tokio::test]
    async fn failures_are_classified() {
        // No socket at all.
        let client = UnixDaemon::new("/tmp/definitely-not-a-socket-fg-test");
        assert_eq!(client.ping().await.unwrap_err(), DaemonError::Unavailable);

        // Daemon answers ok:false.
        let fake = fake_daemon(|_| {
            Some(json!({"ok": false, "error_type": "UnknownOp", "error_message": "secret detail"}))
        });
        let err = UnixDaemon::new(&fake.path).stats().await.unwrap_err();
        assert_eq!(err, DaemonError::Rejected("UnknownOp".into()));
        assert!(!err.to_string().contains("secret detail"));

        // Wrong req_id.
        let fake = fake_daemon(|_| Some(json!({"ok": true, "req_id": "someone-else"})));
        assert_eq!(
            UnixDaemon::new(&fake.path).ping().await.unwrap_err(),
            DaemonError::Protocol
        );

        // Garbage.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("g.sock");
        let listener = UnixListener::bind(&path).unwrap();
        tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 256];
            let _ = tokio::io::AsyncReadExt::read(&mut s, &mut buf).await;
            s.write_all(b"not json\n").await.unwrap();
        });
        assert_eq!(
            UnixDaemon::new(&path).ping().await.unwrap_err(),
            DaemonError::Protocol
        );
    }

    #[tokio::test]
    async fn a_silent_daemon_times_out() {
        let fake = fake_daemon(|_| None);
        let client = UnixDaemon::with_timeout(&fake.path, Duration::from_millis(150));
        assert_eq!(client.ping().await.unwrap_err(), DaemonError::Timeout);
    }

    #[tokio::test]
    async fn calls_are_serialised() {
        let active = Arc::new(AtomicU64::new(0));
        let peak = Arc::new(AtomicU64::new(0));
        let (a, p) = (Arc::clone(&active), Arc::clone(&peak));
        // The fake bumps the in-flight counter when it sees a request and drops it when it answers;
        // a serialised client never has two requests in flight.
        let fake = fake_daemon(move |_| {
            let now = a.fetch_add(1, Ordering::SeqCst) + 1;
            p.fetch_max(now, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(20));
            a.fetch_sub(1, Ordering::SeqCst);
            Some(json!({"ok": true}))
        });
        let client = Arc::new(UnixDaemon::new(&fake.path));
        let tasks: Vec<_> = (0..5)
            .map(|_| {
                let c = Arc::clone(&client);
                tokio::spawn(async move { c.ping().await })
            })
            .collect();
        for t in tasks {
            t.await.unwrap().unwrap();
        }
        assert_eq!(peak.load(Ordering::SeqCst), 1);
    }
}
