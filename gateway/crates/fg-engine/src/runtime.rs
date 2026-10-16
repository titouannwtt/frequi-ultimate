//! Per-bot runtime state and its assembly into the published entities (`BotRow`, `Position`).
//!
//! `BotRuntime` is owned by the core task, which is its only writer. [`assemble`] turns it into
//! what clients see, attaching a freshness to every group of figures and leaving out of every sum
//! what is stale or unknown.

use std::collections::{HashMap, VecDeque};

use fg_core::calc::capital::{CapitalInput, starting_capital};
use fg_core::calc::drawdown::{DrawdownInput, DrawdownResult, OpenRisk};
use fg_core::calc::hip3::{Market, parse_pair, whitelist_market};
use fg_core::calc::periods::{PeriodKey, Tz, period_cutoff_ms};
use fg_core::model::{
    AlertSummary, BotIdentity, BotMetrics, BotRow, BotStateInfo, BotStatus, Freshness,
    FreshnessGroup, FreshnessSource, PairLock, Position, Side,
};
use fg_sources::botrest::BotFeatures;
use fg_sources::ftcache::BotDigest;

use crate::config::Cadences;
use crate::ledger_data::{LedgerData, spark24h};
use crate::meta::BotMeta;
use crate::wire::{BalanceInfo, LivePosition, LogEntry, SnapEntry};

const MINUTE_MS: i64 = 60_000;
/// A bot not heard from for three times this is stale.
const STATE_CADENCE_MS: i64 = 30_000;
/// A snapshot newer than this makes a `/status` poll useless.
pub const SNAPSHOT_FRESH_MS: i64 = 90_000;
/// Recompute the drawdown at least this often while positions are open.
const DRAWDOWN_REFRESH_MS: i64 = 5_000;

/// A digest as received, with the instant it describes.
#[derive(Debug, Clone)]
pub struct DigestObs {
    pub digest: BotDigest,
    /// `received - age_s`: the instant the figures describe.
    pub as_of_ms: i64,
}

#[derive(Debug, Clone, Default)]
struct DrawdownCache {
    version: u64,
    capital_bits: Option<u64>,
    computed_ms: i64,
    has_open: bool,
    result: Option<DrawdownResult>,
}

/// Everything the core knows about one bot.
#[derive(Debug, Clone)]
pub struct BotRuntime {
    pub meta: BotMeta,
    pub status: BotStatus,
    pub status_since_ms: Option<i64>,
    /// Last successful contact: a REST answer, a WebSocket message or a digest.
    pub alive_ms: Option<i64>,
    pub features: Option<BotFeatures>,
    pub digest: Option<DigestObs>,
    pub balance: Option<(BalanceInfo, i64)>,
    pub rest_positions: Option<(Vec<LivePosition>, i64)>,
    pub ws_connected: bool,
    pub ws_last_ms: Option<i64>,
    pub snapshot: HashMap<i64, SnapEntry>,
    pub snapshot_ms: Option<i64>,
    pub whitelist: Option<(Vec<String>, i64)>,
    pub blacklist: Option<(Vec<String>, i64)>,
    pub locks: Option<(Vec<PairLock>, i64)>,
    pub logs: VecDeque<LogEntry>,
    pub logs_ms: Option<i64>,
    pub ledger: LedgerData,
    pub rate_limit_ms: VecDeque<i64>,
    pub alerts: AlertSummary,
    pub last_eval_ms: Option<i64>,
    dd: DrawdownCache,
    spark: (i64, u64, Vec<f64>),
}

impl BotRuntime {
    #[must_use]
    pub fn new(meta: BotMeta) -> Self {
        Self {
            meta,
            // Until a first contact the bot is `Starting`, never optimistically `Online`.
            status: BotStatus::Starting,
            status_since_ms: None,
            alive_ms: None,
            features: None,
            digest: None,
            balance: None,
            rest_positions: None,
            ws_connected: false,
            ws_last_ms: None,
            snapshot: HashMap::new(),
            snapshot_ms: None,
            whitelist: None,
            blacklist: None,
            locks: None,
            logs: VecDeque::new(),
            logs_ms: None,
            ledger: LedgerData::default(),
            rate_limit_ms: VecDeque::new(),
            alerts: AlertSummary::default(),
            last_eval_ms: None,
            dd: DrawdownCache::default(),
            spark: (0, 0, Vec::new()),
        }
    }

