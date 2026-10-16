//! `GET /risk` (cluster C5): exposure, leverage, capacity, distance to liquidation and pairs held
//! by several bots, for one scope. Wallet-level figures come from the wallets, each counted once,
//! never as a sum over the bots that share one.

use std::collections::{BTreeMap, BTreeSet};

use fg_core::identity::BotKey;
use fg_core::model::Side;
use fg_engine::queries::{ScopeError, scope_bots};
use fg_engine::{Published, ScopeRef};
use serde_json::{Value, json};

/// Figures of the risk panel for `scope`.
///
/// # Errors
/// [`ScopeError`] for an unknown bot, an empty scope or a group that mixes modes.
pub fn compute(p: &Published, scope: &ScopeRef) -> Result<Value, ScopeError> {
    let rows = scope_bots(p, scope)?;
    let keys: BTreeSet<&BotKey> = rows.iter().map(|b| &b.bot_key).collect();
    let positions: Vec<_> = p
        .positions
        .values()
        .filter(|pos| keys.contains(&pos.bot_key))
        .collect();

    let (mut long, mut short) = (0.0_f64, 0.0_f64);
    let (mut lev_sum, mut lev_n, mut stale) = (0.0_f64, 0_u32, 0_u32);
    let mut nearest: Option<(&fg_core::model::Position, f64)> = None;
    let mut by_coin: BTreeMap<&str, BTreeSet<&BotKey>> = BTreeMap::new();
    for pos in &positions {
        if pos.freshness.stale {
            stale += 1;
            continue;
        }
        match pos.side {
            Side::Long => long += pos.notional,
            Side::Short => short += pos.notional,
        }
        lev_sum += pos.leverage;
        lev_n += 1;
        if let Some(d) = pos.liq_distance_pct
            && nearest.is_none_or(|(_, best)| d < best)
        {
            nearest = Some((pos, d));
        }
        by_coin
            .entry(pos.coin.as_str())
            .or_default()
            .insert(&pos.bot_key);
    }
    let open: u32 = rows.iter().map(|b| b.state.open_trades).sum();
    let max: Option<u32> = rows.iter().map(|b| b.state.max_open_trades).sum();
    let wallets: Vec<Value> = p
        .wallets
        .values()
        .filter(|w| w.bots.iter().any(|b| keys.contains(b)))
        .map(|w| {
            json!({
                "wallet_id": w.wallet_id,
                "address_short": w.address_short,
                "equity": w.equity,
                "net_exposure": w.net_exposure,
                "recon": w.recon,
                "bots": w.bots.iter().filter(|b| keys.contains(b)).collect::<Vec<_>>(),
                "freshness": w.freshness,
            })
        })
        .collect();
    let duplicated: Vec<Value> = by_coin
        .iter()
        .filter(|(_, bots)| bots.len() > 1)
        .map(|(coin, bots)| json!({"coin": coin, "bots": bots}))
        .collect();

    Ok(json!({
        "bots": rows.len(),
        "positions": positions.len(),
        "stale_positions": stale,
        "exposure": {"long": long, "short": short, "net": long - short},
        "avg_leverage": (lev_n > 0).then(|| lev_sum / f64::from(lev_n)),
        "capacity": {"open": open, "max": max},
        "nearest_liquidation": nearest.map(|(pos, d)| json!({
            "bot_key": pos.bot_key,
            "trade_id": pos.trade_id,
            "pair": pos.pair,
            "side": pos.side,
            "distance_pct": d,
        })),
        "wallets": wallets,
        "duplicated_pairs": duplicated,
        "generated_ms": p.generated_ms,
    }))
}
