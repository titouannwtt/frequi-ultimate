//! The whitelist of what may be forwarded to a bot's Python API, and the cache of the short reads
//! (03 section 8.2).
//!
//! Anything that is not in [`classify`] is a 404. The path is checked on its raw form: only plain
//! segments are accepted (see [`fg_sources::botrest::proxy_path_is_plain`]), so a `..` or an
//! encoded slash can never walk out of a whitelisted prefix.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};

use fg_sources::botrest::{ProxyMethod, ProxyResponse};
use tokio::sync::Mutex as AsyncMutex;

use crate::error::ApiFailure;

/// What kind of call a path is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Class {
    /// A short read, cached and counted in the request budget.
    CachedRead,
    /// A read of the Python tooling (long timeout, not counted: it must not starve the pollers).
    LongRead,
    /// A POST that only computes (validation, diff, pairlist evaluation): forwarded as is.
    ComputePost,
    /// Anything that changes something: idempotency key, audit, one attempt.
    Mutation,
}

/// The rule that applies to a request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rule {
    pub class: Class,
    pub timeout: Duration,
    /// Base lifetime of a cached answer (`pair_candles` is refined by the timeframe).
    pub cache_ttl: Duration,
    /// Needs the bot name typed back (`X-Confirm-Bot`).
    pub confirm: bool,
    pub max_body: usize,
    /// Name in the audit trail.
    pub label: String,
    /// The answer is a property of the whole fleet, not of the bot asked (reconciliation): one
    /// cache entry for everybody, and the client's query string is not forwarded.
    pub wallet_level: bool,
    /// The read waits for a token of the request budget and holds an in-flight slot while it runs.
    /// Not for a sweep that reaches the exchange and lasts tens of seconds: it would pin slots the
    /// pollers need.
    pub budgeted: bool,
}

const SHORT: Duration = Duration::from_secs(20);
/// The sweep of the wallets asks the exchange, with retries of its own on the Python side. Past
/// this it is told as a failure (and rests, see [`ProxyCache::get_or_fetch_resting`]) instead of
/// being waited for during the five minutes of a long job.
const RECON_TIMEOUT: Duration = Duration::from_secs(40);
const LONG: Duration = Duration::from_secs(300);
const BODY_DEFAULT: usize = 64 * 1024;
const BODY_STRATDEV: usize = 2 * 1024 * 1024;