    /// Prices pushed by the bot over its WebSocket are recent enough to replace `/status`.
    #[must_use]
    pub fn snapshot_fresh(&self, now_ms: i64) -> bool {
        self.snapshot_ms
            .is_some_and(|t| now_ms - t <= SNAPSHOT_FRESH_MS)
    }

    /// A `/logs` read happened recently enough for the log rules to mean something.
    #[must_use]
    pub fn logs_fresh(&self, now_ms: i64, cadences: &Cadences) -> bool {
        let cadence = i64::try_from(cadences.logs.normal.as_millis()).unwrap_or(i64::MAX / 4);
        self.logs_ms.is_some_and(|t| now_ms - t <= 3 * cadence)
    }
}

/// Inputs shared by the assembly of every bot at one instant.
pub struct AssembleCtx<'a> {
    pub now_ms: i64,
    pub tz: Tz,
    pub cadences: &'a Cadences,
    /// Number of bots that trade the same wallet as this one (including itself).
    pub wallet_members: usize,
}

/// A bot as published, with the figures other consumers need (alert context, aggregates).
pub struct Assembled {
    pub row: BotRow,
    pub positions: Vec<Position>,
    /// The positions group is fresh (or there is nothing open and the ledger is fresh).
    pub positions_fresh: bool,
    pub starting_capital: Option<f64>,
    pub drawdown: Option<DrawdownResult>,
}

fn ms(d: std::time::Duration) -> i64 {
    i64::try_from(d.as_millis()).unwrap_or(i64::MAX / 4)
}

struct OpenView {
    trade_id: i64,
    pair: String,
    is_short: bool,
    leverage: f64,
    amount: f64,
    stake_amount: f64,
    open_rate: f64,
    open_ms: i64,
    stop: Option<f64>,
    liq: Option<f64>,
    entries: u32,
}

/// The open trades of a bot: from the ledger when it can be read, else from `/status`.
fn open_views(rt: &BotRuntime) -> Option<Vec<OpenView>> {
    if rt.ledger.summary.is_some() {
        return Some(
            rt.ledger
                .open
                .iter()
                .map(|t| OpenView {
                    trade_id: t.id,
                    pair: t.pair.clone(),
                    is_short: t.is_short,
                    leverage: t.leverage,
                    amount: t.amount,
                    stake_amount: t.stake_amount,
                    open_rate: t.open_rate,
                    open_ms: t.open_ms.unwrap_or(0),
                    stop: t.stop_loss,
                    liq: t.liquidation_price,
                    entries: rt.ledger.entries.get(&t.id).copied().unwrap_or(1),
                })
                .collect(),
        );
    }
    let (items, _) = rt.rest_positions.as_ref()?;
    Some(
        items
            .iter()
            .map(|p| OpenView {
                trade_id: p.trade_id,
                pair: p.pair.clone(),
                is_short: p.is_short.unwrap_or(false),
                leverage: p.leverage.unwrap_or(1.0),
                amount: p.amount.unwrap_or(0.0),
                stake_amount: p.stake_amount.unwrap_or(0.0),
                open_rate: p.open_rate.unwrap_or(0.0),
                open_ms: p.open_ms.unwrap_or(0),
                stop: p.stop_loss_abs,
                liq: p.liquidation_price,
                entries: p.entries.unwrap_or(1),
            })
            .collect(),
    )
}

struct Price {
    current_rate: Option<f64>,
    profit_abs: Option<f64>,
    profit_ratio: Option<f64>,
    source: FreshnessSource,
    as_of_ms: i64,
}

/// Live price of a trade: the newer of the WebSocket snapshot and the last `/status`.
fn price_of(rt: &BotRuntime, trade_id: i64) -> Option<Price> {
    let ws = rt
        .snapshot
        .get(&trade_id)
        .zip(rt.snapshot_ms)
        .map(|(e, t)| Price {
            current_rate: e.current_rate,
            profit_abs: e.profit_abs,
            profit_ratio: e.profit_ratio,
            source: FreshnessSource::Ws,
            as_of_ms: t,
        });
    let rest = rt.rest_positions.as_ref().and_then(|(items, t)| {
        let p = items.iter().find(|p| p.trade_id == trade_id)?;
        Some(Price {
            current_rate: p.current_rate,
            profit_abs: p.profit_abs,
            profit_ratio: p.profit_ratio,
            source: FreshnessSource::Rest,
            as_of_ms: *t,
        })
    });
    match (ws, rest) {
        (Some(w), Some(r)) => Some(if w.as_of_ms >= r.as_of_ms { w } else { r }),
        (w, r) => w.or(r),
    }
}

