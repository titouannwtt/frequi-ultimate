//! Global request budget towards the bots (03 sections 4.3 and 12).
//!
//! Two limits apply to every REST request the engine issues:
//!
//! * a **token bucket** (`rate_per_s` sustained, `burst` tokens of headroom) that makes the
//!   sustained request rate a hard property of the process instead of a hope: in any window of
//!   `T` seconds at most `rate_per_s * T + burst` tokens are granted, whatever the number of bots
//!   or of connected clients. Waiters are served in arrival order.
//! * a **semaphore** (`max_in_flight`, 6 by default) bounding the requests in flight.
//!
//! Writes (actions of the user) are never delayed by the bucket, a forced exit must not queue
//! behind polling; they are counted so that the totals stay honest.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};
use tokio::time::Instant;

/// Settings of the budget.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BudgetConfig {
    /// Sustained requests per second, all bots together. The spec ceiling is 3 req/s; the
    /// default leaves a margin for the token refreshes the REST clients do on their own
    /// (about one per bot per 12 minutes) and for writes.
    pub rate_per_s: f64,
    /// Bucket capacity: the spike a full resynchronisation may use before it is paced.
    pub burst: u32,
    /// Requests in flight at the same time.
    pub max_in_flight: usize,
}

impl Default for BudgetConfig {
    fn default() -> Self {
        Self {
            rate_per_s: 2.8,
            burst: 30,
            max_in_flight: 6,
        }
    }
}

/// Counters of the budget, for the health channel and for tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct BudgetStats {
    /// Tokens granted to reads since the start.
    pub granted: u64,
    /// Writes sent (not limited, only counted).
    pub writes: u64,
    /// Total time reads spent waiting for a token, in milliseconds.
    pub waited_ms: u64,
}

struct Bucket {
    tokens: f64,
    last: Instant,
}

/// The shared budget. Cheap to clone through [`Arc`].
pub struct RequestBudget {
    cfg: BudgetConfig,
    bucket: Mutex<Bucket>,
    /// Arrival order: a waiter holds this lock while it sleeps for its tokens.
    queue: Mutex<()>,
    in_flight: Arc<Semaphore>,
    granted: AtomicU64,
    writes: AtomicU64,
    waited_ms: AtomicU64,
}

/// Shortest sleep of a waiter.
const MIN_WAIT: Duration = Duration::from_millis(1);

/// Held while one request is in flight.
pub struct Permit {
    _slot: OwnedSemaphorePermit,
}

impl RequestBudget {
    #[must_use]
    pub fn new(cfg: BudgetConfig) -> Arc<Self> {
        let burst = f64::from(cfg.burst.max(1));
        Arc::new(Self {
            cfg,
            bucket: Mutex::new(Bucket {
                tokens: burst,
                last: Instant::now(),
            }),
            queue: Mutex::new(()),
            in_flight: Arc::new(Semaphore::new(cfg.max_in_flight.max(1))),
            granted: AtomicU64::new(0),
            writes: AtomicU64::new(0),
            waited_ms: AtomicU64::new(0),
        })
    }

    #[must_use]
    pub fn config(&self) -> BudgetConfig {
        self.cfg
    }

    #[must_use]
    pub fn stats(&self) -> BudgetStats {
        BudgetStats {
            granted: self.granted.load(Ordering::Relaxed),
            writes: self.writes.load(Ordering::Relaxed),
            waited_ms: self.waited_ms.load(Ordering::Relaxed),
        }
    }

    /// Wait for `tokens` tokens and a free in-flight slot. The request is the caller's to send;
    /// drop the permit when it is done.
    pub async fn acquire(&self, tokens: u32) -> Permit {
        let started = Instant::now();
        let tokens = f64::from(tokens.max(1)).min(f64::from(self.cfg.burst.max(1)));
        {
            let _turn = self.queue.lock().await;
            loop {
                let wait = {
                    let mut b = self.bucket.lock().await;
                    let now = Instant::now();
                    let elapsed = now.duration_since(b.last).as_secs_f64();
                    b.last = now;
                    b.tokens = (b.tokens + elapsed * self.cfg.rate_per_s)
                        .min(f64::from(self.cfg.burst.max(1)));
                    // The epsilon absorbs float error: 0.9999999999999999 of a token is a token.
                    if b.tokens + 1e-9 >= tokens {
                        b.tokens -= tokens;
                        None
                    } else {
                        Some((tokens - b.tokens) / self.cfg.rate_per_s.max(1e-6))
                    }
                };
                match wait {
                    None => break,
                    // Never less than a millisecond: a sleep of zero returns at once and, on a
                    // clock that does not move on its own, would spin forever (B45).
                    Some(secs) => {
                        tokio::time::sleep(Duration::from_secs_f64(secs).max(MIN_WAIT)).await;
                    }
                }
            }
        }
        // `Semaphore::acquire_owned` only fails when the semaphore is closed, which never happens.
        let slot = Arc::clone(&self.in_flight)
            .acquire_owned()
            .await
            .unwrap_or_else(|_| unreachable!("the in-flight semaphore is never closed"));
        self.granted.fetch_add(tokens as u64, Ordering::Relaxed);
        let waited = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
        self.waited_ms.fetch_add(waited, Ordering::Relaxed);
        Permit { _slot: slot }
    }

