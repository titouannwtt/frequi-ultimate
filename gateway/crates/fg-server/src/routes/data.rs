//! Read endpoints: snapshots, bots, scopes, journal, calendar, curves, risk, logs, events,
//! health, pairs, market and audit (03 section 6.3).

use std::collections::BTreeSet;
use std::str::FromStr;

use axum::Json;
use axum::extract::{Extension, Path, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use fg_core::calc::periods::{PeriodKey, PeriodUnit};
use fg_core::identity::BotKey;
use fg_core::model::{BotMode, EventKind, Position, Side};
use fg_core::protocol::{Channel, ErrorCode, LogScope};
use fg_engine::{EquityMode, EventQuery, JournalQuery, JournalSort, ScopeRef};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::error::{ApiFailure, ApiQuery};
use crate::risk;
use crate::session::{Scope, Session};
use crate::state::{AppState, PREFS_USER};
use crate::util::now_ms;

pub(crate) fn parse_key(raw: &str) -> Result<BotKey, ApiFailure> {
    raw.parse::<BotKey>()
        .map_err(|_| ApiFailure::bad_request("not a bot key"))
}

pub(crate) fn guard_bot(st: &AppState, s: &Session, key: &BotKey) -> Result<(), ApiFailure> {
    if st.bot_allowed(s, key) {
        Ok(())
    } else {
        Err(ApiFailure::forbidden(
            "the bot is outside the scope of this session",
        ))
    }
}

pub(crate) fn guard_fleet(st: &AppState, s: &Session) -> Result<(), ApiFailure> {
    if st.fleet_allowed(s) {
        Ok(())
    } else {
        Err(ApiFailure::forbidden(
            "this view covers the whole fleet and this session reaches only some of it",
        ))
    }
}

/// The published state with the detail of `key` in it. The engine assembles the detail of a bot
/// (whitelist, locks, logs) only while somebody watches its channel, so a REST read joins the
/// channel for the length of the call and asks for a publication when the detail is missing.
async fn published_with_detail(
    st: &AppState,
    key: &BotKey,
) -> Result<std::sync::Arc<fg_engine::Published>, ApiFailure> {
    let p = st.engine.published();
    if p.details.contains_key(key) {
        return Ok(p);
    }
    if !p.bots.contains_key(key) {
        return Err(ApiFailure::not_found());
    }
    let _watch = st
        .engine
        .subscribe(&[(Channel::Bot(key.clone()), None)])
        .map_err(ApiFailure::from)?;
    st.engine.publish_now().await.map_err(ApiFailure::from)?;
    Ok(st.engine.published())
}

fn mode_of(raw: &str) -> Option<BotMode> {
    match raw {
        "live" => Some(BotMode::Live),
        "dry" => Some(BotMode::Dry),
        "replay" => Some(BotMode::Replay),
        _ => None,
    }
}

fn csv_keys(raw: &str) -> Result<Vec<BotKey>, ApiFailure> {
    // Keys of remote bots contain commas nowhere, but colons and slashes: split on commas only.
    raw.split(',')
        .filter(|k| !k.trim().is_empty())
        .map(|k| parse_key(k.trim()))
        .collect()
}

/// Members of a user-defined group, read from the synchronised preferences
/// (`data.groups`: `{id: [bot_key, ...]}`, `{id: {bots: [...]}}` or `[{id, bots: [...]}]`).
async fn group_members(st: &AppState, id: &str) -> Result<Vec<BotKey>, ApiFailure> {
    let doc = st.engine.prefs_get(PREFS_USER, "").await?;
    let groups = doc.as_ref().and_then(|d| d.data.get("groups"));
    let members: Option<&Value> = match groups {
        Some(Value::Object(m)) => m.get(id),
        Some(Value::Array(a)) => a.iter().find(|g| {
            g.get("id").and_then(Value::as_str) == Some(id)
                || g.get("name").and_then(Value::as_str) == Some(id)
        }),
        _ => None,
    };
    let list = match members {
        Some(Value::Array(a)) => Some(a),
        Some(Value::Object(o)) => o
            .get("bots")
            .or_else(|| o.get("members"))
            .and_then(Value::as_array),
        _ => None,
    };
    let list = list.ok_or_else(ApiFailure::not_found)?;
    Ok(list
        .iter()
        .filter_map(Value::as_str)
        .filter_map(|k| k.parse::<BotKey>().ok())
        .collect())
}

/// Resolve `scope=` / `bots=` into a scope the session may read.
pub(crate) async fn resolve_scope(
    st: &AppState,
    s: &Session,
    scope: Option<&str>,
    bots: Option<&str>,
) -> Result<ScopeRef, ApiFailure> {
    let r = if let Some(csv) = bots {
        ScopeRef::Bots(csv_keys(csv)?)
    } else {
        match scope.unwrap_or("live") {
            m if mode_of(m).is_some() => ScopeRef::Mode(mode_of(m).unwrap_or(BotMode::Live)),
            "fleet" => {
                return Err(ApiFailure::bad_request(
                    "figures never mix live, dry and replay bots: ask for live, dry or replay",
                ));
            }
            b if b.starts_with("bot:") => ScopeRef::Bot(parse_key(&b["bot:".len()..])?),
            g if g.starts_with("group:") => {
                ScopeRef::Bots(group_members(st, &g["group:".len()..]).await?)
            }
            _ => return Err(ApiFailure::bad_request("unknown scope")),
        }
    };
    match &r {
        ScopeRef::Mode(_) => guard_fleet(st, s)?,
        ScopeRef::Bot(k) => guard_bot(st, s, k)?,
        ScopeRef::Bots(keys) => {
            for k in keys {
                guard_bot(st, s, k)?;
            }
        }
    }
    Ok(r)
}

fn scope_failure(e: fg_engine::EngineError) -> ApiFailure {
    ApiFailure::from(e)
}

// ----------------------------------------------------------------------------------- snapshot

#[derive(Deserialize, Default)]
pub struct SnapshotParams {
    ch: Option<String>,
}

fn channel_allowed(st: &AppState, s: &Session, ch: &Channel) -> Result<(), ApiFailure> {
    match ch {
        Channel::Bot(k) | Channel::Logs(LogScope::Bot(k)) => guard_bot(st, s, k),
        Channel::Chart { bot, .. } => guard_bot(st, s, bot),
        _ => guard_fleet(st, s),
    }
}

/// Channels of a request or a frame, parsed and checked against the session.
pub(crate) fn parse_channels(
    st: &AppState,
    s: &Session,
    names: &[String],
) -> Result<Vec<Channel>, ApiFailure> {
    let mut out: Vec<Channel> = Vec::new();
    for n in names {
        let ch = Channel::from_str(n).map_err(|_| {
            ApiFailure::new(ErrorCode::UnknownChannel, format!("unknown channel {n:?}"))
        })?;
        channel_allowed(st, s, &ch)?;
        if !out.contains(&ch) {
            out.push(ch);
        }
    }
    Ok(out)
}

pub async fn snapshot(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    ApiQuery(q): ApiQuery<SnapshotParams>,
    headers: HeaderMap,
) -> Result<Response, ApiFailure> {
    let names: Vec<String> =
        q.ch.as_deref()
            .unwrap_or("fleet,positions,alerts,health,events")
            .split(',')
            .map(|c| c.trim().to_owned())
            .filter(|c| !c.is_empty())
            .collect();
    if names.is_empty() || names.len() > 16 {
        return Err(ApiFailure::bad_request("1 to 16 channels"));
    }
    let channels = parse_channels(&st, &s, &names)?;
    let mut body = Map::new();
    let mut seqs = Vec::new();
    for ch in &channels {
        let snap = st.engine.snapshot(ch).map_err(ApiFailure::from)?;
        seqs.push(format!("{ch}={}", snap.seq));
        body.insert(
            ch.to_string(),
            json!({"seq": snap.seq, "collections": snap.collections, "events": snap.events}),
        );
    }
    let bytes = serde_json::to_vec(&json!({"ts": now_ms(), "channels": body}))
        .map_err(|_| ApiFailure::new(ErrorCode::Internal, "cannot encode the snapshot"))?;
    // The ETag covers the data, not the clock: two snapshots of the same state match.
    let etag = {
        let mut stable = Map::new();
        for (k, v) in &body {
            stable.insert(k.clone(), v.clone());
        }
        let digest = blake3::hash(&serde_json::to_vec(&stable).unwrap_or_default());
        format!("\"{}\"", &digest.to_hex()[..16])
    };
    let seq_header = HeaderValue::from_str(&seqs.join(","))
        .map_err(|_| ApiFailure::new(ErrorCode::Internal, "bad header"))?;
    let etag_header = HeaderValue::from_str(&etag)
        .map_err(|_| ApiFailure::new(ErrorCode::Internal, "bad header"))?;
    let mut resp = if headers
        .get(header::IF_NONE_MATCH)
        .is_some_and(|v| v.as_bytes() == etag.as_bytes())
    {
        StatusCode::NOT_MODIFIED.into_response()
    } else {
        (
            [(
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            )],
            bytes,
        )
            .into_response()
    };
    let h = resp.headers_mut();
    h.insert(header::ETAG, etag_header);
    h.insert(HeaderName::from_static("x-gw-seq"), seq_header);
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-cache"),
    );
    Ok(resp)
}

