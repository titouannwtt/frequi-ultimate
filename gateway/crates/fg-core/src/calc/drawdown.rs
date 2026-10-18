//! Drawdown: two named definitions, absolute first.
//!
//! * **Realized** (`réalisé`): equity = cumulative profit of the closed trades, ordered by close
//!   time, starting from the starting capital (cumulative profit 0). The high-water mark starts at
//!   the starting capital, so a bot that loses from its first trade has a drawdown from day one.
//!   Open positions are ignored.
//! * **With open** (`avec latent`, open-inclusive): the deepest peak-to-trough decline of the
//!   realized-plus-latent curve, extended by the open positions at the worst point they reached
//!   (`min_rate` for longs, `max_rate` for shorts). The curve is the sampled `profit_history`
//!   when available (so past open books that are now closed still count), prepended with the
//!   realized points that predate the first sample, otherwise the realized curve alone.
//!   The final "now" point continues that curve: per bot, the closed part is the last sample's
//!   `closed` plus the trades closed strictly after that sample, and the open part is the open
//!   positions at their worst point. It never restarts from the cumulative closed trades, which can
//!   sit on another base than `profit_history` (seeded dry bot, DB reset keeping the history,
//!   deleted trades): mixing the two fabricated a one-step drop (B280).
//!
//! The percentage is a ratio of `starting capital + realized peak` (the account value at the
//! peak, freqtrade's denominator) and is `None` when the starting capital is unknown. The
//! absolute value is always available and is the figure to compare across bots: a percentage
//! confuses risk and profit.
//!
//! Port of `utils/maxDrawdown.ts` and the corrections documented in `BotMaxDrawdownCard.vue`.
//! Differences from the TypeScript: the realized value is computed from the trades instead of
//! being read from `/profit` (one definition instead of two that disagreed on the high-water
//! mark), histories are merged only from their first common timestamp and empty histories no
//! longer crash the merge.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Which definition to read from a [`DrawdownResult`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum DrawdownDef {
    Realized,
    WithOpen,
}

/// A closed trade reduced to what the drawdown needs. Trades with unknown profit must be left out
/// by the caller (and counted apart).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
pub struct ClosedPnl {
    pub ts_ms: i64,
    pub profit_abs: f64,
}

/// An open position reduced to what its worst point needs.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
pub struct OpenRisk {
    pub profit_abs: f64,
    /// Contract amount (already includes leverage).
    pub amount: f64,
    pub open_rate: f64,
    pub current_rate: Option<f64>,
    pub is_short: bool,
    pub min_rate: Option<f64>,
    pub max_rate: Option<f64>,
}

/// A `profit_history` sample: cumulative closed profit and latent profit at `ts_ms`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
pub struct HistorySample {
    pub ts_ms: i64,
    pub closed: f64,
    pub open: f64,
    /// Open positions the bot counted when it wrote the sample (`None`: the source does not say).
    /// Lets [`merge_histories`] spot a sample written while some prices were missing (B600).
    #[serde(default)]
    #[ts(optional)]
    pub open_trades: Option<u32>,
}

/// Inputs of [`compute`]. `histories` holds one series per bot (several for a group or the fleet).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(default)]
pub struct DrawdownInput {
    pub closed: Vec<ClosedPnl>,
    pub open: Vec<OpenRisk>,
    pub histories: Vec<Vec<HistorySample>>,
    /// Closed trades of each bot, index-aligned with `histories` (same length), used to anchor
    /// the final point on each bot's last sample. When empty and `histories` holds a single
    /// series, `closed` is that bot's trades. Otherwise the final point falls back to the
    /// cumulative closed trades.
    pub history_trades: Vec<Vec<ClosedPnl>>,
    /// Starting capital of the scope (sum of the bots' own capitals), when known.
    pub starting_capital: Option<f64>,
    pub now_ms: i64,
}