fn is_or_under(path: &str, root: &str) -> bool {
    path == root
        || path
            .strip_prefix(root)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// Classify `METHOD /api/v1/<path>`. `path` has no leading slash and has passed
/// [`fg_sources::botrest::proxy_path_is_plain`]. `None` means "not whitelisted".
#[must_use]
pub fn classify(method: ProxyMethod, path: &str) -> Option<Rule> {
    let mk = |class, timeout, ttl_s: u64, confirm, max_body, wallet_level| Rule {
        class,
        timeout,
        cache_ttl: Duration::from_secs(ttl_s),
        confirm,
        max_body,
        label: format!("proxy:{} {path}", method.as_str()),
        wallet_level,
        budgeted: class == Class::CachedRead && !wallet_level,
    };
    let body = if is_or_under(path, "stratdev") {
        BODY_STRATDEV
    } else {
        BODY_DEFAULT
    };

    if method == ProxyMethod::Get {
        // Short, cached reads.
        for (root, ttl) in [
            ("pair_candles", 5),
            ("pair_history", 60),
            ("plot_config", 60),
            ("signal_summary", 30),
            ("volume_history", 300),
            ("strategies", 60),
            ("rate_metrics", 15),
        ] {
            if path == root {
                return Some(mk(Class::CachedRead, SHORT, ttl, false, body, false));
            }
        }
        if is_or_under(path, "strategy") && path != "strategy" {
            return Some(mk(Class::CachedRead, SHORT, 60, false, body, false));
        }
        // `GET /backtest/abort` stops a running backtest: a mutation that freqtrade serves as a
        // GET. It has no idempotency key and no audit row here, so it is not forwarded at all.
        if path == "backtest/abort" {
            return None;
        }
        // The one call that reaches the exchange (through the bot). The Python side sweeps every
        // live wallet on each call, so the cache is fleet-wide: at most one sweep per
        // `min_sweep_interval_s`, whoever asks and through whichever bot.
        if path == "fleetview/reconciliation" {
            return Some(mk(Class::CachedRead, RECON_TIMEOUT, 60, false, body, true));
        }
        // Python tooling: (root, the bare root is a route too).
        for (root, bare) in [
            ("stratdev", false),
            ("replay", true),
            ("backtest", true),
            ("download_data", false),
            ("background", false),
            ("pairlists", false),
            ("fleetview", false),
        ] {
            if (is_or_under(path, root) && path != root) || (bare && path == root) {
                return Some(mk(Class::LongRead, LONG, 0, false, body, false));
            }
        }
        return None;
    }

    // Writes. Compute-only POSTs first.
    if method == ProxyMethod::Post
        && matches!(
            path,
            "stratdev/editor/validate" | "stratdev/diff" | "pairlists/evaluate"
        )
    {
        return Some(mk(Class::ComputePost, LONG, 0, false, body, false));
    }
    let dangerous = matches!(
        path,
        "fleetview/reconciliation/resolve"
            | "fleetview/reconciliation/realign"
            | "stratdev/editor/file"
            | "blacklist"
            | "replay"
            | "replay/restore"
    );
    let allowed = dangerous
        || is_or_under(path, "stratdev")
        || is_or_under(path, "replay")
        || is_or_under(path, "backtest")
        || path == "download_data"
        || is_or_under(path, "pairlists");
    // `fleetview` has no other write than the two reconciliation ones above.
    if !allowed {
        return None;
    }
    // `blacklist` takes POST and DELETE only; the reconciliation writes take POST only.
    if (path == "blacklist" && !matches!(method, ProxyMethod::Post | ProxyMethod::Delete))
        || (path.starts_with("fleetview/") && method != ProxyMethod::Post)
    {
        return None;
    }
    Some(mk(Class::Mutation, LONG, 0, dangerous, body, false))
}

/// Seconds in a candle of `tf` (`5m`, `1h`, `1d`, `1w`, `1M`).
#[must_use]
pub fn timeframe_secs(tf: &str) -> Option<u64> {
    let (num, unit) = tf.split_at(tf.len().checked_sub(1)?);
    let n: u64 = num.parse().ok().filter(|n| *n > 0)?;
    let unit = match unit {
        "s" => 1,
        "m" => 60,
        "h" => 3_600,
        "d" => 86_400,
        "w" => 7 * 86_400,
        "M" => 30 * 86_400,
        _ => return None,
    };
    Some(n * unit)
}

/// Time left until the next candle of `tf` closes, bounded to something sensible for a cache.
#[must_use]
pub fn candle_ttl(tf: &str, now_ms: i64) -> Duration {
    let Some(secs) = timeframe_secs(tf) else {
        return Duration::from_secs(5);
    };
    let ms = i64::try_from(secs * 1000).unwrap_or(i64::MAX);
    let left = ms - now_ms.rem_euclid(ms);
    Duration::from_millis(u64::try_from(left).unwrap_or(5_000))
        .clamp(Duration::from_secs(2), Duration::from_secs(300))
}

/// The value of a query parameter.
#[must_use]
pub fn query_param<'a>(query: &'a str, name: &str) -> Option<&'a str> {
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == name).then_some(v)
    })
}

/// A request never asks a bot for more than this many candles at a time.
pub const MAX_CANDLES: u64 = 5_000;

