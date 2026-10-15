//! Read-only access to the bot ledgers (03 section 5).
//!
//! # Rules, all enforced here
//!
//! * Databases are opened with `file:<path>?mode=ro` and
//!   `SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_URI | SQLITE_OPEN_NO_MUTEX`; never `immutable=1` (it
//!   would serve stale pages of a WAL database). `PRAGMA query_only=1` is set on top.
//! * `busy_timeout` is short (250 ms by default). No `wal_checkpoint`, `journal_mode`, `VACUUM`,
//!   `ANALYZE`, no write statement exists in this module: the statement set is closed (see the
//!   test that scans the source for forbidden keywords).
//! * Every read is one short implicit transaction: rows are collected, the statement is
//!   finalised, and a connection is never left with an open statement, so a reader can never hold
//!   back a checkpoint. A per-query budget (200 ms by default) interrupts a slow query.
//! * The schema is introspected (`PRAGMA table_info`) and queries are built from what exists: a
//!   missing column is a missing field, not an error. The introspection is redone when
//!   `PRAGMA schema_version` changes.
//! * Pitfalls of the production data (`project_trade_db_sql_pitfalls`): direction is
//!   `trades.is_short`; `exit_reason` and `close_rate` can be NULL on closed trades and stay
//!   `None`; a closed trade with a NULL `close_profit_abs` is flagged `profit_unknown`, never
//!   given an invented value; dates are naive UTC and become integer milliseconds on reading.
//! * Errors are normalised into [`LedgerErrorCode`], without path or raw message.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};

use fg_core::time::parse_date_ms;
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags, Row};
use thiserror::Error;

use crate::traits::LedgerReader;

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/// Normalised failure (port of `_ph_error_code`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LedgerErrorCode {
    DbLocked,
    NoHistoryTable,
    DbCorrupt,
    DbMissing,
    Timeout,
    DbError,
}

impl LedgerErrorCode {
    /// Wire name used in the API.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DbLocked => "db_locked",
            Self::NoHistoryTable => "no_history_table",
            Self::DbCorrupt => "db_corrupt",
            Self::DbMissing => "db_missing",
            Self::Timeout => "timeout",
            Self::DbError => "db_error",
        }
    }
}

/// A ledger read failed. Carries a code only: no path, no SQL message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
#[error("ledger error: {}", .0.as_str())]
pub struct LedgerError(pub LedgerErrorCode);

impl LedgerError {
    #[must_use]
    pub fn code(self) -> LedgerErrorCode {
        self.0
    }
}

fn map_err(err: &rusqlite::Error) -> LedgerError {
    use rusqlite::ErrorCode as C;
    let code = match err {
        rusqlite::Error::SqliteFailure(f, _) => match f.code {
            C::DatabaseBusy | C::DatabaseLocked => LedgerErrorCode::DbLocked,
            C::DatabaseCorrupt | C::NotADatabase => LedgerErrorCode::DbCorrupt,
            C::CannotOpen => LedgerErrorCode::DbMissing,
            C::OperationInterrupted => LedgerErrorCode::Timeout,
            _ => LedgerErrorCode::DbError,
        },
        _ => LedgerErrorCode::DbError,
    };
    LedgerError(code)
}

// ---------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------

/// What a `stat()` of the database and its `-wal` says. Used for change detection without ever
/// opening the database (80 `stat` calls every 2 s are negligible).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LedgerStat {
    pub db_size: u64,
    pub db_mtime_ms: i64,
    pub db_inode: u64,
    pub wal_size: Option<u64>,
    pub wal_mtime_ms: Option<i64>,
}

impl LedgerStat {
    /// A WAL file exists next to the database (bots run in WAL mode).
    #[must_use]
    pub fn has_wal(&self) -> bool {
        self.wal_size.is_some()
    }

    /// Opaque value that changes whenever the ledger was written.
    #[must_use]
    pub fn change_token(&self) -> (u64, i64, u64, Option<u64>, Option<i64>) {
        (
            self.db_size,
            self.db_mtime_ms,
            self.db_inode,
            self.wal_size,
            self.wal_mtime_ms,
        )
    }
}

/// Tables and columns found by `PRAGMA table_info`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LedgerSchema {
    pub tables: BTreeMap<String, BTreeSet<String>>,
}

impl LedgerSchema {
    #[must_use]
    pub fn has_table(&self, table: &str) -> bool {
        self.tables.contains_key(table)
    }

    #[must_use]
    pub fn has_column(&self, table: &str, column: &str) -> bool {
        self.tables.get(table).is_some_and(|c| c.contains(column))
    }

    /// `trades` and `orders` exist: the file is a freqtrade ledger.
    #[must_use]
    pub fn is_freqtrade_ledger(&self) -> bool {
        self.has_table("trades") && self.has_table("orders")
    }
}

/// One row of `trades`. Every column that can be missing or NULL is an `Option`.
#[derive(Debug, Clone, PartialEq)]
pub struct LedgerTrade {
    pub id: i64,
    pub pair: String,
    pub is_short: bool,
    pub is_open: bool,
    pub amount: f64,
    pub stake_amount: f64,
    pub open_rate: f64,
    /// NULL on trades closed externally or deleted: stays `None`.
    pub close_rate: Option<f64>,
    pub leverage: f64,
    pub open_ms: Option<i64>,
    pub close_ms: Option<i64>,
    /// `close_profit_abs`. `None` together with `profit_unknown` on a closed trade.
    pub profit_abs: Option<f64>,
    pub profit_ratio: Option<f64>,
    /// Closed trade whose `close_profit_abs` is NULL: counted apart, never replaced.
    pub profit_unknown: bool,
    /// Raw `exit_reason`; NULL means unknown (see `fg_core::calc::exit_reason`).
    pub exit_reason: Option<String>,
    pub enter_tag: Option<String>,
    pub stop_loss: Option<f64>,
    pub initial_stop_loss: Option<f64>,
    pub liquidation_price: Option<f64>,
    pub funding_fees: Option<f64>,
    /// Profit already realised by partial exits of a still open trade.
    pub realized_profit: Option<f64>,
    pub strategy: Option<String>,
}

/// One row of `orders`.
#[derive(Debug, Clone, PartialEq)]
pub struct LedgerOrder {
    pub id: i64,
    pub trade_id: i64,
    /// `buy`, `sell` or `stoploss`.
    pub side: String,
    pub status: Option<String>,
    pub is_open: bool,
    pub filled: Option<f64>,
    pub amount: Option<f64>,
    pub average: Option<f64>,
    pub cost: Option<f64>,
    pub filled_ms: Option<i64>,
    pub tag: Option<String>,
}

impl LedgerOrder {
    /// Entry orders are `sell` for a short and `buy` for a long (`ft_order_side`).
    #[must_use]
    pub fn is_entry_for(&self, is_short: bool) -> bool {
        self.side == if is_short { "sell" } else { "buy" }
    }

    /// The order was executed (closed with a positive fill, or closed with an unknown fill).
    #[must_use]
    pub fn is_filled(&self) -> bool {
        !self.is_open
            && match self.filled {
                Some(f) => f > 0.0,
                None => self.status.as_deref() == Some("closed"),
            }
    }
}

/// Number of filled entry orders of a trade (entry plus DCA).
#[must_use]
pub fn filled_entry_orders(orders: &[LedgerOrder], trade_id: i64, is_short: bool) -> usize {
    orders
        .iter()
        .filter(|o| o.trade_id == trade_id && o.is_entry_for(is_short) && o.is_filled())
        .count()
}

