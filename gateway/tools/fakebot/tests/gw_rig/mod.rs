//! A real gateway (engine + HTTP/WebSocket server) in front of a fleet of fake bots, all on
//! ephemeral loopback ports, for the end-to-end and security tests.

#![allow(dead_code)]

use std::sync::Arc;
use std::time::{Duration, Instant};

use fakebot::{Fleet, FleetSpec, Mode, WriterConfig};
use fg_engine::budget::BudgetConfig;
use fg_engine::{Cadences, Engine, EngineSources, HttpConnector, SystemClock};
use fg_server::config::{AuthMode, GatewayConfig};
use fg_server::directory::{DirBot, StaticDirectory};
use fg_server::probe::HttpProbe;
use fg_server::{RunningServer, make_state, serve};
use fg_sources::botrest::RestOptions;
use fg_sources::botws::WsClient;
use fg_sources::ftcache::UnixDaemon;
use fg_sources::sensitive::Secret;
use fg_sources::sqlite::{LedgerOptions, SqliteLedger};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

use crate::common::{ManifestDiscovery, discovered};

pub const SCALE: f64 = 20.0;
pub const UI_ORIGIN: &str = "http://ui.example.test:9400";

pub struct Opts {
    pub bots: usize,
    pub closed: usize,
    pub cors: Vec<String>,
    pub modes: Vec<AuthMode>,
    pub password: Option<String>,
    pub login_per_min: u32,
    pub global_per_min: u32,
    pub lockout_after: u32,
    pub actions_per_min: u32,
    /// Bot `i` is in trust group `i % groups`.
    pub groups: usize,
    pub writer: bool,
    /// How often a fake bot pushes its `trade_snapshot` over the WebSocket.
    pub snapshot_every: Duration,
    /// Fake bots whose `/status` answers 200 with a body that is not a list of trades.
    pub odd_status: Vec<(usize, fakebot::OddBody)>,
    /// `hyperliquid.sweep_timeout_s` of the gateway (default 40).
    pub sweep_timeout_s: Option<u32>,
}

impl Default for Opts {
    fn default() -> Self {
        Self {
            bots: 4,
            closed: 60,
            cors: vec![UI_ORIGIN.to_owned()],
            modes: vec![AuthMode::TokenProof, AuthMode::BotCredentials],
            password: None,
            login_per_min: 1000,
            global_per_min: 1000,
            lockout_after: 1000,
            actions_per_min: 1000,
            groups: 1,
            writer: false,
            snapshot_every: Duration::from_millis(300),
            odd_status: Vec::new(),
            sweep_timeout_s: None,
        }
    }
}

pub struct Gw {
    pub fleet: Fleet,
    pub engine: Engine,
    pub server: RunningServer,
    pub base: String,
    pub http: reqwest::Client,
    pub dir: tempfile::TempDir,
}

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .expect("client")
}

impl Gw {
    pub async fn start(o: Opts) -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut spec = FleetSpec::new(o.bots, dir.path().join("fb"));
        spec.closed_trades = o.closed;
        spec.snapshot_every = o.snapshot_every;
        spec.writer = o.writer.then(WriterConfig::default);
        let fleet = Fleet::start(spec).await.expect("fleet");
        for (i, odd) in &o.odd_status {
            fleet.bot(*i).expect("bot").set_mode(Mode::OddStatus(*odd));
        }
        let found: Vec<_> = fleet.manifest.bots.iter().map(discovered).collect();
        let state_dir = dir.path().join("gw");
        std::fs::create_dir_all(&state_dir).expect("state dir");

        let mut cfg = GatewayConfig::default();
        cfg.server.cors_origins = o.cors;
        cfg.auth.modes = o.modes;
        if let Some(p) = &o.password {
            cfg.auth.password_hash = Some(fg_server::password::hash_password(p).expect("hash"));
        }
        cfg.auth.login_rate_per_min = o.login_per_min;
        cfg.auth.global_login_rate_per_min = o.global_per_min;
        cfg.auth.lockout_after_failures = o.lockout_after;
        cfg.auth.actions_per_min = o.actions_per_min;
        if let Some(t) = o.sweep_timeout_s {
            cfg.hyperliquid.sweep_timeout_s = t;
        }
        cfg.storage.data_dir = state_dir.to_string_lossy().into_owned();