/// Rewrite `limit=` of a candle query so that it does not exceed [`MAX_CANDLES`].
#[must_use]
pub fn clamp_candle_limit(query: &str) -> String {
    query
        .split('&')
        .map(|kv| match kv.split_once('=') {
            Some(("limit", v)) => match v.parse::<u64>() {
                Ok(n) if n > MAX_CANDLES => format!("limit={MAX_CANDLES}"),
                _ => kv.to_owned(),
            },
            _ => kv.to_owned(),
        })
        .collect::<Vec<_>>()
        .join("&")
}

/// Scope of the fleet-wide answers (reconciliation).
pub const FLEET_SCOPE: &str = "fleet";

/// Where a cached answer is filed: the scope is the bot, or [`FLEET_SCOPE`] for fleet-wide reads.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CacheKey {
    pub scope: String,
    pub path: String,
    pub query: String,
}

struct Entry {
    at: Instant,
    ttl: Duration,
    response: Arc<ProxyResponse>,
}

/// A failed sweep, and whether the wallet must rest after it (the exchange is the likely cause)
/// or not (this bot is the problem: another may serve the same answer).
#[derive(Debug, Clone)]
pub struct SweepFailure {
    pub failure: ApiFailure,
    pub rest: bool,
}

/// A failure kept for a while.
struct Failed {
    at: Instant,
    hold: Duration,
    failure: ApiFailure,
}

const MAX_ENTRIES: usize = 256;
const MAX_BYTES: usize = 32 * 1024 * 1024;
const MAX_ENTRY_BYTES: usize = 2 * 1024 * 1024;

/// Short-lived cache of proxied reads, with one fetch at a time per key.
pub struct ProxyCache {
    entries: std::sync::Mutex<HashMap<CacheKey, Entry>>,
    flights: AsyncMutex<HashMap<CacheKey, Arc<AsyncMutex<()>>>>,
    /// Failures that must not be retried at once, see [`Self::get_or_fetch_resting`].
    failures: std::sync::Mutex<HashMap<CacheKey, Failed>>,
    /// Lifetime of wallet-level answers (`hyperliquid.min_sweep_interval_s`).
    pub wallet_ttl: Duration,
}

impl ProxyCache {
    #[must_use]
    pub fn new(wallet_ttl: Duration) -> Self {
        Self {
            entries: std::sync::Mutex::new(HashMap::new()),
            flights: AsyncMutex::new(HashMap::new()),
            failures: std::sync::Mutex::new(HashMap::new()),
            wallet_ttl,
        }
    }

    fn fresh(&self, key: &CacheKey) -> Option<Arc<ProxyResponse>> {
        let g = self
            .entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        g.get(key)
            .filter(|e| e.at.elapsed() < e.ttl)
            .map(|e| Arc::clone(&e.response))
    }

    fn store(&self, key: CacheKey, ttl: Duration, response: Arc<ProxyResponse>) {
        if response.status != 200 || response.body.len() > MAX_ENTRY_BYTES || ttl.is_zero() {
            return;
        }
        let mut g = self
            .entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        g.retain(|_, e| e.at.elapsed() < e.ttl);
        let mut bytes: usize = g.values().map(|e| e.response.body.len()).sum();
        while g.len() >= MAX_ENTRIES || bytes + response.body.len() > MAX_BYTES {
            let Some(oldest) = g.iter().min_by_key(|(_, e)| e.at).map(|(k, _)| k.clone()) else {
                break;
            };
            if let Some(e) = g.remove(&oldest) {
                bytes -= e.response.body.len();
            }
        }
        g.insert(
            key,
            Entry {
                at: Instant::now(),
                ttl,
                response,
            },
        );
    }

