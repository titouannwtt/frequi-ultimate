//! Profit periods and calendar buckets in an explicit time zone.
//!
//! The daily P&L is cut at midnight of the *configured* zone, `Europe/Paris` by default (UTC on
//! request), never at midnight of the machine or the browser. Day, week (Monday start) and month
//! boundaries are computed on the local wall clock, so a day can be 23 or 25 hours long around a
//! daylight-saving change.
//!
//! Rolling windows (`24h`, `48h`, `7d`, `14d`, `30d`) are exact durations. Calendar windows
//! (`today`, `mtd`, `ytd`, `1m`..`1y`) follow the local wall clock: `1m` ago from 20 May 14:00
//! Paris is 20 April 14:00 Paris, whatever the offset was in April. A comparison written against
//! fixed UTC instants therefore only holds on hosts whose zone has no daylight saving (bug B19).

use chrono::{Datelike, Duration, LocalResult, Months, NaiveDate, NaiveDateTime, TimeZone};
use chrono_tz::Tz as IanaTz;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::drawdown::ClosedPnl;

const HOUR_MS: i64 = 3_600_000;
const DAY_MS: i64 = 24 * HOUR_MS;

/// Time zone used to cut days, weeks and months.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
pub enum Tz {
    #[default]
    #[serde(rename = "Europe/Paris")]
    EuropeParis,
    #[serde(rename = "UTC")]
    Utc,
}

impl Tz {
    fn iana(self) -> IanaTz {
        match self {
            Self::EuropeParis => chrono_tz::Europe::Paris,
            Self::Utc => chrono_tz::UTC,
        }
    }

    /// Local wall-clock time of an instant.
    #[must_use]
    pub fn to_local(self, ms: i64) -> NaiveDateTime {
        self.iana().timestamp_millis_opt(ms).single().map_or_else(
            || chrono::DateTime::UNIX_EPOCH.naive_utc(),
            |d| d.naive_local(),
        )
    }

    /// Instant of a local wall-clock time. An ambiguous time (clocks going back) resolves to its
    /// first occurrence; a time that does not exist (clocks going forward) is moved ahead to the
    /// first valid instant.
    #[must_use]
    pub fn from_local(self, naive: NaiveDateTime) -> i64 {
        let mut n = naive;
        for _ in 0..4 {
            match self.iana().from_local_datetime(&n) {
                LocalResult::Single(d) | LocalResult::Ambiguous(d, _) => {
                    return d.timestamp_millis();
                }
                LocalResult::None => n += Duration::hours(1),
            }
        }
        naive.and_utc().timestamp_millis()
    }

    fn midnight(self, date: NaiveDate) -> i64 {
        self.from_local(date.and_hms_opt(0, 0, 0).unwrap_or_default())
    }
}

/// A profit period as offered by the period selector.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub enum PeriodKey {
    #[serde(rename = "24h")]
    H24,
    #[serde(rename = "today")]
    Today,
    #[serde(rename = "48h")]
    H48,
    #[serde(rename = "7d")]
    D7,
    #[serde(rename = "14d")]
    D14,
    #[serde(rename = "30d")]
    D30,
    #[serde(rename = "1m")]
    M1,
    #[serde(rename = "2m")]
    M2,
    #[serde(rename = "3m")]
    M3,
    #[serde(rename = "6m")]
    M6,
    #[serde(rename = "1y")]
    Y1,
    #[serde(rename = "mtd")]
    Mtd,
    #[serde(rename = "ytd")]
    Ytd,
    #[serde(rename = "all")]
    All,
}

/// Lower bound (ms, inclusive) of a period: a trade belongs to it when `close_ms >= cutoff`.
/// `All` returns 0.
#[must_use]
pub fn period_cutoff_ms(key: PeriodKey, now_ms: i64, tz: Tz) -> i64 {
    let local = tz.to_local(now_ms);
    let months_back = |n: u32| {
        local
            .checked_sub_months(Months::new(n))
            .map_or(0, |d| tz.from_local(d))
    };
    match key {
        PeriodKey::H24 => now_ms - DAY_MS,
        PeriodKey::H48 => now_ms - 2 * DAY_MS,
        PeriodKey::D7 => now_ms - 7 * DAY_MS,
        PeriodKey::D14 => now_ms - 14 * DAY_MS,
        PeriodKey::D30 => now_ms - 30 * DAY_MS,
        PeriodKey::Today => tz.midnight(local.date()),
        PeriodKey::M1 => months_back(1),
        PeriodKey::M2 => months_back(2),
        PeriodKey::M3 => months_back(3),
        PeriodKey::M6 => months_back(6),
        PeriodKey::Y1 => months_back(12),
        PeriodKey::Mtd => tz.midnight(local.date().with_day(1).unwrap_or(local.date())),
        PeriodKey::Ytd => {
            tz.midnight(NaiveDate::from_ymd_opt(local.year(), 1, 1).unwrap_or(local.date()))
        }
        PeriodKey::All => 0,
    }
}

