//! Read queries over the published state: calendar, drawdown, equity curve, leaderboard and the
//! paginated trade journal. They work on an immutable [`Published`], so they never wait for the
//! core and never see a half-updated state.

use std::collections::{BTreeSet, HashMap};

use fg_core::calc::drawdown::{
    ClosedPnl, DrawdownDef, DrawdownInput, DrawdownResult, HistorySample, OpenRisk,
};
use fg_core::calc::periods::{PeriodKey, PeriodUnit, PnlBucket, Tz, period_cutoff_ms, pnl_periods};
use fg_core::calc::stats::{TradeTotals, trade_totals};
use fg_core::identity::BotKey;
use fg_core::model::{BotMode, BotRow, Side, TradeRow};
use serde::{Deserialize, Serialize};

use crate::closed::ClosedTrade;
use crate::published::{BotData, Published};

/// A set of bots a figure is computed for. One currency and one mode at a time: a scope never
/// mixes live with dry or replay bots.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScopeRef {
    Mode(BotMode),
    Bot(BotKey),
    /// A group of bots chosen by the user (all of the same mode, or the call is refused).
    Bots(Vec<BotKey>),
}

/// Why a scope could not be resolved.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ScopeError {
    #[error("unknown bot")]
    UnknownBot,
    #[error("a group mixes live, dry or replay bots")]
    MixedModes,
    #[error("empty scope")]
    Empty,
}

/// The bots of a scope.
///
/// # Errors
/// [`ScopeError`] for an unknown bot, an empty scope or a group that mixes modes.
pub fn scope_bots<'a>(p: &'a Published, scope: &ScopeRef) -> Result<Vec<&'a BotRow>, ScopeError> {
    let rows: Vec<&BotRow> = match scope {
        ScopeRef::Mode(m) => p.bots.values().filter(|r| r.identity.mode == *m).collect(),
        ScopeRef::Bot(k) => vec![p.bots.get(k).ok_or(ScopeError::UnknownBot)?],
        ScopeRef::Bots(keys) => keys
            .iter()
            .map(|k| p.bots.get(k).ok_or(ScopeError::UnknownBot))
            .collect::<Result<_, _>>()?,
    };
    if rows.is_empty() {
        return Err(ScopeError::Empty);
    }
    let first = rows[0].identity.mode;
    if rows.iter().any(|r| r.identity.mode != first) {
        return Err(ScopeError::MixedModes);
    }
    Ok(rows)
}

fn data_of<'a>(p: &'a Published, rows: &[&BotRow]) -> Vec<&'a BotData> {
    rows.iter().filter_map(|r| p.data.get(&r.bot_key)).collect()
}

/// Calendar buckets of realized profit (days, weeks, months of the zone `tz`).
///
/// # Errors
/// See [`scope_bots`].
pub fn pnl_calendar(
    p: &Published,
    scope: &ScopeRef,
    unit: PeriodUnit,
    tz: Tz,
    now_ms: i64,
    n: usize,
) -> Result<Vec<PnlBucket>, ScopeError> {
    let rows = scope_bots(p, scope)?;
    let trades: Vec<ClosedPnl> = data_of(p, &rows)
        .iter()
        .flat_map(|d| d.derived.pnl.iter().copied())
        .collect();
    Ok(pnl_periods(&trades, unit, tz, now_ms, n))
}

/// Drawdown of a scope: both definitions, from every closed trade, the profit curves and the
/// open positions.
///
/// # Errors
/// See [`scope_bots`].
pub fn drawdown(
    p: &Published,
    scope: &ScopeRef,
    now_ms: i64,
) -> Result<DrawdownResult, ScopeError> {
    let rows = scope_bots(p, scope)?;
    let data = data_of(p, &rows);
    let capitals: Vec<Option<f64>> = rows.iter().map(|r| r.metrics.starting_capital).collect();
    let cap = fg_core::calc::capital::sum_starting_capital(&capitals);
    let keys: BTreeSet<&BotKey> = rows.iter().map(|r| &r.bot_key).collect();
    let open: Vec<OpenRisk> = p
        .positions
        .values()
        .filter(|pos| keys.contains(&pos.bot_key))
        .filter_map(|pos| {
            Some(OpenRisk {
                profit_abs: pos.profit_abs?,
                amount: pos.amount,
                open_rate: pos.open_rate,
                current_rate: pos.current_rate,
                is_short: pos.side == Side::Short,
                min_rate: None,
                max_rate: None,
            })
        })
        .collect();
    Ok(fg_core::calc::drawdown::compute(&DrawdownInput {
        closed: data
            .iter()
            .flat_map(|d| d.derived.pnl.iter().copied())
            .collect(),
        open,
        histories: data.iter().map(|d| d.profit.as_ref().clone()).collect(),
        history_trades: data.iter().map(|d| d.derived.pnl.clone()).collect(),
        starting_capital: (cap.known > 0).then_some(cap.total),
        now_ms,
    }))
}

/// Which curve to draw.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EquityMode {
    /// Cumulative closed profit.
    Realized,
    /// Closed profit plus the latent profit of the open positions.
    WithOpen,
}

