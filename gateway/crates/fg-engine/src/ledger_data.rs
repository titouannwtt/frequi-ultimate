//! What the engine keeps of a bot ledger: open trades, the closed history and the sampled
//! profit curve, plus the figures derived from them once per change instead of once per tick.

use std::collections::HashMap;
use std::sync::Arc;

use fg_core::calc::drawdown::{ClosedPnl, HistorySample};
use fg_core::calc::duration::median_duration_ms;
use fg_core::calc::stats::{TradeTotals, trade_totals};
use fg_core::identity::BotKey;
use fg_core::model::BotMode;
use fg_sources::sqlite::{LedgerErrorCode, LedgerSummary, LedgerTrade, ProfitChunk, ProfitSample};

use crate::closed::ClosedTrade;
use crate::meta::BotMeta;

const MINUTE_MS: i64 = 60_000;
const HOUR_MS: i64 = 3_600_000;
const DAY_MS: i64 = 24 * HOUR_MS;
/// Profit samples older than one day are thinned to one per bucket of this width.
const OLD_SAMPLE_BUCKET_MS: i64 = 15 * MINUTE_MS;
/// Profit samples older than this are dropped.
const SAMPLE_RETENTION_MS: i64 = 180 * DAY_MS;

/// Figures computed from the closed trades, rebuilt when they change.
#[derive(Debug, Clone, Default)]
pub struct ClosedDerived {
    /// Closed trades with a known profit, sorted by close time.
    pub pnl: Vec<ClosedPnl>,
    /// `cum[i]` = sum of `pnl[..=i]`, so a sum over a time suffix costs one binary search.
    pub cum: Vec<f64>,
    /// Positive durations, sorted, for percentile ranks by binary search.
    pub durations_sorted: Vec<i64>,
    pub median_ms: Option<i64>,
    pub totals: Option<TradeTotals>,
    pub last_close_ms: Option<i64>,
}

impl ClosedDerived {
    #[must_use]
    pub fn build(closed: &[ClosedTrade]) -> Self {
        let mut pnl: Vec<ClosedPnl> = closed
            .iter()
            .filter_map(|t| {
                Some(ClosedPnl {
                    ts_ms: t.close_ms()?,
                    profit_abs: t.profit_abs().filter(|p| p.is_finite())?,
                })
            })
            .collect();
        pnl.sort_by_key(|p| p.ts_ms);
        let mut acc = 0.0;
        let cum = pnl
            .iter()
            .map(|p| {
                acc += p.profit_abs;
                acc
            })
            .collect();
        let mut durations: Vec<i64> = closed
            .iter()
            .filter_map(|t| Some(t.close_ms()? - t.open_ms))
            .filter(|d| *d > 0)
            .collect();
        durations.sort_unstable();
        let profits: Vec<Option<f64>> = closed.iter().map(ClosedTrade::profit_abs).collect();
        Self {
            median_ms: median_duration_ms(&durations),
            totals: (!closed.is_empty()).then(|| trade_totals(&profits)),
            last_close_ms: closed.iter().filter_map(ClosedTrade::close_ms).max(),
            pnl,
            cum,
            durations_sorted: durations,
        }
    }

    /// Sum of the profits closed at or after `cutoff_ms`.
    #[must_use]
    pub fn profit_since(&self, cutoff_ms: i64) -> f64 {
        let idx = self.pnl.partition_point(|p| p.ts_ms < cutoff_ms);
        let total = self.cum.last().copied().unwrap_or(0.0);
        if idx == 0 {
            total
        } else {
            total - self.cum[idx - 1]
        }
    }

    /// Rank (0-100) of `ms` among the closed durations: same definition as
    /// `fg_core::calc::duration::percentile_rank`, by binary search. `None` below 3 samples.
    #[must_use]
    pub fn percentile(&self, ms: i64) -> Option<u8> {
        let n = self.durations_sorted.len();
        if n < fg_core::calc::duration::MIN_SAMPLES {
            return None;
        }
        let below = self.durations_sorted.partition_point(|d| *d <= ms);
        let pct = (below as f64 / n as f64 * 100.0).round();
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        Some(pct as u8)
    }
}

