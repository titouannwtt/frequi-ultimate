//! HTTP and WebSocket server of `frequi-gateway` (03 sections 3, 6, 8 and 9.1).
//!
//! * [`config`]: the TOML configuration, `secrets.toml`, `FG_*` overrides.
//! * [`session`], [`limits`], [`password`], [`probe`], [`directory`]: how a browser gets in
//!   (token proof against a local bot, bot credentials, gateway password), rate limits and
//!   lockout, trust groups.
//! * [`routes`], [`ws`], [`passthrough`], [`risk`]: the `/gw/v1` REST API, the multiplexed
//!   WebSocket, the whitelisted passthrough to the Python API.
//! * [`redact`]: scrubbing of log lines.
//! * [`server`]: layers (CORS, origin check, compression, body limits) and graceful shutdown.
//!
//! Every route but `hello`, the session endpoints and the WebSocket (which authenticates in its
//! first frame) sits behind the session check by construction, and the table of routes the
//! server exposes is available to the tests.

pub mod config;
pub mod directory;
pub mod error;
pub mod limits;
pub mod logging;
pub mod mw;
pub mod passthrough;
pub mod password;
pub mod probe;
pub mod redact;
pub mod risk;
pub mod routes;
pub mod runtime;
pub mod server;
pub mod session;
pub mod state;
pub mod util;
pub mod ws;

pub use config::{AuthMode, GatewayConfig};
pub use server::{RunningServer, ServerError, bind_and_serve, make_state, serve};
pub use state::AppState;
