//! The async runtime of the gateway, built the same way by the binary and by the load test so
//! that what the test measures is what runs.
//!
//! Every thread that allocates keeps a heap of its own in the allocator, a few megabytes resident
//! once it has seen the usual size classes: with 40 bots, a blocking pool of 16 threads made the
//! service 14 MB larger than a pool of 4 (109 against 95 MB resident, measured). The pool is
//! therefore sized for what really runs on it.

/// Threads for blocking work: the ledger reads (`scheduler.ledger_threads` at a time) plus the
/// discovery scan, an order lookup and a password check, which are rare and short.
#[must_use]
pub fn blocking_threads(ledger_threads: usize) -> usize {
    ledger_threads.max(1) + 2
}

/// Build the multi-thread runtime with `workers` worker threads (see
/// [`crate::config::SchedulerSection::workers`]) and `blocking` blocking threads at most (see
/// [`blocking_threads`]).
///
/// # Errors
/// The runtime cannot be created.
pub fn build(workers: usize, blocking: usize) -> std::io::Result<tokio::runtime::Runtime> {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(workers)
        .max_blocking_threads(blocking)
        .thread_name("fg-worker")
        .enable_all()
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pool_has_room_for_the_ledger_reads_and_the_rare_jobs() {
        assert_eq!(blocking_threads(4), 6);
        assert_eq!(blocking_threads(1), 3);
        assert_eq!(blocking_threads(0), 3);
    }
}