/// How the closed trades of a read relate to what is already known.
#[derive(Debug, Clone, PartialEq)]
pub enum ClosedUpdate {
    /// Nothing changed in the closed history.
    None,
    /// The complete closed history: replaces what is known.
    Full(Vec<LedgerTrade>),
    /// Trades closed (or edited) recently: merged by id.
    Upsert(Vec<LedgerTrade>),
}

/// One complete read of a changed ledger.
#[derive(Debug, Clone, PartialEq)]
pub struct LedgerRead {
    pub summary: LedgerSummary,
    pub open: Vec<LedgerTrade>,
    /// Filled entry orders per open trade id.
    pub entries: HashMap<i64, u32>,
    pub closed: ClosedUpdate,
    pub profit: Option<ProfitChunk>,
}

/// Events the ledger task sends to the core.
#[derive(Debug, Clone, PartialEq)]
pub enum LedgerEvent {
    /// The ledger was inspected and has not changed.
    Alive,
    Error(LedgerErrorCode),
    Read(Box<LedgerRead>),
}

/// The ledger side of a bot's runtime state.
#[derive(Debug, Clone, Default)]
pub struct LedgerData {
    /// Last time the ledger was successfully inspected (stat or read).
    pub alive_ms: Option<i64>,
    pub error: Option<LedgerErrorCode>,
    pub summary: Option<LedgerSummary>,
    pub open: Vec<LedgerTrade>,
    pub entries: HashMap<i64, u32>,
    /// Sorted by trade id; copy-on-write so that published snapshots stay immutable.
    pub closed: Arc<Vec<ClosedTrade>>,
    pub derived: Arc<ClosedDerived>,
    pub profit: Arc<Vec<HistorySample>>,
    /// Increases whenever closed trades or the profit curve change.
    pub version: u64,
}

impl LedgerData {
    /// `true` once a complete read happened and nothing has failed since.
    #[must_use]
    pub fn usable(&self) -> bool {
        self.summary.is_some() && self.error.is_none()
    }

    pub fn apply(&mut self, meta: &BotMeta, now_ms: i64, ev: LedgerEvent, max_closed: usize) {
        match ev {
            LedgerEvent::Alive => {
                self.alive_ms = Some(now_ms);
                self.error = None;
            }
            LedgerEvent::Error(code) => {
                self.error = Some(code);
            }
            LedgerEvent::Read(read) => {
                self.alive_ms = Some(now_ms);
                self.error = None;
                self.summary = Some(read.summary);
                self.open = read.open;
                self.entries = read.entries;
                let mut changed = false;
                match read.closed {
                    ClosedUpdate::None => {}
                    ClosedUpdate::Full(rows) => {
                        let dexes = meta.dexes();
                        let v: Vec<ClosedTrade> = rows
                            .iter()
                            .map(|t| ClosedTrade::from_ledger(&dexes, t))
                            .collect();
                        self.closed = Arc::new(v);
                        changed = true;
                    }
                    ClosedUpdate::Upsert(rows) => {
                        let dexes = meta.dexes();
                        let v = Arc::make_mut(&mut self.closed);
                        for t in &rows {
                            let row = ClosedTrade::from_ledger(&dexes, t);
                            match v.binary_search_by_key(&row.trade_id, |r| r.trade_id) {
                                Ok(i) => v[i] = row,
                                Err(i) => v.insert(i, row),
                            }
                        }
                        changed |= !rows.is_empty();
                    }
                }
                if self.closed.len() > max_closed {
                    let v = Arc::make_mut(&mut self.closed);
                    let excess = v.len() - max_closed;
                    v.drain(..excess);
                    changed = true;
                }
                // An empty page (the cursor is at the end of the table) changes nothing: copying
                // the curve and rebuilding the derived arrays on every ledger change was most of
                // the engine's work (B49).
                if let Some(chunk) = read.profit.filter(|c| c.reset || !c.samples.is_empty()) {
                    let v = Arc::make_mut(&mut self.profit);
                    if chunk.reset {
                        v.clear();
                    }
                    v.extend(chunk.samples.iter().map(sample_of));
                    compact_profit(v, now_ms);
                    changed = true;
                }
                if changed {
                    self.derived = Arc::new(ClosedDerived::build(&self.closed));
                    self.version += 1;
                }
            }
        }
    }
}

