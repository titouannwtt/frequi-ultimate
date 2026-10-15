//! Per-bot REST client (03 sections 3.1, 4.2, 4.3).
//!
//! * Auth follows the freqtrade JWT flow: `POST /token/login` (Basic) gives an access token
//!   (15 min) and a refresh token (30 days); the access token is renewed every 12 minutes with
//!   `POST /token/refresh`, and a failed refresh falls back to a new login. Failed logins are
//!   rate limited by a local backoff so a wrong password cannot hammer (or lock) the bot.
//! * Reads have timeouts (8 s, 5 s for logs) and may be retried once after a 401.
//! * Writes have **no retry**, ever. A write is sent at most once per idempotency key:
//!   a repeated key returns the first outcome, or a duplicate error while the first is in flight.
//!   A write that may have reached the bot (timeout, reset) reports [`RestError::Uncertain`] so
//!   the caller never assumes it did not happen.
//! * The set of readable endpoints and of write actions is closed ([`ReadEndpoint`],
//!   [`WriteAction`]): the browser cannot make the gateway call an arbitrary path.
//! * Tokens are [`Secret`]s and are never logged; request URLs never contain a token.

use std::collections::HashMap;
use std::fmt;
use std::net::IpAddr;
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{Value, json};
use thiserror::Error;
use tokio::sync::Mutex;

use crate::discovery::{ApiCredentials, DiscoveredBot};
use crate::sensitive::Secret;
use crate::traits::{BotRest, BoxFut};

/// Failure of a REST call. Messages carry no URL, token or body.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum RestError {
    /// Connection refused or unreachable: counts toward "offline".
    #[error("connection refused")]
    Refused,
    /// No answer in time: counts toward "offline" for reads.
    #[error("timeout")]
    Timeout,
    /// Connection broken after the request was sent.
    #[error("connection reset")]
    Reset,
    /// HTTP 502 with "not in the correct state": the bot is starting. Not an offline signal.
    #[error("bot is starting")]
    Starting,
    /// HTTP 5xx.
    #[error("server error {0}")]
    Server(u16),
    /// HTTP 404: endpoint absent (bot without the fork endpoints).
    #[error("not found")]
    NotFound,
    /// Token rejected twice in a row.
    #[error("unauthorized")]
    Unauthorized,
    /// Login or refresh failed, or no credentials are known for this bot.
    #[error("authentication failed")]
    AuthFailed,
    /// Any other HTTP status.
    #[error("unexpected status {0}")]
    Status(u16),
    /// The body was not the expected JSON.
    #[error("undecodable response")]
    Decode,
    /// A write could not be delivered at all (refused): safe to try again later.
    #[error("write not sent")]
    NotSent,
    /// A write was sent but no answer was received: it may or may not have been applied.
    #[error("write outcome uncertain")]
    Uncertain,
    /// The idempotency key is already being processed.
    #[error("duplicate request in flight")]
    DuplicateInFlight,
}

impl RestError {
    /// Transport-level failure, the only kind the offline detector counts (03 section 4.3).
    #[must_use]
    pub fn counts_as_offline(&self) -> bool {
        matches!(
            self,
            Self::Refused | Self::Timeout | Self::Reset | Self::Server(_)
        )
    }
}

/// The endpoints the gateway reads. Paths are relative to `/api/v1`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadEndpoint {
    Status,
    /// Last `limit` log lines.
    Logs {
        limit: u32,
    },
    Balance,
    Whitelist,
    Blacklist,
    Locks,
    Profit,
    ProfitAll,
    Count,
    Trades {
        limit: u32,
        offset: u32,
    },
    ShowConfig,
    Version,
    Health,
}

impl ReadEndpoint {
    /// Path and query string.
    #[must_use]
    pub fn path(self) -> String {
        match self {
            Self::Status => "/status".into(),
            Self::Logs { limit } => format!("/logs?limit={limit}"),
            Self::Balance => "/balance".into(),
            Self::Whitelist => "/whitelist".into(),
            Self::Blacklist => "/blacklist".into(),
            Self::Locks => "/locks".into(),
            Self::Profit => "/profit".into(),
            Self::ProfitAll => "/profit_all".into(),
            Self::Count => "/count".into(),
            Self::Trades { limit, offset } => format!("/trades?limit={limit}&offset={offset}"),
            Self::ShowConfig => "/show_config".into(),
            Self::Version => "/version".into(),
            Self::Health => "/health".into(),
        }
    }

    fn timeout(self, opts: &RestOptions) -> Duration {
        match self {
            Self::Logs { .. } => opts.logs_timeout,
            _ => opts.read_timeout,
        }
    }
}

/// Direction of a forced entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntrySide {
    Long,
    Short,
}

/// The write actions the gateway may forward to a bot. Closed on purpose.
#[derive(Debug, Clone, PartialEq)]
pub enum WriteAction {
    ForceExit {
        trade_id: i64,
        ordertype: Option<String>,
        amount: Option<f64>,
    },
    ForceEnter {
        pair: String,
        side: EntrySide,
        price: Option<f64>,
        stake_amount: Option<f64>,
        ordertype: Option<String>,
        enter_tag: Option<String>,
        leverage: Option<f64>,
    },
    CancelOpenOrder {
        trade_id: i64,
    },
    DeleteTrade {
        trade_id: i64,
    },
    Start,
    Stop,
    Pause,
    StopEntry,
    ReloadConfig,
}

