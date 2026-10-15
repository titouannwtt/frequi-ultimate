//! Freshness: every figure carries its age, a stale figure is neither shown as current nor summed.
//!
//! Staleness rules (03 section 6.1): a digest older than 120 s; a REST or SQLite or Python figure
//! older than three times its polling cadence; a WebSocket silent for more than 2 minutes while
//! the bot has open positions (a bot with nothing open has nothing to say).

use crate::model::{Freshness, FreshnessSource};

/// Age threshold of a digest.
pub const DIGEST_STALE_MS: i64 = 120_000;
/// Silence threshold of a WebSocket feed of a bot with open positions.
pub const WS_STALE_MS: i64 = 120_000;
/// Multiple of the cadence after which polled data is stale.
pub const CADENCE_MULTIPLE: i64 = 3;

impl Freshness {
    /// Build the freshness of a figure observed at `as_of_ms`, evaluated at `now_ms`.
    ///
    /// `cadence_ms` is the polling period of the source (ignored for digest and WebSocket).
    #[must_use]
    pub fn compute(
        source: FreshnessSource,
        as_of_ms: i64,
        now_ms: i64,
        cadence_ms: i64,
        has_positions: bool,
    ) -> Self {
        let age = now_ms - as_of_ms;
        let stale = match source {
            FreshnessSource::Digest => age > DIGEST_STALE_MS,
            FreshnessSource::Ws => has_positions && age > WS_STALE_MS,
            FreshnessSource::Rest | FreshnessSource::Sqlite | FreshnessSource::Python => {
                age > CADENCE_MULTIPLE * cadence_ms
            }
        };
        Self {
            as_of_ms,
            source,
            stale,
        }
    }

    /// Age in ms at server time `server_now_ms` (never negative). The client corrects its own
    /// clock with the offset learnt from the heartbeat before calling this.
    #[must_use]
    pub fn age_ms(&self, server_now_ms: i64) -> i64 {
        (server_now_ms - self.as_of_ms).max(0)
    }
}

/// A sum that leaves stale items out.
#[derive(Debug, Clone, PartialEq)]
pub struct FreshSum {
    pub total: f64,
    pub included: u32,
    /// Keys of the excluded items, in input order.
    pub excluded: Vec<String>,
}

/// Sum values, excluding those whose freshness is stale or whose value is missing.
#[must_use]
pub fn sum_fresh<'a>(
    items: impl IntoIterator<Item = (&'a str, Option<f64>, &'a Freshness)>,
) -> FreshSum {
    let mut s = FreshSum {
        total: 0.0,
        included: 0,
        excluded: Vec::new(),
    };
    for (key, value, fresh) in items {
        match value.filter(|v| v.is_finite()) {
            Some(v) if !fresh.stale => {
                s.total += v;
                s.included += 1;
            }
            _ => s.excluded.push(key.to_owned()),
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digest_is_stale_after_120_seconds() {
        let f = |age| Freshness::compute(FreshnessSource::Digest, 0, age, 5_000, true);
        assert!(!f(120_000).stale);
        assert!(f(120_001).stale);
    }

    #[test]
    fn polled_sources_are_stale_after_three_cadences() {
        for src in [
            FreshnessSource::Rest,
            FreshnessSource::Sqlite,
            FreshnessSource::Python,
        ] {
            assert!(!Freshness::compute(src, 0, 180_000, 60_000, true).stale);
            assert!(Freshness::compute(src, 0, 180_001, 60_000, true).stale);
        }
    }

    #[test]
    fn silent_websocket_is_only_stale_with_open_positions() {
        assert!(Freshness::compute(FreshnessSource::Ws, 0, 130_000, 0, true).stale);
        assert!(!Freshness::compute(FreshnessSource::Ws, 0, 130_000, 0, false).stale);
        assert!(!Freshness::compute(FreshnessSource::Ws, 0, 119_000, 0, true).stale);
    }

    #[test]
    fn age_is_never_negative() {
        let f = Freshness::compute(FreshnessSource::Rest, 1_000, 2_000, 1_000, false);
        assert_eq!(f.age_ms(1_500), 500);
        assert_eq!(f.age_ms(500), 0);
    }

    #[test]
    fn stale_and_missing_values_are_excluded_from_sums() {
        let fresh = Freshness {
            as_of_ms: 0,
            source: FreshnessSource::Ws,
            stale: false,
        };
        let stale = Freshness {
            stale: true,
            ..fresh
        };
        let s = sum_fresh([
            ("a", Some(10.0), &fresh),
            ("b", Some(5.0), &stale),
            ("c", None, &fresh),
            ("d", Some(2.5), &fresh),
        ]);
        assert_eq!(s.total, 12.5);
        assert_eq!(s.included, 2);
        assert_eq!(s.excluded, ["b", "c"]);
    }
}