/// One drawdown figure.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
pub struct DrawdownValue {
    /// Deepest decline, in stake currency (>= 0).
    pub abs: f64,
    /// `abs` over the account value at the realized peak; `None` without a starting capital.
    pub pct: Option<f64>,
    /// When the deepest decline started (`None`: from the starting capital).
    pub peak_ms: Option<i64>,
    /// When the deepest decline bottomed out.
    pub trough_ms: Option<i64>,
    /// Current distance below the high-water mark (>= 0).
    pub current_abs: f64,
}

/// Both definitions side by side.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
pub struct DrawdownResult {
    pub realized: DrawdownValue,
    pub with_open: DrawdownValue,
    /// Sum of the open positions' worst unrealized profit (negative: a loss).
    pub open_worst_sum: f64,
    pub has_open: bool,
    /// Ratio denominator: starting capital plus realized peak.
    pub base: Option<f64>,
}

impl DrawdownResult {
    #[must_use]
    pub fn get(&self, def: DrawdownDef) -> &DrawdownValue {
        match def {
            DrawdownDef::Realized => &self.realized,
            DrawdownDef::WithOpen => &self.with_open,
        }
    }
}

/// Worst unrealized profit an open position reached. `profit_abs` already includes fees and
/// funding at the current rate; it is extended by the price move from the current rate to the
/// extreme, through the contract amount.
#[must_use]
pub fn open_worst_abs(t: &OpenRisk) -> f64 {
    let cur = t.current_rate.unwrap_or(t.open_rate);
    if cur == 0.0 || t.amount == 0.0 {
        return t.profit_abs;
    }
    if t.is_short {
        let hi = t.max_rate.unwrap_or(cur);
        t.profit_abs - t.amount * (hi - cur).max(0.0)
    } else {
        let lo = t.min_rate.unwrap_or(cur);
        t.profit_abs + t.amount * (lo - cur).min(0.0)
    }
}

/// Result of walking an equity curve.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Walk {
    pub max_abs: f64,
    pub peak_ms: Option<i64>,
    pub trough_ms: Option<i64>,
    pub current_abs: f64,
    /// Highest value reached (at least 0, the starting capital).
    pub peak_value: f64,
}

/// Maximum drawdown of a curve of `(ts_ms, cumulative profit)` points ordered by time. The
/// high-water mark starts at 0 (the starting capital).
#[must_use]
pub fn walk(points: &[(i64, f64)]) -> Walk {
    let mut peak = 0.0_f64;
    let mut peak_ts: Option<i64> = None;
    let mut best = 0.0_f64;
    let mut best_peak: Option<i64> = None;
    let mut best_trough: Option<i64> = None;
    for &(t, v) in points {
        if v > peak {
            peak = v;
            peak_ts = Some(t);
        }
        let dd = peak - v;
        if dd > best {
            best = dd;
            best_peak = peak_ts;
            best_trough = Some(t);
        }
    }
    let last = points.last().map_or(0.0, |p| p.1);
    Walk {
        max_abs: best,
        peak_ms: best_peak,
        trough_ms: best_trough,
        current_abs: (peak - last).max(0.0),
        peak_value: peak,
    }
}

/// Longest stretch of time a run of samples can be treated as one incomplete reading. A bot that
/// struggles with the exchange writes unpriced samples for hours, and further apart than every
/// 5 minutes (11 samples over 5 hours for hippo on 2026-10-16): the bound is on time, not on a
/// number of samples.
const MAX_PARTIAL_SPAN_MS: i64 = 12 * 3_600_000;

fn same_closed(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-6
}

