use super::*;

const NOW: i64 = 1_792_065_600_000; // 2026-10-15T12:00:00Z
const H: i64 = 3_600_000;

fn ctx() -> BotAlertContext {
    BotAlertContext {
        now_ms: NOW,
        status: BotStatus::Online,
        is_futures: true,
        max_open_trades: None,
        starting_capital: None,
        positions: vec![],
        positions_stale: false,
        median_closed_duration_ms: None,
        last_trade_ts_raw: None,
        drawdown_current_abs: None,
        logs: Some(vec![]),
        rate_limit_events: 0,
    }
}

fn pos(id: i64, side: Side) -> PositionCtx {
    PositionCtx {
        trade_id: id,
        pair: "ETH/USDC:USDC".into(),
        side,
        open_ms: NOW - H,
        open_rate: 100.0,
        current_rate: Some(100.0),
        profit_ratio: Some(0.0),
        liquidation_price: None,
        stoploss_abs: None,
        stake_amount: 10.0,
    }
}

fn line(age_ms: i64, level: &str, msg: &str) -> LogLine {
    LogLine {
        ts_ms: NOW - age_ms,
        level: level.into(),
        message: msg.into(),
    }
}

/// Only the given rules enabled, with default thresholds.
fn only(ids: &[AlertTypeId]) -> BTreeMap<AlertTypeId, RuleConfig> {
    let mut cfg = AlertRulesConfig::default();
    for t in AlertTypeId::ALL {
        let on = ids.contains(&t);
        let e = cfg.global.entry(t).or_default();
        e.enabled = on;
    }
    cfg.effective_for("local:1")
}

fn run(ids: &[AlertTypeId], c: &BotAlertContext) -> Evaluation {
    evaluate_bot(&only(ids), c)
}

fn of(ev: &Evaluation, t: AlertTypeId) -> Vec<&Condition> {
    ev.conditions.iter().filter(|c| c.type_id == t).collect()
}

#[test]
fn catalog_has_the_14_type_ids_of_the_old_ui() {
    let ids: Vec<&str> = rule_catalog().iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids.len(), 14);
    for expected in [
        "positionLoss",
        "positionStuck",
        "nearLiquidation",
        "logErrors",
        "orderFailed",
        "insufficientFunds",
        "exchangeError",
        "walletMismatch",
        "noTradeActivity",
        "botOffline",
        "highDrawdown",
        "capacityFull",
        "allFundsExposed",
        "liquidationBeforeStoploss",
    ] {
        assert!(ids.contains(&expected), "missing {expected}");
    }
    for t in AlertTypeId::ALL {
        assert_eq!(serde_json::to_value(t).unwrap(), t.as_str());
    }
}

#[test]
fn defaults_match_the_old_catalog() {
    let cfg = AlertRulesConfig::default();
    let on: Vec<_> = AlertTypeId::ALL
        .iter()
        .filter(|t| cfg.global[t].enabled)
        .map(|t| t.as_str())
        .collect();
    assert_eq!(
        on,
        [
            "positionLoss",
            "nearLiquidation",
            "logErrors",
            "orderFailed",
            "insufficientFunds",
            "walletMismatch",
            "botOffline",
            "allFundsExposed",
            "liquidationBeforeStoploss"
        ]
    );
    assert_eq!(
        cfg.global[&AlertTypeId::PositionLoss].threshold,
        Some(-10.0)
    );
    assert_eq!(
        cfg.global[&AlertTypeId::NoTradeActivity].threshold,
        Some(24.0)
    );
    assert_eq!(cfg.global[&AlertTypeId::LogErrors].threshold, None);
}

#[test]
fn old_alert_config_json_is_importable() {
    let json = r#"{"global":{"positionLoss":{"enabled":true,"threshold":-12,"includeLeverage":false}},
                  "perBotEnabled":{"local:9056":false}}"#;
    let cfg: AlertRulesConfig = serde_json::from_str(json).unwrap();
    assert_eq!(
        cfg.effective("local:1", AlertTypeId::PositionLoss)
            .threshold,
        Some(-12.0)
    );
    assert!(
        !cfg.effective("local:9056", AlertTypeId::PositionLoss)
            .enabled
    );
}

