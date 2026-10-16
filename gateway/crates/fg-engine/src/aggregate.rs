//! Aggregates over bots: wallets (each counted once), per-mode totals, drawdown of a set of bots.
//!
//! Rules that hold for every figure here:
//!
//! * Live, dry and replay bots are never summed together: there is one [`ScopeTotals`] per mode.
//! * A wallet shared by several bots is counted once ([`fg_core::calc::capital::wallet_totals`]);
//!   a starting capital is the bot's own `available_capital - capital_withdrawal`, never the
//!   total of a shared wallet.
//! * A figure that is stale or unknown is left out of its sum, and the bot is named in
//!   `excluded_bots`; it is never counted as zero.

use std::collections::{BTreeMap, BTreeSet};

use fg_core::alerts::{Alert, AlertView};
use fg_core::calc::capital::{WalletReport, sum_starting_capital, wallet_totals};
use fg_core::calc::drawdown::{DrawdownInput, DrawdownResult, OpenRisk};
use fg_core::calc::exposure::{ExposurePosition, exposure};
use fg_core::calc::freshness::sum_fresh;
use fg_core::calc::periods::{PeriodKey, Tz, period_cutoff_ms};
use fg_core::identity::BotKey;
use fg_core::model::{
    AlertSummary, BotMode, BotStatus, Freshness, FreshnessGroup, FreshnessSource, ReconSummary,
    ScopeTotals, Severity, Side, WalletRow,
};

use crate::ledger_data::mode_scope;
use crate::runtime::{Assembled, BotRuntime};

/// The bots of one mode, with what the totals need.
pub struct ScopeBots<'a> {
    pub mode: BotMode,
    pub members: Vec<(&'a BotRuntime, &'a Assembled)>,
}

/// Group the bots by mode.
#[must_use]
pub fn by_mode<'a>(
    bots: &'a BTreeMap<BotKey, BotRuntime>,
    assembled: &'a BTreeMap<BotKey, Assembled>,
) -> Vec<ScopeBots<'a>> {
    [BotMode::Live, BotMode::Dry, BotMode::Replay]
        .into_iter()
        .filter_map(|mode| {
            let members: Vec<_> = bots
                .iter()
                .filter(|(_, rt)| rt.meta.mode == mode)
                .filter_map(|(k, rt)| Some((rt, assembled.get(k)?)))
                .collect();
            (!members.is_empty()).then_some(ScopeBots { mode, members })
        })
        .collect()
}

/// Wallet id used for balances: the shared wallet for live bots, the bot itself otherwise.
fn balance_wallet(rt: &BotRuntime) -> String {
    rt.meta
        .wallet_id
        .clone()
        .unwrap_or_else(|| format!("bot:{}", rt.meta.key))
}

fn balance_report(rt: &BotRuntime, a: &Assembled) -> Option<WalletReport> {
    let (b, at) = rt.balance.as_ref()?;
    let capital_fresh = a
        .row
        .freshness
        .get(&FreshnessGroup::Capital)
        .is_some_and(|f| !f.stale);
    Some(WalletReport {
        wallet_id: balance_wallet(rt),
        total: b.total,
        as_of_ms: *at,
        stale: !capital_fresh,
    })
}

/// Number of bots per wallet among all bots (a shared wallet has several).
#[must_use]
pub fn wallet_members(bots: &BTreeMap<BotKey, BotRuntime>) -> BTreeMap<String, usize> {
    let mut m = BTreeMap::new();
    for rt in bots.values() {
        if let Some(w) = &rt.meta.wallet_id {
            *m.entry(w.clone()).or_insert(0) += 1;
        }
    }
    m
}