fn sample_of(s: &ProfitSample) -> HistorySample {
    HistorySample {
        ts_ms: s.ts_ms,
        closed: s.closed_abs,
        open: s.open_abs,
    }
}

/// Thin the old part of a profit curve: the last day stays at full resolution, older samples keep
/// one point per quarter hour (the last of each), and anything beyond the retention is dropped.
/// A drawdown read from the thinned curve can miss a dip shorter than a quarter hour that happened
/// more than a day ago; the realized definition is computed from every closed trade and is exact.
pub fn compact_profit(v: &mut Vec<HistorySample>, now_ms: i64) {
    if v.len() < 600 {
        return;
    }
    let recent_from = now_ms - DAY_MS;
    let oldest = now_ms - SAMPLE_RETENTION_MS;
    let mut out: Vec<HistorySample> = Vec::with_capacity(v.len());
    let mut last_bucket: Option<i64> = None;
    for s in v.drain(..) {
        if s.ts_ms < oldest {
            continue;
        }
        if s.ts_ms >= recent_from {
            out.push(s);
            continue;
        }
        let bucket = s.ts_ms.div_euclid(OLD_SAMPLE_BUCKET_MS);
        if last_bucket == Some(bucket) {
            if let Some(last) = out.last_mut() {
                *last = s;
            }
        } else {
            last_bucket = Some(bucket);
            out.push(s);
        }
    }
    out.shrink_to_fit();
    *v = out;
}

/// 24 hourly samples of the latent profit, oldest first: for every hour mark of the last day the
/// most recent sample at or before it. Hours before the first sample are left out.
#[must_use]
pub fn spark24h(samples: &[HistorySample], now_ms: i64) -> Vec<f64> {
    if samples.is_empty() {
        return Vec::new();
    }
    (0..24)
        .rev()
        .filter_map(|h| {
            let mark = now_ms - h * HOUR_MS;
            let idx = samples.partition_point(|s| s.ts_ms <= mark);
            (idx > 0).then(|| samples[idx - 1].open)
        })
        .collect()
}

/// Key of the trade row in published structures.
#[must_use]
pub fn trade_key(bot: &BotKey, trade_id: i64) -> String {
    format!("{bot}/{trade_id}")
}

/// Mode label used as the key of a [`fg_core::model::ScopeTotals`] entity.
#[must_use]
pub fn mode_scope(mode: BotMode) -> &'static str {
    match mode {
        BotMode::Live => "live",
        BotMode::Dry => "dry",
        BotMode::Replay => "replay",
    }
}

#[cfg(test)]
mod tests {
    use fg_core::calc::duration::percentile_rank;

    use super::*;

    fn closed(meta: &BotMeta, t: &LedgerTrade) -> ClosedTrade {
        ClosedTrade::from_ledger(&meta.dexes(), t)
    }

    fn lt(id: i64, close: Option<i64>, profit: Option<f64>, open: i64) -> LedgerTrade {
        LedgerTrade {
            id,
            pair: "BTC/USDC:USDC".into(),
            is_short: false,
            is_open: close.is_none(),
            amount: 1.0,
            stake_amount: 10.0,
            open_rate: 100.0,
            close_rate: close.map(|_| 101.0),
            leverage: 2.0,
            open_ms: Some(open),
            close_ms: close,
            profit_abs: profit,
            profit_ratio: None,
            profit_unknown: close.is_some() && profit.is_none(),
            exit_reason: None,
            enter_tag: None,
            stop_loss: None,
            initial_stop_loss: None,
            liquidation_price: None,
            funding_fees: None,
            realized_profit: None,
            strategy: None,
        }
    }

