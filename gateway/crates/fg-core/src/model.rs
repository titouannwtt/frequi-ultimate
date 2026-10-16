//! Domain entities (03 section 6.1). Types are exported to TypeScript by `ts_export`.
//!
//! Conventions: timestamps are integer milliseconds (UTC), money is in the bot's stake currency
//! (USDC on this fleet), ratios are plain ratios (0.05 = 5 %) unless a field name says `pct`.
//! A value that is unknown is `None`, never an invented default.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::alerts::rules::LogLine;
use crate::calc::drawdown::DrawdownValue;
use crate::calc::exit_reason::ExitReason;
use crate::calc::hip3::Market;
use crate::identity::BotKey;

/// Alert and health severity, ordered from least to most severe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Info,
    Warning,
    Critical,
}

/// Direction of a position.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    Long,
    Short,
}

impl Side {
    #[must_use]
    pub fn from_is_short(is_short: bool) -> Self {
        if is_short { Self::Short } else { Self::Long }
    }
}

/// Trading mode of a bot. Live money is never summed with dry or replay figures.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum BotMode {
    Live,
    Dry,
    Replay,
}

/// Lifecycle state of a bot as seen by the scheduler.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum BotStatus {
    Online,
    Starting,
    Offline,
    /// Process absent but its database is still present (orphan ledger).
    Stopped,
    AuthExpired,
}

/// Where a figure came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum FreshnessSource {
    Digest,
    Sqlite,
    Ws,
    Rest,
    Python,
}

/// Age metadata attached to every group of figures: a stale value is never shown as current and
/// never added to a sum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Freshness {
    pub as_of_ms: i64,
    pub source: FreshnessSource,
    pub stale: bool,
}

/// Field groups of a [`BotRow`] that carry their own freshness.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum FreshnessGroup {
    State,
    Metrics,
    Positions,
    Capital,
    Alerts,
}

/// Static identity of a bot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct BotIdentity {
    pub name: String,
    pub icon: Option<String>,
    pub mode: BotMode,
    pub strategy: Option<String>,
    pub exchange: Option<String>,
    pub market: Market,
    pub stake_currency: String,
    pub port: Option<u16>,
    /// `ftbot.N` aliases of this bot on the requesting device.
    pub ui_ids: Vec<String>,
    /// See [`crate::identity::incarnation`].
    pub incarnation: String,
}

/// Dynamic state of a bot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct BotStateInfo {
    pub status: BotStatus,
    pub since_ms: Option<i64>,
    /// Bots sharing a wallet share this id; wallet-level figures are never summed per bot.
    pub wallet_id: Option<String>,
    pub open_trades: u32,
    pub max_open_trades: Option<u32>,
    /// Date of the first real (non seeded) trade, for the "since" label of seeded dry bots.
    pub first_real_trade_ms: Option<i64>,
    /// Date the bot was launched.
    pub started_ms: Option<i64>,
}

/// Figures of a bot. Realised profits are in stake currency.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
pub struct BotMetrics {
    /// Realized profit of the calendar day of the configured zone (since its local midnight),
    /// never the last 24 hours.
    pub realized_1d: Option<f64>,
    pub realized_7d: Option<f64>,
    pub realized_30d: Option<f64>,
    pub realized_total: Option<f64>,
    /// Latent profit of the open positions (not stale ones).
    pub open_profit_abs: Option<f64>,
    /// `available_capital - capital_withdrawal`, see [`crate::calc::capital`].
    pub starting_capital: Option<f64>,
    pub exposure_long: Option<f64>,
    pub exposure_short: Option<f64>,
    pub drawdown_realized: Option<DrawdownValue>,
    pub drawdown_with_open: Option<DrawdownValue>,
    pub last_trade_ms: Option<i64>,
    pub trades_closed: Option<u32>,
    pub winrate: Option<f64>,
    /// 24 hourly samples of the latent profit, oldest first.
    pub spark24h: Vec<f64>,
}

/// Count and worst severity of the active alerts of a bot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
pub struct AlertSummary {
    pub count: u32,
    pub max_severity: Option<Severity>,
}

/// One row of the fleet table. Groups are merged shallowly by upserts (03 section 6.2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct BotRow {
    pub bot_key: BotKey,
    pub identity: BotIdentity,
    pub state: BotStateInfo,
    pub metrics: BotMetrics,
    pub alerts: AlertSummary,
    pub freshness: BTreeMap<FreshnessGroup, Freshness>,
}

