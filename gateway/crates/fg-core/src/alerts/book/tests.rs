use std::collections::BTreeSet;

use super::*;

const BOT: &str = "local:9056";
const S: i64 = 1_000;
const MIN: i64 = 60_000;
const T0: i64 = 1_792_065_600_000;

fn cond(
    t: AlertTypeId,
    subject: Option<&str>,
    sev: Severity,
    value: Option<f64>,
    for_ms: i64,
) -> Condition {
    Condition {
        type_id: t,
        subject: subject.map(str::to_owned),
        severity: sev,
        value,
        threshold: None,
        detail: None,
        for_ms,
    }
}

fn ev(conds: Vec<Condition>, evaluated: &[AlertTypeId]) -> Evaluation {
    Evaluation {
        conditions: conds,
        evaluated: evaluated.iter().copied().collect(),
        disabled: BTreeSet::new(),
    }
}

fn kinds(t: &[AlertTransition]) -> Vec<TransitionKind> {
    t.iter().map(|x| x.kind).collect()
}

#[test]
fn critical_fires_immediately_warning_waits_for_its_delay() {
    let mut b = AlertBook::new();
    let e = ev(
        vec![
            cond(AlertTypeId::BotOffline, None, Severity::Critical, None, 0),
            cond(
                AlertTypeId::CapacityFull,
                None,
                Severity::Warning,
                None,
                30 * S,
            ),
        ],
        &[AlertTypeId::BotOffline, AlertTypeId::CapacityFull],
    );
    let t = b.evaluate_bot(T0, BOT, &e);
    assert_eq!(kinds(&t), [TransitionKind::Raised]);
    assert_eq!(t[0].alert.type_id, AlertTypeId::BotOffline);
    assert_eq!(b.alerts(T0).len(), 1);
    // 20 s later the warning is still pending, 30 s later it fires.
    assert!(b.evaluate_bot(T0 + 20 * S, BOT, &e).is_empty());
    let t = b.evaluate_bot(T0 + 30 * S, BOT, &e);
    assert_eq!(kinds(&t), [TransitionKind::Raised]);
    assert_eq!(t[0].alert.type_id, AlertTypeId::CapacityFull);
    assert_eq!(t[0].alert.since_ms, T0);
    assert_eq!(b.alerts(T0 + 30 * S).len(), 2);
}

#[test]
fn a_condition_that_vanishes_before_firing_leaves_no_trace() {
    let mut b = AlertBook::new();
    let on = ev(
        vec![cond(
            AlertTypeId::CapacityFull,
            None,
            Severity::Info,
            None,
            30 * S,
        )],
        &[AlertTypeId::CapacityFull],
    );
    let off = ev(vec![], &[AlertTypeId::CapacityFull]);
    assert!(b.evaluate_bot(T0, BOT, &on).is_empty());
    assert!(b.evaluate_bot(T0 + 10 * S, BOT, &off).is_empty());
    assert!(b.alerts(T0 + 10 * S).is_empty());
    assert!(b.to_state().tracked.is_empty());
}

#[test]
fn resolution_takes_two_clean_evaluations() {
    let mut b = AlertBook::new();
    let on = ev(
        vec![cond(
            AlertTypeId::BotOffline,
            None,
            Severity::Critical,
            None,
            0,
        )],
        &[AlertTypeId::BotOffline],
    );
    let off = ev(vec![], &[AlertTypeId::BotOffline]);
    b.evaluate_bot(T0, BOT, &on);
    assert!(b.evaluate_bot(T0 + 10 * S, BOT, &off).is_empty());
    // The condition comes back: the miss counter restarts.
    assert!(b.evaluate_bot(T0 + 20 * S, BOT, &on).is_empty());
    assert!(b.evaluate_bot(T0 + 30 * S, BOT, &off).is_empty());
    let t = b.evaluate_bot(T0 + 40 * S, BOT, &off);
    assert_eq!(kinds(&t), [TransitionKind::Resolved]);
    assert_eq!(t[0].alert.state, AlertState::Resolved);
    assert!(b.alerts(T0 + 40 * S).is_empty());
}