    fn meta() -> BotMeta {
        BotMeta {
            key: BotKey::Local(9056),
            name: "a".into(),
            mode: BotMode::Dry,
            strategy: None,
            exchange: None,
            stake_currency: "USDC".into(),
            port: Some(9056),
            db_path: None,
            read_ledger: true,
            wallet_id: None,
            address_short: None,
            available_capital: None,
            capital_withdrawal: 0.0,
            max_open_trades: None,
            hip3_dexes: vec![],
            incarnation: "x".into(),
            started_ms: None,
            scanned_ms: 0,
        }
    }

    #[test]
    fn profit_since_uses_the_prefix_sums_and_matches_a_naive_filter() {
        let rows: Vec<ClosedTrade> = (0..50)
            .map(|i| {
                closed(
                    &meta(),
                    &lt(i, Some(1_000 + i * 10), Some((i % 7) as f64 - 3.0), 0),
                )
            })
            .collect();
        let d = ClosedDerived::build(&rows);
        for cutoff in [0, 1_000, 1_005, 1_250, 1_490, 1_491, 9_999] {
            let naive: f64 = d
                .pnl
                .iter()
                .filter(|p| p.ts_ms >= cutoff)
                .map(|p| p.profit_abs)
                .sum();
            assert!(
                (d.profit_since(cutoff) - naive).abs() < 1e-9,
                "cutoff {cutoff}"
            );
        }
    }

    #[test]
    fn percentile_by_binary_search_equals_the_core_definition() {
        let rows: Vec<ClosedTrade> = (1..40)
            .map(|i| {
                closed(
                    &meta(),
                    &lt(i, Some(10_000 + i * 997), Some(1.0), 10_000 - (i % 5) * 400),
                )
            })
            .collect();
        let d = ClosedDerived::build(&rows);
        for ms in [0, 1, 500, 900, 1_000, 5_000, 40_000, 1_000_000] {
            assert_eq!(
                d.percentile(ms),
                percentile_rank(&d.durations_sorted, ms),
                "ms {ms}"
            );
        }
        let few = ClosedDerived::build(&rows[..2]);
        assert_eq!(few.percentile(1_000), None);
    }

    #[test]
    fn unknown_profits_are_counted_apart_and_never_summed() {
        let rows = vec![
            closed(&meta(), &lt(1, Some(10), Some(5.0), 0)),
            closed(&meta(), &lt(2, Some(20), None, 0)),
        ];
        let d = ClosedDerived::build(&rows);
        assert_eq!(d.pnl.len(), 1);
        let t = d.totals.unwrap();
        assert_eq!((t.count, t.unknown), (1, 1));
    }

    #[test]
    fn upsert_merges_by_id_and_full_replaces() {
        let m = meta();
        let mut data = LedgerData::default();
        let read = |closed| {
            LedgerEvent::Read(Box::new(LedgerRead {
                summary: LedgerSummary::default(),
                open: vec![],
                entries: HashMap::new(),
                closed,
                profit: None,
            }))
        };
        data.apply(
            &m,
            1,
            read(ClosedUpdate::Full(vec![
                lt(1, Some(5), Some(1.0), 0),
                lt(3, Some(7), Some(2.0), 0),
            ])),
            100,
        );
        assert_eq!(
            data.closed.iter().map(|t| t.trade_id).collect::<Vec<_>>(),
            [1, 3]
        );
        let v1 = data.version;
        data.apply(
            &m,
            2,
            read(ClosedUpdate::Upsert(vec![
                lt(2, Some(6), Some(9.0), 0),
                lt(3, Some(7), Some(4.0), 0),
            ])),
            100,
        );
        assert_eq!(
            data.closed.iter().map(|t| t.trade_id).collect::<Vec<_>>(),
            [1, 2, 3]
        );
        assert_eq!(data.closed[2].profit_abs(), Some(4.0));
        assert!(data.version > v1);
        // Nothing changed: the version holds still.
        let v2 = data.version;
        data.apply(&m, 3, read(ClosedUpdate::None), 100);
        assert_eq!(data.version, v2);
        // The cap keeps the most recent ids.
        data.apply(
            &m,
            4,
            read(ClosedUpdate::Full(
                (1..=10).map(|i| lt(i, Some(i), Some(1.0), 0)).collect(),
            )),
            4,
        );
        assert_eq!(
            data.closed.iter().map(|t| t.trade_id).collect::<Vec<_>>(),
            [7, 8, 9, 10]
        );
    }