fn distance_pct(rate: f64, level: f64) -> f64 {
    if rate == 0.0 {
        0.0
    } else {
        (rate - level).abs() / rate * 100.0
    }
}

/// Build the positions of a bot, or `None` when the open trades are unknown.
fn build_positions(rt: &BotRuntime, ctx: &AssembleCtx<'_>) -> Option<Vec<Position>> {
    let views = open_views(rt)?;
    let dexes = rt.meta.dexes();
    let status_cadence = ms(ctx.cadences.status.normal);
    let fallback_as_of = rt
        .ledger
        .alive_ms
        .or(rt.rest_positions.as_ref().map(|(_, t)| *t))
        .unwrap_or(0);
    let mut out = Vec::with_capacity(views.len());
    for v in views {
        let info = parse_pair(&v.pair, &dexes);
        let price = price_of(rt, v.trade_id);
        let (freshness, rate, profit_abs, profit_ratio) = match &price {
            Some(p) => {
                let f = Freshness::compute(p.source, p.as_of_ms, ctx.now_ms, status_cadence, true);
                (f, p.current_rate, p.profit_abs, p.profit_ratio)
            }
            // No price source knows this trade: its figures are unknown, hence stale.
            None => (
                Freshness {
                    as_of_ms: fallback_as_of,
                    source: FreshnessSource::Sqlite,
                    stale: true,
                },
                None,
                None,
                None,
            ),
        };
        // A stale price is shown as unknown rather than as current.
        let (rate, profit_abs, profit_ratio) = if freshness.stale {
            (None, None, None)
        } else {
            (rate, profit_abs, profit_ratio)
        };
        let valuation = rate.unwrap_or(v.open_rate);
        let duration_ms = if v.open_ms > 0 {
            // Refreshed once a minute: clients derive finer values from `open_ms`, and the
            // positions channel does not carry a delta per second per position.
            (ctx.now_ms - v.open_ms).max(0) / MINUTE_MS * MINUTE_MS
        } else {
            0
        };
        out.push(Position {
            bot_key: rt.meta.key.clone(),
            trade_id: v.trade_id,
            coin: info.coin_key,
            market: info.market,
            side: Side::from_is_short(v.is_short),
            leverage: v.leverage,
            amount: v.amount,
            stake_amount: v.stake_amount,
            notional: v.amount * valuation,
            open_rate: v.open_rate,
            current_rate: rate,
            profit_abs,
            profit_ratio,
            stoploss_abs: v.stop,
            liquidation_price: v.liq,
            liq_distance_pct: match (rate, v.liq) {
                (Some(r), Some(l)) => Some(distance_pct(r, l)),
                _ => None,
            },
            dca_entries: v.entries.saturating_sub(1),
            open_ms: v.open_ms,
            duration_ms,
            percentile: rt.ledger.derived.percentile(duration_ms),
            orphan: false,
            freshness,
            pair: v.pair,
        });
    }
    Some(out)
}

fn group_freshness(
    positions: Option<&[Position]>,
    rt: &BotRuntime,
    ctx: &AssembleCtx<'_>,
) -> Freshness {
    let ledger_fresh = || {
        rt.ledger.alive_ms.map(|t| {
            Freshness::compute(
                FreshnessSource::Sqlite,
                t,
                ctx.now_ms,
                ms(ctx.cadences.ledger_stat.normal).max(1_000),
                false,
            )
        })
    };
    match positions {
        Some(p) if !p.is_empty() => {
            // The oldest position decides; any stale position makes the group stale.
            let oldest = p.iter().min_by_key(|x| x.freshness.as_of_ms);
            oldest.map_or_else(
                || Freshness {
                    as_of_ms: 0,
                    source: FreshnessSource::Sqlite,
                    stale: true,
                },
                |o| Freshness {
                    stale: p.iter().any(|x| x.freshness.stale),
                    ..o.freshness
                },
            )
        }
        _ => ledger_fresh().unwrap_or(Freshness {
            as_of_ms: rt.alive_ms.unwrap_or(0),
            source: FreshnessSource::Rest,
            stale: rt.alive_ms.is_none(),
        }),
    }
}

