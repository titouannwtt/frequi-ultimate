//! The engine's public face: [`Engine::start`] wires the tasks, [`EngineHandle`] is what the
//! server layer holds (subscribe, snapshot, queries, alerts, preferences, actions).

use std::sync::{Arc, Mutex, RwLock};

use arc_swap::ArcSwap;
use fg_core::alerts::{Alert, AlertRulesConfig, AlertTypeId, AlertView};
use fg_core::calc::periods::{PeriodKey, PeriodUnit, PnlBucket};
use fg_core::identity::BotKey;
use fg_core::model::{
    ActionResult, AuditEntry, BotMode, Event, EventKind, Health, PrefsDoc, ReconSummary,
    ScopeTotals, Ticker,
};
use fg_core::protocol::{Channel, LogScope, boot_seq_base};
use fg_sources::traits::{BotWs, DaemonClient, Discovery, LedgerReader, TickerSource};
use tokio::sync::{Notify, mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::actions::{ActionError, ActionLocks, ActionRequest};
use crate::budget::{BudgetStats, RequestBudget};
use crate::clock::Clock;
use crate::config::EngineConfig;
use crate::connector::BotConnector;
use crate::core::{Cmd, Core};
use crate::error::EngineError;
use crate::hub::{Hub, Subscription};
use crate::published::{ChannelSnapshot, Published};
use crate::queries::{
    self, EquityMode, EquityPoint, JournalPage, JournalQuery, LeaderRow, ScopeError, ScopeRef,
};
use crate::shared::Shared;
use crate::state_db::StateDb;
use crate::views::{ViewKey, Views};

/// The sources the engine reads. Production wires the real adapters of `fg-sources`; tests wire
/// fakes.
pub struct EngineSources {
    pub discovery: Arc<dyn Discovery>,
    pub ledger: Arc<dyn LedgerReader>,
    /// `None` when the ftcache daemon is not used (open-source setups).
    pub daemon: Option<Arc<dyn DaemonClient>>,
    pub connector: Arc<dyn BotConnector>,
    pub ws: Arc<dyn BotWs>,
    pub ticker: Option<Arc<dyn TickerSource>>,
}

/// A running engine. Dropping it stops the tasks.
pub struct Engine {
    handle: EngineHandle,
    tasks: Vec<JoinHandle<()>>,
}

impl Drop for Engine {
    fn drop(&mut self) {
        for t in &self.tasks {
            t.abort();
        }
    }
}

impl Engine {
    /// Open `state.db`, restore the alert book, the rules and the recent events, and start every
    /// task.
    ///
    /// # Errors
    /// `state.db` cannot be opened.
    pub async fn start(
        cfg: EngineConfig,
        sources: EngineSources,
        clock: Arc<dyn Clock>,
    ) -> Result<Self, EngineError> {
        let db = StateDb::open(&cfg.data_dir)?;
        let now = clock.now_ms();
        let book = db
            .load_book()
            .await
            .ok()
            .flatten()
            .map(fg_core::alerts::AlertBook::from_state)
            .unwrap_or_default();
        let rules = db
            .load_rules()
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| cfg.alert_rules.clone());
        let since = now - i64::from(cfg.event_retention_days) * 24 * 3_600_000;
        let recent = db
            .recent_events(since, cfg.event_ring)
            .await
            .unwrap_or_default();

        let (core_tx, core_rx) = mpsc::channel(8192);
        let (cmd_tx, cmd_rx) = mpsc::channel(64);
        let budget = RequestBudget::new(cfg.budget);
        let shared = Arc::new(Shared {
            hub: Hub::new(boot_seq_base()),
            published: ArcSwap::from_pointee(Published::empty(now)),
            events: Mutex::new(std::collections::VecDeque::new()),
            views: Views::new(cfg.cadences.viewed_hold),
            links: RwLock::new(std::collections::HashMap::new()),
            ledger_targets: RwLock::new(Vec::new()),
            ledger_nudge: Notify::new(),
            nudges: RwLock::new(std::collections::HashMap::new()),
            budget,
            db,
            clock,
            core_tx,
            cfg,
        });

        let mut tasks = Vec::new();
        let core = Core::new(Arc::clone(&shared), book, rules, recent);
        tasks.push(tokio::spawn(core.run(core_rx, cmd_rx)));
        tasks.push(tokio::spawn(crate::ledger_task::run(
            Arc::clone(&shared),
            sources.ledger,
        )));
        if let Some(d) = sources.daemon {
            tasks.push(tokio::spawn(crate::daemon_task::run_daemon(
                Arc::clone(&shared),
                d,
            )));
        }
        if let Some(t) = sources.ticker {
            tasks.push(tokio::spawn(crate::daemon_task::run_ticker(
                Arc::clone(&shared),
                t,
            )));
        }
        tasks.push(tokio::spawn(crate::supervisor::run(
            Arc::clone(&shared),
            sources.discovery,
            sources.connector,
            sources.ws,
        )));
        Ok(Self {
            handle: EngineHandle {
                sh: shared,
                cmd: cmd_tx,
                locks: Arc::new(ActionLocks::default()),
            },
            tasks,
        })
    }

    #[must_use]
    pub fn handle(&self) -> EngineHandle {
        self.handle.clone()
    }

    /// Stop the tasks and wait until `state.db` has written everything queued.
    pub async fn shutdown(self) {
        for t in &self.tasks {
            t.abort();
        }
        self.handle.sh.db.flush().await;
    }
}

