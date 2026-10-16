//! Static description of a bot, taken from discovery (whitelisted config fields only).

use std::path::PathBuf;

use fg_core::identity::{BotKey, incarnation};
use fg_core::model::BotMode;
use fg_sources::discovery::DiscoveredBot;

/// What the engine knows about a bot from its config and its process. Never holds a credential
/// or a full wallet address.
#[derive(Debug, Clone, PartialEq)]
pub struct BotMeta {
    pub key: BotKey,
    pub name: String,
    pub mode: BotMode,
    pub strategy: Option<String>,
    pub exchange: Option<String>,
    pub stake_currency: String,
    pub port: Option<u16>,
    pub db_path: Option<PathBuf>,
    /// The ledger may be read (not ignored by name, a path is known).
    pub read_ledger: bool,
    /// Fingerprint of the account that holds the funds. Live bots only: a dry bot's balance is
    /// simulated per bot and never shared.
    pub wallet_id: Option<String>,
    /// `0xAbCd...1234`, the only form of the address that leaves the process.
    pub address_short: Option<String>,
    pub available_capital: Option<f64>,
    pub capital_withdrawal: f64,
    pub max_open_trades: Option<u32>,
    pub hip3_dexes: Vec<String>,
    pub incarnation: String,
    pub started_ms: Option<i64>,
    /// When the config was last read.
    pub scanned_ms: i64,
}

impl BotMeta {
    /// `hip3_dexes` as the borrowed slice list the pair parser wants.
    #[must_use]
    pub fn dexes(&self) -> Vec<&str> {
        self.hip3_dexes.iter().map(String::as_str).collect()
    }
}

fn looks_like_replay(b: &DiscoveredBot) -> bool {
    let has = |s: &str| s.to_ascii_lowercase().contains("replay");
    has(&b.config_name)
        || b.config.bot_name.as_deref().is_some_and(has)
        || b.db_path
            .as_ref()
            .and_then(|p| p.file_name())
            .is_some_and(|n| has(&n.to_string_lossy()))
}

/// Build the metadata of a discovered bot; `None` when it exposes no API port (no key).
#[must_use]
pub fn meta_from_discovered(b: &DiscoveredBot, now_ms: i64) -> Option<BotMeta> {
    let key = b.bot_key()?;
    let mode = if !b.config.is_dry() {
        BotMode::Live
    } else if looks_like_replay(b) {
        BotMode::Replay
    } else {
        BotMode::Dry
    };
    let name = b.display_name();
    let strategy = b.config.strategy.clone();
    let db = b
        .db_path
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let live = mode == BotMode::Live;
    Some(BotMeta {
        key,
        mode,
        incarnation: incarnation(
            &name,
            strategy.as_deref().unwrap_or(""),
            &db,
            b.process_start_ms.unwrap_or(0),
        ),
        name,
        strategy,
        exchange: b.config.exchange.name.clone(),
        stake_currency: b
            .config
            .stake_currency
            .clone()
            .unwrap_or_else(|| "USDC".to_owned()),
        port: b.config.api.listen_port,
        db_path: b.db_path.clone(),
        read_ledger: b.db_path.is_some() && !b.db_ignored,
        wallet_id: if live {
            b.config.exchange.wallet_id()
        } else {
            None
        },
        address_short: if live {
            b.config.exchange.address_short()
        } else {
            None
        },
        available_capital: b.config.available_capital,
        capital_withdrawal: b.config.capital_withdrawal,
        max_open_trades: b.config.max_open_trades.and_then(|n| u32::try_from(n).ok()),
        hip3_dexes: b.config.exchange.hip3_dexes.clone(),
        started_ms: b.process_start_ms,
        scanned_ms: now_ms,
    })
}
