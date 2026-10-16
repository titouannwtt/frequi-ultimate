//! The engine's public face: [`Engine::start`] wires the tasks, [`EngineHandle`] is what the
//! server layer holds (subscribe, snapshot, queries, alerts, preferences, actions).

use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

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
use crate::chart::ChartKey;
use crate::clock::Clock;
use crate::config::EngineConfig;
use crate::connector::BotConnector;
use crate::core::{Cmd, Core};
use crate::error::EngineError;
use crate::hub::{Hub, Subscription};
use crate::published::{ChannelSnapshot, Published};
use crate::queries::{
    self, EquityMode, EquityPoint, JournalPage, JournalQuery, LeaderRow, OrderRow, ScopeError,
    ScopeRef,
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
        self.handle.sh.charts.abort_all();
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
            ledger: Arc::clone(&sources.ledger),
            charts: crate::chart::Charts::default(),
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

/// How long a caller waits for the outcome of a write before it is told `unknown`. Above the sum
/// of the timeouts inside a write (wait for a budget slot, a status read, two token refreshes,
/// the write itself).
pub const ACTION_DEADLINE: Duration = Duration::from_secs(75);

fn deadline_answer(key: &str, expected_state: &str, now_ms: i64) -> ActionResult {
    ActionResult {
        status: fg_core::model::ActionStatus::Unknown,
        http_status: None,
        reason: Some("timeout".into()),
        bot_response: None,
        verify: Some(fg_core::model::ActionVerify {
            expected_state: expected_state.into(),
            check_after_ms: 2_000,
        }),
        idempotency_key: key.to_owned(),
        ts_ms: now_ms,
    }
}

/// Wait for a detached write. Dropping this future leaves the task running.
async fn detached(
    task: tokio::task::JoinHandle<Result<ActionResult, ActionError>>,
    on_deadline: ActionResult,
) -> Result<ActionResult, ActionError> {
    match tokio::time::timeout(ACTION_DEADLINE, task).await {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => Err(ActionError::new(
            fg_core::protocol::ErrorCode::Internal,
            "the action stopped unexpectedly",
        )),
        Err(_) => Ok(on_deadline),
    }
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
    /// `resync` frame on the stream. Joining a `chart:` channel starts its relay (see
    /// [`crate::chart`]).
    ///
    /// # Errors
    /// A malformed chart, an unknown bot, or too many charts open.
    pub fn subscribe(
        &self,
        channels: &[(Channel, Option<u64>)],
    ) -> Result<Subscription, EngineError> {
        let mut guards = Vec::new();
        for (ch, _) in channels {
            match ch {
                Channel::Bot(k) | Channel::Logs(LogScope::Bot(k)) => {
                    guards.push(self.sh.views.acquire(ViewKey::Bot(k.clone())));
                }
                Channel::Health => guards.push(self.sh.views.acquire(ViewKey::Health)),
                Channel::Chart { .. } => {
                    if let Some(key) = ChartKey::of(ch) {
                        guards.push(crate::chart::open(&self.sh, key)?);
                    }
                }
                _ => {}
            }
        }
        Ok(Subscription::new(&self.sh.hub, channels).with_views(guards))
    }

    /// Number of charts being relayed (tests).
    #[cfg(test)]
    pub(crate) fn sh_charts_len(&self) -> usize {
        self.sh.charts.len()
    }

    /// Entries of the view registry and channels of the hub (tests).
    #[cfg(test)]
    pub(crate) fn sh_entries(&self) -> (usize, usize) {
        (self.sh.views.len(), self.sh.hub.len())
    }

    /// The state of a channel with the sequence number it corresponds to (`X-Gw-Seq`).
    ///
    /// The snapshot of a `chart:` channel is what its relay holds now: empty when nobody has
    /// joined the channel (the history of a chart is the proxied `pair_candles`).
    ///
    /// # Errors
    /// A malformed chart or an unknown bot.
    pub fn snapshot(&self, ch: &Channel) -> Result<ChannelSnapshot, EngineError> {
        if let Some(key) = ChartKey::of(ch) {
            key.validate()?;
            if !self.published().bots.contains_key(&key.bot) {
                return Err(EngineError::NotFound);
            }
            // A chart nobody relays has no channel to create: the name is the client's choice
            // and nothing would ever forget the entry.
            let Some(state) = self.sh.charts.state_of(&key) else {
                let (seq, collections) = self.sh.hub.peek_head(ch, Default::default);
                return Ok(ChannelSnapshot {
                    channel: ch.clone(),
                    seq,
                    collections,
                    events: Vec::new(),
                });
            };
            let (seq, collections) = self.sh.hub.at_head(ch, || {
                state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .clone()
            });
            return Ok(ChannelSnapshot {
                channel: ch.clone(),
                seq,
                collections,
                events: Vec::new(),
            });
        }
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
    ///
    /// The run is detached: it belongs to a task of its own that always goes to the end (outcome
    /// recorded, audited, announced), even when the caller is dropped (client gone, timeout
    /// above). If the answer takes longer than [`ACTION_DEADLINE`] the caller gets `unknown`
    /// with a `verify` hint while the task carries on.
    pub async fn act(&self, req: ActionRequest) -> Result<ActionResult, ActionError> {
        let unknown = deadline_answer(
            &req.idempotency_key,
            crate::actions::expected_state(&req.action),
            self.sh.now_ms(),
        );
        let (sh, locks) = (Arc::clone(&self.sh), Arc::clone(&self.locks));
        detached(
            tokio::spawn(async move { crate::actions::act(&sh, &locks, req).await }),
            unknown,
        )
        .await
    }

    /// The gateway's own database, for the tables of the server layer (sessions, device aliases).
    /// The engine's tables stay private to it.
    #[must_use]
    pub fn state_db(&self) -> StateDb {
        self.sh.db.clone()
    }

    /// Forward a read to the Python API of a bot. See [`crate::proxy`].
    ///
    /// # Errors
    /// [`ProxyError`].
    pub async fn proxy_read(
        &self,
        key: &BotKey,
        req: fg_sources::botrest::ProxyRequest,
        budgeted: bool,
    ) -> Result<fg_sources::botrest::ProxyResponse, crate::proxy::ProxyError> {
        crate::proxy::proxy_read(&self.sh, key, req, budgeted).await
    }

    /// Forward a mutation to the Python API of a bot: idempotent, audited, sent at most once.
    ///
    /// # Errors
    /// The request was refused before anything was sent.
    pub async fn proxy_write(
        &self,
        w: crate::proxy::ProxyWrite,
    ) -> Result<ActionResult, ActionError> {
        let unknown = deadline_answer(&w.idempotency_key, "check_on_bot", self.sh.now_ms());
        let (sh, locks) = (Arc::clone(&self.sh), Arc::clone(&self.locks));
        detached(
            tokio::spawn(async move { crate::proxy::proxy_write(&sh, &locks, w).await }),
            unknown,
        )
        .await
    }

    /// The orders of one trade (entries, DCA, exits), read from the bot's ledger on demand.
    ///
    /// # Errors
    /// The bot has no known ledger, or the ledger cannot be read.
    pub async fn trade_orders(
        &self,
        key: &BotKey,
        trade_id: i64,
    ) -> Result<Vec<OrderRow>, EngineError> {
        let path = self
            .sh
            .ledger_targets
            .read()
            .ok()
            .and_then(|t| t.iter().find(|t| &t.key == key).map(|t| t.path.clone()))
            .ok_or(EngineError::NotFound)?;
        let published = self.published();
        let is_short = published
            .positions
            .get(&crate::ledger_data::trade_key(key, trade_id))
            .map(|p| p.side == fg_core::model::Side::Short)
            .or_else(|| {
                published
                    .data
                    .get(key)?
                    .closed
                    .iter()
                    .find(|t| t.trade_id == trade_id)
                    .map(|t| t.side == fg_core::model::Side::Short)
            });
        let ledger = Arc::clone(&self.sh.ledger);
        let rows = tokio::task::spawn_blocking(move || ledger.orders(&path, &[trade_id]))
            .await
            .map_err(|_| EngineError::Unavailable("ledger"))?
            .map_err(|_| EngineError::Unavailable("ledger"))?;
        Ok(rows
            .into_iter()
            .filter(|o| o.trade_id == trade_id)
            .map(|o| OrderRow {
                is_entry: is_short.map(|s| o.is_entry_for(s)),
                id: o.id,
                side: o.side,
                status: o.status,
                is_open: o.is_open,
                filled: o.filled,
                amount: o.amount,
                average: o.average,
                cost: o.cost,
                filled_ms: o.filled_ms,
                tag: o.tag,
            })
            .collect())
    }

    /// Wait until `state.db` has written everything queued (tests, shutdown).
    pub async fn flush(&self) {
        self.sh.db.flush().await;
    }
}