/// An open position. Keyed by `bot_key/trade_id`: `trade_id` is only unique per bot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct Position {
    pub bot_key: BotKey,
    pub trade_id: i64,
    pub pair: String,
    /// Net-exposure key, see [`crate::calc::hip3::PairInfo::coin_key`].
    pub coin: String,
    pub market: Market,
    pub side: Side,
    pub leverage: f64,
    pub amount: f64,
    pub stake_amount: f64,
    pub notional: f64,
    pub open_rate: f64,
    pub current_rate: Option<f64>,
    pub profit_abs: Option<f64>,
    pub profit_ratio: Option<f64>,
    pub stoploss_abs: Option<f64>,
    pub liquidation_price: Option<f64>,
    /// Distance from the current rate to the liquidation price, in percent of the rate.
    pub liq_distance_pct: Option<f64>,
    /// Filled entry orders of the position, the first entry included (freqtrade's
    /// `nr_of_successful_entries`): 3 means the entry plus two safety orders.
    pub dca_entries: u32,
    pub open_ms: i64,
    pub duration_ms: i64,
    /// Rank of the duration among the bot's closed trades (0-100), see [`crate::calc::duration`].
    pub percentile: Option<u8>,
    /// A position found on the wallet that no bot database owns.
    pub orphan: bool,
    pub freshness: Freshness,
}

/// A row of the trade journal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct TradeRow {
    pub bot_key: BotKey,
    pub trade_id: i64,
    pub pair: String,
    pub market: Market,
    pub side: Side,
    pub mode: BotMode,
    pub leverage: f64,
    pub open_ms: i64,
    pub close_ms: Option<i64>,
    pub open_rate: f64,
    pub close_rate: Option<f64>,
    pub amount: f64,
    pub stake_amount: f64,
    pub profit_abs: Option<f64>,
    pub profit_ratio: Option<f64>,
    /// `profit_abs` was null in the database: counted apart, never replaced by an invented value.
    pub profit_unknown: bool,
    pub exit_reason: ExitReason,
    pub enter_tag: Option<String>,
    /// Closed by a human through the UI (from the audit trail).
    pub manual: bool,
}

/// Reconciliation status of a wallet against the exchange.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ReconStatus {
    Ok,
    Mismatch,
    Unknown,
}

/// Summary of the last reconciliation sweep of a wallet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ReconSummary {
    pub status: ReconStatus,
    /// Positions known to a bot but absent on the exchange.
    pub ghosts: u32,
    /// Positions on the exchange that no bot owns.
    pub orphans: u32,
    pub checked_ms: i64,
}

/// A wallet shared by one or more bots.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct WalletRow {
    pub wallet_id: String,
    /// Abbreviated address (`0xAbCd...1234`); the full address never leaves the server.
    pub address_short: String,
    pub bots: Vec<BotKey>,
    /// Wallet-level equity, counted once however many bots share the wallet.
    pub equity: Option<f64>,
    /// Signed notional per coin, longs minus shorts.
    pub net_exposure: BTreeMap<String, f64>,
    pub recon: Option<ReconSummary>,
    pub freshness: Freshness,
}

/// Overall health level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum HealthLevel {
    Ok,
    Degraded,
    Critical,
}

/// The stable machine codes of [`HealthReason::code`]. A client translates them; the text of a
/// reason is never part of the contract. `detail` carries only language-free values: a percentage
/// without its unit or sentence (`rate_budget_low`: the share still available, `20`), a count
/// (`rate_limit_events`: bots concerned), a ratio (`3/24`), names or codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum HealthReasonCode {
    /// The daemon (ftcache) did not answer three times in a row.
    DaemonUnreachable,
    /// The digest of the daemon is older than its limit.
    DigestStale,
    /// A rate limiter of the daemon is in backoff after a 429.
    RateBackoff,
    /// Less than 20 % of the request budget of the exchange is left. `detail`: the percentage left.
    RateBudgetLow,
    /// Every bot is offline. `detail`: `offline/total`.
    AllBotsOffline,
    /// Some bots are offline. `detail`: `offline/total` (the direct mode lists their names).
    BotsOffline,
    /// Some ledgers cannot be read. `detail`: `n (code n, ...)`.
    LedgerUnreadable,
    /// Bots met 429 recently. `detail`: how many bots.
    RateLimitEvents,
    /// Direct mode only: sessions expired. `detail`: the names of the bots.
    AuthExpired,
    /// Direct mode only: data older than its limit. `detail`: the names of the bots.
    DataStale,
}