/// Drop the samples a bot wrote while it could not price some of its open positions.
///
/// The bot sums the latent profit of the positions it manages to price and silently leaves out
/// the others (restart, exchange hiccup): the sample then holds fewer open positions than the
/// samples around it and a latent profit that is missing their share, down to exactly 0 when no
/// price was known (B600). Summed across a fleet it draws a vertical spike of the size of that
/// bot's book for a single sample. A run spanning at most [`MAX_PARTIAL_SPAN_MS`] is dropped when
/// the counts before and after the run are equal and higher than inside it, and the closed profit
/// did not move (a real close and reopen changes it). The merge then carries the last good value
/// forward. Samples without a count are never touched.
#[must_use]
pub fn drop_partial_samples(sorted: Vec<HistorySample>) -> Vec<HistorySample> {
    let n = sorted.len();
    let mut drop = vec![false; n];
    let mut i = 1;
    while i < n {
        let before = sorted[i - 1];
        let Some(count) = before.open_trades else {
            i += 1;
            continue;
        };
        let lower = |s: &HistorySample| {
            s.open_trades.is_some_and(|k| k < count) && same_closed(s.closed, before.closed)
        };
        let mut j = i;
        while j < n && sorted[j].ts_ms - before.ts_ms <= MAX_PARTIAL_SPAN_MS && lower(&sorted[j]) {
            j += 1;
        }
        let back = j < n
            && j > i
            && sorted[j].open_trades == Some(count)
            && same_closed(sorted[j].closed, before.closed);
        if back {
            drop[i..j].fill(true);
            i = j + 1;
        } else {
            i += 1;
        }
    }
    sorted
        .into_iter()
        .zip(drop)
        .filter_map(|(s, d)| (!d).then_some(s))
        .collect()
}

/// Merge the sampled histories of several bots into one `closed + open` curve.
///
/// Samples written with some positions unpriced are dropped first, see [`drop_partial_samples`].
///
/// Merging starts at the first timestamp every bot has a sample for: before that, the forward
/// filled sum silently misses whole bots and fabricates an artificially low start. Each bot's
/// last sample is carried forward when timestamps do not align. Empty series are ignored.
#[must_use]
pub fn merge_histories(series: &[Vec<HistorySample>]) -> Vec<(i64, f64)> {
    let mut sorted: Vec<Vec<HistorySample>> = series
        .iter()
        .filter(|s| !s.is_empty())
        .map(|s| {
            let mut v = s.clone();
            v.sort_by_key(|x| x.ts_ms);
            drop_partial_samples(v)
        })
        .collect();
    match sorted.len() {
        0 => return Vec::new(),
        1 => {
            return sorted
                .remove(0)
                .into_iter()
                .map(|r| (r.ts_ms, r.closed + r.open))
                .collect();
        }
        _ => {}
    }
    let start = sorted.iter().map(|s| s[0].ts_ms).max().unwrap_or(0);
    let mut all_ts: Vec<i64> = sorted
        .iter()
        .flat_map(|s| s.iter().map(|r| r.ts_ms))
        .filter(|t| *t >= start)
        .collect();
    all_ts.sort_unstable();
    all_ts.dedup();
    let mut idx = vec![0_usize; sorted.len()];
    let mut last = vec![0.0_f64; sorted.len()];
    all_ts
        .into_iter()
        .map(|t| {
            for (i, s) in sorted.iter().enumerate() {
                while idx[i] < s.len() && s[idx[i]].ts_ms <= t {
                    last[i] = s[idx[i]].closed + s[idx[i]].open;
                    idx[i] += 1;
                }
            }
            (t, last.iter().sum())
        })
        .collect()
}

/// Closed part of the final point, anchored per bot on its last `profit_history` sample: the
/// sample's `closed` plus the profits of that bot's trades closed strictly after it. A bot without
/// any sample contributes its cumulative closed trades. `None` when the trades cannot be
/// attributed to the histories (several series and no aligned `history_trades`).
#[must_use]
pub fn anchored_closed(input: &DrawdownInput) -> Option<f64> {
    let per_bot: Vec<&[ClosedPnl]> = if input.history_trades.len() == input.histories.len() {
        input.history_trades.iter().map(Vec::as_slice).collect()
    } else if input.history_trades.is_empty() && input.histories.len() == 1 {
        vec![input.closed.as_slice()]
    } else {
        return None;
    };
    let total = input
        .histories
        .iter()
        .zip(per_bot)
        .map(|(h, trades)| match h.iter().max_by_key(|x| x.ts_ms) {
            Some(last) => {
                last.closed
                    + trades
                        .iter()
                        .filter(|t| t.ts_ms > last.ts_ms)
                        .map(|t| t.profit_abs)
                        .sum::<f64>()
            }
            None => trades.iter().map(|t| t.profit_abs).sum(),
        })
        .sum();
    Some(total)
}