// -------------------------------------------------------------------------------------- bots

pub async fn bots(State(st): State<AppState>, Extension(s): Extension<Session>) -> Json<Value> {
    let aliases = st.sessions.aliases(&s.device_id);
    let p = st.engine.published();
    let rows: Vec<Value> = p
        .bots
        .values()
        .filter(|b| st.bot_allowed(&s, &b.bot_key))
        .map(|b| {
            let ui_ids: Vec<&str> = aliases
                .iter()
                .filter(|a| a.bot_key == b.bot_key)
                .map(|a| a.ui_id.as_str())
                .collect();
            json!({
                "bot_key": b.bot_key,
                "name": b.identity.name,
                "mode": b.identity.mode,
                "status": b.state.status,
                "strategy": b.identity.strategy,
                "market": b.identity.market,
                "port": b.identity.port,
                "ui_ids": ui_ids,
            })
        })
        .collect();
    Json(json!({ "bots": rows }))
}

pub async fn bots_discovered(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
) -> Json<Value> {
    let known: BTreeSet<BotKey> = st
        .sessions
        .aliases(&s.device_id)
        .into_iter()
        .map(|a| a.bot_key)
        .collect();
    let rows: Vec<Value> = st
        .directory
        .bots()
        .into_iter()
        .filter(|b| st.bot_allowed(&s, &b.key))
        .map(|b| {
            json!({
                "bot_key": b.key,
                "name": b.name,
                "mode": if b.live { "live" } else { "dry" },
                "port": b.port,
                "registered_on_device": known.contains(&b.key),
            })
        })
        .collect();
    Json(json!({ "discovered": rows }))
}

