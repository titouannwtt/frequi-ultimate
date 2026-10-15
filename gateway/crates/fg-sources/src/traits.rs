//! The behaviour the rest of the gateway depends on, as traits, so that `fg-engine` can run
//! against fakes (no `/proc`, no SQLite file, no sockets, no network).
//!
//! Async methods return a boxed future ([`BoxFut`]) so that the traits stay object safe and can
//! be held as `Arc<dyn ...>`. Blocking sources ([`Discovery`], [`LedgerReader`]) are plain
//! synchronous traits: the engine calls them from `spawn_blocking`.

use std::future::Future;
use std::path::Path;
use std::pin::Pin;

use fg_core::model::Ticker;
use serde_json::Value;

use crate::botrest::{BotFeatures, ReadEndpoint, RestError, WriteAction, WriteOutcome};
use crate::botws::{WsHandle, WsTarget, WsTopic};
use crate::discovery::DiscoveryReport;
use crate::external::TickerError;
use crate::ftcache::{
    DaemonError, DaemonPing, DaemonStats, FleetEvents, FleetStatus, FleetSummary,
};
use crate::sqlite::{
    LedgerError, LedgerOrder, LedgerSchema, LedgerStat, LedgerSummary, LedgerTrade, ProfitChunk,
    TradeQuery,
};

/// A boxed, sendable future.
pub type BoxFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Finds the bots running on this host (blocking: reads `/proc` and config files).
pub trait Discovery: Send + Sync {
    fn scan(&self) -> DiscoveryReport;
}

/// Read-only access to bot ledgers (blocking SQLite). Implementations never write.
pub trait LedgerReader: Send + Sync {
    /// `stat()` of the database and its `-wal`, without opening it.
    fn stat(&self, db: &Path) -> Result<LedgerStat, LedgerError>;
    fn schema(&self, db: &Path) -> Result<LedgerSchema, LedgerError>;
    fn summary(&self, db: &Path) -> Result<LedgerSummary, LedgerError>;
    fn trades(&self, db: &Path, query: &TradeQuery) -> Result<Vec<LedgerTrade>, LedgerError>;
    fn orders(&self, db: &Path, trade_ids: &[i64]) -> Result<Vec<LedgerOrder>, LedgerError>;
    /// Rows of `profit_history` with `rowid > after_rowid`, or the whole table when the cursor
    /// is ahead of it ([`ProfitChunk::reset`]).
    fn profit_history(&self, db: &Path, after_rowid: i64) -> Result<ProfitChunk, LedgerError>;
}

/// The ftcache daemon, through its closed set of read-only operations.
pub trait DaemonClient: Send + Sync {
    fn ping(&self) -> BoxFut<'_, Result<DaemonPing, DaemonError>>;
    fn summary_get(&self, max_age_s: Option<f64>) -> BoxFut<'_, Result<FleetSummary, DaemonError>>;
    fn fleet_status(&self) -> BoxFut<'_, Result<FleetStatus, DaemonError>>;
    fn fleet_events(
        &self,
        since_ts: f64,
        limit: u32,
    ) -> BoxFut<'_, Result<FleetEvents, DaemonError>>;
    fn stats(&self) -> BoxFut<'_, Result<DaemonStats, DaemonError>>;
}

/// REST client of one bot.
pub trait BotRest: Send + Sync {
    /// Unauthenticated liveness probe (`/ping`).
    fn ping(&self) -> BoxFut<'_, Result<(), RestError>>;
    /// Authenticated GET of one of the endpoints the gateway reads.
    fn read(&self, endpoint: ReadEndpoint) -> BoxFut<'_, Result<Value, RestError>>;
    /// `/version`, `/show_config` and a probe of the fork endpoints, once per incarnation.
    fn features(&self) -> BoxFut<'_, Result<BotFeatures, RestError>>;
    /// A write. Never retried; the same `idempotency_key` is never sent twice.
    fn write(
        &self,
        action: WriteAction,
        idempotency_key: String,
    ) -> BoxFut<'_, Result<WriteOutcome, RestError>>;
}

/// WebSocket client of the bots. `connect` starts a supervised connection that reconnects with
/// backoff until the returned handle is dropped.
pub trait BotWs: Send + Sync {
    fn connect(&self, target: WsTarget, topics: Vec<WsTopic>) -> WsHandle;
}

/// Source of the BTC/ETH ticker (never the exchange).
pub trait TickerSource: Send + Sync {
    fn tickers(&self) -> BoxFut<'_, Result<Vec<Ticker>, TickerError>>;
}
