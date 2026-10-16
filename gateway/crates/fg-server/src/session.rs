//! Sessions of the browsers (03 section 3.1, level 2).
//!
//! A session token is 256 random bits, shown to the client once. The server keeps only its
//! blake3 hash (in memory and in `state.db`), so neither a memory dump of the table nor a backup
//! of the database yields a usable token. The lifetime slides: a session that is used at least
//! once per [`TOUCH_EVERY_MS`] is extended to a full TTL from now.

use std::collections::{BTreeSet, HashMap};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, RwLock};

use fg_core::identity::BotKey;
use fg_core::model::BotAlias;
use fg_core::protocol::MAX_WS_PER_SESSION;
use fg_engine::state_db::{StateDb, StateDbError};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use crate::config::AuthMode;
use crate::util::{base64url, now_ms, random_bytes};

/// A used session is re-stamped (and written to disk) at most this often.
pub const TOUCH_EVERY_MS: i64 = 10 * 60 * 1000;
/// Sessions kept; the least recently used one makes room for a new one.
pub const MAX_SESSIONS: usize = 500;
/// Prefix of every session token: lets log scrubbers and secret scanners recognise them.
pub const TOKEN_PREFIX: &str = "fgs_";

/// Which bots a session may reach.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Scope {
    /// Every bot (password login).
    All,
    /// The bots whose trust group a proof succeeded for. A group is the set of bots that share
    /// the same API user and JWT secret, so a proof on one of them is valid for all of them.
    Groups(BTreeSet<String>),
}

/// A session as listed to its owner. Never contains the token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Session {
    pub id: String,
    pub device_id: String,
    pub ip: String,
    pub user_agent: String,
    pub created_ms: i64,
    pub last_seen_ms: i64,
    pub expires_ms: i64,
    #[serde(skip)]
    pub scope: Scope,
    pub method: AuthMode,
}

/// What a new session is made of.
#[derive(Debug, Clone)]
pub struct NewSession {
    pub device_id: String,
    pub ip: String,
    pub user_agent: String,
    pub scope: Scope,
    pub method: AuthMode,
}

struct Entry {
    session: Session,
    ws: Arc<AtomicUsize>,
}

/// Holds one WebSocket slot of a session until dropped.
pub struct WsSlot {
    counter: Arc<AtomicUsize>,
}

impl Drop for WsSlot {
    fn drop(&mut self) {
        self.counter.fetch_sub(1, Ordering::SeqCst);
    }
}

