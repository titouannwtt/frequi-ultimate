//! Whitelisted passthrough to the Python API of a bot (03 section 8.2).
//!
//! The server layer decides *what* may be forwarded (its whitelist, its cache, its limits); this
//! module is the authenticated, accounted way to do it.
//!
//! * [`proxy_read`] forwards a read (or a compute-only POST). It is counted in the request budget
//!   when the caller says so (short cached reads); the long Python jobs (stratdev, backtest,
//!   replay) are not, they would starve the pollers for minutes.
//! * [`proxy_write`] forwards a mutation with the guarantees of a typed action: idempotency key,
//!   audit row written before the request leaves, one attempt, `unknown` when it may have been
//!   applied, an optional typed-back confirmation.

use std::sync::Arc;

use fg_core::identity::BotKey;
use fg_core::model::{
    ActionResult, ActionStatus, ActionVerify, BotStatus, Event, EventKind, Severity,
};
use fg_core::protocol::ErrorCode;
use fg_sources::botrest::{ProxyRequest, ProxyResponse, RestError};
use serde_json::{Map, Value};
use thiserror::Error;

use crate::actions::{
    ActionError, ActionLocks, ActionOrigin, AuditWhat, audit_row, target, truncate, valid_key,
};
use crate::msg::Msg;
use crate::shared::Shared;
use crate::state_db::IdemState;

/// Failure of a forwarded read.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ProxyError {
    #[error("unknown bot")]
    UnknownBot,
    #[error("the bot has no API link")]
    NoLink,
    #[error("{0}")]
    Rest(RestError),
}

/// A mutation to forward.
#[derive(Debug, Clone)]
pub struct ProxyWrite {
    pub bot_key: BotKey,
    pub request: ProxyRequest,
    /// Name in the audit trail and key of the per-bot exclusion (`stratdev.editor.file`).
    pub label: String,
    /// Audit parameters: what the call is about, never a body and never a credential.
    pub params: Map<String, Value>,
    pub idempotency_key: String,
    /// The value the caller typed back (the bot name).
    pub confirm: Option<String>,
    pub require_confirm: bool,
    pub origin: ActionOrigin,
}

/// Forward a read. `budgeted` reads wait for a token of the request budget.
///
/// # Errors
/// [`ProxyError`]: unknown bot, no link, or the transport/HTTP failure.
pub async fn proxy_read(
    sh: &Arc<Shared>,
    key: &BotKey,
    req: ProxyRequest,
    budgeted: bool,
) -> Result<ProxyResponse, ProxyError> {
    if !sh.published.load().bots.contains_key(key) {
        return Err(ProxyError::UnknownBot);
    }
    let link = sh
        .links
        .read()
        .ok()
        .and_then(|l| l.get(key).cloned())
        .ok_or(ProxyError::NoLink)?;
    let _permit = if budgeted {
        Some(sh.budget.acquire(1).await)
    } else {
        None
    };
    link.rest.proxy(req).await.map_err(ProxyError::Rest)
}

