//! Wall clock abstraction. The engine never calls `SystemTime` directly so that tests can run on
//! tokio's virtual time (`start_paused`) and still get coherent millisecond timestamps.

use std::time::{SystemTime, UNIX_EPOCH};

/// Source of "now" in milliseconds since the Unix epoch.
pub trait Clock: Send + Sync {
    fn now_ms(&self) -> i64;
}

/// The real clock.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
    }
}

/// A clock that follows tokio's (possibly paused) time from a chosen origin.
#[derive(Debug, Clone, Copy)]
pub struct TokioClock {
    origin_ms: i64,
    start: tokio::time::Instant,
}

impl TokioClock {
    /// `origin_ms` is the wall-clock time at the moment of creation.
    #[must_use]
    pub fn new(origin_ms: i64) -> Self {
        Self {
            origin_ms,
            start: tokio::time::Instant::now(),
        }
    }
}

impl Clock for TokioClock {
    fn now_ms(&self) -> i64 {
        self.origin_ms + i64::try_from(self.start.elapsed().as_millis()).unwrap_or(i64::MAX)
    }
}
