//! Timestamp normalisation.
//!
//! Every timestamp inside the gateway is an integer number of milliseconds since the Unix epoch
//! (UTC). Sources disagree on units (freqtrade serialises `latest_trade_timestamp` in
//! milliseconds while the old UI assumed seconds, see bug B5), so values are normalised on entry
//! rather than trusted.

use chrono::{DateTime, NaiveDateTime};

/// Largest value still interpreted as seconds (year 5138 in seconds, 1973 in milliseconds).
const MAX_SECONDS: f64 = 1e11;
/// Largest value still interpreted as milliseconds (year 5138 in milliseconds, 1973 in microseconds).
const MAX_MILLIS: f64 = 1e14;
/// Largest value still interpreted as microseconds.
const MAX_MICROS: f64 = 1e17;

/// Normalise a raw epoch value of unknown unit (s, ms, us or ns) to milliseconds.
///
/// Returns `None` for non-finite or non-positive input (0 means "never" in freqtrade payloads).
/// The magnitude bands are wide: any date between 1973 and 5138 is classified unambiguously.
#[must_use]
pub fn normalize_ts_ms(raw: f64) -> Option<i64> {
    if !raw.is_finite() || raw <= 0.0 {
        return None;
    }
    let ms = if raw < MAX_SECONDS {
        raw * 1000.0
    } else if raw < MAX_MILLIS {
        raw
    } else if raw < MAX_MICROS {
        raw / 1000.0
    } else {
        raw / 1_000_000.0
    };
    // Truncation is intended: sub-millisecond precision is dropped.
    #[allow(clippy::cast_possible_truncation)]
    Some(ms as i64)
}

/// Parse a database or API date into epoch milliseconds.
///
/// Accepts the naive `YYYY-MM-DD HH:MM:SS[.ffffff]` form used by freqtrade databases (always UTC)
/// and RFC 3339 / ISO 8601 with a `T` separator, with or without `Z` or an explicit offset.
/// A date without offset is interpreted as UTC, never as local time.
#[must_use]
pub fn parse_date_ms(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.len() < 10 {
        return None;
    }
    let iso: String = if s.as_bytes().get(10) == Some(&b' ') {
        format!("{}T{}", &s[..10], &s[11..])
    } else {
        s.to_owned()
    };
    if let Ok(dt) = DateTime::parse_from_rfc3339(&iso) {
        return Some(dt.timestamp_millis());
    }
    NaiveDateTime::parse_from_str(&iso, "%Y-%m-%dT%H:%M:%S%.f")
        .ok()
        .map(|n| n.and_utc().timestamp_millis())
}

/// Elapsed hours between two millisecond timestamps (negative when `to` precedes `from`).
#[must_use]
pub fn hours_between_ms(from_ms: i64, to_ms: i64) -> f64 {
    (to_ms - from_ms) as f64 / 3_600_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seconds_millis_micros_nanos_are_normalised() {
        assert_eq!(normalize_ts_ms(1_760_530_000.0), Some(1_760_530_000_000));
        assert_eq!(
            normalize_ts_ms(1_760_530_000_123.0),
            Some(1_760_530_000_123)
        );
        assert_eq!(
            normalize_ts_ms(1_760_530_000_123_456.0),
            Some(1_760_530_000_123)
        );
        assert_eq!(
            normalize_ts_ms(1_760_530_000_123_456_789.0),
            Some(1_760_530_000_123)
        );
    }

    #[test]
    fn zero_negative_and_non_finite_mean_unknown() {
        assert_eq!(normalize_ts_ms(0.0), None);
        assert_eq!(normalize_ts_ms(-5.0), None);
        assert_eq!(normalize_ts_ms(f64::NAN), None);
        assert_eq!(normalize_ts_ms(f64::INFINITY), None);
    }

    #[test]
    fn naive_dates_are_utc() {
        assert_eq!(
            parse_date_ms("2026-10-15 12:00:00"),
            Some(1_792_065_600_000)
        );
        assert_eq!(
            parse_date_ms("2026-10-15 12:00:00.123456"),
            Some(1_792_065_600_123)
        );
        assert_eq!(
            parse_date_ms("2026-10-15T12:00:00"),
            Some(1_792_065_600_000)
        );
    }

    #[test]
    fn explicit_offsets_are_honoured() {
        assert_eq!(
            parse_date_ms("2026-10-15T12:00:00Z"),
            Some(1_792_065_600_000)
        );
        assert_eq!(
            parse_date_ms("2026-10-15T14:00:00+02:00"),
            Some(1_792_065_600_000)
        );
        assert_eq!(
            parse_date_ms("2026-10-15 14:00:00+02:00"),
            Some(1_792_065_600_000)
        );
    }

    #[test]
    fn garbage_dates_are_rejected() {
        assert_eq!(parse_date_ms(""), None);
        assert_eq!(parse_date_ms("not a date"), None);
        assert_eq!(parse_date_ms("2026-13-45 99:99:99"), None);
    }

    #[test]
    fn hours_between_is_signed() {
        assert!((hours_between_ms(0, 7_200_000) - 2.0).abs() < 1e-12);
        assert!((hours_between_ms(7_200_000, 0) + 2.0).abs() < 1e-12);
    }
}
