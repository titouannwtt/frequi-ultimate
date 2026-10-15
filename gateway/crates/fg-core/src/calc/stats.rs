//! Totals shown under a filtered trade list.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Totals of a set of closed trades. Trades whose profit is unknown are counted apart and left
/// out of every other figure.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct TradeTotals {
    /// Trades with a known profit.
    pub count: u32,
    pub unknown: u32,
    pub sum: f64,
    pub wins: u32,
    pub losses: u32,
    /// `wins / count`; `None` without any known trade.
    pub winrate: Option<f64>,
    /// Gross profit over gross loss; `None` when there is no loss (undefined, not infinite).
    pub profit_factor: Option<f64>,
    /// Worst single loss in absolute terms (<= 0); a percentage would confuse risk and profit.
    pub worst_abs: Option<f64>,
    pub best_abs: Option<f64>,
}

/// Aggregate the `profit_abs` of closed trades (`None` = unknown).
#[must_use]
pub fn trade_totals(profits: &[Option<f64>]) -> TradeTotals {
    let mut t = TradeTotals {
        count: 0,
        unknown: 0,
        sum: 0.0,
        wins: 0,
        losses: 0,
        winrate: None,
        profit_factor: None,
        worst_abs: None,
        best_abs: None,
    };
    let (mut gross_win, mut gross_loss) = (0.0_f64, 0.0_f64);
    for p in profits {
        let Some(p) = p.filter(|p| p.is_finite()) else {
            t.unknown += 1;
            continue;
        };
        t.count += 1;
        t.sum += p;
        if p > 0.0 {
            t.wins += 1;
            gross_win += p;
        } else if p < 0.0 {
            t.losses += 1;
            gross_loss += -p;
        }
        t.worst_abs = Some(t.worst_abs.map_or(p, |w| w.min(p)));
        t.best_abs = Some(t.best_abs.map_or(p, |b| b.max(p)));
    }
    if t.count > 0 {
        t.winrate = Some(f64::from(t.wins) / f64::from(t.count));
    }
    if gross_loss > 0.0 {
        t.profit_factor = Some(gross_win / gross_loss);
    }
    t
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn totals_count_unknown_apart() {
        let t = trade_totals(&[Some(10.0), Some(-4.0), None, Some(0.0), Some(6.0)]);
        assert_eq!((t.count, t.unknown), (4, 1));
        assert_eq!(t.sum, 12.0);
        assert_eq!((t.wins, t.losses), (2, 1));
        assert_eq!(t.winrate, Some(0.5));
        assert_eq!(t.profit_factor, Some(4.0));
        assert_eq!(t.worst_abs, Some(-4.0));
        assert_eq!(t.best_abs, Some(10.0));
    }

    #[test]
    fn no_loss_means_undefined_profit_factor() {
        let t = trade_totals(&[Some(1.0), Some(2.0)]);
        assert_eq!(t.profit_factor, None);
        assert_eq!(t.winrate, Some(1.0));
        let e = trade_totals(&[]);
        assert_eq!(e.winrate, None);
        assert_eq!(e.worst_abs, None);
    }
}
