//! The gateway's own database, `state.db` (03 sections 2.1 and 7): alert book and rules,
//! preferences, event history, idempotency table and the append-only audit trail.
//!
//! This is **not** a bot database: it lives under the gateway data directory, is opened
//! read-write, in WAL mode, and never touches a path outside it.
//!
//! All access goes through one dedicated thread that owns the connection and runs jobs in the
//! order they were submitted. A read submitted after a write therefore sees it, and two writes
//! never race. No token or secret is ever written here: audit parameters are sanitised by the
//! caller and the response is truncated to 2 KB.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread::JoinHandle;

use fg_core::alerts::AlertRulesConfig;
use fg_core::alerts::book::BookState;
use fg_core::model::{ActionResult, AuditEntry, Event, PrefsDoc};
use rusqlite::{Connection, OptionalExtension, params};
use thiserror::Error;
use tokio::sync::oneshot;

/// Largest preference document accepted (bytes of JSON).
pub const MAX_PREFS_BYTES: usize = 256 * 1024;
/// Largest number of documents per user.
pub const MAX_PREFS_SCOPES: usize = 400;
const SCHEMA_VERSION: &str = "1";

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS alert_book (
    id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS alert_rules (
    id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS prefs (
    user TEXT NOT NULL, scope TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL,
    updated_ms INTEGER NOT NULL, PRIMARY KEY (user, scope));
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts_ms INTEGER NOT NULL, kind TEXT NOT NULL,
    bot_key TEXT, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts_ms);
CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts_ms INTEGER NOT NULL, bot_key TEXT NOT NULL,
    action TEXT NOT NULL, idempotency_key TEXT NOT NULL, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS audit_ts ON audit (ts_ms);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit
    BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit
    BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TABLE IF NOT EXISTS idempotency (
    key TEXT PRIMARY KEY, bot_key TEXT NOT NULL, action TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('in_flight', 'done')),
    result TEXT, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL);
";

/// Failure of a `state.db` operation. Carries no SQL text and no path.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum StateDbError {
    #[error("state database unavailable")]
    Unavailable,
    #[error("state database error")]
    Sql,
    #[error("stored value is malformed")]
    Malformed,
    /// `If-Match` did not match the stored version.
    #[error("version mismatch (current {current})")]
    VersionMismatch { current: u64 },
    #[error("document too large")]
    TooLarge,
    #[error("too many documents")]
    TooMany,
}

impl From<rusqlite::Error> for StateDbError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Sql
    }
}

type Job = Box<dyn FnOnce(&mut Connection) + Send>;

/// Handle on `state.db`. Cloning is cheap; the thread ends when the last clone is dropped.
#[derive(Clone)]
pub struct StateDb {
    tx: mpsc::Sender<Job>,
    // Keeps the thread joinable by the last owner only.
    _owner: std::sync::Arc<Owner>,
    path: PathBuf,
}

struct Owner {
    thread: Option<JoinHandle<()>>,
    tx: mpsc::Sender<Job>,
}

impl Drop for Owner {
    fn drop(&mut self) {
        // Closing the channel ends the thread's loop once the queue is drained.
        let (dead, _) = mpsc::channel();
        self.tx = dead;
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn open(path: &Path) -> Result<Connection, StateDbError> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.busy_timeout(std::time::Duration::from_secs(2))?;
    conn.execute_batch(SCHEMA)?;
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?1) ON CONFLICT(key) DO NOTHING",
        [SCHEMA_VERSION],
    )?;
    Ok(conn)
}

