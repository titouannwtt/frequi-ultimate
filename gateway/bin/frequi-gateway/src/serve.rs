//! `frequi-gateway run`: wire the real sources, start the engine and the server, wait for a
//! signal, stop cleanly.

use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use fg_engine::{Engine, EngineSources, HttpConnector, SystemClock};
use fg_server::config::{self, GatewayConfig};
use fg_server::directory::{CachedDiscovery, DiscoveryDirectory};
use fg_server::probe::HttpProbe;
use fg_sources::botrest::RestOptions;
use fg_sources::botws::WsClient;
use fg_sources::discovery::{DiscoveryOptions, DiscoveryReport, ProcDiscovery};
use fg_sources::external::CoinGecko;
use fg_sources::ftcache::{self, UnixDaemon};
use fg_sources::sqlite::{LedgerOptions, SqliteLedger};
use fg_sources::traits::{DaemonClient, Discovery, TickerSource};

/// Shared `/proc` scans are reused this long between the engine and the server.
const DISCOVERY_TTL: Duration = Duration::from_secs(20);

struct NoDiscovery;

impl Discovery for NoDiscovery {
    fn scan(&self) -> DiscoveryReport {
        DiscoveryReport::default()
    }
}

/// Load and validate the configuration, printing every problem. `None` when it is unusable.
pub fn load_config(
    config_path: Option<&PathBuf>,
    secrets: Option<&PathBuf>,
) -> Option<GatewayConfig> {
    let loaded = match config::load(
        config_path.map(PathBuf::as_path),
        secrets.map(PathBuf::as_path),
    ) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("configuration error: {e}");
            return None;
        }
    };
    let problems = loaded.config.problems();
    if !problems.is_empty() {
        for p in &problems {
            eprintln!("configuration error: {p}");
        }
        return None;
    }
    Some(loaded.config)
}

pub async fn run(cfg: GatewayConfig) -> ExitCode {
    fg_server::logging::init(&cfg.log);

    let (discovery, uid): (Arc<dyn Discovery>, u32) = if cfg.discovery.proc_scan {
        let proc = ProcDiscovery::new(DiscoveryOptions {
            ignore_db_name_tokens: cfg.discovery.ignore_db_name_tokens.clone(),
            read_api_credentials_from_config: cfg.discovery.read_api_credentials_from_config,
            ..DiscoveryOptions::default()
        });
        let uid = proc.uid();
        (Arc::new(proc), uid)
    } else {
        (Arc::new(NoDiscovery), 0)
    };
    let cached = Arc::new(CachedDiscovery::new(discovery, DISCOVERY_TTL));

    let daemon: Option<Arc<dyn DaemonClient>> = match cfg.ftcache.socket.as_deref() {
        Some("") => None,
        Some(path) => Some(Arc::new(UnixDaemon::new(path))),
        None => Some(Arc::new(UnixDaemon::new(ftcache::default_socket_path(uid)))),
    };
    let ticker: Option<Arc<dyn TickerSource>> = cfg
        .market
        .coingecko
        .then(|| Arc::new(CoinGecko::public_default()) as Arc<dyn TickerSource>);
    let sources = EngineSources {
        discovery: Arc::clone(&cached) as Arc<dyn Discovery>,
        ledger: Arc::new(SqliteLedger::new(LedgerOptions::default())),
        daemon,
        connector: Arc::new(HttpConnector::new(RestOptions::default())),
        ws: Arc::new(WsClient::default()),
        ticker,
    };
    let engine = match Engine::start(cfg.engine_config(), sources, Arc::new(SystemClock)).await {
        Ok(e) => e,
        Err(_) => {
            eprintln!("cannot open the gateway database in the data directory");
            return ExitCode::from(1);
        }
    };
    let state = match fg_server::make_state(
        cfg.clone(),
        engine.handle(),
        Arc::new(DiscoveryDirectory(cached)),
        Arc::new(HttpProbe::new()),
    )
    .await
    {
        Ok(s) => s,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::from(1);
        }
    };
    let server = match fg_server::bind_and_serve(state).await {
        Ok(s) => s,
        Err(e) => {
            // Port taken, most likely: the doctor says which process holds it.
            eprintln!("{e}");
            engine.shutdown().await;
            return ExitCode::from(1);
        }
    };
    tracing::info!(
        event = "started",
        version = env!("CARGO_PKG_VERSION"),
        port = server.addr.port(),
        cors_origins = cfg.server.cors_origins.len(),
        auth_modes = ?cfg.auth.modes.iter().map(|m| m.as_str()).collect::<Vec<_>>(),
    );

    wait_for_stop().await;
    tracing::info!(event = "stopping");
    server.shutdown().await;
    engine.shutdown().await;
    tracing::info!(event = "stopped");
    ExitCode::SUCCESS
}

async fn wait_for_stop() {
    use tokio::signal::unix::{SignalKind, signal};
    let (Ok(mut term), Ok(mut int)) = (
        signal(SignalKind::terminate()),
        signal(SignalKind::interrupt()),
    ) else {
        // Cannot listen for signals: run until killed.
        std::future::pending::<()>().await;
        return;
    };
    tokio::select! {
        _ = term.recv() => {}
        _ = int.recv() => {}
    }
}