/// `POST /bots`, `PATCH /bots/{key}`, `DELETE /bots/{key}`, `POST /bots/{key}/credentials`: the
/// registry of this gateway is the discovery of the bots of the host.
pub async fn registry_write() -> ApiFailure {
    ApiFailure::not_implemented(
        "this gateway follows the bots it discovers on its host; a registry of remote bots is not available in this version",
    )
}

// ------------------------------------------------------------------------------------ scopes

pub async fn scope(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    Path(raw): Path<String>,
) -> Result<Json<Value>, ApiFailure> {
    let p = st.engine.published();
    if raw == "fleet" {
        guard_fleet(&st, &s)?;
        return Ok(Json(json!({
            "scope": "fleet",
            "kind": "fleet",
            "totals": p.scopes.values().collect::<Vec<_>>(),
            "bots": p.bots.len(),
            "positions": p.positions.len(),
            "generated_ms": p.generated_ms,
        })));
    }
    let r = resolve_scope(&st, &s, Some(&raw), None).await?;
    let rows = fg_engine::queries::scope_bots(&p, &r).map_err(|e| match e {
        fg_engine::queries::ScopeError::UnknownBot => ApiFailure::not_found(),
        other => ApiFailure::bad_request(other.to_string()),
    })?;
    let keys: BTreeSet<&BotKey> = rows.iter().map(|b| &b.bot_key).collect();
    let positions: Vec<&Position> = p
        .positions
        .values()
        .filter(|pos| keys.contains(&pos.bot_key))
        .collect();
    let wallets: Vec<_> = p
        .wallets
        .values()
        .filter(|w| w.bots.iter().any(|b| keys.contains(b)))
        .collect();
    let (kind, totals) = match &r {
        ScopeRef::Mode(m) => ("mode", p.scopes.get(mode_name(*m))),
        ScopeRef::Bot(_) => ("bot", None),
        ScopeRef::Bots(_) => ("group", None),
    };
    let detail = match &r {
        ScopeRef::Bot(k) => p.details.get(k),
        _ => None,
    };
    let drawdown = st.engine.drawdown(&r).ok();
    Ok(Json(json!({
        "scope": raw,
        "kind": kind,
        "totals": totals,
        "bots": rows,
        "positions": positions,
        "wallets": wallets,
        "drawdown": drawdown,
        "detail": detail,
        "generated_ms": p.generated_ms,
    })))
}