#[test]
fn dedup_ignores_everything_but_type_bot_and_subject() {
    let mut b = AlertBook::new();
    let mut c = cond(
        AlertTypeId::LogErrors,
        None,
        Severity::Critical,
        Some(1.0),
        0,
    );
    c.detail = Some("first message".into());
    b.evaluate_bot(T0, BOT, &ev(vec![c.clone()], &[AlertTypeId::LogErrors]));
    // The error counter and the excerpt change at every evaluation: still one alert, one id.
    let id = b.alerts(T0)[0].id.clone();
    for i in 1..5 {
        let mut c2 = c.clone();
        c2.value = Some(1.0 + f64::from(i));
        c2.detail = Some(format!("message {i}"));
        let t = b.evaluate_bot(
            T0 + i64::from(i) * S,
            BOT,
            &ev(vec![c2], &[AlertTypeId::LogErrors]),
        );
        assert!(t.is_empty());
    }
    let alerts = b.alerts(T0 + 10 * S);
    assert_eq!(alerts.len(), 1);
    assert_eq!(alerts[0].id, id);
    assert_eq!(alerts[0].value, Some(5.0));
    assert_eq!(alerts[0].detail.as_deref(), Some("message 4"));
    // A different subject or a different bot is a different alert.
    let sub = cond(
        AlertTypeId::PositionLoss,
        Some("12"),
        Severity::Critical,
        Some(-25.0),
        0,
    );
    let sub2 = cond(
        AlertTypeId::PositionLoss,
        Some("13"),
        Severity::Critical,
        Some(-25.0),
        0,
    );
    b.evaluate_bot(
        T0,
        BOT,
        &ev(vec![sub.clone(), sub2], &[AlertTypeId::PositionLoss]),
    );
    b.evaluate_bot(
        T0,
        "local:9057",
        &ev(vec![sub], &[AlertTypeId::PositionLoss]),
    );
    assert_eq!(b.alerts(T0).len(), 4);
}

#[test]
fn ids_are_stable_per_episode_and_new_after_resolution() {
    let mut b = AlertBook::new();
    let on = ev(
        vec![cond(
            AlertTypeId::BotOffline,
            None,
            Severity::Critical,
            None,
            0,
        )],
        &[AlertTypeId::BotOffline],
    );
    let off = ev(vec![], &[AlertTypeId::BotOffline]);
    b.evaluate_bot(T0, BOT, &on);
    let first = b.alerts(T0)[0].id.clone();
    b.evaluate_bot(T0 + S, BOT, &off);
    b.evaluate_bot(T0 + 2 * S, BOT, &off);
    b.evaluate_bot(T0 + 3 * S, BOT, &on);
    let second = b.alerts(T0 + 3 * S)[0].id.clone();
    assert_ne!(first, second);
}

#[test]
fn skipped_rules_leave_their_alerts_untouched() {
    let mut b = AlertBook::new();
    let on = ev(
        vec![cond(
            AlertTypeId::NearLiquidation,
            Some("5"),
            Severity::Critical,
            Some(8.0),
            0,
        )],
        &[AlertTypeId::NearLiquidation],
    );
    b.evaluate_bot(T0, BOT, &on);
    // Stale data: the rule is not evaluated, the alert must neither resolve nor age.
    let skipped = ev(vec![], &[]);
    for i in 1..10 {
        assert!(b.evaluate_bot(T0 + i * MIN, BOT, &skipped).is_empty());
    }
    assert_eq!(b.alerts(T0 + 10 * MIN).len(), 1);
}

#[test]
fn disabling_a_rule_drops_its_alerts() {
    let mut b = AlertBook::new();
    b.evaluate_bot(
        T0,
        BOT,
        &ev(
            vec![cond(
                AlertTypeId::BotOffline,
                None,
                Severity::Critical,
                None,
                0,
            )],
            &[AlertTypeId::BotOffline],
        ),
    );
    let mut off = ev(vec![], &[]);
    off.disabled.insert(AlertTypeId::BotOffline);
    let t = b.evaluate_bot(T0 + S, BOT, &off);
    assert_eq!(kinds(&t), [TransitionKind::Resolved]);
    assert!(b.alerts(T0 + S).is_empty());
}

