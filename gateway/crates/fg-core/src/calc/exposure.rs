//! Exposure, computed at wallet level.
//!
//! Hyperliquid nets positions per coin on a wallet: a long of one bot and a short of another on
//! the same coin offset each other on the exchange. Exposure is therefore aggregated per coin key
//! (see `hip3::PairInfo::coin_key`) over the positions of a wallet, never summed per bot.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Side;

/// A position reduced to its exposure.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ExposurePosition {
    pub coin: String,
    pub side: Side,
    /// Absolute notional in stake currency.
    pub notional: f64,
}

/// Exposure of a set of positions.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
pub struct Exposure {
    pub long: f64,
    pub short: f64,
    /// `long - short`.
    pub net: f64,
    /// Signed notional per coin, longs positive.
    pub net_by_coin: BTreeMap<String, f64>,
    /// Gross exposure after netting per coin (what the exchange sees).
    pub gross_netted: f64,
}

/// Aggregate the positions of one wallet. `long` and `short` are the gross sides before netting.
#[must_use]
pub fn exposure(positions: &[ExposurePosition]) -> Exposure {
    let mut e = Exposure::default();
    for p in positions.iter().filter(|p| p.notional.is_finite()) {
        let signed = match p.side {
            Side::Long => {
                e.long += p.notional;
                p.notional
            }
            Side::Short => {
                e.short += p.notional;
                -p.notional
            }
        };
        *e.net_by_coin.entry(p.coin.clone()).or_insert(0.0) += signed;
    }
    e.net = e.long - e.short;
    e.gross_netted = e.net_by_coin.values().map(|v| v.abs()).sum();
    e
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pos(coin: &str, side: Side, notional: f64) -> ExposurePosition {
        ExposurePosition {
            coin: coin.into(),
            side,
            notional,
        }
    }

    #[test]
    fn long_and_short_on_one_coin_net_out() {
        let e = exposure(&[
            pos("BTC", Side::Long, 300.0),
            pos("BTC", Side::Short, 100.0),
            pos("ETH", Side::Short, 50.0),
        ]);
        assert_eq!(e.long, 300.0);
        assert_eq!(e.short, 150.0);
        assert_eq!(e.net, 150.0);
        assert_eq!(e.net_by_coin["BTC"], 200.0);
        assert_eq!(e.net_by_coin["ETH"], -50.0);
        assert_eq!(e.gross_netted, 250.0);
    }

    #[test]
    fn hip3_spellings_net_together_when_keyed_alike() {
        use crate::calc::hip3::{DEFAULT_DEXES, parse_pair};
        let a = parse_pair("XYZ-NVDA/USDC:USDC", DEFAULT_DEXES).coin_key;
        let b = parse_pair("xyz:NVDA/USDC:USDC", DEFAULT_DEXES).coin_key;
        let e = exposure(&[pos(&a, Side::Long, 100.0), pos(&b, Side::Short, 100.0)]);
        assert_eq!(e.net_by_coin["xyz:NVDA"], 0.0);
        assert_eq!(e.gross_netted, 0.0);
    }

    #[test]
    fn empty_and_non_finite_are_harmless() {
        assert_eq!(exposure(&[]), Exposure::default());
        let e = exposure(&[pos("BTC", Side::Long, f64::NAN)]);
        assert_eq!(e.long, 0.0);
    }
}
