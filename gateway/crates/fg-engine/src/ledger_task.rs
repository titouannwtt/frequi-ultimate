//! The ledger poller: one task for all bots (03 sections 4.2 and 5).
//!
//! Every period it `stat()`s each database and its `-wal` (80 `stat` calls for 40 bots, no file
//! is opened), and reads a ledger only when it changed. A read is short and collects rows into
//! memory; no connection keeps a statement open (see `fg_sources::sqlite`), so the poller never
//! holds back a checkpoint of the bot's WAL.
//!
//! Closed trades are read incrementally: when the closed part of the summary is unchanged nothing
//! is queried; below `full_reload_below` closed trades a change reloads them all; above it only
//! the trades touched since the last read are queried and the count is verified against the
//! summary, falling back to a full reload on a mismatch (a deleted trade, an edited date).

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use fg_core::identity::BotKey;
use fg_sources::sqlite::{
    LedgerError, LedgerErrorCode, LedgerSummary, TradeQuery, filled_entry_orders,
};
use fg_sources::traits::LedgerReader;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::ledger_data::{ClosedUpdate, LedgerEvent, LedgerRead};
use crate::msg::Msg;
use crate::shared::Shared;

/// Margin applied to the "touched since" cursor: dates in the ledger are naive UTC written by the
/// bot, the cursor is our clock.
const TOUCH_MARGIN_MS: i64 = 10 * 60 * 1000;
/// `profit_history` pages read per pass at most.
const PROFIT_PAGES: usize = 20;
/// The full summary (a scan of the whole `trades` table) is redone at least this often, even
/// when the counts did not move: it is what notices an edited profit or date of an old trade.
const SUMMARY_REFRESH_MS: i64 = 60_000;
/// A ledger that keeps changing (a bot rewriting its open trades every few seconds) is read at
/// most this often, unless a client looks at bots or a fill just happened: what changes between
/// two such writes is a stop price or a min/max rate, and new or closed trades arrive by
/// WebSocket first and nudge the poller.
const MIN_PASS_GAP_MS: i64 = 8_000;
/// The same while a client is looking at bots.
const MIN_PASS_GAP_VIEWED_MS: i64 = 2_000;

type Token = (u64, i64, u64, Option<u64>, Option<i64>);

/// What the poller remembers of one ledger between two passes.
#[derive(Debug, Default)]
pub(crate) struct Poll {
    token: Option<Token>,
    closed_sig: Option<(i64, u64, i64, Option<i64>)>,
    closed_ids: HashSet<i64>,
    touch_cursor_ms: Option<i64>,
    profit_cursor: i64,
    /// The last full summary and when it was computed.
    summary: Option<(LedgerSummary, i64)>,
    /// When the last pass (a read, not a `stat`) started.
    pass_ms: Option<i64>,
}

fn closed_sig(s: &LedgerSummary) -> (i64, u64, i64, Option<i64>) {
    (
        s.closed_count,
        s.realized_total.to_bits(),
        s.profit_unknown_count,
        s.last_close_ms,
    )
}

/// One pass over one ledger. Pure with respect to the engine: reads through `ledger`, updates
/// `poll`, returns what to tell the core.
pub(crate) fn poll_one(
    ledger: &dyn LedgerReader,
    path: &std::path::Path,
    poll: &mut Poll,
    now_ms: i64,
    full_reload_below: usize,
    min_gap_ms: i64,
) -> Result<LedgerEvent, LedgerError> {
    let stat = ledger.stat(path)?;
    let token = stat.change_token();
    if poll.token == Some(token) {
        return Ok(LedgerEvent::Alive);
    }
    // Changed, but read too recently: the file is alive, the next pass will see the change
    // (the token is not updated).
    if poll.pass_ms.is_some_and(|t| now_ms - t < min_gap_ms) && poll.token.is_some() {
        return Ok(LedgerEvent::Alive);
    }
    poll.pass_ms = Some(now_ms);
    // A bot that only moves its open trades (stop, min and max rate) changes the file every few
    // seconds; scanning every closed trade each time would cost most of the engine's CPU. The
    // counts and the highest id say whether anything was opened or closed.
    let probe = ledger.probe(path)?;
    let summary = match &poll.summary {
        Some((last, at))
            if now_ms - at < SUMMARY_REFRESH_MS
                && last.closed_count == probe.closed_count
                && last.max_trade_id == probe.max_trade_id =>
        {
            LedgerSummary {
                open_count: probe.open_count,
                ..*last
            }
        }
        _ => {
            let full = ledger.summary(path)?;
            poll.summary = Some((full, now_ms));
            full
        }
    };
    let open = ledger.trades(
        path,
        &TradeQuery {
            open: Some(true),
            ..TradeQuery::default()
        },
    )?;
    let ids: Vec<i64> = open.iter().map(|t| t.id).collect();
    let orders = ledger.orders(path, &ids)?;
    let entries: HashMap<i64, u32> = open
        .iter()
        .map(|t| {
            (
                t.id,
                u32::try_from(filled_entry_orders(&orders, t.id, t.is_short)).unwrap_or(u32::MAX),
            )
        })
        .collect();

    let sig = closed_sig(&summary);
    let closed = if poll.closed_sig == Some(sig) {
        ClosedUpdate::None
    } else {
        let closed_count = usize::try_from(summary.closed_count).unwrap_or(0);
        let full = poll.closed_sig.is_none() || closed_count < full_reload_below;
        let rows = if full {
            ledger.trades(
                path,
                &TradeQuery {
                    open: Some(false),
                    ..TradeQuery::default()
                },
            )?
        } else {
            let since = poll.touch_cursor_ms.map(|c| c - TOUCH_MARGIN_MS);
            ledger.trades(
                path,
                &TradeQuery {
                    open: Some(false),
                    touched_since_ms: since,
                    ..TradeQuery::default()
                },
            )?
        };
        if full {
            poll.closed_ids = rows.iter().map(|t| t.id).collect();
            ClosedUpdate::Full(rows)
        } else {
            poll.closed_ids.extend(rows.iter().map(|t| t.id));
            if i64::try_from(poll.closed_ids.len()).ok() == Some(summary.closed_count) {
                ClosedUpdate::Upsert(rows)
            } else {
                // The count does not add up: a trade was deleted or edited out of the window.
                let all = ledger.trades(
                    path,
                    &TradeQuery {
                        open: Some(false),
                        ..TradeQuery::default()
                    },
                )?;
                poll.closed_ids = all.iter().map(|t| t.id).collect();
                ClosedUpdate::Full(all)
            }
        }
    };
    poll.touch_cursor_ms = Some(now_ms);

    // The profit curve: incremental by rowid, absent in older ledgers.
    let mut profit = None;
    for _ in 0..PROFIT_PAGES {
        match ledger.profit_history(path, poll.profit_cursor) {
            Ok(chunk) => {
                poll.profit_cursor = chunk.max_rowid;
                let more = chunk.truncated;
                match profit.as_mut() {
                    None => profit = Some(chunk),
                    Some(acc) => {
                        let acc: &mut fg_sources::sqlite::ProfitChunk = acc;
                        acc.samples.extend(chunk.samples);
                        acc.max_rowid = chunk.max_rowid;
                        acc.truncated = chunk.truncated;
                    }
                }
                if !more {
                    break;
                }
            }
            Err(e) if e.code() == LedgerErrorCode::NoHistoryTable => break,
            Err(e) => return Err(e),
        }
    }

    poll.closed_sig = Some(sig);
    poll.token = Some(token);
    Ok(LedgerEvent::Read(Box::new(LedgerRead {
        summary,
        open,
        entries,
        closed,
        profit,
    })))
}