impl WriteAction {
    /// Stable name for the audit trail.
    #[must_use]
    pub fn name(&self) -> &'static str {
        match self {
            Self::ForceExit { .. } => "forceexit",
            Self::ForceEnter { .. } => "forceenter",
            Self::CancelOpenOrder { .. } => "cancel_open_order",
            Self::DeleteTrade { .. } => "delete_trade",
            Self::Start => "start",
            Self::Stop => "stop",
            Self::Pause => "pause",
            Self::StopEntry => "stopentry",
            Self::ReloadConfig => "reload_config",
        }
    }

    fn is_delete(&self) -> bool {
        matches!(
            self,
            Self::CancelOpenOrder { .. } | Self::DeleteTrade { .. }
        )
    }

    fn path(&self) -> String {
        match self {
            Self::ForceExit { .. } => "/forceexit".into(),
            Self::ForceEnter { .. } => "/forceenter".into(),
            Self::CancelOpenOrder { trade_id } => format!("/trades/{trade_id}/open-order"),
            Self::DeleteTrade { trade_id } => format!("/trades/{trade_id}"),
            Self::Start => "/start".into(),
            Self::Stop => "/stop".into(),
            Self::Pause => "/pause".into(),
            Self::StopEntry => "/stopentry".into(),
            Self::ReloadConfig => "/reload_config".into(),
        }
    }

    fn body(&self) -> Option<Value> {
        match self {
            Self::ForceExit {
                trade_id,
                ordertype,
                amount,
            } => {
                let mut o = json!({ "tradeid": trade_id.to_string() });
                set_opt(&mut o, "ordertype", ordertype.clone().map(Value::from));
                set_opt(&mut o, "amount", amount.map(Value::from));
                Some(o)
            }
            Self::ForceEnter {
                pair,
                side,
                price,
                stake_amount,
                ordertype,
                enter_tag,
                leverage,
            } => {
                let side = match side {
                    EntrySide::Long => "long",
                    EntrySide::Short => "short",
                };
                let mut o = json!({ "pair": pair, "side": side });
                set_opt(&mut o, "price", price.map(Value::from));
                set_opt(&mut o, "stakeamount", stake_amount.map(Value::from));
                set_opt(&mut o, "ordertype", ordertype.clone().map(Value::from));
                set_opt(&mut o, "entry_tag", enter_tag.clone().map(Value::from));
                set_opt(&mut o, "leverage", leverage.map(Value::from));
                Some(o)
            }
            _ => None,
        }
    }
}

fn set_opt(obj: &mut Value, key: &str, value: Option<Value>) {
    if let (Some(v), Some(map)) = (value, obj.as_object_mut()) {
        map.insert(key.to_owned(), v);
    }
}

/// Result of a write that reached the bot.
#[derive(Debug, Clone, PartialEq)]
pub struct WriteOutcome {
    pub status: u16,
    pub body: Value,
    pub latency_ms: u64,
}

impl WriteOutcome {
    #[must_use]
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }
}

/// What a bot supports, probed once per incarnation (03 section 4.3).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct BotFeatures {
    /// freqtrade version string (`/version`).
    pub version: Option<String>,
    /// REST API version (`/show_config`.`api_version`).
    pub api_version: Option<f64>,
    pub state: Option<String>,
    pub runmode: Option<String>,
    pub dry_run: Option<bool>,
    pub trading_mode: Option<String>,
    pub bot_name: Option<String>,
    pub strategy: Option<String>,
    pub max_open_trades: Option<i64>,
    /// The `/fleet/*` endpoints of this fork exist (`false` = upstream freqtrade).
    pub fleet_endpoints: bool,
}

/// Timeouts and token lifetime.
#[derive(Debug, Clone)]
pub struct RestOptions {
    pub connect_timeout: Duration,
    pub read_timeout: Duration,
    pub logs_timeout: Duration,
    pub write_timeout: Duration,
    pub ping_timeout: Duration,
    /// Age after which the access token is renewed (tokens live 15 min).
    pub access_ttl: Duration,
    /// After a failed login, no new login is attempted before this delay.
    pub login_backoff: Duration,
    /// How long a completed write is remembered for idempotency.
    pub idempotency_ttl: Duration,
}

impl Default for RestOptions {
    fn default() -> Self {
        Self {
            connect_timeout: Duration::from_secs(2),
            read_timeout: Duration::from_secs(8),
            logs_timeout: Duration::from_secs(5),
            write_timeout: Duration::from_secs(20),
            ping_timeout: Duration::from_secs(3),
            access_ttl: Duration::from_secs(12 * 60),
            login_backoff: Duration::from_secs(30),
            idempotency_ttl: Duration::from_secs(10 * 60),
        }
    }
}

/// How the gateway authenticates to one bot.
#[derive(Clone)]
pub enum BotAuth {
    /// `api_server.username/password` read from the bot config.
    Credentials(ApiCredentials),
    /// A refresh token uploaded by the browser (remote bots).
    RefreshToken(Secret),
}

impl fmt::Debug for BotAuth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Credentials(_) => f.write_str("BotAuth::Credentials(***)"),
            Self::RefreshToken(_) => f.write_str("BotAuth::RefreshToken(***)"),
        }
    }
}

/// The HTTP client type shared by all bot clients.
pub type HttpClient = reqwest::Client;

/// Build the HTTP client shared by all bots. Never uses a proxy: bots are on the loopback.
///
/// # Panics
/// Never in practice: the builder only fails when the TLS backend cannot initialise.
#[must_use]
pub fn build_http_client(opts: &RestOptions) -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(opts.connect_timeout)
        .pool_idle_timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("frequi-gateway/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("http client")
}