    #[test]
    fn an_empty_profit_page_leaves_the_derived_figures_and_the_version_alone() {
        let m = meta();
        let mut data = LedgerData::default();
        let read = |profit: Option<ProfitChunk>| {
            LedgerEvent::Read(Box::new(LedgerRead {
                summary: LedgerSummary::default(),
                open: vec![],
                entries: HashMap::new(),
                closed: ClosedUpdate::None,
                profit,
            }))
        };
        let chunk = |samples: Vec<ProfitSample>, reset: bool| ProfitChunk {
            samples,
            max_rowid: 3,
            reset,
            truncated: false,
        };
        let sample = |rowid: i64, ts: i64| ProfitSample {
            rowid,
            ts_ms: ts,
            closed_abs: 1.0,
            open_abs: 0.0,
            open_trades: 0,
        };
        data.apply(
            &m,
            1,
            read(Some(chunk(vec![sample(1, 10), sample(2, 20)], false))),
            100,
        );
        let (v, derived) = (data.version, Arc::as_ptr(&data.derived));
        data.apply(&m, 2, read(Some(chunk(vec![], false))), 100);
        assert_eq!(data.version, v, "nothing new in the curve");
        assert_eq!(
            Arc::as_ptr(&data.derived),
            derived,
            "derived figures not rebuilt"
        );
        assert_eq!(data.profit.len(), 2);
        // A reset with no sample is a change: the curve was emptied.
        data.apply(&m, 3, read(Some(chunk(vec![], true))), 100);
        assert!(data.version > v && data.profit.is_empty());
    }

    #[test]
    fn old_profit_samples_are_thinned_and_recent_ones_kept() {
        let now = 400 * DAY_MS;
        let mut v: Vec<HistorySample> = (0..3_000)
            .map(|i| HistorySample {
                ts_ms: now - 10 * DAY_MS + i * 5 * MINUTE_MS,
                closed: i as f64,
                open: 0.0,
            })
            .collect();
        let last = v.last().copied();
        compact_profit(&mut v, now);
        assert!(v.len() < 3_000);
        assert_eq!(v.last().copied(), last);
        // The last day is intact: 288 samples of 5 minutes.
        let recent = v.iter().filter(|s| s.ts_ms >= now - DAY_MS).count();
        assert!(recent >= 280, "{recent}");
        // Order is preserved.
        assert!(v.windows(2).all(|w| w[0].ts_ms < w[1].ts_ms));
        // Samples beyond the retention disappear.
        let mut old = vec![
            HistorySample {
                ts_ms: now - 200 * DAY_MS,
                closed: 1.0,
                open: 0.0
            };
            700
        ];
        compact_profit(&mut old, now);
        assert!(old.is_empty());
    }

    #[test]
    fn spark_picks_the_latest_sample_at_or_before_each_hour_mark() {
        let now = 100 * HOUR_MS;
        let samples: Vec<HistorySample> = (0..30)
            .map(|h| HistorySample {
                ts_ms: now - (30 - h) * HOUR_MS + 1,
                closed: 0.0,
                open: h as f64,
            })
            .collect();
        let s = spark24h(&samples, now);
        assert_eq!(s.len(), 24);
        assert_eq!(*s.last().unwrap(), 29.0);
        assert!(s.windows(2).all(|w| w[0] < w[1]));
        assert!(spark24h(&[], now).is_empty());
    }
}