pub(crate) async fn run(shared: Arc<Shared>, ledger: Arc<dyn LedgerReader>) {
    let permits = Arc::new(Semaphore::new(shared.cfg.ledger_threads.max(1)));
    let mut polls: HashMap<PathBuf, Poll> = HashMap::new();
    let full_below = shared.cfg.full_reload_below;
    loop {
        let cad = shared.cfg.cadences.ledger_stat;
        let viewed = shared.views.any_bot_viewed();
        let period = if viewed { cad.viewed } else { cad.normal };
        let period = period.mul_f64(1.0 + 0.1 * jitter_unit());
        let nudged = tokio::select! {
            () = tokio::time::sleep(period) => false,
            () = shared.ledger_nudge.notified() => true,
        };
        let gap = if nudged {
            0
        } else if viewed {
            MIN_PASS_GAP_VIEWED_MS
        } else {
            MIN_PASS_GAP_MS
        };
        // Compressed time (tests, demos) compresses the gap with everything else.
        let gap = (gap as f64 / shared.cfg.cadences.time_scale.max(1e-6)) as i64;
        let targets = shared
            .ledger_targets
            .read()
            .map(|t| t.clone())
            .unwrap_or_default();
        polls.retain(|p, _| targets.iter().any(|t| &t.path == p));
        let mut set: JoinSet<(PathBuf, BotKey, Poll, Result<LedgerEvent, LedgerError>)> =
            JoinSet::new();
        for t in targets {
            let poll = polls.remove(&t.path).unwrap_or_default();
            let (ledger, permits) = (Arc::clone(&ledger), Arc::clone(&permits));
            let now_ms = shared.now_ms();
            set.spawn(async move {
                let Ok(_permit) = permits.acquire_owned().await else {
                    return (
                        t.path,
                        t.key,
                        poll,
                        Err(LedgerError(LedgerErrorCode::DbError)),
                    );
                };
                let path = t.path.clone();
                let joined = tokio::task::spawn_blocking(move || {
                    let mut poll = poll;
                    let r = poll_one(ledger.as_ref(), &path, &mut poll, now_ms, full_below, gap);
                    (poll, r)
                })
                .await;
                match joined {
                    Ok((poll, r)) => (t.path, t.key, poll, r),
                    Err(_) => (
                        t.path,
                        t.key,
                        Poll::default(),
                        Err(LedgerError(LedgerErrorCode::DbError)),
                    ),
                }
            });
        }
        while let Some(res) = set.join_next().await {
            let Ok((path, key, mut poll, r)) = res else {
                continue;
            };
            let ev = match r {
                Ok(ev) => ev,
                Err(e) => {
                    // Read again from scratch once the file is readable.
                    poll.token = None;
                    poll.summary = None;
                    LedgerEvent::Error(e.code())
                }
            };
            polls.insert(path, poll);
            let _ = shared
                .core_tx
                .send(Msg::Ledger {
                    key,
                    at_ms: shared.now_ms(),
                    ev,
                })
                .await;
        }
    }
}

fn jitter_unit() -> f64 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.subsec_nanos());
    f64::from(nanos % 2000) / 1000.0 - 1.0
}
