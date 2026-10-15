//! External market ticker (BTC and ETH) from CoinGecko, cached (03 section 4.2, cluster C12).
//!
//! This is the only source of market prices the gateway fetches by itself, and it is **never**
//! the exchange: the hosts this client may contact are an explicit allow list (CoinGecko, plus
//! loopback so tests can run a local server). A failed refresh serves the last value flagged
//! stale; with no value at all the error is returned and the ticker stays hidden.

use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use fg_core::model::{Freshness, FreshnessSource, Ticker};
use serde_json::Value;
use thiserror::Error;

use crate::traits::{BoxFut, TickerSource};

/// Public CoinGecko API.
pub const COINGECKO_BASE: &str = "https://api.coingecko.com/api/v3";

/// Why a ticker could not be produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum TickerError {
    /// The configured URL points to a host the gateway must not call.
    #[error("host not allowed")]
    HostNotAllowed,
    #[error("ticker source unreachable")]
    Unreachable,
    #[error("unexpected ticker answer")]
    Decode,
}

/// Hosts the ticker client may contact.
fn host_allowed(host: &str) -> bool {
    let h = host.trim_matches(['[', ']']).to_ascii_lowercase();
    matches!(
        h.as_str(),
        "api.coingecko.com" | "localhost" | "127.0.0.1" | "::1"
    )
}

/// `(coingecko id, symbol)`.
const COINS: [(&str, &str); 2] = [("bitcoin", "BTC"), ("ethereum", "ETH")];

struct Cached {
    at: Instant,
    as_of_ms: i64,
    tickers: Vec<(String, f64, Option<f64>)>,
}

/// CoinGecko ticker with a TTL cache (120 s by default).
pub struct CoinGecko {
    client: reqwest::Client,
    base: String,
    ttl: Duration,
    cache: Mutex<Option<Cached>>,
}

impl CoinGecko {
    /// # Errors
    /// [`TickerError::HostNotAllowed`] when `base` is not an allowed host.
    pub fn new(client: reqwest::Client, base: &str, ttl: Duration) -> Result<Self, TickerError> {
        // The URL parser is the one reqwest will use: the host checked here is the host called.
        let url = reqwest::Url::parse(base).map_err(|_| TickerError::HostNotAllowed)?;
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(TickerError::HostNotAllowed);
        }
        if !url.host_str().is_some_and(host_allowed) {
            return Err(TickerError::HostNotAllowed);
        }
        Ok(Self {
            client,
            base: base.trim_end_matches('/').to_owned(),
            ttl,
            cache: Mutex::new(None),
        })
    }

    /// Default client: the public API, 120 s cache.
    ///
    /// # Panics
    /// Never: the default base is on the allow list.
    #[must_use]
    pub fn public(client: reqwest::Client) -> Self {
        Self::new(client, COINGECKO_BASE, Duration::from_secs(120)).expect("allowed host")
    }

    fn render(c: &Cached, stale: bool) -> Vec<Ticker> {
        c.tickers
            .iter()
            .map(|(symbol, price, change)| Ticker {
                symbol: symbol.clone(),
                price: *price,
                change_24h_pct: *change,
                freshness: Freshness {
                    as_of_ms: c.as_of_ms,
                    source: FreshnessSource::Rest,
                    stale,
                },
            })
            .collect()
    }

    async fn fetch(&self) -> Result<Cached, TickerError> {
        let ids: Vec<&str> = COINS.iter().map(|(id, _)| *id).collect();
        let url = format!(
            "{}/simple/price?ids={}&vs_currencies=usd&include_24hr_change=true",
            self.base,
            ids.join(",")
        );
        let resp = self
            .client
            .get(url)
            .timeout(Duration::from_secs(8))
            .send()
            .await
            .map_err(|_| TickerError::Unreachable)?;
        if !resp.status().is_success() {
            return Err(TickerError::Unreachable);
        }
        let body: Value = resp.json().await.map_err(|_| TickerError::Decode)?;
        let mut tickers = Vec::new();
        for (id, symbol) in COINS {
            let Some(entry) = body.get(id) else { continue };
            let Some(price) = entry
                .get("usd")
                .and_then(Value::as_f64)
                .filter(|p| p.is_finite() && *p > 0.0)
            else {
                continue;
            };
            let change = entry
                .get("usd_24h_change")
                .and_then(Value::as_f64)
                .filter(|c| c.is_finite());
            tickers.push((symbol.to_owned(), price, change));
        }
        if tickers.is_empty() {
            return Err(TickerError::Decode);
        }
        let as_of_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|d| i64::try_from(d.as_millis()).ok())
            .unwrap_or(0);
        Ok(Cached {
            at: Instant::now(),
            as_of_ms,
            tickers,
        })
    }

    async fn get(&self) -> Result<Vec<Ticker>, TickerError> {
        if let Ok(guard) = self.cache.lock()
            && let Some(c) = guard.as_ref()
            && c.at.elapsed() < self.ttl
        {
            return Ok(Self::render(c, false));
        }
        match self.fetch().await {
            Ok(fresh) => {
                let out = Self::render(&fresh, false);
                if let Ok(mut guard) = self.cache.lock() {
                    *guard = Some(fresh);
                }
                Ok(out)
            }
            Err(e) => {
                // Serve the last known value, flagged stale, rather than hiding it at once.
                if let Ok(guard) = self.cache.lock()
                    && let Some(c) = guard.as_ref()
                {
                    return Ok(Self::render(c, true));
                }
                Err(e)
            }
        }
    }
}

