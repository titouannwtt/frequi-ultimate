//! In-memory fakes of every source, for tests of the engine on tokio's virtual time.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use fg_core::model::Ticker;
use fg_sources::botrest::{
    BotFeatures, ProxyRequest, ProxyResponse, ReadEndpoint, RestError, WriteAction, WriteOutcome,
};
use fg_sources::botws::{WsAuth, WsEvent, WsHandle, WsTarget, WsTopic};
use fg_sources::discovery::{
    ApiCredentials, ApiServerInfo, BotConfig, ConfigStamp, DiscoveredBot, DiscoveryReport,
    ExchangeInfo,
};
use fg_sources::external::TickerError;
use fg_sources::ftcache::{
    DaemonError, DaemonPing, DaemonStats, FleetEvents, FleetStatus, FleetSummary,
};
use fg_sources::sensitive::Secret;
use fg_sources::sqlite::{
    LedgerError, LedgerErrorCode, LedgerOrder, LedgerProbe, LedgerSchema, LedgerStat,
    LedgerSummary, LedgerTrade, ProfitChunk, ProfitSample, TradeQuery,
};
use fg_sources::traits::{
    BotRest, BotWs, BoxFut, DaemonClient, Discovery, LedgerReader, TickerSource,
};
use serde_json::{Value, json};
use tokio::sync::mpsc;
use tokio::time::Instant;

use crate::connector::{BotConnector, BotLink};

// ---------------------------------------------------------------- discovery

pub struct FakeDiscovery {
    pub bots: Mutex<Vec<DiscoveredBot>>,
}

impl Discovery for FakeDiscovery {
    fn scan(&self) -> DiscoveryReport {
        DiscoveryReport {
            bots: self.bots.lock().unwrap().clone(),
            issues: Vec::new(),
        }
    }
}

pub const FAKE_WALLET: &str = "0xAB12eeeeeeeeeeeeeeeeeeeeeeeeeeee9876";

/// A bot as discovery would report it. `wallet` makes it share an account with other bots.
pub fn discovered(
    port: u16,
    name: &str,
    live: bool,
    wallet: Option<&str>,
    capital: Option<f64>,
) -> DiscoveredBot {
    DiscoveredBot {
        pid: u32::from(port),
        process_start_ms: Some(1_700_000_000_000),
        cwd: PathBuf::from("/fake"),
        config_files: vec![],
        config_name: format!("{name}.json"),
        config: BotConfig {
            bot_name: Some(name.to_owned()),
            strategy: Some("S".into()),
            db_url: None,
            dry_run: Some(!live),
            stake_currency: Some("USDC".into()),
            available_capital: capital,
            capital_withdrawal: 0.0,
            max_open_trades: Some(3),
            api: ApiServerInfo {
                listen_ip: "127.0.0.1".into(),
                listen_port: Some(port),
                credentials: Some(ApiCredentials {
                    username: Secret::new("u"),
                    password: Secret::new("p"),
                }),
                jwt_fingerprint: None,
                ws_token: None,
            },
            exchange: ExchangeInfo {
                name: Some("hyperliquid".into()),
                trading_mode: Some("futures".into()),
                wallet: wallet.map(Secret::new),
                vault: None,
                hip3_dexes: vec![],
            },
        },
        db_path: Some(PathBuf::from(format!("/fake/db/{name}.sqlite"))),
        db_ignored: false,
        stamp: ConfigStamp::default(),
    }
}

// ---------------------------------------------------------------- bots

#[derive(Debug, Clone)]
pub enum Mode {
    Up,
    /// Every call fails with this error.
    Fail(RestError),
}

pub struct FakeBotState {
    pub mode: Mode,
    pub ping_ok: bool,
    pub status: Value,
    pub balance: Value,
    pub logs: Value,
    pub whitelist: Value,
    pub write_result: Result<WriteOutcome, RestError>,
    pub write_delay: Duration,
    /// Body of `GET /pair_candles` (status 200), or `None` for a 404.
    pub candles: Option<Vec<u8>>,
}