fn mode_name(m: BotMode) -> &'static str {
    match m {
        BotMode::Live => "live",
        BotMode::Dry => "dry",
        BotMode::Replay => "replay",
    }
}

// ----------------------------------------------------------------------------------- journal

#[derive(Deserialize, Default)]
pub struct TradesParams {
    status: Option<String>,
    bots: Option<String>,
    group: Option<String>,
    pair: Option<String>,
    side: Option<String>,
    exit_reason: Option<String>,
    mode: Option<String>,
    from: Option<i64>,
    to: Option<i64>,
    sort: Option<String>,
    order: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
}

async fn journal_query(
    st: &AppState,
    s: &Session,
    q: &TradesParams,
) -> Result<JournalQuery, ApiFailure> {
    let mut bots: Option<Vec<BotKey>> = match (&q.bots, &q.group) {
        (Some(csv), _) => Some(csv_keys(csv)?),
        (None, Some(g)) => Some(group_members(st, g).await?),
        (None, None) => None,
    };
    // Asking for a bot outside the session is an error; asking for nothing in particular gives a
    // partial session the bots it has.
    if bots.is_none() && matches!(s.scope, Scope::Groups(_)) {
        bots = Some(
            st.engine
                .published()
                .bots
                .keys()
                .filter(|k| st.bot_allowed(s, k))
                .cloned()
                .collect(),
        );
    }
    if let Some(b) = &bots {
        for k in b {
            guard_bot(st, s, k)?;
        }
    }
    let side = match q.side.as_deref() {
        None | Some("") => None,
        Some("long") => Some(Side::Long),
        Some("short") => Some(Side::Short),
        Some(_) => return Err(ApiFailure::bad_request("side is long or short")),
    };
    let mode = match q.mode.as_deref() {
        None | Some("") => None,
        Some(m) => {
            Some(mode_of(m).ok_or_else(|| ApiFailure::bad_request("mode is live, dry or replay"))?)
        }
    };
    let sort = match q.sort.as_deref() {
        None | Some("close_date" | "close") => JournalSort::CloseDate,
        Some("open_date" | "open") => JournalSort::OpenDate,
        Some("profit") => JournalSort::Profit,
        Some(_) => {
            return Err(ApiFailure::bad_request(
                "sort is close_date, open_date or profit",
            ));
        }
    };
    let descending = match q.order.as_deref() {
        None | Some("desc") => true,
        Some("asc") => false,
        Some(_) => return Err(ApiFailure::bad_request("order is asc or desc")),
    };
    Ok(JournalQuery {
        bots,
        mode,
        pair: q.pair.clone().filter(|p| !p.is_empty()),
        side,
        exit_reason: q.exit_reason.clone().filter(|p| !p.is_empty()),
        from_ms: q.from,
        to_ms: q.to,
        sort,
        descending,
        cursor: q.cursor.clone().filter(|c| !c.is_empty()),
        limit: q.limit.unwrap_or(0),
    })
}

pub async fn trades(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    ApiQuery(q): ApiQuery<TradesParams>,
) -> Result<Json<Value>, ApiFailure> {
    let jq = journal_query(&st, &s, &q).await?;
    if q.status.as_deref() == Some("open") {
        let p = st.engine.published();
        let pair = jq.pair.as_ref().map(|x| x.to_ascii_lowercase());
        let open: Vec<&Position> = p
            .positions
            .values()
            .filter(|pos| jq.bots.as_ref().is_none_or(|b| b.contains(&pos.bot_key)))
            .filter(|pos| jq.side.is_none_or(|sd| sd == pos.side))
            .filter(|pos| {
                pair.as_ref()
                    .is_none_or(|x| pos.pair.to_ascii_lowercase().contains(x.as_str()))
            })
            .filter(|pos| {
                jq.mode.is_none_or(|m| {
                    p.bots
                        .get(&pos.bot_key)
                        .is_some_and(|b| b.identity.mode == m)
                })
            })
            .collect();
        return Ok(Json(json!({"open": open, "matched": open.len()})));
    }
    if matches!(q.status.as_deref(), Some(x) if x != "closed" && !x.is_empty()) {
        return Err(ApiFailure::bad_request("status is open or closed"));
    }
    let page = st.engine.journal(&jq);
    Ok(Json(json!({
        "rows": page.rows,
        "next_cursor": page.next_cursor,
        "matched": page.matched,
        "totals": page.totals,
    })))
}