    /// The cached answer, or the result of `fetch` (run by one caller at a time per key; the
    /// others wait for it and read the cache). Only a successful answer is kept.
    pub async fn get_or_fetch<E, F, Fut>(
        &self,
        key: CacheKey,
        ttl: Duration,
        fetch: F,
    ) -> Result<(Arc<ProxyResponse>, bool), E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<ProxyResponse, E>>,
    {
        if let Some(hit) = self.fresh(&key) {
            return Ok((hit, true));
        }
        let gate = {
            let mut f = self.flights.lock().await;
            f.retain(|_, g| Arc::strong_count(g) > 1);
            Arc::clone(f.entry(key.clone()).or_default())
        };
        let _turn = gate.lock().await;
        if let Some(hit) = self.fresh(&key) {
            return Ok((hit, true));
        }
        let response = Arc::new(fetch().await?);
        self.store(key, ttl, Arc::clone(&response));
        Ok((response, false))
    }

    /// The recent failure of `key`, with the time left to wait told as `retry_after_ms`.
    fn resting(&self, key: &CacheKey) -> Option<ApiFailure> {
        let mut g = self
            .failures
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        g.retain(|_, f| f.at.elapsed() < f.hold);
        g.get(key).map(|f| {
            let left = f.hold.saturating_sub(f.at.elapsed());
            let mut failure = f.failure.clone();
            failure.error.retry_after_ms =
                Some(u64::try_from(left.as_millis()).unwrap_or(u64::MAX));
            failure
        })
    }

    /// Like [`Self::get_or_fetch`], for a read that reaches the exchange: a failed fetch is kept
    /// for `rest`, and every call in that time gets the same failure (with `retry_after_ms`)
    /// without a new fetch. A retry button, a second tab or a second bot of the fleet cannot start
    /// another sweep while the first one failed, so a struggling exchange is asked at most once
    /// per `rest`, whoever insists.
    ///
    /// # Errors
    /// The failure of the fetch, or the one kept from the last attempt.
    pub async fn get_or_fetch_resting<F, Fut>(
        &self,
        key: CacheKey,
        ttl: Duration,
        rest: Duration,
        fetch: F,
    ) -> Result<(Arc<ProxyResponse>, bool), ApiFailure>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<ProxyResponse, SweepFailure>>,
    {
        if let Some(hit) = self.fresh(&key) {
            return Ok((hit, true));
        }
        if let Some(f) = self.resting(&key) {
            return Err(f);
        }
        let gate = {
            let mut f = self.flights.lock().await;
            f.retain(|_, g| Arc::strong_count(g) > 1);
            Arc::clone(f.entry(key.clone()).or_default())
        };
        let _turn = gate.lock().await;
        if let Some(hit) = self.fresh(&key) {
            return Ok((hit, true));
        }
        // Whoever waited on the gate sees the failure of the one that held it.
        if let Some(f) = self.resting(&key) {
            return Err(f);
        }
        match fetch().await {
            Ok(response) => {
                let response = Arc::new(response);
                self.store(key, ttl, Arc::clone(&response));
                Ok((response, false))
            }
            Err(SweepFailure {
                failure,
                rest: tired,
            }) => {
                if tired && !rest.is_zero() {
                    self.failures
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .insert(
                            key,
                            Failed {
                                at: Instant::now(),
                                hold: rest,
                                failure: failure.clone(),
                            },
                        );
                }
                Err(failure)
            }
        }
    }

    /// Drop every answer filed under `scope` (a write just made them untrue).
    pub fn forget_scope(&self, scope: &str) {
        self.entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain(|k, _| k.scope != scope);
    }

    /// Number of live entries (tests).
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    fn rule(m: ProxyMethod, p: &str) -> Option<Rule> {
        classify(m, p)
    }

