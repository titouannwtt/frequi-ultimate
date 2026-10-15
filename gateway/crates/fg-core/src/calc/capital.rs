//! Capital of a bot and of a set of bots on shared wallets.
//!
//! All the Hyperliquid bots of this fleet trade one wallet: `balance.total` reported by each bot
//! is the whole wallet, so summing it across bots multiplies the wallet by the number of bots
//! (bug B10: the denominator of every percentage exploded). The rules:
//!
//! 1. The **starting capital** of a bot is its own allocation: `available_capital -
//!    capital_withdrawal` from its configuration. It is never derived from the wallet total.
//! 2. Without a configured allocation, a bot that does *not* share its wallet may derive it from
//!    its own balance minus its profit. A bot on a shared wallet stays unknown.
//! 3. Wallet-level figures (equity, exposure) are counted **once per wallet**, however many bots
//!    report them, and a stale report is excluded rather than summed.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Where a starting capital comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum CapitalSource {
    /// `available_capital - capital_withdrawal` of the bot configuration.
    Config,
    /// Derived from the bot's own balance minus its profit (never from a shared wallet).
    Derived,
    Unknown,
}

/// Inputs for [`starting_capital`].
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(default)]
pub struct CapitalInput {
    pub available_capital: Option<f64>,
    pub capital_withdrawal: Option<f64>,
    /// More than one bot trades the wallet.
    pub wallet_shared: bool,
    /// `balance.total_bot` when the bot manages its own balance.
    pub bot_managed_balance: Option<f64>,
    /// `balance.total` (the whole wallet on a shared wallet).
    pub balance_total: Option<f64>,
    pub profit_all_coin: Option<f64>,
}

/// Starting capital and its provenance.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
pub struct Capital {
    pub value: Option<f64>,
    pub source: CapitalSource,
}

const UNKNOWN: Capital = Capital {
    value: None,
    source: CapitalSource::Unknown,
};

fn positive(v: Option<f64>) -> Option<f64> {
    v.filter(|x| x.is_finite() && *x > 0.0)
}

/// Starting capital of one bot, see the module documentation.
#[must_use]
pub fn starting_capital(input: &CapitalInput) -> Capital {
    if let Some(avail) = positive(input.available_capital) {
        let net = avail
            - input
                .capital_withdrawal
                .filter(|w| w.is_finite())
                .unwrap_or(0.0);
        return match positive(Some(net)) {
            Some(value) => Capital {
                value: Some(value),
                source: CapitalSource::Config,
            },
            None => UNKNOWN,
        };
    }
    if input.wallet_shared {
        return UNKNOWN;
    }
    let base = positive(input.bot_managed_balance).or_else(|| positive(input.balance_total));
    match (base, input.profit_all_coin.filter(|p| p.is_finite())) {
        (Some(b), Some(p)) => match positive(Some(b - p)) {
            Some(value) => Capital {
                value: Some(value),
                source: CapitalSource::Derived,
            },
            None => UNKNOWN,
        },
        _ => UNKNOWN,
    }
}

/// Sum of known starting capitals; `unknown` counts the bots left out.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
pub struct CapitalSum {
    pub total: f64,
    pub known: u32,
    pub unknown: u32,
}

/// Sum the starting capitals of several bots. Unknown capitals are counted, never replaced by 0
/// silently: the caller decides whether a partial total may be shown.
#[must_use]
pub fn sum_starting_capital(capitals: &[Option<f64>]) -> CapitalSum {
    let mut s = CapitalSum {
        total: 0.0,
        known: 0,
        unknown: 0,
    };
    for c in capitals {
        match positive(*c) {
            Some(v) => {
                s.total += v;
                s.known += 1;
            }
            None => s.unknown += 1,
        }
    }
    s
}

/// A wallet total as reported by one bot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct WalletReport {
    pub wallet_id: String,
    pub total: Option<f64>,
    pub as_of_ms: i64,
    pub stale: bool,
}

/// Wallet-level equity, once per wallet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct WalletTotals {
    /// Sum over the wallets with a fresh report.
    pub total: f64,
    pub wallets: u32,
    /// Wallets with no fresh report: excluded from the total.
    pub excluded: Vec<String>,
    /// Wallets whose fresh reports disagree by more than 0.01 % (the most recent report wins).
    pub conflicting: Vec<String>,
}

