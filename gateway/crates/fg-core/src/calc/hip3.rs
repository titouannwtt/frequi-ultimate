//! HIP-3 (builder dex) coin naming and market classification.
//!
//! The same instrument is spelled differently depending on where it comes from:
//! freqtrade pairs use `XYZ-NVDA/USDC:USDC`, Hyperliquid uses `xyz:NVDA`. Both map to the single
//! net-exposure key `xyz:NVDA`, so a long and a short on the same instrument net out whichever
//! spelling each bot used. Crypto coins keep their name as is (`BTC`, `kPEPE`).

use std::collections::BTreeSet;
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Dexes recognised in the `DEX-SYMBOL` spelling when no explicit list is given.
pub const DEFAULT_DEXES: &[&str] = &["xyz"];

/// Index symbols listed on the xyz dex.
static XYZ_INDICES: LazyLock<BTreeSet<&'static str>> = LazyLock::new(|| {
    [
        "SP500", "XYZ100", "JP225", "KR200", "DAX", "FTSE100", "EU50", "US2000", "HSI", "NIKKEI",
    ]
    .into_iter()
    .collect()
});

/// Commodity symbols listed on the xyz dex.
static XYZ_COMMODITIES: LazyLock<BTreeSet<&'static str>> = LazyLock::new(|| {
    [
        "GOLD",
        "SILVER",
        "COPPER",
        "PLATINUM",
        "PALLADIUM",
        "BRENTOIL",
        "WTI",
        "CL",
        "NATGAS",
        "GAS",
        "CORN",
        "WHEAT",
        "SUGAR",
        "COFFEE",
        "COCOA",
        "SOYBEAN",
    ]
    .into_iter()
    .collect()
});

/// Market a pair trades on. `Mixed` only describes a whitelist that spans several markets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum Market {
    Crypto,
    XyzStocks,
    XyzIndices,
    XyzCommodities,
    /// A HIP-3 dex other than xyz (no finer classification is known).
    Hip3Other,
    Mixed,
}

impl Market {
    /// `true` for any builder-dex market.
    #[must_use]
    pub fn is_hip3(self) -> bool {
        matches!(
            self,
            Self::XyzStocks | Self::XyzIndices | Self::XyzCommodities | Self::Hip3Other
        )
    }
}

/// Parsed pair.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PairInfo {
    pub market: Market,
    /// Builder dex (lowercase) for HIP-3 pairs.
    pub dex: Option<String>,
    /// Instrument symbol without dex prefix (`NVDA`, `BTC`).
    pub symbol: String,
    /// Key used to net exposure across bots: `BTC` or `xyz:NVDA`.
    pub coin_key: String,
}

/// Parse a freqtrade pair (`BASE/QUOTE:SETTLE`) or a bare coin.
///
/// `dashed_dexes` lists the dexes recognised in the `DEX-SYMBOL` spelling; the `dex:SYMBOL`
/// spelling is unambiguous (a colon before the slash only occurs on HIP-3 names) and is always
/// recognised.
#[must_use]
pub fn parse_pair(pair: &str, dashed_dexes: &[&str]) -> PairInfo {
    let base = pair.split('/').next().unwrap_or(pair).trim();
    if let Some((dex, symbol)) = base.split_once(':')
        && !dex.is_empty()
        && !symbol.is_empty()
    {
        return hip3(dex, symbol);
    }
    if let Some((dex, symbol)) = base.split_once('-')
        && !symbol.is_empty()
        && dashed_dexes.iter().any(|d| d.eq_ignore_ascii_case(dex))
    {
        return hip3(dex, symbol);
    }
    PairInfo {
        market: Market::Crypto,
        dex: None,
        symbol: base.to_owned(),
        coin_key: base.to_owned(),
    }
}

