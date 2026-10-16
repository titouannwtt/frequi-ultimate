//! Who is looking at what. A client that opens the page of a bot (channel `bot:<key>`) raises
//! the polling cadences of that bot; the cadences fall back 30 seconds after the last client left
//! (03 section 4.3). The registry counts references and tells interested tasks through `watch`
//! channels, so a cadence change takes effect at once instead of at the next wake-up.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use fg_core::identity::BotKey;
use tokio::sync::watch;

/// A thing that can be watched.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ViewKey {
    Bot(BotKey),
    /// The health panel: raises the daemon polling cadences.
    Health,
    /// An open chart (its relay polls the bot for candles while somebody looks).
    Chart(crate::chart::ChartKey),
}

struct Entry {
    count: usize,
    tx: watch::Sender<bool>,
}

/// Reference counts of the views, with a hold-over delay on release.
pub struct Views {
    hold: Duration,
    map: Mutex<HashMap<ViewKey, Entry>>,
}

/// Releases its reference on drop.
pub struct ViewGuard {
    views: Arc<Views>,
    key: ViewKey,
}

impl Views {
    #[must_use]
    pub fn new(hold: Duration) -> Arc<Self> {
        Arc::new(Self {
            hold,
            map: Mutex::new(HashMap::new()),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<ViewKey, Entry>> {
        self.map
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Start looking at `key`.
    #[must_use]
    pub fn acquire(self: &Arc<Self>, key: ViewKey) -> ViewGuard {
        let mut map = self.lock();
        let e = map.entry(key.clone()).or_insert_with(|| Entry {
            count: 0,
            tx: watch::channel(false).0,
        });
        e.count += 1;
        e.tx.send_replace(true);
        drop(map);
        ViewGuard {
            views: Arc::clone(self),
            key,
        }
    }

    /// Observe whether `key` is viewed (including the hold-over after the last release).
    #[must_use]
    pub fn watch(&self, key: &ViewKey) -> watch::Receiver<bool> {
        let mut map = self.lock();
        map.entry(key.clone())
            .or_insert_with(|| Entry {
                count: 0,
                tx: watch::channel(false).0,
            })
            .tx
            .subscribe()
    }

    /// Forget a view nobody has: its entry would otherwise stay as long as the process lives
    /// (charts are keyed by a pair and a timeframe the clients choose).
    pub fn forget_idle(&self, key: &ViewKey) {
        let mut map = self.lock();
        if map
            .get(key)
            .is_some_and(|e| e.count == 0 && !*e.tx.borrow())
        {
            map.remove(key);
        }
    }

    /// Number of entries (tests: nothing a client names may stay forever).
    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.lock().len()
    }

    /// Any bot is being looked at.
    #[must_use]
    pub fn any_bot_viewed(&self) -> bool {
        self.lock()
            .iter()
            .any(|(k, e)| matches!(k, ViewKey::Bot(_)) && *e.tx.borrow())
    }

    /// The health panel is being looked at.
    #[must_use]
    pub fn health_viewed(&self) -> bool {
        self.lock()
            .get(&ViewKey::Health)
            .is_some_and(|e| *e.tx.borrow())
    }

    fn release(self: &Arc<Self>, key: &ViewKey) {
        let mut map = self.lock();
        let Some(e) = map.get_mut(key) else {
            return;
        };
        e.count = e.count.saturating_sub(1);
        if e.count > 0 {
            return;
        }
        drop(map);
        // The flag falls after the hold-over, unless someone came back meanwhile.
        let views = Arc::clone(self);
        let key = key.clone();
        let hold = self.hold;
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                tokio::time::sleep(hold).await;
                let mut map = views.lock();
                if let Some(e) = map.get_mut(&key)
                    && e.count == 0
                {
                    e.tx.send_replace(false);
                }
            });
        }
    }
}

impl Drop for ViewGuard {
    fn drop(&mut self) {
        self.views.release(&self.key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn cadences_stay_raised_for_the_hold_time_after_the_last_client() {
        let views = Views::new(Duration::from_secs(30));
        let key = ViewKey::Bot(BotKey::Local(9056));
        let rx = views.watch(&key);
        assert!(!*rx.borrow());
        let a = views.acquire(key.clone());
        let b = views.acquire(key.clone());
        assert!(*rx.borrow());
        assert!(views.any_bot_viewed());
        drop(a);
        tokio::time::sleep(Duration::from_secs(60)).await;
        assert!(*rx.borrow(), "one client is still there");
        drop(b);
        tokio::time::sleep(Duration::from_secs(29)).await;
        assert!(*rx.borrow(), "inside the hold-over");
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert!(!*rx.borrow());
        assert!(!views.any_bot_viewed());
    }

    #[tokio::test(start_paused = true)]
    async fn a_client_coming_back_cancels_the_fall() {
        let views = Views::new(Duration::from_secs(30));
        let key = ViewKey::Health;
        let rx = views.watch(&key);
        drop(views.acquire(key.clone()));
        tokio::time::sleep(Duration::from_secs(10)).await;
        let g = views.acquire(key.clone());
        tokio::time::sleep(Duration::from_secs(60)).await;
        assert!(*rx.borrow());
        assert!(views.health_viewed());
        drop(g);
    }
}
