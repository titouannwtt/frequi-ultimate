//! The ftcache daemon poller and the ticker poller (03 sections 4.2 and 4.4).
//!
//! Only the five read-only operations of `fg_sources::ftcache::DaemonOp` can be issued: the
//! [`DaemonClient`] trait has no other method. Calls are serialised (one connection at a time)
//! and their cadences are 5 s for the digest and the incident log, 15 s for the daemon status,
//! 60 s for the statistics; the status and the statistics speed up while the health panel is
//! open. In steady state that is about 0.5 request per second.

use std::sync::Arc;
use std::time::Duration;

use fg_core::model::Ticker;
use fg_sources::traits::{DaemonClient, TickerSource};
use tokio::time::Instant;

use crate::msg::Msg;
use crate::shared::Shared;

/// Incidents older than this are not fetched at startup.
const EVENTS_BACKFILL_S: f64 = 600.0;

fn jitter(base: Duration, fraction: f64, salt: u32) -> Duration {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.subsec_nanos())
        .wrapping_add(salt.wrapping_mul(7919));
    let unit = f64::from(nanos % 2000) / 1000.0 - 1.0;
    base.mul_f64(1.0 + fraction * unit)
}

pub(crate) async fn run_daemon(shared: Arc<Shared>, daemon: Arc<dyn DaemonClient>) {
    let cad = shared.cfg.cadences.clone();
    let jit = cad.jitter;
    let now = Instant::now();
    // Staggered first runs: the digest first, the rest a little later.
    let mut digest_due = now;
    let mut status_due = now + Duration::from_millis(300);
    let mut events_due = now + Duration::from_millis(600);
    let mut stats_due = now + Duration::from_millis(900);
    let mut cursor_s: f64 = (shared.now_ms() as f64) / 1000.0 - EVENTS_BACKFILL_S;
    loop {
        let next = digest_due.min(status_due).min(events_due).min(stats_due);
        tokio::time::sleep_until(next).await;
        let now = Instant::now();
        let viewed = shared.views.health_viewed();
        if now >= digest_due {
            digest_due = now + jitter(cad.digest, jit, 1);
            let at_ms = shared.now_ms();
            let msg = match daemon.summary_get(None).await {
                Ok(summary) => Msg::Digest { at_ms, summary },
                Err(_) => Msg::DigestFailed { at_ms },
            };
            let _ = shared.core_tx.send(msg).await;
        } else if now >= status_due {
            let c = cad.fleet_status;
            status_due = now + jitter(if viewed { c.viewed } else { c.normal }, jit, 2);
            if let Ok(status) = daemon.fleet_status().await {
                let _ = shared
                    .core_tx
                    .send(Msg::DaemonStatus {
                        at_ms: shared.now_ms(),
                        status: Box::new(status),
                    })
                    .await;
            }
        } else if now >= events_due {
            events_due = now + jitter(cad.fleet_events, jit, 3);
            if let Ok(ev) = daemon.fleet_events(cursor_s, 200).await {
                let fresh: Vec<_> = ev.events.into_iter().filter(|e| e.ts > cursor_s).collect();
                if let Some(max) = fresh.iter().map(|e| e.ts).reduce(f64::max) {
                    cursor_s = max;
                }
                if !fresh.is_empty() {
                    let _ = shared
                        .core_tx
                        .send(Msg::DaemonEvents {
                            at_ms: shared.now_ms(),
                            events: fresh,
                        })
                        .await;
                }
            }
        } else if now >= stats_due {
            let c = cad.daemon_stats;
            stats_due = now + jitter(if viewed { c.viewed } else { c.normal }, jit, 4);
            if let Ok(stats) = daemon.stats().await {
                let _ = shared
                    .core_tx
                    .send(Msg::DaemonStats {
                        at_ms: shared.now_ms(),
                        stats: Box::new(stats),
                    })
                    .await;
            }
        }
    }
}

pub(crate) async fn run_ticker(shared: Arc<Shared>, source: Arc<dyn TickerSource>) {
    loop {
        if let Ok(tickers) = source.tickers().await {
            let tickers: Vec<Ticker> = tickers;
            let _ = shared
                .core_tx
                .send(Msg::Tickers {
                    at_ms: shared.now_ms(),
                    tickers,
                })
                .await;
        }
        tokio::time::sleep(jitter(shared.cfg.cadences.ticker, 0.1, 5)).await;
    }
}