#[test]
fn other_bots_are_not_affected_by_an_evaluation() {
    let mut b = AlertBook::new();
    let on = ev(
        vec![cond(
            AlertTypeId::BotOffline,
            None,
            Severity::Critical,
            None,
            0,
        )],
        &[AlertTypeId::BotOffline],
    );
    b.evaluate_bot(T0, "local:1", &on);
    b.evaluate_bot(T0, "local:2", &on);
    let off = ev(vec![], &[AlertTypeId::BotOffline]);
    b.evaluate_bot(T0 + S, "local:1", &off);
    b.evaluate_bot(T0 + 2 * S, "local:1", &off);
    let left = b.alerts(T0 + 2 * S);
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].bot_key.as_deref(), Some("local:2"));
}

#[test]
fn escalation_is_reported_once() {
    let mut b = AlertBook::new();
    let warn = ev(
        vec![cond(
            AlertTypeId::PositionLoss,
            Some("1"),
            Severity::Critical,
            Some(-12.0),
            0,
        )],
        &[AlertTypeId::PositionLoss],
    );
    // Start as a warning that fires at once (for = 0 configured).
    let mut w = warn.clone();
    w.conditions[0].severity = Severity::Warning;
    assert_eq!(
        kinds(&b.evaluate_bot(T0, BOT, &w)),
        [TransitionKind::Raised]
    );
    assert_eq!(
        kinds(&b.evaluate_bot(T0 + S, BOT, &warn)),
        [TransitionKind::Escalated]
    );
    assert!(b.evaluate_bot(T0 + 2 * S, BOT, &warn).is_empty());
}

#[test]
fn ack_holds_until_resolution() {
    let mut b = AlertBook::new();
    let on = ev(
        vec![cond(
            AlertTypeId::LogErrors,
            None,
            Severity::Critical,
            Some(2.0),
            0,
        )],
        &[AlertTypeId::LogErrors],
    );
    b.evaluate_bot(T0, BOT, &on);
    let id = b.alerts(T0)[0].id.clone();
    assert_eq!(b.summary(Some(BOT), T0).count, 1);
    b.ack(&id, Some("sess-1"), T0 + S).unwrap();
    let a = &b.alerts(T0 + S)[0];
    assert_eq!(a.view(T0 + S), Some(AlertView::Acked));
    assert_eq!(a.acked_by_session.as_deref(), Some("sess-1"));
    assert_eq!(b.summary(Some(BOT), T0 + S).count, 0);
    assert_eq!(b.bell_count(T0 + S), 0);
    // Same value for a long time: still acknowledged, no transition.
    for i in 2..20 {
        assert!(b.evaluate_bot(T0 + i * MIN, BOT, &on).is_empty());
    }
    assert_eq!(
        b.alerts(T0 + 20 * MIN)[0].view(T0 + 20 * MIN),
        Some(AlertView::Acked)
    );
    assert_eq!(b.ack("nope", None, T0), Err(BookError::UnknownAlert));
}

#[test]
fn acked_alert_comes_back_when_its_severity_rises() {
    let mut b = AlertBook::new();
    let mut e = ev(
        vec![cond(
            AlertTypeId::PositionLoss,
            Some("1"),
            Severity::Warning,
            Some(-12.0),
            0,
        )],
        &[AlertTypeId::PositionLoss],
    );
    b.evaluate_bot(T0, BOT, &e);
    let id = b.alerts(T0)[0].id.clone();
    b.ack(&id, None, T0 + S).unwrap();
    e.conditions[0].severity = Severity::Critical;
    e.conditions[0].value = Some(-12.5);
    let t = b.evaluate_bot(T0 + 2 * S, BOT, &e);
    assert_eq!(kinds(&t), [TransitionKind::ReAlerted]);
    assert_eq!(t[0].alert.view(T0 + 2 * S), Some(AlertView::Active));
    assert_eq!(t[0].alert.acked_at_ms, None);
}