#[test]
fn per_bot_override_and_mute() {
    let mut cfg = AlertRulesConfig::default();
    cfg.per_bot.entry("local:2".into()).or_default().insert(
        AlertTypeId::PositionLoss,
        RuleConfig {
            enabled: true,
            threshold: Some(-3.0),
            for_s: Some(0),
        },
    );
    assert_eq!(
        cfg.effective("local:2", AlertTypeId::PositionLoss)
            .threshold,
        Some(-3.0)
    );
    assert_eq!(
        cfg.effective("local:3", AlertTypeId::PositionLoss)
            .threshold,
        Some(-10.0)
    );
    cfg.per_bot_enabled.insert("local:2".into(), false);
    assert!(!cfg.effective("local:2", AlertTypeId::PositionLoss).enabled);
}

#[test]
fn position_loss_severity_doubles_at_twice_the_threshold() {
    let mut c = ctx();
    let mut a = pos(1, Side::Long);
    a.profit_ratio = Some(-0.09);
    let mut b = pos(2, Side::Long);
    b.profit_ratio = Some(-0.11);
    let mut d = pos(3, Side::Long);
    d.profit_ratio = Some(-0.21);
    c.positions = vec![a, b, d];
    let ev = run(&[AlertTypeId::PositionLoss], &c);
    let got = of(&ev, AlertTypeId::PositionLoss);
    assert_eq!(got.len(), 2);
    assert_eq!(
        (got[0].subject.as_deref(), got[0].severity),
        (Some("2"), Severity::Warning)
    );
    assert_eq!(
        (got[1].subject.as_deref(), got[1].severity),
        (Some("3"), Severity::Critical)
    );
    assert!((got[0].value.unwrap() + 11.0).abs() < 1e-9);
    assert_eq!(got[0].threshold, Some(-10.0));
    // Warning conditions wait 30 s, critical ones fire at once.
    assert_eq!(got[0].for_ms, DEFAULT_FOR_MS);
    assert_eq!(got[1].for_ms, 0);
}

#[test]
fn position_stuck_uses_the_median_multiple() {
    let mut c = ctx();
    c.median_closed_duration_ms = Some(2 * H);
    let mut slow = pos(1, Side::Long);
    slow.open_ms = NOW - 7 * H;
    let mut ok = pos(2, Side::Long);
    ok.open_ms = NOW - 5 * H;
    c.positions = vec![slow, ok];
    let ev = run(&[AlertTypeId::PositionStuck], &c);
    let got = of(&ev, AlertTypeId::PositionStuck);
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].subject.as_deref(), Some("1"));
    assert!((got[0].value.unwrap() - 3.5).abs() < 1e-9);
    // No history: nothing to compare with, and nothing claimed.
    c.median_closed_duration_ms = None;
    let ev = run(&[AlertTypeId::PositionStuck], &c);
    assert!(ev.conditions.is_empty());
    assert!(ev.evaluated.contains(&AlertTypeId::PositionStuck));
}

#[test]
fn near_liquidation_measures_the_distance_to_the_liquidation_price() {
    // Regression: the old rule used 1 + profit_ratio, which is not a distance to liquidation.
    let mut c = ctx();
    let mut near = pos(1, Side::Long);
    near.current_rate = Some(100.0);
    near.liquidation_price = Some(90.0); // 10 % away
    near.profit_ratio = Some(0.5); // irrelevant for the rule
    let mut far = pos(2, Side::Long);
    far.liquidation_price = Some(50.0); // 50 % away
    far.profit_ratio = Some(-0.95); // the old rule would have fired here
    let mut short = pos(3, Side::Short);
    short.liquidation_price = Some(110.0); // 10 % away above
    c.positions = vec![near, far, short];
    let ev = run(&[AlertTypeId::NearLiquidation], &c);
    let got = of(&ev, AlertTypeId::NearLiquidation);
    let subjects: Vec<_> = got.iter().map(|c| c.subject.clone().unwrap()).collect();
    assert_eq!(subjects, ["1", "3"]);
    assert!(
        got.iter()
            .all(|c| c.severity == Severity::Critical && c.for_ms == 0)
    );
    assert!((got[0].value.unwrap() - 10.0).abs() < 1e-9);
}

