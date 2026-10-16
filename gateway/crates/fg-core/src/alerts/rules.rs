//! The 14 alert rules of `useAlertDetection.ts`, ported to run server side 24/7.
//!
//! Corrections with respect to the browser implementation:
//!
//! * `noTradeActivity` compared `latest_trade_timestamp` (milliseconds, `dt_ts_def`) with
//!   `Date.now() / 1000` and therefore never fired (bug B5). All timestamps are normalised to
//!   milliseconds on entry and the date is read from the database.
//! * `allFundsExposed` read `state.balance`, a field that does not exist (bug B6); it now compares
//!   the open stakes with the bot's starting capital.
//! * `nearLiquidation` used `1 + profit_ratio` as a "distance to liquidation", which it is not; the
//!   distance is now measured between the current rate and the liquidation price.
//! * Log rules counted the whole 200-line buffer forever; only lines of the last 15 minutes count.
//! * `positionStuck` compares with the median of the bot's closed durations instead of parsing
//!   `avg_duration`.
//! * A rule whose data is stale or unavailable is *skipped*, not evaluated as healthy: the book
//!   leaves its alerts untouched instead of resolving them on missing information.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{BotStatus, Severity, Side};
use crate::time::normalize_ts_ms;

/// Window (ms) in which log lines count.
pub const LOG_WINDOW_MS: i64 = 15 * 60 * 1000;
/// Default delay before a non critical condition fires.
pub const DEFAULT_FOR_MS: i64 = 30_000;
/// Share of the starting capital in open stakes that triggers `allFundsExposed`.
pub const FUNDS_EXPOSED_RATIO: f64 = 0.95;

/// Identifier of a rule. The camelCase names are the `typeId` strings of the old UI and of the
/// imported `ftBotComparison.alertConfig`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AlertTypeId {
    PositionLoss,
    PositionStuck,
    NearLiquidation,
    LogErrors,
    OrderFailed,
    InsufficientFunds,
    ExchangeError,
    WalletMismatch,
    NoTradeActivity,
    BotOffline,
    HighDrawdown,
    CapacityFull,
    AllFundsExposed,
    LiquidationBeforeStoploss,
}

impl AlertTypeId {
    /// The 14 rules, in the order of the old catalog.
    pub const ALL: [Self; 14] = [
        Self::PositionLoss,
        Self::PositionStuck,
        Self::NearLiquidation,
        Self::LogErrors,
        Self::OrderFailed,
        Self::InsufficientFunds,
        Self::ExchangeError,
        Self::WalletMismatch,
        Self::NoTradeActivity,
        Self::BotOffline,
        Self::HighDrawdown,
        Self::CapacityFull,
        Self::AllFundsExposed,
        Self::LiquidationBeforeStoploss,
    ];