    /// Pay `tokens` for a request that must not queue behind the pollers (the proof of identity
    /// of a login). It goes out at once; the bucket is left in debt, so that the pollers wait
    /// longer afterwards and the sustained rate of the whole process holds. The debt is bounded
    /// by one burst: past it, the caller waits like everybody else.
    pub async fn debit(&self, tokens: u32) {
        let burst = f64::from(self.cfg.burst.max(1));
        let t = f64::from(tokens.max(1));
        {
            let mut b = self.bucket.lock().await;
            let now = Instant::now();
            let elapsed = now.duration_since(b.last).as_secs_f64();
            b.last = now;
            b.tokens = (b.tokens + elapsed * self.cfg.rate_per_s).min(burst);
            if b.tokens - t >= -burst {
                b.tokens -= t;
                self.granted
                    .fetch_add(tokens.max(1).into(), Ordering::Relaxed);
                return;
            }
        }
        drop(self.acquire(tokens).await);
    }

    /// Account a write; never waits.
    pub fn note_write(&self) {
        self.writes.fetch_add(1, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn budget(rate: f64, burst: u32) -> Arc<RequestBudget> {
        RequestBudget::new(BudgetConfig {
            rate_per_s: rate,
            burst,
            max_in_flight: 6,
        })
    }

    #[tokio::test(start_paused = true)]
    async fn the_burst_is_free_then_requests_are_paced_at_the_rate() {
        let b = budget(2.0, 4);
        let t0 = Instant::now();
        for _ in 0..4 {
            drop(b.acquire(1).await);
        }
        assert!(t0.elapsed() < Duration::from_millis(10));
        // The fifth token has to be earned: 0.5 s at 2 per second.
        drop(b.acquire(1).await);
        let waited = t0.elapsed();
        assert!(waited >= Duration::from_millis(499), "{waited:?}");
        assert!(waited < Duration::from_millis(600), "{waited:?}");
    }

    /// B45: a deficit of a few femtoseconds became `sleep(0)`, which on a paused clock never lets
    /// time advance (a livelock in tests, a hot loop for a few nanoseconds in production). The
    /// scenario runs on its own thread so that a regression fails by timeout instead of hanging.
    #[test]
    fn a_float_sized_deficit_never_spins_on_a_clock_that_does_not_move() {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_time()
                .start_paused(true)
                .build()
                .unwrap();
            rt.block_on(async {
                // Awkward rates make `tokens + elapsed * rate` land just below a whole token.
                for rate in [2.8, 3.0, 0.7, 11.3] {
                    let b = budget(rate, 30);
                    let t0 = Instant::now();
                    for _ in 0..400 {
                        drop(b.acquire(1).await);
                    }
                    // 400 requests, 30 of them free: the rest is paced at the rate.
                    let expected = Duration::from_secs_f64(370.0 / rate);
                    let took = t0.elapsed();
                    assert!(took >= expected.mul_f64(0.99), "{rate}: {took:?}");
                    assert!(took <= expected.mul_f64(1.02), "{rate}: {took:?}");
                }
            });
            let _ = tx.send(());
        });
        rx.recv_timeout(Duration::from_secs(20))
            .expect("the budget spun without letting the clock advance");
    }