pub struct FakeBot {
    pub port: u16,
    pub state: Mutex<FakeBotState>,
    pub calls: Mutex<Vec<(Instant, String)>>,
    pub writes: Mutex<Vec<(String, String)>>,
}

impl FakeBot {
    pub fn new(port: u16) -> Arc<Self> {
        Arc::new(Self {
            port,
            state: Mutex::new(FakeBotState {
                mode: Mode::Up,
                ping_ok: true,
                status: json!([]),
                balance: json!({"total": 1000.0, "total_bot": 1000.0, "starting_capital": 1000.0}),
                logs: json!({"log_count": 0, "logs": []}),
                whitelist: json!({"whitelist": ["BTC/USDC:USDC"]}),
                write_result: Ok(WriteOutcome {
                    status: 200,
                    body: json!({"result": "ok"}),
                    latency_ms: 3,
                }),
                write_delay: Duration::ZERO,
                candles: None,
            }),
            calls: Mutex::new(Vec::new()),
            writes: Mutex::new(Vec::new()),
        })
    }

    fn note(&self, what: &str) {
        self.calls
            .lock()
            .unwrap()
            .push((Instant::now(), what.to_owned()));
    }

    pub fn call_count(&self) -> usize {
        self.calls.lock().unwrap().len()
    }

    pub fn calls_of(&self, what: &str) -> Vec<Instant> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, w)| w == what)
            .map(|(t, _)| *t)
            .collect()
    }

    pub fn set_mode(&self, mode: Mode) {
        self.state.lock().unwrap().mode = mode;
    }
}

fn label(ep: ReadEndpoint) -> &'static str {
    match ep {
        ReadEndpoint::Status => "status",
        ReadEndpoint::Logs { .. } => "logs",
        ReadEndpoint::Balance => "balance",
        ReadEndpoint::Whitelist => "whitelist",
        ReadEndpoint::Blacklist => "blacklist",
        ReadEndpoint::Locks => "locks",
        ReadEndpoint::Profit => "profit",
        ReadEndpoint::ProfitAll => "profit_all",
        ReadEndpoint::Count => "count",
        ReadEndpoint::Trades { .. } => "trades",
        ReadEndpoint::ShowConfig => "show_config",
        ReadEndpoint::Version => "version",
        ReadEndpoint::Health => "health",
    }
}

impl BotRest for FakeBot {
    fn ping(&self) -> BoxFut<'_, Result<(), RestError>> {
        self.note("ping");
        let ok = self.state.lock().unwrap().ping_ok;
        Box::pin(async move { if ok { Ok(()) } else { Err(RestError::Refused) } })
    }

    fn read(&self, endpoint: ReadEndpoint) -> BoxFut<'_, Result<Value, RestError>> {
        self.note(label(endpoint));
        let st = self.state.lock().unwrap();
        let res = match &st.mode {
            Mode::Fail(e) => Err(e.clone()),
            Mode::Up => Ok(match endpoint {
                ReadEndpoint::Status => st.status.clone(),
                ReadEndpoint::Balance => st.balance.clone(),
                ReadEndpoint::Logs { .. } => st.logs.clone(),
                ReadEndpoint::Whitelist => st.whitelist.clone(),
                ReadEndpoint::Blacklist => json!({"blacklist": []}),
                ReadEndpoint::Locks => json!({"locks": []}),
                _ => json!({}),
            }),
        };
        Box::pin(async move { res })
    }

    fn features(&self) -> BoxFut<'_, Result<BotFeatures, RestError>> {
        self.note("features");
        let res = match &self.state.lock().unwrap().mode {
            Mode::Fail(e) => Err(e.clone()),
            Mode::Up => Ok(BotFeatures {
                version: Some("2026.9".into()),
                trading_mode: Some("futures".into()),
                max_open_trades: Some(3),
                fleet_endpoints: true,
                ..BotFeatures::default()
            }),
        };
        Box::pin(async move { res })
    }

    fn proxy(&self, req: ProxyRequest) -> BoxFut<'_, Result<ProxyResponse, RestError>> {
        self.note(&format!(
            "proxy {} {}?{}",
            req.method.as_str(),
            req.path,
            req.query.clone().unwrap_or_default()
        ));
        let st = self.state.lock().unwrap();
        let res = match (&st.mode, req.path.as_str(), &st.candles) {
            (Mode::Fail(e), _, _) => Err(e.clone()),
            (Mode::Up, "/pair_candles", Some(body)) => Ok(ProxyResponse {
                status: 200,
                content_type: Some("application/json".into()),
                body: body.clone(),
                latency_ms: 2,
            }),
            _ => Err(RestError::NotFound),
        };
        Box::pin(async move { res })
    }

    fn write(
        &self,
        action: WriteAction,
        idempotency_key: String,
    ) -> BoxFut<'_, Result<WriteOutcome, RestError>> {
        self.writes
            .lock()
            .unwrap()
            .push((idempotency_key, action.name().to_owned()));
        let (res, delay) = {
            let st = self.state.lock().unwrap();
            (st.write_result.clone(), st.write_delay)
        };
        Box::pin(async move {
            if !delay.is_zero() {
                tokio::time::sleep(delay).await;
            }
            res
        })
    }
}