    /// The `typeId` string.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PositionLoss => "positionLoss",
            Self::PositionStuck => "positionStuck",
            Self::NearLiquidation => "nearLiquidation",
            Self::LogErrors => "logErrors",
            Self::OrderFailed => "orderFailed",
            Self::InsufficientFunds => "insufficientFunds",
            Self::ExchangeError => "exchangeError",
            Self::WalletMismatch => "walletMismatch",
            Self::NoTradeActivity => "noTradeActivity",
            Self::BotOffline => "botOffline",
            Self::HighDrawdown => "highDrawdown",
            Self::CapacityFull => "capacityFull",
            Self::AllFundsExposed => "allFundsExposed",
            Self::LiquidationBeforeStoploss => "liquidationBeforeStoploss",
        }
    }

    /// Static description of the rule.
    #[must_use]
    pub fn meta(self) -> RuleMeta {
        use AlertCategory::{Activity, Log, Position, System};
        use Direction::{HigherIsWorse, LowerIsWorse};
        let spec = |min, max, default, step, unit: &str| {
            Some(ThresholdSpec {
                min,
                max,
                default,
                step,
                unit: unit.to_owned(),
            })
        };
        let (category, severity, default_enabled, threshold, direction, re_alert_step) = match self
        {
            Self::PositionLoss => (
                Position,
                Severity::Warning,
                true,
                spec(-100.0, -1.0, -10.0, 1.0, "%"),
                LowerIsWorse,
                Some(5.0),
            ),
            Self::PositionStuck => (
                Position,
                Severity::Warning,
                false,
                spec(1.5, 10.0, 3.0, 0.5, "x"),
                HigherIsWorse,
                None,
            ),
            Self::NearLiquidation => (
                Position,
                Severity::Critical,
                true,
                spec(5.0, 50.0, 15.0, 1.0, "%"),
                LowerIsWorse,
                Some(3.0),
            ),
            Self::LogErrors => (Log, Severity::Critical, true, None, HigherIsWorse, None),
            Self::OrderFailed => (Log, Severity::Critical, true, None, HigherIsWorse, None),
            Self::InsufficientFunds => (Log, Severity::Warning, true, None, HigherIsWorse, None),
            Self::ExchangeError => (Log, Severity::Warning, false, None, HigherIsWorse, None),
            Self::WalletMismatch => (Log, Severity::Critical, true, None, HigherIsWorse, None),
            Self::NoTradeActivity => (
                Activity,
                Severity::Info,
                false,
                spec(1.0, 168.0, 24.0, 1.0, "h"),
                HigherIsWorse,
                None,
            ),
            Self::BotOffline => (
                Activity,
                Severity::Critical,
                true,
                None,
                HigherIsWorse,
                None,
            ),
            Self::HighDrawdown => (
                System,
                Severity::Warning,
                false,
                spec(-50.0, -5.0, -15.0, 1.0, "%"),
                LowerIsWorse,
                Some(5.0),
            ),
            Self::CapacityFull => (System, Severity::Info, false, None, HigherIsWorse, None),
            Self::AllFundsExposed => (Position, Severity::Warning, true, None, HigherIsWorse, None),
            Self::LiquidationBeforeStoploss => {
                (Position, Severity::Critical, true, None, LowerIsWorse, None)
            }
        };
        RuleMeta {
            id: self,
            category,
            severity,
            default_enabled,
            threshold,
            direction,
            re_alert_step,
        }
    }
}

/// Grouping of rules in the settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum AlertCategory {
    Position,
    Log,
    Activity,
    System,
}

/// Which way a value gets worse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    HigherIsWorse,
    LowerIsWorse,
}

/// Bounds and default of a rule threshold.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ThresholdSpec {
    pub min: f64,
    pub max: f64,
    pub default: f64,
    pub step: f64,
    pub unit: String,
}

/// Static description of a rule.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct RuleMeta {
    pub id: AlertTypeId,
    pub category: AlertCategory,
    /// Base severity (a rule may escalate, see `positionLoss`).
    pub severity: Severity,
    pub default_enabled: bool,
    pub threshold: Option<ThresholdSpec>,
    pub direction: Direction,
    /// An acknowledged alert comes back when its value worsens by this much (in threshold
    /// units), or when its severity rises.
    pub re_alert_step: Option<f64>,
}

/// The catalog of the 14 rules.
#[must_use]
pub fn rule_catalog() -> Vec<RuleMeta> {
    AlertTypeId::ALL.iter().map(|t| t.meta()).collect()
}

/// Configuration of one rule. Unknown keys of the old `alertConfig` (`includeLeverage`) are
/// ignored on import.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
pub struct RuleConfig {
    pub enabled: bool,
    pub threshold: Option<f64>,
    /// Seconds a condition must hold before the alert fires (default 30, 0 when critical).
    pub for_s: Option<u32>,
}

impl Default for RuleConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            threshold: None,
            for_s: None,
        }
    }
}

/// Thresholds and switches, global plus per-bot overrides. Mirrors `ftBotComparison.alertConfig`
/// (`global`, `perBotEnabled`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
pub struct AlertRulesConfig {
    pub global: BTreeMap<AlertTypeId, RuleConfig>,
    /// `false` mutes every rule of a bot (absent means enabled).
    pub per_bot_enabled: BTreeMap<String, bool>,
    /// Per-bot overrides of single rules.
    pub per_bot: BTreeMap<String, BTreeMap<AlertTypeId, RuleConfig>>,
}

