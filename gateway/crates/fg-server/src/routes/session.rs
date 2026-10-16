//! Session endpoints: `hello`, the silent bootstrap, the login fallbacks and the session list
//! (03 sections 3.2, 3.3 and 6.3).

use std::collections::{BTreeSet, HashMap};

use axum::Json;
use axum::extract::{Extension, Path, State};
use axum::http::StatusCode;
use fg_core::identity::BotKey;
use fg_core::model::BotAlias;
use fg_core::protocol::{ErrorCode, HEARTBEAT_INTERVAL_S, PROTOCOL_VERSION};
use fg_sources::sensitive::Secret;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::config::AuthMode;
use crate::directory::DirBot;
use crate::error::{ApiFailure, ApiJson};
use crate::password::verify_password;
use crate::probe::ProbeVerdict;
use crate::session::{NewSession, Scope, Session};
use crate::state::{AppState, Client, PREFS_USER};
use crate::util::now_ms;

/// Most bots a bootstrap may list.
const MAX_BOOT_BOTS: usize = 64;
/// Proofs a single bootstrap may ask of the bots.
const MAX_PROOFS: usize = 8;
/// Attempts per trust group within one bootstrap (a stale token must not hide a good one).
const MAX_PROOFS_PER_GROUP: usize = 2;

pub async fn hello(State(st): State<AppState>) -> Json<Value> {
    Json(json!({
        "service": "frequi-gateway",
        "version": env!("CARGO_PKG_VERSION"),
        "protocol": PROTOCOL_VERSION,
        "auth_modes": st.cfg.auth.modes.iter().map(|m| m.as_str()).collect::<Vec<_>>(),
        "hb_interval_s": HEARTBEAT_INTERVAL_S,
        "server_time_ms": now_ms(),
    }))
}