#[test]
fn rate_already_past_liquidation_is_distance_zero() {
    let mut c = ctx();
    let mut p = pos(1, Side::Long);
    p.current_rate = Some(85.0);
    p.liquidation_price = Some(90.0);
    c.positions = vec![p];
    let ev = run(&[AlertTypeId::NearLiquidation], &c);
    assert_eq!(of(&ev, AlertTypeId::NearLiquidation)[0].value, Some(0.0));
}

#[test]
fn futures_only_rules_ignore_spot() {
    let mut c = ctx();
    c.is_futures = false;
    let mut p = pos(1, Side::Long);
    p.liquidation_price = Some(99.0);
    p.stoploss_abs = Some(80.0);
    c.positions = vec![p];
    let ev = run(
        &[
            AlertTypeId::NearLiquidation,
            AlertTypeId::LiquidationBeforeStoploss,
        ],
        &c,
    );
    assert!(ev.conditions.is_empty());
}

#[test]
fn liquidation_before_stoploss_compares_distances_on_the_adverse_side() {
    let mut c = ctx();
    let mut bad = pos(1, Side::Long);
    bad.liquidation_price = Some(90.0);
    bad.stoploss_abs = Some(80.0); // the stop is further than the liquidation
    let mut good = pos(2, Side::Long);
    good.liquidation_price = Some(60.0);
    good.stoploss_abs = Some(80.0);
    let mut trailing = pos(3, Side::Long);
    trailing.liquidation_price = Some(60.0);
    trailing.stoploss_abs = Some(105.0); // stop above the rate: it fires first
    let mut short = pos(4, Side::Short);
    short.liquidation_price = Some(110.0);
    short.stoploss_abs = Some(120.0);
    c.positions = vec![bad, good, trailing, short];
    let ev = run(&[AlertTypeId::LiquidationBeforeStoploss], &c);
    let got = of(&ev, AlertTypeId::LiquidationBeforeStoploss);
    let subjects: Vec<_> = got.iter().map(|c| c.subject.clone().unwrap()).collect();
    assert_eq!(subjects, ["1", "4"]);
    assert_eq!(got[0].value, Some(10.0));
    assert_eq!(got[0].threshold, Some(20.0));
}

#[test]
fn log_rules_only_count_recent_lines() {
    let mut c = ctx();
    c.logs = Some(vec![
        line(60_000, "ERROR", "boom"),
        line(2 * 60_000, "CRITICAL", "worse"),
        line(30 * 60_000, "ERROR", "old error outside the window"),
        line(1_000, "INFO", "fine"),
    ]);
    let ev = run(&[AlertTypeId::LogErrors], &c);
    let got = of(&ev, AlertTypeId::LogErrors);
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].value, Some(2.0));
    assert_eq!(got[0].detail.as_deref(), Some("boom | worse"));
    assert_eq!(got[0].severity, Severity::Critical);
}

#[test]
fn log_pattern_rules() {
    let mut c = ctx();
    c.logs = Some(vec![
        line(1_000, "WARNING", "Could not create trade for BTC"),
        line(1_000, "WARNING", "Insufficient funds to open"),
        line(1_000, "WARNING", "ccxt RequestTimeout on fetch"),
        line(1_000, "ERROR", "Wallet shows a total of 0 USDC"),
        line(1_000, "INFO", "Everything is fine"),
    ]);
    let all = [
        AlertTypeId::OrderFailed,
        AlertTypeId::InsufficientFunds,
        AlertTypeId::ExchangeError,
        AlertTypeId::WalletMismatch,
    ];
    let ev = run(&all, &c);
    let count = |t| of(&ev, t)[0].value.unwrap();
    assert_eq!(count(AlertTypeId::OrderFailed), 2.0); // "Could not create" + "Insufficient funds"
    assert_eq!(count(AlertTypeId::InsufficientFunds), 1.0);
    assert_eq!(count(AlertTypeId::ExchangeError), 1.0);
    assert_eq!(count(AlertTypeId::WalletMismatch), 1.0);
    assert_eq!(
        of(&ev, AlertTypeId::WalletMismatch)[0].severity,
        Severity::Critical
    );
    assert_eq!(
        of(&ev, AlertTypeId::InsufficientFunds)[0].severity,
        Severity::Warning
    );
    // Matching is case insensitive.
    c.logs = Some(vec![line(1_000, "WARNING", "insufficient FUNDS")]);
    assert_eq!(
        run(&[AlertTypeId::InsufficientFunds], &c).conditions.len(),
        1
    );
}