impl Default for AlertRulesConfig {
    fn default() -> Self {
        let global = AlertTypeId::ALL
            .iter()
            .map(|t| {
                let m = t.meta();
                (
                    *t,
                    RuleConfig {
                        enabled: m.default_enabled,
                        threshold: m.threshold.map(|s| s.default),
                        for_s: None,
                    },
                )
            })
            .collect();
        Self {
            global,
            per_bot_enabled: BTreeMap::new(),
            per_bot: BTreeMap::new(),
        }
    }
}

impl AlertRulesConfig {
    /// Effective configuration of a rule for a bot: per-bot override, then global, then the
    /// catalog default. A bot muted with `per_bot_enabled` has every rule disabled.
    #[must_use]
    pub fn effective(&self, bot_key: &str, t: AlertTypeId) -> RuleConfig {
        let default = {
            let m = t.meta();
            RuleConfig {
                enabled: m.default_enabled,
                threshold: m.threshold.map(|s| s.default),
                for_s: None,
            }
        };
        let mut cfg = self.global.get(&t).cloned().unwrap_or(default);
        if let Some(over) = self.per_bot.get(bot_key).and_then(|m| m.get(&t)) {
            cfg = over.clone();
        }
        if self.per_bot_enabled.get(bot_key) == Some(&false) {
            cfg.enabled = false;
        }
        cfg
    }

    /// Effective configuration of all rules for a bot.
    #[must_use]
    pub fn effective_for(&self, bot_key: &str) -> BTreeMap<AlertTypeId, RuleConfig> {
        AlertTypeId::ALL
            .iter()
            .map(|t| (*t, self.effective(bot_key, *t)))
            .collect()
    }
}

/// One line of a bot log.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct LogLine {
    pub ts_ms: i64,
    /// `ERROR`, `CRITICAL`, `WARNING`, ...
    pub level: String,
    pub message: String,
}

/// An open position as the rules see it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct PositionCtx {
    pub trade_id: i64,
    pub pair: String,
    pub side: Side,
    pub open_ms: i64,
    pub open_rate: f64,
    pub current_rate: Option<f64>,
    pub profit_ratio: Option<f64>,
    pub liquidation_price: Option<f64>,
    pub stoploss_abs: Option<f64>,
    pub stake_amount: f64,
}

/// Everything the rules need about one bot at one instant. Built by the engine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct BotAlertContext {
    pub now_ms: i64,
    pub status: BotStatus,
    pub is_futures: bool,
    pub max_open_trades: Option<u32>,
    pub starting_capital: Option<f64>,
    pub positions: Vec<PositionCtx>,
    /// The positions are older than their staleness threshold: position rules are skipped.
    pub positions_stale: bool,
    /// Median duration of the bot's closed trades.
    pub median_closed_duration_ms: Option<i64>,
    /// Close date of the last trade as read from the database or the API, unit not trusted
    /// (seconds, milliseconds or microseconds), see [`normalize_ts_ms`].
    pub last_trade_ts_raw: Option<f64>,
    /// Current realized drawdown below the high-water mark, absolute.
    pub drawdown_current_abs: Option<f64>,
    /// Recent log lines; `None` when the logs could not be fetched (log rules are skipped).
    pub logs: Option<Vec<LogLine>>,
    /// 429 / rate-limit incidents of the daemon attributed to this bot in the window.
    pub rate_limit_events: u32,
}

/// A thing that is wrong right now.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct Condition {
    pub type_id: AlertTypeId,
    /// Pair or trade id for per-position rules, `None` for bot-level rules.
    pub subject: Option<String>,
    /// Pair of the position behind a per-position condition, to tell the alert in words. Not part
    /// of the deduplication key (the subject, a trade id, is).
    pub pair: Option<String>,
    pub severity: Severity,
    pub value: Option<f64>,
    pub threshold: Option<f64>,
    /// Excerpt (log lines). Not part of the deduplication key.
    pub detail: Option<String>,
    /// How long the condition must hold before the alert fires.
    pub for_ms: i64,
}

