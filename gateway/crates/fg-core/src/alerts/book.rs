//! Alert lifecycle: hysteresis, deduplication, acknowledgement, silences, re-alert.
//!
//! * **Deduplication** is on `(type_id, bot_key, subject)`. The message is not part of the key
//!   (it used to be, so a counter in the text created a new alert at every refresh).
//! * **Hysteresis**: a condition becomes `firing` after its `for` delay (0 for critical ones) and
//!   is `resolved` after two consecutive evaluations without it. A condition that disappears
//!   before firing is dropped silently.
//! * **Acknowledgement** holds until resolution. An acknowledged alert comes back (re-alert) when
//!   its severity rises or when its value worsens by the rule's `re_alert_step`.
//! * **Silence** mutes a rule, a bot or a subject until a date. A silence never hides the alert
//!   from the book, it only flags it, so the UI can list it under "silenced".
//! * A rule that could not be evaluated (stale data) leaves its alerts untouched.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::rules::{AlertTypeId, Condition, Direction, Evaluation};
use crate::model::{AlertSummary, Severity};

/// Evaluations without the condition before a firing alert resolves.
pub const RESOLVE_AFTER_MISSES: u8 = 2;

/// Lifecycle state of an alert.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum AlertState {
    Pending,
    Firing,
    Resolved,
}

/// How a firing alert is displayed (tabs of the alert rail).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum AlertView {
    Active,
    Acked,
    Silenced,
}

/// An alert as exposed to clients.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct Alert {
    pub id: String,
    pub type_id: AlertTypeId,
    /// `None` for wallet-level alerts.
    pub bot_key: Option<String>,
    pub subject: Option<String>,
    /// Pair of the position the alert is about (its `subject` is the trade id), for display.
    #[serde(default)]
    pub pair: Option<String>,
    pub severity: Severity,
    pub value: Option<f64>,
    pub threshold: Option<f64>,
    pub since_ms: i64,
    pub last_seen_ms: i64,
    pub state: AlertState,
    pub acked_at_ms: Option<i64>,
    pub acked_by_session: Option<String>,
    pub silenced_until_ms: Option<i64>,
    pub detail: Option<String>,
}

impl Alert {
    /// Display state of a firing alert at `now_ms`; `None` for pending or resolved alerts.
    /// A silence wins over an acknowledgement.
    #[must_use]
    pub fn view(&self, now_ms: i64) -> Option<AlertView> {
        if self.state != AlertState::Firing {
            return None;
        }
        if self.silenced_until_ms.is_some_and(|u| u > now_ms) {
            Some(AlertView::Silenced)
        } else if self.acked_at_ms.is_some() {
            Some(AlertView::Acked)
        } else {
            Some(AlertView::Active)
        }
    }
}

/// A mute of a rule, a bot, a subject, or any combination, until `until_ms`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct Silence {
    pub id: String,
    pub type_id: Option<AlertTypeId>,
    pub bot_key: Option<String>,
    pub subject: Option<String>,
    pub until_ms: i64,
}

impl Silence {
    fn matches(&self, a: &Alert) -> bool {
        self.type_id.is_none_or(|t| t == a.type_id)
            && self
                .bot_key
                .as_ref()
                .is_none_or(|b| a.bot_key.as_ref() == Some(b))
            && self
                .subject
                .as_ref()
                .is_none_or(|s| a.subject.as_ref() == Some(s))
    }
}

/// What happened to an alert during an evaluation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum TransitionKind {
    /// The alert started firing.
    Raised,
    /// A firing alert's severity rose.
    Escalated,
    /// An acknowledged alert worsened and is active again.
    ReAlerted,
    Resolved,
}

/// A notable change; the alert carries its silence so consumers can skip notifications.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AlertTransition {
    pub kind: TransitionKind,
    pub alert: Alert,
}

