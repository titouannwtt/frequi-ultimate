//! `POST /bots/{key}/actions/{action}`: typed, guarded, idempotent, audited writes (03 section 8.1).
//!
//! The bot is in the URL and the trade is checked against the live model by the engine, so a form
//! left on the wrong bot cannot send an exit to another one. The `Idempotency-Key` header is
//! mandatory; the same key never acts twice and never reaches the bot twice.

use std::time::Duration;

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Extension, Path, State};
use axum::http::HeaderMap;
use fg_core::model::ActionResult;
use fg_engine::{ActionOrigin, ActionRequest, ExpectedTrade, ProxyWrite};
use fg_sources::botrest::{EntrySide, ProxyMethod, ProxyRequest, WriteAction};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::error::ApiFailure;
use crate::routes::data::{guard_bot, parse_key};
use crate::session::Session;
use crate::state::{AppState, Client};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ExpectedBody {
    pair: String,
    is_short: bool,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields, default)]
struct Params {
    trade_id: Option<i64>,
    expected: Option<ExpectedBody>,
    amount: Option<f64>,
    ordertype: Option<String>,
    confirm: Option<String>,
    pair: Option<String>,
    side: Option<String>,
    price: Option<f64>,
    stake_amount: Option<f64>,
    enter_tag: Option<String>,
    leverage: Option<f64>,
    lock_id: Option<i64>,
}

/// A pair as it can appear in a URL query without escaping.
fn plain_pair(p: &str) -> bool {
    !p.is_empty()
        && p.len() <= 64
        && p.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b':' | b'_' | b'-' | b'.'))
}

fn need_trade(p: &Params) -> Result<i64, ApiFailure> {
    p.trade_id
        .filter(|id| *id > 0)
        .ok_or_else(|| ApiFailure::bad_request("trade_id is required"))
}

enum Plan {
    Typed(WriteAction),
    Proxied {
        label: &'static str,
        request: ProxyRequest,
        params: Map<String, Value>,
    },
}

fn proxied(
    label: &'static str,
    method: ProxyMethod,
    path: String,
    query: Option<String>,
    body: Option<Value>,
    params: Value,
) -> Plan {
    Plan::Proxied {
        label,
        request: ProxyRequest {
            method,
            path,
            query,
            content_type: body.as_ref().map(|_| "application/json".to_owned()),
            body: body.map(|b| b.to_string().into_bytes()),
            timeout: Duration::from_secs(20),
        },
        params: match params {
            Value::Object(m) => m,
            _ => Map::new(),
        },
    }
}

fn plan(action: &str, p: &Params) -> Result<Plan, ApiFailure> {
    Ok(match action {
        "forceexit" => Plan::Typed(WriteAction::ForceExit {
            trade_id: need_trade(p)?,
            ordertype: p.ordertype.clone(),
            amount: p.amount.filter(|a| *a > 0.0),
        }),
        "forceentry" | "forceenter" => {
            let side = match p.side.as_deref() {
                Some("long") => EntrySide::Long,
                Some("short") => EntrySide::Short,
                _ => return Err(ApiFailure::bad_request("side is long or short")),
            };
            Plan::Typed(WriteAction::ForceEnter {
                pair: p
                    .pair
                    .clone()
                    .filter(|x| !x.trim().is_empty())
                    .ok_or_else(|| ApiFailure::bad_request("pair is required"))?,
                side,
                price: p.price,
                stake_amount: p.stake_amount,
                ordertype: p.ordertype.clone(),
                enter_tag: p.enter_tag.clone(),
                leverage: p.leverage,
            })
        }
        "start" => Plan::Typed(WriteAction::Start),
        "stop" => Plan::Typed(WriteAction::Stop),
        "pause" => Plan::Typed(WriteAction::Pause),
        "stopbuy" | "stopentry" => Plan::Typed(WriteAction::StopEntry),
        "reload_config" => Plan::Typed(WriteAction::ReloadConfig),
        "delete_trade" => Plan::Typed(WriteAction::DeleteTrade {
            trade_id: need_trade(p)?,
        }),
        "cancel_open_order" => Plan::Typed(WriteAction::CancelOpenOrder {
            trade_id: need_trade(p)?,
        }),
        "reload_trade" => {
            let id = need_trade(p)?;
            proxied(
                "reload_trade",
                ProxyMethod::Post,
                format!("/trades/{id}/reload"),
                None,
                None,
                json!({"trade_id": id}),
            )
        }
        "blacklist_add" | "blacklist_remove" => {
            let pair = p
                .pair
                .clone()
                .filter(|x| plain_pair(x))
                .ok_or_else(|| ApiFailure::bad_request("pair is required"))?;
            if action == "blacklist_add" {
                proxied(
                    "blacklist_add",
                    ProxyMethod::Post,
                    "/blacklist".into(),
                    None,
                    Some(json!({"blacklist": [pair]})),
                    json!({"pair": pair}),
                )
            } else {
                proxied(
                    "blacklist_remove",
                    ProxyMethod::Delete,
                    "/blacklist".into(),
                    Some(format!("pairs_to_delete={pair}")),
                    None,
                    json!({"pair": pair}),
                )
            }
        }
        "lock_delete" => {
            let id = p
                .lock_id
                .filter(|i| *i > 0)
                .ok_or_else(|| ApiFailure::bad_request("lock_id is required"))?;
            proxied(
                "lock_delete",
                ProxyMethod::Delete,
                format!("/locks/{id}"),
                None,
                None,
                json!({"lock_id": id}),
            )
        }
        _ => return Err(ApiFailure::not_found()),
    })
}

pub async fn act(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    Extension(client): Extension<Client>,
    Path((key, action)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<ActionResult>, ApiFailure> {
    let key = parse_key(&key)?;
    guard_bot(&st, &s, &key)?;
    let idem = headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| ApiFailure::bad_request("the Idempotency-Key header is required"))?
        .to_owned();
    // Unknown actions are a 404 before anything is counted.
    let params: Params = if body.is_empty() {
        Params::default()
    } else {
        serde_json::from_slice(&body).map_err(|_| ApiFailure::bad_request("malformed JSON body"))?
    };
    let plan = plan(&action, &params)?;
    st.limits
        .check_action(&s.id)
        .map_err(|l| ApiFailure::rate_limited(l.retry_after_ms))?;

    let origin = ActionOrigin {
        session_hash: s.id.clone(),
        ip: Some(client.ip.to_string()),
        user_agent: Some(client.user_agent.clone()),
    };
    let result = match plan {
        Plan::Typed(write) => {
            st.engine
                .act(ActionRequest {
                    bot_key: key.clone(),
                    action: write,
                    idempotency_key: idem,
                    expected: params.expected.map(|e| ExpectedTrade {
                        pair: e.pair,
                        is_short: e.is_short,
                    }),
                    confirm: params.confirm,
                    origin,
                })
                .await?
        }
        Plan::Proxied {
            label,
            request,
            params: audit_params,
        } => {
            st.engine
                .proxy_write(ProxyWrite {
                    bot_key: key.clone(),
                    request,
                    label: label.to_owned(),
                    params: audit_params,
                    idempotency_key: idem,
                    confirm: params.confirm,
                    require_confirm: false,
                    origin,
                })
                .await?
        }
    };
    tracing::info!(event = "action", bot = %key, action = %action, status = ?result.status,
        session = %s.id);
    Ok(Json(result))
}