impl StateDb {
    /// Open (creating it if needed) `dir/state.db`.
    ///
    /// # Errors
    /// The directory cannot be created or the database cannot be opened.
    pub fn open(dir: &Path) -> Result<Self, StateDbError> {
        std::fs::create_dir_all(dir).map_err(|_| StateDbError::Unavailable)?;
        let path = dir.join("state.db");
        let conn = open(&path)?;
        let (tx, rx) = mpsc::channel::<Job>();
        let thread = std::thread::Builder::new()
            .name("fg-state-db".into())
            .spawn(move || {
                let mut conn = conn;
                while let Ok(job) = rx.recv() {
                    job(&mut conn);
                }
            })
            .map_err(|_| StateDbError::Unavailable)?;
        Ok(Self {
            _owner: std::sync::Arc::new(Owner {
                thread: Some(thread),
                tx: tx.clone(),
            }),
            tx,
            path,
        })
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Run `f` on the database thread and wait for its result.
    ///
    /// # Errors
    /// [`StateDbError::Unavailable`] when the database thread is gone, or whatever `f` returns.
    pub async fn call<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Connection) -> Result<T, StateDbError> + Send + 'static,
    ) -> Result<T, StateDbError> {
        let (reply, wait) = oneshot::channel();
        let job: Job = Box::new(move |c| {
            let _ = reply.send(f(c));
        });
        self.tx.send(job).map_err(|_| StateDbError::Unavailable)?;
        wait.await.map_err(|_| StateDbError::Unavailable)?
    }

    /// Queue `f` without waiting. Ordering with every other job is preserved.
    pub fn fire(
        &self,
        f: impl FnOnce(&mut Connection) -> Result<(), StateDbError> + Send + 'static,
    ) {
        let job: Job = Box::new(move |c| {
            if f(c).is_err() {
                tracing::warn!("state.db write failed");
            }
        });
        if self.tx.send(job).is_err() {
            tracing::warn!("state.db thread is gone");
        }
    }

    /// Wait until everything queued so far has been executed.
    pub async fn flush(&self) {
        let _ = self.call(|_| Ok(())).await;
    }

    // ---- alert book and rules

    pub async fn load_book(&self) -> Result<Option<BookState>, StateDbError> {
        self.call(|c| {
            let json: Option<String> = c
                .query_row("SELECT json FROM alert_book WHERE id = 1", [], |r| r.get(0))
                .optional()?;
            json.map(|j| serde_json::from_str(&j).map_err(|_| StateDbError::Malformed))
                .transpose()
        })
        .await
    }

    pub fn save_book(&self, state: &BookState, now_ms: i64) {
        let Ok(json) = serde_json::to_string(state) else {
            return;
        };
        self.fire(move |c| {
            c.execute(
                "INSERT INTO alert_book (id, json, updated_ms) VALUES (1, ?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_ms = excluded.updated_ms",
                params![json, now_ms],
            )?;
            Ok(())
        });
    }

    pub async fn load_rules(&self) -> Result<Option<AlertRulesConfig>, StateDbError> {
        self.call(|c| {
            let json: Option<String> = c
                .query_row("SELECT json FROM alert_rules WHERE id = 1", [], |r| {
                    r.get(0)
                })
                .optional()?;
            json.map(|j| serde_json::from_str(&j).map_err(|_| StateDbError::Malformed))
                .transpose()
        })
        .await
    }

    pub fn save_rules(&self, rules: &AlertRulesConfig, now_ms: i64) {
        let Ok(json) = serde_json::to_string(rules) else {
            return;
        };
        self.fire(move |c| {
            c.execute(
                "INSERT INTO alert_rules (id, json, updated_ms) VALUES (1, ?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_ms = excluded.updated_ms",
                params![json, now_ms],
            )?;
            Ok(())
        });
    }

    // ---- events

    /// Append a batch of events in one transaction.
    pub fn append_events(&self, events: Vec<Event>) {
        if events.is_empty() {
            return;
        }
        self.fire(move |c| {
            let tx = c.transaction()?;
            {
                let mut stmt = tx.prepare_cached(
                    "INSERT INTO events (ts_ms, kind, bot_key, json) VALUES (?1, ?2, ?3, ?4)",
                )?;
                for e in &events {
                    let json = serde_json::to_string(e).map_err(|_| StateDbError::Malformed)?;
                    let kind = serde_json::to_value(e.kind)
                        .ok()
                        .and_then(|v| v.as_str().map(str::to_owned))
                        .unwrap_or_default();
                    stmt.execute(params![
                        e.ts_ms,
                        kind,
                        e.bot_key.as_ref().map(ToString::to_string),
                        json
                    ])?;
                }
            }
            tx.commit()?;
            Ok(())
        });
    }

    /// The most recent `limit` events at or after `since_ms`, oldest first.
    pub async fn recent_events(
        &self,
        since_ms: i64,
        limit: usize,
    ) -> Result<Vec<Event>, StateDbError> {
        self.call(move |c| {
            let mut stmt = c.prepare(
                "SELECT json FROM (SELECT id, json FROM events WHERE ts_ms >= ?1 ORDER BY id DESC LIMIT ?2)
                 ORDER BY id ASC",
            )?;
            let limit = i64::try_from(limit).unwrap_or(i64::MAX);
            let rows = stmt.query_map(params![since_ms, limit], |r| r.get::<_, String>(0))?;
            let mut out = Vec::new();
            for row in rows {
                if let Ok(e) = serde_json::from_str::<Event>(&row?) {
                    out.push(e);
                }
            }
            Ok(out)
        })
        .await
    }

    /// Delete events older than `before_ms`.
    pub fn purge_events(&self, before_ms: i64) {
        self.fire(move |c| {
            c.execute("DELETE FROM events WHERE ts_ms < ?1", [before_ms])?;
            Ok(())
        });
    }

    // ---- preferences

    /// One document, or `None` when it does not exist.
    pub async fn prefs_get(
        &self,
        user: &str,
        scope: &str,
    ) -> Result<Option<PrefsDoc>, StateDbError> {
        let (user, scope) = (user.to_owned(), scope.to_owned());
        self.call(move |c| read_prefs(c, &user, &scope)).await
    }

    /// Every document of a user, global one first.
    pub async fn prefs_list(&self, user: &str) -> Result<Vec<PrefsDoc>, StateDbError> {
        let user = user.to_owned();
        self.call(move |c| {
            let mut stmt = c.prepare(
                "SELECT scope, version, data, updated_ms FROM prefs WHERE user = ?1 ORDER BY scope",
            )?;
            let rows = stmt.query_map([&user], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?;
            let mut out = Vec::new();
            for row in rows {
                let (scope, version, data, updated_ms) = row?;
                out.push(PrefsDoc {
                    scope,
                    version: u64::try_from(version).unwrap_or(0),
                    updated_ms,
                    data: serde_json::from_str(&data).map_err(|_| StateDbError::Malformed)?,
                });
            }
            Ok(out)
        })
        .await
    }

    /// Write a document. `if_match` is the version the client last saw: `Some(0)` means "must not
    /// exist yet", `None` means unconditional (first write, or an explicit overwrite).
    pub async fn prefs_put(
        &self,
        user: &str,
        scope: &str,
        data: serde_json::Value,
        if_match: Option<u64>,
        now_ms: i64,
    ) -> Result<PrefsDoc, StateDbError> {
        let json = serde_json::to_string(&data).map_err(|_| StateDbError::Malformed)?;
        if json.len() > MAX_PREFS_BYTES {
            return Err(StateDbError::TooLarge);
        }
        let (user, scope) = (user.to_owned(), scope.to_owned());
        self.call(move |c| {
            let tx = c.transaction()?;
            let current = read_prefs(&tx, &user, &scope)?;
            let cur_version = current.as_ref().map_or(0, |d| d.version);
            if let Some(expected) = if_match
                && expected != cur_version
            {
                return Err(StateDbError::VersionMismatch {
                    current: cur_version,
                });
            }
            if current.is_none() {
                let n: i64 =
                    tx.query_row("SELECT COUNT(*) FROM prefs WHERE user = ?1", [&user], |r| {
                        r.get(0)
                    })?;
                if usize::try_from(n).unwrap_or(usize::MAX) >= MAX_PREFS_SCOPES {
                    return Err(StateDbError::TooMany);
                }
            }
            let version = cur_version + 1;
            tx.execute(
                "INSERT INTO prefs (user, scope, version, data, updated_ms) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(user, scope) DO UPDATE SET version = excluded.version,
                    data = excluded.data, updated_ms = excluded.updated_ms",
                params![
                    user,
                    scope,
                    i64::try_from(version).unwrap_or(i64::MAX),
                    json,
                    now_ms
                ],
            )?;
            tx.commit()?;
            Ok(PrefsDoc {
                scope,
                version,
                updated_ms: now_ms,
                data,
            })
        })
        .await
    }

    pub async fn prefs_delete(&self, user: &str, scope: &str) -> Result<bool, StateDbError> {
        let (user, scope) = (user.to_owned(), scope.to_owned());
        self.call(move |c| {
            Ok(c.execute(
                "DELETE FROM prefs WHERE user = ?1 AND scope = ?2",
                params![user, scope],
            )? > 0)
        })
        .await
    }

    // ---- audit

    /// Append an audit entry. Resolved before the caller proceeds: an action is never sent
    /// without its attempt being on record.
    pub async fn audit_append(&self, entry: AuditEntry) -> Result<(), StateDbError> {
        let json = serde_json::to_string(&entry).map_err(|_| StateDbError::Malformed)?;
        self.call(move |c| {
            c.execute(
                "INSERT INTO audit (ts_ms, bot_key, action, idempotency_key, json)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    entry.ts_ms,
                    entry.bot_key.to_string(),
                    entry.action,
                    entry.idempotency_key,
                    json
                ],
            )?;
            Ok(())
        })
        .await
    }

    /// Audit entries at or after `from_ms`, oldest first, optionally for one bot.
    pub async fn audit_query(
        &self,
        from_ms: i64,
        bot_key: Option<String>,
        limit: usize,
    ) -> Result<Vec<AuditEntry>, StateDbError> {
        self.call(move |c| {
            let mut stmt = c.prepare(
                "SELECT json FROM audit WHERE ts_ms >= ?1 AND (?2 IS NULL OR bot_key = ?2)
                 ORDER BY id ASC LIMIT ?3",
            )?;
            let limit = i64::try_from(limit).unwrap_or(i64::MAX);
            let rows =
                stmt.query_map(params![from_ms, bot_key, limit], |r| r.get::<_, String>(0))?;
            let mut out = Vec::new();
            for row in rows {
                if let Ok(e) = serde_json::from_str::<AuditEntry>(&row?) {
                    out.push(e);
                }
            }
            Ok(out)
        })
        .await
    }

    // ---- idempotency

    /// What the table knows about a key, without registering anything. A replay is answered from
    /// here before the state of the bot is looked at: the action itself may have changed it.
    pub async fn idem_lookup(
        &self,
        key: &str,
        bot_key: &str,
        action: &str,
    ) -> Result<IdemState, StateDbError> {
        let (key, bot_key, action) = (key.to_owned(), bot_key.to_owned(), action.to_owned());
        self.call(move |c| {
            Ok(match read_idem(c, &key)? {
                None => IdemState::Fresh,
                Some(row) => row.state_for(&bot_key, &action)?,
            })
        })
        .await
    }

    /// Register the intent to send an action. Returns what the table already knew about the key.
    /// `action` is the fingerprint of what is asked (name and parameters): a key only ever stands
    /// for one bot and one request.
    pub async fn idem_begin(
        &self,
        key: &str,
        bot_key: &str,
        action: &str,
        now_ms: i64,
    ) -> Result<IdemState, StateDbError> {
        let (key, bot_key, action) = (key.to_owned(), bot_key.to_owned(), action.to_owned());
        self.call(move |c| {
            let tx = c.transaction()?;
            let out = match read_idem(&tx, &key)? {
                None => {
                    tx.execute(
                        "INSERT INTO idempotency (key, bot_key, action, state, created_ms, updated_ms)
                         VALUES (?1, ?2, ?3, 'in_flight', ?4, ?4)",
                        params![key, bot_key, action, now_ms],
                    )?;
                    IdemState::Fresh
                }
                Some(row) => row.state_for(&bot_key, &action)?,
            };
            tx.commit()?;
            Ok(out)
        })
        .await
    }

    /// Record the final result of an action.
    pub async fn idem_finish(
        &self,
        key: &str,
        result: &ActionResult,
        now_ms: i64,
    ) -> Result<(), StateDbError> {
        let key = key.to_owned();
        let json = serde_json::to_string(result).map_err(|_| StateDbError::Malformed)?;
        self.call(move |c| {
            c.execute(
                "UPDATE idempotency SET state = 'done', result = ?2, updated_ms = ?3 WHERE key = ?1",
                params![key, json, now_ms],
            )?;
            Ok(())
        })
        .await
    }

    /// Forget a key whose action provably did not leave the machine (the client may reuse it).
    pub async fn idem_forget(&self, key: &str) -> Result<(), StateDbError> {
        let key = key.to_owned();
        self.call(move |c| {
            c.execute(
                "DELETE FROM idempotency WHERE key = ?1 AND state = 'in_flight'",
                [&key],
            )?;
            Ok(())
        })
        .await
    }

    /// Delete finished keys older than `before_ms`.
    pub fn idem_purge(&self, before_ms: i64) {
        self.fire(move |c| {
            c.execute(
                "DELETE FROM idempotency WHERE state = 'done' AND updated_ms < ?1",
                [before_ms],
            )?;
            Ok(())
        });
    }
}