/// The session table.
pub struct SessionStore {
    db: StateDb,
    ttl_ms: i64,
    by_hash: RwLock<HashMap<String, Entry>>,
    aliases: RwLock<Vec<BotAlias>>,
    revoked: broadcast::Sender<String>,
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS sessions (
    hash TEXT PRIMARY KEY, id TEXT NOT NULL, device_id TEXT NOT NULL, ip TEXT NOT NULL,
    user_agent TEXT NOT NULL, created_ms INTEGER NOT NULL, last_seen_ms INTEGER NOT NULL,
    expires_ms INTEGER NOT NULL, scope TEXT NOT NULL, method TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bot_aliases (
    device_id TEXT NOT NULL, ui_id TEXT NOT NULL, bot_key TEXT NOT NULL,
    PRIMARY KEY (device_id, ui_id));
";

fn hash_token(token: &str) -> String {
    blake3::hash(token.as_bytes()).to_hex().to_string()
}

fn method_str(m: AuthMode) -> &'static str {
    m.as_str()
}

fn method_from(s: &str) -> Option<AuthMode> {
    match s {
        "token_proof" => Some(AuthMode::TokenProof),
        "bot_credentials" => Some(AuthMode::BotCredentials),
        "password" => Some(AuthMode::Password),
        _ => None,
    }
}

impl SessionStore {
    /// Create the tables if needed and load the sessions that have not expired.
    ///
    /// # Errors
    /// `state.db` cannot be used.
    pub async fn open(db: StateDb, ttl_days: u32) -> Result<Self, StateDbError> {
        let now = now_ms();
        let (rows, aliases) = db
            .call(move |c| {
                c.execute_batch(SCHEMA)?;
                c.execute("DELETE FROM sessions WHERE expires_ms <= ?1", [now])?;
                let mut st = c.prepare(
                    "SELECT hash, id, device_id, ip, user_agent, created_ms, last_seen_ms, \
                     expires_ms, scope, method FROM sessions",
                )?;
                let rows = st
                    .query_map([], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            Session {
                                id: r.get(1)?,
                                device_id: r.get(2)?,
                                ip: r.get(3)?,
                                user_agent: r.get(4)?,
                                created_ms: r.get(5)?,
                                last_seen_ms: r.get(6)?,
                                expires_ms: r.get(7)?,
                                scope: serde_json::from_str(&r.get::<_, String>(8)?)
                                    .unwrap_or(Scope::Groups(BTreeSet::new())),
                                method: method_from(&r.get::<_, String>(9)?)
                                    .unwrap_or(AuthMode::TokenProof),
                            },
                        ))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                let mut st = c.prepare("SELECT device_id, ui_id, bot_key FROM bot_aliases")?;
                let aliases = st
                    .query_map([], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                        ))
                    })?
                    .filter_map(Result::ok)
                    .filter_map(|(device_id, ui_id, k)| {
                        Some(BotAlias {
                            device_id,
                            ui_id,
                            bot_key: k.parse::<BotKey>().ok()?,
                        })
                    })
                    .collect::<Vec<_>>();
                Ok((rows, aliases))
            })
            .await?;
        let map = rows
            .into_iter()
            .map(|(h, session)| {
                (
                    h,
                    Entry {
                        session,
                        ws: Arc::new(AtomicUsize::new(0)),
                    },
                )
            })
            .collect();
        Ok(Self {
            db,
            ttl_ms: i64::from(ttl_days.max(1)) * 24 * 3_600_000,
            by_hash: RwLock::new(map),
            aliases: RwLock::new(aliases),
            revoked: broadcast::channel(64).0,
        })
    }

    fn persist(&self, hash: &str, s: &Session) {
        let (hash, s) = (hash.to_owned(), s.clone());
        let scope = serde_json::to_string(&s.scope).unwrap_or_default();
        self.db.fire(move |c| {
            c.execute(
                "INSERT OR REPLACE INTO sessions (hash, id, device_id, ip, user_agent, \
                 created_ms, last_seen_ms, expires_ms, scope, method) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    hash,
                    s.id,
                    s.device_id,
                    s.ip,
                    s.user_agent,
                    s.created_ms,
                    s.last_seen_ms,
                    s.expires_ms,
                    scope,
                    method_str(s.method)
                ],
            )?;
            Ok(())
        });
    }

    /// Open a session. Returns the token (shown once) and the session.
    pub fn create(&self, new: NewSession) -> (String, Session) {
        let token = format!("{TOKEN_PREFIX}{}", base64url(&random_bytes::<32>()));
        let hash = hash_token(&token);
        let now = now_ms();
        let session = Session {
            id: hash[..16].to_owned(),
            device_id: new.device_id,
            ip: new.ip,
            user_agent: new.user_agent.chars().take(160).collect(),
            created_ms: now,
            last_seen_ms: now,
            expires_ms: now + self.ttl_ms,
            scope: new.scope,
            method: new.method,
        };
        {
            let mut map = self
                .by_hash
                .write()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            map.retain(|_, e| e.session.expires_ms > now);
            while map.len() >= MAX_SESSIONS {
                let oldest = map
                    .iter()
                    .min_by_key(|(_, e)| e.session.last_seen_ms)
                    .map(|(h, _)| h.clone());
                match oldest {
                    Some(h) => {
                        if let Some(e) = map.remove(&h) {
                            let _ = self.revoked.send(e.session.id.clone());
                            self.forget_row(h);
                        }
                    }
                    None => break,
                }
            }
            map.insert(
                hash.clone(),
                Entry {
                    session: session.clone(),
                    ws: Arc::new(AtomicUsize::new(0)),
                },
            );
        }
        self.persist(&hash, &session);
        (token, session)
    }

    fn forget_row(&self, hash: String) {
        self.db.fire(move |c| {
            c.execute("DELETE FROM sessions WHERE hash = ?1", [hash])?;
            Ok(())
        });
    }

    /// The session of a token, extended when it is used. `None` for an unknown, malformed or
    /// expired token.
    #[must_use]
    pub fn lookup(&self, token: &str) -> Option<Session> {
        if !token.starts_with(TOKEN_PREFIX) || token.len() > 128 {
            return None;
        }
        let hash = hash_token(token);
        let now = now_ms();
        {
            let map = self
                .by_hash
                .read()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let e = map.get(&hash)?;
            if e.session.expires_ms <= now {
                return None;
            }
            if now - e.session.last_seen_ms < TOUCH_EVERY_MS {
                return Some(e.session.clone());
            }
        }
        let mut map = self
            .by_hash
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let e = map.get_mut(&hash)?;
        if e.session.expires_ms <= now {
            return None;
        }
        e.session.last_seen_ms = now;
        e.session.expires_ms = now + self.ttl_ms;
        let s = e.session.clone();
        drop(map);
        self.persist(&hash, &s);
        Some(s)
    }

    /// Whether the session `id` still exists and has not expired (for open WebSockets).
    #[must_use]
    pub fn is_live(&self, id: &str) -> bool {
        let now = now_ms();
        self.by_hash
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
            .any(|e| e.session.id == id && e.session.expires_ms > now)
    }

    /// Delete a session. Returns whether it existed.
    pub fn revoke(&self, id: &str) -> bool {
        let mut map = self
            .by_hash
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let hash = map
            .iter()
            .find(|(_, e)| e.session.id == id)
            .map(|(h, _)| h.clone());
        let Some(hash) = hash else {
            return false;
        };
        map.remove(&hash);
        drop(map);
        self.forget_row(hash);
        let _ = self.revoked.send(id.to_owned());
        true
    }

    /// Sessions, most recently used first.
    #[must_use]
    pub fn list(&self) -> Vec<Session> {
        let now = now_ms();
        let mut v: Vec<Session> = self
            .by_hash
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .values()
            .filter(|e| e.session.expires_ms > now)
            .map(|e| e.session.clone())
            .collect();
        v.sort_by_key(|s| std::cmp::Reverse(s.last_seen_ms));
        v
    }

    /// Ids of the sessions that get revoked from now on.
    #[must_use]
    pub fn revocations(&self) -> broadcast::Receiver<String> {
        self.revoked.subscribe()
    }

    /// Take a WebSocket slot; `None` when the session already has [`MAX_WS_PER_SESSION`].
    #[must_use]
    pub fn ws_acquire(&self, id: &str) -> Option<WsSlot> {
        let map = self
            .by_hash
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let e = map.values().find(|e| e.session.id == id)?;
        let n = e.ws.fetch_add(1, Ordering::SeqCst);
        if n >= MAX_WS_PER_SESSION {
            e.ws.fetch_sub(1, Ordering::SeqCst);
            return None;
        }
        Some(WsSlot {
            counter: Arc::clone(&e.ws),
        })
    }

    /// Replace the `ftbot.N` aliases of a device.
    pub fn set_aliases(&self, device_id: &str, aliases: Vec<BotAlias>) {
        {
            let mut all = self
                .aliases
                .write()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            all.retain(|a| a.device_id != device_id);
            all.extend(aliases.iter().cloned());
        }
        let device = device_id.to_owned();
        self.db.fire(move |c| {
            let tx = c.transaction()?;
            tx.execute("DELETE FROM bot_aliases WHERE device_id = ?1", [&device])?;
            for a in &aliases {
                tx.execute(
                    "INSERT OR REPLACE INTO bot_aliases (device_id, ui_id, bot_key) VALUES (?1, ?2, ?3)",
                    params![a.device_id, a.ui_id, a.bot_key.to_string()],
                )?;
            }
            tx.commit()?;
            Ok(())
        });
    }

    /// The aliases of a device.
    #[must_use]
    pub fn aliases(&self, device_id: &str) -> Vec<BotAlias> {
        self.aliases
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .filter(|a| a.device_id == device_id)
            .cloned()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_session(device: &str) -> NewSession {
        NewSession {
            device_id: device.into(),
            ip: "10.0.0.1".into(),
            user_agent: "test".into(),
            scope: Scope::All,
            method: AuthMode::Password,
        }
    }

    async fn store(dir: &std::path::Path, ttl_days: u32) -> SessionStore {
        let db = StateDb::open(dir).unwrap();
        SessionStore::open(db, ttl_days).await.unwrap()
    }

    #[tokio::test]
    async fn a_token_finds_its_session_and_a_wrong_one_does_not() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path(), 30).await;
        let (token, session) = s.create(new_session("d1"));
        assert!(token.starts_with(TOKEN_PREFIX));
        assert_eq!(s.lookup(&token).unwrap().id, session.id);
        for bad in [
            "",
            "fgs_",
            "fgs_nope",
            &token[..token.len() - 1],
            "Bearer x",
        ] {
            assert!(s.lookup(bad).is_none(), "{bad}");
        }
    }

    #[tokio::test]
    async fn only_the_hash_of_a_token_is_stored() {
        let dir = tempfile::tempdir().unwrap();
        let (token, _) = {
            let s = store(dir.path(), 30).await;
            let r = s.create(new_session("d1"));
            s.db.flush().await;
            r
        };
        for f in ["state.db", "state.db-wal"] {
            let bytes = std::fs::read(dir.path().join(f)).unwrap_or_default();
            let hay = String::from_utf8_lossy(&bytes);
            assert!(!hay.contains(&token), "token found in {f}");
            assert!(
                !hay.contains(&token[TOKEN_PREFIX.len()..]),
                "token body found in {f}"
            );
        }
        // And the session survives a restart: the hash is enough to find it.
        let s = store(dir.path(), 30).await;
        assert!(s.lookup(&token).is_some());
    }

    #[tokio::test]
    async fn revocation_is_immediate_and_announced() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path(), 30).await;
        let mut rx = s.revocations();
        let (token, session) = s.create(new_session("d1"));
        assert!(s.revoke(&session.id));
        assert!(s.lookup(&token).is_none());
        assert_eq!(rx.recv().await.unwrap(), session.id);
        assert!(!s.revoke(&session.id));
        assert!(!s.is_live(&session.id));
    }

    #[tokio::test]
    async fn an_expired_session_is_gone_and_a_used_one_slides() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path(), 30).await;
        let (token, session) = s.create(new_session("d1"));
        let hash = hash_token(&token);
        // Age the session: last seen long ago, expiring soon.
        {
            let mut map = s.by_hash.write().unwrap();
            let e = map.get_mut(&hash).unwrap();
            e.session.last_seen_ms -= 2 * TOUCH_EVERY_MS;
            e.session.expires_ms = now_ms() + 1_000;
        }
        let touched = s.lookup(&token).unwrap();
        assert!(
            touched.expires_ms > now_ms() + 29 * 24 * 3_600_000,
            "extended to a full TTL"
        );
        {
            let mut map = s.by_hash.write().unwrap();
            map.get_mut(&hash).unwrap().session.expires_ms = now_ms() - 1;
        }
        assert!(s.lookup(&token).is_none());
        assert!(s.list().iter().all(|x| x.id != session.id));
    }

    #[tokio::test]
    async fn a_session_has_at_most_eight_websockets() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path(), 30).await;
        let (_, session) = s.create(new_session("d1"));
        let slots: Vec<_> = (0..MAX_WS_PER_SESSION)
            .map(|_| s.ws_acquire(&session.id).expect("slot"))
            .collect();
        assert!(s.ws_acquire(&session.id).is_none());
        drop(slots);
        assert!(s.ws_acquire(&session.id).is_some());
    }

    #[tokio::test]
    async fn aliases_are_per_device_and_survive_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        {
            let s = store(dir.path(), 30).await;
            s.set_aliases(
                "phone",
                vec![BotAlias {
                    device_id: "phone".into(),
                    ui_id: "ftbot.3".into(),
                    bot_key: BotKey::Local(9056),
                }],
            );
            s.set_aliases(
                "laptop",
                vec![BotAlias {
                    device_id: "laptop".into(),
                    ui_id: "ftbot.0".into(),
                    bot_key: BotKey::Local(9056),
                }],
            );
            s.db.flush().await;
        }
        let s = store(dir.path(), 30).await;
        assert_eq!(s.aliases("phone")[0].ui_id, "ftbot.3");
        assert_eq!(s.aliases("laptop")[0].ui_id, "ftbot.0");
        assert!(s.aliases("tablet").is_empty());
    }

    #[tokio::test]
    async fn the_table_is_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path(), 30).await;
        for i in 0..MAX_SESSIONS + 5 {
            s.create(new_session(&format!("d{i}")));
        }
        assert!(s.list().len() <= MAX_SESSIONS);
    }
}
