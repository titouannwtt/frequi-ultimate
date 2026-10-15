//! Alert rules and their lifecycle (03 section 7).
//!
//! `rules` turns a snapshot of a bot into *conditions* (what is wrong right now); `book` keeps
//! the alerts across evaluations: hysteresis, deduplication on `(type, bot, subject)` without the
//! message, acknowledgement, silences, and re-alert when a condition worsens after an
//! acknowledgement.

pub mod book;
pub mod rules;

pub use book::{Alert, AlertBook, AlertState, AlertTransition, AlertView, Silence, TransitionKind};
pub use rules::{
    AlertCategory, AlertRulesConfig, AlertTypeId, BotAlertContext, Condition, Direction,
    Evaluation, LogLine, PositionCtx, RuleConfig, RuleMeta, ThresholdSpec, evaluate_bot,
    rule_catalog,
};