/// What the idempotency table knew about a key.
#[derive(Debug, Clone, PartialEq)]
pub enum IdemState {
    /// Never seen: registered as in flight now.
    Fresh,
    /// A previous request with this key finished: its stored result.
    Done(Box<ActionResult>),
    /// A previous request with this key started and never recorded an end.
    InFlight,
    /// The key was used for another bot, another action or other parameters.
    Reused,
}

/// A row of the idempotency table.
struct IdemRow {
    bot_key: String,
    action: String,
    done: bool,
    result: Option<String>,
}

impl IdemRow {
    fn state_for(self, bot_key: &str, action: &str) -> Result<IdemState, StateDbError> {
        if self.bot_key != bot_key || self.action != action {
            return Ok(IdemState::Reused);
        }
        if !self.done {
            return Ok(IdemState::InFlight);
        }
        self.result
            .and_then(|j| serde_json::from_str::<ActionResult>(&j).ok())
            .map(|r| IdemState::Done(Box::new(r)))
            .ok_or(StateDbError::Malformed)
    }
}

fn read_idem(c: &Connection, key: &str) -> Result<Option<IdemRow>, StateDbError> {
    Ok(c.query_row(
        "SELECT bot_key, action, state, result FROM idempotency WHERE key = ?1",
        [key],
        |r| {
            Ok(IdemRow {
                bot_key: r.get(0)?,
                action: r.get(1)?,
                done: r.get::<_, String>(2)? == "done",
                result: r.get(3)?,
            })
        },
    )
    .optional()?)
}