    #[test]
    fn short_reads_are_cached_and_counted_long_ones_are_not() {
        for p in [
            "pair_candles",
            "plot_config",
            "strategy/MyStrat",
            "strategies",
            "rate_metrics",
        ] {
            assert_eq!(
                rule(ProxyMethod::Get, p).unwrap().class,
                Class::CachedRead,
                "{p}"
            );
        }
        for p in [
            "stratdev/runs",
            "stratdev/editor/file",
            "replay",
            "replay/queue",
            "backtest",
            "backtest/history",
            "background/abc",
            "pairlists/available",
            "fleetview/overview",
        ] {
            let r = rule(ProxyMethod::Get, p).unwrap();
            assert_eq!(r.class, Class::LongRead, "{p}");
            assert_eq!(r.timeout, LONG);
        }
        let recon = rule(ProxyMethod::Get, "fleetview/reconciliation").unwrap();
        assert!(recon.wallet_level && recon.class == Class::CachedRead);
    }

    #[test]
    fn the_reconciliation_sweep_has_a_deadline_and_never_pins_a_slot_of_the_pollers() {
        let recon = rule(ProxyMethod::Get, "fleetview/reconciliation").unwrap();
        assert_eq!(recon.timeout, RECON_TIMEOUT);
        assert!(
            recon.timeout < Duration::from_secs(60),
            "shorter than the 60 s a client waits, so the client reads our error"
        );
        assert!(
            !recon.budgeted,
            "a sweep of tens of seconds holds no budget slot"
        );
        for p in ["pair_candles", "plot_config", "strategies"] {
            assert!(rule(ProxyMethod::Get, p).unwrap().budgeted, "{p}");
        }
    }

    #[test]
    fn what_can_change_something_is_a_mutation_and_the_dangerous_ones_need_a_confirmation() {
        for (m, p, confirm) in [
            (ProxyMethod::Post, "fleetview/reconciliation/resolve", true),
            (ProxyMethod::Post, "fleetview/reconciliation/realign", true),
            (ProxyMethod::Post, "stratdev/editor/file", true),
            (ProxyMethod::Post, "replay", true),
            (ProxyMethod::Delete, "replay", true),
            (ProxyMethod::Post, "replay/restore", true),
            (ProxyMethod::Post, "blacklist", true),
            (ProxyMethod::Delete, "blacklist", true),
            (ProxyMethod::Post, "stratdev/jobs/start", false),
            (ProxyMethod::Delete, "stratdev/hyperopt/x.fthypt", false),
            (ProxyMethod::Post, "backtest", false),
            (ProxyMethod::Post, "download_data", false),
        ] {
            let r = rule(m, p).unwrap_or_else(|| panic!("{m:?} {p}"));
            assert_eq!(r.class, Class::Mutation, "{m:?} {p}");
            assert_eq!(r.confirm, confirm, "{m:?} {p}");
        }
        for p in [
            "stratdev/editor/validate",
            "stratdev/diff",
            "pairlists/evaluate",
        ] {
            assert_eq!(
                rule(ProxyMethod::Post, p).unwrap().class,
                Class::ComputePost,
                "{p}"
            );
        }
    }

    #[test]
    fn everything_else_is_refused() {
        for (m, p) in [
            (ProxyMethod::Post, "forceexit"),
            (ProxyMethod::Post, "forceenter"),
            (ProxyMethod::Post, "stop"),
            (ProxyMethod::Post, "reload_config"),
            (ProxyMethod::Delete, "trades/5"),
            (ProxyMethod::Post, "token/login"),
            (ProxyMethod::Get, "token/refresh"),
            (ProxyMethod::Get, "status"),
            (ProxyMethod::Get, "show_config"),
            (ProxyMethod::Get, "stratdev"),
            (ProxyMethod::Get, "strategy"),
            (ProxyMethod::Get, "stratdevil/x"),
            (ProxyMethod::Get, "replayer"),
            (ProxyMethod::Get, "backtest/abort"),
            (ProxyMethod::Put, "blacklist"),
            (ProxyMethod::Delete, "fleetview/reconciliation/resolve"),
            (ProxyMethod::Post, "fleetview/overview"),
            (ProxyMethod::Get, ""),
        ] {
            assert!(rule(m, p).is_none(), "{m:?} {p} must not be forwarded");
        }
    }

