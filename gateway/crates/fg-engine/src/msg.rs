//! Messages from the source tasks to the core.

use fg_core::identity::BotKey;
use fg_core::model::{BotStatus, Event, PairLock, Ticker};
use fg_sources::botrest::BotFeatures;
use fg_sources::ftcache::{DaemonEvent, DaemonStats, FleetStatus, FleetSummary};

use crate::ledger_data::LedgerEvent;
use crate::meta::BotMeta;
use crate::wire::{BalanceInfo, LivePosition, LogEntry, SnapEntry};

/// What a bot actor observed.
#[derive(Debug, Clone)]
pub enum Obs {
    /// The bot answered something.
    Alive,
    /// The offline detector changed its verdict.
    Status(BotStatus),
    Features(BotFeatures),
    Positions(Vec<LivePosition>),
    Balance(BalanceInfo),
    Whitelist(Vec<String>),
    Blacklist(Vec<String>),
    Locks(Vec<PairLock>),
    Logs(Vec<LogEntry>),
    WsConnected(bool),
    WsSnapshot(Vec<SnapEntry>),
    WsEvent(Event),
}

/// Input of the core task.
#[derive(Debug)]
pub enum Msg {
    /// Result of a discovery scan: the bots that exist now.
    Discovered(Vec<BotMeta>),
    Bot {
        key: BotKey,
        at_ms: i64,
        obs: Obs,
    },
    Ledger {
        key: BotKey,
        at_ms: i64,
        ev: LedgerEvent,
    },
    Digest {
        at_ms: i64,
        summary: FleetSummary,
    },
    /// The digest could not be read (daemon down or answering garbage).
    DigestFailed {
        at_ms: i64,
    },
    DaemonStatus {
        at_ms: i64,
        status: Box<FleetStatus>,
    },
    DaemonEvents {
        at_ms: i64,
        events: Vec<DaemonEvent>,
    },
    DaemonStats {
        at_ms: i64,
        stats: Box<DaemonStats>,
    },
    Tickers {
        at_ms: i64,
        tickers: Vec<Ticker>,
    },
    /// An event produced elsewhere (an action of the user).
    PushEvent(Event),
}
