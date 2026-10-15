//! The live state of `frequi-gateway` (03 sections 4 to 8 and 12).
//!
//! Source tasks (a REST/WebSocket actor per bot, a ledger poller, a daemon poller) report to a
//! single **core** task that owns the state. The core assembles bots and positions, aggregates
//! them, evaluates the alert rules, and publishes keyed upserts per channel into the delta
//! buffers; readers (the server layer) take lock-free snapshots and subscribe to the channels.
//!
//! * [`Engine::start`] wires everything; [`EngineHandle`] is the API of the server layer.
//! * [`budget`]: the global token bucket that bounds the request rate towards the bots.
//! * [`actor`]: per-bot scheduler with jitter, backoff and the offline detector.
//! * [`runtime`] and [`aggregate`]: freshness-aware assembly of figures, wallet-level capital and
//!   exposure, per-mode totals.
//! * [`state_db`]: the gateway's own SQLite (alert book, preferences, events, audit, idempotency).
//! * [`actions`]: guarded, idempotent, audited, never retried writes.

pub mod actions;
pub mod aggregate;
pub mod budget;
pub mod clock;
pub mod closed;
pub mod config;
pub mod connector;
pub mod error;
pub mod hub;
pub mod ledger_data;
pub mod meta;
pub mod msg;
pub mod published;
pub mod queries;
pub mod runtime;
pub mod state_db;
pub mod views;
pub mod wire;

mod actor;
mod core;
mod daemon_task;
mod handle;
mod ledger_task;
mod shared;
mod supervisor;

pub use actions::{ActionError, ActionOrigin, ActionRequest, ExpectedTrade};
pub use clock::{Clock, SystemClock, TokioClock};
pub use config::{Cadence, Cadences, EngineConfig, Publication};
pub use connector::{BotConnector, BotLink, HttpConnector};
pub use error::EngineError;
pub use handle::{AlertFilter, Engine, EngineHandle, EngineSources, EventQuery};
pub use hub::Subscription;
pub use published::{ChannelSnapshot, Published};
pub use queries::{EquityMode, JournalQuery, JournalSort, ScopeRef};

#[cfg(test)]
mod testkit;
#[cfg(test)]
mod tests;