impl Condition {
    /// The condition tells the position of `pair` in words.
    #[must_use]
    fn with_pair(mut self, pair: &str) -> Self {
        self.pair = Some(pair.to_owned());
        self
    }
}

/// Outcome of evaluating a bot.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
pub struct Evaluation {
    pub conditions: Vec<Condition>,
    /// Rules that were evaluated: an alert of such a type absent from `conditions` is healthy.
    pub evaluated: BTreeSet<AlertTypeId>,
    /// Rules switched off: their alerts are dropped.
    pub disabled: BTreeSet<AlertTypeId>,
}

fn contains_ci(haystack: &str, needle: &str) -> bool {
    haystack.to_lowercase().contains(&needle.to_lowercase())
}

fn excerpt(lines: &[&LogLine], n: usize) -> Option<String> {
    if lines.is_empty() {
        return None;
    }
    Some(
        lines
            .iter()
            .take(n)
            .map(|l| l.message.chars().take(160).collect::<String>())
            .collect::<Vec<_>>()
            .join(" | "),
    )
}

/// Adverse distance in percent of the rate: how far the rate is from `level` in the direction
/// that hurts a position of the given side.
fn adverse_pct(side: Side, rate: f64, level: f64) -> f64 {
    let d = match side {
        Side::Long => rate - level,
        Side::Short => level - rate,
    };
    d / rate * 100.0
}

const ORDER_FAILED: [&str; 5] = [
    "Could not create",
    "InvalidOrderException",
    "Unable to exit trade",
    "Unable to create",
    "Insufficient funds",
];
const INSUFFICIENT_FUNDS: [&str; 3] = ["Insufficient", "Not enough", "balance too low"];
const EXCHANGE_ERROR: [&str; 4] = [
    "ExchangeError",
    "RequestTimeout",
    "NetworkError",
    "rate limit",
];
const WALLET_MISMATCH: [&str; 2] = ["Wallet shows a total of 0", "Refusing to adjust"];

