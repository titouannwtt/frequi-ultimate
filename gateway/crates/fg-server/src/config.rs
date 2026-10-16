//! Configuration of the gateway (03 section 2.3): a TOML file, an optional `secrets.toml` that
//! must be private to its owner, and `FG_*` environment overrides (`FG_SERVER__LISTEN=...`).

use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use fg_core::alerts::AlertRulesConfig;
use fg_core::calc::periods::Tz;
use fg_engine::EngineConfig;
use fg_engine::budget::BudgetConfig;
use figment::Figment;
use figment::providers::{Env, Format, Serialized, Toml};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::redact::scrub;

/// How a browser can obtain a session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthMode {
    /// A valid access token of a local bot, already held by the SPA (03 section 3.2).
    TokenProof,
    /// The `api_server` username and password of a local bot, checked on that bot.
    BotCredentials,
    /// A password of the gateway itself (Argon2 hash in `secrets.toml`).
    Password,
}

impl AuthMode {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TokenProof => "token_proof",
            Self::BotCredentials => "bot_credentials",
            Self::Password => "password",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ServerSection {
    /// Address and port to listen on.
    pub listen: String,
    /// Exact origins of the UI that may call the gateway (`http://host:9400`).
    pub cors_origins: Vec<String>,
    /// Directory of a built UI to serve (not supported by this build; must stay empty).
    pub serve_ui_dir: String,
    /// Believe `X-Forwarded-For` when the peer is the loopback (behind a local reverse proxy).
    pub trust_forwarded_for: bool,
    /// Host names or addresses that mean "this machine" in the `apiUrl` of a browser's bots,
    /// besides localhost, 127.0.0.1 and the addresses of the network interfaces.
    pub local_hosts: Vec<String>,
}

impl Default for ServerSection {
    fn default() -> Self {
        Self {
            listen: "0.0.0.0:9399".into(),
            cors_origins: Vec::new(),
            serve_ui_dir: String::new(),
            trust_forwarded_for: false,
            local_hosts: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AuthSection {
    pub modes: Vec<AuthMode>,
    /// Sliding lifetime of a session.
    pub session_ttl_days: u32,
    /// Login and bootstrap attempts per minute and per client address (burst of the same size).
    pub login_rate_per_min: u32,
    /// Login and bootstrap attempts per minute, all clients together.
    pub global_login_rate_per_min: u32,
    /// Failed attempts of one address before it is locked out.
    pub lockout_after_failures: u32,
    pub lockout_minutes: u32,
    /// Write actions per minute and per session.
    pub actions_per_min: u32,
    /// Argon2 hash for the `password` mode. Only accepted from `secrets.toml` or the environment.
    pub password_hash: Option<String>,
}

impl Default for AuthSection {
    fn default() -> Self {
        Self {
            modes: vec![AuthMode::TokenProof, AuthMode::BotCredentials],
            session_ttl_days: 30,
            login_rate_per_min: 5,
            global_login_rate_per_min: 30,
            lockout_after_failures: 10,
            lockout_minutes: 15,
            actions_per_min: 30,
            password_hash: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DiscoverySection {
    /// Find the bots of this machine by scanning `/proc`.
    pub proc_scan: bool,
    /// Use the `api_server` credentials of the bots' merged configs (never exchange keys).
    pub read_api_credentials_from_config: bool,
    pub ignore_db_name_tokens: Vec<String>,
}

impl Default for DiscoverySection {
    fn default() -> Self {
        Self {
            proc_scan: true,
            read_api_credentials_from_config: true,
            ignore_db_name_tokens: ["backup", "replay", "tmp"].map(String::from).to_vec(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct FtcacheSection {
    /// Default: `/tmp/ftcache-<uid>.sock`. Empty string: do not use the daemon.
    pub socket: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct HyperliquidSection {
    /// At most one reconciliation sweep per wallet in this many seconds (cached answer in between).
    pub min_sweep_interval_s: u32,
}

impl Default for HyperliquidSection {
    fn default() -> Self {
        Self {
            min_sweep_interval_s: 60,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SchedulerSection {
    /// Sustained requests per second towards the bots, all bots together.
    pub request_rate_per_s: f64,
    pub request_burst: u32,
    pub max_in_flight: usize,
    pub ledger_threads: usize,
    /// Worker threads of the async runtime: 0 = automatic (the number of CPUs, between 2 and 4),
    /// otherwise 2 to 4. The host is shared; a gateway has no use for more.
    pub worker_threads: usize,
}

impl Default for SchedulerSection {
    fn default() -> Self {
        let b = BudgetConfig::default();
        Self {
            request_rate_per_s: b.rate_per_s,
            request_burst: b.burst,
            max_in_flight: b.max_in_flight,
            ledger_threads: 4,
            worker_threads: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct MarketSection {
    /// BTC and ETH ticker from CoinGecko (an external API, never the exchange).
    pub coingecko: bool,
}

impl Default for MarketSection {
    fn default() -> Self {
        Self { coingecko: true }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct StorageSection {
    pub data_dir: String,
}

impl Default for StorageSection {
    fn default() -> Self {
        Self {
            data_dir: "~/.local/share/frequi-gateway".into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct LogSection {
    pub level: String,
    /// `json` or `text`.
    pub format: String,
}

impl Default for LogSection {
    fn default() -> Self {
        Self {
            level: "info".into(),
            format: "json".into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct GeneralSection {
    /// Time zone that cuts days, weeks and months: `Europe/Paris` or `UTC`.
    pub timezone: String,
}

impl Default for GeneralSection {
    fn default() -> Self {
        Self {
            timezone: "Europe/Paris".into(),
        }
    }
}

/// The whole configuration.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct GatewayConfig {
    pub general: GeneralSection,
    pub server: ServerSection,
    pub auth: AuthSection,
    pub discovery: DiscoverySection,
    pub ftcache: FtcacheSection,
    pub hyperliquid: HyperliquidSection,
    pub scheduler: SchedulerSection,
    pub market: MarketSection,
    /// Default alert rules; the rules stored in `state.db` win once they exist.
    pub alerts: AlertRulesConfig,
    pub storage: StorageSection,
    pub log: LogSection,
}

/// Why the configuration cannot be used. Messages are scrubbed of credentials.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ConfigError {
    #[error("config file {0} not found")]
    Missing(String),
    #[error("{0}")]
    Invalid(String),
    #[error("secrets file {0} is readable by other users: run chmod 600")]
    SecretsTooOpen(String),
    #[error("{0} must be set in the secrets file or the environment, not in the main file")]
    SecretInMainFile(&'static str),
    #[error("{0}")]
    Problems(String),
}

/// A configuration with what was read to build it.
#[derive(Debug, Clone)]
pub struct Loaded {
    pub config: GatewayConfig,
    pub config_file: Option<PathBuf>,
    pub secrets_file: Option<PathBuf>,
}

/// `~/.config/frequi-gateway/config.toml`.
#[must_use]
pub fn default_config_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config/frequi-gateway/config.toml"))
}

/// Replace a leading `~` by the home directory.
#[must_use]
pub fn expand_home(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~/")
        && let Some(home) = std::env::var_os("HOME")
    {
        return PathBuf::from(home).join(rest);
    }
    if p == "~"
        && let Some(home) = std::env::var_os("HOME")
    {
        return PathBuf::from(home);
    }
    PathBuf::from(p)
}

const SECTIONS: [&str; 11] = [
    "general",
    "server",
    "auth",
    "discovery",
    "ftcache",
    "hyperliquid",
    "scheduler",
    "market",
    "alerts",
    "storage",
    "log",
];

fn secrets_mode_ok(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).is_ok_and(|m| m.permissions().mode() & 0o077 == 0)
}

fn figment_error(e: &figment::Error) -> ConfigError {
    ConfigError::Invalid(scrub(&e.to_string()).into_owned())
}

/// Load the configuration.
///
/// `config` is the explicit `--config` path (it must exist); without one the default path is
/// used when it exists. `secrets` defaults to `secrets.toml` next to the config file.
///
/// # Errors
/// [`ConfigError`] for a missing explicit file, a malformed or unknown key, a secrets file that
/// other users can read, or a secret placed in the main file.
pub fn load(config: Option<&Path>, secrets: Option<&Path>) -> Result<Loaded, ConfigError> {
    let explicit = config.is_some();
    let config_file = config.map(Path::to_path_buf).or_else(default_config_path);
    let config_file = match config_file {
        Some(p) if p.exists() => Some(p),
        Some(p) if explicit => return Err(ConfigError::Missing(p.display().to_string())),
        _ => None,
    };
    let secrets_file = secrets
        .map(Path::to_path_buf)
        .or_else(|| {
            config_file
                .as_ref()
                .and_then(|c| c.parent().map(|d| d.join("secrets.toml")))
        })
        .filter(|p| p.exists());

    let mut fig = Figment::from(Serialized::defaults(GatewayConfig::default()));
    if let Some(f) = &config_file {
        // A secret in the main file is refused: that file is the one people paste in tickets.
        let main = Figment::from(Toml::file(f));
        if main.find_value("auth.password_hash").is_ok() {
            return Err(ConfigError::SecretInMainFile("auth.password_hash"));
        }
        fig = fig.merge(Toml::file(f));
    }
    if let Some(s) = &secrets_file {
        if !secrets_mode_ok(s) {
            return Err(ConfigError::SecretsTooOpen(s.display().to_string()));
        }
        fig = fig.merge(Toml::file(s));
    }
    fig = fig.merge(Env::prefixed("FG_").split("__").filter(|k| {
        SECTIONS
            .iter()
            .any(|s| k.as_str().starts_with(&format!("{s}__")))
    }));
    let config: GatewayConfig = fig.extract().map_err(|e| figment_error(&e))?;
    Ok(Loaded {
        config,
        config_file,
        secrets_file,
    })
}

/// An origin as a browser sends it: `scheme://host[:port]`, nothing else.
#[must_use]
pub fn origin_is_valid(o: &str) -> bool {
    let Some((scheme, rest)) = o.split_once("://") else {
        return false;
    };
    matches!(scheme, "http" | "https")
        && !rest.is_empty()
        && !rest.contains(['/', '?', '#', '@', '*', ' '])
        && rest
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b':' | b'[' | b']'))
}

impl GatewayConfig {
    /// Everything that is wrong with this configuration, one message per problem.
    #[must_use]
    pub fn problems(&self) -> Vec<String> {
        let mut p = Vec::new();
        if self.server.listen.parse::<SocketAddr>().is_err() {
            p.push("server.listen must be an address like 0.0.0.0:9399".to_owned());
        }
        for o in &self.server.cors_origins {
            if !origin_is_valid(o) {
                p.push(format!(
                    "server.cors_origins: {o:?} is not an origin (scheme://host[:port], no path, no wildcard)"
                ));
            }
        }
        if !self.server.serve_ui_dir.is_empty() {
            p.push(
                "server.serve_ui_dir is not supported by this build: serve the UI from the bot"
                    .to_owned(),
            );
        }
        if self.auth.modes.is_empty() {
            p.push("auth.modes must not be empty".to_owned());
        }
        if self.auth.modes.contains(&AuthMode::Password) {
            match &self.auth.password_hash {
                None => p.push(
                    "auth.modes has \"password\" but auth.password_hash is not set (see hash-password)"
                        .to_owned(),
                ),
                Some(h) if !h.starts_with("$argon2") => {
                    p.push("auth.password_hash is not an Argon2 hash (see hash-password)".to_owned());
                }
                Some(_) => {}
            }
        }
        for (name, v) in [
            ("auth.session_ttl_days", self.auth.session_ttl_days),
            ("auth.login_rate_per_min", self.auth.login_rate_per_min),
            (
                "auth.global_login_rate_per_min",
                self.auth.global_login_rate_per_min,
            ),
            (
                "auth.lockout_after_failures",
                self.auth.lockout_after_failures,
            ),
            ("auth.lockout_minutes", self.auth.lockout_minutes),
            ("auth.actions_per_min", self.auth.actions_per_min),
            ("scheduler.request_burst", self.scheduler.request_burst),
        ] {
            if v == 0 {
                p.push(format!("{name} must be at least 1"));
            }
        }
        if !(self.scheduler.request_rate_per_s > 0.0 && self.scheduler.request_rate_per_s <= 10.0) {
            p.push("scheduler.request_rate_per_s must be in ]0, 10]".to_owned());
        }
        if self.scheduler.max_in_flight == 0 || self.scheduler.ledger_threads == 0 {
            p.push(
                "scheduler.max_in_flight and scheduler.ledger_threads must be at least 1"
                    .to_owned(),
            );
        }
        if self.scheduler.worker_threads != 0 && !(2..=4).contains(&self.scheduler.worker_threads) {
            p.push("scheduler.worker_threads must be 0 (automatic) or between 2 and 4".to_owned());
        }
        if self.tz().is_none() {
            p.push("general.timezone must be Europe/Paris or UTC".to_owned());
        }
        if self.storage.data_dir.trim().is_empty() {
            p.push("storage.data_dir must not be empty".to_owned());
        }
        if !matches!(self.log.format.as_str(), "json" | "text") {
            p.push("log.format must be json or text".to_owned());
        }
        if self
            .log
            .level
            .parse::<tracing_subscriber::filter::LevelFilter>()
            .is_err()
        {
            p.push("log.level must be one of error, warn, info, debug, trace".to_owned());
        }
        if let Some(s) = &self.ftcache.socket
            && !s.is_empty()
            && !s.starts_with('/')
        {
            p.push("ftcache.socket must be an absolute path".to_owned());
        }
        p
    }

    /// Validate; `Err` carries every problem.
    ///
    /// # Errors
    /// [`ConfigError::Problems`] listing them.
    pub fn validate(&self) -> Result<(), ConfigError> {
        let p = self.problems();
        if p.is_empty() {
            Ok(())
        } else {
            Err(ConfigError::Problems(p.join("\n")))
        }
    }

    #[must_use]
    pub fn tz(&self) -> Option<Tz> {
        match self.general.timezone.as_str() {
            "Europe/Paris" => Some(Tz::EuropeParis),
            "UTC" => Some(Tz::Utc),
            _ => None,
        }
    }

    #[must_use]
    pub fn data_dir(&self) -> PathBuf {
        expand_home(&self.storage.data_dir)
    }

    /// Origins lower-cased, as compared with the `Origin` header.
    #[must_use]
    pub fn allowed_origins(&self) -> Vec<String> {
        self.server
            .cors_origins
            .iter()
            .map(|o| o.trim_end_matches('/').to_ascii_lowercase())
            .collect()
    }

    /// The settings of the engine.
    #[must_use]
    pub fn engine_config(&self) -> EngineConfig {
        let mut e = EngineConfig::new(self.data_dir());
        e.tz = self.tz().unwrap_or_default();
        e.budget = BudgetConfig {
            rate_per_s: self.scheduler.request_rate_per_s,
            burst: self.scheduler.request_burst,
            max_in_flight: self.scheduler.max_in_flight,
        };
        e.ledger_threads = self.scheduler.ledger_threads;
        e.alert_rules = self.alerts.clone();
        e.ignore_db_name_tokens = self.discovery.ignore_db_name_tokens.clone();
        e
    }
}

impl SchedulerSection {
    /// Worker threads of the async runtime for a host with `cpus` processors.
    #[must_use]
    pub fn workers(&self, cpus: usize) -> usize {
        if self.worker_threads == 0 {
            cpus.clamp(2, 4)
        } else {
            self.worker_threads.clamp(2, 4)
        }
    }
}

/// The default configuration as a commented TOML file (`print-default-config`).
pub const DEFAULT_CONFIG_TOML: &str = r#"# frequi-gateway configuration (docs/redesign/03-gateway-architecture.md, section 2.3).
# Every key is optional; the values below are the defaults. Override any of them with an
# environment variable: FG_SERVER__LISTEN=127.0.0.1:9399.
# Secrets (auth.password_hash) go in secrets.toml next to this file, mode 600.

[general]
# Time zone that cuts days, weeks and months: "Europe/Paris" or "UTC".
timezone = "Europe/Paris"

[server]
listen = "0.0.0.0:9399"
# Exact origins of the UI that may call the gateway, for example ["http://myhost:9400"].
cors_origins = []
# Not supported by this build: the UI stays served by the bot (same origin, same localStorage).
serve_ui_dir = ""
# Believe X-Forwarded-For when the peer is the loopback (reverse proxy on the same machine).
trust_forwarded_for = false
# Names or addresses that mean "this machine" in a bot URL, besides localhost and the
# addresses of the network interfaces.
local_hosts = []

[auth]
# token_proof: the SPA proves it holds a valid access token of a local bot (no user action).
# bot_credentials: api_server username and password of a local bot, checked on that bot.
# password: a password of the gateway itself (auth.password_hash, see hash-password).
modes = ["token_proof", "bot_credentials"]
session_ttl_days = 30
login_rate_per_min = 5
global_login_rate_per_min = 30
lockout_after_failures = 10
lockout_minutes = 15
actions_per_min = 30

[discovery]
proc_scan = true
read_api_credentials_from_config = true
ignore_db_name_tokens = ["backup", "replay", "tmp"]

[ftcache]
# Default: /tmp/ftcache-<uid>.sock. An empty string turns the daemon off.
# socket = "/tmp/ftcache-1000.sock"

[hyperliquid]
# At most one reconciliation sweep per wallet in this many seconds.
min_sweep_interval_s = 60

[scheduler]
request_rate_per_s = 2.8
request_burst = 30
max_in_flight = 6
ledger_threads = 4
# Async worker threads: 0 = automatic (number of CPUs, between 2 and 4), or 2 to 4.
worker_threads = 0

[market]
# BTC and ETH ticker from CoinGecko (an external API, never the exchange).
coingecko = true

[storage]
data_dir = "~/.local/share/frequi-gateway"

[log]
level = "info"
# "json" or "text"
format = "json"
"#;

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    fn write(dir: &Path, name: &str, body: &str, mode: u32) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, body).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(mode)).unwrap();
        p
    }

    #[test]
    fn the_printed_default_config_is_the_default_config() {
        let dir = tempfile::tempdir().unwrap();
        let f = write(dir.path(), "config.toml", DEFAULT_CONFIG_TOML, 0o644);
        let loaded = load(Some(&f), Some(&dir.path().join("none.toml"))).unwrap();
        assert_eq!(loaded.config, GatewayConfig::default());
        assert_eq!(loaded.config.problems(), Vec::<String>::new());
    }

    #[test]
    fn the_runtime_has_two_to_four_workers_whatever_the_host_or_the_configuration() {
        let mut cfg = GatewayConfig::default();
        // Automatic: the number of CPUs, clamped.
        for (cpus, want) in [(1, 2), (2, 2), (3, 3), (4, 4), (32, 4), (128, 4)] {
            assert_eq!(cfg.scheduler.workers(cpus), want, "{cpus} cpus");
        }
        // Configured: honoured within the range, regardless of the host.
        cfg.scheduler.worker_threads = 3;
        assert_eq!(cfg.scheduler.workers(32), 3);
        assert_eq!(cfg.problems(), Vec::<String>::new());
        for bad in [1, 5, 64] {
            cfg.scheduler.worker_threads = bad;
            assert!(
                cfg.problems().iter().any(|p| p.contains("worker_threads")),
                "{bad} is refused"
            );
        }
        // And from the file.
        let dir = tempfile::tempdir().unwrap();
        let f = write(
            dir.path(),
            "c.toml",
            "[scheduler]\nworker_threads = 2\n",
            0o644,
        );
        let loaded = load(Some(&f), None).unwrap();
        assert_eq!(loaded.config.scheduler.workers(32), 2);
    }

    #[test]
    fn unknown_keys_and_bad_values_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let f = write(dir.path(), "c.toml", "[server]\nlistn = \"x\"\n", 0o644);
        assert!(matches!(load(Some(&f), None), Err(ConfigError::Invalid(_))));
        let f = write(
            dir.path(),
            "c2.toml",
            "[server]\nlisten = \"nope\"\ncors_origins = [\"*\", \"http://a:1/x\", \"http://ok:9400\"]\n[auth]\nmodes = [\"password\"]\n",
            0o644,
        );
        let c = load(Some(&f), None).unwrap().config;
        let p = c.problems().join("\n");
        assert!(p.contains("server.listen"), "{p}");
        assert!(p.contains("\"*\""), "{p}");
        assert!(p.contains("http://a:1/x"), "{p}");
        assert!(!p.contains("http://ok:9400"), "{p}");
        assert!(p.contains("password_hash"), "{p}");
    }

    #[test]
    fn a_missing_explicit_file_is_an_error_but_a_missing_default_is_not() {
        assert!(matches!(
            load(Some(Path::new("/nonexistent/c.toml")), None),
            Err(ConfigError::Missing(_))
        ));
    }

    #[test]
    fn secrets_must_be_private_and_must_not_sit_in_the_main_file() {
        let dir = tempfile::tempdir().unwrap();
        let hash = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNo";
        let main = write(
            dir.path(),
            "config.toml",
            "[auth]\nmodes = [\"password\"]\n",
            0o644,
        );
        let sec = write(
            dir.path(),
            "secrets.toml",
            &format!("[auth]\npassword_hash = \"{hash}\"\n"),
            0o644,
        );
        assert!(matches!(
            load(Some(&main), None),
            Err(ConfigError::SecretsTooOpen(_))
        ));
        std::fs::set_permissions(&sec, std::fs::Permissions::from_mode(0o600)).unwrap();
        let c = load(Some(&main), None).unwrap().config;
        assert_eq!(c.auth.password_hash.as_deref(), Some(hash));
        assert!(c.problems().is_empty());

        let bad = write(
            dir.path(),
            "bad.toml",
            &format!("[auth]\npassword_hash = \"{hash}\"\n"),
            0o644,
        );
        assert!(matches!(
            load(Some(&bad), Some(&sec)),
            Err(ConfigError::SecretInMainFile(_))
        ));
    }

    #[test]
    fn an_error_message_never_echoes_a_password_value() {
        let dir = tempfile::tempdir().unwrap();
        let f = write(
            dir.path(),
            "c.toml",
            "[auth]\nsession_ttl_days = \"password=hunter2\"\n",
            0o644,
        );
        let err = load(Some(&f), None).unwrap_err().to_string();
        assert!(!err.contains("hunter2"), "{err}");
    }

    #[test]
    fn origins_are_exact() {
        for ok in ["http://a:9400", "https://host.example", "http://[::1]:9400"] {
            assert!(origin_is_valid(ok), "{ok}");
        }
        for bad in [
            "*",
            "http://a/",
            "http://a/x",
            "a:9400",
            "ftp://a",
            "http://",
            "http://u@a",
        ] {
            assert!(!origin_is_valid(bad), "{bad}");
        }
    }

    #[test]
    fn the_engine_config_follows_the_file() {
        let mut c = GatewayConfig::default();
        c.general.timezone = "UTC".into();
        c.scheduler.request_rate_per_s = 1.5;
        c.storage.data_dir = "/var/lib/x".into();
        let e = c.engine_config();
        assert_eq!(e.tz, Tz::Utc);
        assert!((e.budget.rate_per_s - 1.5).abs() < 1e-9);
        assert_eq!(e.data_dir, PathBuf::from("/var/lib/x"));
    }
}