/// Why an acknowledgement or a silence request failed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BookError {
    #[error("no such alert")]
    UnknownAlert,
    #[error("silence must end in the future")]
    SilenceInPast,
    #[error("no such silence")]
    UnknownSilence,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct AlertKey {
    type_id: AlertTypeId,
    bot_key: Option<String>,
    subject: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Ack {
    at_ms: i64,
    session: Option<String>,
    severity: Severity,
    value: Option<f64>,
}

/// An alert plus its bookkeeping.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Tracked {
    alert: Alert,
    for_ms: i64,
    misses: u8,
    ack: Option<Ack>,
}

/// Serializable state of a book (persisted by the engine).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct BookState {
    pub tracked: Vec<Tracked>,
    pub silences: Vec<Silence>,
    pub next_silence: u64,
}

/// Deterministic alert id: stable for one episode, new when the alert fires again after having
/// resolved.
#[must_use]
pub fn alert_id(
    type_id: AlertTypeId,
    bot_key: Option<&str>,
    subject: Option<&str>,
    since_ms: i64,
) -> String {
    let raw = format!(
        "{}|{}|{}|{since_ms}",
        type_id.as_str(),
        bot_key.unwrap_or(""),
        subject.unwrap_or("")
    );
    blake3::hash(raw.as_bytes()).to_hex()[..16].to_owned()
}

/// The set of alerts of the fleet.
#[derive(Debug, Clone, Default)]
pub struct AlertBook {
    tracked: BTreeMap<AlertKey, Tracked>,
    silences: Vec<Silence>,
    next_silence: u64,
}

impl AlertBook {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Rebuild a book from persisted state.
    #[must_use]
    pub fn from_state(state: BookState) -> Self {
        let tracked = state
            .tracked
            .into_iter()
            .map(|t| {
                let key = AlertKey {
                    type_id: t.alert.type_id,
                    bot_key: t.alert.bot_key.clone(),
                    subject: t.alert.subject.clone(),
                };
                (key, t)
            })
            .collect();
        Self {
            tracked,
            silences: state.silences,
            next_silence: state.next_silence,
        }
    }

    /// State to persist.
    #[must_use]
    pub fn to_state(&self) -> BookState {
        BookState {
            tracked: self.tracked.values().cloned().collect(),
            silences: self.silences.clone(),
            next_silence: self.next_silence,
        }
    }

    /// Fold the evaluation of one bot (`bot_key`) into the book.
    pub fn evaluate_bot(
        &mut self,
        now_ms: i64,
        bot_key: &str,
        ev: &Evaluation,
    ) -> Vec<AlertTransition> {
        let mut out = Vec::new();
        let mut seen: Vec<AlertKey> = Vec::new();

        for c in &ev.conditions {
            let key = AlertKey {
                type_id: c.type_id,
                bot_key: Some(bot_key.to_owned()),
                subject: c.subject.clone(),
            };
            seen.push(key.clone());
            self.apply_condition(now_ms, key, c, &mut out);
        }

        // Existing alerts of this bot that were not reported this time.
        let keys: Vec<AlertKey> = self
            .tracked
            .keys()
            .filter(|k| k.bot_key.as_deref() == Some(bot_key) && !seen.contains(k))
            .cloned()
            .collect();
        for key in keys {
            if ev.disabled.contains(&key.type_id) {
                self.drop_alert(now_ms, &key, &mut out);
            } else if ev.evaluated.contains(&key.type_id) {
                let Some(t) = self.tracked.get_mut(&key) else {
                    continue;
                };
                t.misses = t.misses.saturating_add(1);
                let gone = match t.alert.state {
                    AlertState::Pending => true,
                    AlertState::Firing => t.misses >= RESOLVE_AFTER_MISSES,
                    AlertState::Resolved => true,
                };
                if gone {
                    self.drop_alert(now_ms, &key, &mut out);
                }
            }
            // Not evaluated (stale data): left untouched.
        }
        out
    }