pub async fn trade_detail(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    Path((key, trade_id)): Path<(String, i64)>,
) -> Result<Json<Value>, ApiFailure> {
    let key = parse_key(&key)?;
    guard_bot(&st, &s, &key)?;
    let p = st.engine.published();
    let position = p
        .positions
        .get(&fg_engine::ledger_data::trade_key(&key, trade_id))
        .cloned();
    let closed = p.data.get(&key).and_then(|d| {
        d.closed
            .iter()
            .find(|t| t.trade_id == trade_id)
            .map(|t| t.to_row(&key, d.mode))
    });
    if position.is_none() && closed.is_none() {
        return Err(ApiFailure::not_found());
    }
    let (orders, orders_error) = match st.engine.trade_orders(&key, trade_id).await {
        Ok(o) => (o, false),
        Err(_) => (Vec::new(), true),
    };
    Ok(Json(json!({
        "bot_key": key,
        "trade_id": trade_id,
        "position": position,
        "trade": closed,
        "orders": orders,
        "orders_error": orders_error,
    })))
}

/// Cells that a spreadsheet would run as a formula are prefixed so that they stay text.
fn csv_cell(v: Option<&Value>) -> String {
    let (text, is_text) = match v {
        None | Some(Value::Null) => return String::new(),
        Some(Value::String(t)) => (t.clone(), true),
        Some(Value::Bool(b)) => (b.to_string(), false),
        Some(Value::Number(n)) => (n.to_string(), false),
        Some(other) => (other.to_string(), true),
    };
    let text = if is_text && text.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{text}")
    } else {
        text
    };
    if text.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text
    }
}

const CSV_COLUMNS: [&str; 18] = [
    "bot_key",
    "trade_id",
    "pair",
    "side",
    "mode",
    "leverage",
    "open_ms",
    "close_ms",
    "open_rate",
    "close_rate",
    "amount",
    "stake_amount",
    "profit_abs",
    "profit_ratio",
    "profit_unknown",
    "exit_reason",
    "enter_tag",
    "manual",
];
const CSV_MAX_ROWS: usize = 100_000;

pub async fn trades_export(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    ApiQuery(q): ApiQuery<TradesParams>,
) -> Result<Response, ApiFailure> {
    let mut jq = journal_query(&st, &s, &q).await?;
    jq.limit = 500;
    jq.cursor = None;
    let mut out = CSV_COLUMNS.join(",");
    out.push('\n');
    let mut rows = 0usize;
    loop {
        let page = st.engine.journal(&jq);
        for r in &page.rows {
            let v = serde_json::to_value(r).unwrap_or(Value::Null);
            let line: Vec<String> = CSV_COLUMNS.iter().map(|c| csv_cell(v.get(*c))).collect();
            out.push_str(&line.join(","));
            out.push('\n');
        }
        rows += page.rows.len();
        match page.next_cursor {
            Some(c) if rows < CSV_MAX_ROWS => jq.cursor = Some(c),
            _ => break,
        }
    }
    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"trades.csv\"",
            ),
        ],
        out,
    )
        .into_response())
}

// --------------------------------------------------------------------------- curves and risk

#[derive(Deserialize, Default)]
pub struct ScopeParams {
    scope: Option<String>,
    bots: Option<String>,
    unit: Option<String>,
    tz: Option<String>,
    n: Option<usize>,
    from: Option<i64>,
    points: Option<usize>,
    mode: Option<String>,
    def: Option<String>,
    period: Option<String>,
}