/// One row per wallet shared (or not) by live bots.
#[must_use]
pub fn build_wallets(
    bots: &BTreeMap<BotKey, BotRuntime>,
    assembled: &BTreeMap<BotKey, Assembled>,
    recon: &BTreeMap<String, ReconSummary>,
    now_ms: i64,
) -> BTreeMap<String, WalletRow> {
    let mut groups: BTreeMap<String, Vec<(&BotRuntime, &Assembled)>> = BTreeMap::new();
    for (k, rt) in bots {
        if let (Some(w), Some(a)) = (&rt.meta.wallet_id, assembled.get(k)) {
            groups.entry(w.clone()).or_default().push((rt, a));
        }
    }
    groups
        .into_iter()
        .map(|(id, members)| {
            let reports: Vec<WalletReport> = members
                .iter()
                .filter_map(|(rt, a)| balance_report(rt, a))
                .collect();
            let totals = wallet_totals(&reports);
            let newest = reports
                .iter()
                .filter(|r| !r.stale)
                .map(|r| r.as_of_ms)
                .max();
            let positions: Vec<ExposurePosition> = members
                .iter()
                .flat_map(|(_, a)| a.positions.iter())
                .map(|p| ExposurePosition {
                    coin: p.coin.clone(),
                    side: p.side,
                    notional: p.notional,
                })
                .collect();
            let exp = exposure(&positions);
            let row = WalletRow {
                address_short: members
                    .iter()
                    .find_map(|(rt, _)| rt.meta.address_short.clone())
                    .unwrap_or_default(),
                bots: members.iter().map(|(rt, _)| rt.meta.key.clone()).collect(),
                equity: (totals.wallets > 0).then_some(totals.total),
                net_exposure: exp.net_by_coin,
                recon: recon.get(&id).cloned(),
                freshness: Freshness {
                    as_of_ms: newest.unwrap_or(0),
                    source: FreshnessSource::Rest,
                    stale: newest.is_none() || now_ms - newest.unwrap_or(0) > 600_000,
                },
                wallet_id: id.clone(),
            };
            (id, row)
        })
        .collect()
}

/// Summary of the alerts of a set of bots (only the ones that are active, i.e. not acknowledged
/// and not silenced).
#[must_use]
pub fn alert_summary(alerts: &[Alert], now_ms: i64, bots: &BTreeSet<String>) -> AlertSummary {
    let mut s = AlertSummary::default();
    for a in alerts {
        if a.view(now_ms) != Some(AlertView::Active) {
            continue;
        }
        if a.bot_key.as_ref().is_none_or(|b| !bots.contains(b)) {
            continue;
        }
        s.count += 1;
        s.max_severity = s.max_severity.max(Some(a.severity));
    }
    s
}

/// Drawdown of a set of bots: closed trades, open positions and profit curves merged.
#[must_use]
pub fn scope_drawdown(
    members: &[(&BotRuntime, &Assembled)],
    capital: Option<f64>,
    now_ms: i64,
) -> Option<DrawdownResult> {
    if members.iter().all(|(rt, _)| rt.ledger.summary.is_none()) {
        return None;
    }
    let mut closed = Vec::new();
    let mut histories = Vec::new();
    let mut history_trades = Vec::new();
    let mut open = Vec::new();
    for (rt, a) in members {
        closed.extend(rt.ledger.derived.pnl.iter().copied());
        // Index-aligned with `history_trades`: an empty series is ignored by the merge.
        histories.push(rt.ledger.profit.as_ref().clone());
        history_trades.push(rt.ledger.derived.pnl.clone());
        open.extend(a.positions.iter().filter_map(|p| {
            Some(OpenRisk {
                profit_abs: p.profit_abs?,
                amount: p.amount,
                open_rate: p.open_rate,
                current_rate: p.current_rate,
                is_short: p.side == Side::Short,
                min_rate: None,
                max_rate: None,
            })
        }));
    }
    Some(fg_core::calc::drawdown::compute(&DrawdownInput {
        closed,
        open,
        histories,
        history_trades,
        starting_capital: capital,
        now_ms,
    }))
}