/// Count each wallet once: among the fresh reports of a wallet the most recent wins.
#[must_use]
pub fn wallet_totals(reports: &[WalletReport]) -> WalletTotals {
    let mut by_wallet: BTreeMap<&str, Vec<&WalletReport>> = BTreeMap::new();
    for r in reports {
        by_wallet.entry(r.wallet_id.as_str()).or_default().push(r);
    }
    let mut out = WalletTotals {
        total: 0.0,
        wallets: 0,
        excluded: vec![],
        conflicting: vec![],
    };
    for (id, rs) in by_wallet {
        let fresh: Vec<&&WalletReport> = rs
            .iter()
            .filter(|r| !r.stale && r.total.is_some_and(f64::is_finite))
            .collect();
        let Some(best) = fresh.iter().max_by_key(|r| r.as_of_ms) else {
            out.excluded.push(id.to_owned());
            continue;
        };
        let value = best.total.unwrap_or(0.0);
        if fresh.iter().any(|r| {
            let v = r.total.unwrap_or(0.0);
            (v - value).abs() > value.abs().max(1.0) * 1e-4
        }) {
            out.conflicting.push(id.to_owned());
        }
        out.total += value;
        out.wallets += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_allocation_minus_withdrawal() {
        let c = starting_capital(&CapitalInput {
            available_capital: Some(1500.0),
            capital_withdrawal: Some(200.0),
            wallet_shared: true,
            balance_total: Some(9_000.0),
            ..Default::default()
        });
        assert_eq!(
            c,
            Capital {
                value: Some(1300.0),
                source: CapitalSource::Config
            }
        );
    }

    #[test]
    fn shared_wallet_total_is_never_used() {
        let c = starting_capital(&CapitalInput {
            wallet_shared: true,
            balance_total: Some(9_000.0),
            profit_all_coin: Some(100.0),
            ..Default::default()
        });
        assert_eq!(c.value, None);
        assert_eq!(c.source, CapitalSource::Unknown);
    }

    #[test]
    fn own_wallet_derives_balance_minus_profit() {
        let c = starting_capital(&CapitalInput {
            balance_total: Some(1_250.0),
            profit_all_coin: Some(250.0),
            ..Default::default()
        });
        assert_eq!(
            c,
            Capital {
                value: Some(1_000.0),
                source: CapitalSource::Derived
            }
        );
        // The bot-managed balance wins over the raw total.
        let c = starting_capital(&CapitalInput {
            bot_managed_balance: Some(600.0),
            balance_total: Some(9_999.0),
            profit_all_coin: Some(100.0),
            ..Default::default()
        });
        assert_eq!(c.value, Some(500.0));
    }

    #[test]
    fn non_positive_results_are_unknown() {
        let c = starting_capital(&CapitalInput {
            available_capital: Some(100.0),
            capital_withdrawal: Some(100.0),
            ..Default::default()
        });
        assert_eq!(c.value, None);
        let c = starting_capital(&CapitalInput {
            balance_total: Some(50.0),
            profit_all_coin: Some(80.0),
            ..Default::default()
        });
        assert_eq!(c.value, None);
        assert_eq!(starting_capital(&CapitalInput::default()).value, None);
    }

    #[test]
    fn sums_count_unknowns_apart() {
        let s = sum_starting_capital(&[Some(100.0), None, Some(50.0), Some(0.0)]);
        assert_eq!(
            s,
            CapitalSum {
                total: 150.0,
                known: 2,
                unknown: 2
            }
        );
    }

    fn rep(w: &str, total: f64, at: i64, stale: bool) -> WalletReport {
        WalletReport {
            wallet_id: w.into(),
            total: Some(total),
            as_of_ms: at,
            stale,
        }
    }

    #[test]
    fn a_shared_wallet_is_counted_once() {
        // 24 bots of the same wallet each report 10 000: the wallet is 10 000, not 240 000.
        let reports: Vec<_> = (0..24)
            .map(|i| rep("w1", 10_000.0, 1_000 + i, false))
            .collect();
        let t = wallet_totals(&reports);
        assert_eq!(t.total, 10_000.0);
        assert_eq!(t.wallets, 1);
        assert!(t.excluded.is_empty() && t.conflicting.is_empty());
    }

    #[test]
    fn stale_reports_are_excluded_and_the_latest_fresh_wins() {
        let t = wallet_totals(&[
            rep("w1", 100.0, 10, false),
            rep("w1", 100.002, 20, false),
            rep("w2", 500.0, 5, true),
            rep("w3", 40.0, 5, false),
        ]);
        assert!((t.total - 140.002).abs() < 1e-9);
        assert_eq!(t.wallets, 2);
        assert_eq!(t.excluded, ["w2"]);
        assert!(t.conflicting.is_empty());
    }

    #[test]
    fn disagreeing_reports_are_flagged() {
        let t = wallet_totals(&[rep("w1", 100.0, 10, false), rep("w1", 120.0, 20, false)]);
        assert_eq!(t.total, 120.0);
        assert_eq!(t.conflicting, ["w1"]);
    }
}