/// Forward a mutation. See the module documentation.
///
/// # Errors
/// An [`ActionError`] when the request is refused before anything is sent.
pub async fn proxy_write(
    sh: &Arc<Shared>,
    locks: &Arc<ActionLocks>,
    w: ProxyWrite,
) -> Result<ActionResult, ActionError> {
    if !valid_key(&w.idempotency_key) {
        return Err(ActionError::new(
            ErrorCode::BadRequest,
            "idempotency key must be 1-128 characters of [A-Za-z0-9_-]",
        ));
    }
    if !w.request.method.is_mutating() {
        return Err(ActionError::new(
            ErrorCode::BadRequest,
            "not a mutating request",
        ));
    }
    let t = target(sh, &w.bot_key)?;
    if matches!(
        t.row.state.status,
        BotStatus::Offline | BotStatus::Stopped | BotStatus::AuthExpired
    ) {
        return Err(ActionError::new(
            ErrorCode::BotUnreachable,
            "the bot is not reachable",
        ));
    }
    if w.require_confirm && w.confirm.as_deref() != Some(t.row.identity.name.as_str()) {
        return Err(ActionError::new(
            ErrorCode::Forbidden,
            "type the name of the bot to confirm",
        ));
    }
    let _guard = locks.take(
        &w.idempotency_key,
        None,
        Some((w.bot_key.clone(), w.label.clone())),
    )?;

    let now = sh.now_ms();
    let store_err = |_| ActionError::new(ErrorCode::Internal, "state database unavailable");
    match sh
        .db
        .idem_begin(&w.idempotency_key, &w.bot_key.to_string(), &w.label, now)
        .await
        .map_err(store_err)?
    {
        IdemState::Done(r) => return Ok(*r),
        IdemState::InFlight => {
            return Ok(ActionResult {
                status: ActionStatus::Unknown,
                http_status: None,
                reason: Some("interrupted".into()),
                bot_response: None,
                verify: Some(ActionVerify {
                    expected_state: "check_on_bot".into(),
                    check_after_ms: 0,
                }),
                idempotency_key: w.idempotency_key,
                ts_ms: now,
            });
        }
        IdemState::Fresh => {}
    }
    let what = || AuditWhat {
        action: w.label.clone(),
        params: w.params.clone(),
        idempotency_key: w.idempotency_key.clone(),
    };
    // The intent is on record before the request leaves.
    if sh
        .db
        .audit_append(audit_row(
            &w.origin,
            &w.bot_key,
            &t.row,
            what(),
            now,
            None,
            None,
            None,
        ))
        .await
        .is_err()
    {
        let _ = sh.db.idem_forget(&w.idempotency_key).await;
        return Err(ActionError::new(
            ErrorCode::Internal,
            "audit trail unavailable, nothing was sent",
        ));
    }

    sh.budget.note_write();
    let started = std::time::Instant::now();
    let sent = t.link.rest.proxy(w.request.clone()).await;
    let latency = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let ts = sh.now_ms();

    let mut forget = false;
    let result = match sent {
        Ok(o) if (200..300).contains(&o.status) => ActionResult {
            status: ActionStatus::Accepted,
            http_status: Some(o.status),
            reason: None,
            bot_response: Some(truncate(&String::from_utf8_lossy(&o.body))),
            verify: None,
            idempotency_key: w.idempotency_key.clone(),
            ts_ms: ts,
        },
        Ok(o) => {
            // A 401 proves the request was not executed: it is not a final result.
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
                bot_response: Some(truncate(&String::from_utf8_lossy(&o.body))),
                verify: None,
                idempotency_key: w.idempotency_key.clone(),
                ts_ms: ts,
            }
        }
        Err(RestError::NotSent | RestError::Refused | RestError::AuthFailed) => {
            forget = true;
            ActionResult {
                status: ActionStatus::Rejected,
                http_status: None,
                reason: Some("not_sent".into()),
                bot_response: None,
                verify: None,
                idempotency_key: w.idempotency_key.clone(),
                ts_ms: ts,
            }
        }
        Err(_) => ActionResult {
            status: ActionStatus::Unknown,
            http_status: None,
            reason: Some("uncertain".into()),
            bot_response: None,
            verify: Some(ActionVerify {
                expected_state: "check_on_bot".into(),
                check_after_ms: 5_000,
            }),
            idempotency_key: w.idempotency_key.clone(),
            ts_ms: ts,
        },
    };

    let _ = sh
        .db
        .audit_append(audit_row(
            &w.origin,
            &w.bot_key,
            &t.row,
            what(),
            ts,
            result.http_status,
            result.bot_response.clone(),
            Some(latency),
        ))
        .await;
    if forget {
        let _ = sh.db.idem_forget(&w.idempotency_key).await;
    } else {
        let _ = sh.db.idem_finish(&w.idempotency_key, &result, ts).await;
    }
    let severity = match result.status {
        ActionStatus::Accepted => Severity::Info,
        ActionStatus::Rejected | ActionStatus::Unknown => Severity::Warning,
    };
    let _ = sh
        .core_tx
        .send(Msg::PushEvent(Event {
            kind: EventKind::Action,
            ts_ms: ts,
            bot_key: Some(w.bot_key.clone()),
            trade_id: None,
            pair: None,
            profit_abs: None,
            severity: Some(severity),
            detail: Some(format!("{} {:?}", w.label, result.status)),
        }))
        .await;
    Ok(result)
}