    /// Fold a wallet-level condition (no bot) into the book. `present` lists whether the
    /// condition currently holds; call with `None` to record an evaluation without condition.
    pub fn evaluate_wallet(
        &mut self,
        now_ms: i64,
        type_id: AlertTypeId,
        subject: Option<&str>,
        cond: Option<&Condition>,
    ) -> Vec<AlertTransition> {
        let mut out = Vec::new();
        let key = AlertKey {
            type_id,
            bot_key: None,
            subject: subject.map(str::to_owned),
        };
        match cond {
            Some(c) => self.apply_condition(now_ms, key, c, &mut out),
            None => {
                if let Some(t) = self.tracked.get_mut(&key) {
                    t.misses = t.misses.saturating_add(1);
                    if t.alert.state != AlertState::Firing || t.misses >= RESOLVE_AFTER_MISSES {
                        self.drop_alert(now_ms, &key, &mut out);
                    }
                }
            }
        }
        out
    }

    fn apply_condition(
        &mut self,
        now_ms: i64,
        key: AlertKey,
        c: &Condition,
        out: &mut Vec<AlertTransition>,
    ) {
        let silences = self.silences.clone();
        let entry = self.tracked.entry(key.clone()).or_insert_with(|| Tracked {
            alert: Alert {
                id: alert_id(
                    key.type_id,
                    key.bot_key.as_deref(),
                    key.subject.as_deref(),
                    now_ms,
                ),
                type_id: key.type_id,
                bot_key: key.bot_key.clone(),
                subject: key.subject.clone(),
                pair: c.pair.clone(),
                severity: c.severity,
                value: c.value,
                threshold: c.threshold,
                since_ms: now_ms,
                last_seen_ms: now_ms,
                state: AlertState::Pending,
                acked_at_ms: None,
                acked_by_session: None,
                silenced_until_ms: None,
                detail: c.detail.clone(),
            },
            for_ms: c.for_ms,
            misses: 0,
            ack: None,
        });
        let prev_severity = entry.alert.severity;
        entry.misses = 0;
        entry.for_ms = c.for_ms;
        entry.alert.severity = c.severity;
        entry.alert.value = c.value;
        entry.alert.threshold = c.threshold;
        entry.alert.detail.clone_from(&c.detail);
        entry.alert.pair.clone_from(&c.pair);
        entry.alert.last_seen_ms = now_ms;

        let mut kind = None;
        match entry.alert.state {
            AlertState::Pending => {
                if now_ms - entry.alert.since_ms >= entry.for_ms {
                    entry.alert.state = AlertState::Firing;
                    kind = Some(TransitionKind::Raised);
                }
            }
            AlertState::Firing => {
                if let Some(ack) = &entry.ack {
                    if worsened(ack, &entry.alert) {
                        entry.ack = None;
                        entry.alert.acked_at_ms = None;
                        entry.alert.acked_by_session = None;
                        kind = Some(TransitionKind::ReAlerted);
                    }
                } else if c.severity > prev_severity {
                    kind = Some(TransitionKind::Escalated);
                }
            }
            AlertState::Resolved => {}
        }
        if let Some(kind) = kind {
            let alert = decorate(&entry.alert, &silences, now_ms);
            out.push(AlertTransition { kind, alert });
        }
    }

    fn drop_alert(&mut self, now_ms: i64, key: &AlertKey, out: &mut Vec<AlertTransition>) {
        if let Some(mut t) = self.tracked.remove(key)
            && t.alert.state == AlertState::Firing
        {
            t.alert.state = AlertState::Resolved;
            t.alert.last_seen_ms = now_ms;
            out.push(AlertTransition {
                kind: TransitionKind::Resolved,
                alert: decorate(&t.alert, &self.silences, now_ms),
            });
        }
    }

    /// Acknowledge an alert by id. Holds until the alert resolves (or worsens, see module docs).
    pub fn ack(
        &mut self,
        alert_id: &str,
        session: Option<&str>,
        now_ms: i64,
    ) -> Result<(), BookError> {
        let t = self
            .tracked
            .values_mut()
            .find(|t| t.alert.id == alert_id)
            .ok_or(BookError::UnknownAlert)?;
        t.ack = Some(Ack {
            at_ms: now_ms,
            session: session.map(str::to_owned),
            severity: t.alert.severity,
            value: t.alert.value,
        });
        t.alert.acked_at_ms = Some(now_ms);
        t.alert.acked_by_session = session.map(str::to_owned);
        Ok(())
    }