/// Filter of [`EngineHandle::alerts`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlertFilter {
    All,
    Active,
    Acked,
    Silenced,
}

/// Filter of [`EngineHandle::events`].
#[derive(Debug, Clone, Default)]
pub struct EventQuery {
    pub since_ms: i64,
    pub kinds: Option<Vec<EventKind>>,
    pub bot: Option<BotKey>,
    /// 0 means 200.
    pub limit: usize,
}

/// What a server layer holds. Cheap to clone.
#[derive(Clone)]
pub struct EngineHandle {
    sh: Arc<Shared>,
    cmd: mpsc::Sender<Cmd>,
    locks: Arc<ActionLocks>,
}

impl EngineHandle {
    /// The state as of now, lock-free.
    #[must_use]
    pub fn published(&self) -> Arc<Published> {
        self.sh.published.load_full()
    }

    #[must_use]
    pub fn now_ms(&self) -> i64 {
        self.sh.now_ms()
    }

    #[must_use]
    pub fn budget_stats(&self) -> BudgetStats {
        self.sh.budget.stats()
    }

    #[must_use]
    pub fn budget(&self) -> Arc<RequestBudget> {
        Arc::clone(&self.sh.budget)
    }

    #[must_use]
    pub fn health(&self) -> Health {
        self.published().health.as_ref().clone()
    }

    #[must_use]
    pub fn market(&self) -> Vec<Ticker> {
        self.published().tickers.as_ref().clone()
    }

    #[must_use]
    pub fn scopes(&self) -> Vec<ScopeTotals> {
        self.published().scopes.values().cloned().collect()
    }

    // ------------------------------------------------------------------ channels

    /// Join channels. `resume` maps a channel to the last sequence the client applied; a resume
    /// the buffer cannot honour (or one from before a restart of the gateway) is answered with a
    /// `resync` frame on the stream.
    ///
    /// # Errors
    /// The chart relay is not provided.
    pub fn subscribe(
        &self,
        channels: &[(Channel, Option<u64>)],
    ) -> Result<Subscription, EngineError> {
        if channels
            .iter()
            .any(|(c, _)| matches!(c, Channel::Chart { .. }))
        {
            return Err(EngineError::Unsupported("chart relay"));
        }
        let mut guards = Vec::new();
        for (ch, _) in channels {
            match ch {
                Channel::Bot(k) | Channel::Logs(LogScope::Bot(k)) => {
                    guards.push(self.sh.views.acquire(ViewKey::Bot(k.clone())));
                }
                Channel::Health => guards.push(self.sh.views.acquire(ViewKey::Health)),
                _ => {}
            }
        }
        Ok(Subscription::new(&self.sh.hub, channels).with_views(guards))
    }

