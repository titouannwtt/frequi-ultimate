//! Write actions (03 section 8.1): typed, guarded, idempotent, audited, never retried.
//!
//! The order of what happens is the safety argument:
//!
//! 0. a key already seen is answered from the idempotency table before anything else, whatever
//!    the bot looks like now (the action itself may have changed it); a key reused for another
//!    bot, action or parameters is refused (`idempotency_key_reused`);
//! 1. the target is the bot named in the request, checked against the live model: the trade must
//!    exist, be open, and match the `expected` pair and side, otherwise `state_mismatch` and
//!    nothing is sent (the fix for "the exit went to the active bot instead of the trade's bot");
//! 2. sensitive actions need `confirm` equal to the bot name;
//! 3. in-flight locks (idempotency key, `(bot, trade)`, `(bot, action)`) turn a double click into
//!    `in_progress`;
//! 4. the idempotency table and the audit trail record the **intent before** the request leaves;
//! 5. the request is sent **once** through `BotRest::write`, which refreshes the token before the
//!    request and never after a failure of it;
//! 6. a request that may have reached the bot (timeout, reset) is reported `unknown`: the key
//!    stays locked and nothing resends it.
//!
//! The whole run is detached from the caller (see [`crate::EngineHandle::act`]): a client that
//! leaves, or a timeout above it, never cuts a request in flight, so the outcome is always
//! recorded, audited and announced.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use fg_core::identity::BotKey;
use fg_core::model::{
    ActionResult, ActionStatus, ActionVerify, AuditEntry, BotMode, BotRow, BotStatus, Event,
    EventKind, Severity,
};
use fg_core::protocol::ErrorCode;
use fg_sources::botrest::{EntrySide, ReadEndpoint, RestError, WriteAction};
use serde_json::{Map, Value, json};

use crate::msg::Msg;
use crate::shared::Shared;
use crate::state_db::IdemState;
use crate::wire::parse_status;

/// A position older than this is re-checked on the bot before an exit is sent.
pub const POSITION_MAX_AGE_MS: i64 = 10_000;
/// Longest bot answer kept in the audit trail and returned to clients.
pub const RESPONSE_MAX_CHARS: usize = 2048;
const MAX_KEY_LEN: usize = 128;

/// Who asked. Only a hash of the session ever reaches the audit trail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActionOrigin {
    pub session_hash: String,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
}

/// The trade the caller believes it acts on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpectedTrade {
    pub pair: String,
    pub is_short: bool,
}

/// A write action.
#[derive(Debug, Clone)]
pub struct ActionRequest {
    pub bot_key: BotKey,
    pub action: WriteAction,
    /// Generated once per click by the client (UUID v4). The same key never acts twice.
    pub idempotency_key: String,
    /// Required for `forceexit`; checked for the other trade-bound actions when given.
    pub expected: Option<ExpectedTrade>,
    /// The bot name, required for sensitive actions.
    pub confirm: Option<String>,
    pub origin: ActionOrigin,
}

/// A request refused before anything was sent.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{code:?}: {message}")]
pub struct ActionError {
    pub code: ErrorCode,
    pub message: String,
}

impl ActionError {
    pub(crate) fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Locks of the actions in flight in this process.
#[derive(Default)]
pub struct ActionLocks {
    keys: Mutex<HashSet<String>>,
    trades: Mutex<HashSet<(BotKey, i64)>>,
    actions: Mutex<HashSet<(BotKey, String)>>,
}

pub(crate) struct Guard {
    locks: Arc<ActionLocks>,
    key: String,
    trade: Option<(BotKey, i64)>,
    action: Option<(BotKey, String)>,
}

impl Drop for Guard {
    fn drop(&mut self) {
        if let Ok(mut k) = self.locks.keys.lock() {
            k.remove(&self.key);
        }
        if let (Some(t), Ok(mut s)) = (self.trade.take(), self.locks.trades.lock()) {
            s.remove(&t);
        }
        if let (Some(a), Ok(mut s)) = (self.action.take(), self.locks.actions.lock()) {
            s.remove(&a);
        }
    }
}

impl ActionLocks {
    /// An action with this idempotency key is running in this process.
    pub(crate) fn key_held(&self, key: &str) -> bool {
        self.keys.lock().map_or(true, |k| k.contains(key))
    }

