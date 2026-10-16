//! Alerts, silences and rules (cluster C8), and the synchronised preferences (C13, C15).

use axum::Json;
use axum::extract::{Extension, Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use fg_core::alerts::{AlertRulesConfig, AlertTypeId};
use fg_core::identity::BotKey;
use fg_engine::AlertFilter;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::error::{ApiFailure, ApiJson, ApiQuery};
use crate::routes::data::{guard_bot, guard_fleet};
use crate::session::Session;
use crate::state::{AppState, PREFS_USER};
use crate::util::now_ms;

#[derive(Deserialize, Default)]
pub struct AlertParams {
    state: Option<String>,
}

fn alert_visible(st: &AppState, s: &Session, bot_key: Option<&str>) -> bool {
    bot_key.is_none_or(|k| k.parse::<BotKey>().is_ok_and(|k| st.bot_allowed(s, &k)))
}

pub async fn list(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    ApiQuery(q): ApiQuery<AlertParams>,
) -> Result<Json<Value>, ApiFailure> {
    let filter = match q.state.as_deref() {
        None | Some("all") => AlertFilter::All,
        Some("active") => AlertFilter::Active,
        Some("acked") => AlertFilter::Acked,
        Some("silenced") => AlertFilter::Silenced,
        Some(_) => {
            return Err(ApiFailure::bad_request(
                "state is all, active, acked or silenced",
            ));
        }
    };
    let alerts: Vec<_> = st
        .engine
        .alerts(filter)
        .into_iter()
        .filter(|a| alert_visible(&st, &s, a.bot_key.as_deref()))
        .collect();
    Ok(Json(json!({"alerts": alerts})))
}

pub async fn ack(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiFailure> {
    let alert = st
        .engine
        .alerts(AlertFilter::All)
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(ApiFailure::not_found)?;
    if !alert_visible(&st, &s, alert.bot_key.as_deref()) {
        return Err(ApiFailure::forbidden(
            "the alert belongs to a bot outside this session",
        ));
    }
    st.engine.ack(&id, Some(s.id)).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct SilenceBody {
    #[serde(default)]
    type_id: Option<AlertTypeId>,
    #[serde(default)]
    bot_key: Option<String>,
    #[serde(default)]
    subject: Option<String>,
    #[serde(default)]
    until_ms: Option<i64>,
    /// Alternative to `until_ms`: how long from now.
    #[serde(default)]
    duration_s: Option<i64>,
}

pub async fn silence(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    ApiJson(b): ApiJson<SilenceBody>,
) -> Result<(StatusCode, Json<Value>), ApiFailure> {
    match &b.bot_key {
        Some(k) => guard_bot(
            &st,
            &s,
            &k.parse::<BotKey>()
                .map_err(|_| ApiFailure::bad_request("not a bot key"))?,
        )?,
        None => guard_fleet(&st, &s)?,
    }
    let until = match (b.until_ms, b.duration_s) {
        (Some(u), _) => u,
        (None, Some(d)) if d > 0 => now_ms() + d.saturating_mul(1000),
        _ => {
            return Err(ApiFailure::bad_request(
                "until_ms or a positive duration_s is required",
            ));
        }
    };
    let id = st
        .engine
        .silence(b.type_id, b.bot_key, b.subject, until)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"id": id, "until_ms": until})),
    ))
}

pub async fn unsilence(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiFailure> {
    guard_fleet(&st, &s)?;
    st.engine.unsilence(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn rules_get(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
) -> Result<Json<AlertRulesConfig>, ApiFailure> {
    guard_fleet(&st, &s)?;
    Ok(Json(st.engine.alert_rules().await?))
}

pub async fn rules_put(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    ApiJson(rules): ApiJson<AlertRulesConfig>,
) -> Result<StatusCode, ApiFailure> {
    guard_fleet(&st, &s)?;
    st.engine.set_alert_rules(rules).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ------------------------------------------------------------------------------- preferences

#[derive(Deserialize, Default)]
pub struct PrefParams {
    /// Empty: the global document; a `bot_key`: that bot's document. Absent: `GET` lists them all.
    scope: Option<String>,
}

fn if_match(headers: &HeaderMap) -> Result<Option<u64>, ApiFailure> {
    let Some(v) = headers.get(header::IF_MATCH) else {
        return Ok(None);
    };
    v.to_str()
        .ok()
        .map(|t| t.trim().trim_matches('"'))
        .and_then(|t| t.parse::<u64>().ok())
        .map(Some)
        .ok_or_else(|| ApiFailure::bad_request("If-Match is the version of the document"))
}

fn pref_scope_guard(st: &AppState, s: &Session, scope: &str) -> Result<(), ApiFailure> {
    if scope.is_empty() {
        return Ok(());
    }
    let key = scope
        .parse::<BotKey>()
        .map_err(|_| ApiFailure::bad_request("scope must be empty or a bot_key"))?;
    guard_bot(st, s, &key)
}

pub async fn prefs_get(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    ApiQuery(q): ApiQuery<PrefParams>,
) -> Result<Response, ApiFailure> {
    match q.scope {
        Some(scope) => {
            pref_scope_guard(&st, &s, &scope)?;
            // A document that was never written is not an error: 204 keeps a first load (nothing
            // customised yet) out of the console, where a 404 would show on every page load.
            let Some(doc) = st.engine.prefs_get(PREFS_USER, &scope).await? else {
                return Ok(StatusCode::NO_CONTENT.into_response());
            };
            let mut resp = Json(&doc).into_response();
            if let Ok(v) = HeaderValue::from_str(&format!("\"{}\"", doc.version)) {
                resp.headers_mut().insert(header::ETAG, v);
            }
            Ok(resp)
        }
        None => {
            let docs: Vec<_> = st
                .engine
                .prefs_list(PREFS_USER)
                .await?
                .into_iter()
                .filter(|d| pref_scope_guard(&st, &s, &d.scope).is_ok())
                .collect();
            Ok(Json(json!({"docs": docs})).into_response())
        }
    }
}

pub async fn prefs_put(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    ApiQuery(q): ApiQuery<PrefParams>,
    headers: HeaderMap,
    ApiJson(data): ApiJson<Value>,
) -> Result<Response, ApiFailure> {
    let scope = q.scope.unwrap_or_default();
    pref_scope_guard(&st, &s, &scope)?;
    let doc = st
        .engine
        .prefs_put(PREFS_USER, &scope, data, if_match(&headers)?)
        .await?;
    let mut resp = Json(&doc).into_response();
    if let Ok(v) = HeaderValue::from_str(&format!("\"{}\"", doc.version)) {
        resp.headers_mut().insert(header::ETAG, v);
    }
    Ok(resp)
}

pub async fn prefs_delete(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    ApiQuery(q): ApiQuery<PrefParams>,
) -> Result<StatusCode, ApiFailure> {
    let scope = q.scope.unwrap_or_default();
    pref_scope_guard(&st, &s, &scope)?;
    if st.engine.prefs_delete(PREFS_USER, &scope).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiFailure::not_found())
    }
}
