//! Rate limits and lockouts (03 section 3.3).
//!
//! * login and bootstrap: a quota per client address and one for everybody (GCRA, from
//!   `governor`), plus a lockout of an address after too many failures;
//! * actions: a quota per session.

use std::collections::HashMap;
use std::net::IpAddr;
use std::num::NonZeroU32;
use std::sync::Mutex;
use std::time::Duration;

use governor::clock::{Clock, DefaultClock};
use governor::{DefaultDirectRateLimiter, DefaultKeyedRateLimiter, Quota, RateLimiter};

use crate::config::AuthSection;

/// Failures older than this are forgotten.
const FAILURE_WINDOW_MS: i64 = 15 * 60 * 1000;
/// Addresses remembered by the failure tracker.
const MAX_TRACKED: usize = 10_000;

fn nz(n: u32) -> NonZeroU32 {
    NonZeroU32::new(n.max(1)).unwrap_or(NonZeroU32::MIN)
}

#[derive(Debug, Default, Clone, Copy)]
struct Failures {
    count: u32,
    first_ms: i64,
    locked_until_ms: i64,
}

/// A refusal: how long to wait.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limited {
    pub retry_after_ms: u64,
}

/// All the limiters.
pub struct Limits {
    per_ip: DefaultKeyedRateLimiter<IpAddr>,
    global: DefaultDirectRateLimiter,
    actions: DefaultKeyedRateLimiter<String>,
    failures: Mutex<HashMap<IpAddr, Failures>>,
    lockout_after: u32,
    lockout_ms: i64,
    clock: DefaultClock,
}

impl Limits {
    #[must_use]
    pub fn new(auth: &AuthSection) -> Self {
        let per_min = |n: u32| Quota::per_minute(nz(n)).allow_burst(nz(n));
        Self {
            per_ip: RateLimiter::keyed(per_min(auth.login_rate_per_min)),
            global: RateLimiter::direct(per_min(auth.global_login_rate_per_min)),
            actions: RateLimiter::keyed(per_min(auth.actions_per_min)),
            failures: Mutex::new(HashMap::new()),
            lockout_after: auth.lockout_after_failures.max(1),
            lockout_ms: i64::from(auth.lockout_minutes.max(1)) * 60_000,
            clock: DefaultClock::default(),
        }
    }

    fn wait_ms(&self, d: Duration) -> u64 {
        u64::try_from(d.as_millis()).unwrap_or(u64::MAX).max(1)
    }

    /// Count a login or bootstrap attempt of `ip`.
    ///
    /// # Errors
    /// [`Limited`] when the address is locked out or over a quota.
    pub fn check_login(&self, ip: IpAddr, now_ms: i64) -> Result<(), Limited> {
        if let Some(f) = self
            .failures
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&ip)
            && f.locked_until_ms > now_ms
        {
            return Err(Limited {
                retry_after_ms: u64::try_from(f.locked_until_ms - now_ms).unwrap_or(1),
            });
        }
        self.per_ip.check_key(&ip).map_err(|n| Limited {
            retry_after_ms: self.wait_ms(n.wait_time_from(self.clock.now())),
        })?;
        self.global.check().map_err(|n| Limited {
            retry_after_ms: self.wait_ms(n.wait_time_from(self.clock.now())),
        })
    }

    /// A failed attempt. Returns `true` when this one locked the address out.
    pub fn record_failure(&self, ip: IpAddr, now_ms: i64) -> bool {
        let mut map = self
            .failures
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if map.len() >= MAX_TRACKED {
            map.retain(|_, f| {
                f.locked_until_ms > now_ms || now_ms - f.first_ms < FAILURE_WINDOW_MS
            });
            if map.len() >= MAX_TRACKED {
                map.clear();
            }
        }
        let f = map.entry(ip).or_default();
        if now_ms - f.first_ms > FAILURE_WINDOW_MS || f.count == 0 {
            f.first_ms = now_ms;
            f.count = 0;
        }
        f.count += 1;
        if f.count >= self.lockout_after {
            f.locked_until_ms = now_ms + self.lockout_ms;
            f.count = 0;
            return true;
        }
        false
    }

    /// A successful attempt clears the failures of the address.
    pub fn record_success(&self, ip: IpAddr) {
        self.failures
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&ip);
    }

    /// Count a write action of a session.
    ///
    /// # Errors
    /// [`Limited`] when the session is over its quota.
    pub fn check_action(&self, session_id: &str) -> Result<(), Limited> {
        self.actions
            .check_key(&session_id.to_owned())
            .map_err(|n| Limited {
                retry_after_ms: self.wait_ms(n.wait_time_from(self.clock.now())),
            })
    }

    /// Drop the state of keys that have fully recovered (called now and then).
    pub fn housekeeping(&self) {
        self.per_ip.retain_recent();
        self.actions.retain_recent();
        self.per_ip.shrink_to_fit();
        self.actions.shrink_to_fit();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn auth(per_min: u32, global: u32, lock_after: u32) -> AuthSection {
        AuthSection {
            login_rate_per_min: per_min,
            global_login_rate_per_min: global,
            lockout_after_failures: lock_after,
            lockout_minutes: 15,
            actions_per_min: 3,
            ..AuthSection::default()
        }
    }

    fn ip(n: u8) -> IpAddr {
        IpAddr::from([10, 0, 0, n])
    }

    #[test]
    fn an_address_gets_its_burst_then_is_told_how_long_to_wait() {
        let l = Limits::new(&auth(5, 100, 100));
        for _ in 0..5 {
            l.check_login(ip(1), 0).unwrap();
        }
        let e = l.check_login(ip(1), 0).unwrap_err();
        assert!(e.retry_after_ms > 0 && e.retry_after_ms <= 12_000, "{e:?}");
        // Another address is not affected.
        l.check_login(ip(2), 0).unwrap();
    }

    #[test]
    fn the_global_quota_binds_all_addresses_together() {
        let l = Limits::new(&auth(100, 4, 100));
        for n in 0..4 {
            l.check_login(ip(n), 0).unwrap();
        }
        assert!(l.check_login(ip(9), 0).is_err());
    }

    #[test]
    fn enough_failures_lock_an_address_out_until_the_delay_passes() {
        let l = Limits::new(&auth(1000, 1000, 3));
        assert!(!l.record_failure(ip(1), 1_000));
        assert!(!l.record_failure(ip(1), 2_000));
        assert!(l.record_failure(ip(1), 3_000), "third failure locks");
        let e = l.check_login(ip(1), 4_000).unwrap_err();
        assert!(e.retry_after_ms > 14 * 60_000, "{e:?}");
        assert!(l.check_login(ip(2), 4_000).is_ok());
        assert!(l.check_login(ip(1), 3_000 + 15 * 60_000 + 1).is_ok());
    }

    #[test]
    fn a_success_clears_the_failures_and_old_failures_do_not_count() {
        let l = Limits::new(&auth(1000, 1000, 3));
        l.record_failure(ip(1), 0);
        l.record_failure(ip(1), 1);
        l.record_success(ip(1));
        assert!(!l.record_failure(ip(1), 2), "counter restarted");
        l.record_failure(ip(2), 0);
        l.record_failure(ip(2), 1);
        // The window passed: the first two are forgotten.
        assert!(!l.record_failure(ip(2), FAILURE_WINDOW_MS + 10));
    }

    #[test]
    fn actions_are_limited_per_session() {
        let l = Limits::new(&auth(5, 5, 5));
        for _ in 0..3 {
            l.check_action("s1").unwrap();
        }
        assert!(l.check_action("s1").is_err());
        assert!(l.check_action("s2").is_ok());
    }
}
