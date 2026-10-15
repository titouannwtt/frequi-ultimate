//! Exit reason normalisation.
//!
//! freqtrade stores free-form `exit_reason` strings: built-in values (`roi`, `stop_loss`,
//! `trailing_stop_loss`, `exit_signal`, `force_exit`, `liquidation`, ...) plus whatever a strategy
//! returns from `custom_exit`. The old UI classified them with substring tests, which made
//! `trailing_stop_loss` green (it contains "trailing" and was tested before "stop") and matched
//! "sl" inside unrelated words. Here the reason is split into tokens and classified by priority.
//! A null or empty reason is `Unknown`: it is shown as "inconnu" and counted apart, never
//! replaced by a guess.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Specific kind of exit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ExitKind {
    Roi,
    TakeProfit,
    StopLoss,
    TrailingStop,
    Liquidation,
    ExitSignal,
    ForceExit,
    EmergencyExit,
    /// The position was closed outside the bot (external close, orphan clean-up).
    External,
    /// A strategy-defined reason that matches no known kind.
    Custom,
    Unknown,
}

/// Coarse class used for colouring and grouping.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ExitClass {
    /// The strategy took its profit target.
    Profit,
    /// A protective exit: stop, trailing stop, liquidation, emergency.
    Protective,
    Signal,
    /// A human forced the exit.
    Manual,
    External,
    Other,
    Unknown,
}

/// A normalised exit reason; `raw` is the trimmed original string (empty when unknown).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ExitReason {
    pub raw: String,
    pub kind: ExitKind,
    pub class: ExitClass,
}

impl ExitKind {
    #[must_use]
    pub fn class(self) -> ExitClass {
        match self {
            Self::Roi | Self::TakeProfit => ExitClass::Profit,
            Self::StopLoss | Self::TrailingStop | Self::Liquidation | Self::EmergencyExit => {
                ExitClass::Protective
            }
            Self::ExitSignal => ExitClass::Signal,
            Self::ForceExit => ExitClass::Manual,
            Self::External => ExitClass::External,
            Self::Custom => ExitClass::Other,
            Self::Unknown => ExitClass::Unknown,
        }
    }
}

/// Normalise a raw `exit_reason` (null, empty and "none" all mean unknown).
#[must_use]
pub fn normalize_exit_reason(raw: Option<&str>) -> ExitReason {
    let raw = raw.map(str::trim).unwrap_or_default();
    let kind = classify(raw);
    ExitReason {
        raw: if kind == ExitKind::Unknown {
            String::new()
        } else {
            raw.to_owned()
        },
        kind,
        class: kind.class(),
    }
}

fn is_take_profit_token(t: &str) -> bool {
    t == "takeprofit"
        || t == "profit"
        || t == "tp"
        || (t.len() > 2 && t.starts_with("tp") && t[2..].bytes().all(|b| b.is_ascii_digit()))
}

fn classify(raw: &str) -> ExitKind {
    let lower = raw.to_ascii_lowercase();
    let tokens: Vec<&str> = lower
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.is_empty() || matches!(tokens.as_slice(), ["none" | "null" | "nan" | "unknown"]) {
        return ExitKind::Unknown;
    }
    let has = |w: &str| tokens.contains(&w);
    let starts = |p: &str| tokens.iter().any(|t| t.starts_with(p));
    let adjacent = |a: &str, b: &str| tokens.windows(2).any(|w| w[0] == a && w[1] == b);

    if starts("liquidat") {
        ExitKind::Liquidation
    } else if starts("external") || has("orphan") {
        ExitKind::External
    } else if starts("force") {
        ExitKind::ForceExit
    } else if has("emergency") {
        ExitKind::EmergencyExit
    } else if has("trailing") {
        ExitKind::TrailingStop
    } else if has("stoploss") || has("stop") || has("sl") || adjacent("stop", "loss") {
        ExitKind::StopLoss
    } else if has("roi") {
        ExitKind::Roi
    } else if tokens.iter().any(|t| is_take_profit_token(t)) || adjacent("take", "profit") {
        ExitKind::TakeProfit
    } else if has("signal") {
        ExitKind::ExitSignal
    } else {
        ExitKind::Custom
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind(s: &str) -> ExitKind {
        normalize_exit_reason(Some(s)).kind
    }

    #[test]
    fn built_in_freqtrade_values() {
        assert_eq!(kind("roi"), ExitKind::Roi);
        assert_eq!(kind("stop_loss"), ExitKind::StopLoss);
        assert_eq!(kind("stoploss_on_exchange"), ExitKind::StopLoss);
        assert_eq!(kind("trailing_stop_loss"), ExitKind::TrailingStop);
        assert_eq!(kind("exit_signal"), ExitKind::ExitSignal);
        assert_eq!(kind("force_exit"), ExitKind::ForceExit);
        assert_eq!(kind("liquidation"), ExitKind::Liquidation);
        assert_eq!(kind("emergency_exit"), ExitKind::EmergencyExit);
    }

    #[test]
    fn trailing_stop_loss_is_protective_not_profit() {
        // Regression: the old substring classifier tested "trailing" first and coloured it green.
        let r = normalize_exit_reason(Some("trailing_stop_loss"));
        assert_eq!(r.class, ExitClass::Protective);
    }

    #[test]
    fn substrings_inside_words_do_not_match() {
        // "sl" and "tp" used to match inside words.
        assert_eq!(kind("slow_decay_exit"), ExitKind::Custom);
        assert_eq!(kind("http_timeout_exit"), ExitKind::Custom);
        assert_eq!(kind("hippo_ladder_out_3"), ExitKind::Custom);
    }

    #[test]
    fn strategy_custom_reasons() {
        assert_eq!(kind("custom_tp"), ExitKind::TakeProfit);
        assert_eq!(kind("tp2"), ExitKind::TakeProfit);
        assert_eq!(kind("take_profit_hit"), ExitKind::TakeProfit);
        assert_eq!(kind("custom_sl_pair"), ExitKind::StopLoss);
        assert_eq!(kind("external_close"), ExitKind::External);
    }

    #[test]
    fn null_empty_and_none_are_unknown() {
        for raw in [
            None,
            Some(""),
            Some("   "),
            Some("None"),
            Some("null"),
            Some("nan"),
        ] {
            let r = normalize_exit_reason(raw);
            assert_eq!(r.kind, ExitKind::Unknown, "{raw:?}");
            assert_eq!(r.class, ExitClass::Unknown);
            assert_eq!(r.raw, "");
        }
    }

    #[test]
    fn raw_is_trimmed_and_preserved() {
        let r = normalize_exit_reason(Some("  Hippo_TP  "));
        assert_eq!(r.raw, "Hippo_TP");
        assert_eq!(r.kind, ExitKind::TakeProfit);
        assert_eq!(r.class, ExitClass::Profit);
    }

    #[test]
    fn priority_liquidation_beats_stop() {
        assert_eq!(kind("stop_loss_liquidation"), ExitKind::Liquidation);
        assert_eq!(kind("force_exit_stop"), ExitKind::ForceExit);
    }
}
