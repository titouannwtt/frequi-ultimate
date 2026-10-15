//! State shared by the tasks of the engine and by the [`crate::EngineHandle`].

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use arc_swap::ArcSwap;
use fg_core::identity::BotKey;
use fg_core::model::Event;
use tokio::sync::{Notify, mpsc};

use crate::budget::RequestBudget;
use crate::clock::Clock;
use crate::config::EngineConfig;
use crate::connector::BotLink;
use crate::hub::Hub;
use crate::msg::Msg;
use crate::published::Published;
use crate::state_db::StateDb;
use crate::views::Views;

/// A ledger the ledger task should watch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerTarget {
    pub key: BotKey,
    pub path: PathBuf,
}

/// Everything shared. All fields are cheap to use from any task.
pub struct Shared {
    pub cfg: EngineConfig,
    pub clock: Arc<dyn Clock>,
    pub hub: Hub,
    pub published: ArcSwap<Published>,
    /// The recent events, newest last. Written by the core only.
    pub events: Mutex<VecDeque<Event>>,
    pub db: StateDb,
    pub budget: Arc<RequestBudget>,
    pub views: Arc<Views>,
    /// REST/WS links of the running bots (the same objects the actors use).
    pub links: RwLock<HashMap<BotKey, BotLink>>,
    pub ledger_targets: RwLock<Vec<LedgerTarget>>,
    /// Wakes the ledger task now (a fill happened: the ledger changed).
    pub ledger_nudge: Notify,
    /// Wakes the actor of a bot (an action was sent: look at its state now).
    pub nudges: RwLock<HashMap<BotKey, mpsc::Sender<()>>>,
    pub core_tx: mpsc::Sender<Msg>,
}

impl Shared {
    #[must_use]
    pub fn now_ms(&self) -> i64 {
        self.clock.now_ms()
    }
}