/// One sample of `profit_history`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ProfitSample {
    pub rowid: i64,
    pub ts_ms: i64,
    pub closed_abs: f64,
    pub open_abs: f64,
    pub open_trades: i64,
}

/// Result of an incremental read of `profit_history`.
#[derive(Debug, Clone, PartialEq)]
pub struct ProfitChunk {
    pub samples: Vec<ProfitSample>,
    /// Highest rowid in the table now; the cursor for the next call.
    pub max_rowid: i64,
    /// The table shrank or was recreated (`max(rowid)` went backwards): the samples are the
    /// complete table, and previously loaded samples must be dropped.
    pub reset: bool,
    /// More rows are available beyond the per-call cap; call again with `max_rowid`.
    pub truncated: bool,
}

/// Aggregates of a ledger, computed in SQL.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct LedgerSummary {
    pub open_count: i64,
    pub closed_count: i64,
    /// Sum of `close_profit_abs` of closed trades, NULLs counted as 0 (`COALESCE`).
    pub realized_total: f64,
    /// Closed trades with a NULL `close_profit_abs` (their profit is unknown, not zero).
    pub profit_unknown_count: i64,
    pub first_open_ms: Option<i64>,
    pub last_open_ms: Option<i64>,
    pub last_close_ms: Option<i64>,
    pub max_trade_id: i64,
    /// Number of distinct values of `is_short` (2 = trades both ways).
    pub direction_count: i64,
    pub any_short: bool,
}

/// What a ledger reveals without scanning its trades: counts and the highest id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct LedgerProbe {
    pub open_count: i64,
    pub closed_count: i64,
    pub max_trade_id: i64,
}

/// Which trades to read.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TradeQuery {
    /// `Some(true)` open only, `Some(false)` closed only.
    pub open: Option<bool>,
    /// Only trades with `id > after_id` (incremental reads of an append-only history).
    pub after_id: Option<i64>,
    /// Only trades opened or closed at or after this instant (ms).
    pub touched_since_ms: Option<i64>,
    pub limit: Option<u32>,
}

// ---------------------------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------------------------

/// Tunables of [`SqliteLedger`].
#[derive(Debug, Clone, Copy)]
pub struct LedgerOptions {
    pub busy_timeout: Duration,
    /// Wall-clock budget of one query; the query is interrupted past it.
    pub query_budget: Duration,
    /// Rows returned per `profit_history` call.
    pub profit_chunk_rows: u32,
    /// SQLite page cache per connection, in KiB. The default of SQLite (2 MiB) times 40 cached
    /// connections is the largest single block of memory of a gateway that otherwise holds a few
    /// megabytes per bot; the reads are sequential scans that the operating system caches anyway.
    pub cache_kib: u32,
}

impl Default for LedgerOptions {
    fn default() -> Self {
        Self {
            busy_timeout: Duration::from_millis(250),
            query_budget: Duration::from_millis(200),
            profit_chunk_rows: 50_000,
            cache_kib: 256,
        }
    }
}

struct Handle {
    conn: Connection,
    /// `PRAGMA schema_version` the cached schema belongs to.
    schema_version: Option<i64>,
    schema: LedgerSchema,
    /// Armed by the progress handler when the query overran its budget.
    deadline: Arc<Deadline>,
}

/// Deadline shared with the SQLite progress handler.
struct Deadline {
    at: Mutex<Option<Instant>>,
    expired: AtomicBool,
}

impl Deadline {
    fn arm(&self, budget: Duration) {
        self.expired.store(false, Ordering::Relaxed);
        if let Ok(mut at) = self.at.lock() {
            *at = Some(Instant::now() + budget);
        }
    }

    fn disarm(&self) {
        if let Ok(mut at) = self.at.lock() {
            *at = None;
        }
    }

    fn check(&self) -> bool {
        let over = self
            .at
            .lock()
            .ok()
            .and_then(|a| *a)
            .is_some_and(|t| Instant::now() >= t);
        if over {
            self.expired.store(true, Ordering::Relaxed);
        }
        over
    }
}

/// A cached connection. The inode lives next to the lock, not inside it, so the cache can compare
/// it while holding `conns` without ever waiting on a slot that a running query holds.
struct Slot {
    inode: u64,
    handle: Arc<Mutex<Handle>>,
}

/// The production [`LedgerReader`]: read-only SQLite with cached connections.
///
/// Lock order: `conns` is only held briefly and never while waiting for a `Slot::handle`; a slot
/// guard is dropped before `conns` is taken.
pub struct SqliteLedger {
    opts: LedgerOptions,
    conns: Mutex<HashMap<PathBuf, Slot>>,
}

impl SqliteLedger {
    #[must_use]
    pub fn new(opts: LedgerOptions) -> Self {
        Self {
            opts,
            conns: Mutex::new(HashMap::new()),
        }
    }

    /// Drop the cached connection of a ledger (bot retired, file replaced).
    pub fn forget(&self, db: &Path) {
        if let Ok(mut c) = self.conns.lock() {
            c.remove(db);
        }
    }

    fn open(&self, db: &Path) -> Result<Handle, LedgerError> {
        let meta = fs::metadata(db).map_err(|_| LedgerError(LedgerErrorCode::DbMissing))?;
        if !meta.is_file() {
            return Err(LedgerError(LedgerErrorCode::DbMissing));
        }
        let uri = ro_uri(db);
        let conn = Connection::open_with_flags(
            &uri,
            OpenFlags::SQLITE_OPEN_READ_ONLY
                | OpenFlags::SQLITE_OPEN_URI
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|e| map_err(&e))?;
        conn.busy_timeout(self.opts.busy_timeout)
            .map_err(|e| map_err(&e))?;
        // `query_only` is belt and braces on top of the read-only open flags.
        conn.pragma_update(None, "query_only", 1)
            .map_err(|e| map_err(&e))?;
        // A negative `cache_size` is a size in KiB.
        conn.pragma_update(None, "cache_size", -i64::from(self.opts.cache_kib))
            .map_err(|e| map_err(&e))?;
        let deadline = Arc::new(Deadline {
            at: Mutex::new(None),
            expired: AtomicBool::new(false),
        });
        let dl = Arc::clone(&deadline);
        conn.progress_handler(200, Some(move || dl.check()))
            .map_err(|e| map_err(&e))?;
        Ok(Handle {
            conn,
            schema_version: None,
            schema: LedgerSchema::default(),
            deadline,
        })
    }