pub async fn pnl_periods(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    ApiQuery(q): ApiQuery<ScopeParams>,
) -> Result<Json<Value>, ApiFailure> {
    let unit = match q.unit.as_deref() {
        None | Some("day") => PeriodUnit::Day,
        Some("week") => PeriodUnit::Week,
        Some("month") => PeriodUnit::Month,
        Some(_) => return Err(ApiFailure::bad_request("unit is day, week or month")),
    };
    let tz = st.cfg.general.timezone.clone();
    if let Some(asked) = q.tz.as_deref()
        && asked != tz
    {
        return Err(ApiFailure::bad_request(format!(
            "this gateway cuts periods in {tz}"
        )));
    }
    let scope = resolve_scope(&st, &s, q.scope.as_deref(), q.bots.as_deref()).await?;
    let n = q.n.unwrap_or(30).clamp(1, 366);
    let buckets = st
        .engine
        .pnl_calendar(&scope, unit, n)
        .map_err(scope_failure)?;
    Ok(Json(
        json!({"tz": tz, "unit": q.unit.as_deref().unwrap_or("day"), "buckets": buckets}),
    ))
}

pub async fn equity(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    ApiQuery(q): ApiQuery<ScopeParams>,
) -> Result<Response, ApiFailure> {
    let mode = match q.mode.as_deref() {
        None | Some("realized") => EquityMode::Realized,
        Some("with_open") => EquityMode::WithOpen,
        Some(_) => return Err(ApiFailure::bad_request("mode is realized or with_open")),
    };
    let scope = resolve_scope(&st, &s, q.scope.as_deref(), q.bots.as_deref()).await?;
    let points = st
        .engine
        .equity(
            &scope,
            q.from.unwrap_or(0),
            q.points.unwrap_or(300).clamp(2, 2_000),
            mode,
        )
        .map_err(scope_failure)?;
    let body = serde_json::to_vec(&json!({"points": points}))
        .map_err(|_| ApiFailure::new(ErrorCode::Internal, "cannot encode the curve"))?;
    let etag = format!("\"{}\"", &blake3::hash(&body).to_hex()[..16]);
    Ok((
        [
            (header::CONTENT_TYPE, "application/json".to_owned()),
            (header::ETAG, etag),
            (header::CACHE_CONTROL, "private, no-cache".to_owned()),
        ],
        body,
    )
        .into_response())
}

pub async fn drawdown(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    ApiQuery(q): ApiQuery<ScopeParams>,
) -> Result<Json<Value>, ApiFailure> {
    let scope = resolve_scope(&st, &s, q.scope.as_deref(), q.bots.as_deref()).await?;
    let d = st.engine.drawdown(&scope).map_err(scope_failure)?;
    Ok(Json(match q.def.as_deref() {
        None | Some("both") => json!(d),
        Some("realized") => json!({"def": "realized", "value": d.realized}),
        Some("with_open") => {
            json!({"def": "with_open", "value": d.with_open, "open_worst_sum": d.open_worst_sum})
        }
        Some(_) => {
            return Err(ApiFailure::bad_request(
                "def is realized, with_open or both",
            ));
        }
    }))
}

pub async fn leaderboard(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    ApiQuery(q): ApiQuery<ScopeParams>,
) -> Result<Json<Value>, ApiFailure> {
    guard_fleet(&st, &s)?;
    let mode = mode_of(q.scope.as_deref().unwrap_or("live"))
        .ok_or_else(|| ApiFailure::bad_request("scope is live, dry or replay"))?;
    let period: PeriodKey = serde_json::from_value(Value::String(
        q.period.clone().unwrap_or_else(|| "7d".to_owned()),
    ))
    .map_err(|_| ApiFailure::bad_request("unknown period"))?;
    let rows = st.engine.leaderboard(mode, period).map_err(scope_failure)?;
    Ok(Json(json!({"rows": rows})))
}

pub async fn risk_view(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    ApiQuery(q): ApiQuery<ScopeParams>,
) -> Result<Json<Value>, ApiFailure> {
    let scope = resolve_scope(&st, &s, q.scope.as_deref(), q.bots.as_deref()).await?;
    let p = st.engine.published();
    risk::compute(&p, &scope).map(Json).map_err(|e| match e {
        fg_engine::queries::ScopeError::UnknownBot => ApiFailure::not_found(),
        other => ApiFailure::bad_request(other.to_string()),
    })
}

// ---------------------------------------------------------------- health, logs, events, pairs

