//! `ANY /bots/{key}/proxy/{path}`: the whitelisted passthrough to the Python API of a bot
//! (03 section 8.2).

use axum::Json;
use axum::body::{Body, Bytes};
use axum::extract::{Extension, Path, State};
use axum::http::request::Parts;
use axum::http::{HeaderName, HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use fg_core::identity::BotKey;
use fg_core::protocol::ErrorCode;
use fg_engine::{ActionOrigin, ProxyError, ProxyWrite};
use fg_sources::botrest::{ProxyMethod, ProxyRequest, ProxyResponse, proxy_path_is_plain};
use serde_json::{Map, Value};

use crate::error::{ApiFailure, rest_failure};
use crate::passthrough::{
    CacheKey, Class, FLEET_SCOPE, Rule, candle_ttl, clamp_candle_limit, classify, query_param,
};
use crate::routes::data::{guard_bot, parse_key};
use crate::session::Session;
use crate::state::{AppState, Client};
use crate::util::now_ms;

/// Longest query string forwarded.
const MAX_QUERY: usize = 4096;

fn method_of(m: &Method) -> Option<ProxyMethod> {
    Some(match *m {
        Method::GET => ProxyMethod::Get,
        Method::POST => ProxyMethod::Post,
        Method::PUT => ProxyMethod::Put,
        Method::PATCH => ProxyMethod::Patch,
        Method::DELETE => ProxyMethod::Delete,
        _ => return None,
    })
}

fn engine_failure(e: ProxyError) -> ApiFailure {
    match e {
        ProxyError::UnknownBot => ApiFailure::not_found(),
        ProxyError::NoLink => ApiFailure::new(ErrorCode::BotUnreachable, "the bot has no API link"),
        ProxyError::Rest(r) => rest_failure(&r),
    }
}

/// What a client gets of a bot's answer: its status (below 500) and body as they are; a server
/// error of the bot is told as a generic failure, never with the bot's own message.
fn to_response(r: &ProxyResponse, cache: Option<&'static str>) -> Result<Response, ApiFailure> {
    if r.status >= 500 {
        return Err(ApiFailure::new(
            ErrorCode::BotUnreachable,
            "the bot answered with an error",
        ));
    }
    let status = StatusCode::from_u16(r.status).unwrap_or(StatusCode::BAD_GATEWAY);
    let ct = r
        .content_type
        .as_deref()
        .and_then(|c| HeaderValue::from_str(c).ok())
        .unwrap_or_else(|| HeaderValue::from_static("application/json"));
    let mut resp = Response::new(Body::from(r.body.clone()));
    *resp.status_mut() = status;
    resp.headers_mut().insert(header::CONTENT_TYPE, ct);
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-cache"),
    );
    if let Some(c) = cache {
        resp.headers_mut().insert(
            HeaderName::from_static("x-gw-cache"),
            HeaderValue::from_static(c),
        );
    }
    Ok(resp)
}

fn read_request(
    path: &str,
    query: &str,
    rule: &Rule,
    method: ProxyMethod,
    body: &Bytes,
    ct: Option<&str>,
) -> ProxyRequest {
    ProxyRequest {
        method,
        path: format!("/{path}"),
        query: (!query.is_empty()).then(|| query.to_owned()),
        body: (!body.is_empty()).then(|| body.to_vec()),
        content_type: (!body.is_empty()).then(|| ct.unwrap_or("application/json").to_owned()),
        timeout: rule.timeout,
    }
}

async fn cached(
    st: &AppState,
    key: &BotKey,
    path: &str,
    query: &str,
    rule: &Rule,
) -> Result<Response, ApiFailure> {
    // The reconciliation sweeps every live wallet whichever bot answers, and `refresh=true` would
    // skip the Python cache as well: one fleet-wide entry, and the client's query is not sent.
    let query = if rule.wallet_level { "" } else { query };
    let (scope, cache_query, ttl) = if rule.wallet_level {
        (FLEET_SCOPE.to_owned(), String::new(), st.cache.wallet_ttl)
    } else if path == "pair_candles" {
        let tf = query_param(query, "timeframe").unwrap_or("");
        (key.to_string(), query.to_owned(), candle_ttl(tf, now_ms()))
    } else {
        (key.to_string(), query.to_owned(), rule.cache_ttl)
    };
    let ck = CacheKey {
        scope,
        path: path.to_owned(),
        query: cache_query,
    };
    let req = read_request(path, query, rule, ProxyMethod::Get, &Bytes::new(), None);
    let (resp, hit) = st
        .cache
        .get_or_fetch(ck, ttl, || async {
            st.engine
                .proxy_read(key, req, true)
                .await
                .map_err(engine_failure)
        })
        .await?;
    to_response(&resp, Some(if hit { "hit" } else { "miss" }))
}