/// Granularity of a P&L calendar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum PeriodUnit {
    Day,
    /// ISO week, starting on Monday.
    Week,
    Month,
}

/// Start (ms) of the calendar bucket containing `ts_ms`.
#[must_use]
pub fn bucket_start_ms(unit: PeriodUnit, tz: Tz, ts_ms: i64) -> i64 {
    let date = tz.to_local(ts_ms).date();
    let start = match unit {
        PeriodUnit::Day => date,
        PeriodUnit::Week => date - Duration::days(i64::from(date.weekday().num_days_from_monday())),
        PeriodUnit::Month => date.with_day(1).unwrap_or(date),
    };
    tz.midnight(start)
}

/// Start (ms) of the bucket that follows the one starting at `start_ms`.
#[must_use]
pub fn next_bucket_start_ms(unit: PeriodUnit, tz: Tz, start_ms: i64) -> i64 {
    let date = tz.to_local(start_ms).date();
    let next = match unit {
        PeriodUnit::Day => date + Duration::days(1),
        PeriodUnit::Week => date + Duration::days(7),
        PeriodUnit::Month => date.checked_add_months(Months::new(1)).unwrap_or(date),
    };
    tz.midnight(next)
}

/// Label of a bucket in its local zone: `YYYY-MM-DD` for days and weeks (first day), `YYYY-MM`
/// for months.
#[must_use]
pub fn bucket_label(unit: PeriodUnit, tz: Tz, start_ms: i64) -> String {
    let date = tz.to_local(start_ms).date();
    match unit {
        PeriodUnit::Month => format!("{:04}-{:02}", date.year(), date.month()),
        _ => format!("{:04}-{:02}-{:02}", date.year(), date.month(), date.day()),
    }
}

/// One calendar bucket of realized profit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct PnlBucket {
    pub start_ms: i64,
    /// Exclusive end: the start of the next bucket.
    pub end_ms: i64,
    pub label: String,
    pub profit_abs: f64,
    pub trades: u32,
    pub wins: u32,
    pub losses: u32,
}

/// The last `n` buckets ending with the one that contains `now_ms`, oldest first, empty buckets
/// included with zero profit. Trades are bucketed by close time. One currency only: the caller
/// must not mix stake currencies or live and dry bots.
#[must_use]
pub fn pnl_periods(
    trades: &[ClosedPnl],
    unit: PeriodUnit,
    tz: Tz,
    now_ms: i64,
    n: usize,
) -> Vec<PnlBucket> {
    let mut starts = Vec::with_capacity(n);
    let mut cur = bucket_start_ms(unit, tz, now_ms);
    for _ in 0..n {
        starts.push(cur);
        cur = bucket_start_ms(unit, tz, cur - 1);
    }
    starts.reverse();
    starts
        .into_iter()
        .map(|start_ms| {
            let end_ms = next_bucket_start_ms(unit, tz, start_ms);
            let mut b = PnlBucket {
                start_ms,
                end_ms,
                label: bucket_label(unit, tz, start_ms),
                profit_abs: 0.0,
                trades: 0,
                wins: 0,
                losses: 0,
            };
            for t in trades
                .iter()
                .filter(|t| t.ts_ms >= start_ms && t.ts_ms < end_ms)
            {
                b.profit_abs += t.profit_abs;
                b.trades += 1;
                if t.profit_abs > 0.0 {
                    b.wins += 1;
                } else if t.profit_abs < 0.0 {
                    b.losses += 1;
                }
            }
            b
        })
        .collect()
}