    /// Run `f` on the connection of `db` under the query budget.
    fn with<T>(
        &self,
        db: &Path,
        f: impl FnOnce(&Connection, &LedgerSchema) -> Result<T, rusqlite::Error>,
    ) -> Result<T, LedgerError> {
        let inode = fs::metadata(db)
            .map_err(|_| LedgerError(LedgerErrorCode::DbMissing))?
            .ino();
        let slot = {
            let mut conns = self
                .conns
                .lock()
                .map_err(|_| LedgerError(LedgerErrorCode::DbError))?;
            // A replaced file (same path, new inode) must not be read through the old handle.
            if conns.get(db).is_some_and(|s| s.inode != inode) {
                conns.remove(db);
            }
            if let Some(s) = conns.get(db) {
                Arc::clone(&s.handle)
            } else {
                let h = Arc::new(Mutex::new(self.open(db)?));
                conns.insert(
                    db.to_path_buf(),
                    Slot {
                        inode,
                        handle: Arc::clone(&h),
                    },
                );
                h
            }
        };
        let mut handle = slot
            .lock()
            .map_err(|_| LedgerError(LedgerErrorCode::DbError))?;

        handle.deadline.arm(self.opts.query_budget);
        let result = (|| {
            let version: i64 = handle
                .conn
                .query_row("PRAGMA schema_version", [], |r| r.get(0))?;
            if handle.schema_version != Some(version) {
                handle.schema = introspect(&handle.conn)?;
                handle.schema_version = Some(version);
            }
            f(&handle.conn, &handle.schema)
        })();
        handle.deadline.disarm();
        let expired = handle.deadline.expired.load(Ordering::Relaxed);
        // The slot guard must be gone before `conns` is taken (see the lock order on the type).
        drop(handle);
        result.map_err(|e| {
            if expired {
                LedgerError(LedgerErrorCode::Timeout)
            } else {
                // A connection that failed is dropped: the next call reopens it. Only our own
                // slot is removed, a concurrent caller may already have replaced it.
                if let Ok(mut c) = self.conns.lock()
                    && c.get(db).is_some_and(|s| Arc::ptr_eq(&s.handle, &slot))
                {
                    c.remove(db);
                }
                map_err(&e)
            }
        })
    }
}

impl SqliteLedger {
    /// Like [`Self::with`] for a query that needs `table`; its absence maps to `missing`.
    fn with_table<T>(
        &self,
        db: &Path,
        table: &str,
        missing: LedgerErrorCode,
        f: impl FnOnce(&Connection, &LedgerSchema) -> Result<T, rusqlite::Error>,
    ) -> Result<T, LedgerError> {
        self.with(db, |conn, schema| {
            if schema.has_table(table) {
                f(conn, schema).map(Some)
            } else {
                Ok(None)
            }
        })?
        .ok_or(LedgerError(missing))
    }
}

impl Default for SqliteLedger {
    fn default() -> Self {
        Self::new(LedgerOptions::default())
    }
}

/// `file:` URI with `mode=ro`. The path is percent-encoded for the characters that are special
/// in a URI.
fn ro_uri(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let mut out = String::with_capacity(raw.len() + 16);
    out.push_str("file:");
    for b in raw.bytes() {
        match b {
            b'%' => out.push_str("%25"),
            b'?' => out.push_str("%3f"),
            b'#' => out.push_str("%23"),
            b' ' => out.push_str("%20"),
            b if b.is_ascii_graphic() => out.push(b as char),
            b => out.push_str(&format!("%{b:02x}")),
        }
    }
    out.push_str("?mode=ro");
    out
}

fn introspect(conn: &Connection) -> Result<LedgerSchema, rusqlite::Error> {
    let mut tables = BTreeMap::new();
    let names: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect::<Result<_, _>>()?
    };
    for name in names {
        // Table names come from sqlite_master; quote defensively anyway.
        let quoted = name.replace('"', "\"\"");
        let mut stmt = conn.prepare(&format!("PRAGMA table_info(\"{quoted}\")"))?;
        let cols = stmt.query_map([], |r| r.get::<_, String>(1))?;
        tables.insert(name, cols.collect::<Result<BTreeSet<_>, _>>()?);
    }
    Ok(LedgerSchema { tables })
}

// ---------------------------------------------------------------------------------------------
// Tolerant column readers
// ---------------------------------------------------------------------------------------------

fn opt_f64(row: &Row<'_>, idx: usize) -> Option<f64> {
    match row.get_ref(idx).ok()? {
        ValueRef::Integer(i) => Some(i as f64),
        ValueRef::Real(x) if x.is_finite() => Some(x),
        ValueRef::Text(t) => std::str::from_utf8(t)
            .ok()?
            .trim()
            .parse()
            .ok()
            .filter(|x: &f64| x.is_finite()),
        _ => None,
    }
}

fn opt_i64(row: &Row<'_>, idx: usize) -> Option<i64> {
    match row.get_ref(idx).ok()? {
        ValueRef::Integer(i) => Some(i),
        ValueRef::Real(x) if x.is_finite() => Some(x as i64),
        ValueRef::Text(t) => std::str::from_utf8(t).ok()?.trim().parse().ok(),
        _ => None,
    }
}