fn hip3(dex: &str, symbol: &str) -> PairInfo {
    let dex = dex.to_ascii_lowercase();
    let upper = symbol.to_ascii_uppercase();
    let market = if dex == "xyz" {
        if XYZ_INDICES.contains(upper.as_str()) {
            Market::XyzIndices
        } else if XYZ_COMMODITIES.contains(upper.as_str()) {
            Market::XyzCommodities
        } else {
            // Unknown xyz symbols default to stocks.
            Market::XyzStocks
        }
    } else {
        Market::Hip3Other
    };
    PairInfo {
        market,
        coin_key: format!("{dex}:{symbol}"),
        dex: Some(dex),
        symbol: symbol.to_owned(),
    }
}

/// Market of a bot, derived from its whitelist: `Mixed` as soon as two markets appear, `None` for
/// an empty or unknown whitelist.
#[must_use]
pub fn whitelist_market(whitelist: &[String], dashed_dexes: &[&str]) -> Option<Market> {
    let mut found: Option<Market> = None;
    for pair in whitelist {
        let m = parse_pair(pair, dashed_dexes).market;
        match found {
            None => found = Some(m),
            Some(prev) if prev != m => return Some(Market::Mixed),
            Some(_) => {}
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> PairInfo {
        parse_pair(s, DEFAULT_DEXES)
    }

    #[test]
    fn crypto_keeps_its_name() {
        let i = p("BTC/USDC:USDC");
        assert_eq!(i.market, Market::Crypto);
        assert_eq!(i.coin_key, "BTC");
        assert_eq!(i.dex, None);
        assert_eq!(p("kPEPE/USDC:USDC").coin_key, "kPEPE");
    }

    #[test]
    fn both_spellings_share_one_key() {
        let a = p("XYZ-NVDA/USDC:USDC");
        let b = p("xyz:NVDA/USDC:USDC");
        assert_eq!(a.coin_key, "xyz:NVDA");
        assert_eq!(a.coin_key, b.coin_key);
        assert_eq!(a.market, Market::XyzStocks);
        assert_eq!(a.dex.as_deref(), Some("xyz"));
        assert_eq!(a.symbol, "NVDA");
    }

    #[test]
    fn xyz_indices_and_commodities() {
        assert_eq!(p("XYZ-SP500/USDC:USDC").market, Market::XyzIndices);
        assert_eq!(p("xyz:GOLD").market, Market::XyzCommodities);
        assert_eq!(p("XYZ-UNKNOWNTHING/USDC:USDC").market, Market::XyzStocks);
    }

    #[test]
    fn other_dex_is_hip3_other() {
        let i = p("flx:TSLA/USDC:USDC");
        assert_eq!(i.market, Market::Hip3Other);
        assert_eq!(i.coin_key, "flx:TSLA");
        // The dashed spelling needs the dex to be declared, otherwise it is a crypto name.
        assert_eq!(p("FLX-TSLA/USDC:USDC").market, Market::Crypto);
        assert_eq!(
            parse_pair("FLX-TSLA/USDC:USDC", &["xyz", "flx"]).coin_key,
            "flx:TSLA"
        );
    }

    #[test]
    fn degenerate_names_do_not_panic() {
        assert_eq!(p("").market, Market::Crypto);
        assert_eq!(p("XYZ-/USDC:USDC").market, Market::Crypto);
        assert_eq!(p(":NVDA").market, Market::Crypto);
    }

    #[test]
    fn whitelist_market_detects_mixed() {
        let wl = |v: &[&str]| v.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        assert_eq!(whitelist_market(&[], DEFAULT_DEXES), None);
        assert_eq!(
            whitelist_market(&wl(&["BTC/USDC:USDC", "ETH/USDC:USDC"]), DEFAULT_DEXES),
            Some(Market::Crypto)
        );
        assert_eq!(
            whitelist_market(
                &wl(&["XYZ-NVDA/USDC:USDC", "XYZ-TSLA/USDC:USDC"]),
                DEFAULT_DEXES
            ),
            Some(Market::XyzStocks)
        );
        assert_eq!(
            whitelist_market(&wl(&["BTC/USDC:USDC", "XYZ-NVDA/USDC:USDC"]), DEFAULT_DEXES),
            Some(Market::Mixed)
        );
        assert!(Market::XyzIndices.is_hip3());
        assert!(!Market::Crypto.is_hip3());
        assert!(!Market::Mixed.is_hip3());
    }
}
