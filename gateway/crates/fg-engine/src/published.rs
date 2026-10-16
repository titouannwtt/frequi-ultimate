//! The state clients read: an immutable [`Published`] swapped atomically, the keyed [`Differ`]
//! that turns two consecutive states into `up` frames, and the per-channel snapshots.

use std::collections::BTreeMap;
use std::sync::Arc;

use fg_core::alerts::Alert;
use fg_core::calc::drawdown::HistorySample;
use fg_core::identity::BotKey;
use fg_core::model::{
    BotDetail, BotMode, BotRow, Event, Health, HealthLevel, Position, ScopeTotals, Ticker,
    WalletRow,
};
use fg_core::protocol::differ::to_value;
pub use fg_core::protocol::differ::{CollectionDiff, Differ};
use fg_core::protocol::{Channel, LogScope};
use serde::Serialize;
use serde_json::Value;

use crate::closed::ClosedTrade;
use crate::error::EngineError;
use crate::ledger_data::ClosedDerived;

/// The history of a bot, shared with the queries (journal, equity, calendar).
#[derive(Debug, Clone)]
pub struct BotData {
    pub closed: Arc<Vec<ClosedTrade>>,
    /// Mode of the bot, for the journal rows rebuilt from `closed`.
    pub mode: BotMode,
    pub derived: Arc<ClosedDerived>,
    pub profit: Arc<Vec<HistorySample>>,
    pub version: u64,
}

/// One consistent picture of the fleet. Cloning clones `Arc`s only.
#[derive(Debug, Clone)]
pub struct Published {
    pub bots: Arc<BTreeMap<BotKey, BotRow>>,
    /// Keyed `bot_key/trade_id`.
    pub positions: Arc<BTreeMap<String, Position>>,
    /// Exact instant (ms) each position was last refreshed, same keys as `positions`. Clients see
    /// `freshness.as_of_ms` rounded down to 30 s; the guard of an action needs the real age.
    pub positions_seen_ms: Arc<BTreeMap<String, i64>>,
    pub wallets: Arc<BTreeMap<String, WalletRow>>,
    /// Keyed `live`, `dry`, `replay`.
    pub scopes: Arc<BTreeMap<String, ScopeTotals>>,
    /// Firing alerts, with their silence and acknowledgement state.
    pub alerts: Arc<Vec<Alert>>,
    pub health: Arc<Health>,
    pub details: Arc<BTreeMap<BotKey, BotDetail>>,
    pub tickers: Arc<Vec<Ticker>>,
    pub data: Arc<BTreeMap<BotKey, BotData>>,
    pub generated_ms: i64,
}

impl Published {
    #[must_use]
    pub fn empty(now_ms: i64) -> Self {
        Self {
            bots: Arc::default(),
            positions: Arc::default(),
            positions_seen_ms: Arc::default(),
            wallets: Arc::default(),
            scopes: Arc::default(),
            alerts: Arc::default(),
            health: Arc::new(Health {
                level: HealthLevel::Ok,
                reasons: Vec::new(),
                rate_budget_pct: None,
                backoff_active: false,
                hit_rate: None,
                bots_process: None,
                digest_age_s: None,
                freshness: fg_core::model::Freshness {
                    as_of_ms: 0,
                    source: fg_core::model::FreshnessSource::Digest,
                    stale: true,
                },
            }),
            details: Arc::default(),
            tickers: Arc::default(),
            data: Arc::default(),
            generated_ms: now_ms,
        }
    }
}

/// The collections of a channel, as `{collection: {key: entity}}`.
pub type Collections = BTreeMap<String, BTreeMap<String, Value>>;

/// A channel's state at one sequence number: what `GET /snapshot` returns, with the value of the
/// `X-Gw-Seq` header.
#[derive(Debug, Clone, PartialEq)]
pub struct ChannelSnapshot {
    pub channel: Channel,
    pub seq: u64,
    pub collections: Collections,
    /// Recent events (channel `events` and the log channels only).
    pub events: Vec<Event>,
}

fn to_map<T: Serialize>(items: impl IntoIterator<Item = (String, T)>) -> BTreeMap<String, Value> {
    items
        .into_iter()
        .filter_map(|(k, v)| Some((k, to_value(v)?)))
        .collect()
}

impl Published {
    /// The entities of a channel.
    ///
    /// # Errors
    /// [`EngineError::Unsupported`] for the chart relay, which this engine does not provide.
    pub fn collections_for(&self, ch: &Channel) -> Result<Collections, EngineError> {
        let mut out = Collections::new();
        match ch {
            Channel::Fleet => {
                out.insert(
                    "bots".into(),
                    to_map(self.bots.iter().map(|(k, v)| (k.to_string(), v))),
                );
                out.insert(
                    "wallets".into(),
                    to_map(self.wallets.iter().map(|(k, v)| (k.clone(), v))),
                );
                out.insert(
                    "scopes".into(),
                    to_map(self.scopes.iter().map(|(k, v)| (k.clone(), v))),
                );
            }
            Channel::Positions => {
                out.insert(
                    "positions".into(),
                    to_map(self.positions.iter().map(|(k, v)| (k.clone(), v))),
                );
            }
            Channel::Alerts => {
                out.insert(
                    "alerts".into(),
                    to_map(self.alerts.iter().map(|a| (a.id.clone(), a))),
                );
            }
            Channel::Health => {
                out.insert(
                    "health".into(),
                    to_map([("health".to_owned(), self.health.as_ref())]),
                );
            }
            Channel::Recon => {
                out.insert(
                    "wallets".into(),
                    to_map(self.wallets.iter().map(|(k, v)| (k.clone(), v))),
                );
            }
            Channel::Bot(key) => {
                out.insert(
                    "details".into(),
                    to_map(self.details.get(key).map(|d| (key.to_string(), d))),
                );
            }
            Channel::Events | Channel::Logs(LogScope::Errors | LogScope::Bot(_)) => {}
            Channel::Chart { .. } => return Err(EngineError::Unsupported("chart relay")),
        }
        Ok(out)
    }
}