    #[test]
    fn stratdev_bodies_may_be_larger() {
        assert_eq!(
            rule(ProxyMethod::Post, "stratdev/editor/file")
                .unwrap()
                .max_body,
            BODY_STRATDEV
        );
        assert_eq!(
            rule(ProxyMethod::Post, "replay").unwrap().max_body,
            BODY_DEFAULT
        );
    }

    #[test]
    fn candle_cache_lives_until_the_next_close() {
        // 5m candles, 100 s after a close: 200 s left.
        let close = 1_700_000_100_000; // a multiple of 5 minutes
        let t = close + 100_000;
        assert_eq!(candle_ttl("5m", t), Duration::from_secs(200));
        assert_eq!(candle_ttl("1d", t), Duration::from_secs(300), "capped");
        assert_eq!(candle_ttl("nonsense", t), Duration::from_secs(5));
        assert_eq!(timeframe_secs("1h"), Some(3600));
        assert_eq!(timeframe_secs("0m"), None);
    }

    #[test]
    fn candle_requests_are_capped() {
        assert_eq!(
            clamp_candle_limit("pair=ETH/USDC:USDC&timeframe=5m&limit=99999"),
            "pair=ETH/USDC:USDC&timeframe=5m&limit=5000"
        );
        assert_eq!(clamp_candle_limit("limit=300&a=1"), "limit=300&a=1");
        assert_eq!(query_param("a=1&timeframe=5m", "timeframe"), Some("5m"));
    }

    fn resp(body: &str) -> ProxyResponse {
        ProxyResponse {
            status: 200,
            content_type: Some("application/json".into()),
            body: body.as_bytes().to_vec(),
            latency_ms: 1,
        }
    }

    fn key(n: &str) -> CacheKey {
        CacheKey {
            scope: "local:1".into(),
            path: n.into(),
            query: String::new(),
        }
    }

