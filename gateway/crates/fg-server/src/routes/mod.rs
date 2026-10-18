//! The routes of `/gw/v1` (03 section 6.3), registered through a builder that keeps the table of
//! what exists. The table is how the security tests know every route: a route cannot be added
//! without appearing in it, and every route of the protected group sits behind the session check
//! by construction.

use std::time::Duration;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::http::StatusCode;
use axum::middleware::from_fn_with_state;
use axum::routing::{MethodRouter, any, delete, get, patch, post};
use tower_http::timeout::TimeoutLayer;

use crate::error::ApiFailure;
use crate::mw::require_session;
use crate::state::AppState;

pub mod actions;
pub mod alerts;
pub mod candles;
pub mod data;
pub mod proxy;
pub mod session;

/// Prefix of the API.
pub const PREFIX: &str = "/gw/v1";
/// Ordinary requests give up after this long.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// A preference document may be 256 KB.
const PREFS_BODY: usize = 300 * 1024;
/// The largest body of the passthrough (strategy files).
const PROXY_BODY: usize = 2 * 1024 * 1024;

/// One route, as registered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteInfo {
    pub method: &'static str,
    /// Full path, with the `/gw/v1` prefix and `{param}` placeholders.
    pub path: String,
    /// Reachable without a session (the session endpoints, `hello`, and the WebSocket which
    /// authenticates in its first frame).
    pub public: bool,
}

#[derive(Default)]
struct Builder {
    public: Router<AppState>,
    guarded: Router<AppState>,
    long: Router<AppState>,
    table: Vec<RouteInfo>,
}

impl Builder {
    fn info(&mut self, method: &'static str, path: &'static str, public: bool) {
        self.table.push(RouteInfo {
            method,
            path: format!("{PREFIX}{path}"),
            public,
        });
    }

    fn public(
        mut self,
        method: &'static str,
        path: &'static str,
        mr: MethodRouter<AppState>,
    ) -> Self {
        self.info(method, path, true);
        self.public = self.public.route(path, mr);
        self
    }

    fn guarded(
        mut self,
        method: &'static str,
        path: &'static str,
        mr: MethodRouter<AppState>,
    ) -> Self {
        self.info(method, path, false);
        self.guarded = self.guarded.route(path, mr);
        self
    }

    /// A protected route that may take minutes (no request timeout).
    fn long(
        mut self,
        method: &'static str,
        path: &'static str,
        mr: MethodRouter<AppState>,
    ) -> Self {
        self.info(method, path, false);
        self.long = self.long.route(path, mr);
        self
    }
}

async fn not_found() -> ApiFailure {
    ApiFailure::not_found()
}

/// All routes, with the table that describes them.
pub fn build(st: &AppState) -> (Router<AppState>, Vec<RouteInfo>) {
    let b = Builder::default()
        // Public: nothing here returns data of the fleet.
        .public("GET", "/hello", get(session::hello))
        .public("POST", "/session/bootstrap", post(session::bootstrap))
        .public("POST", "/session/login", post(session::login))
        .public("GET", "/ws", get(crate::ws::handler))
        // Sessions.
        .guarded("DELETE", "/session", delete(session::logout))
        .guarded("GET", "/sessions", get(session::list))
        .guarded("DELETE", "/sessions/{id}", delete(session::revoke))
        // State.
        .guarded("GET", "/snapshot", get(data::snapshot))
        .guarded("GET", "/bots", get(data::bots))
        .guarded("POST", "/bots", post(data::registry_write))
        .guarded("GET", "/bots/discovered", get(data::bots_discovered))
        .guarded("PATCH", "/bots/{key}", patch(data::registry_write))
        .guarded("DELETE", "/bots/{key}", delete(data::registry_write))
        .guarded(
            "POST",
            "/bots/{key}/credentials",
            post(data::registry_write),
        )
        .guarded("GET", "/prefs", get(alerts::prefs_get))
        .guarded(
            "PUT",
            "/prefs",
            axum::routing::put(alerts::prefs_put).layer(DefaultBodyLimit::max(PREFS_BODY)),
        )
        .guarded("DELETE", "/prefs", delete(alerts::prefs_delete))
        .guarded("GET", "/scope/{scope}", get(data::scope))
        // Journal and figures.
        .guarded("GET", "/trades", get(data::trades))
        .guarded("GET", "/trades/export.csv", get(data::trades_export))
        .guarded("GET", "/trades/{key}/{trade_id}", get(data::trade_detail))
        .guarded("GET", "/pnl/periods", get(data::pnl_periods))
        .guarded("GET", "/equity", get(data::equity))
        .guarded("GET", "/drawdown", get(data::drawdown))
        .guarded("GET", "/leaderboard", get(data::leaderboard))
        .guarded("GET", "/risk", get(data::risk_view))
        .guarded("GET", "/health", get(data::health))
        .guarded("GET", "/health/rate", get(data::health_rate))
        .guarded("GET", "/logs", get(data::logs))
        // Alerts and events.
        .guarded("GET", "/alerts", get(alerts::list))
        .guarded("POST", "/alerts/{id}/ack", post(alerts::ack))
        .guarded("POST", "/alerts/silence", post(alerts::silence))
        .guarded("DELETE", "/alerts/silence/{id}", delete(alerts::unsilence))
        .guarded("GET", "/alerts/rules", get(alerts::rules_get))
        .guarded(
            "PUT",
            "/alerts/rules",
            axum::routing::put(alerts::rules_put),
        )
        .guarded("GET", "/events", get(data::events))
        .guarded("GET", "/pairs/{key}", get(data::pairs))
        .guarded("GET", "/market", get(data::market))
        .guarded("GET", "/candles", get(candles::candles))
        .guarded("GET", "/audit", get(data::audit))
        // Passthrough and writes: no request timeout of their own. A write answers `unknown` when
        // the engine's deadline passes and is never cut by a timer above it, whose 408 would
        // tell a client nothing about an order that may have gone out.
        .long("POST", "/bots/{key}/actions/{action}", post(actions::act))
        .long(
            "ANY",
            "/bots/{key}/proxy/{*rest}",
            any(proxy::proxy).layer(DefaultBodyLimit::max(PROXY_BODY)),
        );

    let Builder {
        public,
        guarded,
        long,
        table,
    } = b;
    let auth = from_fn_with_state(st.clone(), require_session);
    // Unknown paths under the prefix answer 401 to a stranger and 404 to a session: the fallback
    // is inside the protected group, so the layer wraps it too.
    let guarded = guarded
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            REQUEST_TIMEOUT,
        ))
        .merge(long)
        .fallback(not_found)
        .layer(auth);
    let public = public.layer(TimeoutLayer::with_status_code(
        StatusCode::REQUEST_TIMEOUT,
        REQUEST_TIMEOUT,
    ));
    (public.merge(guarded), table)
}