/// A cached GET made on behalf of the server itself (health timeline, pair signals).
pub async fn cached_get(
    st: &AppState,
    key: &BotKey,
    path: &str,
    query: &str,
) -> Result<Response, ApiFailure> {
    let rule = classify(ProxyMethod::Get, path).ok_or_else(ApiFailure::not_found)?;
    cached(st, key, path, query, &rule).await
}

/// Parameters worth keeping in the audit trail: which file, which job, never the content.
fn audit_params(rule: &Rule, path: &str, query: &str, body: &Bytes) -> Map<String, Value> {
    const SAFE: [&str; 9] = [
        "path", "file", "filename", "reset_db", "strategy", "name", "job_id", "action", "mode",
    ];
    let mut m = Map::new();
    m.insert("path".into(), Value::String(path.to_owned()));
    m.insert("body_bytes".into(), Value::from(body.len()));
    if !query.is_empty() {
        let keys: Vec<Value> = query
            .split('&')
            .filter_map(|kv| kv.split('=').next())
            .take(20)
            .map(|k| Value::String(k.chars().take(40).collect()))
            .collect();
        m.insert("query_keys".into(), Value::Array(keys));
    }
    if let Ok(Value::Object(o)) = serde_json::from_slice::<Value>(body) {
        let keys: Vec<Value> = o
            .keys()
            .take(30)
            .map(|k| Value::String(k.clone()))
            .collect();
        m.insert("body_keys".into(), Value::Array(keys));
        for k in SAFE {
            match o.get(k) {
                Some(Value::String(s)) if s.len() <= 200 => {
                    m.insert(format!("body.{k}"), Value::String(s.clone()));
                }
                Some(v @ (Value::Bool(_) | Value::Number(_))) => {
                    m.insert(format!("body.{k}"), v.clone());
                }
                _ => {}
            }
        }
    }
    let _ = rule;
    m
}

pub async fn proxy(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    Extension(client): Extension<Client>,
    Path((key, rest)): Path<(String, String)>,
    parts: Parts,
    body: Bytes,
) -> Result<Response, ApiFailure> {
    let Parts {
        method,
        uri,
        headers,
        ..
    } = parts;
    let key = parse_key(&key)?;
    guard_bot(&st, &s, &key)?;
    // The raw path decides: nothing percent-encoded may reach the whitelist.
    let raw_tail = uri.path().split_once("/proxy/").map_or("", |(_, t)| t);
    if raw_tail.contains('%') || !proxy_path_is_plain(&format!("/{rest}")) || raw_tail != rest {
        return Err(ApiFailure::not_found());
    }
    let pm = method_of(&method).ok_or_else(|| {
        ApiFailure::bad_request("method not allowed").with_status(StatusCode::METHOD_NOT_ALLOWED)
    })?;
    let rule = classify(pm, &rest).ok_or_else(ApiFailure::not_found)?;
    if body.len() > rule.max_body {
        return Err(ApiFailure::bad_request("request body too large")
            .with_status(StatusCode::PAYLOAD_TOO_LARGE));
    }
    let mut query = uri.query().unwrap_or("").to_owned();
    if query.len() > MAX_QUERY {
        return Err(ApiFailure::bad_request("query string too long"));
    }
    if rest == "pair_candles" {
        query = clamp_candle_limit(&query);
    }
    let ct = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok());

    match rule.class {
        Class::CachedRead => cached(&st, &key, &rest, &query, &rule).await,
        Class::LongRead | Class::ComputePost => {
            let req = read_request(&rest, &query, &rule, pm, &body, ct);
            let r = st
                .engine
                .proxy_read(&key, req, false)
                .await
                .map_err(engine_failure)?;
            to_response(&r, None)
        }
        Class::Mutation => {
            let idem = headers
                .get("idempotency-key")
                .and_then(|v| v.to_str().ok())
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .ok_or_else(|| ApiFailure::bad_request("the Idempotency-Key header is required"))?
                .to_owned();
            st.limits
                .check_action(&s.id)
                .map_err(|l| ApiFailure::rate_limited(l.retry_after_ms))?;
            let confirm = headers
                .get("x-confirm-bot")
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);
            let params = audit_params(&rule, &rest, &query, &body);
            let result = st
                .engine
                .proxy_write(ProxyWrite {
                    bot_key: key.clone(),
                    request: read_request(&rest, &query, &rule, pm, &body, ct),
                    label: rule.label.clone(),
                    params,
                    idempotency_key: idem,
                    confirm,
                    require_confirm: rule.confirm,
                    origin: ActionOrigin {
                        session_hash: s.id.clone(),
                        ip: Some(client.ip.to_string()),
                        user_agent: Some(client.user_agent.clone()),
                    },
                })
                .await?;
            if rest.starts_with("fleetview/reconciliation/")
                && result.status == fg_core::model::ActionStatus::Accepted
            {
                // The view it was about has changed: the next read may sweep again.
                st.cache.forget_scope(FLEET_SCOPE);
            }
            tracing::info!(event = "proxy_write", bot = %key, route = %rule.label, status = ?result.status,
                session = %s.id);
            Ok(Json(result).into_response())
        }
    }
}