fn opt_text(row: &Row<'_>, idx: usize) -> Option<String> {
    match row.get_ref(idx).ok()? {
        ValueRef::Text(t) => Some(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Integer(i) => Some(i.to_string()),
        _ => None,
    }
}

fn opt_bool(row: &Row<'_>, idx: usize) -> Option<bool> {
    match row.get_ref(idx).ok()? {
        ValueRef::Integer(i) => Some(i != 0),
        ValueRef::Real(x) => Some(x != 0.0),
        ValueRef::Text(t) => match std::str::from_utf8(t).ok()?.to_ascii_lowercase().as_str() {
            "1" | "true" => Some(true),
            "0" | "false" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

/// Naive UTC date text to epoch milliseconds.
fn opt_date_ms(row: &Row<'_>, idx: usize) -> Option<i64> {
    match row.get_ref(idx).ok()? {
        ValueRef::Text(t) => parse_date_ms(std::str::from_utf8(t).ok()?),
        ValueRef::Integer(_) | ValueRef::Real(_) => {
            fg_core::time::normalize_ts_ms(opt_f64(row, idx)?)
        }
        _ => None,
    }
}

/// `col` when the column exists, else a typed NULL, so that positional readers stay valid.
fn col(schema: &LedgerSchema, table: &str, name: &str) -> String {
    if schema.has_column(table, name) {
        format!("\"{name}\"")
    } else {
        "NULL".to_owned()
    }
}

/// Epoch-millisecond to the naive text stored by SQLAlchemy, for comparisons in SQL.
fn ms_to_db_text(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let nanos = u32::try_from(ms.rem_euclid(1000) * 1_000_000).unwrap_or(0);
    chrono::DateTime::from_timestamp(secs, nanos).map_or_else(
        || "1970-01-01 00:00:00".to_owned(),
        |d| d.naive_utc().format("%Y-%m-%d %H:%M:%S").to_string(),
    )
}

const TRADE_COLUMNS: [&str; 20] = [
    "id",
    "pair",
    "is_short",
    "is_open",
    "amount",
    "stake_amount",
    "open_rate",
    "close_rate",
    "leverage",
    "open_date",
    "close_date",
    "close_profit_abs",
    "close_profit",
    "exit_reason",
    "enter_tag",
    "stop_loss",
    "initial_stop_loss",
    "liquidation_price",
    "funding_fees",
    "realized_profit",
];

fn map_trade(row: &Row<'_>) -> LedgerTrade {
    let is_open = opt_bool(row, 3).unwrap_or(false);
    let profit_abs = opt_f64(row, 11);
    LedgerTrade {
        id: opt_i64(row, 0).unwrap_or(0),
        pair: opt_text(row, 1).unwrap_or_default(),
        // A NULL direction is a spot-era row: long.
        is_short: opt_bool(row, 2).unwrap_or(false),
        is_open,
        amount: opt_f64(row, 4).unwrap_or(0.0),
        stake_amount: opt_f64(row, 5).unwrap_or(0.0),
        open_rate: opt_f64(row, 6).unwrap_or(0.0),
        close_rate: opt_f64(row, 7),
        leverage: opt_f64(row, 8).filter(|l| *l > 0.0).unwrap_or(1.0),
        open_ms: opt_date_ms(row, 9),
        close_ms: opt_date_ms(row, 10),
        profit_abs,
        profit_ratio: opt_f64(row, 12),
        profit_unknown: !is_open && profit_abs.is_none(),
        exit_reason: opt_text(row, 13).filter(|s| !s.trim().is_empty()),
        enter_tag: opt_text(row, 14).filter(|s| !s.trim().is_empty()),
        stop_loss: opt_f64(row, 15),
        initial_stop_loss: opt_f64(row, 16),
        liquidation_price: opt_f64(row, 17),
        funding_fees: opt_f64(row, 18),
        realized_profit: opt_f64(row, 19),
        strategy: None,
    }
}

impl LedgerReader for SqliteLedger {
    fn stat(&self, db: &Path) -> Result<LedgerStat, LedgerError> {
        let meta = fs::metadata(db).map_err(|_| LedgerError(LedgerErrorCode::DbMissing))?;
        let mtime = |m: &fs::Metadata| {
            m.modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .and_then(|d| i64::try_from(d.as_millis()).ok())
                .unwrap_or(0)
        };
        let mut wal = db.as_os_str().to_owned();
        wal.push("-wal");
        let wal_meta = fs::metadata(PathBuf::from(wal)).ok();
        Ok(LedgerStat {
            db_size: meta.len(),
            db_mtime_ms: mtime(&meta),
            db_inode: meta.ino(),
            wal_size: wal_meta.as_ref().map(fs::Metadata::len),
            wal_mtime_ms: wal_meta.as_ref().map(mtime),
        })
    }

    fn schema(&self, db: &Path) -> Result<LedgerSchema, LedgerError> {
        self.with(db, |_, schema| Ok(schema.clone()))
    }

    fn summary(&self, db: &Path) -> Result<LedgerSummary, LedgerError> {
        self.with_table(db, "trades", LedgerErrorCode::DbError, |conn, schema| {
            let (open_date, close_date) = (
                col(schema, "trades", "open_date"),
                col(schema, "trades", "close_date"),
            );
            let is_short = col(schema, "trades", "is_short");
            let profit = col(schema, "trades", "close_profit_abs");
            let sql = format!(
                "SELECT \
                    COALESCE(SUM(CASE WHEN is_open = 1 THEN 1 ELSE 0 END), 0), \
                    COALESCE(SUM(CASE WHEN is_open = 0 THEN 1 ELSE 0 END), 0), \
                    COALESCE(SUM(CASE WHEN is_open = 0 THEN COALESCE({profit}, 0) ELSE 0 END), 0), \
                    COALESCE(SUM(CASE WHEN is_open = 0 AND {profit} IS NULL THEN 1 ELSE 0 END), 0), \
                    MIN({open_date}), MAX({open_date}), MAX({close_date}), \
                    COALESCE(MAX(id), 0), \
                    COUNT(DISTINCT {is_short}), \
                    COALESCE(MAX({is_short}), 0) \
                 FROM trades"
            );
            conn.query_row(&sql, [], |r| {
                let date = |i: usize| -> rusqlite::Result<Option<i64>> {
                    Ok(match r.get_ref(i)? {
                        ValueRef::Text(t) => std::str::from_utf8(t).ok().and_then(parse_date_ms),
                        _ => None,
                    })
                };
                Ok(LedgerSummary {
                    open_count: r.get(0)?,
                    closed_count: r.get(1)?,
                    realized_total: opt_f64(r, 2).unwrap_or(0.0),
                    profit_unknown_count: r.get(3)?,
                    first_open_ms: date(4)?,
                    last_open_ms: date(5)?,
                    last_close_ms: date(6)?,
                    max_trade_id: r.get(7)?,
                    direction_count: r.get(8)?,
                    any_short: opt_i64(r, 9).unwrap_or(0) != 0,
                })
            })
        })
    }

    fn probe(&self, db: &Path) -> Result<LedgerProbe, LedgerError> {
        self.with_table(db, "trades", LedgerErrorCode::DbError, |conn, _| {
            // Counted through the index on `is_open` that freqtrade creates: no row is decoded.
            conn.query_row(
                "SELECT (SELECT COUNT(*) FROM trades WHERE is_open = 1), \
                        (SELECT COUNT(*) FROM trades WHERE is_open = 0), \
                        (SELECT COALESCE(MAX(id), 0) FROM trades)",
                [],
                |r| {
                    Ok(LedgerProbe {
                        open_count: r.get(0)?,
                        closed_count: r.get(1)?,
                        max_trade_id: r.get(2)?,
                    })
                },
            )
        })
    }

    fn trades(&self, db: &Path, query: &TradeQuery) -> Result<Vec<LedgerTrade>, LedgerError> {
        self.with_table(db, "trades", LedgerErrorCode::DbError, |conn, schema| {
            let select: Vec<String> = TRADE_COLUMNS
                .iter()
                .map(|c| col(schema, "trades", c))
                .collect();
            let mut sql = format!("SELECT {} FROM trades WHERE 1 = 1", select.join(", "));
            let mut params: Vec<rusqlite::types::Value> = Vec::new();
            if let Some(open) = query.open {
                sql.push_str(" AND is_open = ?");
                params.push(i64::from(open).into());
            }
            if let Some(after) = query.after_id {
                sql.push_str(" AND id > ?");
                params.push(after.into());
            }
            if let Some(since) = query.touched_since_ms {
                let text = ms_to_db_text(since);
                sql.push_str(&format!(
                    " AND ({} >= ? OR {} >= ? OR is_open = 1)",
                    col(schema, "trades", "open_date"),
                    col(schema, "trades", "close_date"),
                ));
                params.push(text.clone().into());
                params.push(text.into());
            }
            sql.push_str(" ORDER BY id ASC");
            if let Some(limit) = query.limit {
                sql.push_str(&format!(" LIMIT {limit}"));
            }
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(rusqlite::params_from_iter(params), |r| Ok(map_trade(r)))?;
            let out = rows.collect::<Result<Vec<_>, _>>()?;
            drop(stmt);
            Ok(out)
        })
    }

    fn orders(&self, db: &Path, trade_ids: &[i64]) -> Result<Vec<LedgerOrder>, LedgerError> {
        if trade_ids.is_empty() {
            return Ok(Vec::new());
        }
        self.with_table(db, "orders", LedgerErrorCode::DbError, |conn, schema| {
            let cols = [
                "id",
                "ft_trade_id",
                "ft_order_side",
                "status",
                "ft_is_open",
                "filled",
                "amount",
                "average",
                "cost",
                "order_filled_date",
                "ft_order_tag",
            ]
            .map(|c| col(schema, "orders", c));
            let mut out = Vec::new();
            // Chunked IN lists keep the statement under SQLite's variable limit.
            for chunk in trade_ids.chunks(500) {
                let marks = vec!["?"; chunk.len()].join(",");
                let sql = format!(
                    "SELECT {} FROM orders WHERE ft_trade_id IN ({marks}) ORDER BY id ASC",
                    cols.join(", ")
                );
                let mut stmt = conn.prepare(&sql)?;
                let rows = stmt.query_map(rusqlite::params_from_iter(chunk.iter()), |r| {
                    Ok(LedgerOrder {
                        id: opt_i64(r, 0).unwrap_or(0),
                        trade_id: opt_i64(r, 1).unwrap_or(0),
                        side: opt_text(r, 2).unwrap_or_default(),
                        status: opt_text(r, 3),
                        is_open: opt_bool(r, 4).unwrap_or(false),
                        filled: opt_f64(r, 5),
                        amount: opt_f64(r, 6),
                        average: opt_f64(r, 7),
                        cost: opt_f64(r, 8),
                        filled_ms: opt_date_ms(r, 9),
                        tag: opt_text(r, 10).filter(|s| !s.trim().is_empty()),
                    })
                })?;
                out.extend(rows.collect::<Result<Vec<_>, _>>()?);
                drop(stmt);
            }
            Ok(out)
        })
    }

    fn profit_history(&self, db: &Path, after_rowid: i64) -> Result<ProfitChunk, LedgerError> {
        let cap = i64::from(self.opts.profit_chunk_rows);
        self.with_table(
            db,
            "profit_history",
            LedgerErrorCode::NoHistoryTable,
            |conn, _| {
                let max: i64 = conn.query_row(
                    "SELECT COALESCE(MAX(rowid), 0) FROM profit_history",
                    [],
                    |r| r.get(0),
                )?;
                // A cursor ahead of the table means a purge or a recreation: reload everything.
                let reset = after_rowid > max;
                let from = if reset { 0 } else { after_rowid };
                let mut stmt = conn.prepare(
                    "SELECT rowid, timestamp, profit_closed_abs, profit_open_abs, open_trades \
                 FROM profit_history WHERE rowid > ? ORDER BY rowid ASC LIMIT ?",
                )?;
                let rows = stmt.query_map([from, cap + 1], |r| {
                    Ok((
                        opt_i64(r, 0).unwrap_or(0),
                        opt_date_ms(r, 1),
                        opt_f64(r, 2),
                        opt_f64(r, 3),
                        opt_i64(r, 4).unwrap_or(0),
                    ))
                })?;
                let mut samples = Vec::new();
                let mut truncated = false;
                // Rows read, usable or not: the cap and the cursor follow the rows, not the samples.
                let mut fetched: i64 = 0;
                let mut last_rowid = None;
                for row in rows {
                    let (rowid, ts, closed, open, n) = row?;
                    fetched += 1;
                    if fetched > cap {
                        truncated = true;
                        break;
                    }
                    last_rowid = Some(rowid);
                    // A sample without a usable timestamp or values cannot be plotted.
                    if let (Some(ts_ms), Some(closed_abs), Some(open_abs)) = (ts, closed, open) {
                        samples.push(ProfitSample {
                            rowid,
                            ts_ms,
                            closed_abs,
                            open_abs,
                            open_trades: n,
                        });
                    }
                }
                drop(stmt);
                let cursor = if truncated {
                    last_rowid.unwrap_or(from)
                } else {
                    max
                };
                Ok(ProfitChunk {
                    samples,
                    max_rowid: cursor,
                    reset,
                    truncated,
                })
            },
        )
    }
}

/// Ledger files of a directory (`*.sqlite`, `*.db`), without sidecar files and without the names
/// the policy ignores. Used to find orphan ledgers of bots that are not running.
#[must_use]
pub fn list_ledger_files(dir: &Path, ignore_tokens: &[String]) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| matches!(e, "sqlite" | "db" | "sqlite3"))
        })
        .filter(|p| !crate::discovery::is_ignored_ledger(p, ignore_tokens))
        .collect();
    out.sort();
    out
}