    /// The state of a channel with the sequence number it corresponds to (`X-Gw-Seq`).
    ///
    /// # Errors
    /// The chart relay is not provided.
    pub fn snapshot(&self, ch: &Channel) -> Result<ChannelSnapshot, EngineError> {
        let (seq, published) = self.sh.hub.at_head(ch, || self.sh.published.load_full());
        let collections = published.collections_for(ch)?;
        let events = match ch {
            Channel::Events => self.recent_events(200),
            Channel::Logs(LogScope::Bot(k)) => published
                .details
                .get(k)
                .map(|d| {
                    d.logs
                        .iter()
                        .map(|l| Event {
                            kind: EventKind::Warning,
                            ts_ms: l.ts_ms,
                            bot_key: Some(k.clone()),
                            trade_id: None,
                            pair: None,
                            profit_abs: None,
                            severity: None,
                            detail: Some(l.message.chars().take(300).collect()),
                        })
                        .collect()
                })
                .unwrap_or_default(),
            _ => Vec::new(),
        };
        Ok(ChannelSnapshot {
            channel: ch.clone(),
            seq,
            collections,
            events,
        })
    }

    fn recent_events(&self, n: usize) -> Vec<Event> {
        self.sh.events.lock().map_or_else(
            |_| Vec::new(),
            |ring| ring.iter().rev().take(n).rev().cloned().collect(),
        )
    }

    // ------------------------------------------------------------------ events and audit

    /// Events of the feed. The memory ring answers; older history comes from `state.db`.
    pub async fn events(&self, q: EventQuery) -> Vec<Event> {
        let limit = if q.limit == 0 {
            200
        } else {
            q.limit.min(5_000)
        };
        let from_ring: Vec<Event> = self
            .sh
            .events
            .lock()
            .map(|r| r.iter().cloned().collect())
            .unwrap_or_default();
        let ring_full = from_ring.len() >= self.sh.cfg.event_ring;
        let oldest = from_ring.first().map(|e| e.ts_ms);
        let mut all = if ring_full && oldest.is_some_and(|o| q.since_ms < o) {
            self.sh
                .db
                .recent_events(q.since_ms, 20_000)
                .await
                .unwrap_or(from_ring)
        } else {
            from_ring
        };
        all.retain(|e| {
            e.ts_ms >= q.since_ms
                && q.kinds.as_ref().is_none_or(|k| k.contains(&e.kind))
                && q.bot.as_ref().is_none_or(|b| e.bot_key.as_ref() == Some(b))
        });
        let skip = all.len().saturating_sub(limit);
        all.drain(..skip);
        all
    }

    /// The audit trail.
    ///
    /// # Errors
    /// `state.db` failed.
    pub async fn audit(
        &self,
        from_ms: i64,
        bot: Option<BotKey>,
        limit: usize,
    ) -> Result<Vec<AuditEntry>, EngineError> {
        Ok(self
            .sh
            .db
            .audit_query(from_ms, bot.map(|b| b.to_string()), limit.clamp(1, 5_000))
            .await?)
    }

    // ------------------------------------------------------------------ alerts

    /// Firing alerts, optionally filtered by display state.
    #[must_use]
    pub fn alerts(&self, filter: AlertFilter) -> Vec<Alert> {
        let now = self.now_ms();
        self.published()
            .alerts
            .iter()
            .filter(|a| match (filter, a.view(now)) {
                (AlertFilter::All, _) => true,
                (AlertFilter::Active, v) => v == Some(AlertView::Active),
                (AlertFilter::Acked, v) => v == Some(AlertView::Acked),
                (AlertFilter::Silenced, v) => v == Some(AlertView::Silenced),
            })
            .cloned()
            .collect()
    }