    #[tokio::test]
    async fn concurrent_readers_trigger_one_fetch() {
        let cache = Arc::new(ProxyCache::new(Duration::from_secs(60)));
        let hits = Arc::new(AtomicUsize::new(0));
        let tasks: Vec<_> = (0..8)
            .map(|_| {
                let (c, h) = (Arc::clone(&cache), Arc::clone(&hits));
                tokio::spawn(async move {
                    c.get_or_fetch::<(), _, _>(key("a"), Duration::from_secs(30), || async move {
                        h.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(50)).await;
                        Ok(resp("{}"))
                    })
                    .await
                    .unwrap()
                    .1
                })
            })
            .collect();
        let mut from_cache = 0;
        for t in tasks {
            from_cache += usize::from(t.await.unwrap());
        }
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        assert_eq!(from_cache, 7);
    }

    #[tokio::test]
    async fn only_successes_are_kept_and_they_expire() {
        let cache = ProxyCache::new(Duration::from_secs(60));
        let bad = cache
            .get_or_fetch::<(), _, _>(key("e"), Duration::from_secs(30), || async {
                Ok(ProxyResponse {
                    status: 500,
                    ..resp("x")
                })
            })
            .await
            .unwrap();
        assert!(!bad.1);
        assert!(cache.is_empty());
        let err = cache
            .get_or_fetch(key("f"), Duration::from_secs(30), || async {
                Err::<ProxyResponse, _>("boom")
            })
            .await;
        assert_eq!(err.unwrap_err(), "boom");
        cache
            .get_or_fetch::<(), _, _>(key("s"), Duration::from_millis(30), || async {
                Ok(resp("1"))
            })
            .await
            .unwrap();
        assert_eq!(cache.len(), 1);
        tokio::time::sleep(Duration::from_millis(60)).await;
        let again = cache
            .get_or_fetch::<(), _, _>(key("s"), Duration::from_millis(30), || async {
                Ok(resp("2"))
            })
            .await
            .unwrap();
        assert!(!again.1, "expired entries are fetched again");
    }

    #[tokio::test]
    async fn the_cache_is_bounded() {
        let cache = ProxyCache::new(Duration::from_secs(60));
        for i in 0..MAX_ENTRIES + 20 {
            cache
                .get_or_fetch::<(), _, _>(key(&i.to_string()), Duration::from_secs(60), || async {
                    Ok(resp("{}"))
                })
                .await
                .unwrap();
        }
        assert!(cache.len() <= MAX_ENTRIES);
    }

    fn sweep_failure(rest: bool) -> SweepFailure {
        SweepFailure {
            failure: ApiFailure::new(
                fg_core::protocol::ErrorCode::BotUnreachable,
                "the bot did not answer in time",
            ),
            rest,
        }
    }

    #[tokio::test]
    async fn a_failed_sweep_rests_the_fleet_and_tells_how_long() {
        let cache = Arc::new(ProxyCache::new(Duration::from_secs(60)));
        let fetches = Arc::new(AtomicUsize::new(0));
        let ask = |rest_for: Duration| {
            let (c, f) = (Arc::clone(&cache), Arc::clone(&fetches));
            async move {
                c.get_or_fetch_resting(key("recon"), Duration::from_secs(60), rest_for, || async {
                    f.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(30)).await;
                    Err(sweep_failure(true))
                })
                .await
            }
        };
        // Eight callers at once (tabs, retries, other bots): a single sweep, one failure for all.
        let results = futures_join_all((0..8).map(|_| ask(Duration::from_millis(400)))).await;
        assert_eq!(fetches.load(Ordering::SeqCst), 1);
        assert!(results.iter().all(Result::is_err));
        // Later callers get the kept failure at once, with the time left.
        let again = ask(Duration::from_millis(400)).await.unwrap_err();
        assert_eq!(
            fetches.load(Ordering::SeqCst),
            1,
            "no new sweep while it rests"
        );
        let left = again.error.retry_after_ms.expect("the time left is told");
        assert!(left > 0 && left <= 400, "{left}");
        // Once the rest is over the exchange is asked again.
        tokio::time::sleep(Duration::from_millis(450)).await;
        let _ = ask(Duration::from_millis(400)).await;
        assert_eq!(fetches.load(Ordering::SeqCst), 2);
    }

    async fn futures_join_all<T>(
        it: impl Iterator<Item = impl Future<Output = T> + Send + 'static>,
    ) -> Vec<T>
    where
        T: Send + 'static,
    {
        let tasks: Vec<_> = it.map(tokio::spawn).collect();
        let mut out = Vec::new();
        for t in tasks {
            out.push(t.await.unwrap());
        }
        out
    }

    #[tokio::test]
    async fn a_failure_that_is_the_bots_own_does_not_rest_the_fleet() {
        let cache = ProxyCache::new(Duration::from_secs(60));
        let fetches = AtomicUsize::new(0);
        for _ in 0..3 {
            let r = cache
                .get_or_fetch_resting(
                    key("recon"),
                    Duration::from_secs(60),
                    Duration::from_secs(60),
                    || async {
                        fetches.fetch_add(1, Ordering::SeqCst);
                        Err(sweep_failure(false))
                    },
                )
                .await;
            assert!(r.is_err());
        }
        assert_eq!(
            fetches.load(Ordering::SeqCst),
            3,
            "another bot may still serve the sweep"
        );
        // A success is kept like any answer and ends the story.
        let ok = cache
            .get_or_fetch_resting(
                key("recon"),
                Duration::from_secs(60),
                Duration::from_secs(60),
                || async { Ok(resp("{}")) },
            )
            .await
            .unwrap();
        assert!(!ok.1);
        let hit = cache
            .get_or_fetch_resting(
                key("recon"),
                Duration::from_secs(60),
                Duration::from_secs(60),
                || async { Err(sweep_failure(true)) },
            )
            .await
            .unwrap();
        assert!(hit.1);
    }
}