#[test]
fn acked_alert_comes_back_when_its_value_worsens_by_a_step() {
    let mut b = AlertBook::new();
    // positionLoss: lower is worse, re-alert step 5 points.
    let mut e = ev(
        vec![cond(
            AlertTypeId::PositionLoss,
            Some("1"),
            Severity::Warning,
            Some(-12.0),
            0,
        )],
        &[AlertTypeId::PositionLoss],
    );
    b.evaluate_bot(T0, BOT, &e);
    let id = b.alerts(T0)[0].id.clone();
    b.ack(&id, None, T0).unwrap();
    e.conditions[0].value = Some(-16.0);
    assert!(
        b.evaluate_bot(T0 + S, BOT, &e).is_empty(),
        "4 points is not a step"
    );
    e.conditions[0].value = Some(-17.0);
    assert_eq!(
        kinds(&b.evaluate_bot(T0 + 2 * S, BOT, &e)),
        [TransitionKind::ReAlerted]
    );
    // Acknowledge again at -17: the baseline moves with the new acknowledgement.
    b.ack(&id, None, T0 + 3 * S).unwrap();
    e.conditions[0].value = Some(-18.0);
    assert!(b.evaluate_bot(T0 + 4 * S, BOT, &e).is_empty());
    // Getting better never re-alerts.
    e.conditions[0].value = Some(-11.0);
    assert!(b.evaluate_bot(T0 + 5 * S, BOT, &e).is_empty());
}

#[test]
fn rules_without_a_step_only_re_alert_on_severity() {
    let mut b = AlertBook::new();
    let mut e = ev(
        vec![cond(
            AlertTypeId::LogErrors,
            None,
            Severity::Critical,
            Some(1.0),
            0,
        )],
        &[AlertTypeId::LogErrors],
    );
    b.evaluate_bot(T0, BOT, &e);
    let id = b.alerts(T0)[0].id.clone();
    b.ack(&id, None, T0).unwrap();
    e.conditions[0].value = Some(500.0);
    assert!(b.evaluate_bot(T0 + S, BOT, &e).is_empty());
}

#[test]
fn silence_flags_without_hiding_and_expires() {
    let mut b = AlertBook::new();
    let on = ev(
        vec![cond(
            AlertTypeId::BotOffline,
            None,
            Severity::Critical,
            None,
            0,
        )],
        &[AlertTypeId::BotOffline],
    );
    b.evaluate_bot(T0, BOT, &on);
    let until = T0 + 60 * MIN;
    let sid = b
        .silence(Some(AlertTypeId::BotOffline), Some(BOT), None, until, T0)
        .unwrap();
    let a = &b.alerts(T0 + MIN)[0];
    assert_eq!(a.view(T0 + MIN), Some(AlertView::Silenced));
    assert_eq!(a.silenced_until_ms, Some(until));
    assert_eq!(b.summary(None, T0 + MIN).count, 0);
    // A silence also wins over an acknowledgement.
    let id = a.id.clone();
    b.ack(&id, None, T0 + MIN).unwrap();
    assert_eq!(
        b.alerts(T0 + 2 * MIN)[0].view(T0 + 2 * MIN),
        Some(AlertView::Silenced)
    );
    // After the deadline the alert is back to its acknowledged state, silence pruned.
    let later = until + S;
    assert_eq!(b.alerts(later)[0].view(later), Some(AlertView::Acked));
    b.prune(later);
    assert!(b.silences().is_empty());
    assert_eq!(b.unsilence(&sid), Err(BookError::UnknownSilence));
    assert_eq!(
        b.silence(None, None, None, T0, T0),
        Err(BookError::SilenceInPast)
    );
}

#[test]
fn silence_scope_is_respected() {
    let mut b = AlertBook::new();
    let on = ev(
        vec![cond(
            AlertTypeId::BotOffline,
            None,
            Severity::Critical,
            None,
            0,
        )],
        &[AlertTypeId::BotOffline],
    );
    b.evaluate_bot(T0, "local:1", &on);
    b.evaluate_bot(T0, "local:2", &on);
    b.silence(None, Some("local:1"), None, T0 + MIN, T0)
        .unwrap();
    let views: Vec<_> = b
        .alerts(T0)
        .iter()
        .map(|a| (a.bot_key.clone().unwrap(), a.view(T0).unwrap()))
        .collect();
    assert!(views.contains(&("local:1".into(), AlertView::Silenced)));
    assert!(views.contains(&("local:2".into(), AlertView::Active)));
    // A silence on a rule type mutes it for every bot.
    b.silence(Some(AlertTypeId::BotOffline), None, None, T0 + MIN, T0)
        .unwrap();
    assert_eq!(b.summary(None, T0).count, 0);
}