struct NoAuth;

impl WsAuth for NoAuth {
    fn ws_token(&self) -> BoxFut<'_, Option<Secret>> {
        Box::pin(async { Some(Secret::new("t")) })
    }
}

/// Hands out the fake bots and a detached WebSocket per bot.
pub struct FakeNet {
    pub bots: Mutex<HashMap<u16, Arc<FakeBot>>>,
    ws_senders: Mutex<HashMap<String, mpsc::Sender<WsEvent>>>,
    pub connects: Mutex<Vec<String>>,
}

impl FakeNet {
    pub fn new(bots: &[Arc<FakeBot>]) -> Arc<Self> {
        Arc::new(Self {
            bots: Mutex::new(bots.iter().map(|b| (b.port, Arc::clone(b))).collect()),
            ws_senders: Mutex::new(HashMap::new()),
            connects: Mutex::new(Vec::new()),
        })
    }

    /// Push an event on the WebSocket of a bot (it must be connected).
    pub async fn push(&self, port: u16, ev: WsEvent) {
        let tx = self
            .ws_senders
            .lock()
            .unwrap()
            .get(&port.to_string())
            .cloned()
            .expect("websocket not connected");
        tx.send(ev).await.unwrap();
    }

    pub fn connected(&self, port: u16) -> bool {
        self.ws_senders
            .lock()
            .unwrap()
            .contains_key(&port.to_string())
    }
}

impl BotConnector for FakeNet {
    fn link(&self, bot: &DiscoveredBot) -> Option<BotLink> {
        let port = bot.config.api.listen_port?;
        let fake = Arc::clone(self.bots.lock().unwrap().get(&port)?);
        Some(BotLink {
            rest: fake,
            ws: Some(WsTarget {
                base: "ws://fake".into(),
                auth: Arc::new(NoAuth),
                label: port.to_string(),
            }),
        })
    }
}

impl BotWs for FakeNet {
    fn connect(&self, target: WsTarget, _topics: Vec<WsTopic>) -> WsHandle {
        let (tx, rx) = mpsc::channel(256);
        self.ws_senders
            .lock()
            .unwrap()
            .insert(target.label.clone(), tx.clone());
        self.connects.lock().unwrap().push(target.label.clone());
        let _ = tx.try_send(WsEvent::Connected);
        let (handle, _topics) = WsHandle::detached(rx);
        handle
    }
}

// ---------------------------------------------------------------- ledgers

#[derive(Default, Clone)]
pub struct FakeDb {
    pub generation: u64,
    pub trades: Vec<LedgerTrade>,
    pub orders: Vec<LedgerOrder>,
    pub profit: Vec<ProfitSample>,
    pub fail: Option<LedgerErrorCode>,
    pub stats: usize,
    /// Full scans of the trades (`summary`); `probe` does not count.
    pub summaries: usize,
    /// Read passes (`probe`).
    pub probes: usize,
}