    pub(crate) fn take(
        self: &Arc<Self>,
        key: &str,
        trade: Option<(BotKey, i64)>,
        action: Option<(BotKey, String)>,
    ) -> Result<Guard, ActionError> {
        let busy = || ActionError::new(ErrorCode::InProgress, "an identical action is in progress");
        {
            let mut k = self.keys.lock().map_err(|_| busy())?;
            if !k.insert(key.to_owned()) {
                return Err(busy());
            }
        }
        let mut guard = Guard {
            locks: Arc::clone(self),
            key: key.to_owned(),
            trade: None,
            action: None,
        };
        if let Some(t) = trade {
            let mut s = self.trades.lock().map_err(|_| busy())?;
            if !s.insert(t.clone()) {
                return Err(busy());
            }
            guard.trade = Some(t);
        }
        if let Some(a) = action {
            let mut s = self.actions.lock().map_err(|_| busy())?;
            if !s.insert(a.clone()) {
                return Err(busy());
            }
            guard.action = Some(a);
        }
        Ok(guard)
    }
}

fn trade_id_of(a: &WriteAction) -> Option<i64> {
    match a {
        WriteAction::ForceExit { trade_id, .. }
        | WriteAction::CancelOpenOrder { trade_id }
        | WriteAction::DeleteTrade { trade_id } => Some(*trade_id),
        _ => None,
    }
}

/// Actions that exclude each other per bot (a second `stop` while one runs is a mistake).
fn exclusive(a: &WriteAction) -> Option<&'static str> {
    match a {
        WriteAction::Stop | WriteAction::Start | WriteAction::Pause | WriteAction::StopEntry => {
            Some("lifecycle")
        }
        WriteAction::ReloadConfig => Some("reload_config"),
        _ => None,
    }
}

/// Actions that need the bot name typed back.
#[must_use]
pub fn requires_confirm(a: &WriteAction, mode: BotMode) -> bool {
    match a {
        WriteAction::Stop => true,
        WriteAction::DeleteTrade { .. } => mode == BotMode::Live,
        _ => false,
    }
}

pub(crate) fn expected_state(a: &WriteAction) -> &'static str {
    match a {
        WriteAction::ForceExit { .. } => "exit_fill",
        WriteAction::ForceEnter { .. } => "entry_fill",
        WriteAction::CancelOpenOrder { .. } => "no_open_order",
        WriteAction::DeleteTrade { .. } => "trade_absent",
        WriteAction::Start => "running",
        WriteAction::Stop => "stopped",
        WriteAction::Pause => "paused",
        WriteAction::StopEntry => "entries_stopped",
        WriteAction::ReloadConfig => "reloaded",
    }
}

/// Parameters for the audit trail: what the action does, never a credential.
fn params_of(a: &WriteAction) -> Map<String, Value> {
    let v = match a {
        WriteAction::ForceExit {
            trade_id,
            ordertype,
            amount,
        } => json!({"trade_id": trade_id, "ordertype": ordertype, "amount": amount}),
        WriteAction::ForceEnter {
            pair,
            side,
            price,
            stake_amount,
            ordertype,
            enter_tag,
            leverage,
        } => json!({
            "pair": pair,
            "side": match side { EntrySide::Long => "long", EntrySide::Short => "short" },
            "price": price, "stake_amount": stake_amount, "ordertype": ordertype,
            "enter_tag": enter_tag, "leverage": leverage,
        }),
        WriteAction::CancelOpenOrder { trade_id } | WriteAction::DeleteTrade { trade_id } => {
            json!({"trade_id": trade_id})
        }
        _ => json!({}),
    };
    match v {
        Value::Object(m) => m,
        _ => Map::new(),
    }
}

/// What an idempotency key stands for: the action and its parameters, as a short digest. The same
/// key with anything else is a client bug that would otherwise be answered with the result of a
/// different action (`accepted`, nothing sent).
pub(crate) fn fingerprint(name: &str, params: &Map<String, Value>) -> String {
    let canonical = Value::Object(params.clone()).to_string();
    let digest = blake3::hash(format!("{name}|{canonical}").as_bytes());
    format!("{name}:{}", &digest.to_hex()[..16])
}

pub(crate) fn key_reused() -> ActionError {
    ActionError::new(
        ErrorCode::IdempotencyKeyReused,
        "this idempotency key was used for another bot, action or parameters",
    )
}

