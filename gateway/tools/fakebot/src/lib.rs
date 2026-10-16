//! Fake freqtrade bots for load and end-to-end tests of `frequi-gateway`.
//!
//! Each fake bot serves the REST and WebSocket surface the gateway reads, over a SQLite ledger
//! in the freqtrade schema that a writer thread keeps committing to. Writes (`forceexit`,
//! `forceenter`, `stop`, ...) are only recorded. A fake ftcache daemon answers the five
//! read-only operations and remembers any other operation it is sent. Everything listens on the
//! loopback or in a temporary directory; nothing here can reach a real bot or an exchange.

pub mod api;
pub mod control;
pub mod daemon;
pub mod fleet;
pub mod ledger;
pub mod rng;

pub use api::{Bot, BotInfo, Mode, OddBody, WriteRecord};
pub use fleet::{Fleet, FleetSpec, FleetStats, Manifest};
pub use ledger::{SeedSpec, Writer, WriterConfig};
