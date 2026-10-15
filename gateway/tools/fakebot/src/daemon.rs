//! A fake ftcache daemon on a Unix socket: NDJSON, one reply per request, `req_id` echoed.
//!
//! It answers the five read-only operations the gateway is allowed to send and records every
//! other operation name as rejected, so that a test can prove the gateway never sent one.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::task::JoinHandle;

use crate::api::{BotInfo, now_ms};

pub const ALLOWED_OPS: [&str; 5] = [
    "ping",
    "summary_get",
    "fleet_status",
    "fleet_events",
    "stats",
];

pub struct FakeDaemon {
    pub path: PathBuf,
    started: Instant,
    bots: Vec<BotInfo>,
    ops: Mutex<BTreeMap<String, u64>>,
    rejected: Mutex<Vec<String>>,
}

impl FakeDaemon {
    /// Bind the socket and serve in the background.
    ///
    /// # Errors
    /// The socket cannot be bound.
    pub fn start(path: &Path, bots: Vec<BotInfo>) -> std::io::Result<(Arc<Self>, JoinHandle<()>)> {
        let _ = std::fs::remove_file(path);
        let listener = UnixListener::bind(path)?;
        let me = Arc::new(Self {
            path: path.to_path_buf(),
            started: Instant::now(),
            bots,
            ops: Mutex::new(BTreeMap::new()),
            rejected: Mutex::new(Vec::new()),
        });
        let served = Arc::clone(&me);
        let task = tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    return;
                };
                let d = Arc::clone(&served);
                tokio::spawn(async move {
                    let (r, mut w) = stream.into_split();
                    let mut lines = BufReader::new(r).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        let reply = d.handle(&line);
                        let mut out = reply.to_string();
                        out.push('\n');
                        if w.write_all(out.as_bytes()).await.is_err() {
                            return;
                        }
                    }
                });
            }
        });
        Ok((me, task))
    }

    #[must_use]
    pub fn op_counts(&self) -> BTreeMap<String, u64> {
        self.ops.lock().map(|m| m.clone()).unwrap_or_default()
    }

    /// Operation names received that are not on the allow list.
    #[must_use]
    pub fn rejected(&self) -> Vec<String> {
        self.rejected.lock().map(|m| m.clone()).unwrap_or_default()
    }

    fn handle(&self, line: &str) -> Value {
        let req: Value = serde_json::from_str(line).unwrap_or(Value::Null);
        let op = req
            .get("op")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let req_id = req.get("req_id").cloned().unwrap_or(Value::Null);
        if !ALLOWED_OPS.contains(&op.as_str()) {
            if let Ok(mut r) = self.rejected.lock() {
                r.push(op);
            }
            return json!({"ok": false, "req_id": req_id, "error_type": "UnknownOp"});
        }
        if let Ok(mut m) = self.ops.lock() {
            *m.entry(op.clone()).or_insert(0) += 1;
        }
        let uptime = self.started.elapsed().as_secs_f64();
        let mut reply = match op.as_str() {
            "ping" => json!({"daemon_version": 2, "uptime_s": uptime}),
            "summary_get" => {
                let bots: serde_json::Map<String, Value> = self
                    .bots
                    .iter()
                    .map(|b| {
                        (
                            b.name.clone(),
                            json!({
                                "bot_name": b.name,
                                "state": "running",
                                "dry_run": !b.live,
                                "exchange": "hyperliquid",
                                "strategy": "FakeStrategy",
                                "stake_currency": "USDC",
                                "trading_mode": "futures",
                                "open_trade_count": 3,
                                "max_open_trades": 3,
                                "balance_total": b.capital,
                                "wallet_age_s": 2.0,
                                "age_s": 1.0,
                                "api_port": b.port,
                            }),
                        )
                    })
                    .collect();
                json!({"ts": now_ms() as f64 / 1000.0, "bots": bots})
            }
            "fleet_status" => {
                let bots: Vec<Value> = self
                    .bots
                    .iter()
                    .map(|b| {
                        json!({
                            "bot_id": b.name,
                            "exchange": "hyperliquid",
                            "trading_mode": "futures",
                            "strategy": "FakeStrategy",
                            "timeframe": "15m",
                            "pairs_count": 12,
                            "dry_run": !b.live,
                            "api_port": b.port,
                            "pid": 1000 + b.port,
                            "state": "running",
                            "uptime_s": uptime,
                            "last_heartbeat_ago_s": 1.0,
                        })
                    })
                    .collect();
                json!({
                    "daemon": {
                        "uptime_s": uptime,
                        "active_connections": self.bots.len(),
                        "total_series": 1200,
                        "total_events": 0,
                    },
                    "bots": bots,
                    "rate_limiters": {"hyperliquid": {
                        "tokens_available": 900.0, "tokens_max": 1000.0, "weight_mode": false,
                        "backoff_active": false, "shed_count": 0, "backoff_count": 0,
                    }},
                    "recent_events_count": {},
                })
            }
            "fleet_events" => json!({"events": []}),
            _ => json!({
                "uptime_s": uptime,
                "active_clients": self.bots.len(),
                "requests_total": 1000,
                "cache_hits": 900,
                "cache_misses": 10,
                "hyperliquid": {"tokens_available": 900.0, "tokens_max": 1000.0},
            }),
        };
        if let Some(o) = reply.as_object_mut() {
            o.insert("ok".into(), json!(true));
            o.insert("req_id".into(), req_id);
        }
        reply
    }
}