/// The answer to a key whose earlier attempt never recorded an end.
pub(crate) fn interrupted(
    locks: &ActionLocks,
    key: &str,
    now_ms: i64,
    expected_state: &str,
) -> Result<ActionResult, ActionError> {
    if locks.key_held(key) {
        // Still running in this very process: the caller waits for it, it does not get a verdict.
        return Err(ActionError::new(
            ErrorCode::InProgress,
            "an identical action is in progress",
        ));
    }
    // The gateway stopped in between: the request may have reached the bot. Say so, never resend.
    Ok(ActionResult {
        status: ActionStatus::Unknown,
        http_status: None,
        reason: Some("interrupted".into()),
        bot_response: None,
        verify: Some(ActionVerify {
            expected_state: expected_state.into(),
            check_after_ms: 0,
        }),
        idempotency_key: key.to_owned(),
        ts_ms: now_ms,
    })
}

pub(crate) fn truncate(s: &str) -> String {
    s.chars().take(RESPONSE_MAX_CHARS).collect()
}

pub(crate) fn valid_key(k: &str) -> bool {
    !k.is_empty()
        && k.len() <= MAX_KEY_LEN
        && k.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub(crate) struct Target {
    pub(crate) row: BotRow,
    pub(crate) link: crate::connector::BotLink,
}

pub(crate) fn target(sh: &Shared, key: &BotKey) -> Result<Target, ActionError> {
    let published = sh.published.load();
    let row = published
        .bots
        .get(key)
        .cloned()
        .ok_or_else(|| ActionError::new(ErrorCode::NotFound, "unknown bot"))?;
    let link = sh
        .links
        .read()
        .ok()
        .and_then(|l| l.get(key).cloned())
        .ok_or_else(|| ActionError::new(ErrorCode::BotUnreachable, "bot has no API link"))?;
    Ok(Target { row, link })
}

/// Check the trade against the live model, and against the bot itself when the model is old.
async fn check_trade(
    sh: &Shared,
    t: &Target,
    req: &ActionRequest,
    trade_id: i64,
) -> Result<(), ActionError> {
    let mismatch = |m: &str| ActionError::new(ErrorCode::StateMismatch, m);
    let key = crate::ledger_data::trade_key(&req.bot_key, trade_id);
    let (pos, seen_ms) = {
        let published = sh.published.load();
        (
            published.positions.get(&key).cloned(),
            published.positions_seen_ms.get(&key).copied(),
        )
    };
    let needs_open = matches!(
        req.action,
        WriteAction::ForceExit { .. } | WriteAction::CancelOpenOrder { .. }
    );
    if let WriteAction::ForceExit { .. } = req.action
        && req.expected.is_none()
    {
        return Err(ActionError::new(
            ErrorCode::BadRequest,
            "forceexit needs the expected pair and side",
        ));
    }
    let now = sh.now_ms();
    // The published `as_of_ms` is rounded down for the clients: the exact instant is kept apart.
    let fresh = pos.as_ref().is_some_and(|p| {
        seen_ms.is_some_and(|at| now - at <= POSITION_MAX_AGE_MS) && !p.freshness.stale
    });
    let (pair, is_short) = if let (true, Some(p)) = (fresh, pos.as_ref()) {
        (
            Some(p.pair.clone()),
            Some(p.side == fg_core::model::Side::Short),
        )
    } else if needs_open || pos.is_some() {
        // The model is old or has no such trade: ask the bot (one read, counted in the budget).
        let _permit = sh.budget.acquire(1).await;
        match t.link.rest.read(ReadEndpoint::Status).await {
            Ok(v) => {
                let Some(live) = parse_status(&v) else {
                    return Err(ActionError::new(
                        ErrorCode::BotUnreachable,
                        "the bot answered something that is not its open trades",
                    ));
                };
                match live.iter().find(|p| p.trade_id == trade_id) {
                    Some(p) => (Some(p.pair.clone()), p.is_short),
                    None if needs_open => return Err(mismatch("the trade is not open on the bot")),
                    None => (None, None),
                }
            }
            Err(_) => {
                return Err(ActionError::new(
                    ErrorCode::BotUnreachable,
                    "cannot verify the trade on the bot",
                ));
            }
        }
    } else {
        (None, None)
    };
    if let Some(exp) = &req.expected {
        if pair.as_deref().is_some_and(|p| p != exp.pair) {
            return Err(mismatch("the trade is on another pair"));
        }
        if is_short.is_some_and(|s| s != exp.is_short) {
            return Err(mismatch("the trade has the other direction"));
        }
        if needs_open && pair.is_none() {
            return Err(mismatch("the trade is not open"));
        }
    }
    Ok(())
}

fn audit_entry(
    req: &ActionRequest,
    row: &BotRow,
    ts_ms: i64,
    http_status: Option<u16>,
    response: Option<String>,
    latency_ms: Option<u64>,
) -> AuditEntry {
    audit_row(
        &req.origin,
        &req.bot_key,
        row,
        AuditWhat {
            action: req.action.name().to_owned(),
            params: params_of(&req.action),
            idempotency_key: req.idempotency_key.clone(),
        },
        ts_ms,
        http_status,
        response,
        latency_ms,
    )
}

/// What an audit row says was asked.
pub(crate) struct AuditWhat {
    pub action: String,
    pub params: Map<String, Value>,
    pub idempotency_key: String,
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn audit_row(
    origin: &ActionOrigin,
    bot_key: &BotKey,
    row: &BotRow,
    what: AuditWhat,
    ts_ms: i64,
    http_status: Option<u16>,
    response: Option<String>,
    latency_ms: Option<u64>,
) -> AuditEntry {
    AuditEntry {
        ts_ms,
        session_hash: origin.session_hash.clone(),
        ip: origin.ip.clone(),
        user_agent: origin
            .user_agent
            .as_ref()
            .map(|u| u.chars().take(120).collect()),
        bot_key: bot_key.clone(),
        bot_name: row.identity.name.clone(),
        mode: row.identity.mode,
        action: what.action,
        params: what.params,
        idempotency_key: what.idempotency_key,
        http_status,
        response,
        latency_ms,
    }
}

/// Run an action. See the module documentation for the order of the steps.
///
/// # Errors
/// An [`ActionError`] when the request is refused before anything is sent.
pub async fn act(
    sh: &Arc<Shared>,
    locks: &Arc<ActionLocks>,
    req: ActionRequest,
) -> Result<ActionResult, ActionError> {
    if !valid_key(&req.idempotency_key) {
        return Err(ActionError::new(
            ErrorCode::BadRequest,
            "idempotency key must be 1-128 characters of [A-Za-z0-9_-]",
        ));
    }
    // A replay is answered before anything else: the state it would be judged against may be the
    // very effect of the first attempt (trade closed, bot stopped).
    let bot_key_s = req.bot_key.to_string();
    let print = fingerprint(req.action.name(), &params_of(&req.action));
    let store_err = |_| ActionError::new(ErrorCode::Internal, "state database unavailable");
    match sh
        .db
        .idem_lookup(&req.idempotency_key, &bot_key_s, &print)
        .await
        .map_err(store_err)?
    {
        IdemState::Done(r) => return Ok(*r),
        IdemState::Reused => return Err(key_reused()),
        IdemState::InFlight => {
            return interrupted(
                locks,
                &req.idempotency_key,
                sh.now_ms(),
                expected_state(&req.action),
            );
        }
        IdemState::Fresh => {}
    }
    let t = target(sh, &req.bot_key)?;
    if matches!(
        t.row.state.status,
        BotStatus::Offline | BotStatus::Stopped | BotStatus::AuthExpired
    ) {
        return Err(ActionError::new(
            ErrorCode::BotUnreachable,
            "the bot is not reachable",
        ));
    }
    if requires_confirm(&req.action, t.row.identity.mode)
        && req.confirm.as_deref() != Some(t.row.identity.name.as_str())
    {
        return Err(ActionError::new(
            ErrorCode::Forbidden,
            "type the name of the bot to confirm",
        ));
    }
    if let WriteAction::ForceEnter { pair, .. } = &req.action
        && pair.trim().is_empty()
    {
        return Err(ActionError::new(ErrorCode::BadRequest, "pair is required"));
    }
    let trade_id = trade_id_of(&req.action);
    if let Some(id) = trade_id {
        check_trade(sh, &t, &req, id).await?;
    }

    let _guard = locks.take(
        &req.idempotency_key,
        trade_id.map(|id| (req.bot_key.clone(), id)),
        exclusive(&req.action).map(|a| (req.bot_key.clone(), a.to_owned())),
    )?;

    let now = sh.now_ms();
    match sh
        .db
        .idem_begin(&req.idempotency_key, &bot_key_s, &print, now)
        .await
        .map_err(store_err)?
    {
        IdemState::Done(r) => return Ok(*r),
        IdemState::Reused => return Err(key_reused()),
        IdemState::InFlight => {
            return interrupted(
                locks,
                &req.idempotency_key,
                now,
                expected_state(&req.action),
            );
        }
        IdemState::Fresh => {}
    }
    // The intent is on record before the request leaves.
    if sh
        .db
        .audit_append(audit_entry(&req, &t.row, now, None, None, None))
        .await
        .is_err()
    {
        let _ = sh.db.idem_forget(&req.idempotency_key).await;
        return Err(ActionError::new(
            ErrorCode::Internal,
            "audit trail unavailable, nothing was sent",
        ));
    }

    sh.budget.note_write();
    let started = std::time::Instant::now();
    let sent = t
        .link
        .rest
        .write(req.action.clone(), req.idempotency_key.clone())
        .await;
    let latency = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let ts = sh.now_ms();

    let mut forget = false;
    let verify = |after: u64| {
        Some(ActionVerify {
            expected_state: expected_state(&req.action).into(),
            check_after_ms: after,
        })
    };
    let result = match sent {
        Ok(o) if o.is_success() => ActionResult {
            status: ActionStatus::Accepted,
            http_status: Some(o.status),
            reason: None,
            bot_response: Some(truncate(&o.body.to_string())),
            verify: verify(2_000),
            idempotency_key: req.idempotency_key.clone(),
            ts_ms: ts,
        },
        Ok(o) => {
            // A 401 proves the action was not executed: it is not a final result.
            forget = o.status == 401;
            ActionResult {
                status: ActionStatus::Rejected,
                http_status: Some(o.status),
                reason: Some(
                    if o.status == 401 {
                        "unauthorized"
                    } else {
                        "bot_refused"
                    }
                    .into(),
                ),
                bot_response: Some(truncate(&o.body.to_string())),
                verify: None,
                idempotency_key: req.idempotency_key.clone(),
                ts_ms: ts,
            }
        }
        Err(RestError::DuplicateInFlight) => {
            return Err(ActionError::new(
                ErrorCode::InProgress,
                "an identical action is in progress",
            ));
        }
        Err(RestError::NotSent | RestError::Refused | RestError::AuthFailed) => {
            forget = true;
            ActionResult {
                status: ActionStatus::Rejected,
                http_status: None,
                reason: Some("not_sent".into()),
                bot_response: None,
                verify: None,
                idempotency_key: req.idempotency_key.clone(),
                ts_ms: ts,
            }
        }
        Err(_) => ActionResult {
            status: ActionStatus::Unknown,
            http_status: None,
            reason: Some("uncertain".into()),
            bot_response: None,
            verify: verify(5_000),
            idempotency_key: req.idempotency_key.clone(),
            ts_ms: ts,
        },
    };

    let _ = sh
        .db
        .audit_append(audit_entry(
            &req,
            &t.row,
            ts,
            result.http_status,
            result.bot_response.clone(),
            Some(latency),
        ))
        .await;
    if forget {
        let _ = sh.db.idem_forget(&req.idempotency_key).await;
    } else {
        let _ = sh.db.idem_finish(&req.idempotency_key, &result, ts).await;
    }

    // Tell the feed, and look at the bot again right away.
    let severity = match result.status {
        ActionStatus::Accepted => Severity::Info,
        ActionStatus::Rejected | ActionStatus::Unknown => Severity::Warning,
    };
    let _ = sh
        .core_tx
        .send(Msg::PushEvent(Event {
            kind: EventKind::Action,
            ts_ms: ts,
            bot_key: Some(req.bot_key.clone()),
            trade_id,
            pair: match &req.action {
                WriteAction::ForceEnter { pair, .. } => Some(pair.clone()),
                _ => None,
            },
            profit_abs: None,
            severity: Some(severity),
            detail: Some(format!("{} {:?}", req.action.name(), result.status)),
        }))
        .await;
    if let Ok(n) = sh.nudges.read()
        && let Some(tx) = n.get(&req.bot_key)
    {
        let _ = tx.try_send(());
    }
    sh.ledger_nudge.notify_one();
    Ok(result)
}