    async fn ask<T>(&self, make: impl FnOnce(oneshot::Sender<T>) -> Cmd) -> Result<T, EngineError> {
        let (tx, rx) = oneshot::channel();
        self.cmd
            .send(make(tx))
            .await
            .map_err(|_| EngineError::Closed)?;
        rx.await.map_err(|_| EngineError::Closed)
    }

    /// Acknowledge an alert until it resolves.
    ///
    /// # Errors
    /// Unknown alert, or the engine is closing.
    pub async fn ack(&self, id: &str, session: Option<String>) -> Result<(), EngineError> {
        let id = id.to_owned();
        self.ask(|reply| Cmd::Ack { id, session, reply })
            .await?
            .map_err(|_| EngineError::NotFound)
    }

    /// Mute a rule, a bot, a subject or a combination until `until_ms`. Returns the silence id.
    ///
    /// # Errors
    /// A silence that ends in the past, or the engine is closing.
    pub async fn silence(
        &self,
        type_id: Option<AlertTypeId>,
        bot_key: Option<String>,
        subject: Option<String>,
        until_ms: i64,
    ) -> Result<String, EngineError> {
        self.ask(|reply| Cmd::Silence {
            type_id,
            bot_key,
            subject,
            until_ms,
            reply,
        })
        .await?
        .map_err(|e| EngineError::BadRequest(e.to_string()))
    }

    /// Remove a silence.
    ///
    /// # Errors
    /// Unknown silence, or the engine is closing.
    pub async fn unsilence(&self, id: &str) -> Result<(), EngineError> {
        let id = id.to_owned();
        self.ask(|reply| Cmd::Unsilence { id, reply })
            .await?
            .map_err(|_| EngineError::NotFound)
    }

    /// Thresholds and switches in force.
    ///
    /// # Errors
    /// The engine is closing.
    pub async fn alert_rules(&self) -> Result<AlertRulesConfig, EngineError> {
        Ok(*self.ask(|reply| Cmd::GetRules { reply }).await?)
    }

    /// Replace the alert rules (persisted).
    ///
    /// # Errors
    /// The engine is closing.
    pub async fn set_alert_rules(&self, rules: AlertRulesConfig) -> Result<(), EngineError> {
        self.ask(|reply| Cmd::SetRules {
            rules: Box::new(rules),
            reply,
        })
        .await
    }

    /// Record the outcome of a reconciliation sweep of a wallet (fed by the server layer).
    ///
    /// # Errors
    /// The engine is closing.
    pub async fn set_recon(
        &self,
        wallet_id: String,
        summary: ReconSummary,
    ) -> Result<(), EngineError> {
        self.cmd
            .send(Cmd::SetRecon { wallet_id, summary })
            .await
            .map_err(|_| EngineError::Closed)
    }

    /// Evaluate the alert rules now instead of at the next period.
    ///
    /// # Errors
    /// The engine is closing.
    pub async fn evaluate_alerts_now(&self) -> Result<(), EngineError> {
        self.ask(|reply| Cmd::EvaluateNow { reply }).await
    }

    /// Assemble and publish the fleet now instead of at the next tick.
    ///
    /// # Errors
    /// The engine is closing.
    pub async fn publish_now(&self) -> Result<(), EngineError> {
        self.ask(|reply| Cmd::PublishNow { reply }).await
    }

    // ------------------------------------------------------------------ queries

    fn scope_err(e: ScopeError) -> EngineError {
        match e {
            ScopeError::UnknownBot => EngineError::NotFound,
            ScopeError::MixedModes | ScopeError::Empty => EngineError::BadRequest(e.to_string()),
        }
    }

    /// Calendar buckets of realized profit in the configured zone.
    ///
    /// # Errors
    /// See [`ScopeError`].
    pub fn pnl_calendar(
        &self,
        scope: &ScopeRef,
        unit: PeriodUnit,
        n: usize,
    ) -> Result<Vec<PnlBucket>, EngineError> {
        queries::pnl_calendar(
            &self.published(),
            scope,
            unit,
            self.sh.cfg.tz,
            self.now_ms(),
            n,
        )
        .map_err(Self::scope_err)
    }