#[test]
fn daemon_rate_limit_events_feed_exchange_error() {
    let mut c = ctx();
    c.rate_limit_events = 3;
    let ev = run(&[AlertTypeId::ExchangeError], &c);
    assert_eq!(of(&ev, AlertTypeId::ExchangeError)[0].value, Some(3.0));
}

#[test]
fn unavailable_logs_skip_the_log_rules() {
    let mut c = ctx();
    c.logs = None;
    let ev = run(&[AlertTypeId::LogErrors, AlertTypeId::OrderFailed], &c);
    assert!(ev.conditions.is_empty());
    assert!(ev.evaluated.is_empty());
}

#[test]
fn no_trade_activity_regression_milliseconds_not_seconds() {
    // Regression for bug B5: `latest_trade_timestamp` is in milliseconds; the browser compared it
    // with seconds and never fired. 30 h ago must fire with the default 24 h threshold, whatever
    // the unit the source used.
    let thirty_h_ago_ms = (NOW - 30 * H) as f64;
    for raw in [
        thirty_h_ago_ms,
        thirty_h_ago_ms / 1000.0,
        thirty_h_ago_ms * 1000.0,
    ] {
        let mut c = ctx();
        c.last_trade_ts_raw = Some(raw);
        let ev = run(&[AlertTypeId::NoTradeActivity], &c);
        let got = of(&ev, AlertTypeId::NoTradeActivity);
        assert_eq!(got.len(), 1, "raw = {raw}");
        assert!((got[0].value.unwrap() - 30.0).abs() < 1e-6);
        // Always information: an inactive long bot in a bear market is not an incident.
        assert_eq!(got[0].severity, Severity::Info);
    }
    let mut c = ctx();
    c.last_trade_ts_raw = Some((NOW - 2 * H) as f64);
    assert!(
        run(&[AlertTypeId::NoTradeActivity], &c)
            .conditions
            .is_empty()
    );
    c.last_trade_ts_raw = None;
    assert!(
        run(&[AlertTypeId::NoTradeActivity], &c)
            .conditions
            .is_empty()
    );
}

#[test]
fn no_trade_activity_ignores_future_dates() {
    let mut c = ctx();
    c.last_trade_ts_raw = Some((NOW + 5 * H) as f64);
    assert!(
        run(&[AlertTypeId::NoTradeActivity], &c)
            .conditions
            .is_empty()
    );
}

#[test]
fn bot_offline_follows_the_state_machine() {
    let mut c = ctx();
    for (status, expected) in [
        (BotStatus::Offline, Some(Severity::Critical)),
        (BotStatus::Starting, Some(Severity::Info)),
        (BotStatus::Online, None),
        (BotStatus::Stopped, None),
        (BotStatus::AuthExpired, None),
    ] {
        c.status = status;
        let ev = run(&[AlertTypeId::BotOffline], &c);
        assert_eq!(
            of(&ev, AlertTypeId::BotOffline).first().map(|c| c.severity),
            expected,
            "{status:?}"
        );
    }
}

#[test]
fn high_drawdown_is_relative_to_the_starting_capital() {
    let mut c = ctx();
    c.starting_capital = Some(1000.0);
    c.drawdown_current_abs = Some(160.0);
    let ev = run(&[AlertTypeId::HighDrawdown], &c);
    let got = of(&ev, AlertTypeId::HighDrawdown);
    assert!((got[0].value.unwrap() + 16.0).abs() < 1e-9);
    assert_eq!(got[0].threshold, Some(-15.0));
    c.drawdown_current_abs = Some(100.0);
    assert!(run(&[AlertTypeId::HighDrawdown], &c).conditions.is_empty());
    // Unknown capital: cannot say, rule skipped rather than "healthy".
    c.starting_capital = None;
    let ev = run(&[AlertTypeId::HighDrawdown], &c);
    assert!(ev.evaluated.is_empty());
}

