//! Domain model, pure calculations, alert rules and wire protocol of `frequi-gateway`.
//!
//! This crate performs no I/O. Everything here is deterministic and testable in isolation,
//! and doubles as the executable specification of the functions the browser "direct mode"
//! re-implements in TypeScript: both sides run the shared vectors in
//! `gateway/fixtures/vectors/*.json`.

pub mod alerts;
pub mod calc;
pub mod identity;
pub mod model;
pub mod protocol;
pub mod time;
pub mod ts_export;
