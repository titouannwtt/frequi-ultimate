//! Shared state of the HTTP server.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use axum::http::{HeaderMap, header};
use fg_core::identity::BotKey;
use fg_engine::EngineHandle;
use tokio::sync::{Semaphore, watch};

use crate::config::GatewayConfig;
use crate::directory::{BotDirectory, local_addresses};
use crate::limits::Limits;
use crate::passthrough::ProxyCache;
use crate::probe::BotProbe;
use crate::session::{Scope, Session, SessionStore};

/// The owner of the gateway: preferences are one set per gateway, shared by all devices.
pub const PREFS_USER: &str = "owner";
/// Sockets that may wait for their `auth` frame at the same time.
pub const MAX_PENDING_WS: usize = 64;

pub struct Inner {
    pub cfg: GatewayConfig,
    pub engine: EngineHandle,
    pub sessions: SessionStore,
    pub limits: Limits,
    pub directory: Arc<dyn BotDirectory>,
    pub probe: Arc<dyn BotProbe>,
    /// Names and addresses that mean "this machine" in a browser's bot URL.
    pub local_hosts: Vec<String>,
    pub allowed_origins: Vec<String>,
    pub cache: ProxyCache,
    pub shutdown: watch::Sender<bool>,
    pub ws_pending: Arc<Semaphore>,
}

/// Cheap to clone.
#[derive(Clone)]
pub struct AppState(pub Arc<Inner>);

impl std::ops::Deref for AppState {
    type Target = Inner;

    fn deref(&self) -> &Inner {
        &self.0
    }
}

/// Who is calling, as the network and the headers say.
#[derive(Debug, Clone)]
pub struct Client {
    pub ip: IpAddr,
    pub user_agent: String,
}

impl AppState {
    #[must_use]
    pub fn new(
        cfg: GatewayConfig,
        engine: EngineHandle,
        sessions: SessionStore,
        directory: Arc<dyn BotDirectory>,
        probe: Arc<dyn BotProbe>,
    ) -> Self {
        let mut local_hosts = cfg.server.local_hosts.clone();
        local_hosts.extend(local_addresses());
        let allowed_origins = cfg.allowed_origins();
        let limits = Limits::new(&cfg.auth);
        let recon_ttl =
            std::time::Duration::from_secs(u64::from(cfg.hyperliquid.min_sweep_interval_s));
        Self(Arc::new(Inner {
            cfg,
            engine,
            sessions,
            limits,
            directory,
            probe,
            local_hosts,
            allowed_origins,
            cache: ProxyCache::new(recon_ttl),
            shutdown: watch::channel(false).0,
            ws_pending: Arc::new(Semaphore::new(MAX_PENDING_WS)),
        }))
    }

    /// The address of the caller. Behind a local reverse proxy (`trust_forwarded_for`) the last
    /// `X-Forwarded-For` entry, which is the one the proxy itself appended.
    #[must_use]
    pub fn client_ip(&self, peer: SocketAddr, headers: &HeaderMap) -> IpAddr {
        if self.cfg.server.trust_forwarded_for
            && peer.ip().is_loopback()
            && let Some(ip) = headers
                .get("x-forwarded-for")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.rsplit(',').next())
                .and_then(|v| v.trim().parse::<IpAddr>().ok())
        {
            return ip;
        }
        peer.ip()
    }

    #[must_use]
    pub fn client(&self, peer: SocketAddr, headers: &HeaderMap) -> Client {
        Client {
            ip: self.client_ip(peer, headers),
            user_agent: headers
                .get(header::USER_AGENT)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .chars()
                .take(160)
                .collect(),
        }
    }

    /// Whether the origin of a request is one the UI may use (exact, case-insensitive).
    #[must_use]
    pub fn origin_allowed(&self, origin: &str) -> bool {
        let o = origin.trim_end_matches('/').to_ascii_lowercase();
        self.allowed_origins.contains(&o)
    }

    /// May this session reach this bot?
    #[must_use]
    pub fn bot_allowed(&self, s: &Session, key: &BotKey) -> bool {
        match &s.scope {
            Scope::All => true,
            Scope::Groups(g) => self
                .directory
                .get(key)
                .is_some_and(|b| g.contains(&b.group)),
        }
    }

    /// Does this session reach every bot of the fleet? Fleet-wide views need it: they carry all
    /// the bots, and a session that proved only some of them must not read the others.
    #[must_use]
    pub fn fleet_allowed(&self, s: &Session) -> bool {
        match &s.scope {
            Scope::All => true,
            Scope::Groups(g) => self.directory.bots().iter().all(|b| g.contains(&b.group)),
        }
    }
}