impl fmt::Debug for SqliteLedger {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SqliteLedger")
            .field("opts", &self.opts)
            .finish_non_exhaustive()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Create a fixture ledger the way freqtrade does, in WAL mode.
    fn make_db(dir: &Path, name: &str, with_profit_history: bool) -> PathBuf {
        let path = dir.join(name);
        let conn = Connection::open(&path).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute_batch(
            "CREATE TABLE trades (
                id INTEGER PRIMARY KEY, pair VARCHAR(25) NOT NULL, is_open BOOLEAN NOT NULL,
                is_short BOOLEAN, amount FLOAT, stake_amount FLOAT NOT NULL, open_rate FLOAT,
                close_rate FLOAT, leverage FLOAT, open_date DATETIME NOT NULL, close_date DATETIME,
                close_profit_abs FLOAT, close_profit FLOAT, exit_reason VARCHAR(100),
                enter_tag VARCHAR(100), stop_loss FLOAT, initial_stop_loss FLOAT,
                liquidation_price FLOAT, funding_fees FLOAT, realized_profit FLOAT);
             CREATE TABLE orders (
                id INTEGER PRIMARY KEY, ft_trade_id INTEGER, ft_order_side VARCHAR(25) NOT NULL,
                status VARCHAR(255), ft_is_open BOOLEAN, filled FLOAT, amount FLOAT, average FLOAT,
                cost FLOAT, order_filled_date DATETIME, ft_order_tag VARCHAR(100));",
        )
        .unwrap();
        if with_profit_history {
            conn.execute_batch(
                "CREATE TABLE profit_history (
                    id INTEGER PRIMARY KEY, timestamp DATETIME NOT NULL,
                    profit_closed_abs FLOAT NOT NULL, profit_open_abs FLOAT NOT NULL,
                    open_trades INTEGER NOT NULL);",
            )
            .unwrap();
        }
        path
    }

    #[allow(clippy::too_many_arguments)] // fixture helper, positional on purpose
    fn insert_trade(
        db: &Path,
        id: i64,
        pair: &str,
        open: bool,
        short: Option<bool>,
        close_rate: Option<f64>,
        profit: Option<f64>,
        exit_reason: Option<&str>,
    ) {
        let conn = Connection::open(db).unwrap();
        conn.execute(
            "INSERT INTO trades (id, pair, is_open, is_short, amount, stake_amount, open_rate,
                close_rate, leverage, open_date, close_date, close_profit_abs, exit_reason)
             VALUES (?1, ?2, ?3, ?4, 1.0, 100.0, 10.0, ?5, 3.0, '2026-10-15 12:00:00.250000', ?6, ?7, ?8)",
            rusqlite::params![
                id,
                pair,
                open,
                short,
                close_rate,
                if open { None } else { Some("2026-10-15 14:00:00") },
                profit,
                exit_reason
            ],
        )
        .unwrap();
    }

    fn reader() -> SqliteLedger {
        SqliteLedger::default()
    }

    #[test]
    fn the_probe_agrees_with_the_summary_on_counts_and_ids() {
        let dir = tempfile::tempdir().unwrap();
        let db = make_db(dir.path(), "bot.sqlite", true);
        insert_trade(&db, 1, "BTC/USDC:USDC", true, Some(true), None, None, None);
        insert_trade(
            &db,
            2,
            "ETH/USDC:USDC",
            false,
            Some(false),
            Some(1.0),
            Some(0.1),
            Some("roi"),
        );
        insert_trade(
            &db,
            5,
            "SOL/USDC:USDC",
            false,
            Some(false),
            Some(2.0),
            Some(0.2),
            Some("roi"),
        );
        let ledger = reader();
        let (p, s) = (ledger.probe(&db).unwrap(), ledger.summary(&db).unwrap());
        assert_eq!(
            (p.open_count, p.closed_count, p.max_trade_id),
            (s.open_count, s.closed_count, s.max_trade_id)
        );
        assert_eq!((p.open_count, p.closed_count, p.max_trade_id), (1, 2, 5));
    }

    #[test]
    fn the_page_cache_of_a_cached_reader_connection_is_small() {
        let dir = tempfile::tempdir().unwrap();
        let db = make_db(dir.path(), "bot.sqlite", true);
        let ledger = reader();
        ledger.summary(&db).unwrap();
        let size: i64 = ledger
            .with(&db, |c, _| {
                c.query_row("PRAGMA cache_size", [], |r| r.get(0))
            })
            .unwrap();
        assert_eq!(size, -256, "256 KiB, not SQLite's default of 2 MiB");
    }

    #[test]
    fn open_trades_are_read_with_naive_utc_dates_converted_to_ms() {
        let dir = tempfile::tempdir().unwrap();
        let db = make_db(dir.path(), "bot.sqlite", true);
        insert_trade(&db, 1, "BTC/USDC:USDC", true, Some(true), None, None, None);
        let t = &reader()
            .trades(
                &db,
                &TradeQuery {
                    open: Some(true),
                    ..TradeQuery::default()
                },
            )
            .unwrap()[0];
        assert_eq!(t.id, 1);
        assert!(t.is_short, "direction comes from is_short");
        assert!(t.is_open);
        assert_eq!(t.open_ms, Some(1_792_065_600_250));
        assert!(
            !t.profit_unknown,
            "an open trade has no realised profit yet, that is not unknown"
        );
        assert!((t.leverage - 3.0).abs() < 1e-12);
    }

    #[test]
    fn null_exit_reason_close_rate_and_profit_are_never_invented() {
        let dir = tempfile::tempdir().unwrap();
        let db = make_db(dir.path(), "bot.sqlite", false);
        insert_trade(
            &db,
            1,
            "ETH/USDC:USDC",
            false,
            Some(false),
            None,
            None,
            None,
        );
        insert_trade(
            &db,
            2,
            "SOL/USDC:USDC",
            false,
            None,
            Some(11.0),
            Some(2.5),
            Some("roi"),
        );
        let ledger = reader();
        let trades = ledger
            .trades(
                &db,
                &TradeQuery {
                    open: Some(false),
                    ..TradeQuery::default()
                },
            )
            .unwrap();
        let a = &trades[0];
        assert_eq!(a.close_rate, None);
        assert_eq!(a.exit_reason, None);
        assert_eq!(a.profit_abs, None);
        assert!(a.profit_unknown);
        let b = &trades[1];
        assert!(!b.is_short, "a NULL is_short is a long");
        assert_eq!(b.exit_reason.as_deref(), Some("roi"));
        assert_eq!(b.profit_abs, Some(2.5));
        assert!(!b.profit_unknown);

        let s = ledger.summary(&db).unwrap();
        assert_eq!(s.closed_count, 2);
        assert_eq!(s.profit_unknown_count, 1);
        assert!(
            (s.realized_total - 2.5).abs() < 1e-12,
            "NULL profit counts as 0 in the sum only"
        );
        assert_eq!(s.first_open_ms, Some(1_792_065_600_250));
        assert_eq!(s.last_close_ms, Some(1_792_072_800_000));
        assert_eq!(s.max_trade_id, 2);
    }

    #[test]
    fn direction_summary_distinguishes_long_short_and_dual() {
        let dir = tempfile::tempdir().unwrap();
        let db = make_db(dir.path(), "bot.sqlite", false);
        insert_trade(&db, 1, "A/USDC:USDC", true, Some(false), None, None, None);
        assert_eq!(reader().summary(&db).unwrap().direction_count, 1);
        assert!(!reader().summary(&db).unwrap().any_short);
        insert_trade(&db, 2, "B/USDC:USDC", true, Some(true), None, None, None);
        let s = reader().summary(&db).unwrap();
        assert_eq!(s.direction_count, 2);
        assert!(s.any_short);
    }

    #[test]
    fn missing_columns_are_missing_fields_not_errors() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("old.sqlite");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE trades (id INTEGER PRIMARY KEY, pair TEXT, is_open BOOLEAN, amount FLOAT,
                stake_amount FLOAT, open_rate FLOAT, open_date DATETIME);
             CREATE TABLE orders (id INTEGER PRIMARY KEY, ft_trade_id INTEGER, ft_order_side TEXT);
             INSERT INTO trades VALUES (1, 'BTC/USDT', 1, 1.0, 50.0, 100.0, '2026-01-01 00:00:00');",
        )
        .unwrap();
        drop(conn);
        let ledger = reader();
        let t = &ledger.trades(&db, &TradeQuery::default()).unwrap()[0];
        assert_eq!(t.liquidation_price, None);
        assert_eq!(t.exit_reason, None);
        assert!(!t.is_short);
        assert!((t.leverage - 1.0).abs() < 1e-12);
        let schema = ledger.schema(&db).unwrap();
        assert!(schema.is_freqtrade_ledger());
        assert!(!schema.has_column("trades", "is_short"));
        assert!(!schema.has_table("profit_history"));
    }

    #[test]
    fn schema_is_refreshed_when_the_ledger_is_migrated() {
        let dir = tempfile::tempdir().unwrap();
        let db = make_db(dir.path(), "bot.sqlite", false);
        let ledger = reader();
        assert!(!ledger.schema(&db).unwrap().has_table("profit_history"));
        Connection::open(&db)
            .unwrap()
            .execute_batch(
                "CREATE TABLE profit_history (id INTEGER PRIMARY KEY, timestamp DATETIME,
                  profit_closed_abs FLOAT, profit_open_abs FLOAT, open_trades INTEGER);",
            )
            .unwrap();
        assert!(ledger.schema(&db).unwrap().has_table("profit_history"));
    }

    #[test]
    fn orders_give_the_entry_count_by_side() {
        let dir = tempfile::tempdir().unwrap();
        let db = make_db(dir.path(), "bot.sqlite", false);
        insert_trade(&db, 7, "BTC/USDC:USDC", true, Some(true), None, None, None);
        Connection::open(&db)
            .unwrap()
            .execute_batch(
                "INSERT INTO orders (id, ft_trade_id, ft_order_side, status, ft_is_open, filled) VALUES
                   (1, 7, 'sell', 'closed', 0, 1.0),
                   (2, 7, 'sell', 'closed', 0, 0.5),
                   (3, 7, 'sell', 'canceled', 0, 0.0),
                   (4, 7, 'buy', 'closed', 0, 0.3),
                   (5, 7, 'sell', 'open', 1, NULL);",
            )
            .unwrap();
        let orders = reader().orders(&db, &[7]).unwrap();
        assert_eq!(orders.len(), 5);
        assert_eq!(
            filled_entry_orders(&orders, 7, true),
            2,
            "short entries are sell orders"
        );
        assert_eq!(
            filled_entry_orders(&orders, 7, false),
            1,
            "the same rows read as a long differ"
        );
        assert!(reader().orders(&db, &[]).unwrap().is_empty());
    }

    #[test]
    fn profit_history_is_incremental_and_resets_when_the_rowid_goes_back() {
        let dir = tempfile::tempdir().unwrap();
        let db = make_db(dir.path(), "bot.sqlite", true);
        let add = |n: i64, ts: &str| {
            Connection::open(&db)
                .unwrap()
                .execute(
                    "INSERT INTO profit_history (id, timestamp, profit_closed_abs, profit_open_abs, open_trades)
                     VALUES (?1, ?2, 1.5, -0.5, 2)",
                    rusqlite::params![n, ts],
                )
                .unwrap();
        };
        add(1, "2026-10-15 10:00:00.5");
        add(2, "2026-10-15 10:05:00");
        add(3, "2026-10-15 10:10:00");
        let ledger = reader();
        let first = ledger.profit_history(&db, 0).unwrap();
        assert_eq!(first.samples.len(), 3);
        assert_eq!(first.max_rowid, 3);
        assert!(!first.reset);
        assert_eq!(first.samples[0].ts_ms, 1_792_058_400_500);
        assert!((first.samples[0].open_abs + 0.5).abs() < 1e-12);

        // Nothing new: empty chunk, same cursor.
        let none = ledger.profit_history(&db, 3).unwrap();
        assert!(none.samples.is_empty());
        assert_eq!(none.max_rowid, 3);

        add(4, "2026-10-15 10:15:00");
        let inc = ledger.profit_history(&db, 3).unwrap();
        assert_eq!(inc.samples.iter().map(|s| s.rowid).collect::<Vec<_>>(), [4]);

        // The table was purged and recreated with fewer rows: cursor 4 is now ahead of max.
        Connection::open(&db)
            .unwrap()
            .execute("DELETE FROM profit_history", [])
            .unwrap();
        Connection::open(&db)
            .unwrap()
            .execute(
                "INSERT INTO profit_history (id, timestamp, profit_closed_abs, profit_open_abs, open_trades)
                 VALUES (1, '2026-10-15 11:00:00', 9.0, 0.0, 0)",
                [],
            )
            .unwrap();
        let reset = ledger.profit_history(&db, 4).unwrap();
        assert!(reset.reset);
        assert_eq!(reset.samples.len(), 1);
        assert_eq!(reset.max_rowid, 1);
    }

    #[test]
    fn profit_history_chunks_are_capped() {
        let dir = tempfile::tempdir().unwrap();
        let db = make_db(dir.path(), "bot.sqlite", true);
        let conn = Connection::open(&db).unwrap();
        for i in 1..=25 {
            conn.execute(
                "INSERT INTO profit_history (id, timestamp, profit_closed_abs, profit_open_abs, open_trades)
                 VALUES (?1, '2026-10-15 10:00:00', 0, 0, 0)",
                [i],
            )
            .unwrap();
        }
        drop(conn);
        let ledger = SqliteLedger::new(LedgerOptions {
            profit_chunk_rows: 10,
            ..LedgerOptions::default()
        });
        let a = ledger.profit_history(&db, 0).unwrap();
        assert_eq!((a.samples.len(), a.truncated, a.max_rowid), (10, true, 10));
        let b = ledger.profit_history(&db, a.max_rowid).unwrap();
        assert_eq!((b.samples.len(), b.truncated, b.max_rowid), (10, true, 20));
        let c = ledger.profit_history(&db, b.max_rowid).unwrap();
        assert_eq!((c.samples.len(), c.truncated, c.max_rowid), (5, false, 25));
    }

    #[test]
    fn profit_history_pages_over_rows_that_are_unusable() {
        let dir = tempfile::tempdir().unwrap();
        let db = make_db(dir.path(), "bot.sqlite", true);
        let conn = Connection::open(&db).unwrap();
        for i in 1..=25 {
            // Row 3 has a timestamp that cannot be parsed.
            let ts = if i == 3 {
                "garbage"
            } else {
                "2026-10-15 10:00:00"
            };
            conn.execute(
                "INSERT INTO profit_history (id, timestamp, profit_closed_abs, profit_open_abs, open_trades)
                 VALUES (?1, ?2, 0, 0, 0)",
                rusqlite::params![i, ts],
            )
            .unwrap();
        }
        drop(conn);
        let ledger = SqliteLedger::new(LedgerOptions {
            profit_chunk_rows: 10,
            ..LedgerOptions::default()
        });
        let mut cursor = 0;
        let mut total = 0;
        for _ in 0..10 {
            let chunk = ledger.profit_history(&db, cursor).unwrap();
            total += chunk.samples.len();
            cursor = chunk.max_rowid;
            if !chunk.truncated {
                break;
            }
        }
        assert_eq!(cursor, 25);
        assert_eq!(total, 24, "no usable row may be skipped by the paging");
    }

    /// Regression: `with` used to take `conns` while holding a slot guard, while another thread
    /// held `conns` and waited for that slot guard (lock order inversion on the error path).
    #[test]
    fn concurrent_failing_reads_do_not_deadlock() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("bot.sqlite");
        fs::write(
            &db,
            b"this is not a sqlite file, it is long enough to be read as one header",
        )
        .unwrap();
        let ledger = Arc::new(SqliteLedger::default());
        let (tx, rx) = std::sync::mpsc::channel();
        for _ in 0..4 {
            let ledger = Arc::clone(&ledger);
            let db = db.clone();
            let tx = tx.clone();
            std::thread::spawn(move || {
                for _ in 0..300 {
                    assert!(ledger.summary(&db).is_err());
                }
                tx.send(()).unwrap();
            });
        }
        for _ in 0..4 {
            rx.recv_timeout(Duration::from_secs(30))
                .expect("failing concurrent reads deadlocked");
        }
    }

    #[test]
    fn a_ledger_without_profit_history_reports_no_history_table() {
        let dir = tempfile::tempdir().unwrap();
        let db = make_db(dir.path(), "bot.sqlite", false);
        let err = reader().profit_history(&db, 0).unwrap_err();
        assert_eq!(err.code(), LedgerErrorCode::NoHistoryTable);
    }

    #[test]
    fn errors_are_normalised_without_paths() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope.sqlite");
        let err = reader().summary(&missing).unwrap_err();
        assert_eq!(err.code(), LedgerErrorCode::DbMissing);
        assert!(!format!("{err} {err:?}").contains("nope"));

        let junk = dir.path().join("junk.sqlite");
        fs::write(&junk, vec![0x42u8; 4096]).unwrap();
        let err = reader().summary(&junk).unwrap_err();
        assert!(
            matches!(
                err.code(),
                LedgerErrorCode::DbCorrupt | LedgerErrorCode::DbError
            ),
            "{err:?}"
        );
        assert!(!format!("{err} {err:?}").contains("junk"));
    }

    #[test]
    fn the_reader_cannot_write() {
        let dir = tempfile::tempdir().unwrap();
        let db = make_db(dir.path(), "bot.sqlite", false);
        let ledger = reader();
        ledger.summary(&db).unwrap();
        // Reach the cached connection and try to write through it.
        let slot = Arc::clone(&ledger.conns.lock().unwrap().get(&db).unwrap().handle);
        let handle = slot.lock().unwrap();
        let err = handle
            .conn
            .execute("INSERT INTO trades (id, pair, is_open, stake_amount, open_date) VALUES (99, 'X', 1, 1, 'd')", [])
            .unwrap_err();
        assert!(
            err.to_string().to_lowercase().contains("readonly")
                || err.to_string().to_lowercase().contains("read-only")
                || err.to_string().to_lowercase().contains("read only"),
            "{err}"
        );
        drop(handle);
        let n: i64 = Connection::open(&db)
            .unwrap()
            .query_row("SELECT COUNT(*) FROM trades", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn reading_does_not_touch_the_files() {
        let dir = tempfile::tempdir().unwrap();
        let db = make_db(dir.path(), "bot.sqlite", true);
        insert_trade(&db, 1, "BTC/USDC:USDC", true, Some(false), None, None, None);
        // Keep a writer connection open so that the WAL file stays in place.
        let writer = Connection::open(&db).unwrap();
        writer.execute("INSERT INTO profit_history (id, timestamp, profit_closed_abs, profit_open_abs, open_trades) VALUES (1, '2026-10-15 10:00:00', 0, 0, 0)", []).unwrap();
        let snapshot = |p: &Path| {
            let mut wal = p.as_os_str().to_owned();
            wal.push("-wal");
            (
                fs::metadata(p).unwrap().len(),
                fs::metadata(PathBuf::from(&wal))
                    .map(|m| (m.len(), m.modified().unwrap()))
                    .ok(),
                fs::metadata(p).unwrap().modified().unwrap(),
            )
        };
        let before = snapshot(&db);
        let ledger = reader();
        for _ in 0..20 {
            ledger.summary(&db).unwrap();
            ledger.trades(&db, &TradeQuery::default()).unwrap();
            ledger.profit_history(&db, 0).unwrap();
        }
        assert_eq!(
            snapshot(&db),
            before,
            "db and wal are byte-for-byte untouched in size and mtime"
        );
        let stat = ledger.stat(&db).unwrap();
        assert!(stat.has_wal());
        drop(writer);
    }

    #[test]
    fn a_concurrent_writer_never_blocks_the_reader_and_the_wal_stays_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let db = make_db(dir.path(), "bot.sqlite", true);
        let stop = Arc::new(AtomicBool::new(false));
        let writer_db = db.clone();
        let writer_stop = Arc::clone(&stop);
        let writer = std::thread::spawn(move || {
            let conn = Connection::open(&writer_db).unwrap();
            conn.pragma_update(None, "synchronous", "NORMAL").unwrap();
            let mut i = 0_i64;
            while !writer_stop.load(Ordering::Relaxed) {
                i += 1;
                conn.execute(
                    "INSERT INTO profit_history (id, timestamp, profit_closed_abs, profit_open_abs, open_trades)
                     VALUES (?1, '2026-10-15 10:00:00', 0, 0, 0)",
                    [i],
                )
                .unwrap();
            }
            i
        });
        let ledger = reader();
        let started = Instant::now();
        let mut cursor = 0;
        let mut reads = 0;
        while started.elapsed() < Duration::from_millis(600) {
            let chunk = ledger.profit_history(&db, cursor).unwrap();
            cursor = chunk.max_rowid;
            reads += 1;
        }
        stop.store(true, Ordering::Relaxed);
        let written = writer.join().unwrap();
        assert!(reads > 5 && written > 20, "reads={reads} written={written}");
        // The reader holds no transaction between calls, so nothing stops a full checkpoint even
        // though its connection is still open and cached.
        let wal = ledger.stat(&db).unwrap().wal_size.unwrap_or(0);
        assert!(wal < 16 * 1024 * 1024, "wal grew to {wal} bytes");
        let (busy, _, _): (i64, i64, i64) = Connection::open(&db)
            .unwrap()
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(
            busy, 0,
            "a cached reader connection must not block the checkpointer"
        );
    }

    #[test]
    fn a_slow_query_is_interrupted_by_the_budget() {
        let dir = tempfile::tempdir().unwrap();
        let db = make_db(dir.path(), "bot.sqlite", false);
        let ledger = SqliteLedger::new(LedgerOptions {
            query_budget: Duration::from_nanos(1),
            ..LedgerOptions::default()
        });
        let err = ledger
            .with(&db, |conn, _| {
                conn.query_row(
                    "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 50000000)
                     SELECT COUNT(*) FROM c",
                    [],
                    |r| r.get::<_, i64>(0),
                )
            })
            .unwrap_err();
        assert_eq!(err.code(), LedgerErrorCode::Timeout);
    }

    #[test]
    fn a_replaced_file_is_not_read_through_the_old_handle() {
        let dir = tempfile::tempdir().unwrap();
        let db = make_db(dir.path(), "bot.sqlite", false);
        insert_trade(&db, 1, "A/USDC:USDC", true, Some(false), None, None, None);
        let ledger = reader();
        assert_eq!(ledger.summary(&db).unwrap().open_count, 1);
        fs::remove_file(&db).unwrap();
        let _ = fs::remove_file(dir.path().join("bot.sqlite-wal"));
        let _ = fs::remove_file(dir.path().join("bot.sqlite-shm"));
        let db2 = make_db(dir.path(), "bot.sqlite", false);
        assert_eq!(db2, db);
        assert_eq!(ledger.summary(&db).unwrap().open_count, 0);
    }

    #[test]
    fn touched_since_includes_open_trades_and_recent_closures() {
        let dir = tempfile::tempdir().unwrap();
        let db = make_db(dir.path(), "bot.sqlite", false);
        insert_trade(
            &db,
            1,
            "A/USDC:USDC",
            false,
            Some(false),
            Some(11.0),
            Some(1.0),
            Some("roi"),
        );
        insert_trade(&db, 2, "B/USDC:USDC", true, Some(false), None, None, None);
        // Both fixtures were opened 2026-10-15 12:00 and (trade 1) closed 14:00.
        let later = parse_date_ms("2026-10-15 13:00:00").unwrap();
        let ids: Vec<i64> = reader()
            .trades(
                &db,
                &TradeQuery {
                    touched_since_ms: Some(later),
                    ..TradeQuery::default()
                },
            )
            .unwrap()
            .iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(ids, [1, 2]);
        let much_later = parse_date_ms("2026-10-16 00:00:00").unwrap();
        let ids: Vec<i64> = reader()
            .trades(
                &db,
                &TradeQuery {
                    touched_since_ms: Some(much_later),
                    ..TradeQuery::default()
                },
            )
            .unwrap()
            .iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(ids, [2], "an open trade is always included");
        let after: Vec<i64> = reader()
            .trades(
                &db,
                &TradeQuery {
                    after_id: Some(1),
                    ..TradeQuery::default()
                },
            )
            .unwrap()
            .iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(after, [2]);
    }

    #[test]
    fn ledger_listing_skips_sidecars_and_ignored_names() {
        let dir = tempfile::tempdir().unwrap();
        for n in [
            "a.sqlite",
            "a.sqlite-wal",
            "a.sqlite-shm",
            "b_backup.sqlite",
            "c_replay.sqlite",
            "tmp_d.sqlite",
            "e.db",
            "notes.txt",
        ] {
            fs::write(dir.path().join(n), b"").unwrap();
        }
        fs::create_dir_all(dir.path().join("_archive")).unwrap();
        fs::write(dir.path().join("_archive/old.sqlite"), b"").unwrap();
        let tokens: Vec<String> = ["backup", "replay", "tmp"].map(String::from).to_vec();
        let names: Vec<String> = list_ledger_files(dir.path(), &tokens)
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["a.sqlite", "e.db"]);
    }

    #[test]
    fn uri_encoding_protects_special_characters() {
        assert_eq!(
            ro_uri(Path::new("/a b/c?d#e%f.sqlite")),
            "file:/a%20b/c%3fd%23e%25f.sqlite?mode=ro"
        );
    }

    #[test]
    fn source_contains_no_write_or_checkpoint_statement() {
        // The statement set of this module is closed and read-only: guard it mechanically.
        let src = include_str!("sqlite.rs");
        let body = src
            .split("#[cfg(test)]")
            .next()
            .unwrap()
            .to_ascii_lowercase();
        for forbidden in [
            "insert into",
            "update ",
            "delete from",
            "drop table",
            "create table",
            "wal_checkpoint",
            "vacuum",
            "analyze",
            "journal_mode",
            "immutable=1",
        ] {
            // The doc comment at the top names the forbidden pragmas; only statements matter.
            let hits = body
                .lines()
                .filter(|l| !l.trim_start().starts_with("//"))
                .filter(|l| l.contains(forbidden))
                .count();
            assert_eq!(
                hits, 0,
                "forbidden keyword {forbidden:?} in non-comment code"
            );
        }
    }
}