pub async fn health(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
) -> Result<Json<Value>, ApiFailure> {
    guard_fleet(&st, &s)?;
    let p = st.engine.published();
    let b = st.engine.budget_stats();
    let mut by_status: Map<String, Value> = Map::new();
    for bot in p.bots.values() {
        let k = serde_json::to_value(bot.state.status)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_default();
        let n = by_status.get(&k).and_then(Value::as_u64).unwrap_or(0) + 1;
        by_status.insert(k, json!(n));
    }
    Ok(Json(json!({
        "health": st.engine.health(),
        "bots": {"total": p.bots.len(), "by_status": by_status},
        "requests": {"granted": b.granted, "writes": b.writes, "waited_ms": b.waited_ms},
        "generated_ms": p.generated_ms,
    })))
}

#[derive(Deserialize, Default)]
pub struct RateParams {
    bot: Option<String>,
}

pub async fn health_rate(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    ApiQuery(q): ApiQuery<RateParams>,
) -> Result<Response, ApiFailure> {
    let key = parse_key(
        q.bot
            .as_deref()
            .ok_or_else(|| ApiFailure::bad_request("bot is required"))?,
    )?;
    guard_bot(&st, &s, &key)?;
    crate::routes::proxy::cached_get(&st, &key, "rate_metrics", "").await
}

#[derive(Deserialize, Default)]
pub struct LogParams {
    bot: Option<String>,
    level: Option<String>,
    q: Option<String>,
    cursor: Option<i64>,
    limit: Option<usize>,
}

fn level_rank(l: &str) -> u8 {
    match l.to_ascii_uppercase().as_str() {
        "CRITICAL" | "FATAL" => 4,
        "ERROR" => 3,
        "WARNING" | "WARN" => 2,
        "INFO" => 1,
        _ => 0,
    }
}

pub async fn logs(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    ApiQuery(q): ApiQuery<LogParams>,
) -> Result<Json<Value>, ApiFailure> {
    let only = q.bot.as_deref().map(parse_key).transpose()?;
    if let Some(k) = &only {
        guard_bot(&st, &s, k)?;
    }
    let min = match q.level.as_deref() {
        None | Some("") | Some("all" | "debug") => 0,
        Some("info") => 1,
        Some("warning") => 2,
        Some("error") => 3,
        Some(_) => {
            return Err(ApiFailure::bad_request(
                "level is debug, info, warning or error",
            ));
        }
    };
    let needle =
        q.q.as_ref()
            .map(|x| x.to_ascii_lowercase())
            .filter(|x| !x.is_empty());
    let p = match &only {
        Some(k) => published_with_detail(&st, k).await?,
        None => st.engine.published(),
    };
    let mut lines: Vec<(i64, Value)> = Vec::new();
    for (key, detail) in p.details.iter() {
        if only.as_ref().is_some_and(|o| o != key) || !st.bot_allowed(&s, key) {
            continue;
        }
        let name = p.bots.get(key).map(|b| b.identity.name.clone());
        for l in &detail.logs {
            if level_rank(&l.level) < min
                || q.cursor.is_some_and(|c| l.ts_ms >= c)
                || needle
                    .as_ref()
                    .is_some_and(|n| !l.message.to_ascii_lowercase().contains(n.as_str()))
            {
                continue;
            }
            lines.push((
                l.ts_ms,
                json!({"ts_ms": l.ts_ms, "level": l.level, "message": l.message, "bot_key": key, "bot_name": name}),
            ));
        }
    }
    lines.sort_by_key(|(t, _)| std::cmp::Reverse(*t));
    let limit = q.limit.unwrap_or(200).clamp(1, 1_000);
    let more = lines.len() > limit;
    lines.truncate(limit);
    let next_cursor = more.then(|| lines.last().map(|(t, _)| *t)).flatten();
    Ok(Json(json!({
        "lines": lines.into_iter().map(|(_, v)| v).collect::<Vec<_>>(),
        "next_cursor": next_cursor,
    })))
}

#[derive(Deserialize, Default)]
pub struct EventParams {
    since: Option<i64>,
    kinds: Option<String>,
    bot: Option<String>,
    limit: Option<usize>,
}

