//! Middleware: caller identity, origin check, access log, session check.

use std::net::SocketAddr;
use std::time::Instant;

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderValue, Method, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use fg_core::protocol::ErrorCode;

use crate::error::ApiFailure;
use crate::state::{AppState, Client};

/// Path of the WebSocket: its origin is checked by the handler, which can answer with the
/// close code browsers can read.
pub const WS_PATH: &str = "/gw/v1/ws";

/// Attach the [`Client`] (address and user agent) to the request.
pub async fn client_info(
    State(st): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    mut req: Request,
    next: Next,
) -> Response {
    let client = st.client(peer, req.headers());
    req.extensions_mut().insert(client);
    next.run(req).await
}

/// Refuse a request that carries an `Origin` the UI does not use. A request without `Origin`
/// (curl, a script, a native client) goes through: it still needs a session to do anything.
pub async fn origin_guard(State(st): State<AppState>, req: Request, next: Next) -> Response {
    if let Some(origin) = req.headers().get(header::ORIGIN)
        && req.uri().path() != WS_PATH
        && req.method() != Method::OPTIONS
    {
        let ok = origin.to_str().is_ok_and(|o| st.origin_allowed(o));
        if !ok {
            let ip = req
                .extensions()
                .get::<Client>()
                .map(|c| c.ip.to_string())
                .unwrap_or_default();
            tracing::warn!(event = "origin_refused", ip = %ip, path = %req.uri().path());
            return ApiFailure::new(ErrorCode::OriginNotAllowed, "origin not allowed")
                .into_response();
        }
    }
    next.run(req).await
}

/// One line per request: method, path (never the query string), status, duration.
pub async fn access_log(req: Request, next: Next) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_owned();
    let ip = req
        .extensions()
        .get::<Client>()
        .map(|c| c.ip.to_string())
        .unwrap_or_default();
    let started = Instant::now();
    let resp = next.run(req).await;
    let status = resp.status().as_u16();
    let ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    match status {
        500..=599 => {
            tracing::error!(target: "fg_server::access", %method, %path, status, ms, ip = %ip)
        }
        401 | 403 | 429 => {
            tracing::warn!(target: "fg_server::access", %method, %path, status, ms, ip = %ip);
        }
        _ => tracing::debug!(target: "fg_server::access", %method, %path, status, ms, ip = %ip),
    }
    resp
}

fn bearer(req: &Request) -> Option<&str> {
    let v = req.headers().get(header::AUTHORIZATION)?.to_str().ok()?;
    // The scheme is case-insensitive (RFC 9110); the token itself is not.
    let (scheme, token) = v.split_once(' ')?;
    scheme.eq_ignore_ascii_case("bearer").then(|| token.trim())
}

/// Require a valid session; the [`crate::session::Session`] is attached to the request.
pub async fn require_session(State(st): State<AppState>, mut req: Request, next: Next) -> Response {
    let session = bearer(&req).and_then(|t| st.sessions.lookup(t));
    let Some(session) = session else {
        let ip = req
            .extensions()
            .get::<Client>()
            .map(|c| c.ip.to_string())
            .unwrap_or_default();
        // One line without a secret, in a shape fail2ban can match.
        tracing::warn!(event = "auth_failed", ip = %ip, path = %req.uri().path());
        let mut resp = ApiFailure::unauthorized().into_response();
        resp.headers_mut()
            .insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Bearer"));
        return resp;
    };
    req.extensions_mut().insert(session);
    next.run(req).await
}
