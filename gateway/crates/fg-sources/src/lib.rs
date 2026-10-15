//! Input adapters of `frequi-gateway`: everything that talks to the outside world.
//!
//! * [`discovery`]: scan `/proc` for running freqtrade bots and read a whitelist of fields from
//!   their merged configs (credentials never leave [`sensitive::Secret`]).
//! * [`sqlite`]: read-only access to the bot ledgers (03 section 5).
//! * [`ftcache`]: client of the ftcache daemon with a closed set of read-only operations (03
//!   section 4.4).
//! * [`botrest`] and [`botws`]: per-bot REST and WebSocket clients (03 sections 3.1, 4.2, 4.3).
//! * [`external`]: CoinGecko ticker. Never the exchange.
//!
//! The behaviour the rest of the gateway depends on is described by the traits of [`traits`], so
//! that the engine can be tested against fakes.

pub mod botrest;
pub mod botws;
pub mod discovery;
pub mod external;
pub mod ftcache;
pub mod sensitive;
pub mod sqlite;
pub mod traits;

#[cfg(test)]
mod testutil;

pub use traits::{BotRest, BotWs, DaemonClient, Discovery, LedgerReader, TickerSource};