/// Compute both drawdown definitions.
#[must_use]
pub fn compute(input: &DrawdownInput) -> DrawdownResult {
    let mut closed = input.closed.clone();
    closed.sort_by_key(|c| c.ts_ms);
    let mut cum = 0.0_f64;
    let realized_points: Vec<(i64, f64)> = closed
        .iter()
        .map(|c| {
            cum += c.profit_abs;
            (c.ts_ms, cum)
        })
        .collect();
    let realized_cum = cum;
    let rw = walk(&realized_points);

    let open_worst_sum: f64 = input.open.iter().map(open_worst_abs).sum();
    let has_open = !input.open.is_empty();

    // Curve of realized + latent, then the open positions projected to their worst point.
    let history = merge_histories(&input.histories);
    let from_history = history.len() >= 2;
    let mut curve: Vec<(i64, f64)> = if from_history {
        let first = history[0].0;
        realized_points
            .iter()
            .copied()
            .filter(|p| p.0 < first)
            .chain(history)
            .collect()
    } else {
        realized_points.clone()
    };
    let observed = walk(&curve);
    if has_open {
        let closed_now = if from_history {
            anchored_closed(input).unwrap_or(realized_cum)
        } else {
            realized_cum
        };
        curve.push((input.now_ms, closed_now + open_worst_sum));
    }
    let ow = walk(&curve);

    let base = input
        .starting_capital
        .filter(|s| s.is_finite() && *s > 0.0)
        .map(|s| s + rw.peak_value);
    let pct = |abs: f64| base.map(|b| abs / b);

    let realized = DrawdownValue {
        abs: rw.max_abs,
        pct: pct(rw.max_abs),
        peak_ms: rw.peak_ms,
        trough_ms: rw.trough_ms,
        current_abs: rw.current_abs,
    };
    let with_open = if ow.max_abs > rw.max_abs {
        DrawdownValue {
            abs: ow.max_abs,
            pct: pct(ow.max_abs),
            peak_ms: ow.peak_ms,
            trough_ms: ow.trough_ms,
            current_abs: observed.current_abs,
        }
    } else {
        DrawdownValue {
            current_abs: observed.current_abs,
            ..realized
        }
    };
    DrawdownResult {
        realized,
        with_open,
        open_worst_sum,
        has_open,
        base,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn closed(v: &[(i64, f64)]) -> Vec<ClosedPnl> {
        v.iter()
            .map(|&(ts_ms, profit_abs)| ClosedPnl { ts_ms, profit_abs })
            .collect()
    }

    fn long(profit_abs: f64, amount: f64, current: f64, min_rate: f64) -> OpenRisk {
        OpenRisk {
            profit_abs,
            amount,
            open_rate: 100.0,
            current_rate: Some(current),
            is_short: false,
            min_rate: Some(min_rate),
            max_rate: None,
        }
    }

    #[test]
    fn realized_peak_to_trough() {
        // cum: +10, +30, +15, +25, +5 -> peak 30, trough 5 -> 25.
        let r = compute(&DrawdownInput {
            closed: closed(&[(1, 10.0), (2, 20.0), (3, -15.0), (4, 10.0), (5, -20.0)]),
            starting_capital: Some(1000.0),
            now_ms: 10,
            ..Default::default()
        });
        assert_eq!(r.realized.abs, 25.0);
        assert_eq!(r.realized.peak_ms, Some(2));
        assert_eq!(r.realized.trough_ms, Some(5));
        assert_eq!(r.realized.current_abs, 25.0);
        // base = 1000 + 30
        assert_eq!(r.base, Some(1030.0));
        assert!((r.realized.pct.unwrap() - 25.0 / 1030.0).abs() < 1e-12);
        assert!(!r.has_open);
        assert_eq!(r.with_open.abs, 25.0);
    }

    #[test]
    fn high_water_mark_starts_at_the_starting_capital() {
        // A bot that only loses has a drawdown from its very first trade.
        let r = compute(&DrawdownInput {
            closed: closed(&[(1, -4.0), (2, -6.0)]),
            ..Default::default()
        });
        assert_eq!(r.realized.abs, 10.0);
        assert_eq!(r.realized.peak_ms, None);
        assert_eq!(r.realized.trough_ms, Some(2));
        assert_eq!(r.realized.pct, None);
    }

    #[test]
    fn input_order_does_not_matter() {
        let a = compute(&DrawdownInput {
            closed: closed(&[(3, -15.0), (1, 10.0), (2, 20.0)]),
            ..Default::default()
        });
        assert_eq!(a.realized.abs, 15.0);
    }

    #[test]
    fn open_positions_extend_the_drawdown_to_their_worst_point() {
        // Realized: +50 (peak 50, current 50). Long, amount 2, now 95, low 80, profit -10:
        // worst = -10 + 2 * (80 - 95) = -40 -> curve ends at 50 - 40 = 10 -> drawdown 40.
        let r = compute(&DrawdownInput {
            closed: closed(&[(1, 50.0)]),
            open: vec![long(-10.0, 2.0, 95.0, 80.0)],
            now_ms: 9,
            ..Default::default()
        });
        assert_eq!(r.open_worst_sum, -40.0);
        assert!(r.has_open);
        assert_eq!(r.realized.abs, 0.0);
        assert_eq!(r.with_open.abs, 40.0);
        assert_eq!(r.with_open.peak_ms, Some(1));
        assert_eq!(r.with_open.trough_ms, Some(9));
    }

    #[test]
    fn with_open_never_below_realized() {
        let r = compute(&DrawdownInput {
            closed: closed(&[(1, 50.0), (2, -30.0)]),
            // A winning open position: worst is still positive.
            open: vec![long(5.0, 1.0, 105.0, 105.0)],
            now_ms: 9,
            ..Default::default()
        });
        assert_eq!(r.realized.abs, 30.0);
        assert_eq!(r.with_open.abs, 30.0);
    }

    #[test]
    fn short_worst_uses_max_rate() {
        let t = OpenRisk {
            profit_abs: 3.0,
            amount: 4.0,
            open_rate: 100.0,
            current_rate: Some(98.0),
            is_short: true,
            min_rate: Some(90.0),
            max_rate: Some(104.0),
        };
        // 3 - 4 * (104 - 98) = -21
        assert_eq!(open_worst_abs(&t), -21.0);
        let no_extreme = OpenRisk {
            max_rate: None,
            ..t
        };
        assert_eq!(open_worst_abs(&no_extreme), 3.0);
        let no_amount = OpenRisk { amount: 0.0, ..t };
        assert_eq!(open_worst_abs(&no_amount), 3.0);
    }

    #[test]
    fn sampled_history_captures_books_that_are_now_closed() {
        // The curve dipped to -30 (latent) and recovered; the closed trades alone show nothing.
        let h = vec![vec![
            HistorySample {
                ts_ms: 10,
                closed: 0.0,
                open: 0.0,
                open_trades: None,
            },
            HistorySample {
                ts_ms: 20,
                closed: 0.0,
                open: -30.0,
                open_trades: None,
            },
            HistorySample {
                ts_ms: 30,
                closed: 8.0,
                open: 0.0,
                open_trades: None,
            },
        ]];
        let r = compute(&DrawdownInput {
            closed: closed(&[(30, 8.0)]),
            histories: h,
            now_ms: 40,
            ..Default::default()
        });
        assert_eq!(r.realized.abs, 0.0);
        assert_eq!(r.with_open.abs, 30.0);
        assert_eq!(r.with_open.trough_ms, Some(20));
        // Back above the starting capital now: no current drawdown.
        assert_eq!(r.with_open.current_abs, 0.0);
    }

    #[test]
    fn realized_points_before_the_first_sample_are_prepended() {
        // Realized went +20 then -20 before sampling began: drawdown 20 comes only from that.
        let h = vec![vec![
            HistorySample {
                ts_ms: 100,
                closed: 0.0,
                open: 0.0,
                open_trades: None,
            },
            HistorySample {
                ts_ms: 200,
                closed: 0.0,
                open: 1.0,
                open_trades: None,
            },
        ]];
        let r = compute(&DrawdownInput {
            closed: closed(&[(1, 20.0), (2, -20.0)]),
            histories: h,
            now_ms: 300,
            ..Default::default()
        });
        assert_eq!(r.realized.abs, 20.0);
        assert_eq!(r.with_open.abs, 20.0);
    }

    #[test]
    fn merge_starts_at_the_first_common_timestamp_and_forward_fills() {
        let a = vec![
            HistorySample {
                ts_ms: 10,
                closed: 1.0,
                open: 0.0,
                open_trades: None,
            },
            HistorySample {
                ts_ms: 30,
                closed: 3.0,
                open: 0.0,
                open_trades: None,
            },
        ];
        let b = vec![
            HistorySample {
                ts_ms: 20,
                closed: 10.0,
                open: 0.0,
                open_trades: None,
            },
            HistorySample {
                ts_ms: 30,
                closed: 0.0,
                open: 5.0,
                open_trades: None,
            },
        ];
        // Common start is 20: a is forward filled with its t=10 sample (1.0).
        assert_eq!(merge_histories(&[a, b]), vec![(20, 11.0), (30, 8.0)]);
    }

    fn counted(ts_ms: i64, closed: f64, open: f64, n: u32) -> HistorySample {
        HistorySample {
            ts_ms,
            closed,
            open,
            open_trades: Some(n),
        }
    }

    /// Samples of `hyperliquid_hippo_original_multi` on 2026-10-16 (closed 1224.05, two open
    /// positions) around the 13:26 sample written with no price known.
    fn hippo_16_oct() -> Vec<HistorySample> {
        vec![
            counted(1, 1224.05, -545.91, 2),
            counted(2, 1224.05, -545.91, 2),
            counted(3, 1224.05, 0.0, 0),
            counted(4, 1224.05, -549.42, 2),
            counted(5, 1224.05, -553.40, 2),
        ]
    }

    #[test]
    fn a_sample_written_without_prices_does_not_spike_the_fleet_curve() {
        // The second bot is steady at -400 latent; the first one is the real hippo book.
        let steady: Vec<HistorySample> = (1..=5).map(|t| counted(t, 100.0, -400.0, 1)).collect();
        let merged = merge_histories(&[hippo_16_oct(), steady]);
        assert_eq!(merged.len(), 5);
        let at3 = merged.iter().find(|p| p.0 == 3).unwrap().1;
        // Before the fix: 1224.05 + 0 + 100 - 400 = 924.05 against about 278 around it.
        assert!(
            (at3 - (1224.05 - 545.91 + 100.0 - 400.0)).abs() < 1e-9,
            "{at3}"
        );
        let lo = merged.iter().map(|p| p.1).fold(f64::MAX, f64::min);
        let hi = merged.iter().map(|p| p.1).fold(f64::MIN, f64::max);
        assert!(hi - lo < 10.0, "{lo} {hi}");
    }

    #[test]
    fn a_single_bot_curve_is_cleaned_too() {
        let merged = merge_histories(&[hippo_16_oct()]);
        assert_eq!(merged.len(), 4);
        assert!(merged.iter().all(|p| p.1 < 700.0));
    }

    #[test]
    fn a_sample_missing_one_of_two_positions_is_dropped() {
        // 2026-10-18 12:05: one position priced out of two, latent -21 instead of -611.
        let h = vec![
            counted(1, 1224.05, -615.09, 2),
            counted(2, 1224.05, -21.31, 1),
            counted(3, 1224.05, -610.94, 2),
        ];
        let kept = drop_partial_samples(h);
        assert_eq!(kept.iter().map(|s| s.ts_ms).collect::<Vec<_>>(), vec![1, 3]);
    }

    #[test]
    fn a_run_of_partial_samples_is_dropped_up_to_twelve_hours() {
        const H: i64 = 3_600_000;
        // hippo, 2026-10-16 07:14 to 11:36: 11 unpriced samples about 25 minutes apart
        let run = |len: i64, step: i64| {
            let mut h = vec![counted(0, 5.0, -10.0, 2)];
            h.extend((1..=len).map(|i| counted(i * step, 5.0, 0.0, 0)));
            h.push(counted((len + 1) * step, 5.0, -11.0, 2));
            drop_partial_samples(h).len()
        };
        assert_eq!(run(11, 25 * 60_000), 2);
        assert_eq!(run(3, 5 * 60_000), 2);
        // Beyond twelve hours a lower count is taken as a real change
        assert_eq!(run(13, H), 15);
    }

    #[test]
    fn a_real_close_and_reopen_is_kept() {
        // The closed profit moved: positions really closed, then others opened.
        let h = vec![
            counted(1, 5.0, -10.0, 2),
            counted(2, 7.0, 0.0, 0),
            counted(3, 7.0, -3.0, 2),
        ];
        assert_eq!(drop_partial_samples(h.clone()), h);
        // A permanent decrease of the count is never touched.
        let h = vec![
            counted(1, 5.0, -10.0, 2),
            counted(2, 5.0, -4.0, 1),
            counted(3, 5.0, -4.0, 1),
        ];
        assert_eq!(drop_partial_samples(h.clone()), h);
    }

    #[test]
    fn samples_without_a_count_are_never_dropped() {
        let h: Vec<HistorySample> = vec![
            HistorySample {
                ts_ms: 1,
                closed: 1.0,
                open: -5.0,
                open_trades: None,
            },
            HistorySample {
                ts_ms: 2,
                closed: 1.0,
                open: 0.0,
                open_trades: None,
            },
            HistorySample {
                ts_ms: 3,
                closed: 1.0,
                open: -5.0,
                open_trades: None,
            },
        ];
        assert_eq!(drop_partial_samples(h.clone()), h);
    }

    #[test]
    fn merge_ignores_empty_series() {
        let a = vec![HistorySample {
            ts_ms: 10,
            closed: 1.0,
            open: 2.0,
            open_trades: None,
        }];
        assert_eq!(merge_histories(&[vec![], a]), vec![(10, 3.0)]);
        assert!(merge_histories(&[vec![], vec![]]).is_empty());
        assert!(merge_histories(&[]).is_empty());
    }

    #[test]
    fn unknown_capital_gives_no_percentage_but_keeps_the_absolute() {
        let r = compute(&DrawdownInput {
            closed: closed(&[(1, 10.0), (2, -5.0)]),
            starting_capital: Some(0.0),
            ..Default::default()
        });
        assert_eq!(r.realized.abs, 5.0);
        assert_eq!(r.realized.pct, None);
        assert_eq!(r.base, None);
    }

    #[test]
    fn get_selects_the_definition() {
        let r = compute(&DrawdownInput {
            closed: closed(&[(1, -2.0)]),
            ..Default::default()
        });
        assert_eq!(r.get(DrawdownDef::Realized).abs, 2.0);
        assert_eq!(r.get(DrawdownDef::WithOpen).abs, 2.0);
    }
}