/// Evaluate every enabled rule for one bot. `rules` is the effective configuration of the bot
/// (see [`AlertRulesConfig::effective_for`]); a missing rule counts as disabled.
#[must_use]
pub fn evaluate_bot(
    rules: &BTreeMap<AlertTypeId, RuleConfig>,
    ctx: &BotAlertContext,
) -> Evaluation {
    let mut ev = Evaluation::default();
    let for_ms = |cfg: &RuleConfig, sev: Severity| -> i64 {
        cfg.for_s.map_or(
            if sev == Severity::Critical {
                0
            } else {
                DEFAULT_FOR_MS
            },
            |s| i64::from(s) * 1000,
        )
    };
    let push = |ev: &mut Evaluation, cfg: &RuleConfig, mut c: Condition| {
        c.for_ms = for_ms(cfg, c.severity);
        ev.conditions.push(c);
    };
    let cond =
        |t: AlertTypeId, subject: Option<String>, severity, value, threshold, detail| Condition {
            type_id: t,
            subject,
            pair: None,
            severity,
            value,
            threshold,
            detail,
            for_ms: 0,
        };

    // Log lines inside the window, newest information only.
    let recent: Option<Vec<&LogLine>> = ctx.logs.as_ref().map(|l| {
        l.iter()
            .filter(|x| x.ts_ms >= ctx.now_ms - LOG_WINDOW_MS && x.ts_ms <= ctx.now_ms)
            .collect()
    });

    for t in AlertTypeId::ALL {
        let cfg = rules.get(&t).cloned().unwrap_or(RuleConfig {
            enabled: false,
            ..RuleConfig::default()
        });
        if !cfg.enabled {
            ev.disabled.insert(t);
            continue;
        }
        let meta = t.meta();
        let thr = cfg
            .threshold
            .or_else(|| meta.threshold.as_ref().map(|s| s.default));
        let before = ev.conditions.len();
        let mut evaluated = true;

        match t {
            AlertTypeId::PositionLoss => {
                if ctx.positions_stale {
                    evaluated = false;
                } else {
                    let thr_pct = thr.unwrap_or(-10.0);
                    for p in &ctx.positions {
                        let Some(ratio) = p.profit_ratio else {
                            continue;
                        };
                        let pct = ratio * 100.0;
                        if pct < thr_pct {
                            let sev = if pct < thr_pct * 2.0 {
                                Severity::Critical
                            } else {
                                Severity::Warning
                            };
                            push(
                                &mut ev,
                                &cfg,
                                cond(
                                    t,
                                    Some(p.trade_id.to_string()),
                                    sev,
                                    Some(pct),
                                    Some(thr_pct),
                                    None,
                                )
                                .with_pair(&p.pair),
                            );
                        }
                    }
                }
            }
            AlertTypeId::PositionStuck => match ctx.median_closed_duration_ms.filter(|m| *m > 0) {
                // Stale positions or no usable reference duration (ledger unreadable, or no closed
                // trade yet): the rule cannot judge, so a running alert is kept, not resolved.
                _ if ctx.positions_stale => evaluated = false,
                Some(median) => {
                    let mult = thr.unwrap_or(3.0);
                    for p in &ctx.positions {
                        let held = (ctx.now_ms - p.open_ms) as f64;
                        let ratio = held / median as f64;
                        if ratio > mult {
                            push(
                                &mut ev,
                                &cfg,
                                cond(
                                    t,
                                    Some(p.trade_id.to_string()),
                                    Severity::Warning,
                                    Some(ratio),
                                    Some(mult),
                                    None,
                                )
                                .with_pair(&p.pair),
                            );
                        }
                    }
                }
                None => evaluated = false,
            },
            AlertTypeId::NearLiquidation => {
                if ctx.positions_stale {
                    evaluated = false;
                } else if ctx.is_futures {
                    let thr_pct = thr.unwrap_or(15.0);
                    for p in &ctx.positions {
                        let (Some(rate), Some(liq)) = (
                            p.current_rate.filter(|r| *r > 0.0),
                            p.liquidation_price.filter(|l| *l > 0.0),
                        ) else {
                            continue;
                        };
                        let dist = adverse_pct(p.side, rate, liq).max(0.0);
                        if dist < thr_pct {
                            push(
                                &mut ev,
                                &cfg,
                                cond(
                                    t,
                                    Some(p.trade_id.to_string()),
                                    Severity::Critical,
                                    Some(dist),
                                    Some(thr_pct),
                                    None,
                                )
                                .with_pair(&p.pair),
                            );
                        }
                    }
                }
            }
            AlertTypeId::LiquidationBeforeStoploss => {
                if ctx.positions_stale {
                    evaluated = false;
                } else if ctx.is_futures {
                    for p in &ctx.positions {
                        let (Some(rate), Some(liq), Some(sl)) = (
                            p.current_rate.filter(|r| *r > 0.0),
                            p.liquidation_price.filter(|l| *l > 0.0),
                            p.stoploss_abs.filter(|s| *s > 0.0),
                        ) else {
                            continue;
                        };
                        let liq_d = adverse_pct(p.side, rate, liq);
                        let sl_d = adverse_pct(p.side, rate, sl);
                        if liq_d < sl_d {
                            push(
                                &mut ev,
                                &cfg,
                                cond(
                                    t,
                                    Some(p.trade_id.to_string()),
                                    Severity::Critical,
                                    Some(liq_d),
                                    Some(sl_d),
                                    None,
                                )
                                .with_pair(&p.pair),
                            );
                        }
                    }
                }
            }
            AlertTypeId::LogErrors
            | AlertTypeId::OrderFailed
            | AlertTypeId::InsufficientFunds
            | AlertTypeId::ExchangeError
            | AlertTypeId::WalletMismatch => match &recent {
                None => evaluated = false,
                Some(lines) => {
                    let (patterns, n_detail): (&[&str], usize) = match t {
                        AlertTypeId::OrderFailed => (&ORDER_FAILED, 2),
                        AlertTypeId::InsufficientFunds => (&INSUFFICIENT_FUNDS, 1),
                        AlertTypeId::ExchangeError => (&EXCHANGE_ERROR, 1),
                        AlertTypeId::WalletMismatch => (&WALLET_MISMATCH, 1),
                        _ => (&[], 3),
                    };
                    let matches: Vec<&LogLine> = lines
                        .iter()
                        .copied()
                        .filter(|l| {
                            if t == AlertTypeId::LogErrors {
                                l.level.eq_ignore_ascii_case("ERROR")
                                    || l.level.eq_ignore_ascii_case("CRITICAL")
                            } else {
                                patterns.iter().any(|p| contains_ci(&l.message, p))
                            }
                        })
                        .collect();
                    let count = matches.len() as f64
                        + if t == AlertTypeId::ExchangeError {
                            f64::from(ctx.rate_limit_events)
                        } else {
                            0.0
                        };
                    if count > 0.0 {
                        push(
                            &mut ev,
                            &cfg,
                            cond(
                                t,
                                None,
                                meta.severity,
                                Some(count),
                                None,
                                excerpt(&matches, n_detail),
                            ),
                        );
                    }
                }
            },
            AlertTypeId::NoTradeActivity => {
                // Without a usable last-trade date the rule cannot judge: a running alert is kept.
                if let Some(last) = ctx.last_trade_ts_raw.and_then(normalize_ts_ms) {
                    let thr_h = thr.unwrap_or(24.0);
                    let hours = (ctx.now_ms - last) as f64 / 3_600_000.0;
                    if hours > thr_h {
                        // Information only: an inactive long bot in a falling market is not an incident.
                        push(
                            &mut ev,
                            &cfg,
                            cond(t, None, Severity::Info, Some(hours), Some(thr_h), None),
                        );
                    }
                } else {
                    evaluated = false;
                }
            }
            AlertTypeId::BotOffline => match ctx.status {
                BotStatus::Offline => push(
                    &mut ev,
                    &cfg,
                    cond(t, None, Severity::Critical, None, None, None),
                ),
                BotStatus::Starting => push(
                    &mut ev,
                    &cfg,
                    cond(t, None, Severity::Info, None, None, None),
                ),
                BotStatus::Online | BotStatus::Stopped | BotStatus::AuthExpired => {}
            },
            AlertTypeId::HighDrawdown => match (
                ctx.drawdown_current_abs,
                ctx.starting_capital.filter(|c| *c > 0.0),
            ) {
                (Some(dd), Some(cap)) => {
                    let thr_pct = thr.unwrap_or(-15.0);
                    let pct = -dd / cap * 100.0;
                    if pct < thr_pct {
                        push(
                            &mut ev,
                            &cfg,
                            cond(t, None, Severity::Warning, Some(pct), Some(thr_pct), None),
                        );
                    }
                }
                _ => evaluated = false,
            },
            AlertTypeId::CapacityFull => {
                if ctx.positions_stale {
                    evaluated = false;
                } else if let Some(max) = ctx.max_open_trades.filter(|m| *m > 0) {
                    let open = ctx.positions.len();
                    if open >= max as usize {
                        push(
                            &mut ev,
                            &cfg,
                            cond(
                                t,
                                None,
                                Severity::Info,
                                Some(open as f64),
                                Some(f64::from(max)),
                                None,
                            ),
                        );
                    }
                }
            }
            AlertTypeId::AllFundsExposed => {
                if ctx.positions_stale {
                    evaluated = false;
                } else if let Some(cap) = ctx.starting_capital.filter(|c| *c > 0.0) {
                    let stake: f64 = ctx.positions.iter().map(|p| p.stake_amount).sum();
                    if !ctx.positions.is_empty() && stake >= cap * FUNDS_EXPOSED_RATIO {
                        push(
                            &mut ev,
                            &cfg,
                            cond(
                                t,
                                None,
                                Severity::Warning,
                                Some(stake / cap * 100.0),
                                Some(FUNDS_EXPOSED_RATIO * 100.0),
                                None,
                            ),
                        );
                    }
                } else {
                    evaluated = false;
                }
            }
        }
        debug_assert!(ev.conditions.len() >= before);
        if evaluated {
            ev.evaluated.insert(t);
        }
    }
    ev
}

#[cfg(test)]
mod tests;