/// A point of an equity curve.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct EquityPoint {
    pub ts_ms: i64,
    pub value: f64,
}

/// An equity curve decimated to at most `points` points (the last point is always kept).
///
/// # Errors
/// See [`scope_bots`].
pub fn equity(
    p: &Published,
    scope: &ScopeRef,
    from_ms: i64,
    points: usize,
    mode: EquityMode,
) -> Result<Vec<EquityPoint>, ScopeError> {
    let rows = scope_bots(p, scope)?;
    let data = data_of(p, &rows);
    let raw: Vec<(i64, f64)> = match mode {
        EquityMode::Realized => {
            let mut all: Vec<ClosedPnl> = data
                .iter()
                .flat_map(|d| d.derived.pnl.iter().copied())
                .collect();
            all.sort_by_key(|c| c.ts_ms);
            let mut acc = 0.0;
            all.iter()
                .map(|c| {
                    acc += c.profit_abs;
                    (c.ts_ms, acc)
                })
                .collect()
        }
        EquityMode::WithOpen => {
            let series: Vec<Vec<HistorySample>> =
                data.iter().map(|d| d.profit.as_ref().clone()).collect();
            fg_core::calc::drawdown::merge_histories(&series)
        }
    };
    let visible: Vec<(i64, f64)> = raw.into_iter().filter(|(t, _)| *t >= from_ms).collect();
    Ok(decimate(&visible, points)
        .into_iter()
        .map(|(ts_ms, value)| EquityPoint { ts_ms, value })
        .collect())
}

/// Keep at most `n` points evenly spread, always including the first and the last.
#[must_use]
pub fn decimate(points: &[(i64, f64)], n: usize) -> Vec<(i64, f64)> {
    if n < 2 || points.len() <= n {
        return points.to_vec();
    }
    let step = (points.len() - 1) as f64 / (n - 1) as f64;
    let mut out: Vec<(i64, f64)> = (0..n)
        .map(|i| points[((i as f64 * step).round() as usize).min(points.len() - 1)])
        .collect();
    out.dedup_by_key(|p| p.0);
    out
}

/// One line of the leaderboard.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LeaderRow {
    pub bot_key: BotKey,
    pub name: String,
    pub profit_abs: f64,
    pub trades: u32,
}

/// Bots of a mode ranked by realized profit over a period.
///
/// # Errors
/// See [`scope_bots`].
pub fn leaderboard(
    p: &Published,
    mode: BotMode,
    period: PeriodKey,
    tz: Tz,
    now_ms: i64,
) -> Result<Vec<LeaderRow>, ScopeError> {
    let rows = scope_bots(p, &ScopeRef::Mode(mode))?;
    let cutoff = period_cutoff_ms(period, now_ms, tz);
    let mut out: Vec<LeaderRow> = rows
        .iter()
        .filter_map(|r| {
            let d = p.data.get(&r.bot_key)?;
            let idx = d.derived.pnl.partition_point(|c| c.ts_ms < cutoff);
            Some(LeaderRow {
                bot_key: r.bot_key.clone(),
                name: r.identity.name.clone(),
                profit_abs: d.derived.profit_since(cutoff),
                trades: u32::try_from(d.derived.pnl.len() - idx).unwrap_or(u32::MAX),
            })
        })
        .collect();
    out.sort_by(|a, b| b.profit_abs.total_cmp(&a.profit_abs));
    Ok(out)
}

/// An order of a trade, as shown in the trade drawer (entries, DCA fills, exits).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OrderRow {
    pub id: i64,
    /// `buy`, `sell` or `stoploss`.
    pub side: String,
    /// Whether the order opens or adds to the position; `None` when the trade is unknown.
    pub is_entry: Option<bool>,
    pub status: Option<String>,
    pub is_open: bool,
    pub filled: Option<f64>,
    pub amount: Option<f64>,
    pub average: Option<f64>,
    pub cost: Option<f64>,
    pub filled_ms: Option<i64>,
    pub tag: Option<String>,
}

/// Sort key of the journal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum JournalSort {
    #[default]
    CloseDate,
    OpenDate,
    Profit,
}

/// Filters of the trade journal. Every field is optional.
#[derive(Debug, Clone, Default)]
pub struct JournalQuery {
    pub bots: Option<Vec<BotKey>>,
    pub mode: Option<BotMode>,
    /// Case-insensitive substring of the pair.
    pub pair: Option<String>,
    pub side: Option<Side>,
    /// Raw `exit_reason` (case-insensitive equality); `unknown` selects trades without one.
    pub exit_reason: Option<String>,
    /// Closed at or after.
    pub from_ms: Option<i64>,
    /// Closed before.
    pub to_ms: Option<i64>,
    pub sort: JournalSort,
    pub descending: bool,
    /// Opaque cursor of the previous page.
    pub cursor: Option<String>,
    pub limit: usize,
}

/// A page of the journal, with the totals of everything the filters select.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct JournalPage {
    pub rows: Vec<TradeRow>,
    pub next_cursor: Option<String>,
    pub matched: u32,
    pub totals: TradeTotals,
}