#[test]
fn capacity_full_at_max_open_trades() {
    let mut c = ctx();
    c.max_open_trades = Some(2);
    c.positions = vec![pos(1, Side::Long)];
    assert!(run(&[AlertTypeId::CapacityFull], &c).conditions.is_empty());
    c.positions.push(pos(2, Side::Short));
    let ev = run(&[AlertTypeId::CapacityFull], &c);
    let got = of(&ev, AlertTypeId::CapacityFull);
    assert_eq!(
        (got[0].value, got[0].threshold, got[0].severity),
        (Some(2.0), Some(2.0), Severity::Info)
    );
    c.max_open_trades = Some(0);
    assert!(run(&[AlertTypeId::CapacityFull], &c).conditions.is_empty());
}

#[test]
fn all_funds_exposed_regression_reads_the_starting_capital() {
    // Regression for bug B6: the old rule read `state.balance`, which does not exist.
    let mut c = ctx();
    c.starting_capital = Some(100.0);
    let mut a = pos(1, Side::Long);
    a.stake_amount = 60.0;
    let mut b = pos(2, Side::Short);
    b.stake_amount = 35.0;
    c.positions = vec![a, b];
    let ev = run(&[AlertTypeId::AllFundsExposed], &c);
    let got = of(&ev, AlertTypeId::AllFundsExposed);
    assert_eq!(got.len(), 1);
    assert!((got[0].value.unwrap() - 95.0).abs() < 1e-9);
    assert_eq!(got[0].threshold, Some(95.0));
    c.positions[1].stake_amount = 34.0;
    assert!(
        run(&[AlertTypeId::AllFundsExposed], &c)
            .conditions
            .is_empty()
    );
    // No positions: never fires even with a tiny capital.
    c.positions.clear();
    assert!(
        run(&[AlertTypeId::AllFundsExposed], &c)
            .conditions
            .is_empty()
    );
    // Unknown capital: skipped.
    c.starting_capital = None;
    assert!(
        run(&[AlertTypeId::AllFundsExposed], &c)
            .evaluated
            .is_empty()
    );
}

#[test]
fn stale_positions_skip_position_rules_instead_of_reporting_calm() {
    let mut c = ctx();
    c.positions_stale = true;
    c.max_open_trades = Some(1);
    c.starting_capital = Some(100.0);
    c.median_closed_duration_ms = Some(H);
    c.positions = vec![pos(1, Side::Long)];
    let ev = run(
        &[
            AlertTypeId::PositionLoss,
            AlertTypeId::PositionStuck,
            AlertTypeId::NearLiquidation,
            AlertTypeId::LiquidationBeforeStoploss,
            AlertTypeId::CapacityFull,
            AlertTypeId::AllFundsExposed,
            AlertTypeId::BotOffline,
        ],
        &c,
    );
    assert!(ev.conditions.is_empty());
    // Only the rule that does not depend on positions was evaluated.
    assert_eq!(
        ev.evaluated.iter().copied().collect::<Vec<_>>(),
        [AlertTypeId::BotOffline]
    );
}

#[test]
fn disabled_rules_are_reported_as_disabled() {
    let ev = run(&[AlertTypeId::BotOffline], &ctx());
    assert!(ev.disabled.contains(&AlertTypeId::PositionLoss));
    assert!(!ev.disabled.contains(&AlertTypeId::BotOffline));
    assert_eq!(ev.disabled.len(), 13);
}

#[test]
fn explicit_for_overrides_the_default_delay() {
    let mut rules = only(&[AlertTypeId::CapacityFull]);
    rules.get_mut(&AlertTypeId::CapacityFull).unwrap().for_s = Some(90);
    let mut c = ctx();
    c.max_open_trades = Some(1);
    c.positions = vec![pos(1, Side::Long)];
    let ev = evaluate_bot(&rules, &c);
    assert_eq!(ev.conditions[0].for_ms, 90_000);
}