        let mut ecfg = cfg.engine_config();
        ecfg.cadences = Cadences::default().scaled(SCALE);
        ecfg.budget = BudgetConfig {
            rate_per_s: 2.8 * SCALE,
            burst: 30,
            max_in_flight: 6,
        };
        let engine = Engine::start(
            ecfg,
            EngineSources {
                discovery: Arc::new(ManifestDiscovery(found)),
                ledger: Arc::new(SqliteLedger::new(LedgerOptions::default())),
                daemon: Some(Arc::new(UnixDaemon::new(&fleet.manifest.daemon_socket))),
                connector: Arc::new(HttpConnector::new(RestOptions::default())),
                ws: Arc::new(WsClient::default()),
                ticker: None,
            },
            Arc::new(SystemClock),
        )
        .await
        .expect("engine");

        let user_fp = Secret::new("fake-user").fingerprint();
        let bots: Vec<DirBot> = fleet
            .manifest
            .bots
            .iter()
            .map(|b| DirBot {
                key: fg_core::identity::BotKey::Local(b.port),
                name: b.name.clone(),
                live: b.live,
                host: "127.0.0.1".into(),
                port: b.port,
                group: format!("g{}", b.index % o.groups.max(1)),
                user_fp: Some(user_fp.clone()),
            })
            .collect();
        let state = make_state(
            cfg,
            engine.handle(),
            Arc::new(StaticDirectory(bots)),
            Arc::new(HttpProbe::new()),
        )
        .await
        .expect("state");
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let server = serve(listener, state);
        let base = format!("http://{}/gw/v1", server.addr);
        Self {
            fleet,
            engine,
            server,
            base,
            http: client(),
            dir,
        }
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    pub fn ws_url(&self) -> String {
        format!("ws://{}/gw/v1/ws", self.server.addr)
    }

    pub fn port(&self, i: usize) -> u16 {
        self.fleet.manifest.bots[i].port
    }

    pub fn key(&self, i: usize) -> String {
        format!("local:{}", self.port(i))
    }

    pub fn req(
        &self,
        method: reqwest::Method,
        path: &str,
        token: Option<&str>,
    ) -> reqwest::RequestBuilder {
        let r = self.http.request(method, self.url(path));
        match token {
            Some(t) => r.bearer_auth(t),
            None => r,
        }
    }

    pub async fn get_json(&self, path: &str, token: &str) -> Value {
        let r = self
            .req(reqwest::Method::GET, path, Some(token))
            .send()
            .await
            .expect("send");
        assert!(r.status().is_success(), "GET {path} -> {}", r.status());
        r.json().await.expect("json")
    }

    /// An access token of fake bot `i`, obtained the way the SPA does.
    pub async fn bot_token(&self, i: usize) -> String {
        let r = self
            .http
            .post(format!(
                "http://127.0.0.1:{}/api/v1/token/login",
                self.port(i)
            ))
            .basic_auth("fake-user", Some("fake-pass"))
            .send()
            .await
            .expect("login");
        let v: Value = r.json().await.expect("json");
        v["access_token"].as_str().expect("token").to_owned()
    }

    pub async fn bootstrap_body(&self, bots: &[usize], device: &str) -> Value {
        let mut list = Vec::new();
        for &i in bots {
            list.push(json!({
                "ui_id": format!("ftbot.{i}"),
                "botName": self.fleet.manifest.bots[i].name,
                "apiUrl": format!("http://127.0.0.1:{}", self.port(i)),
                "accessToken": self.bot_token(i).await,
            }));
        }
        json!({"device_id": device, "bots": list})
    }

    /// Open a session the silent way: prove a token of bot 0 (and list the others).
    pub async fn session(&self, device: &str) -> String {
        let all: Vec<usize> = (0..self.fleet.len()).collect();
        let body = self.bootstrap_body(&all, device).await;
        let r = self
            .http
            .post(self.url("/session/bootstrap"))
            .json(&body)
            .send()
            .await
            .expect("bootstrap");
        assert_eq!(r.status(), 200, "bootstrap");
        let v: Value = r.json().await.expect("json");
        v["session"].as_str().expect("session").to_owned()
    }

