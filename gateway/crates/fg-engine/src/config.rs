//! Settings of the engine: cadences (03 section 4.2), scheduling rules (4.3), publication
//! periods (6.2), retention and thresholds.

use std::path::PathBuf;
use std::time::Duration;

use fg_core::alerts::AlertRulesConfig;
use fg_core::calc::periods::Tz;

use crate::budget::BudgetConfig;

/// Polling period of a source in normal state and while a client looks at the bot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cadence {
    pub normal: Duration,
    pub viewed: Duration,
}

impl Cadence {
    #[must_use]
    pub const fn secs(normal: u64, viewed: u64) -> Self {
        Self {
            normal: Duration::from_secs(normal),
            viewed: Duration::from_secs(viewed),
        }
    }

    fn scaled(self, k: f64) -> Self {
        Self {
            normal: self.normal.div_f64(k),
            viewed: self.viewed.div_f64(k),
        }
    }
}

/// Cadences of every source. The defaults are the table of 03 section 4.2.
#[derive(Debug, Clone, PartialEq)]
pub struct Cadences {
    /// `/proc` and config files.
    pub discovery: Duration,
    pub digest: Duration,
    pub fleet_status: Cadence,
    pub fleet_events: Duration,
    pub daemon_stats: Cadence,
    /// `stat()` of the ledger and its `-wal`.
    pub ledger_stat: Cadence,
    pub status: Cadence,
    pub logs: Cadence,
    pub balance: Cadence,
    /// Whitelist, blacklist and locks.
    pub pairs: Cadence,
    /// `/show_config` and `/version`.
    pub config: Duration,
    pub ticker: Duration,
    /// Probe period of an offline bot: first failure, second, then the cap.
    pub offline_ping: [Duration; 3],
    /// A bot keeps its raised cadences this long after the last client left.
    pub viewed_hold: Duration,
    /// Alert evaluation period.
    pub alert_eval: Duration,
    /// Randomisation of every period, as a fraction (0.2 = plus or minus 20 %).
    pub jitter: f64,
    /// 1.0 in production; [`Cadences::scaled`] sets it so that the startup windows shrink too.
    pub time_scale: f64,
}

impl Default for Cadences {
    fn default() -> Self {
        Self {
            discovery: Duration::from_secs(30),
            digest: Duration::from_secs(5),
            fleet_status: Cadence::secs(15, 5),
            fleet_events: Duration::from_secs(5),
            daemon_stats: Cadence::secs(60, 15),
            ledger_stat: Cadence {
                normal: Duration::from_secs(2),
                viewed: Duration::from_secs(1),
            },
            status: Cadence::secs(60, 10),
            logs: Cadence::secs(30, 10),
            balance: Cadence::secs(120, 30),
            pairs: Cadence::secs(300, 30),
            config: Duration::from_secs(600),
            ticker: Duration::from_secs(120),
            offline_ping: [
                Duration::from_secs(30),
                Duration::from_secs(60),
                Duration::from_secs(120),
            ],
            viewed_hold: Duration::from_secs(30),
            alert_eval: Duration::from_secs(10),
            jitter: 0.2,
            time_scale: 1.0,
        }
    }
}

impl Cadences {
    /// Every period divided by `k`: compressed time for tests and demos. The token bucket of the
    /// request budget must be scaled by the same factor.
    #[must_use]
    pub fn scaled(&self, k: f64) -> Self {
        let d = |x: Duration| x.div_f64(k);
        Self {
            discovery: d(self.discovery),
            digest: d(self.digest),
            fleet_status: self.fleet_status.scaled(k),
            fleet_events: d(self.fleet_events),
            daemon_stats: self.daemon_stats.scaled(k),
            ledger_stat: self.ledger_stat.scaled(k),
            status: self.status.scaled(k),
            logs: self.logs.scaled(k),
            balance: self.balance.scaled(k),
            pairs: self.pairs.scaled(k),
            config: d(self.config),
            ticker: d(self.ticker),
            offline_ping: self.offline_ping.map(d),
            viewed_hold: d(self.viewed_hold),
            alert_eval: d(self.alert_eval),
            jitter: self.jitter,
            time_scale: self.time_scale * k,
        }
    }
}

/// Publication periods (coalescing, 03 section 6.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Publication {
    /// `fleet` frames: at most 4 per second.
    pub fleet: Duration,
    /// `positions` frames: prices at most once per second.
    pub positions: Duration,
    pub health: Duration,
}

impl Default for Publication {
    fn default() -> Self {
        Self {
            fleet: Duration::from_millis(250),
            positions: Duration::from_secs(1),
            health: Duration::from_secs(5),
        }
    }
}

/// Everything configurable about the engine.
#[derive(Debug, Clone)]
pub struct EngineConfig {
    /// Directory of the gateway's own `state.db` (never a bot database).
    pub data_dir: PathBuf,
    /// Time zone of calendar periods (owner decision: Europe/Paris, UTC optional).
    pub tz: Tz,
    pub cadences: Cadences,
    pub budget: BudgetConfig,
    pub publication: Publication,
    /// Threads reading bot ledgers at the same time.
    pub ledger_threads: usize,
    /// Events kept in memory (and re-read from `state.db` at start).
    pub event_ring: usize,
    /// Events older than this are purged from `state.db`.
    pub event_retention_days: u32,
    /// Log lines kept per bot for the `bot:<key>` channel.
    pub log_lines: usize,
    /// Default alert rules; the stored configuration of `state.db` wins when it exists.
    pub alert_rules: AlertRulesConfig,
    /// Ledger file name tokens that exclude a database (backup, replay, tmp).
    pub ignore_db_name_tokens: Vec<String>,
    /// Closed trades kept per bot in memory (the most recent ones win).
    pub max_closed_per_bot: usize,
    /// Closed-trade count below which a changed ledger is reloaded fully instead of
    /// incrementally (03 section 4.2).
    pub full_reload_below: usize,
}

impl EngineConfig {
    #[must_use]
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        Self {
            data_dir: data_dir.into(),
            tz: Tz::EuropeParis,
            cadences: Cadences::default(),
            budget: BudgetConfig::default(),
            publication: Publication::default(),
            ledger_threads: 4,
            event_ring: 5_000,
            event_retention_days: 30,
            log_lines: 100,
            alert_rules: AlertRulesConfig::default(),
            ignore_db_name_tokens: ["backup", "replay", "tmp"].map(String::from).to_vec(),
            max_closed_per_bot: 50_000,
            full_reload_below: 5_000,
        }
    }
}