#[derive(Default)]
struct TokenState {
    access: Option<Secret>,
    access_at: Option<Instant>,
    refresh: Option<Secret>,
    last_auth_failure: Option<Instant>,
}

enum Idem {
    InFlight,
    Done(Instant, WriteOutcome),
}

/// REST client of one bot over HTTP.
pub struct HttpBot {
    base: String,
    client: reqwest::Client,
    auth: BotAuth,
    opts: RestOptions,
    tokens: Mutex<TokenState>,
    idem: StdMutex<HashMap<String, Idem>>,
    /// Static WebSocket token from the bot config, used when no JWT can be obtained.
    static_ws_token: Option<Secret>,
}

impl fmt::Debug for HttpBot {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // The base URL has no secret in it, but it is enough to show the port.
        f.debug_struct("HttpBot")
            .field("base", &self.base)
            .finish_non_exhaustive()
    }
}

/// Unauthenticated `GET /ping` on a bot (`host` is a dial address, see [`dial_host`]).
///
/// # Errors
/// The transport or HTTP failure, classified like every other call.
pub async fn ping_bot(
    client: &reqwest::Client,
    host: &str,
    port: u16,
    timeout: Duration,
) -> Result<(), RestError> {
    ping_url(
        client,
        &format!("http://{host}:{port}/api/v1/ping"),
        timeout,
    )
    .await
}

async fn ping_url(client: &reqwest::Client, url: &str, timeout: Duration) -> Result<(), RestError> {
    let resp = client
        .get(url)
        .timeout(timeout)
        .send()
        .await
        .map_err(|e| HttpBot::classify(&e))?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(HttpBot::error_for(resp).await)
    }
}

/// Address to dial for a bot that listens on `listen_ip` (a wildcard means loopback).
#[must_use]
pub fn dial_host(listen_ip: &str) -> String {
    match listen_ip.trim().parse::<IpAddr>() {
        Ok(ip) if ip.is_unspecified() => "127.0.0.1".to_owned(),
        Ok(IpAddr::V6(v6)) => format!("[{v6}]"),
        Ok(ip) => ip.to_string(),
        Err(_) => "127.0.0.1".to_owned(),
    }
}

#[derive(Deserialize)]
struct TokenPair {
    access_token: Secret,
    #[serde(default)]
    refresh_token: Option<Secret>,
}

impl HttpBot {
    #[must_use]
    pub fn new(
        host: &str,
        port: u16,
        auth: BotAuth,
        client: reqwest::Client,
        opts: RestOptions,
    ) -> Self {
        let mut tokens = TokenState::default();
        if let BotAuth::RefreshToken(r) = &auth {
            tokens.refresh = Some(r.clone());
        }
        Self {
            base: format!("http://{host}:{port}/api/v1"),
            client,
            auth,
            opts,
            tokens: Mutex::new(tokens),
            idem: StdMutex::new(HashMap::new()),
            static_ws_token: None,
        }
    }

    /// Client for a bot found by discovery; `None` when it has no API port or no credentials.
    #[must_use]
    pub fn from_discovered(
        bot: &DiscoveredBot,
        client: reqwest::Client,
        opts: RestOptions,
    ) -> Option<Self> {
        let port = bot.config.api.listen_port?;
        let creds = bot.config.api.credentials.clone()?;
        let mut me = Self::new(
            &dial_host(&bot.config.api.listen_ip),
            port,
            BotAuth::Credentials(creds),
            client,
            opts,
        );
        me.static_ws_token = bot.config.api.ws_token.clone();
        Some(me)
    }

