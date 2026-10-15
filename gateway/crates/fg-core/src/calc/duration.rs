//! Durations, percentiles and the "stuck position" statistics.
//!
//! One definition of "how long is long for this bot": the rank of a position's duration among
//! the durations of the same bot's closed trades. The label `pNN` shown next to a duration is
//! that rank (`p84`: longer than 84 % of the bot's closed trades). Levels: above 70 amber, above
//! 90 critical (the thresholds of the old `durationAnomalyLevelFromPct`).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Minimum number of closed durations for a percentile to mean anything.
pub const MIN_SAMPLES: usize = 3;
/// Fixed scale used when there is not enough history: 72 h maps to 100 %.
const FALLBACK_SCALE_H: f64 = 72.0;
/// Percentile above which a duration is flagged amber.
pub const WARN_ABOVE_PCT: f64 = 70.0;
/// Percentile above which a duration is flagged critical.
pub const CRITICAL_ABOVE_PCT: f64 = 90.0;

/// Severity of a duration relative to the bot's own history.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum DurationLevel {
    Ok,
    Warn,
    Critical,
}

impl DurationLevel {
    #[must_use]
    pub fn from_pct(pct: f64) -> Self {
        if pct > CRITICAL_ABOVE_PCT {
            Self::Critical
        } else if pct > WARN_ABOVE_PCT {
            Self::Warn
        } else {
            Self::Ok
        }
    }
}

/// Duration of a trade in ms. An open trade runs until `now_ms`. Clamped at zero: the backend
/// serialises `open_date` with microseconds and floors `close_date` to the millisecond, so a
/// trade opened and closed within the same millisecond can read a few ms negative.
#[must_use]
pub fn duration_ms(open_ms: i64, close_ms: Option<i64>, now_ms: i64) -> i64 {
    (close_ms.unwrap_or(now_ms) - open_ms).max(0)
}

/// Rank (0-100, rounded) of `ms` among `closed_ms`: the share of closed durations that are
/// shorter than or equal to it. Zero-length durations are ignored. `None` below
/// [`MIN_SAMPLES`] samples.
#[must_use]
pub fn percentile_rank(closed_ms: &[i64], ms: i64) -> Option<u8> {
    let sample: Vec<i64> = closed_ms.iter().copied().filter(|d| *d > 0).collect();
    if sample.len() < MIN_SAMPLES {
        return None;
    }
    let below = sample.iter().filter(|d| **d <= ms).count();
    let pct = (below as f64 / sample.len() as f64 * 100.0).round();
    // `pct` is within 0..=100 by construction.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    Some(pct as u8)
}

/// Percentage (0-100) describing how far along a duration is: the percentile rank when the bot
/// has enough history, otherwise a fixed 72 h scale capped at 100.
#[must_use]
pub fn anomaly_pct(ms: i64, closed_ms: &[i64]) -> f64 {
    match percentile_rank(closed_ms, ms) {
        Some(p) => f64::from(p),
        None => (ms as f64 / 3_600_000.0 / FALLBACK_SCALE_H * 100.0).min(100.0),
    }
}

/// Value at percentile `p` (0-100) with linear interpolation between closest ranks.
#[must_use]
pub fn percentile_value(values: &[f64], p: f64) -> Option<f64> {
    let mut v: Vec<f64> = values.iter().copied().filter(|x| x.is_finite()).collect();
    if v.is_empty() {
        return None;
    }
    v.sort_by(f64::total_cmp);
    let rank = (p.clamp(0.0, 100.0) / 100.0) * (v.len() - 1) as f64;
    let lo = rank.floor() as usize;
    let hi = rank.ceil() as usize;
    Some(v[lo] + (v[hi] - v[lo]) * (rank - lo as f64))
}

/// Median of the values.
#[must_use]
pub fn median(values: &[f64]) -> Option<f64> {
    percentile_value(values, 50.0)
}

/// Median of the strictly positive closed durations, in ms.
#[must_use]
pub fn median_duration_ms(closed_ms: &[i64]) -> Option<i64> {
    let v: Vec<f64> = closed_ms
        .iter()
        .filter(|d| **d > 0)
        .map(|d| *d as f64)
        .collect();
    // The median of positive integers fits in i64.
    #[allow(clippy::cast_possible_truncation)]
    median(&v).map(|m| m.round() as i64)
}