fn valid_id(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

#[derive(Deserialize)]
pub struct BootBot {
    #[serde(alias = "uiId")]
    ui_id: String,
    #[serde(alias = "apiUrl")]
    api_url: String,
    #[serde(alias = "accessToken", default)]
    access_token: Option<Secret>,
    /// Accepted for compatibility with the SPA's registry; never stored: the gateway logs in to
    /// the bots with the credentials of their configs.
    #[serde(alias = "refreshToken", default)]
    #[allow(dead_code)]
    refresh_token: Option<Secret>,
}

#[derive(Deserialize)]
pub struct Bootstrap {
    #[serde(alias = "deviceId")]
    device_id: String,
    bots: Vec<BootBot>,
    #[serde(default)]
    prefs: Option<Value>,
}

#[derive(Serialize)]
pub struct BootEntry {
    pub ui_id: String,
    pub bot_key: Option<String>,
    /// `granted`, `denied` (the bot rejected the token), `unknown_bot`, `remote_unsupported`,
    /// `invalid`.
    pub scope: &'static str,
}

#[derive(Serialize)]
pub struct SessionBody {
    pub session: String,
    pub session_id: String,
    pub expires_at: i64,
    pub device_id: String,
    pub protocol: u32,
    pub bots: Vec<BootEntry>,
}

fn session_failure(st: &AppState, client: &Client, why: &'static str) -> ApiFailure {
    let locked = st.limits.record_failure(client.ip, now_ms());
    tracing::warn!(event = "login_failed", ip = %client.ip, why, locked);
    ApiFailure::unauthorized().with_status(StatusCode::UNAUTHORIZED)
}

fn limited(st: &AppState, client: &Client) -> Result<(), ApiFailure> {
    st.limits
        .check_login(client.ip, now_ms())
        .map_err(|l| ApiFailure::rate_limited(l.retry_after_ms))
}

/// `POST /session/bootstrap`: exchange a bot access token the browser already holds for a
/// session. The bot is asked to confirm the token; the target is the bot found by discovery.
pub async fn bootstrap(
    State(st): State<AppState>,
    Extension(client): Extension<Client>,
    ApiJson(body): ApiJson<Bootstrap>,
) -> Result<Json<SessionBody>, ApiFailure> {
    if !st.cfg.auth.modes.contains(&AuthMode::TokenProof) {
        return Err(ApiFailure::forbidden("token proof is not enabled"));
    }
    limited(&st, &client)?;
    if !valid_id(&body.device_id, 64) || body.bots.is_empty() || body.bots.len() > MAX_BOOT_BOTS {
        return Err(ApiFailure::bad_request(
            "device_id and 1 to 64 bots are required",
        ));
    }

    let dir = st.directory.bots();
    let local: Vec<&str> = st.local_hosts.iter().map(String::as_str).collect();
    // Resolve every entry to a discovered bot, or to a reason.
    let resolved: Vec<Result<DirBot, &'static str>> = body
        .bots
        .iter()
        .map(|b| match BotKey::from_api_url(&b.api_url, &local) {
            // Whitespace and control characters are not part of any URL a browser holds.
            _ if b.api_url.bytes().any(|c| c <= b' ' || c == 0x7f) => Err("invalid"),
            Err(_) => Err("invalid"),
            Ok(BotKey::Url(_)) => Err("remote_unsupported"),
            Ok(k) => dir
                .iter()
                .find(|d| d.key == k)
                .cloned()
                .ok_or("unknown_bot"),
        })
        .collect();

    let mut proven: BTreeSet<String> = BTreeSet::new();
    let mut attempts: HashMap<String, usize> = HashMap::new();
    let mut proofs = 0;
    for (entry, target) in body.bots.iter().zip(&resolved) {
        let (Some(token), Ok(bot)) = (&entry.access_token, target) else {
            continue;
        };
        if proven.contains(&bot.group)
            || proofs >= MAX_PROOFS
            || attempts.get(&bot.group).copied().unwrap_or(0) >= MAX_PROOFS_PER_GROUP
        {
            continue;
        }
        proofs += 1;
        *attempts.entry(bot.group.clone()).or_default() += 1;
        if st.probe.prove(&bot.host, bot.port, token).await == ProbeVerdict::Accepted {
            proven.insert(bot.group.clone());
        }
    }
    if proven.is_empty() {
        return Err(session_failure(&st, &client, "no proof"));
    }
    st.limits.record_success(client.ip);

    let (token, session) = st.sessions.create(NewSession {
        device_id: body.device_id.clone(),
        ip: client.ip.to_string(),
        user_agent: client.user_agent.clone(),
        scope: Scope::Groups(proven.clone()),
        method: AuthMode::TokenProof,
    });
    tracing::info!(event = "session_created", method = "token_proof", device = %session.device_id,
        ip = %client.ip, groups = proven.len());

    let mut aliases = Vec::new();
    let bots = body
        .bots
        .iter()
        .zip(&resolved)
        .map(|(entry, target)| match target {
            Ok(bot) if proven.contains(&bot.group) => {
                if valid_id(&entry.ui_id, 32) {
                    aliases.push(BotAlias {
                        device_id: session.device_id.clone(),
                        ui_id: entry.ui_id.clone(),
                        bot_key: bot.key.clone(),
                    });
                }
                BootEntry {
                    ui_id: entry.ui_id.clone(),
                    bot_key: Some(bot.key.to_string()),
                    scope: "granted",
                }
            }
            Ok(bot) => BootEntry {
                ui_id: entry.ui_id.clone(),
                bot_key: Some(bot.key.to_string()),
                scope: "denied",
            },
            Err(why) => BootEntry {
                ui_id: entry.ui_id.clone(),
                bot_key: None,
                scope: why,
            },
        })
        .collect();
    st.sessions.set_aliases(&session.device_id, aliases);

    // First device to arrive seeds the synchronised preferences; later ones never overwrite.
    if let Some(prefs) = body.prefs {
        let _ = st.engine.prefs_put(PREFS_USER, "", prefs, Some(0)).await;
    }

    Ok(Json(SessionBody {
        session: token,
        session_id: session.id,
        expires_at: session.expires_ms,
        device_id: session.device_id,
        protocol: PROTOCOL_VERSION,
        bots,
    }))
}

#[derive(Deserialize)]
pub struct Login {
    mode: AuthMode,
    #[serde(default)]
    username: Option<Secret>,
    password: Secret,
    #[serde(alias = "deviceId")]
    device_id: String,
}

/// `POST /session/login`: the fallbacks when the browser holds no valid bot token.
pub async fn login(
    State(st): State<AppState>,
    Extension(client): Extension<Client>,
    ApiJson(body): ApiJson<Login>,
) -> Result<Json<SessionBody>, ApiFailure> {
    limited(&st, &client)?;
    if !valid_id(&body.device_id, 64) {
        return Err(ApiFailure::bad_request("device_id is required"));
    }
    if body.mode == AuthMode::TokenProof || !st.cfg.auth.modes.contains(&body.mode) {
        return Err(ApiFailure::forbidden("this login mode is not enabled"));
    }
    let scope = match body.mode {
        AuthMode::Password => {
            let Some(hash) = st.cfg.auth.password_hash.clone() else {
                return Err(ApiFailure::forbidden("this login mode is not enabled"));
            };
            let pw = body.password.clone();
            let ok = tokio::task::spawn_blocking(move || verify_password(pw.expose(), &hash))
                .await
                .unwrap_or(false);
            if !ok {
                return Err(session_failure(&st, &client, "bad password"));
            }
            Scope::All
        }
        AuthMode::BotCredentials => {
            let Some(user) = &body.username else {
                return Err(ApiFailure::bad_request("username is required"));
            };
            let fp = user.fingerprint();
            // Only the bots whose configured user name is the one typed are asked, one per
            // trust group: a wrong name never reaches a bot.
            let mut seen = BTreeSet::new();
            let candidates: Vec<DirBot> = st
                .directory
                .bots()
                .into_iter()
                .filter(|b| b.user_fp.as_deref() == Some(fp.as_str()))
                .filter(|b| seen.insert(b.group.clone()))
                .take(3)
                .collect();
            let mut groups = BTreeSet::new();
            for bot in &candidates {
                if st
                    .probe
                    .login(&bot.host, bot.port, user, &body.password)
                    .await
                    == ProbeVerdict::Accepted
                {
                    groups.insert(bot.group.clone());
                }
            }
            if groups.is_empty() {
                return Err(session_failure(&st, &client, "bad credentials"));
            }
            Scope::Groups(groups)
        }
        AuthMode::TokenProof => unreachable!("refused above"),
    };
    st.limits.record_success(client.ip);
    let (token, session) = st.sessions.create(NewSession {
        device_id: body.device_id,
        ip: client.ip.to_string(),
        user_agent: client.user_agent.clone(),
        scope,
        method: body.mode,
    });
    tracing::info!(event = "session_created", method = body.mode.as_str(), device = %session.device_id,
        ip = %client.ip);
    Ok(Json(SessionBody {
        session: token,
        session_id: session.id,
        expires_at: session.expires_ms,
        device_id: session.device_id,
        protocol: PROTOCOL_VERSION,
        bots: Vec::new(),
    }))
}

/// `DELETE /session`: log out of this session.
pub async fn logout(State(st): State<AppState>, Extension(s): Extension<Session>) -> StatusCode {
    st.sessions.revoke(&s.id);
    tracing::info!(event = "session_revoked", session = %s.id, by = "owner");
    StatusCode::NO_CONTENT
}

/// `GET /sessions`.
pub async fn list(State(st): State<AppState>, Extension(s): Extension<Session>) -> Json<Value> {
    let sessions: Vec<Value> = st
        .sessions
        .list()
        .into_iter()
        .map(|x| {
            let mut v = serde_json::to_value(&x).unwrap_or(Value::Null);
            v["current"] = Value::Bool(x.id == s.id);
            v
        })
        .collect();
    Json(json!({ "sessions": sessions }))
}

/// `DELETE /sessions/{id}`.
pub async fn revoke(
    State(st): State<AppState>,
    Extension(s): Extension<Session>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiFailure> {
    if st.sessions.revoke(&id) {
        tracing::info!(event = "session_revoked", session = %id, by = %s.id);
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiFailure::new(ErrorCode::NotFound, "no such session"))
    }
}