fn read_prefs(c: &Connection, user: &str, scope: &str) -> Result<Option<PrefsDoc>, StateDbError> {
    let row: Option<(i64, String, i64)> = c
        .query_row(
            "SELECT version, data, updated_ms FROM prefs WHERE user = ?1 AND scope = ?2",
            params![user, scope],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    row.map(|(version, data, updated_ms)| {
        Ok(PrefsDoc {
            scope: scope.to_owned(),
            version: u64::try_from(version).unwrap_or(0),
            updated_ms,
            data: serde_json::from_str(&data).map_err(|_| StateDbError::Malformed)?,
        })
    })
    .transpose()
}

#[cfg(test)]
mod tests {
    use fg_core::alerts::AlertBook;
    use fg_core::identity::BotKey;
    use fg_core::model::{ActionStatus, BotMode, EventKind};
    use serde_json::json;

    use super::*;

    fn db() -> (tempfile::TempDir, StateDb) {
        let dir = tempfile::tempdir().unwrap();
        let db = StateDb::open(dir.path()).unwrap();
        (dir, db)
    }

    fn audit(key: &str, ts: i64) -> AuditEntry {
        AuditEntry {
            ts_ms: ts,
            session_hash: "s".into(),
            ip: None,
            user_agent: None,
            bot_key: BotKey::Local(9056),
            bot_name: "b".into(),
            mode: BotMode::Dry,
            action: "forceexit".into(),
            params: serde_json::Map::new(),
            idempotency_key: key.into(),
            http_status: None,
            response: None,
            latency_ms: None,
        }
    }

    #[tokio::test]
    async fn the_database_is_in_wal_mode_under_the_data_dir() {
        let (dir, db) = db();
        assert_eq!(db.path(), dir.path().join("state.db"));
        let mode: String = db
            .call(|c| Ok(c.query_row("PRAGMA journal_mode", [], |r| r.get(0))?))
            .await
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
    }

    #[tokio::test]
    async fn the_alert_book_and_the_rules_survive_a_reopen() {
        let dir = tempfile::tempdir().unwrap();
        {
            let db = StateDb::open(dir.path()).unwrap();
            let mut book = AlertBook::new();
            let id = book
                .silence(None, Some("local:1"), None, 10_000, 1_000)
                .unwrap();
            assert_eq!(id, "s1");
            db.save_book(&book.to_state(), 1_000);
            let mut rules = AlertRulesConfig::default();
            rules.per_bot_enabled.insert("local:2".into(), false);
            db.save_rules(&rules, 1_000);
            db.flush().await;
        }
        let db = StateDb::open(dir.path()).unwrap();
        let book = AlertBook::from_state(db.load_book().await.unwrap().unwrap());
        assert_eq!(book.silences().len(), 1);
        let rules = db.load_rules().await.unwrap().unwrap();
        assert_eq!(rules.per_bot_enabled.get("local:2"), Some(&false));
    }

    #[tokio::test]
    async fn preferences_are_versioned_per_user_and_scope_with_if_match() {
        let (_d, db) = db();
        let a = db
            .prefs_put("owner", "", json!({"tz": "UTC"}), Some(0), 1)
            .await
            .unwrap();
        assert_eq!(a.version, 1);
        // The same user, another scope (a bot key) has its own version counter.
        let b = db
            .prefs_put("owner", "local:9056", json!({"icon": "x"}), Some(0), 2)
            .await
            .unwrap();
        assert_eq!(b.version, 1);
        // A stale writer is refused and told the current version.
        let err = db
            .prefs_put("owner", "", json!({"tz": "Europe/Paris"}), Some(0), 3)
            .await
            .unwrap_err();
        assert_eq!(err, StateDbError::VersionMismatch { current: 1 });
        let c = db
            .prefs_put("owner", "", json!({"tz": "Europe/Paris"}), Some(1), 4)
            .await
            .unwrap();
        assert_eq!(c.version, 2);
        // Another user never sees these.
        assert!(db.prefs_get("other", "").await.unwrap().is_none());
        let all = db.prefs_list("owner").await.unwrap();
        assert_eq!(
            all.iter().map(|d| d.scope.as_str()).collect::<Vec<_>>(),
            ["", "local:9056"]
        );
        assert_eq!(all[0].data, json!({"tz": "Europe/Paris"}));
        assert!(db.prefs_delete("owner", "local:9056").await.unwrap());
        assert_eq!(db.prefs_list("owner").await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn oversized_preferences_are_refused() {
        let (_d, db) = db();
        let big = json!({"blob": "x".repeat(MAX_PREFS_BYTES)});
        assert_eq!(
            db.prefs_put("u", "", big, None, 1).await.unwrap_err(),
            StateDbError::TooLarge
        );
    }

    #[tokio::test]
    async fn the_audit_trail_is_append_only() {
        let (_d, db) = db();
        db.audit_append(audit("k1", 1)).await.unwrap();
        db.audit_append(audit("k1", 2)).await.unwrap();
        assert_eq!(db.audit_query(0, None, 10).await.unwrap().len(), 2);
        assert_eq!(
            db.audit_query(0, Some("local:1".into()), 10)
                .await
                .unwrap()
                .len(),
            0
        );
        let upd = db
            .call(|c| Ok(c.execute("UPDATE audit SET action = 'x'", [])?))
            .await;
        assert!(upd.is_err());
        let del = db.call(|c| Ok(c.execute("DELETE FROM audit", [])?)).await;
        assert!(del.is_err());
        assert_eq!(db.audit_query(0, None, 10).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn idempotency_tells_fresh_from_done_from_in_flight() {
        let (_d, db) = db();
        assert_eq!(
            db.idem_begin("k", "local:1", "stop", 1).await.unwrap(),
            IdemState::Fresh
        );
        assert_eq!(
            db.idem_begin("k", "local:1", "stop", 2).await.unwrap(),
            IdemState::InFlight
        );
        let res = ActionResult {
            status: ActionStatus::Accepted,
            http_status: Some(200),
            reason: None,
            bot_response: None,
            verify: None,
            idempotency_key: "k".into(),
            ts_ms: 3,
        };
        db.idem_finish("k", &res, 3).await.unwrap();
        assert_eq!(
            db.idem_begin("k", "local:1", "stop", 4).await.unwrap(),
            IdemState::Done(Box::new(res.clone()))
        );
        // Looking does not register anything, and a key is only for the request it began with.
        assert_eq!(
            db.idem_lookup("k", "local:1", "stop").await.unwrap(),
            IdemState::Done(Box::new(res.clone()))
        );
        assert_eq!(
            db.idem_lookup("never", "local:1", "stop").await.unwrap(),
            IdemState::Fresh
        );
        assert_eq!(
            db.idem_begin("never", "local:1", "stop", 4).await.unwrap(),
            IdemState::Fresh
        );
        for (bot, action) in [("local:2", "stop"), ("local:1", "start")] {
            assert_eq!(
                db.idem_lookup("k", bot, action).await.unwrap(),
                IdemState::Reused
            );
            assert_eq!(
                db.idem_begin("k", bot, action, 4).await.unwrap(),
                IdemState::Reused
            );
        }
        // A key that never left the machine can be forgotten and reused.
        assert_eq!(
            db.idem_begin("n", "local:1", "stop", 5).await.unwrap(),
            IdemState::Fresh
        );
        db.idem_forget("n").await.unwrap();
        assert_eq!(
            db.idem_begin("n", "local:1", "stop", 6).await.unwrap(),
            IdemState::Fresh
        );
    }

    #[tokio::test]
    async fn events_round_trip_and_purge() {
        let (_d, db) = db();
        let ev = |ts| Event {
            kind: EventKind::ExitFill,
            ts_ms: ts,
            bot_key: Some(BotKey::Local(9056)),
            trade_id: Some(1),
            pair: None,
            profit_abs: Some(1.5),
            severity: None,
            detail: None,
        };
        db.append_events(vec![ev(10), ev(20), ev(30)]);
        let got = db.recent_events(0, 2).await.unwrap();
        assert_eq!(got.iter().map(|e| e.ts_ms).collect::<Vec<_>>(), [20, 30]);
        db.purge_events(25);
        assert_eq!(db.recent_events(0, 10).await.unwrap().len(), 1);
    }
}