    /// Both drawdown definitions of a scope.
    ///
    /// # Errors
    /// See [`ScopeError`].
    pub fn drawdown(
        &self,
        scope: &ScopeRef,
    ) -> Result<fg_core::calc::drawdown::DrawdownResult, EngineError> {
        queries::drawdown(&self.published(), scope, self.now_ms()).map_err(Self::scope_err)
    }

    /// An equity curve decimated to `points`.
    ///
    /// # Errors
    /// See [`ScopeError`].
    pub fn equity(
        &self,
        scope: &ScopeRef,
        from_ms: i64,
        points: usize,
        mode: EquityMode,
    ) -> Result<Vec<EquityPoint>, EngineError> {
        queries::equity(&self.published(), scope, from_ms, points, mode).map_err(Self::scope_err)
    }

    /// Bots of a mode ranked by realized profit over a period.
    ///
    /// # Errors
    /// See [`ScopeError`].
    pub fn leaderboard(
        &self,
        mode: BotMode,
        period: PeriodKey,
    ) -> Result<Vec<LeaderRow>, EngineError> {
        queries::leaderboard(
            &self.published(),
            mode,
            period,
            self.sh.cfg.tz,
            self.now_ms(),
        )
        .map_err(Self::scope_err)
    }

    /// A page of the closed-trade journal.
    #[must_use]
    pub fn journal(&self, q: &JournalQuery) -> JournalPage {
        queries::journal(&self.published(), q)
    }

    // ------------------------------------------------------------------ preferences

    /// One preference document of a user (`scope` is empty for the global one, else a `bot_key`).
    ///
    /// # Errors
    /// `state.db` failed.
    pub async fn prefs_get(
        &self,
        user: &str,
        scope: &str,
    ) -> Result<Option<PrefsDoc>, EngineError> {
        Ok(self.sh.db.prefs_get(user, scope).await?)
    }

    /// Every document of a user.
    ///
    /// # Errors
    /// `state.db` failed.
    pub async fn prefs_list(&self, user: &str) -> Result<Vec<PrefsDoc>, EngineError> {
        Ok(self.sh.db.prefs_list(user).await?)
    }

    /// Write a document. `if_match` is the version the client last saw (0: must not exist).
    /// `scope` must be empty or a valid `bot_key`: the `ftbot.N` aliases of a device never reach
    /// the store.
    ///
    /// # Errors
    /// A bad scope, a version mismatch (`state_mismatch`), a document that is too large, or
    /// `state.db` failed.
    pub async fn prefs_put(
        &self,
        user: &str,
        scope: &str,
        data: serde_json::Value,
        if_match: Option<u64>,
    ) -> Result<PrefsDoc, EngineError> {
        if user.is_empty() || user.len() > 64 {
            return Err(EngineError::BadRequest("bad user".into()));
        }
        if !scope.is_empty() && scope.parse::<BotKey>().is_err() {
            return Err(EngineError::BadRequest(
                "scope must be empty or a bot_key".into(),
            ));
        }
        Ok(self
            .sh
            .db
            .prefs_put(user, scope, data, if_match, self.now_ms())
            .await?)
    }

    /// Delete a document.
    ///
    /// # Errors
    /// `state.db` failed.
    pub async fn prefs_delete(&self, user: &str, scope: &str) -> Result<bool, EngineError> {
        Ok(self.sh.db.prefs_delete(user, scope).await?)
    }

    // ------------------------------------------------------------------ actions

    /// Send a write action to a bot. See [`crate::actions`] for the guarantees: guarded by the
    /// expected state, idempotent, audited, sent at most once.
    ///
    /// # Errors
    /// The request was refused before anything was sent.
    pub async fn act(&self, req: ActionRequest) -> Result<ActionResult, ActionError> {
        crate::actions::act(&self.sh, &self.locks, req).await
    }

    /// Wait until `state.db` has written everything queued (tests, shutdown).
    pub async fn flush(&self) {
        self.sh.db.flush().await;
    }
}