    #[tokio::test(start_paused = true)]
    async fn granted_tokens_never_exceed_rate_times_window_plus_burst() {
        // 50 greedy tasks hammer the budget for 100 virtual seconds.
        let b = budget(3.0, 10);
        let t0 = Instant::now();
        let mut tasks = Vec::new();
        for _ in 0..50 {
            let b = Arc::clone(&b);
            tasks.push(tokio::spawn(async move {
                let mut n = 0u64;
                while t0.elapsed() < Duration::from_secs(100) {
                    drop(b.acquire(1).await);
                    n += 1;
                }
                n
            }));
        }
        let mut total = 0;
        for t in tasks {
            total += t.await.unwrap();
        }
        // The window is 100 s plus the last waiters finishing after the deadline.
        let upper = 3.0 * (t0.elapsed().as_secs_f64()) + 10.0;
        assert!((total as f64) <= upper + 1.0, "{total} > {upper}");
        // And the budget is actually used, not wasted.
        assert!(total as f64 >= 3.0 * 100.0 - 1.0, "{total}");
        assert_eq!(b.stats().granted, total);
    }

    #[tokio::test(start_paused = true)]
    async fn waiters_are_served_in_arrival_order() {
        let b = budget(1.0, 1);
        drop(b.acquire(1).await); // drain the bucket
        let order = Arc::new(std::sync::Mutex::new(Vec::new()));
        let mut tasks = Vec::new();
        for i in 0..5u32 {
            let (b, order) = (Arc::clone(&b), Arc::clone(&order));
            tasks.push(tokio::spawn(async move {
                drop(b.acquire(1).await);
                order.lock().unwrap().push(i);
            }));
            // Let the task reach the queue before the next one is spawned.
            tokio::task::yield_now().await;
        }
        for t in tasks {
            t.await.unwrap();
        }
        assert_eq!(*order.lock().unwrap(), vec![0, 1, 2, 3, 4]);
    }

    #[tokio::test(start_paused = true)]
    async fn a_debit_goes_out_at_once_and_the_pollers_pay_for_it() {
        let b = budget(2.0, 4);
        for _ in 0..4 {
            drop(b.acquire(1).await);
        }
        let t0 = Instant::now();
        // The bucket is empty and the caller still does not wait.
        b.debit(1).await;
        assert_eq!(t0.elapsed(), Duration::ZERO);
        // The next poller waits for the token it needs plus the one that was lent: 1 s at 2/s.
        drop(b.acquire(1).await);
        let waited = t0.elapsed();
        assert!(waited >= Duration::from_millis(999), "{waited:?}");
        assert!(waited < Duration::from_millis(1100), "{waited:?}");
        assert_eq!(b.stats().granted, 6);
    }

    #[tokio::test(start_paused = true)]
    async fn the_debt_of_debits_is_bounded_by_one_burst() {
        let b = budget(2.0, 4);
        for _ in 0..4 {
            drop(b.acquire(1).await);
        }
        let t0 = Instant::now();
        // Four more tokens of debt are lent, the fifth waits for the bucket to climb back.
        for _ in 0..4 {
            b.debit(1).await;
        }
        assert_eq!(t0.elapsed(), Duration::ZERO);
        b.debit(1).await;
        // From -4 to a whole token at 2 per second: 2.5 s.
        assert!(
            t0.elapsed() >= Duration::from_millis(2_499),
            "{:?}",
            t0.elapsed()
        );
    }

    #[tokio::test(start_paused = true)]
    async fn writes_bypass_the_bucket_but_are_counted() {
        let b = budget(1.0, 1);
        drop(b.acquire(1).await);
        let t0 = Instant::now();
        for _ in 0..10 {
            b.note_write();
        }
        assert_eq!(t0.elapsed(), Duration::ZERO);
        assert_eq!(b.stats().writes, 10);
    }

    #[tokio::test(start_paused = true)]
    async fn in_flight_requests_are_capped() {
        let b = RequestBudget::new(BudgetConfig {
            rate_per_s: 1000.0,
            burst: 1000,
            max_in_flight: 3,
        });
        let live = Arc::new(AtomicU64::new(0));
        let peak = Arc::new(AtomicU64::new(0));
        let mut tasks = Vec::new();
        for _ in 0..20 {
            let (b, live, peak) = (Arc::clone(&b), Arc::clone(&live), Arc::clone(&peak));
            tasks.push(tokio::spawn(async move {
                let _p = b.acquire(1).await;
                let now = live.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(now, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(50)).await;
                live.fetch_sub(1, Ordering::SeqCst);
            }));
        }
        for t in tasks {
            t.await.unwrap();
        }
        assert_eq!(peak.load(Ordering::SeqCst), 3);
    }
}