impl TickerSource for CoinGecko {
    fn tickers(&self) -> BoxFut<'_, Result<Vec<Ticker>, TickerError>> {
        Box::pin(self.get())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use super::*;
    use crate::testutil::{FakeHttp, FakeResponse};

    const OK_BODY: &str = r#"{"bitcoin":{"usd":67000.5,"usd_24h_change":1.25},"ethereum":{"usd":3200.0,"usd_24h_change":-0.5}}"#;

    fn client() -> reqwest::Client {
        crate::botrest::build_http_client(&crate::botrest::RestOptions::default())
    }

    #[test]
    fn only_coingecko_and_loopback_are_allowed() {
        assert!(CoinGecko::new(client(), COINGECKO_BASE, Duration::from_secs(1)).is_ok());
        assert!(
            CoinGecko::new(
                client(),
                "http://127.0.0.1:8080/api",
                Duration::from_secs(1)
            )
            .is_ok()
        );
        assert!(CoinGecko::new(client(), "http://[::1]:8080", Duration::from_secs(1)).is_ok());
        for bad in [
            "https://api.hyperliquid.xyz",
            "https://api-ui.hyperliquid.xyz/info",
            "https://example.com",
            "https://api.coingecko.com.evil.test",
            "ftp://api.coingecko.com",
            "api.coingecko.com",
            "https://api.coingecko.com:443@api.hyperliquid.xyz",
            "https://api.coingecko.com@api.hyperliquid.xyz",
            "https://user:pass@api.coingecko.com",
            "https://api.hyperliquid.xyz\\@api.coingecko.com",
            "https://api.hyperliquid.xyz#@api.coingecko.com",
        ] {
            assert_eq!(
                CoinGecko::new(client(), bad, Duration::from_secs(1)).err(),
                Some(TickerError::HostNotAllowed),
                "{bad}"
            );
        }
    }

    #[tokio::test]
    async fn fetches_btc_and_eth_then_serves_from_cache() {
        let fake = FakeHttp::start(|_| FakeResponse::json(200, OK_BODY)).await;
        let cg = CoinGecko::new(
            client(),
            &format!("http://{}", fake.addr),
            Duration::from_secs(60),
        )
        .unwrap();
        let t = cg.tickers().await.unwrap();
        assert_eq!(t.len(), 2);
        assert_eq!(t[0].symbol, "BTC");
        assert!((t[0].price - 67000.5).abs() < 1e-9);
        assert_eq!(t[1].change_24h_pct, Some(-0.5));
        assert!(!t[0].freshness.stale);
        assert!(t[0].freshness.as_of_ms > 1_700_000_000_000);
        cg.tickers().await.unwrap();
        assert_eq!(fake.requests().len(), 1, "second call is a cache hit");
        assert!(fake.requests()[0].target.contains("ids=bitcoin,ethereum"));
    }

    #[tokio::test]
    async fn failures_serve_the_stale_value_or_an_error() {
        let ok = Arc::new(AtomicBool::new(true));
        let hits = Arc::new(AtomicUsize::new(0));
        let (o, h) = (Arc::clone(&ok), Arc::clone(&hits));
        let fake = FakeHttp::start(move |_| {
            h.fetch_add(1, Ordering::SeqCst);
            if o.load(Ordering::SeqCst) {
                FakeResponse::json(200, OK_BODY)
            } else {
                FakeResponse::json(429, "{}")
            }
        })
        .await;
        let cg = CoinGecko::new(
            client(),
            &format!("http://{}", fake.addr),
            Duration::from_millis(30),
        )
        .unwrap();
        assert!(!cg.tickers().await.unwrap()[0].freshness.stale);
        ok.store(false, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(50)).await;
        let stale = cg.tickers().await.unwrap();
        assert!(stale[0].freshness.stale, "last value, flagged stale");
        assert!((stale[0].price - 67000.5).abs() < 1e-9);

        let cold_fake = FakeHttp::start(|_| FakeResponse::json(500, "{}")).await;
        let cold = CoinGecko::new(
            client(),
            &format!("http://{}", cold_fake.addr),
            Duration::from_secs(1),
        )
        .unwrap();
        assert_eq!(cold.tickers().await.unwrap_err(), TickerError::Unreachable);
    }

    #[tokio::test]
    async fn garbage_answers_are_rejected() {
        let fake =
            FakeHttp::start(|_| FakeResponse::json(200, r#"{"bitcoin":{"usd":-1},"other":{}}"#))
                .await;
        let cg = CoinGecko::new(
            client(),
            &format!("http://{}", fake.addr),
            Duration::from_secs(1),
        )
        .unwrap();
        assert_eq!(cg.tickers().await.unwrap_err(), TickerError::Decode);
    }
}