    /// `ws://` URL base of the bot (no token in it).
    #[must_use]
    pub fn ws_base(&self) -> String {
        self.base.replacen("http://", "ws://", 1)
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    fn classify(e: &reqwest::Error) -> RestError {
        if e.is_timeout() {
            RestError::Timeout
        } else if e.is_connect() {
            RestError::Refused
        } else if e.is_decode() {
            RestError::Decode
        } else {
            RestError::Reset
        }
    }

    /// Valid access token, logging in or refreshing when needed. Single flight.
    async fn access_token(&self, force: bool) -> Result<Secret, RestError> {
        let mut st = self.tokens.lock().await;
        if !force
            && let (Some(tok), Some(at)) = (&st.access, st.access_at)
            && at.elapsed() < self.opts.access_ttl
        {
            return Ok(tok.clone());
        }
        if let Some(t) = st.last_auth_failure
            && t.elapsed() < self.opts.login_backoff
        {
            return Err(RestError::AuthFailed);
        }

        // 1. Refresh with the refresh token, when we have one.
        if let Some(refresh) = st.refresh.clone() {
            let resp = self
                .client
                .post(self.url("/token/refresh"))
                .bearer_auth(refresh.expose())
                .timeout(self.opts.read_timeout)
                .send()
                .await;
            match resp {
                Ok(r) if r.status().is_success() => {
                    if let Ok(pair) = r.json::<TokenPair>().await {
                        st.access = Some(pair.access_token.clone());
                        st.access_at = Some(Instant::now());
                        st.last_auth_failure = None;
                        return Ok(pair.access_token);
                    }
                }
                Ok(_) => {}
                Err(e) => return Err(Self::classify(&e)),
            }
            // Refresh rejected: fall through to a new login when credentials exist.
            st.refresh = None;
        }

        // 2. Basic login.
        let BotAuth::Credentials(creds) = &self.auth else {
            st.last_auth_failure = Some(Instant::now());
            return Err(RestError::AuthFailed);
        };
        let resp = self
            .client
            .post(self.url("/token/login"))
            .basic_auth(creds.username.expose(), Some(creds.password.expose()))
            .timeout(self.opts.read_timeout)
            .send()
            .await
            .map_err(|e| Self::classify(&e))?;
        if !resp.status().is_success() {
            st.last_auth_failure = Some(Instant::now());
            st.access = None;
            return Err(if resp.status().is_server_error() {
                RestError::Server(resp.status().as_u16())
            } else {
                RestError::AuthFailed
            });
        }
        let pair: TokenPair = resp.json().await.map_err(|_| RestError::Decode)?;
        st.access = Some(pair.access_token.clone());
        st.access_at = Some(Instant::now());
        st.refresh = pair.refresh_token;
        st.last_auth_failure = None;
        Ok(pair.access_token)
    }

    async fn invalidate_access(&self) {
        let mut st = self.tokens.lock().await;
        st.access = None;
        st.access_at = None;
    }

    /// Map a non-success response to an error. The body is read only to recognise the
    /// "not in the correct state" 502 and is never kept.
    async fn error_for(resp: reqwest::Response) -> RestError {
        let status = resp.status().as_u16();
        match status {
            401 => RestError::Unauthorized,
            404 => RestError::NotFound,
            502 => {
                let text = resp.text().await.unwrap_or_default();
                if text
                    .to_ascii_lowercase()
                    .contains("not in the correct state")
                {
                    RestError::Starting
                } else {
                    RestError::Server(502)
                }
            }
            500..=599 => RestError::Server(status),
            _ => RestError::Status(status),
        }
    }

    async fn get_json(&self, path: &str, timeout: Duration) -> Result<Value, RestError> {
        let mut forced = false;
        loop {
            let token = self.access_token(forced).await?;
            let resp = self
                .client
                .get(self.url(path))
                .bearer_auth(token.expose())
                .timeout(timeout)
                .send()
                .await
                .map_err(|e| Self::classify(&e))?;
            if resp.status().is_success() {
                return resp.json::<Value>().await.map_err(|_| RestError::Decode);
            }
            let err = Self::error_for(resp).await;
            if err == RestError::Unauthorized && !forced {
                // The token may have expired between two checks: one fresh login, one retry.
                self.invalidate_access().await;
                forced = true;
                continue;
            }
            return Err(err);
        }
    }

    async fn do_ping(&self) -> Result<(), RestError> {
        ping_url(&self.client, &self.url("/ping"), self.opts.ping_timeout).await
    }

    async fn do_features(&self) -> Result<BotFeatures, RestError> {
        let cfg = self
            .get_json("/show_config", self.opts.read_timeout)
            .await?;
        let mut f = BotFeatures {
            version: cfg
                .get("version")
                .and_then(Value::as_str)
                .map(str::to_owned),
            api_version: cfg.get("api_version").and_then(Value::as_f64),
            state: cfg.get("state").and_then(Value::as_str).map(str::to_owned),
            runmode: cfg
                .get("runmode")
                .and_then(Value::as_str)
                .map(str::to_owned),
            dry_run: cfg.get("dry_run").and_then(Value::as_bool),
            trading_mode: cfg
                .get("trading_mode")
                .and_then(Value::as_str)
                .map(str::to_owned),
            bot_name: cfg
                .get("bot_name")
                .and_then(Value::as_str)
                .map(str::to_owned),
            strategy: cfg
                .get("strategy")
                .and_then(Value::as_str)
                .map(str::to_owned),
            max_open_trades: cfg.get("max_open_trades").and_then(Value::as_i64),
            fleet_endpoints: false,
        };
        if f.version.is_none()
            && let Ok(v) = self.get_json("/version", self.opts.read_timeout).await
        {
            f.version = v.get("version").and_then(Value::as_str).map(str::to_owned);
        }
        // 404 on an endpoint of this fork means upstream freqtrade; any other answer means present.
        f.fleet_endpoints = match self.get_json("/fleet/status", self.opts.read_timeout).await {
            Err(RestError::NotFound) => false,
            Err(e) if e.counts_as_offline() && !matches!(e, RestError::Server(_)) => return Err(e),
            _ => true,
        };
        Ok(f)
    }

    async fn do_write(&self, action: WriteAction, key: String) -> Result<WriteOutcome, RestError> {
        // Idempotency guard: decide before anything is sent.
        {
            let mut map = self.idem.lock().map_err(|_| RestError::NotSent)?;
            let ttl = self.opts.idempotency_ttl;
            map.retain(|_, v| match v {
                Idem::Done(at, _) => at.elapsed() < ttl,
                Idem::InFlight => true,
            });
            match map.get(&key) {
                Some(Idem::InFlight) => return Err(RestError::DuplicateInFlight),
                Some(Idem::Done(_, outcome)) => return Ok(outcome.clone()),
                None => {
                    map.insert(key.clone(), Idem::InFlight);
                }
            }
        }
        let result = self.send_write_once(&action).await;
        let mut map = self.idem.lock().map_err(|_| RestError::NotSent)?;
        match &result {
            // Delivered (whatever the bot answered): remember it, never send it again.
            Ok(outcome) => {
                map.insert(key, Idem::Done(Instant::now(), outcome.clone()));
            }
            // Never left the machine: the caller may try again with the same key.
            Err(RestError::NotSent | RestError::Refused | RestError::AuthFailed) => {
                map.remove(&key);
            }
            // Possibly applied: keep the key locked so that nothing re-sends it blindly.
            Err(_) => {
                map.insert(key, Idem::InFlight);
            }
        }
        result
    }

    /// Exactly one attempt. A refresh of the token happens *before* the request, never after a
    /// failure of it.
    async fn send_write_once(&self, action: &WriteAction) -> Result<WriteOutcome, RestError> {
        let token = self.access_token(false).await.map_err(|e| match e {
            RestError::Refused | RestError::Timeout | RestError::Reset => RestError::NotSent,
            other => other,
        })?;
        let url = self.url(&action.path());
        let builder = if action.is_delete() {
            self.client.delete(url)
        } else {
            self.client.post(url)
        };
        let mut builder = builder
            .bearer_auth(token.expose())
            .timeout(self.opts.write_timeout);
        if let Some(body) = action.body() {
            builder = builder.json(&body);
        }
        let started = Instant::now();
        let resp = builder.send().await.map_err(|e| {
            if e.is_connect() {
                RestError::NotSent
            } else {
                RestError::Uncertain
            }
        })?;
        let status = resp.status().as_u16();
        if status == 401 {
            self.invalidate_access().await;
        }
        // A body that cannot be read after the request went out does not make it "not sent".
        let text = resp.text().await.unwrap_or_default();
        let body = serde_json::from_str::<Value>(&text).unwrap_or(Value::String(text));
        Ok(WriteOutcome {
            status,
            body,
            latency_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        })
    }

    /// Token for the bot WebSocket: the JWT access token, or the static `ws_token` of the config.
    pub async fn ws_token(&self) -> Option<Secret> {
        match self.access_token(false).await {
            Ok(t) => Some(t),
            Err(_) => self.static_ws_token.clone(),
        }
    }
}

impl BotRest for HttpBot {
    fn ping(&self) -> BoxFut<'_, Result<(), RestError>> {
        Box::pin(self.do_ping())
    }