/// Assemble the published entities of one bot at `ctx.now_ms`.
pub fn assemble(rt: &mut BotRuntime, ctx: &AssembleCtx<'_>) -> Assembled {
    let now = ctx.now_ms;
    let positions_opt = build_positions(rt, ctx);
    let positions = positions_opt.clone().unwrap_or_default();
    let ledger_known = rt.ledger.summary.is_some();

    // ---- freshness of each group
    let state_f = match rt.alive_ms {
        Some(t) => Freshness::compute(FreshnessSource::Rest, t, now, STATE_CADENCE_MS, false),
        None => Freshness {
            as_of_ms: 0,
            source: FreshnessSource::Rest,
            stale: true,
        },
    };
    let metrics_f = match (rt.ledger.alive_ms, &rt.digest) {
        (Some(t), _) => Freshness::compute(
            FreshnessSource::Sqlite,
            t,
            now,
            ms(ctx.cadences.ledger_stat.normal).max(1_000),
            false,
        ),
        (None, Some(d)) => Freshness::compute(FreshnessSource::Digest, d.as_of_ms, now, 0, true),
        (None, None) => Freshness {
            as_of_ms: 0,
            source: FreshnessSource::Sqlite,
            stale: true,
        },
    };
    let positions_f = group_freshness(positions_opt.as_deref(), rt, ctx);
    let capital_f = match &rt.balance {
        Some((_, t)) => Freshness::compute(
            FreshnessSource::Rest,
            *t,
            now,
            ms(ctx.cadences.balance.normal),
            false,
        ),
        None => Freshness::compute(
            FreshnessSource::Rest,
            rt.meta.scanned_ms,
            now,
            ms(ctx.cadences.discovery),
            false,
        ),
    };
    let alerts_f = Freshness::compute(
        FreshnessSource::Rest,
        rt.last_eval_ms.unwrap_or(0),
        now,
        ms(ctx.cadences.alert_eval),
        false,
    );

    // ---- latent profit: all prices fresh, else a fresh digest, else unknown
    let open_known = positions_opt.is_some();
    let all_fresh = positions
        .iter()
        .all(|p| !p.freshness.stale && p.profit_abs.is_some());
    let open_profit_abs = if open_known && ledger_known && all_fresh {
        Some(positions.iter().filter_map(|p| p.profit_abs).sum())
    } else {
        rt.digest
            .as_ref()
            .filter(|d| {
                !Freshness::compute(FreshnessSource::Digest, d.as_of_ms, now, 0, true).stale
            })
            .and_then(|d| d.digest.open_profit_abs)
    };

    // ---- realized profits
    let derived = &rt.ledger.derived;
    let ledger_ok = ledger_known && !metrics_f.stale;
    let realized = |key: PeriodKey| {
        ledger_ok.then(|| derived.profit_since(period_cutoff_ms(key, now, ctx.tz)))
    };
    let realized_total = if ledger_ok {
        rt.ledger.summary.map(|s| s.realized_total)
    } else {
        rt.digest
            .as_ref()
            .filter(|d| {
                !Freshness::compute(FreshnessSource::Digest, d.as_of_ms, now, 0, true).stale
            })
            .and_then(|d| d.digest.closed_profit_abs)
    };

    // ---- capital
    let shared = ctx.wallet_members > 1;
    let balance = rt.balance.as_ref().map(|(b, _)| b);
    let capital = starting_capital(&CapitalInput {
        available_capital: rt.meta.available_capital,
        capital_withdrawal: Some(rt.meta.capital_withdrawal),
        wallet_shared: shared,
        bot_managed_balance: balance.and_then(|b| b.total_bot).filter(|_| !shared),
        balance_total: balance.and_then(|b| b.total),
        profit_all_coin: realized_total,
    });

    // ---- drawdown, cached per ledger version
    let drawdown = if ledger_known {
        let bits = capital.value.map(f64::to_bits);
        let has_open = !positions.is_empty();
        let due = rt.dd.result.is_none()
            || rt.dd.version != rt.ledger.version
            || rt.dd.capital_bits != bits
            || (has_open && now - rt.dd.computed_ms >= DRAWDOWN_REFRESH_MS)
            || rt.dd.has_open != has_open;
        if due {
            let open = positions
                .iter()
                .filter_map(|p| {
                    Some(OpenRisk {
                        profit_abs: p.profit_abs?,
                        amount: p.amount,
                        open_rate: p.open_rate,
                        current_rate: p.current_rate,
                        is_short: p.side == Side::Short,
                        min_rate: None,
                        max_rate: None,
                    })
                })
                .collect();
            let result = fg_core::calc::drawdown::compute(&DrawdownInput {
                closed: derived.pnl.clone(),
                open,
                histories: vec![rt.ledger.profit.as_ref().clone()],
                starting_capital: capital.value,
                now_ms: now,
            });
            rt.dd = DrawdownCache {
                version: rt.ledger.version,
                capital_bits: bits,
                computed_ms: now,
                has_open,
                result: Some(result),
            };
        }
        rt.dd.result
    } else {
        None
    };

    // ---- exposure
    let (exposure_long, exposure_short) = if open_known {
        let side = |s: Side| {
            positions
                .iter()
                .filter(|p| p.side == s)
                .map(|p| p.notional)
                .sum::<f64>()
        };
        (Some(side(Side::Long)), Some(side(Side::Short)))
    } else {
        (None, None)
    };

    // ---- spark: once a minute or when the profit curve changed
    let minute = now / MINUTE_MS;
    if rt.spark.0 != minute || rt.spark.1 != rt.ledger.version {
        rt.spark = (
            minute,
            rt.ledger.version,
            spark24h(rt.ledger.profit.as_ref(), now),
        );
    }

    let totals = derived.totals.as_ref();
    let metrics = BotMetrics {
        realized_1d: realized(PeriodKey::H24),
        realized_7d: realized(PeriodKey::D7),
        realized_30d: realized(PeriodKey::D30),
        realized_total,
        open_profit_abs,
        starting_capital: capital.value,
        exposure_long,
        exposure_short,
        drawdown_realized: drawdown.map(|d| d.realized),
        drawdown_with_open: drawdown.map(|d| d.with_open),
        last_trade_ms: rt
            .ledger
            .summary
            .and_then(|s| s.last_close_ms.max(s.last_open_ms)),
        trades_closed: rt
            .ledger
            .summary
            .and_then(|s| u32::try_from(s.closed_count).ok()),
        winrate: totals.and_then(|t| t.winrate),
        spark24h: rt.spark.2.clone(),
    };

    let whitelist = rt.whitelist.as_ref().map(|(w, _)| w.as_slice());
    let market = whitelist
        .and_then(|w| {
            let list: Vec<String> = w.to_vec();
            whitelist_market(&list, &rt.meta.dexes())
        })
        .unwrap_or(Market::Crypto);
    let max_open = rt.meta.max_open_trades.or_else(|| {
        rt.features
            .as_ref()
            .and_then(|f| f.max_open_trades)
            .and_then(|n| u32::try_from(n).ok())
    });
    let open_trades = if open_known {
        u32::try_from(positions.len()).unwrap_or(u32::MAX)
    } else {
        rt.digest
            .as_ref()
            .and_then(|d| d.digest.open_trade_count)
            .and_then(|n| u32::try_from(n).ok())
            .unwrap_or(0)
    };

    let mut freshness = std::collections::BTreeMap::new();
    freshness.insert(FreshnessGroup::State, state_f);
    freshness.insert(FreshnessGroup::Metrics, metrics_f);
    freshness.insert(FreshnessGroup::Positions, positions_f);
    freshness.insert(FreshnessGroup::Capital, capital_f);
    freshness.insert(FreshnessGroup::Alerts, alerts_f);

    let row = BotRow {
        bot_key: rt.meta.key.clone(),
        identity: BotIdentity {
            name: rt.meta.name.clone(),
            icon: None,
            mode: rt.meta.mode,
            strategy: rt.meta.strategy.clone(),
            exchange: rt.meta.exchange.clone(),
            market,
            stake_currency: rt.meta.stake_currency.clone(),
            port: rt.meta.port,
            ui_ids: Vec::new(),
            incarnation: rt.meta.incarnation.clone(),
        },
        state: BotStateInfo {
            status: rt.status,
            since_ms: rt.status_since_ms,
            wallet_id: rt.meta.wallet_id.clone(),
            open_trades,
            max_open_trades: max_open,
            first_real_trade_ms: rt.ledger.summary.and_then(|s| s.first_open_ms),
            started_ms: rt.meta.started_ms,
        },
        metrics,
        alerts: rt.alerts,
        freshness,
    };
    Assembled {
        positions_fresh: !positions_f.stale,
        row,
        positions,
        starting_capital: capital.value,
        drawdown,
    }
}