    /// Mute alerts matching the given fields until `until_ms`. Returns the silence id.
    pub fn silence(
        &mut self,
        type_id: Option<AlertTypeId>,
        bot_key: Option<&str>,
        subject: Option<&str>,
        until_ms: i64,
        now_ms: i64,
    ) -> Result<String, BookError> {
        if until_ms <= now_ms {
            return Err(BookError::SilenceInPast);
        }
        self.next_silence += 1;
        let id = format!("s{}", self.next_silence);
        self.silences.push(Silence {
            id: id.clone(),
            type_id,
            bot_key: bot_key.map(str::to_owned),
            subject: subject.map(str::to_owned),
            until_ms,
        });
        Ok(id)
    }

    /// Remove a silence.
    pub fn unsilence(&mut self, id: &str) -> Result<(), BookError> {
        let before = self.silences.len();
        self.silences.retain(|s| s.id != id);
        if self.silences.len() == before {
            Err(BookError::UnknownSilence)
        } else {
            Ok(())
        }
    }

    /// Drop expired silences.
    pub fn prune(&mut self, now_ms: i64) {
        self.silences.retain(|s| s.until_ms > now_ms);
    }

    /// Current silences.
    #[must_use]
    pub fn silences(&self) -> &[Silence] {
        &self.silences
    }

    /// Firing alerts in a deterministic order (see below), with their silence resolved at `now_ms`.
    #[must_use]
    pub fn alerts(&self, now_ms: i64) -> Vec<Alert> {
        let mut v: Vec<Alert> = self
            .tracked
            .values()
            .filter(|t| t.alert.state == AlertState::Firing)
            .map(|t| decorate(&t.alert, &self.silences, now_ms))
            .collect();
        // Deterministic order (the TypeScript side sorts the same way): worst first, then oldest,
        // then catalog order of the rule, bot key and subject.
        v.sort_by(|a, b| {
            b.severity
                .cmp(&a.severity)
                .then(a.since_ms.cmp(&b.since_ms))
                .then(a.type_id.cmp(&b.type_id))
                .then(a.bot_key.cmp(&b.bot_key))
                .then(a.subject.cmp(&b.subject))
        });
        v
    }

    /// Count and worst severity of the *active* alerts (firing, neither acknowledged nor
    /// silenced) of a bot, or of the whole fleet when `bot_key` is `None`.
    #[must_use]
    pub fn summary(&self, bot_key: Option<&str>, now_ms: i64) -> AlertSummary {
        let mut s = AlertSummary::default();
        for a in self.alerts(now_ms) {
            if bot_key.is_some_and(|b| a.bot_key.as_deref() != Some(b)) {
                continue;
            }
            if a.view(now_ms) == Some(AlertView::Active) {
                s.count += 1;
                s.max_severity = Some(s.max_severity.map_or(a.severity, |m| m.max(a.severity)));
            }
        }
        s
    }

    /// Number shown on the bell: active critical and warning alerts (information does not count).
    #[must_use]
    pub fn bell_count(&self, now_ms: i64) -> u32 {
        self.alerts(now_ms)
            .iter()
            .filter(|a| {
                a.view(now_ms) == Some(AlertView::Active) && a.severity >= Severity::Warning
            })
            .count() as u32
    }
}

fn decorate(a: &Alert, silences: &[Silence], now_ms: i64) -> Alert {
    let mut out = a.clone();
    out.silenced_until_ms = silences
        .iter()
        .filter(|s| s.until_ms > now_ms && s.matches(a))
        .map(|s| s.until_ms)
        .max();
    out
}

/// Whether an alert is worse than when it was acknowledged: a higher severity, or a value that
/// moved by at least the rule's re-alert step in the bad direction.
fn worsened(ack: &Ack, a: &Alert) -> bool {
    if a.severity > ack.severity {
        return true;
    }
    let meta = a.type_id.meta();
    match (meta.re_alert_step, ack.value, a.value) {
        (Some(step), Some(was), Some(now)) => match meta.direction {
            Direction::HigherIsWorse => now - was >= step,
            Direction::LowerIsWorse => was - now >= step,
        },
        _ => false,
    }
}

#[cfg(test)]
mod tests;
