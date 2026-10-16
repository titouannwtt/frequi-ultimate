//! Assembly of the HTTP server: layers, state, serving and graceful shutdown.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::http::{HeaderName, HeaderValue, Method, header};
use axum::middleware::from_fn_with_state;
use fg_engine::EngineHandle;
use thiserror::Error;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::set_header::SetResponseHeaderLayer;

use crate::config::GatewayConfig;
use crate::directory::BotDirectory;
use crate::mw::{access_log, client_info, origin_guard};
use crate::probe::BotProbe;
use crate::routes::{self, RouteInfo};
use crate::session::SessionStore;
use crate::state::AppState;

/// Default body limit of a request (the passthrough and the preferences raise it per route).
pub const BODY_LIMIT: usize = 64 * 1024;
/// How long open connections get to finish after the stop signal.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

#[derive(Debug, Error)]
pub enum ServerError {
    #[error("cannot open the gateway database")]
    Store,
    #[error("cannot listen on the configured address: {0}")]
    Listen(String),
}

/// Build the shared state: opens the session table in the engine's `state.db`.
///
/// # Errors
/// [`ServerError::Store`] when `state.db` cannot be used.
pub async fn make_state(
    cfg: GatewayConfig,
    engine: EngineHandle,
    directory: Arc<dyn BotDirectory>,
    probe: Arc<dyn BotProbe>,
) -> Result<AppState, ServerError> {
    let sessions = SessionStore::open(engine.state_db(), cfg.auth.session_ttl_days)
        .await
        .map_err(|_| ServerError::Store)?;
    Ok(AppState::new(cfg, engine, sessions, directory, probe))
}

fn cors(st: &AppState) -> CorsLayer {
    let origins: Vec<HeaderValue> = st
        .allowed_origins
        .iter()
        .filter_map(|o| HeaderValue::from_str(o).ok())
        .collect();
    // Bearer authentication: no cookies, hence no credentials mode. An origin outside the list
    // gets no `Access-Control-Allow-Origin` and the browser refuses to read the answer.
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            HeaderName::from_static("idempotency-key"),
            header::IF_MATCH,
            header::IF_NONE_MATCH,
            HeaderName::from_static("x-confirm-bot"),
        ])
        .expose_headers([
            header::ETAG,
            HeaderName::from_static("x-gw-seq"),
            HeaderName::from_static("x-gw-cache"),
        ])
        .max_age(Duration::from_secs(600))
}

/// The application and the table of its routes.
pub fn build_app(st: &AppState) -> (Router, Vec<RouteInfo>) {
    let (api, table) = routes::build(st);
    let app = Router::new()
        .nest(routes::PREFIX, api)
        .with_state(st.clone())
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(CompressionLayer::new())
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(from_fn_with_state(st.clone(), origin_guard))
        .layer(axum::middleware::from_fn(access_log))
        .layer(from_fn_with_state(st.clone(), client_info))
        .layer(cors(st));
    (app, table)
}

/// A running server.
pub struct RunningServer {
    pub addr: SocketAddr,
    pub state: AppState,
    pub routes: Vec<RouteInfo>,
    stop: Option<oneshot::Sender<()>>,
    task: JoinHandle<()>,
}

impl RunningServer {
    /// Stop accepting, tell the WebSockets to leave (close code 1001), wait up to five seconds.
    pub async fn shutdown(mut self) {
        if let Some(tx) = self.stop.take() {
            let _ = tx.send(());
        }
        let _ = self.task.await;
    }
}

/// Serve on `listener` until [`RunningServer::shutdown`].
#[must_use]
pub fn serve(listener: TcpListener, st: AppState) -> RunningServer {
    let addr = listener
        .local_addr()
        .unwrap_or_else(|_| SocketAddr::from(([0, 0, 0, 0], 0)));
    let (app, routes) = build_app(&st);
    let (stop_tx, stop_rx) = oneshot::channel::<()>();
    let state = st.clone();
    let task = tokio::spawn(async move {
        let housekeeping = {
            let st = st.clone();
            tokio::spawn(async move {
                let mut t = tokio::time::interval(Duration::from_secs(60));
                loop {
                    t.tick().await;
                    st.limits.housekeeping();
                }
            })
        };
        let st_stop = st.clone();
        let graceful = async move {
            let _ = stop_rx.await;
            let _ = st_stop.shutdown.send(true);
        };
        let server = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(graceful);
        let mut server = std::pin::pin!(server.into_future());
        // After the stop signal the server gets a few seconds to drain.
        let stopped = tokio::select! {
            r = &mut server => { r.ok(); true }
            () = async {
                let mut rx = st.shutdown.subscribe();
                let _ = rx.wait_for(|v| *v).await;
                tokio::time::sleep(SHUTDOWN_GRACE).await;
            } => false,
        };
        if !stopped {
            tracing::warn!("some connections did not close in time");
        }
        housekeeping.abort();
    });
    RunningServer {
        addr,
        state,
        routes,
        stop: Some(stop_tx),
        task,
    }
}

/// Bind the configured address and serve.
///
/// # Errors
/// [`ServerError::Listen`] when the address cannot be bound (in use, no permission).
pub async fn bind_and_serve(st: AppState) -> Result<RunningServer, ServerError> {
    let listener = TcpListener::bind(&st.cfg.server.listen)
        .await
        .map_err(|e| ServerError::Listen(e.kind().to_string()))?;
    Ok(serve(listener, st))
}
