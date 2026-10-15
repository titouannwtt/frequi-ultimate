//! The gateway reads bot ledgers while the bot keeps writing. A reader that holds a read
//! transaction open pins old WAL frames and makes the `-wal` grow without bound until the bot
//! stalls on disk; the gateway must never do that (03 section 5, budget "no read transaction held").
//!
//! The writer here commits about 300 times a second (a busy bot commits a few times a minute,
//! with an occasional trade rotation and profit sample), and the reader is the gateway's own
//! `SqliteLedger` polled 8 times more often than the ledger task polls (a full pass every 250 ms
//! instead of every 2 s), so that the overlap between the two is far higher than in production.

use std::path::Path;
use std::time::{Duration, Instant};

use fakebot::ledger::{SeedSpec, Writer, WriterConfig, create_and_seed, open_db};
use fg_sources::sqlite::{LedgerOptions, SqliteLedger, TradeQuery};
use fg_sources::traits::LedgerReader;

fn env_secs(name: &str, default: f64) -> Duration {
    Duration::from_secs_f64(
        std::env::var(name)
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(default),
    )
}

fn wal_size(db: &Path) -> u64 {
    std::fs::metadata(format!("{}-wal", db.display())).map_or(0, |m| m.len())
}

fn seed(db: &Path) {
    let spec = SeedSpec {
        bot_seed: 3,
        closed_trades: 20_000,
        open_trades: 3,
        history_days: 120,
        profit_history_every_s: 300,
        short_share: 0.5,
    };
    create_and_seed(db, &spec, chrono::Utc::now().timestamp_millis()).unwrap();
}

fn fast_writer(db: &Path) -> Writer {
    Writer::spawn(
        db,
        WriterConfig {
            commit_every: env_secs("FG_WAL_WRITE_S", 0.003),
            profit_every: Duration::from_millis(400),
            trade_every: Duration::from_millis(300),
        },
        11,
    )
}

/// One pass of what the ledger task does when it sees the ledger change.
fn poll_once(ledger: &SqliteLedger, db: &Path, cursor: &mut i64, after_id: &mut i64) {
    ledger.stat(db).unwrap();
    ledger.schema(db).unwrap();
    let summary = ledger.summary(db).unwrap();
    assert!(summary.closed_count >= 20_000);
    let open = ledger
        .trades(
            db,
            &TradeQuery {
                open: Some(true),
                ..TradeQuery::default()
            },
        )
        .unwrap();
    let ids: Vec<i64> = open.iter().map(|t| t.id).collect();
    ledger.orders(db, &ids).unwrap();
    let closed = ledger
        .trades(
            db,
            &TradeQuery {
                open: Some(false),
                after_id: Some(*after_id),
                ..TradeQuery::default()
            },
        )
        .unwrap();
    if let Some(last) = closed.iter().map(|t| t.id).max() {
        *after_id = last;
    }
    let chunk = ledger.profit_history(db, *cursor).unwrap();
    *cursor = chunk.max_rowid;
}

#[test]
fn reading_under_a_fast_writer_keeps_the_wal_bounded_and_never_fails() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("tradesv3.sqlite");
    seed(&db);
    let writer = fast_writer(&db);
    let ledger = SqliteLedger::new(LedgerOptions::default());

    let total = env_secs("FG_WAL_SECS", 15.0);
    let start = Instant::now();
    let (mut first_half, mut second_half) = (0_u64, 0_u64);
    let (mut cursor, mut after_id) = (0_i64, 20_000_i64);
    let mut polls = 0_u64;
    while start.elapsed() < total {
        poll_once(&ledger, &db, &mut cursor, &mut after_id);
        polls += 1;
        let w = wal_size(&db);
        if start.elapsed() < total / 2 {
            first_half = first_half.max(w);
        } else {
            second_half = second_half.max(w);
        }
        std::thread::sleep(env_secs("FG_WAL_POLL_S", 0.25));
    }
    let commits = writer.commits.load(std::sync::atomic::Ordering::Relaxed);
    drop(writer);
    println!(
        "{polls} polls, {commits} writer commits, -wal peak {first_half} B then {second_half} B"
    );

    assert!(commits > 1_000, "the writer barely ran ({commits} commits)");
    assert!(polls > 20, "the reader barely ran ({polls} polls)");
    assert!(
        second_half < 8 * 1024 * 1024,
        "the -wal reached {} MB",
        second_half / 1024 / 1024
    );
    // Stable: the second half does not outgrow the first (1 MB of slack for page rounding).
    assert!(
        second_half <= first_half + first_half / 2 + 1024 * 1024,
        "the -wal kept growing: {first_half} B then {second_half} B"
    );
}

#[test]
fn the_test_would_catch_a_reader_that_holds_a_transaction() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("tradesv3.sqlite");
    seed(&db);
    // The reader's mistake: a read transaction left open while the bot keeps committing.
    let reader = open_db(&db).unwrap();
    reader.execute_batch("BEGIN").unwrap();
    let _: i64 = reader
        .query_row("SELECT COUNT(*) FROM trades", [], |r| r.get(0))
        .unwrap();
    let writer = fast_writer(&db);

    let start = Instant::now();
    let mut peak = 0_u64;
    while start.elapsed() < Duration::from_secs(8) && peak < 8 * 1024 * 1024 {
        peak = peak.max(wal_size(&db));
        std::thread::sleep(Duration::from_millis(50));
    }
    drop(writer);
    reader.execute_batch("COMMIT").unwrap();
    assert!(
        peak >= 8 * 1024 * 1024,
        "a held read transaction should have grown the -wal past 8 MB, got {peak} B"
    );
}