/// Parse freqtrade's `avg_duration` (`"2 days, 3:04:05"`, `"1 day, 0:00:10.5"`, `"3:04:05"`).
///
/// Only the direct mode needs this; the gateway computes medians from the database instead.
/// Returns `None` for anything that does not look like a duration or for a zero duration.
#[must_use]
pub fn parse_avg_duration_ms(s: &str) -> Option<i64> {
    let s = s.trim();
    let (days_part, time_part) = match s.split_once(',') {
        Some((d, t)) => (Some(d.trim()), t.trim()),
        None if s.contains("day") => (Some(s), ""),
        None => (None, s),
    };
    let mut total_s = 0.0_f64;
    let mut any = false;
    if let Some(d) = days_part {
        let n: f64 = d.split_whitespace().next()?.parse().ok()?;
        if !d.contains("day") {
            return None;
        }
        total_s += n * 86_400.0;
        any = true;
    }
    if !time_part.is_empty() {
        let mut it = time_part.split(':');
        let h: f64 = it.next()?.trim().parse().ok()?;
        let m: f64 = it.next()?.trim().parse().ok()?;
        let sec: f64 = it.next()?.trim().parse().ok()?;
        if it.next().is_some() {
            return None;
        }
        total_s += h * 3600.0 + m * 60.0 + sec;
        any = true;
    }
    if !any || total_s <= 0.0 || !total_s.is_finite() {
        return None;
    }
    #[allow(clippy::cast_possible_truncation)]
    Some((total_s * 1000.0).round() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: i64 = 3_600_000;

    #[test]
    fn duration_is_clamped_and_open_runs_to_now() {
        assert_eq!(duration_ms(1_000, Some(4_000), 99_999), 3_000);
        assert_eq!(duration_ms(1_000, None, 6_000), 5_000);
        assert_eq!(duration_ms(5_000, Some(4_998), 0), 0);
    }

    #[test]
    fn percentile_rank_counts_shorter_or_equal() {
        let closed = [H, 2 * H, 3 * H, 4 * H];
        assert_eq!(percentile_rank(&closed, 2 * H), Some(50));
        assert_eq!(percentile_rank(&closed, 4 * H), Some(100));
        assert_eq!(percentile_rank(&closed, H / 2), Some(0));
        assert_eq!(percentile_rank(&closed, 100 * H), Some(100));
    }

    #[test]
    fn percentile_rank_ignores_zero_and_needs_three_samples() {
        assert_eq!(percentile_rank(&[H, 2 * H], H), None);
        assert_eq!(percentile_rank(&[0, 0, H, 2 * H], H), None);
        assert_eq!(percentile_rank(&[0, H, 2 * H, 3 * H], 2 * H), Some(67));
    }

    #[test]
    fn anomaly_falls_back_to_a_72h_scale() {
        assert!((anomaly_pct(36 * H, &[]) - 50.0).abs() < 1e-9);
        assert!((anomaly_pct(200 * H, &[H]) - 100.0).abs() < 1e-9);
        assert!((anomaly_pct(2 * H, &[H, 2 * H, 3 * H, 4 * H]) - 50.0).abs() < 1e-9);
    }

    #[test]
    fn levels_use_70_and_90() {
        assert_eq!(DurationLevel::from_pct(70.0), DurationLevel::Ok);
        assert_eq!(DurationLevel::from_pct(84.0), DurationLevel::Warn);
        assert_eq!(DurationLevel::from_pct(90.0), DurationLevel::Warn);
        assert_eq!(DurationLevel::from_pct(91.0), DurationLevel::Critical);
    }

    #[test]
    fn percentile_value_interpolates() {
        let v = [1.0, 2.0, 3.0, 4.0];
        assert_eq!(percentile_value(&v, 0.0), Some(1.0));
        assert_eq!(percentile_value(&v, 100.0), Some(4.0));
        assert_eq!(percentile_value(&v, 50.0), Some(2.5));
        assert!((percentile_value(&v, 84.0).unwrap() - 3.52).abs() < 1e-9);
        assert_eq!(percentile_value(&[], 50.0), None);
        assert_eq!(percentile_value(&[f64::NAN], 50.0), None);
    }

    #[test]
    fn median_duration_ignores_non_positive() {
        assert_eq!(median_duration_ms(&[0, -5, H, 3 * H, 5 * H]), Some(3 * H));
        assert_eq!(median_duration_ms(&[0, 0]), None);
    }

    #[test]
    fn avg_duration_formats() {
        assert_eq!(parse_avg_duration_ms("3:04:05"), Some(11_045_000));
        assert_eq!(
            parse_avg_duration_ms("2 days, 3:04:05"),
            Some(172_800_000 + 11_045_000)
        );
        assert_eq!(parse_avg_duration_ms("1 day, 0:00:10.5"), Some(86_410_500));
        assert_eq!(parse_avg_duration_ms("1 day"), Some(86_400_000));
        assert_eq!(parse_avg_duration_ms("0:00:00"), None);
        assert_eq!(parse_avg_duration_ms(""), None);
        assert_eq!(parse_avg_duration_ms("soon"), None);
        assert_eq!(parse_avg_duration_ms("1:2"), None);
    }
}