    fn read(&self, endpoint: ReadEndpoint) -> BoxFut<'_, Result<Value, RestError>> {
        Box::pin(async move {
            self.get_json(&endpoint.path(), endpoint.timeout(&self.opts))
                .await
        })
    }

    fn features(&self) -> BoxFut<'_, Result<BotFeatures, RestError>> {
        Box::pin(self.do_features())
    }

    fn write(
        &self,
        action: WriteAction,
        idempotency_key: String,
    ) -> BoxFut<'_, Result<WriteOutcome, RestError>> {
        Box::pin(self.do_write(action, idempotency_key))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use crate::testutil::{FakeHttp, FakeRequest, FakeResponse};

    const USER: &str = "api-user-xyz";
    const PASS: &str = "api-pass-xyz";

    fn creds() -> ApiCredentials {
        ApiCredentials {
            username: Secret::new(USER),
            password: Secret::new(PASS),
        }
    }

    fn bot(fake: &FakeHttp, opts: RestOptions) -> HttpBot {
        HttpBot::new(
            "127.0.0.1",
            fake.addr.port(),
            BotAuth::Credentials(creds()),
            build_http_client(&opts),
            opts,
        )
    }

    /// A freqtrade-like bot: login/refresh, Bearer-protected reads.
    fn freqtrade_like(req: &FakeRequest) -> FakeResponse {
        let authz = req
            .headers
            .get("authorization")
            .cloned()
            .unwrap_or_default();
        match (req.method.as_str(), req.path()) {
            ("GET", "/api/v1/ping") => FakeResponse::json(200, r#"{"status":"pong"}"#),
            ("POST", "/api/v1/token/login") => {
                use std::io::Write as _;
                let mut expected = Vec::new();
                write!(expected, "{USER}:{PASS}").unwrap();
                let b64 = base64(&expected);
                if authz == format!("Basic {b64}") {
                    FakeResponse::json(
                        200,
                        r#"{"access_token":"ACCESS-1","refresh_token":"REFRESH-1"}"#,
                    )
                } else {
                    FakeResponse::json(401, r#"{"detail":"Incorrect username or password"}"#)
                }
            }
            ("POST", "/api/v1/token/refresh") => {
                if authz == "Bearer REFRESH-1" {
                    FakeResponse::json(200, r#"{"access_token":"ACCESS-2"}"#)
                } else {
                    FakeResponse::json(401, r#"{"detail":"Could not validate credentials"}"#)
                }
            }
            (_, p) if p.starts_with("/api/v1/") && !authz.starts_with("Bearer ACCESS-") => {
                FakeResponse::json(401, r#"{"detail":"Unauthorized"}"#)
            }
            ("GET", "/api/v1/show_config") => FakeResponse::json(
                200,
                r#"{"version":"2026.9","api_version":2.45,"dry_run":false,"trading_mode":"futures",
                    "state":"running","runmode":"live","bot_name":"hippo","strategy":"S","max_open_trades":3}"#,
            ),
            ("GET", "/api/v1/fleet/status") => FakeResponse::json(200, "{}"),
            ("GET", "/api/v1/status") => FakeResponse::json(200, r#"[{"trade_id":1}]"#),
            ("POST", "/api/v1/forceexit") => {
                FakeResponse::json(200, r#"{"result":"Created exit order for trade 7."}"#)
            }
            ("DELETE", "/api/v1/trades/7") => FakeResponse::json(200, r#"{"result":"deleted"}"#),
            _ => FakeResponse::json(404, r#"{"detail":"Not Found"}"#),
        }
    }

    fn base64(input: &[u8]) -> String {
        const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for c in input.chunks(3) {
            let n = (u32::from(c[0]) << 16)
                | (u32::from(*c.get(1).unwrap_or(&0)) << 8)
                | u32::from(*c.get(2).unwrap_or(&0));
            out.push(T[(n >> 18) as usize & 63] as char);
            out.push(T[(n >> 12) as usize & 63] as char);
            out.push(if c.len() > 1 {
                T[(n >> 6) as usize & 63] as char
            } else {
                '='
            });
            out.push(if c.len() > 2 {
                T[n as usize & 63] as char
            } else {
                '='
            });
        }
        out
    }

    #[tokio::test]
    async fn login_then_authenticated_read_and_token_reuse() {
        let fake = FakeHttp::start(freqtrade_like).await;
        let b = bot(&fake, RestOptions::default());
        b.ping().await.unwrap();
        let v = b.read(ReadEndpoint::Status).await.unwrap();
        assert_eq!(v[0]["trade_id"], 1);
        b.read(ReadEndpoint::Status).await.unwrap();
        assert_eq!(
            fake.count("POST", "/api/v1/token/login"),
            1,
            "the token is reused"
        );
        assert_eq!(fake.count("GET", "/api/v1/status"), 2);
    }

    #[tokio::test]
    async fn expired_access_token_is_renewed_with_the_refresh_token_not_a_new_login() {
        let fake = FakeHttp::start(freqtrade_like).await;
        let opts = RestOptions {
            access_ttl: Duration::from_millis(1),
            ..RestOptions::default()
        };
        let b = bot(&fake, opts);
        b.read(ReadEndpoint::Status).await.unwrap();
        tokio::time::sleep(Duration::from_millis(5)).await;
        let before = fake.requests().len();
        b.read(ReadEndpoint::Status).await.unwrap();
        let reqs = fake.requests();
        let new: Vec<&str> = reqs[before..].iter().map(|r| r.path()).collect();
        assert_eq!(new, ["/api/v1/token/refresh", "/api/v1/status"]);
        assert_eq!(fake.count("POST", "/api/v1/token/login"), 1);
    }

    #[tokio::test]
    async fn a_rejected_refresh_falls_back_to_a_new_basic_login() {
        let fake = FakeHttp::start(|req| {
            if req.path() == "/api/v1/token/refresh" {
                return FakeResponse::json(401, "{}");
            }
            freqtrade_like(req)
        })
        .await;
        let opts = RestOptions {
            access_ttl: Duration::from_millis(1),
            ..RestOptions::default()
        };
        let b = bot(&fake, opts);
        b.read(ReadEndpoint::Status).await.unwrap();
        tokio::time::sleep(Duration::from_millis(5)).await;
        b.read(ReadEndpoint::Status).await.unwrap();
        assert_eq!(fake.count("POST", "/api/v1/token/refresh"), 1);
        assert_eq!(
            fake.count("POST", "/api/v1/token/login"),
            2,
            "login again after the refresh failed"
        );
    }

    #[tokio::test]
    async fn a_token_rejected_by_the_bot_is_replaced_once_for_reads() {
        let first = Arc::new(AtomicUsize::new(0));
        let f = Arc::clone(&first);
        let fake = FakeHttp::start(move |req| {
            // The first status call is refused as if the token had just expired.
            if req.path() == "/api/v1/status" && f.fetch_add(1, Ordering::SeqCst) == 0 {
                return FakeResponse::json(401, "{}");
            }
            freqtrade_like(req)
        })
        .await;
        let b = bot(&fake, RestOptions::default());
        b.read(ReadEndpoint::Status).await.unwrap();
        assert_eq!(
            fake.count("GET", "/api/v1/status"),
            2,
            "one retry after re-authentication"
        );
    }

    #[tokio::test]
    async fn wrong_password_fails_once_then_backs_off_without_hammering() {
        let fake = FakeHttp::start(freqtrade_like).await;
        let opts = RestOptions::default();
        let b = HttpBot::new(
            "127.0.0.1",
            fake.addr.port(),
            BotAuth::Credentials(ApiCredentials {
                username: Secret::new(USER),
                password: Secret::new("wrong"),
            }),
            build_http_client(&opts),
            opts,
        );
        assert_eq!(
            b.read(ReadEndpoint::Status).await.unwrap_err(),
            RestError::AuthFailed
        );
        for _ in 0..5 {
            assert_eq!(
                b.read(ReadEndpoint::Status).await.unwrap_err(),
                RestError::AuthFailed
            );
        }
        assert_eq!(
            fake.count("POST", "/api/v1/token/login"),
            1,
            "login backoff protects the bot"
        );
    }

    #[tokio::test]
    async fn uploaded_refresh_token_flow() {
        let fake = FakeHttp::start(freqtrade_like).await;
        let opts = RestOptions::default();
        let b = HttpBot::new(
            "127.0.0.1",
            fake.addr.port(),
            BotAuth::RefreshToken(Secret::new("REFRESH-1")),
            build_http_client(&opts),
            opts,
        );
        b.read(ReadEndpoint::Status).await.unwrap();
        assert_eq!(fake.count("POST", "/api/v1/token/refresh"), 1);
        assert_eq!(
            fake.count("POST", "/api/v1/token/login"),
            0,
            "no credentials, no login"
        );

        let bad = HttpBot::new(
            "127.0.0.1",
            fake.addr.port(),
            BotAuth::RefreshToken(Secret::new("EXPIRED")),
            build_http_client(&RestOptions::default()),
            RestOptions::default(),
        );
        assert_eq!(
            bad.read(ReadEndpoint::Status).await.unwrap_err(),
            RestError::AuthFailed
        );
    }

    #[tokio::test]
    async fn features_are_probed_and_upstream_bots_are_detected_by_404() {
        let fake = FakeHttp::start(freqtrade_like).await;
        let f = bot(&fake, RestOptions::default()).features().await.unwrap();
        assert_eq!(f.version.as_deref(), Some("2026.9"));
        assert_eq!(f.api_version, Some(2.45));
        assert_eq!(f.trading_mode.as_deref(), Some("futures"));
        assert_eq!(f.max_open_trades, Some(3));
        assert!(f.fleet_endpoints);

        let upstream = FakeHttp::start(|req| {
            if req.path() == "/api/v1/fleet/status" {
                FakeResponse::json(404, "{}")
            } else {
                freqtrade_like(req)
            }
        })
        .await;
        let f = bot(&upstream, RestOptions::default())
            .features()
            .await
            .unwrap();
        assert!(
            !f.fleet_endpoints,
            "404 on the fork endpoint = upstream freqtrade"
        );
    }

    #[tokio::test]
    async fn status_codes_map_to_errors() {
        let fake = FakeHttp::start(|req| match req.path() {
            "/api/v1/token/login" => {
                FakeResponse::json(200, r#"{"access_token":"ACCESS-1","refresh_token":"R"}"#)
            }
            "/api/v1/status" => {
                FakeResponse::json(502, r#"{"detail":"Bot is not in the correct state"}"#)
            }
            "/api/v1/balance" => FakeResponse::json(500, r#"{"detail":"boom with secret-detail"}"#),
            "/api/v1/profit" => FakeResponse::json(200, "<html>not json"),
            "/api/v1/count" => FakeResponse::json(418, "{}"),
            _ => FakeResponse::json(404, "{}"),
        })
        .await;
        let b = bot(&fake, RestOptions::default());
        assert_eq!(
            b.read(ReadEndpoint::Status).await.unwrap_err(),
            RestError::Starting
        );
        let e = b.read(ReadEndpoint::Balance).await.unwrap_err();
        assert_eq!(e, RestError::Server(500));
        assert!(!format!("{e} {e:?}").contains("secret-detail"));
        assert_eq!(
            b.read(ReadEndpoint::Profit).await.unwrap_err(),
            RestError::Decode
        );
        assert_eq!(
            b.read(ReadEndpoint::Count).await.unwrap_err(),
            RestError::Status(418)
        );
        assert_eq!(
            b.read(ReadEndpoint::Whitelist).await.unwrap_err(),
            RestError::NotFound
        );
        assert!(!RestError::Starting.counts_as_offline());
        assert!(RestError::Server(500).counts_as_offline());
        assert!(RestError::Refused.counts_as_offline());
        assert!(!RestError::NotFound.counts_as_offline());
    }

    #[tokio::test]
    async fn refused_connection_and_timeouts_are_transport_errors() {
        // Nothing listens on this port.
        let opts = RestOptions::default();
        let b = HttpBot::new(
            "127.0.0.1",
            1,
            BotAuth::Credentials(creds()),
            build_http_client(&opts),
            opts,
        );
        assert_eq!(b.ping().await.unwrap_err(), RestError::Refused);

        let slow = FakeHttp::start(|req| {
            let mut r = freqtrade_like(req);
            if req.path() == "/api/v1/status" {
                r.delay = Some(Duration::from_millis(400));
            }
            r
        })
        .await;
        let opts = RestOptions {
            read_timeout: Duration::from_millis(100),
            ..RestOptions::default()
        };
        let b = bot(&slow, opts);
        assert_eq!(
            b.read(ReadEndpoint::Status).await.unwrap_err(),
            RestError::Timeout
        );
    }

    #[tokio::test]
    async fn a_write_is_sent_once_and_replayed_from_memory() {
        let fake = FakeHttp::start(freqtrade_like).await;
        let b = bot(&fake, RestOptions::default());
        let action = WriteAction::ForceExit {
            trade_id: 7,
            ordertype: Some("market".into()),
            amount: None,
        };
        let first = b.write(action.clone(), "key-1".into()).await.unwrap();
        assert!(first.is_success());
        let second = b.write(action, "key-1".into()).await.unwrap();
        assert_eq!(second, first, "same key returns the first outcome");
        assert_eq!(
            fake.count("POST", "/api/v1/forceexit"),
            1,
            "and does not reach the bot again"
        );

        let sent = fake
            .requests()
            .into_iter()
            .find(|r| r.path() == "/api/v1/forceexit")
            .unwrap();
        let body: Value = serde_json::from_str(&sent.body).unwrap();
        assert_eq!(body, json!({"tradeid": "7", "ordertype": "market"}));

        let del = b
            .write(WriteAction::DeleteTrade { trade_id: 7 }, "key-2".into())
            .await
            .unwrap();
        assert_eq!(del.body["result"], "deleted");
        assert_eq!(fake.count("DELETE", "/api/v1/trades/7"), 1);
    }

    #[tokio::test]
    async fn writes_are_never_retried_even_when_the_bot_fails() {
        let hits = Arc::new(AtomicUsize::new(0));
        let h = Arc::clone(&hits);
        let fake = FakeHttp::start(move |req| {
            if req.path() == "/api/v1/forceexit" {
                h.fetch_add(1, Ordering::SeqCst);
                return FakeResponse::json(500, r#"{"detail":"fail"}"#);
            }
            freqtrade_like(req)
        })
        .await;
        let b = bot(&fake, RestOptions::default());
        let out = b
            .write(
                WriteAction::ForceExit {
                    trade_id: 1,
                    ordertype: None,
                    amount: None,
                },
                "k".into(),
            )
            .await
            .unwrap();
        assert_eq!(out.status, 500, "the bot's answer is returned as is");
        assert_eq!(hits.load(Ordering::SeqCst), 1, "exactly one attempt");
    }

    #[tokio::test]
    async fn a_timed_out_write_is_uncertain_and_its_key_stays_locked() {
        let hits = Arc::new(AtomicUsize::new(0));
        let h = Arc::clone(&hits);
        let fake = FakeHttp::start(move |req| {
            if req.path() == "/api/v1/forceexit" {
                h.fetch_add(1, Ordering::SeqCst);
                let mut r = FakeResponse::json(200, "{}");
                r.delay = Some(Duration::from_millis(400));
                return r;
            }
            freqtrade_like(req)
        })
        .await;
        let opts = RestOptions {
            write_timeout: Duration::from_millis(100),
            ..RestOptions::default()
        };
        let b = bot(&fake, opts);
        let action = WriteAction::ForceExit {
            trade_id: 1,
            ordertype: None,
            amount: None,
        };
        assert_eq!(
            b.write(action.clone(), "k".into()).await.unwrap_err(),
            RestError::Uncertain
        );
        assert_eq!(
            b.write(action, "k".into()).await.unwrap_err(),
            RestError::DuplicateInFlight,
            "an uncertain write is not re-sent blindly"
        );
        tokio::time::sleep(Duration::from_millis(450)).await;
        assert_eq!(hits.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_write_to_a_dead_bot_is_not_sent_and_may_be_retried_by_the_caller() {
        let opts = RestOptions::default();
        let b = HttpBot::new(
            "127.0.0.1",
            1,
            BotAuth::Credentials(creds()),
            build_http_client(&opts),
            opts,
        );
        let a = WriteAction::Stop;
        assert_eq!(
            b.write(a.clone(), "k".into()).await.unwrap_err(),
            RestError::NotSent
        );
        // Same key again: not locked, because nothing left the machine.
        assert_eq!(
            b.write(a, "k".into()).await.unwrap_err(),
            RestError::NotSent
        );
    }

    #[tokio::test]
    async fn concurrent_writes_with_the_same_key_send_one_request() {
        let fake = FakeHttp::start(|req| {
            let mut r = freqtrade_like(req);
            if req.path() == "/api/v1/forceexit" {
                r.delay = Some(Duration::from_millis(150));
            }
            r
        })
        .await;
        let b = Arc::new(bot(&fake, RestOptions::default()));
        let action = WriteAction::ForceExit {
            trade_id: 7,
            ordertype: None,
            amount: None,
        };
        let tasks: Vec<_> = (0..4)
            .map(|_| {
                let (b, a) = (Arc::clone(&b), action.clone());
                tokio::spawn(async move { b.write(a, "same".into()).await })
            })
            .collect();
        let mut ok = 0;
        let mut dup = 0;
        for t in tasks {
            match t.await.unwrap() {
                Ok(_) => ok += 1,
                Err(RestError::DuplicateInFlight) => dup += 1,
                Err(e) => panic!("{e:?}"),
            }
        }
        assert_eq!(fake.count("POST", "/api/v1/forceexit"), 1);
        assert!(ok >= 1 && ok + dup == 4);
    }

    #[test]
    fn credentials_never_show_in_debug_and_tokens_are_not_in_urls() {
        let opts = RestOptions::default();
        let b = HttpBot::new(
            "127.0.0.1",
            9056,
            BotAuth::Credentials(creds()),
            build_http_client(&opts),
            opts,
        );
        let shown = format!("{b:?} {:?}", b.auth);
        assert!(!shown.contains(USER) && !shown.contains(PASS), "{shown}");
        assert_eq!(b.ws_base(), "ws://127.0.0.1:9056/api/v1");
        assert!(!b.url("/status").contains("token"));
    }

    #[test]
    fn wildcard_listen_addresses_are_dialled_on_loopback() {
        assert_eq!(dial_host("0.0.0.0"), "127.0.0.1");
        assert_eq!(dial_host("::"), "127.0.0.1");
        assert_eq!(dial_host(""), "127.0.0.1");
        assert_eq!(dial_host("127.0.0.1"), "127.0.0.1");
        assert_eq!(dial_host("10.1.2.3"), "10.1.2.3");
        assert_eq!(dial_host("::1"), "[::1]");
    }

    #[test]
    fn endpoint_and_action_tables() {
        assert_eq!(ReadEndpoint::Logs { limit: 100 }.path(), "/logs?limit=100");
        assert_eq!(
            ReadEndpoint::Trades {
                limit: 50,
                offset: 100
            }
            .path(),
            "/trades?limit=50&offset=100"
        );
        assert_eq!(
            WriteAction::CancelOpenOrder { trade_id: 3 }.path(),
            "/trades/3/open-order"
        );
        assert!(WriteAction::CancelOpenOrder { trade_id: 3 }.is_delete());
        assert!(!WriteAction::Stop.is_delete());
        let enter = WriteAction::ForceEnter {
            pair: "BTC/USDC:USDC".into(),
            side: EntrySide::Short,
            price: None,
            stake_amount: Some(25.0),
            ordertype: None,
            enter_tag: Some("manual".into()),
            leverage: Some(2.0),
        };
        assert_eq!(
            enter.body().unwrap(),
            json!({"pair": "BTC/USDC:USDC", "side": "short", "stakeamount": 25.0, "entry_tag": "manual", "leverage": 2.0})
        );
        assert_eq!(enter.name(), "forceenter");
    }
}