    pub async fn wait_online(&self, n: usize, limit: Duration) {
        let started = Instant::now();
        loop {
            let p = self.engine.handle().published();
            let online = p
                .bots
                .values()
                .filter(|b| b.state.status == fg_core::model::BotStatus::Online)
                .count();
            if online >= n && !p.positions.is_empty() {
                return;
            }
            assert!(
                started.elapsed() < limit,
                "only {online} of {n} bots online"
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    pub async fn stop(self) {
        self.server.shutdown().await;
        self.engine.shutdown().await;
    }
}

/// A WebSocket client of the gateway.
pub struct Ws {
    pub sock: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
}

pub enum Got {
    Json(Value),
    Closed(Option<u16>),
}

impl Ws {
    pub async fn connect(url: &str, origin: Option<&str>) -> Self {
        let mut req = url.into_client_request().expect("request");
        if let Some(o) = origin {
            req.headers_mut()
                .insert("Origin", o.parse().expect("origin"));
        }
        let (sock, _) = tokio_tungstenite::connect_async(req)
            .await
            .expect("ws connect");
        Self { sock }
    }

    pub async fn send(&mut self, v: Value) {
        self.sock
            .send(Message::text(v.to_string()))
            .await
            .expect("ws send");
    }

    /// The next text frame as JSON, or how the socket ended.
    pub async fn next(&mut self, limit: Duration) -> Option<Got> {
        loop {
            let m = tokio::time::timeout(limit, self.sock.next()).await.ok()?;
            match m {
                Some(Ok(Message::Text(t))) => {
                    return Some(Got::Json(
                        serde_json::from_str(t.as_str()).expect("json frame"),
                    ));
                }
                Some(Ok(Message::Close(f))) => {
                    return Some(Got::Closed(f.map(|f| u16::from(f.code))));
                }
                Some(Ok(_)) => {}
                Some(Err(_)) | None => return Some(Got::Closed(None)),
            }
        }
    }

    /// Frames until one matches (others are returned too, in order).
    pub async fn until(
        &mut self,
        limit: Duration,
        mut pred: impl FnMut(&Value) -> bool,
    ) -> Vec<Value> {
        let started = Instant::now();
        let mut seen = Vec::new();
        while started.elapsed() < limit {
            match self.next(limit.saturating_sub(started.elapsed())).await {
                Some(Got::Json(v)) => {
                    let done = pred(&v);
                    seen.push(v);
                    if done {
                        return seen;
                    }
                }
                _ => break,
            }
        }
        panic!("no matching frame; saw {seen:?}");
    }

    pub async fn auth(&mut self, token: &str, device: &str) -> Value {
        self.send(json!({"t": "auth", "token": token, "device_id": device}))
            .await;
        match self.next(Duration::from_secs(5)).await {
            Some(Got::Json(v)) => v,
            other => panic!(
                "no authed frame: {:?}",
                matches!(other, Some(Got::Closed(_)))
            ),
        }
    }
}

/// An HTTP/1.1 request written by hand, so that nothing normalises the path on the way (a URL
/// library would resolve `..` before the server ever saw it). Returns the status code.
pub async fn raw_status(
    addr: std::net::SocketAddr,
    method: &str,
    target: &str,
    headers: &[(&str, &str)],
) -> u16 {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut s = tokio::net::TcpStream::connect(addr).await.expect("connect");
    let mut req = format!(
        "{method} {target} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\nContent-Length: 0\r\n"
    );
    for (k, v) in headers {
        req.push_str(&format!("{k}: {v}\r\n"));
    }
    req.push_str("\r\n");
    s.write_all(req.as_bytes()).await.expect("write");
    let mut out = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(10), s.read_to_end(&mut out)).await;
    let text = String::from_utf8_lossy(&out);
    text.split_whitespace()
        .nth(1)
        .and_then(|c| c.parse().ok())
        .unwrap_or(0)
}