pub async fn events(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    ApiQuery(q): ApiQuery<EventParams>,
) -> Result<Json<Value>, ApiFailure> {
    let bot = q.bot.as_deref().map(parse_key).transpose()?;
    if let Some(k) = &bot {
        guard_bot(&st, &s, k)?;
    }
    let kinds = match q.kinds.as_deref().filter(|k| !k.is_empty()) {
        None => None,
        Some(csv) => Some(
            csv.split(',')
                .map(|k| {
                    serde_json::from_value::<EventKind>(Value::String(k.trim().to_owned()))
                        .map_err(|_| ApiFailure::bad_request(format!("unknown event kind {k:?}")))
                })
                .collect::<Result<Vec<_>, _>>()?,
        ),
    };
    let mut ev = st
        .engine
        .events(EventQuery {
            since_ms: q.since.unwrap_or_else(|| now_ms() - 24 * 3_600_000),
            kinds,
            bot,
            limit: q.limit.unwrap_or(0),
        })
        .await;
    ev.retain(|e| e.bot_key.as_ref().is_none_or(|k| st.bot_allowed(&s, k)));
    Ok(Json(json!({"events": ev})))
}

#[derive(Deserialize, Default)]
pub struct PairParams {
    signals: Option<bool>,
}

pub async fn pairs(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    Path(key): Path<String>,
    ApiQuery(q): ApiQuery<PairParams>,
) -> Result<Json<Value>, ApiFailure> {
    let key = parse_key(&key)?;
    guard_bot(&st, &s, &key)?;
    let p = published_with_detail(&st, &key).await?;
    let detail = p.details.get(&key).ok_or_else(ApiFailure::not_found)?;
    let open_pairs: Vec<&str> = p
        .positions
        .values()
        .filter(|pos| pos.bot_key == key)
        .map(|pos| pos.pair.as_str())
        .collect();
    let signals = if q.signals == Some(true) {
        let r = crate::routes::proxy::cached_get(&st, &key, "signal_summary", "").await;
        match r {
            Ok(resp) => {
                let bytes = axum::body::to_bytes(resp.into_body(), 4 * 1024 * 1024)
                    .await
                    .unwrap_or_default();
                serde_json::from_slice::<Value>(&bytes).ok()
            }
            Err(_) => None,
        }
    } else {
        None
    };
    Ok(Json(json!({
        "bot_key": key,
        "whitelist": detail.whitelist,
        "blacklist": detail.blacklist,
        "locks": detail.locks,
        "open_pairs": open_pairs,
        "signals": signals,
        "freshness": detail.freshness,
    })))
}

pub async fn market(State(st): State<AppState>) -> Json<Value> {
    Json(json!({"tickers": st.engine.market()}))
}

#[derive(Deserialize, Default)]
pub struct AuditParams {
    from: Option<i64>,
    bot: Option<String>,
    limit: Option<usize>,
}

pub async fn audit(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    ApiQuery(q): ApiQuery<AuditParams>,
) -> Result<Json<Value>, ApiFailure> {
    let bot = q.bot.as_deref().map(parse_key).transpose()?;
    if let Some(k) = &bot {
        guard_bot(&st, &s, k)?;
    }
    let mut entries = st
        .engine
        .audit(q.from.unwrap_or(0), bot, q.limit.unwrap_or(200))
        .await
        .map_err(ApiFailure::from)?;
    entries.retain(|e| st.bot_allowed(&s, &e.bot_key));
    Ok(Json(json!({"entries": entries})))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_cells_stay_text_and_numbers_stay_numbers() {
        assert_eq!(csv_cell(None), "");
        assert_eq!(csv_cell(Some(&Value::Null)), "");
        assert_eq!(
            csv_cell(Some(&json!(-3.25))),
            "-3.25",
            "a negative number is not a formula"
        );
        assert_eq!(csv_cell(Some(&json!(true))), "true");
        assert_eq!(csv_cell(Some(&json!("ETH/USDC:USDC"))), "ETH/USDC:USDC");
        // Formulas are defused, whichever way they start.
        for f in ["=1+1", "+1", "-1", "@SUM(A1)", "\tcmd", "\rcmd"] {
            assert!(
                csv_cell(Some(&json!(f)))
                    .trim_start_matches('"')
                    .starts_with('\''),
                "{f:?}"
            );
        }
        // Separators, quotes and line breaks are quoted; quotes are doubled.
        assert_eq!(csv_cell(Some(&json!("a,b"))), "\"a,b\"");
        assert_eq!(csv_cell(Some(&json!("say \"hi\""))), "\"say \"\"hi\"\"\"");
        assert_eq!(csv_cell(Some(&json!("l1\nl2"))), "\"l1\nl2\"");
        assert_eq!(csv_cell(Some(&json!("=A,B"))), "\"'=A,B\"");
    }
}