/// Totals of one mode. `drawdown` is computed (and cached) by the caller.
#[must_use]
pub fn scope_totals(
    scope: &ScopeBots<'_>,
    alerts: &[Alert],
    drawdown: Option<DrawdownResult>,
    tz: Tz,
    now_ms: i64,
) -> ScopeTotals {
    let rows: Vec<_> = scope.members.iter().map(|(rt, a)| (*rt, *a)).collect();
    let metric_fresh = |a: &Assembled| {
        a.row
            .freshness
            .get(&FreshnessGroup::Metrics)
            .copied()
            .unwrap_or(Freshness {
                as_of_ms: 0,
                source: FreshnessSource::Sqlite,
                stale: true,
            })
    };
    let positions_fresh = |a: &Assembled| {
        a.row
            .freshness
            .get(&FreshnessGroup::Positions)
            .copied()
            .unwrap_or(Freshness {
                as_of_ms: 0,
                source: FreshnessSource::Sqlite,
                stale: true,
            })
    };

    let mut excluded: BTreeSet<String> = BTreeSet::new();
    let mut sum_of = |pick: &dyn Fn(&Assembled) -> Option<f64>,
                      fresh: &dyn Fn(&Assembled) -> Freshness|
     -> Option<f64> {
        let fs: Vec<Freshness> = rows.iter().map(|(_, a)| fresh(a)).collect();
        let keys: Vec<String> = rows.iter().map(|(rt, _)| rt.meta.key.to_string()).collect();
        let s = sum_fresh(
            rows.iter()
                .zip(&fs)
                .zip(&keys)
                .map(|(((_, a), f), k)| (k.as_str(), pick(a), f)),
        );
        excluded.extend(s.excluded);
        (s.included > 0).then_some(s.total)
    };

    let realized_1d = sum_of(&|a| a.row.metrics.realized_1d, &metric_fresh);
    let realized_7d = sum_of(&|a| a.row.metrics.realized_7d, &metric_fresh);
    let realized_30d = sum_of(&|a| a.row.metrics.realized_30d, &metric_fresh);
    let realized_total = sum_of(&|a| a.row.metrics.realized_total, &metric_fresh);
    let open_profit_abs = sum_of(&|a| a.row.metrics.open_profit_abs, &positions_fresh);

    // The calendar day of the configured zone.
    let today_cut = period_cutoff_ms(PeriodKey::Today, now_ms, tz);
    let today: Vec<(&BotRuntime, f64)> = rows
        .iter()
        .filter(|(_, a)| !metric_fresh(a).stale && a.row.metrics.realized_1d.is_some())
        .map(|(rt, _)| (*rt, rt.ledger.derived.profit_since(today_cut)))
        .collect();
    let realized_today = (!today.is_empty()).then(|| today.iter().map(|(_, p)| p).sum());

    let capitals: Vec<Option<f64>> = rows.iter().map(|(_, a)| a.starting_capital).collect();
    let cap = sum_starting_capital(&capitals);

    let reports: Vec<WalletReport> = rows
        .iter()
        .filter_map(|(rt, a)| balance_report(rt, a))
        .collect();
    let wallets = wallet_totals(&reports);

    let positions: Vec<ExposurePosition> = rows
        .iter()
        .flat_map(|(_, a)| a.positions.iter())
        .map(|p| ExposurePosition {
            coin: p.coin.clone(),
            side: p.side,
            notional: p.notional,
        })
        .collect();
    let exp = exposure(&positions);

    let max_open: Vec<u32> = rows
        .iter()
        .filter_map(|(_, a)| a.row.state.max_open_trades)
        .collect();
    let bot_keys: BTreeSet<String> = rows.iter().map(|(rt, _)| rt.meta.key.to_string()).collect();
    let oldest = rows
        .iter()
        .map(|(_, a)| metric_fresh(a).as_of_ms)
        .min()
        .unwrap_or(0);
    let alive = rows.iter().filter(|(_, a)| !metric_fresh(a).stale).count();

    ScopeTotals {
        scope: mode_scope(scope.mode).to_owned(),
        mode: scope.mode,
        bots: u32::try_from(rows.len()).unwrap_or(u32::MAX),
        bots_online: u32::try_from(
            rows.iter()
                .filter(|(rt, _)| rt.status == BotStatus::Online)
                .count(),
        )
        .unwrap_or(u32::MAX),
        open_trades: rows.iter().map(|(_, a)| a.row.state.open_trades).sum(),
        max_open_trades: (!max_open.is_empty()).then(|| max_open.iter().sum()),
        realized_today,
        realized_1d,
        realized_7d,
        realized_30d,
        realized_total,
        open_profit_abs,
        starting_capital: (cap.known > 0).then_some(cap.total),
        capital_unknown_bots: cap.unknown,
        wallet_equity: (wallets.wallets > 0).then_some(wallets.total),
        wallets: wallets.wallets,
        exposure_long: exp.long,
        exposure_short: exp.short,
        exposure_net: exp.net,
        drawdown_realized: drawdown.map(|d| d.realized),
        drawdown_with_open: drawdown.map(|d| d.with_open),
        excluded_bots: excluded.into_iter().collect(),
        alerts: alert_summary(alerts, now_ms, &bot_keys),
        freshness: Freshness {
            as_of_ms: oldest,
            source: FreshnessSource::Sqlite,
            stale: alive == 0,
        },
    }
}

/// Worst severity of a set of alerts, for the health reasons.
#[must_use]
pub fn worst(alerts: &[Alert]) -> Option<Severity> {
    alerts.iter().map(|a| a.severity).max()
}