#[derive(Default)]
pub struct FakeLedger {
    pub dbs: Mutex<HashMap<PathBuf, FakeDb>>,
}

impl FakeLedger {
    pub fn with(&self, path: &Path, f: impl FnOnce(&mut FakeDb)) {
        let mut dbs = self.dbs.lock().unwrap();
        let db = dbs.entry(path.to_path_buf()).or_default();
        f(db);
        db.generation += 1;
    }

    fn get<T>(&self, path: &Path, f: impl FnOnce(&mut FakeDb) -> T) -> Result<T, LedgerError> {
        let mut dbs = self.dbs.lock().unwrap();
        let db = dbs
            .get_mut(path)
            .ok_or(LedgerError(LedgerErrorCode::DbMissing))?;
        if let Some(code) = db.fail {
            return Err(LedgerError(code));
        }
        Ok(f(db))
    }
}

pub fn open_trade(id: i64, pair: &str, short: bool, open_ms: i64) -> LedgerTrade {
    LedgerTrade {
        id,
        pair: pair.into(),
        is_short: short,
        is_open: true,
        amount: 2.0,
        stake_amount: 100.0,
        open_rate: 100.0,
        close_rate: None,
        leverage: 2.0,
        open_ms: Some(open_ms),
        close_ms: None,
        profit_abs: None,
        profit_ratio: None,
        profit_unknown: false,
        exit_reason: None,
        enter_tag: None,
        stop_loss: Some(90.0),
        initial_stop_loss: None,
        liquidation_price: Some(60.0),
        funding_fees: None,
        realized_profit: None,
        strategy: None,
    }
}

pub fn closed_trade(id: i64, pair: &str, open_ms: i64, close_ms: i64, profit: f64) -> LedgerTrade {
    LedgerTrade {
        is_open: false,
        close_ms: Some(close_ms),
        close_rate: Some(101.0),
        profit_abs: Some(profit),
        profit_ratio: Some(profit / 100.0),
        exit_reason: Some("roi".into()),
        ..open_trade(id, pair, false, open_ms)
    }
}

impl LedgerReader for FakeLedger {
    fn stat(&self, db: &Path) -> Result<LedgerStat, LedgerError> {
        self.get(db, |d| {
            d.stats += 1;
            LedgerStat {
                db_size: d.generation,
                db_mtime_ms: i64::try_from(d.generation).unwrap_or(0),
                db_inode: 1,
                wal_size: Some(0),
                wal_mtime_ms: Some(0),
            }
        })
    }

    fn schema(&self, _db: &Path) -> Result<LedgerSchema, LedgerError> {
        Ok(LedgerSchema::default())
    }

    fn probe(&self, db: &Path) -> Result<LedgerProbe, LedgerError> {
        self.get(db, |d| {
            d.probes += 1;
            LedgerProbe {
                open_count: d.trades.iter().filter(|t| t.is_open).count() as i64,
                closed_count: d.trades.iter().filter(|t| !t.is_open).count() as i64,
                max_trade_id: d.trades.iter().map(|t| t.id).max().unwrap_or(0),
            }
        })
    }

    fn summary(&self, db: &Path) -> Result<LedgerSummary, LedgerError> {
        self.get(db, |d| {
            d.summaries += 1;
            let closed: Vec<_> = d.trades.iter().filter(|t| !t.is_open).collect();
            LedgerSummary {
                open_count: d.trades.iter().filter(|t| t.is_open).count() as i64,
                closed_count: closed.len() as i64,
                realized_total: closed.iter().filter_map(|t| t.profit_abs).sum(),
                profit_unknown_count: closed.iter().filter(|t| t.profit_abs.is_none()).count()
                    as i64,
                first_open_ms: d.trades.iter().filter_map(|t| t.open_ms).min(),
                last_open_ms: d.trades.iter().filter_map(|t| t.open_ms).max(),
                last_close_ms: closed.iter().filter_map(|t| t.close_ms).max(),
                max_trade_id: d.trades.iter().map(|t| t.id).max().unwrap_or(0),
                direction_count: 1,
                any_short: d.trades.iter().any(|t| t.is_short),
            }
        })
    }