/// A closed trade with the bot it belongs to, while the journal is filtered and sorted.
type Entry<'a> = (&'a BotKey, BotMode, &'a ClosedTrade);

fn sort_value(t: &ClosedTrade, sort: JournalSort) -> f64 {
    match sort {
        JournalSort::CloseDate => t.close_ms().unwrap_or(0) as f64,
        JournalSort::OpenDate => t.open_ms as f64,
        JournalSort::Profit => t.profit_abs().unwrap_or(f64::NEG_INFINITY),
    }
}

fn encode_cursor(value: f64, bot: &BotKey, id: i64) -> String {
    format!("{:016x}|{bot}|{id}", value.to_bits())
}

fn decode_cursor(c: &str) -> Option<(f64, BotKey, i64)> {
    let mut it = c.splitn(3, '|');
    let bits = u64::from_str_radix(it.next()?, 16).ok()?;
    let bot = it.next()?.parse().ok()?;
    let id = it.next()?.parse().ok()?;
    Some((f64::from_bits(bits), bot, id))
}

/// The paginated journal of closed trades (keyset pagination on `(sort value, bot, trade id)`:
/// stable while new trades close, unlike an offset).
#[must_use]
pub fn journal(p: &Published, q: &JournalQuery) -> JournalPage {
    let pair = q.pair.as_ref().map(|s| s.to_ascii_lowercase());
    let reason = q.exit_reason.as_ref().map(|s| s.to_ascii_lowercase());
    let bots: Option<BTreeSet<&BotKey>> = q.bots.as_ref().map(|b| b.iter().collect());
    // Pairs and exit reasons are interned: each distinct string is tested once, not once per row.
    let mut pair_ok: HashMap<u32, bool> = HashMap::new();
    let mut reason_ok: HashMap<u32, bool> = HashMap::new();
    let mut rows: Vec<Entry<'_>> = Vec::new();
    for (key, data) in p.data.iter() {
        if bots.as_ref().is_some_and(|b| !b.contains(key)) {
            continue;
        }
        if q.mode.is_some_and(|m| m != data.mode) {
            continue;
        }
        for t in data.closed.iter() {
            if q.side.is_some_and(|s| s != t.side)
                || q.from_ms
                    .is_some_and(|f| t.close_ms().is_none_or(|c| c < f))
                || q.to_ms.is_some_and(|f| t.close_ms().is_none_or(|c| c >= f))
            {
                continue;
            }
            if let Some(want) = &pair
                && !*pair_ok
                    .entry(t.pair_id())
                    .or_insert_with(|| t.pair().to_ascii_lowercase().contains(want.as_str()))
            {
                continue;
            }
            if let Some(want) = &reason
                && !*reason_ok.entry(t.exit_id()).or_insert_with(|| {
                    let raw = crate::closed::strings()
                        .resolve(t.exit_id())
                        .to_ascii_lowercase();
                    if want == "unknown" {
                        raw.is_empty()
                    } else {
                        raw == *want
                    }
                })
            {
                continue;
            }
            rows.push((key, data.mode, t));
        }
    }
    let totals = trade_totals(
        &rows
            .iter()
            .map(|(_, _, t)| t.profit_abs())
            .collect::<Vec<_>>(),
    );
    let matched = u32::try_from(rows.len()).unwrap_or(u32::MAX);
    let sort = q.sort;
    let cmp = |a: &Entry<'_>, b: &Entry<'_>| {
        sort_value(a.2, sort)
            .total_cmp(&sort_value(b.2, sort))
            .then_with(|| a.0.cmp(b.0))
            .then_with(|| a.2.trade_id.cmp(&b.2.trade_id))
    };
    rows.sort_by(|a, b| if q.descending { cmp(b, a) } else { cmp(a, b) });
    if let Some((v, bot, id)) = q.cursor.as_deref().and_then(decode_cursor) {
        let after = |e: &Entry<'_>| {
            let ord = sort_value(e.2, sort)
                .total_cmp(&v)
                .then_with(|| e.0.cmp(&bot))
                .then_with(|| e.2.trade_id.cmp(&id));
            if q.descending {
                ord.is_lt()
            } else {
                ord.is_gt()
            }
        };
        let skip = rows.iter().position(after).unwrap_or(rows.len());
        rows.drain(..skip);
    }
    let limit = if q.limit == 0 { 50 } else { q.limit.min(500) };
    let more = rows.len() > limit;
    rows.truncate(limit);
    let next_cursor = more
        .then(|| rows.last())
        .flatten()
        .map(|(k, _, t)| encode_cursor(sort_value(t, sort), k, t.trade_id));
    JournalPage {
        rows: rows
            .into_iter()
            .map(|(k, mode, t)| t.to_row(k, mode))
            .collect(),
        next_cursor,
        matched,
        totals,
    }
}

/// Convenience: both drawdown definitions of a scope as `(realized, with_open)` absolute values.
#[must_use]
pub fn drawdown_abs(r: &DrawdownResult, def: DrawdownDef) -> f64 {
    r.get(def).abs
}