/// Sum of the profits closed at or after `cutoff_ms`.
#[must_use]
pub fn profit_since(trades: &[ClosedPnl], cutoff_ms: i64) -> f64 {
    trades
        .iter()
        .filter(|t| t.ts_ms >= cutoff_ms)
        .map(|t| t.profit_abs)
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    // 2026-05-20T12:00:00Z (14:00 Paris, CEST).
    const NOW: i64 = 1_779_278_400_000;

    #[test]
    fn rolling_windows_are_exact_durations() {
        assert_eq!(
            period_cutoff_ms(PeriodKey::H24, NOW, Tz::EuropeParis),
            NOW - 86_400_000
        );
        assert_eq!(
            period_cutoff_ms(PeriodKey::D7, NOW, Tz::Utc),
            NOW - 7 * 86_400_000
        );
        assert_eq!(
            period_cutoff_ms(PeriodKey::D30, NOW, Tz::Utc),
            NOW - 30 * 86_400_000
        );
        assert_eq!(period_cutoff_ms(PeriodKey::All, NOW, Tz::Utc), 0);
    }

    #[test]
    fn today_is_local_midnight() {
        // 2026-05-20 00:00 Paris = 2026-05-19T22:00:00Z; in UTC it is 2026-05-20T00:00:00Z.
        assert_eq!(
            period_cutoff_ms(PeriodKey::Today, NOW, Tz::EuropeParis),
            NOW - 14 * HOUR_MS
        );
        assert_eq!(
            period_cutoff_ms(PeriodKey::Today, NOW, Tz::Utc),
            NOW - 12 * HOUR_MS
        );
    }

    #[test]
    fn calendar_months_keep_the_wall_clock_across_dst() {
        // 1 month ago: 20 April 14:00 CEST = 12:00Z (same offset).
        assert_eq!(
            period_cutoff_ms(PeriodKey::M1, NOW, Tz::EuropeParis),
            NOW - 30 * DAY_MS
        );
        // 3 months ago: 20 February 14:00 CET = 13:00Z, one hour after the fixed-UTC guess.
        assert_eq!(
            period_cutoff_ms(PeriodKey::M3, NOW, Tz::EuropeParis),
            1_771_592_400_000
        );
        assert_eq!(
            period_cutoff_ms(PeriodKey::M3, NOW, Tz::Utc),
            1_771_588_800_000
        );
        // 1 year ago: 20 May 2025 14:00 CEST.
        assert_eq!(
            period_cutoff_ms(PeriodKey::Y1, NOW, Tz::EuropeParis),
            1_747_742_400_000
        );
    }

    #[test]
    fn month_arithmetic_clamps_to_the_end_of_the_month() {
        // 2026-03-31T12:00:00Z minus one month is 28 February.
        let now = 1_774_958_400_000;
        let cutoff = period_cutoff_ms(PeriodKey::M1, now, Tz::Utc);
        assert_eq!(
            Tz::Utc.to_local(cutoff).date(),
            NaiveDate::from_ymd_opt(2026, 2, 28).unwrap()
        );
    }

    #[test]
    fn mtd_and_ytd_start_at_local_midnight() {
        assert_eq!(
            period_cutoff_ms(PeriodKey::Mtd, NOW, Tz::EuropeParis),
            1_777_586_400_000
        );
        assert_eq!(
            period_cutoff_ms(PeriodKey::Ytd, NOW, Tz::EuropeParis),
            1_767_222_000_000
        );
        assert_eq!(
            period_cutoff_ms(PeriodKey::Mtd, NOW, Tz::Utc),
            1_777_593_600_000
        );
    }

    #[test]
    fn days_are_23_and_25_hours_around_daylight_saving() {
        let start = bucket_start_ms(PeriodUnit::Day, Tz::EuropeParis, 1_792_900_000_000);
        assert_eq!(start, 1_792_879_200_000); // 2026-10-25 00:00 CEST
        let next = next_bucket_start_ms(PeriodUnit::Day, Tz::EuropeParis, start);
        assert_eq!(next - start, 25 * HOUR_MS);
        let start = bucket_start_ms(PeriodUnit::Day, Tz::EuropeParis, 1_774_800_000_000);
        assert_eq!(start, 1_774_738_800_000); // 2026-03-29 00:00 CET
        let next = next_bucket_start_ms(PeriodUnit::Day, Tz::EuropeParis, start);
        assert_eq!(next - start, 23 * HOUR_MS);
    }

    #[test]
    fn a_trade_just_after_paris_midnight_belongs_to_the_next_paris_day() {
        // 2026-05-19T22:30:00Z is 00:30 on 20 May in Paris but still 19 May in UTC.
        let t = ClosedPnl {
            ts_ms: 1_779_229_800_000,
            profit_abs: 5.0,
        };
        let paris = pnl_periods(&[t], PeriodUnit::Day, Tz::EuropeParis, NOW, 1);
        assert_eq!(paris[0].label, "2026-05-20");
        assert_eq!(paris[0].profit_abs, 5.0);
        let utc = pnl_periods(&[t], PeriodUnit::Day, Tz::Utc, NOW, 1);
        assert_eq!(utc[0].label, "2026-05-20");
        assert_eq!(utc[0].profit_abs, 0.0);
    }

    #[test]
    fn weeks_start_on_monday_and_months_on_the_first() {
        // 2026-05-20 is a Wednesday: the week starts Monday 18 May.
        let w = bucket_start_ms(PeriodUnit::Week, Tz::Utc, NOW);
        assert_eq!(bucket_label(PeriodUnit::Week, Tz::Utc, w), "2026-05-18");
        let m = bucket_start_ms(PeriodUnit::Month, Tz::EuropeParis, NOW);
        assert_eq!(
            bucket_label(PeriodUnit::Month, Tz::EuropeParis, m),
            "2026-05"
        );
        assert_eq!(m, 1_777_586_400_000);
    }

    #[test]
    fn calendar_includes_empty_buckets_oldest_first() {
        let trades = [
            ClosedPnl {
                ts_ms: NOW - 1_000,
                profit_abs: 3.0,
            },
            ClosedPnl {
                ts_ms: NOW - 2_000,
                profit_abs: -1.0,
            },
            ClosedPnl {
                ts_ms: NOW - 3 * DAY_MS,
                profit_abs: 7.0,
            },
        ];
        let b = pnl_periods(&trades, PeriodUnit::Day, Tz::Utc, NOW, 4);
        let labels: Vec<_> = b.iter().map(|x| x.label.as_str()).collect();
        assert_eq!(
            labels,
            ["2026-05-17", "2026-05-18", "2026-05-19", "2026-05-20"]
        );
        assert_eq!(b[0].profit_abs, 7.0);
        assert_eq!(b[1].trades, 0);
        assert_eq!(b[3].profit_abs, 2.0);
        assert_eq!((b[3].trades, b[3].wins, b[3].losses), (2, 1, 1));
        assert!(pnl_periods(&trades, PeriodUnit::Day, Tz::Utc, NOW, 0).is_empty());
    }

    #[test]
    fn profit_since_is_inclusive() {
        let trades = [
            ClosedPnl {
                ts_ms: 10,
                profit_abs: 1.0,
            },
            ClosedPnl {
                ts_ms: 20,
                profit_abs: 2.0,
            },
        ];
        assert_eq!(profit_since(&trades, 20), 2.0);
        assert_eq!(profit_since(&trades, 0), 3.0);
        assert_eq!(profit_since(&trades, 21), 0.0);
    }

    #[test]
    fn nonexistent_local_times_move_forward() {
        // 2026-03-29 02:30 does not exist in Paris (02:00 jumps to 03:00).
        let naive = NaiveDate::from_ymd_opt(2026, 3, 29)
            .unwrap()
            .and_hms_opt(2, 30, 0)
            .unwrap();
        let ms = Tz::EuropeParis.from_local(naive);
        assert_eq!(
            Tz::EuropeParis.to_local(ms).format("%H:%M").to_string(),
            "03:30"
        );
    }

    #[test]
    fn serde_names_match_the_selector() {
        assert_eq!(serde_json::to_string(&PeriodKey::H24).unwrap(), "\"24h\"");
        assert_eq!(
            serde_json::to_string(&Tz::EuropeParis).unwrap(),
            "\"Europe/Paris\""
        );
        assert_eq!(serde_json::from_str::<Tz>("\"UTC\"").unwrap(), Tz::Utc);
        assert_eq!(Tz::default(), Tz::EuropeParis);
    }
}