impl HealthReasonCode {
    pub const ALL: [Self; 10] = [
        Self::DaemonUnreachable,
        Self::DigestStale,
        Self::RateBackoff,
        Self::RateBudgetLow,
        Self::AllBotsOffline,
        Self::BotsOffline,
        Self::LedgerUnreadable,
        Self::RateLimitEvents,
        Self::AuthExpired,
        Self::DataStale,
    ];

    /// The wire form.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DaemonUnreachable => "daemon_unreachable",
            Self::DigestStale => "digest_stale",
            Self::RateBackoff => "rate_backoff",
            Self::RateBudgetLow => "rate_budget_low",
            Self::AllBotsOffline => "all_bots_offline",
            Self::BotsOffline => "bots_offline",
            Self::LedgerUnreadable => "ledger_unreadable",
            Self::RateLimitEvents => "rate_limit_events",
            Self::AuthExpired => "auth_expired",
            Self::DataStale => "data_stale",
        }
    }
}

/// Why the health level is what it is.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct HealthReason {
    /// One of [`HealthReasonCode`] (a string on the wire: a client shows an unknown code as is).
    pub code: String,
    pub severity: Severity,
    pub detail: Option<String>,
    pub alert_id: Option<String>,
}

/// Infrastructure health (daemon budgets, backoff, digest age).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct Health {
    pub level: HealthLevel,
    pub reasons: Vec<HealthReason>,
    /// Share of the request budget of the exchange that is used (0 to 100), the most used limiter
    /// of the daemon. High is bad: `100 - rate_budget_pct` is what is left.
    pub rate_budget_pct: Option<f64>,
    pub backoff_active: bool,
    pub hit_rate: Option<f64>,
    pub bots_process: Option<u32>,
    pub digest_age_s: Option<f64>,
    pub freshness: Freshness,
}

/// Kind of an entry in the event feed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    EntryFill,
    ExitFill,
    EntryCancel,
    ExitCancel,
    ProtectionTrigger,
    Warning,
    Startup,
    StrategyMsg,
    DaemonIncident,
    AlertRaised,
    AlertResolved,
    BotOnline,
    BotOffline,
    BotReplaced,
    Action,
}

/// An entry of the event feed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct Event {
    pub kind: EventKind,
    pub ts_ms: i64,
    pub bot_key: Option<BotKey>,
    pub trade_id: Option<i64>,
    pub pair: Option<String>,
    pub profit_abs: Option<f64>,
    pub severity: Option<Severity>,
    pub detail: Option<String>,
}

/// An entry of the append-only audit trail of write actions. Never contains a token.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AuditEntry {
    pub ts_ms: i64,
    pub session_hash: String,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    pub bot_key: BotKey,
    pub bot_name: String,
    pub mode: BotMode,
    pub action: String,
    #[ts(type = "Record<string, unknown>")]
    pub params: serde_json::Map<String, serde_json::Value>,
    pub idempotency_key: String,
    pub http_status: Option<u16>,
    /// Truncated to 2 KB by the writer.
    pub response: Option<String>,
    pub latency_ms: Option<u64>,
}

/// Market ticker (BTC, ETH) from an external source, never from the exchange.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct Ticker {
    pub symbol: String,
    pub price: f64,
    pub change_24h_pct: Option<f64>,
    pub freshness: Freshness,
}

/// One candle of an open chart (collection `candles` of a `chart:` channel, keyed by `t`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct Candle {
    /// Open time, milliseconds.
    pub t: i64,
    pub o: f64,
    pub h: f64,
    pub l: f64,
    pub c: f64,
    pub v: f64,
}

/// What a `chart:` channel is about and how fresh it is (collection `chart`, key `meta`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ChartInfo {
    pub pair: String,
    pub timeframe: String,
    pub timeframe_ms: i64,
    /// Number of candles in the window.
    pub candles: u32,
    /// When the bot was last read for these candles. `stale` says the relay lost the bot.
    pub freshness: Freshness,
}