    fn trades(&self, db: &Path, q: &TradeQuery) -> Result<Vec<LedgerTrade>, LedgerError> {
        self.get(db, |d| {
            d.trades
                .iter()
                .filter(|t| q.open.is_none_or(|o| t.is_open == o))
                .filter(|t| q.after_id.is_none_or(|a| t.id > a))
                .filter(|t| {
                    q.touched_since_ms.is_none_or(|s| {
                        t.is_open || t.close_ms.unwrap_or(0) >= s || t.open_ms.unwrap_or(0) >= s
                    })
                })
                .cloned()
                .collect()
        })
    }

    fn orders(&self, db: &Path, trade_ids: &[i64]) -> Result<Vec<LedgerOrder>, LedgerError> {
        self.get(db, |d| {
            d.orders
                .iter()
                .filter(|o| trade_ids.contains(&o.trade_id))
                .cloned()
                .collect()
        })
    }

    fn profit_history(&self, db: &Path, after_rowid: i64) -> Result<ProfitChunk, LedgerError> {
        self.get(db, |d| {
            let max = d.profit.iter().map(|p| p.rowid).max().unwrap_or(0);
            let reset = after_rowid > max;
            let from = if reset { 0 } else { after_rowid };
            ProfitChunk {
                samples: d
                    .profit
                    .iter()
                    .filter(|p| p.rowid > from)
                    .copied()
                    .collect(),
                max_rowid: max,
                reset,
                truncated: false,
            }
        })
    }
}

// ---------------------------------------------------------------- daemon

#[derive(Default)]
pub struct FakeDaemon {
    pub summary: Mutex<FleetSummary>,
    pub status: Mutex<FleetStatus>,
    pub events: Mutex<FleetEvents>,
    pub down: Mutex<bool>,
    pub calls: Mutex<Vec<(Instant, &'static str)>>,
}

impl FakeDaemon {
    fn note(&self, op: &'static str) -> Result<(), DaemonError> {
        self.calls.lock().unwrap().push((Instant::now(), op));
        if *self.down.lock().unwrap() {
            Err(DaemonError::Unavailable)
        } else {
            Ok(())
        }
    }

    pub fn count(&self, op: &str) -> usize {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, o)| *o == op)
            .count()
    }
}

impl DaemonClient for FakeDaemon {
    fn ping(&self) -> BoxFut<'_, Result<DaemonPing, DaemonError>> {
        let r = self.note("ping").map(|()| DaemonPing::default());
        Box::pin(async move { r })
    }

    fn summary_get(
        &self,
        _max_age_s: Option<f64>,
    ) -> BoxFut<'_, Result<FleetSummary, DaemonError>> {
        let r = self
            .note("summary_get")
            .map(|()| self.summary.lock().unwrap().clone());
        Box::pin(async move { r })
    }

    fn fleet_status(&self) -> BoxFut<'_, Result<FleetStatus, DaemonError>> {
        let r = self
            .note("fleet_status")
            .map(|()| self.status.lock().unwrap().clone());
        Box::pin(async move { r })
    }

    fn fleet_events(
        &self,
        _since: f64,
        _limit: u32,
    ) -> BoxFut<'_, Result<FleetEvents, DaemonError>> {
        let r = self
            .note("fleet_events")
            .map(|()| self.events.lock().unwrap().clone());
        Box::pin(async move { r })
    }

    fn stats(&self) -> BoxFut<'_, Result<DaemonStats, DaemonError>> {
        let r = self.note("stats").map(|()| DaemonStats::default());
        Box::pin(async move { r })
    }
}

pub struct FakeTicker;

impl TickerSource for FakeTicker {
    fn tickers(&self) -> BoxFut<'_, Result<Vec<Ticker>, TickerError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
}