#[test]
fn transitions_carry_the_silence_so_consumers_can_skip_the_notification() {
    let mut b = AlertBook::new();
    b.silence(Some(AlertTypeId::BotOffline), Some(BOT), None, T0 + MIN, T0)
        .unwrap();
    let on = ev(
        vec![cond(
            AlertTypeId::BotOffline,
            None,
            Severity::Critical,
            None,
            0,
        )],
        &[AlertTypeId::BotOffline],
    );
    let t = b.evaluate_bot(T0, BOT, &on);
    assert_eq!(t[0].alert.silenced_until_ms, Some(T0 + MIN));
}

#[test]
fn bell_counts_critical_and_warning_but_not_information() {
    let mut b = AlertBook::new();
    let e = ev(
        vec![
            cond(AlertTypeId::BotOffline, None, Severity::Critical, None, 0),
            cond(
                AlertTypeId::AllFundsExposed,
                None,
                Severity::Warning,
                None,
                0,
            ),
            cond(AlertTypeId::CapacityFull, None, Severity::Info, None, 0),
        ],
        &[
            AlertTypeId::BotOffline,
            AlertTypeId::AllFundsExposed,
            AlertTypeId::CapacityFull,
        ],
    );
    b.evaluate_bot(T0, BOT, &e);
    assert_eq!(b.bell_count(T0), 2);
    let s = b.summary(Some(BOT), T0);
    assert_eq!((s.count, s.max_severity), (3, Some(Severity::Critical)));
    assert_eq!(b.summary(Some("local:1"), T0).count, 0);
    // Worst first.
    let order: Vec<_> = b.alerts(T0).iter().map(|a| a.severity).collect();
    assert_eq!(
        order,
        [Severity::Critical, Severity::Warning, Severity::Info]
    );
}

#[test]
fn wallet_level_alerts_have_no_bot() {
    let mut b = AlertBook::new();
    let c = cond(
        AlertTypeId::WalletMismatch,
        Some("PENGU"),
        Severity::Critical,
        Some(1.0),
        0,
    );
    let t = b.evaluate_wallet(T0, AlertTypeId::WalletMismatch, Some("PENGU"), Some(&c));
    assert_eq!(kinds(&t), [TransitionKind::Raised]);
    assert_eq!(t[0].alert.bot_key, None);
    assert!(
        b.evaluate_wallet(T0 + S, AlertTypeId::WalletMismatch, Some("PENGU"), None)
            .is_empty()
    );
    let t = b.evaluate_wallet(T0 + 2 * S, AlertTypeId::WalletMismatch, Some("PENGU"), None);
    assert_eq!(kinds(&t), [TransitionKind::Resolved]);
}

#[test]
fn state_round_trips_through_json() {
    let mut b = AlertBook::new();
    let on = ev(
        vec![cond(
            AlertTypeId::BotOffline,
            None,
            Severity::Critical,
            None,
            0,
        )],
        &[AlertTypeId::BotOffline],
    );
    b.evaluate_bot(T0, BOT, &on);
    let id = b.alerts(T0)[0].id.clone();
    b.ack(&id, Some("s"), T0).unwrap();
    b.silence(None, Some("local:7"), None, T0 + MIN, T0)
        .unwrap();
    let json = serde_json::to_string(&b.to_state()).unwrap();
    let restored = AlertBook::from_state(serde_json::from_str(&json).unwrap());
    assert_eq!(restored.alerts(T0), b.alerts(T0));
    assert_eq!(restored.silences(), b.silences());
    // The restored book keeps the acknowledgement and the dedup identity.
    let mut restored = restored;
    assert!(restored.evaluate_bot(T0 + S, BOT, &on).is_empty());
    assert_eq!(restored.alerts(T0 + S).len(), 1);
}