/// Per-device alias of a bot (`device_id -> ftbot.N -> bot_key`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct BotAlias {
    pub device_id: String,
    pub ui_id: String,
    pub bot_key: BotKey,
}

/// Totals of one trading mode (`live`, `dry`, `replay`). Live money is never summed with dry or
/// replay figures, so there is one scope per mode and no "all" scope. A bot whose figure is stale
/// or unknown is left out of the sum and counted in `excluded`, never counted as zero.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ScopeTotals {
    /// `live`, `dry` or `replay` (the key of the entity).
    pub scope: String,
    pub mode: BotMode,
    pub bots: u32,
    pub bots_online: u32,
    pub open_trades: u32,
    /// Sum of the bots' own `max_open_trades` that are known.
    pub max_open_trades: Option<u32>,
    pub realized_today: Option<f64>,
    /// Sum of the bots' `realized_1d`: the calendar day, like `realized_today`.
    pub realized_1d: Option<f64>,
    pub realized_7d: Option<f64>,
    pub realized_30d: Option<f64>,
    pub realized_total: Option<f64>,
    pub open_profit_abs: Option<f64>,
    /// Sum of the bots' starting capitals (`available_capital - capital_withdrawal`).
    pub starting_capital: Option<f64>,
    /// Bots whose starting capital is unknown: the sum above leaves them out.
    pub capital_unknown_bots: u32,
    /// Wallet-level equity, each wallet counted once however many bots share it.
    pub wallet_equity: Option<f64>,
    pub wallets: u32,
    /// Gross long and short notional before netting, and their difference.
    pub exposure_long: f64,
    pub exposure_short: f64,
    pub exposure_net: f64,
    pub drawdown_realized: Option<DrawdownValue>,
    pub drawdown_with_open: Option<DrawdownValue>,
    /// Keys of the bots left out of at least one sum because a figure was stale or unknown.
    pub excluded_bots: Vec<String>,
    pub alerts: AlertSummary,
    pub freshness: Freshness,
}

/// A pair lock of a bot (`/locks`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct PairLock {
    pub pair: String,
    pub reason: Option<String>,
    pub until_ms: Option<i64>,
    pub side: Option<String>,
}

/// Summary of the configuration of a bot as the REST API reports it.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
pub struct BotConfigSummary {
    pub version: Option<String>,
    pub api_version: Option<f64>,
    pub strategy: Option<String>,
    pub trading_mode: Option<String>,
    pub max_open_trades: Option<i64>,
    pub dry_run: Option<bool>,
    /// The bot exposes the `/fleet/*` endpoints of the fork.
    pub fleet_endpoints: bool,
}

/// Detail of one bot (channel `bot:<key>`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct BotDetail {
    pub whitelist: Vec<String>,
    pub blacklist: Vec<String>,
    pub locks: Vec<PairLock>,
    pub config: BotConfigSummary,
    /// Latest log lines (at most 100), oldest first.
    pub logs: Vec<LogLine>,
    pub freshness: Freshness,
}

/// What became of a write action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ActionStatus {
    /// The bot answered 2xx: the order was transmitted, not necessarily executed.
    Accepted,
    /// The bot (or the gateway) refused it; nothing was done.
    Rejected,
    /// The request may or may not have reached the bot: check on the bot, never assume.
    Unknown,
}

/// How to confirm the effect of an accepted or unknown action.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ActionVerify {
    pub expected_state: String,
    pub check_after_ms: u64,
}

/// Result of a write action.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ActionResult {
    pub status: ActionStatus,
    pub http_status: Option<u16>,
    /// Machine-readable reason of a rejection decided by the gateway (`state_mismatch`, ...).
    pub reason: Option<String>,
    /// Answer of the bot, truncated to 2 KB.
    pub bot_response: Option<String>,
    pub verify: Option<ActionVerify>,
    pub idempotency_key: String,
    pub ts_ms: i64,
}

/// Preferences synchronised across devices, one document per `(user, scope)`. The scope is empty
/// for the global document or a `bot_key` for per-bot preferences (device aliases `ftbot.N` never
/// appear here).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct PrefsDoc {
    pub scope: String,
    /// Starts at 1 and increases at every write: the value of `If-Match`.
    pub version: u64,
    pub updated_ms: i64,
    #[ts(type = "unknown")]
    pub data: serde_json::Value,
}
