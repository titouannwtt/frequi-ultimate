//! Tests of the engine against in-memory fakes, on tokio's virtual time.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use fg_core::alerts::{AlertTypeId, AlertView};
use fg_core::identity::BotKey;
use fg_core::model::{ActionStatus, BotMode, BotStatus, EventKind, FreshnessGroup};
use fg_core::protocol::{Channel, ChannelState, ResyncReason, ServerFrame};
use fg_sources::botrest::{RestError, WriteAction, WriteOutcome};
use fg_sources::botws::{BotMessage, WsEvent};
use fg_sources::sqlite::ProfitSample;
use serde_json::json;

use crate::actions::{ActionOrigin, ActionRequest, ExpectedTrade};
use crate::clock::TokioClock;
use crate::config::EngineConfig;
use crate::handle::{AlertFilter, Engine, EngineHandle, EngineSources};
use crate::testkit::{
    FAKE_WALLET, FakeBot, FakeDaemon, FakeDiscovery, FakeLedger, FakeNet, FakeTicker, Mode,
    closed_trade, discovered, open_trade,
};

const T0: i64 = 1_760_000_000_000;
const HOUR: i64 = 3_600_000;

struct Spec {
    port: u16,
    name: &'static str,
    live: bool,
    wallet: Option<&'static str>,
    capital: Option<f64>,
}

fn spec(port: u16, name: &'static str, live: bool) -> Spec {
    Spec {
        port,
        name,
        live,
        wallet: live.then_some(FAKE_WALLET),
        capital: Some(500.0),
    }
}

struct Rig {
    engine: Engine,
    h: EngineHandle,
    net: Arc<FakeNet>,
    ledger: Arc<FakeLedger>,
    daemon: Arc<FakeDaemon>,
    bots: Vec<Arc<FakeBot>>,
    disc: Arc<FakeDiscovery>,
    dir: tempfile::TempDir,
}

fn db_path(name: &str) -> PathBuf {
    PathBuf::from(format!("/fake/db/{name}.sqlite"))
}

async fn rig_in(
    dir: tempfile::TempDir,
    specs: &[Spec],
    edit: impl FnOnce(&mut EngineConfig),
) -> Rig {
    let bots: Vec<Arc<FakeBot>> = specs.iter().map(|s| FakeBot::new(s.port)).collect();
    let net = FakeNet::new(&bots);
    let ledger = Arc::new(FakeLedger::default());
    for s in specs {
        ledger.with(&db_path(s.name), |_| {});
    }
    let disc = Arc::new(FakeDiscovery {
        bots: std::sync::Mutex::new(
            specs
                .iter()
                .map(|s| discovered(s.port, s.name, s.live, s.wallet, s.capital))
                .collect(),
        ),
    });
    let daemon = Arc::new(FakeDaemon::default());
    let mut cfg = EngineConfig::new(dir.path());
    edit(&mut cfg);
    let engine = Engine::start(
        cfg,
        EngineSources {
            discovery: disc.clone(),
            ledger: ledger.clone(),
            daemon: Some(daemon.clone()),
            connector: net.clone(),
            ws: net.clone(),
            ticker: Some(Arc::new(FakeTicker)),
        },
        Arc::new(TokioClock::new(T0)),
    )
    .await
    .unwrap();
    let h = engine.handle();
    Rig {
        engine,
        h,
        net,
        ledger,
        daemon,
        bots,
        disc,
        dir,
    }
}

async fn rig(specs: &[Spec]) -> Rig {
    rig_in(tempfile::tempdir().unwrap(), specs, |_| {}).await
}

async fn settle(secs: u64) {
    tokio::time::sleep(Duration::from_secs(secs)).await;
}

fn key(port: u16) -> BotKey {
    BotKey::Local(port)
}

impl Rig {
    /// Charts being relayed.
    fn engine_charts(&self) -> usize {
        self.h.sh_charts_len()
    }

    async fn status_of(&self, port: u16) -> BotStatus {
        self.h.publish_now().await.unwrap();
        self.h.published().bots[&key(port)].state.status
    }
}

fn ws_msg(kind: &str, data: serde_json::Value) -> WsEvent {
    WsEvent::Message(BotMessage {
        kind: kind.into(),
        data,
    })
}

fn snapshot(entries: serde_json::Value) -> WsEvent {
    ws_msg("trade_snapshot", entries)
}

// ====================================================================== scheduling

#[tokio::test(start_paused = true)]
async fn a_bot_becomes_online_after_its_first_good_answer() {
    let r = rig(&[spec(9001, "a", true)]).await;
    assert!(
        r.h.published().bots.is_empty(),
        "nothing before the first scan"
    );
    settle(60).await;
    assert_eq!(r.status_of(9001).await, BotStatus::Online);
    assert!(r.net.connected(9001), "websocket opened");
}

#[tokio::test(start_paused = true)]
async fn the_offline_detector_needs_three_transport_failures_then_pings_with_backoff() {
    let r = rig(&[spec(9001, "a", true)]).await;
    settle(130).await;
    assert_eq!(r.status_of(9001).await, BotStatus::Online);
    let bot = &r.bots[0];
    bot.set_mode(Mode::Fail(RestError::Refused));
    bot.state.lock().unwrap().ping_ok = false;
    settle(400).await;
    assert_eq!(r.status_of(9001).await, BotStatus::Offline);
    // An offline bot is only pinged; the REST reads stop.
    let reads_before = bot.call_count() - bot.calls_of("ping").len();
    settle(600).await;
    let reads_after = bot.call_count() - bot.calls_of("ping").len();
    assert_eq!(reads_before, reads_after, "no read while offline");
    // Ping gaps follow 30 s, 60 s, then 120 s (+-20 % jitter).
    let pings = bot.calls_of("ping");
    let gaps: Vec<f64> = pings
        .windows(2)
        .map(|w| (w[1] - w[0]).as_secs_f64())
        .collect();
    assert!(gaps.len() >= 4, "{gaps:?}");
    let near = |g: f64, want: f64| (g - want).abs() <= want * 0.25;
    assert!(near(gaps[0], 60.0) || near(gaps[0], 30.0), "{gaps:?}");
    assert!(gaps.iter().skip(2).all(|g| near(*g, 120.0)), "{gaps:?}");
    // It comes back: `starting` first, then `online` after the full resynchronisation.
    bot.set_mode(Mode::Up);
    bot.state.lock().unwrap().ping_ok = true;
    let features_before = bot.calls_of("features").len();
    settle(300).await;
    assert_eq!(r.status_of(9001).await, BotStatus::Online);
    assert!(
        bot.calls_of("features").len() > features_before,
        "resync re-reads the config"
    );
    let kinds: Vec<EventKind> =
        r.h.events(Default::default())
            .await
            .iter()
            .map(|e| e.kind)
            .collect();
    assert!(kinds.contains(&EventKind::BotOffline));
    assert_eq!(
        kinds.iter().filter(|k| **k == EventKind::BotOnline).count(),
        2
    );
}

#[tokio::test(start_paused = true)]
async fn one_or_two_failures_do_not_flip_the_bot() {
    let r = rig(&[spec(9001, "a", true)]).await;
    settle(130).await;
    let bot = &r.bots[0];
    bot.set_mode(Mode::Fail(RestError::Timeout));
    // Long enough for two scheduled reads only.
    settle(35).await;
    bot.set_mode(Mode::Up);
    settle(120).await;
    assert_eq!(r.status_of(9001).await, BotStatus::Online);
}

#[tokio::test(start_paused = true)]
async fn a_starting_bot_is_not_an_outage_and_refused_credentials_are_not_either() {
    let r = rig(&[spec(9001, "a", true), spec(9002, "b", true)]).await;
    settle(130).await;
    r.bots[0].set_mode(Mode::Fail(RestError::Starting));
    r.bots[1].set_mode(Mode::Fail(RestError::AuthFailed));
    settle(200).await;
    assert_eq!(r.status_of(9001).await, BotStatus::Starting);
    assert_eq!(r.status_of(9002).await, BotStatus::AuthExpired);
    // Credentials come back: online again, no ping storm in between.
    r.bots[1].set_mode(Mode::Up);
    settle(300).await;
    assert_eq!(r.status_of(9002).await, BotStatus::Online);
    assert!(
        r.bots[1].calls_of("ping").is_empty(),
        "auth failures are not probed with ping"
    );
}

#[tokio::test(start_paused = true)]
async fn a_closed_websocket_with_a_failing_ping_means_offline_at_once() {
    let r = rig(&[spec(9001, "a", true)]).await;
    settle(130).await;
    assert_eq!(r.status_of(9001).await, BotStatus::Online);
    r.bots[0].state.lock().unwrap().ping_ok = false;
    r.net
        .push(
            9001,
            WsEvent::Disconnected(fg_sources::botws::WsCloseKind::ClosedByPeer),
        )
        .await;
    settle(2).await;
    assert_eq!(r.status_of(9001).await, BotStatus::Offline);
}

// ====================================================================== the request budget

/// Requests towards the bots, all kinds but `ping`.
fn reads(bots: &[Arc<FakeBot>]) -> usize {
    bots.iter()
        .map(|b| b.call_count() - b.calls_of("ping").len())
        .sum()
}

#[tokio::test(start_paused = true)]
async fn forty_bots_stay_under_three_requests_per_second_and_one_tenth_per_bot() {
    let names: Vec<String> = (0..40).map(|i| format!("bot{i}")).collect();
    let specs: Vec<Spec> = names
        .iter()
        .enumerate()
        .map(|(i, n)| Spec {
            port: 9100 + u16::try_from(i).unwrap(),
            name: Box::leak(n.clone().into_boxed_str()),
            live: i % 2 == 0,
            wallet: (i % 2 == 0).then_some(FAKE_WALLET),
            capital: Some(100.0),
        })
        .collect();
    let r = rig(&specs).await;
    // Warm-up: the first resynchronisation of the whole fleet spends the burst.
    settle(300).await;
    let g0 = r.h.budget_stats().granted;
    let c0 = reads(&r.bots);
    let per_bot0: Vec<usize> = r.bots.iter().map(|b| b.call_count()).collect();
    let t0 = tokio::time::Instant::now();
    settle(900).await;
    let secs = t0.elapsed().as_secs_f64();
    let granted = (r.h.budget_stats().granted - g0) as f64 / secs;
    let calls = (reads(&r.bots) - c0) as f64 / secs;
    assert!(granted <= 2.8 * 1.02, "tokens per second {granted}");
    assert!(calls < 3.0, "requests per second {calls}");
    assert!(calls > 1.5, "the fleet is actually polled: {calls}");
    for (i, b) in r.bots.iter().enumerate() {
        let rate = (b.call_count() - per_bot0[i]) as f64 / secs;
        assert!(rate < 0.1, "bot {i}: {rate} req/s");
    }
    // The bucket was the limit, not a lack of demand (no trade_snapshot here, so /status runs).
    assert!(r.h.budget_stats().waited_ms > 0);
    // Everything was polled: each kind of read happened on every bot.
    for b in &r.bots {
        for k in [
            "status",
            "logs",
            "balance",
            "whitelist",
            "blacklist",
            "locks",
            "features",
        ] {
            assert!(!b.calls_of(k).is_empty(), "bot {} never got {k}", b.port);
        }
    }
    // ftcache: well under 0.6 request per second.
    let d = r.daemon.calls.lock().unwrap().len() as f64 / (300.0 + secs);
    assert!(d < 0.6, "daemon {d} req/s");
}

#[tokio::test(start_paused = true)]
async fn clients_looking_at_bots_cannot_push_the_rate_past_the_bucket() {
    let specs: Vec<Spec> = (0..12)
        .map(|i| Spec {
            port: 9200 + i,
            name: Box::leak(format!("v{i}").into_boxed_str()),
            live: false,
            wallet: None,
            capital: Some(100.0),
        })
        .collect();
    let r = rig(&specs).await;
    settle(200).await;
    // Fifty tabs on twelve bots: raised cadences would ask for far more than 3 req/s.
    let mut subs = Vec::new();
    for _ in 0..50 {
        for s in &specs {
            subs.push(r.h.subscribe(&[(Channel::Bot(key(s.port)), None)]).unwrap());
        }
    }
    settle(30).await;
    let g0 = r.h.budget_stats().granted;
    let t0 = tokio::time::Instant::now();
    settle(300).await;
    let rate = (r.h.budget_stats().granted - g0) as f64 / t0.elapsed().as_secs_f64();
    assert!(rate <= 2.8 * 1.02, "{rate}");
    assert!(rate > 2.0, "the raised cadences do use the budget: {rate}");
    // Everyone leaves: back to the normal cadences after the hold-over.
    drop(subs);
    settle(60).await;
    let g1 = r.h.budget_stats().granted;
    let t1 = tokio::time::Instant::now();
    settle(600).await;
    let calm = (r.h.budget_stats().granted - g1) as f64 / t1.elapsed().as_secs_f64();
    assert!(calm < 1.2, "12 bots at normal cadences: {calm}");
}

#[tokio::test(start_paused = true)]
async fn status_polling_stops_while_the_bot_pushes_trade_snapshots() {
    let r = rig(&[spec(9001, "a", true)]).await;
    settle(130).await;
    let before = r.bots[0].calls_of("status").len();
    assert!(before >= 1);
    // A snapshot every 10 s for ten minutes: /status is redundant.
    for _ in 0..60 {
        r.net.push(9001, snapshot(json!([]))).await;
        settle(10).await;
    }
    let after = r.bots[0].calls_of("status").len();
    assert_eq!(before, after, "no /status while snapshots arrive");
}

#[tokio::test(start_paused = true)]
async fn the_daemon_is_only_asked_the_five_read_operations_at_their_cadences() {
    let r = rig(&[spec(9001, "a", true)]).await;
    settle(605).await;
    let d = &r.daemon;
    assert!(d.count("summary_get") >= 100, "{}", d.count("summary_get"));
    assert!(d.count("fleet_status") >= 35);
    assert!(d.count("fleet_events") >= 100);
    assert!(d.count("stats") >= 8);
    assert_eq!(d.count("ping"), 0);
    let total = d.calls.lock().unwrap().len() as f64 / 605.0;
    assert!(total < 0.6, "{total}");
}

// ====================================================================== assembled figures

fn seed_positions(r: &Rig, name: &str) {
    r.ledger.with(&db_path(name), |db| {
        db.trades = vec![
            open_trade(1, "BTC/USDC:USDC", false, T0 - 5 * HOUR),
            open_trade(2, "ETH/USDC:USDC", true, T0 - 2 * HOUR),
            closed_trade(3, "SOL/USDC:USDC", T0 - 30 * HOUR, T0 - 20 * HOUR, 12.0),
            closed_trade(4, "SOL/USDC:USDC", T0 - 10 * HOUR, T0 - 9 * HOUR, -4.0),
            closed_trade(5, "BTC/USDC:USDC", T0 - 3 * HOUR, T0 - HOUR, 7.5),
        ];
        db.profit = (0..48)
            .map(|i| ProfitSample {
                rowid: i + 1,
                ts_ms: T0 - (48 - i) * HOUR / 2,
                closed_abs: 10.0,
                open_abs: (i % 5) as f64,
                open_trades: 2,
            })
            .collect();
    });
}

#[tokio::test(start_paused = true)]
async fn wallet_level_capital_is_counted_once_and_modes_are_never_mixed() {
    let r = rig(&[
        spec(9001, "a", true),
        spec(9002, "b", true),
        spec(9003, "c", true),
        spec(9004, "d", false),
    ])
    .await;
    // Three live bots on one wallet: each reports the whole wallet as its balance.
    for b in &r.bots[..3] {
        b.state.lock().unwrap().balance =
            json!({"total": 1500.0, "total_bot": 500.0, "starting_capital": 500.0});
    }
    r.bots[3].state.lock().unwrap().balance = json!({"total": 100.0, "total_bot": 100.0});
    seed_positions(&r, "a");
    settle(200).await;
    r.h.publish_now().await.unwrap();
    let p = r.h.published();
    for port in [9001, 9002, 9003] {
        // The starting capital is the bot's own config, never the wallet total.
        assert_eq!(p.bots[&key(port)].metrics.starting_capital, Some(500.0));
    }
    let live = &p.scopes["live"];
    assert_eq!(live.starting_capital, Some(1500.0));
    assert_eq!(live.wallet_equity, Some(1500.0), "one wallet, counted once");
    assert_eq!(live.wallets, 1);
    assert_eq!(live.bots, 3);
    let dry = &p.scopes["dry"];
    assert_eq!(dry.bots, 1);
    assert_eq!(dry.wallet_equity, Some(100.0));
    assert_eq!(dry.starting_capital, Some(500.0));
    let w = p.wallets.values().next().unwrap();
    assert_eq!(w.bots.len(), 3);
    assert_eq!(w.address_short, "0xAB12...9876");
    assert!(
        !format!("{p:?}").contains(FAKE_WALLET),
        "the full address never leaves the process"
    );
    // Dry bots have no wallet.
    assert!(p.bots[&key(9004)].state.wallet_id.is_none());
}

#[tokio::test(start_paused = true)]
async fn positions_come_from_the_ledger_and_prices_from_the_websocket() {
    let r = rig(&[spec(9001, "a", true)]).await;
    seed_positions(&r, "a");
    settle(60).await;
    r.net
        .push(
            9001,
            snapshot(json!([
                {"trade_id": 1, "pair": "BTC/USDC:USDC", "current_rate": 110.0,
                 "profit_abs": 20.0, "profit_ratio": 0.1},
                {"trade_id": 2, "pair": "ETH/USDC:USDC", "current_rate": 95.0,
                 "profit_abs": 10.0, "profit_ratio": 0.05},
            ])),
        )
        .await;
    settle(5).await;
    r.h.publish_now().await.unwrap();
    let p = r.h.published();
    assert_eq!(p.positions.len(), 2);
    let btc = &p.positions["local:9001/1"];
    assert_eq!(btc.current_rate, Some(110.0));
    assert_eq!(btc.profit_abs, Some(20.0));
    assert!(!btc.freshness.stale);
    assert_eq!(btc.side, fg_core::model::Side::Long);
    assert_eq!(
        p.positions["local:9001/2"].side,
        fg_core::model::Side::Short
    );
    // 60 USDC liquidation under a 110 mark: 45.45 % away.
    assert!((btc.liq_distance_pct.unwrap() - 45.4545).abs() < 0.01);
    assert_eq!(
        btc.duration_ms % 60_000,
        0,
        "duration is quantised to the minute"
    );
    let row = &p.bots[&key(9001)];
    assert_eq!(row.state.open_trades, 2);
    assert_eq!(row.metrics.open_profit_abs, Some(30.0));
    assert_eq!(row.metrics.realized_total, Some(15.5));
    assert_eq!(row.metrics.trades_closed, Some(3));
    // T0 is 10:53 in Paris: trade 3 (closed 20 h ago) is yesterday, trades 4 and 5 are today. The
    // day is cut at the Paris midnight, not 24 hours back; 7 d and 30 d are rolling windows.
    assert_eq!(row.metrics.realized_1d, Some(3.5));
    assert_eq!(row.metrics.realized_7d, Some(15.5));
    assert_eq!(row.metrics.realized_30d, Some(15.5));
    assert!(row.metrics.drawdown_realized.is_some());
    assert!(!row.metrics.spark24h.is_empty());
    let longs = row.metrics.exposure_long.unwrap();
    let shorts = row.metrics.exposure_short.unwrap();
    assert!((longs - 2.0 * 110.0).abs() < 1e-9 && (shorts - 2.0 * 95.0).abs() < 1e-9);
}

fn filled_order(id: i64, trade_id: i64, side: &str) -> fg_sources::sqlite::LedgerOrder {
    fg_sources::sqlite::LedgerOrder {
        id,
        trade_id,
        side: side.into(),
        status: Some("closed".into()),
        is_open: false,
        filled: Some(1.0),
        amount: Some(1.0),
        average: Some(100.0),
        cost: Some(100.0),
        filled_ms: Some(T0 - HOUR),
        tag: None,
    }
}

#[tokio::test(start_paused = true)]
async fn a_position_reports_every_filled_entry_order_the_first_one_included() {
    let r = rig(&[spec(9001, "a", true)]).await;
    seed_positions(&r, "a");
    r.ledger.with(&db_path("a"), |db| {
        // Trade 1 (long): the entry plus two safety orders, then a partial exit and a cancelled
        // safety order that never filled. Trade 2 (short): the entry alone.
        let mut cancelled = filled_order(14, 1, "buy");
        cancelled.status = Some("canceled".into());
        cancelled.filled = Some(0.0);
        db.orders = vec![
            filled_order(10, 1, "buy"),
            filled_order(11, 1, "buy"),
            filled_order(12, 1, "buy"),
            filled_order(13, 1, "sell"),
            cancelled,
            filled_order(20, 2, "sell"),
        ];
    });
    settle(60).await;
    r.h.publish_now().await.unwrap();
    let p = r.h.published();
    assert_eq!(p.positions["local:9001/1"].dca_entries, 3);
    assert_eq!(p.positions["local:9001/2"].dca_entries, 1);
}

#[tokio::test(start_paused = true)]
async fn the_day_figure_restarts_at_the_paris_midnight() {
    let r = rig(&[spec(9001, "a", true)]).await;
    seed_positions(&r, "a");
    settle(60).await;
    r.h.publish_now().await.unwrap();
    let before = r.h.published();
    let live = &before.scopes["live"];
    assert_eq!(before.bots[&key(9001)].metrics.realized_1d, Some(3.5));
    assert_eq!(live.realized_1d, Some(3.5));
    assert_eq!(live.realized_today, Some(3.5), "both day figures agree");
    // T0 is 10:53:20 in Paris (CEST): the next midnight is 13 h 6 min 40 s later. Trades 4 and 5
    // closed at 01:53 and 09:53 become yesterday's, while the last 24 hours would still hold them.
    settle(13 * 3600 + 6 * 60 + 40 + 60).await;
    r.h.publish_now().await.unwrap();
    let after = r.h.published();
    assert_eq!(after.bots[&key(9001)].metrics.realized_1d, Some(0.0));
    assert_eq!(after.scopes["live"].realized_1d, Some(0.0));
    assert_eq!(after.scopes["live"].realized_today, Some(0.0));
}

#[tokio::test(start_paused = true)]
async fn the_health_reasons_are_stable_codes_and_the_budget_figure_is_the_share_used() {
    let r = rig(&[spec(9001, "a", true)]).await;
    {
        let mut st = r.daemon.status.lock().unwrap();
        st.rate_limiters.insert(
            "hyperliquid".to_owned(),
            fg_sources::ftcache::RateBudget {
                tokens_available: Some(15.0),
                tokens_max: Some(100.0),
                backoff_active: Some(true),
                ..Default::default()
            },
        );
    }
    settle(120).await;
    r.h.publish_now().await.unwrap();
    let h = &r.h.published().health;
    // 15 % left is 85 % used: a high figure is the bad one, like the direct mode and the gauge.
    assert!((h.rate_budget_pct.unwrap() - 85.0).abs() < 1e-9, "{h:?}");
    assert!(h.backoff_active);
    let low = h
        .reasons
        .iter()
        .find(|x| x.code == "rate_budget_low")
        .expect("under 20 % left is a reason");
    assert_eq!(
        low.detail.as_deref(),
        Some("15"),
        "the detail is the percentage left, without a unit or a sentence"
    );
    assert!(h.reasons.iter().any(|x| x.code == "rate_backoff"));
    // Every code the engine emits is in the catalogue the clients translate.
    let known: Vec<&str> = fg_core::model::HealthReasonCode::ALL
        .iter()
        .map(|c| c.as_str())
        .collect();
    for reason in &h.reasons {
        assert!(known.contains(&reason.code.as_str()), "{}", reason.code);
    }
}

fn status_body(trade: i64, pair: &str, rate: f64) -> serde_json::Value {
    json!([{"trade_id": trade, "pair": pair, "is_short": false, "amount": 2.0,
            "stake_amount": 100.0, "open_rate": 100.0, "current_rate": rate,
            "profit_abs": rate - 100.0, "profit_ratio": (rate - 100.0) / 100.0}])
}

#[tokio::test(start_paused = true)]
async fn a_status_body_that_is_not_a_list_of_trades_blocks_nobody_and_wipes_nothing() {
    let r = rig(&[spec(9001, "a", true), spec(9002, "b", true)]).await;
    for (name, pair) in [("a", "BTC/USDC:USDC"), ("b", "ETH/USDC:USDC")] {
        r.ledger.with(&db_path(name), |db| {
            db.trades = vec![open_trade(1, pair, false, T0 - HOUR)];
        });
    }
    r.bots[0].state.lock().unwrap().status = status_body(1, "BTC/USDC:USDC", 101.0);
    r.bots[1].state.lock().unwrap().status = status_body(1, "ETH/USDC:USDC", 101.0);
    settle(100).await;
    r.h.publish_now().await.unwrap();
    let p = r.h.published();
    assert_eq!(p.positions["local:9001/1"].current_rate, Some(101.0));
    assert_eq!(p.positions["local:9002/1"].current_rate, Some(101.0));

    for odd in [
        json!({"detail": "Not Found"}),
        json!(null),
        json!("<html>sign in</html>"),
        json!(["a", "b"]),
    ] {
        r.bots[0].state.lock().unwrap().status = odd;
        r.bots[1].state.lock().unwrap().status = status_body(1, "ETH/USDC:USDC", 120.0);
        settle(75).await;
        r.h.publish_now().await.unwrap();
        let p = r.h.published();
        // The other bot's positions keep being published with their new prices.
        assert_eq!(p.positions["local:9002/1"].current_rate, Some(120.0));
        assert!(!p.positions["local:9002/1"].freshness.stale);
        // The odd bot is still alive, and its last known price was not replaced by "no price":
        // it ages instead.
        assert_eq!(p.bots[&key(9001)].state.status, BotStatus::Online);
        assert_eq!(p.positions["local:9001/1"].current_rate, Some(101.0));
        r.bots[1].state.lock().unwrap().status = status_body(1, "ETH/USDC:USDC", 101.0);
        r.bots[0].state.lock().unwrap().status = status_body(1, "BTC/USDC:USDC", 101.0);
        settle(75).await;
    }
    // Once it answers properly again, its prices are fresh.
    r.bots[0].state.lock().unwrap().status = status_body(1, "BTC/USDC:USDC", 103.0);
    settle(75).await;
    r.h.publish_now().await.unwrap();
    let p = r.h.published();
    assert_eq!(p.positions["local:9001/1"].current_rate, Some(103.0));
    assert!(!p.positions["local:9001/1"].freshness.stale);
}

#[tokio::test(start_paused = true)]
async fn a_forced_exit_is_not_judged_on_a_status_body_that_is_not_a_list_of_trades() {
    let r = trading_rig().await;
    // The model is old (no fresh price) and the bot answers 200 with an error envelope.
    settle(30).await;
    r.bots[0].state.lock().unwrap().status = json!({"detail": "boom"});
    let err =
        r.h.act(exit_req(9001, "k-odd", "BTC/USDC:USDC", false))
            .await
            .unwrap_err();
    assert_eq!(err.code, fg_core::protocol::ErrorCode::BotUnreachable);
    assert!(writes(&r, 9001).is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_silent_websocket_makes_prices_stale_and_excludes_them_from_sums() {
    let r = rig(&[spec(9001, "a", true), spec(9002, "b", true)]).await;
    seed_positions(&r, "a");
    r.ledger.with(&db_path("b"), |db| {
        db.trades = vec![open_trade(9, "BTC/USDC:USDC", false, T0 - HOUR)];
    });
    settle(60).await;
    r.net
        .push(
            9001,
            snapshot(json!([
                {"trade_id": 1, "pair": "BTC/USDC:USDC", "current_rate": 105.0,
                 "profit_abs": 2.0, "profit_ratio": 0.02},
                {"trade_id": 2, "pair": "ETH/USDC:USDC", "current_rate": 99.0,
                 "profit_abs": 3.0, "profit_ratio": 0.03}
            ])),
        )
        .await;
    r.net
        .push(
            9002,
            snapshot(
                json!([{"trade_id": 9, "pair": "BTC/USDC:USDC", "current_rate": 105.0,
                             "profit_abs": 5.0, "profit_ratio": 0.05}]),
            ),
        )
        .await;
    settle(5).await;
    r.h.publish_now().await.unwrap();
    assert_eq!(
        r.h.published().bots[&key(9001)].metrics.open_profit_abs,
        Some(5.0)
    );
    // Only bot b keeps talking.
    for _ in 0..16 {
        settle(10).await;
        r.net
            .push(
                9002,
                snapshot(
                    json!([{"trade_id": 9, "pair": "BTC/USDC:USDC", "current_rate": 106.0,
                                 "profit_abs": 6.0, "profit_ratio": 0.06}]),
                ),
            )
            .await;
    }
    r.h.publish_now().await.unwrap();
    let p = r.h.published();
    let a = &p.bots[&key(9001)];
    assert!(a.freshness[&FreshnessGroup::Positions].stale);
    assert_eq!(a.metrics.open_profit_abs, None, "unknown, not zero");
    assert_eq!(p.positions["local:9001/1"].profit_abs, None);
    assert!(p.positions["local:9001/1"].freshness.stale);
    let live = &p.scopes["live"];
    assert_eq!(
        live.open_profit_abs,
        Some(6.0),
        "the stale bot is left out of the sum"
    );
    assert!(live.excluded_bots.contains(&"local:9001".to_owned()));
    assert!(!live.excluded_bots.contains(&"local:9002".to_owned()));
}

#[tokio::test(start_paused = true)]
async fn a_ledger_that_cannot_be_read_makes_the_metrics_stale() {
    let r = rig(&[spec(9001, "a", true)]).await;
    seed_positions(&r, "a");
    settle(60).await;
    r.h.publish_now().await.unwrap();
    assert_eq!(
        r.h.published().bots[&key(9001)].metrics.realized_total,
        Some(15.5)
    );
    r.ledger.with(&db_path("a"), |db| {
        db.fail = Some(fg_sources::sqlite::LedgerErrorCode::DbLocked)
    });
    settle(30).await;
    r.h.publish_now().await.unwrap();
    let p = r.h.published();
    let row = &p.bots[&key(9001)];
    assert!(row.freshness[&FreshnessGroup::Metrics].stale);
    assert_eq!(row.metrics.realized_1d, None);
    let reason = p
        .health
        .reasons
        .iter()
        .find(|x| x.code == "ledger_unreadable")
        .expect("the unreadable ledger is a health reason");
    assert_eq!(
        reason.detail.as_deref(),
        Some("1 (db_locked 1)"),
        "the reason says how many ledgers and why"
    );
    assert_eq!(p.health.level, fg_core::model::HealthLevel::Degraded);
    // Recovery.
    r.ledger.with(&db_path("a"), |db| db.fail = None);
    settle(10).await;
    r.h.publish_now().await.unwrap();
    assert_eq!(
        r.h.published().bots[&key(9001)].metrics.realized_total,
        Some(15.5)
    );
}

#[tokio::test(start_paused = true)]
async fn the_ledger_is_read_again_only_when_it_changed() {
    let r = rig(&[spec(9001, "a", true)]).await;
    seed_positions(&r, "a");
    settle(60).await;
    let reads = |r: &Rig| r.ledger.dbs.lock().unwrap()[&db_path("a")].stats;
    let stats_before = reads(&r);
    assert!(
        stats_before >= 20,
        "the ledger is stat'ed every ~2 s: {stats_before}"
    );
    // A new closed trade appears.
    r.ledger.with(&db_path("a"), |db| {
        db.trades
            .push(closed_trade(6, "ETH/USDC:USDC", T0 - HOUR, T0 - 1_000, 3.0));
    });
    settle(10).await;
    r.h.publish_now().await.unwrap();
    assert_eq!(
        r.h.published().bots[&key(9001)].metrics.trades_closed,
        Some(4)
    );
}

#[tokio::test(start_paused = true)]
async fn a_ledger_that_only_moves_its_open_trades_is_not_rescanned_every_time() {
    let r = rig(&[spec(9001, "a", true)]).await;
    seed_positions(&r, "a");
    settle(70).await;
    let scans = |r: &Rig| r.ledger.dbs.lock().unwrap()[&db_path("a")].summaries;
    // A first change after the refresh period: the summary is redone, then the clock restarts.
    let first = scans(&r);
    r.ledger
        .with(&db_path("a"), |db| db.trades[0].stop_loss = Some(89.0));
    settle(5).await;
    let s0 = scans(&r);
    assert_eq!(s0, first + 1);
    // The bot rewrites its open trades (stop, min and max rate) every few seconds.
    for i in 0..8 {
        r.ledger.with(&db_path("a"), |db| {
            for t in db.trades.iter_mut().filter(|t| t.is_open) {
                t.stop_loss = Some(90.0 + f64::from(i));
            }
        });
        settle(5).await;
    }
    assert_eq!(
        scans(&r),
        s0,
        "no full scan for changes of open trades only"
    );
    // A trade closing is noticed by the counts, at the next pass.
    r.ledger.with(&db_path("a"), |db| {
        db.trades
            .push(closed_trade(9, "ETH/USDC:USDC", T0 - HOUR, T0 - 500, 2.0));
    });
    settle(10).await;
    assert_eq!(scans(&r), s0 + 1);
    r.h.publish_now().await.unwrap();
    assert_eq!(
        r.h.published().bots[&key(9001)].metrics.trades_closed,
        Some(4)
    );
    // And whatever the counts say, the summary is redone once a minute (an edited old trade).
    settle(70).await;
    r.ledger.with(&db_path("a"), |db| {
        db.trades[0].stop_loss = Some(1.0);
    });
    settle(10).await;
    assert_eq!(scans(&r), s0 + 2);
}

#[tokio::test(start_paused = true)]
async fn a_ledger_that_keeps_changing_is_read_every_few_seconds_but_a_fill_reads_it_at_once() {
    let r = rig(&[spec(9001, "a", true)]).await;
    seed_positions(&r, "a");
    settle(30).await;
    let passes = |r: &Rig| r.ledger.dbs.lock().unwrap()[&db_path("a")].probes;
    let p0 = passes(&r);
    // The bot rewrites its open trades every 2 s for a minute.
    for i in 0..30 {
        r.ledger.with(&db_path("a"), |db| {
            for t in db.trades.iter_mut().filter(|t| t.is_open) {
                t.stop_loss = Some(80.0 + f64::from(i));
            }
        });
        settle(2).await;
    }
    let n = passes(&r) - p0;
    assert!(
        (5..=9).contains(&n),
        "one pass every ~8 s, not every 2 s: {n}"
    );
    // Whatever was written last is picked up within a pass or two, never lost.
    settle(10).await;
    r.h.publish_now().await.unwrap();
    let stop =
        r.h.published()
            .positions
            .values()
            .next()
            .and_then(|p| p.stoploss_abs);
    assert_eq!(stop, Some(80.0 + 29.0));
    // A fill nudges the poller: the new trade shows up well inside the gap.
    r.ledger.with(&db_path("a"), |db| {
        db.trades
            .push(open_trade(77, "ETH/USDC:USDC", false, T0 - 10));
    });
    r.net
        .push(
            9001,
            ws_msg(
                "entry_fill",
                json!({"trade_id": 77, "pair": "ETH/USDC:USDC"}),
            ),
        )
        .await;
    settle(3).await;
    r.h.publish_now().await.unwrap();
    assert!(
        r.h.published().positions.values().any(|p| p.trade_id == 77),
        "a fill is not delayed by the minimum gap between passes"
    );
}

// ====================================================================== alerts

fn losing_position(r: &Rig) {
    r.ledger.with(&db_path("a"), |db| {
        db.trades = vec![open_trade(1, "BTC/USDC:USDC", false, T0 - HOUR)];
    });
}

#[tokio::test(start_paused = true)]
async fn a_losing_position_raises_an_alert_after_its_delay_and_it_survives_a_restart() {
    let r = rig(&[spec(9001, "a", true)]).await;
    losing_position(&r);
    settle(60).await;
    let push = |ratio: f64| {
        snapshot(
            json!([{"trade_id": 1, "pair": "BTC/USDC:USDC", "current_rate": 85.0,
                         "profit_abs": -15.0, "profit_ratio": ratio}]),
        )
    };
    // -15 % is below the -10 % threshold but not below twice of it: a warning, which waits for
    // its 30 s delay (a critical alert would fire at once).
    r.net.push(9001, push(-0.15)).await;
    settle(1).await;
    r.h.evaluate_alerts_now().await.unwrap();
    let early = r.h.alerts(AlertFilter::All);
    assert!(
        early.iter().all(|a| a.type_id != AlertTypeId::PositionLoss),
        "pending until its delay elapsed: {early:?}"
    );
    // The condition holds: 10 s evaluations, the delay is 30 s.
    for _ in 0..5 {
        r.net.push(9001, push(-0.15)).await;
        settle(10).await;
    }
    let alerts = r.h.alerts(AlertFilter::Active);
    let loss: Vec<_> = alerts
        .iter()
        .filter(|a| a.type_id == AlertTypeId::PositionLoss)
        .collect();
    assert_eq!(loss.len(), 1, "{alerts:?}");
    assert_eq!(loss[0].bot_key.as_deref(), Some("local:9001"));
    assert_eq!(
        r.h.published().bots[&key(9001)].alerts.count as usize,
        alerts.len()
    );
    let raised =
        r.h.events(Default::default())
            .await
            .into_iter()
            .filter(|e| e.kind == EventKind::AlertRaised)
            .count();
    assert!(raised >= 1);
    r.h.flush().await;

    // The gateway restarts on the same data directory: the alert is still there, and a bot that
    // has not been read yet does not resolve it (data unknown is not data healthy).
    let dir = r.dir;
    r.engine.shutdown().await;
    let r2 = rig_in(dir, &[spec(9001, "a", true)], |_| {}).await;
    settle(12).await;
    let again = r2.h.alerts(AlertFilter::All);
    assert!(
        again.iter().any(|a| a.type_id == AlertTypeId::PositionLoss),
        "{again:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn acknowledging_and_silencing_are_persisted_and_visible_in_the_views() {
    let r = rig(&[spec(9001, "a", true)]).await;
    r.bots[0].state.lock().unwrap().logs = json!({"log_count": 1, "logs": [
        ["2026-10-15 12:00:00", T0 as f64 + 5_000.0, "freqtrade.exchange", "ERROR", "boom"]
    ]});
    settle(120).await;
    r.h.evaluate_alerts_now().await.unwrap();
    for _ in 0..5 {
        settle(10).await;
    }
    let active = r.h.alerts(AlertFilter::Active);
    let id = active
        .iter()
        .find(|a| a.type_id == AlertTypeId::LogErrors)
        .map(|a| a.id.clone())
        .unwrap_or_else(|| panic!("no logErrors alert in {active:?}"));
    r.h.ack(&id, Some("sess".into())).await.unwrap();
    assert!(r.h.alerts(AlertFilter::Acked).iter().any(|a| a.id == id));
    assert!(r.h.alerts(AlertFilter::Active).iter().all(|a| a.id != id));
    let until = r.h.now_ms() + 3_600_000;
    let sid =
        r.h.silence(
            Some(AlertTypeId::LogErrors),
            Some("local:9001".into()),
            None,
            until,
        )
        .await
        .unwrap();
    assert!(
        r.h.alerts(AlertFilter::All)
            .iter()
            .any(|a| a.id == id && a.view(r.h.now_ms()) == Some(AlertView::Silenced))
    );
    assert!(
        r.h.silence(None, None, None, r.h.now_ms() - 1)
            .await
            .is_err()
    );
    r.h.unsilence(&sid).await.unwrap();
    assert!(r.h.unsilence(&sid).await.is_err());
    assert!(r.h.ack("nope", None).await.is_err());
}

// ====================================================================== protocol

#[tokio::test(start_paused = true)]
async fn applying_the_frames_to_a_snapshot_reproduces_the_channel_state() {
    let r = rig(&[spec(9001, "a", true), spec(9002, "b", false)]).await;
    seed_positions(&r, "a");
    settle(30).await;
    let chans = [
        Channel::Fleet,
        Channel::Positions,
        Channel::Alerts,
        Channel::Health,
    ];
    // The client takes the HTTP snapshot of each channel, then subscribes with its sequence.
    let mut state: BTreeMap<String, ChannelState> = BTreeMap::new();
    let mut resume = Vec::new();
    for ch in &chans {
        let s = r.h.snapshot(ch).unwrap();
        state.insert(
            ch.to_string(),
            ChannelState {
                collections: s.collections,
            },
        );
        resume.push((ch.clone(), Some(s.seq)));
    }
    let mut sub = r.h.subscribe(&resume).unwrap();
    // The fleet moves.
    for i in 0..30 {
        r.net
            .push(
                9001,
                snapshot(json!([{"trade_id": 1, "pair": "BTC/USDC:USDC",
                                 "current_rate": 100.0 + f64::from(i), "profit_abs": f64::from(i),
                                 "profit_ratio": 0.001 * f64::from(i)}])),
            )
            .await;
        settle(2).await;
    }
    r.ledger.with(&db_path("b"), |db| {
        db.trades.push(closed_trade(
            1,
            "ETH/USDC:USDC",
            T0 - HOUR,
            T0 - 10_000,
            2.0,
        ));
    });
    settle(20).await;
    // Drain what was published and apply it, checking continuity.
    let mut last: BTreeMap<String, u64> = BTreeMap::new();
    while let Ok(Some(frame)) = tokio::time::timeout(Duration::from_millis(1), sub.next()).await {
        match frame {
            ServerFrame::Up {
                ch,
                seq,
                upsert,
                remove,
                ..
            } => {
                if let Some(prev) = last.insert(ch.clone(), seq) {
                    assert_eq!(seq, prev + 1, "no gap on {ch}");
                }
                state.get_mut(&ch).unwrap().apply(&upsert, &remove);
            }
            ServerFrame::Resync { ch, reason } => panic!("unexpected resync {ch} {reason:?}"),
            _ => {}
        }
    }
    assert!(!last.is_empty(), "frames were published");
    // The channel states equal a fresh snapshot (ignoring clock-driven fields that moved after
    // the last drained frame: compare with a new publication first).
    r.h.publish_now().await.unwrap();
    let mut sub2 = r.h.subscribe(&resume).unwrap();
    drop(sub2.next());
    while let Ok(Some(frame)) = tokio::time::timeout(Duration::from_millis(1), sub.next()).await {
        if let ServerFrame::Up {
            ch, upsert, remove, ..
        } = frame
        {
            state.get_mut(&ch).unwrap().apply(&upsert, &remove);
        }
    }
    for ch in &chans {
        let fresh = r.h.snapshot(ch).unwrap();
        let mine = &state[&ch.to_string()].collections;
        for (coll, entities) in &fresh.collections {
            let have = mine.get(coll).cloned().unwrap_or_default();
            assert_eq!(
                have.keys().collect::<Vec<_>>(),
                entities.keys().collect::<Vec<_>>(),
                "{ch} {coll}: same entities"
            );
        }
    }
    // The fleet snapshot has the bots and the totals.
    let fleet = r.h.snapshot(&Channel::Fleet).unwrap();
    assert_eq!(fleet.collections["bots"].len(), 2);
    assert!(fleet.collections["scopes"].contains_key("live"));
    assert!(fleet.seq > 0);
}

#[tokio::test(start_paused = true)]
async fn a_resume_after_a_gateway_restart_is_a_resync_not_a_replay() {
    let r = rig(&[spec(9001, "a", true)]).await;
    settle(60).await;
    let snap = r.h.snapshot(&Channel::Fleet).unwrap();
    let old_seq = snap.seq;
    assert!(old_seq > 0);
    let dir = r.dir;
    r.engine.shutdown().await;
    // A real restart takes far longer than one millisecond; the sequence base is wall-clock ms.
    std::thread::sleep(Duration::from_millis(15));
    let r2 = rig_in(dir, &[spec(9001, "a", true)], |_| {}).await;
    settle(30).await;
    let mut sub = r2.h.subscribe(&[(Channel::Fleet, Some(old_seq))]).unwrap();
    match sub.next().await.unwrap() {
        ServerFrame::Resync { ch, reason } => {
            assert_eq!(ch, "fleet");
            assert_eq!(reason, ResyncReason::StaleResume);
        }
        other => panic!("expected a resync, got {other:?}"),
    }
    assert!(r2.h.snapshot(&Channel::Fleet).unwrap().seq > old_seq);
}

#[tokio::test(start_paused = true)]
async fn the_event_feed_carries_fills_from_the_websocket_immediately() {
    let r = rig(&[spec(9001, "a", true)]).await;
    settle(60).await;
    let mut sub = r.h.subscribe(&[(Channel::Events, None)]).unwrap();
    r.net
        .push(
            9001,
            ws_msg(
                "exit_fill",
                json!({"trade_id": 7, "pair": "ETH/USDC:USDC", "profit_amount": 4.1, "exit_reason": "roi"}),
            ),
        )
        .await;
    let frame = tokio::time::timeout(Duration::from_secs(2), sub.next())
        .await
        .expect("an event within 2 s")
        .unwrap();
    let ServerFrame::Ev { data, .. } = frame else {
        panic!("not an event")
    };
    assert_eq!(data.kind, EventKind::ExitFill);
    assert_eq!(data.profit_abs, Some(4.1));
    assert_eq!(data.bot_key, Some(key(9001)));
    // The fill also wakes the ledger task.
    let snap = r.h.snapshot(&Channel::Events).unwrap();
    assert!(snap.events.iter().any(|e| e.kind == EventKind::ExitFill));
}

#[tokio::test(start_paused = true)]
async fn the_bot_channel_carries_pairs_locks_and_logs_while_watched() {
    let r = rig(&[spec(9001, "a", true)]).await;
    r.bots[0].state.lock().unwrap().logs = json!({"log_count": 2, "logs": [
        ["t", T0 as f64 + 1_000.0, "freqtrade.x", "INFO", "hello"],
        ["t", T0 as f64 + 2_000.0, "freqtrade.x", "ERROR", "bad"]
    ]});
    let mut sub =
        r.h.subscribe(&[
            (Channel::Bot(key(9001)), None),
            (Channel::Logs(fg_core::protocol::LogScope::Errors), None),
            (
                Channel::Logs(fg_core::protocol::LogScope::Bot(key(9001))),
                None,
            ),
        ])
        .unwrap();
    settle(150).await;
    r.h.publish_now().await.unwrap();
    let snap = r.h.snapshot(&Channel::Bot(key(9001))).unwrap();
    let detail = &snap.collections["details"]["local:9001"];
    assert_eq!(detail["whitelist"], json!(["BTC/USDC:USDC"]));
    assert_eq!(detail["logs"].as_array().unwrap().len(), 2);
    // The error line (and only it) is on the errors channel, each line once.
    let mut seen = Vec::new();
    while let Ok(Some(f)) = tokio::time::timeout(Duration::from_millis(1), sub.next()).await {
        if let ServerFrame::Ev { ch, data, .. } = f {
            seen.push((ch, data.detail.unwrap_or_default()));
        }
    }
    assert_eq!(
        seen.iter().filter(|(c, _)| c == "logs:errors").count(),
        1,
        "{seen:?}"
    );
    assert_eq!(
        seen.iter()
            .filter(|(c, d)| c == "logs:local:9001" && d == "hello")
            .count(),
        1
    );
}

// ====================================================================== actions

fn exit_req(port: u16, key_: &str, pair: &str, short: bool) -> ActionRequest {
    ActionRequest {
        bot_key: key(port),
        action: WriteAction::ForceExit {
            trade_id: 1,
            ordertype: None,
            amount: None,
        },
        idempotency_key: key_.into(),
        expected: Some(ExpectedTrade {
            pair: pair.into(),
            is_short: short,
        }),
        confirm: None,
        origin: ActionOrigin {
            session_hash: "sess".into(),
            ip: Some("203.0.113.9".into()),
            user_agent: Some("test".into()),
        },
    }
}

async fn trading_rig() -> Rig {
    let r = rig(&[spec(9001, "a", true), spec(9002, "b", true)]).await;
    r.ledger.with(&db_path("a"), |db| {
        db.trades = vec![open_trade(1, "BTC/USDC:USDC", false, T0 - HOUR)];
    });
    r.ledger.with(&db_path("b"), |db| {
        db.trades = vec![open_trade(1, "ETH/USDC:USDC", true, T0 - HOUR)];
    });
    for (port, pair) in [(9001, "BTC/USDC:USDC"), (9002, "ETH/USDC:USDC")] {
        r.bots
            .iter()
            .find(|b| b.port == port)
            .unwrap()
            .state
            .lock()
            .unwrap()
            .status = json!([
            {"trade_id": 1, "pair": pair, "is_short": port == 9002, "amount": 2.0,
             "stake_amount": 100.0, "open_rate": 100.0, "current_rate": 101.0,
             "profit_abs": 1.0, "profit_ratio": 0.01}
        ]);
    }
    settle(100).await;
    for (port, pair) in [(9001, "BTC/USDC:USDC"), (9002, "ETH/USDC:USDC")] {
        r.net
            .push(
                port,
                snapshot(json!([{"trade_id": 1, "pair": pair, "current_rate": 101.0,
                                 "profit_abs": 1.0, "profit_ratio": 0.01}])),
            )
            .await;
    }
    settle(2).await;
    r.h.publish_now().await.unwrap();
    r
}

fn writes(r: &Rig, port: u16) -> Vec<(String, String)> {
    r.bots
        .iter()
        .find(|b| b.port == port)
        .unwrap()
        .writes
        .lock()
        .unwrap()
        .clone()
}

#[tokio::test(start_paused = true)]
async fn a_forced_exit_goes_to_the_bot_in_the_request_and_is_audited() {
    let r = trading_rig().await;
    let res =
        r.h.act(exit_req(9001, "k-1", "BTC/USDC:USDC", false))
            .await
            .unwrap();
    assert_eq!(res.status, ActionStatus::Accepted);
    assert_eq!(res.http_status, Some(200));
    assert!(res.verify.is_some());
    assert_eq!(
        writes(&r, 9001),
        vec![("k-1".to_owned(), "forceexit".to_owned())]
    );
    assert!(writes(&r, 9002).is_empty(), "never the other bot");
    // Two audit rows: the intent before the request and the outcome after it; no secret.
    let audit = r.h.audit(0, None, 10).await.unwrap();
    assert_eq!(audit.len(), 2);
    assert!(audit[0].http_status.is_none() && audit[1].http_status == Some(200));
    assert_eq!(audit[0].session_hash, "sess");
    assert_eq!(audit[0].params["trade_id"], json!(1));
    assert_eq!(audit[0].bot_name, "a");
    assert!(!format!("{audit:?}").to_lowercase().contains("token"));
    // The same key again returns the stored result and sends nothing.
    let again =
        r.h.act(exit_req(9001, "k-1", "BTC/USDC:USDC", false))
            .await
            .unwrap();
    assert_eq!(again, res);
    assert_eq!(writes(&r, 9001).len(), 1);
    // The feed says it happened.
    settle(1).await;
    let kinds: Vec<_> =
        r.h.events(Default::default())
            .await
            .iter()
            .map(|e| e.kind)
            .collect();
    assert!(kinds.contains(&EventKind::Action));
}

#[tokio::test(start_paused = true)]
async fn the_expected_state_guards_against_the_wrong_trade_and_the_wrong_bot() {
    let r = trading_rig().await;
    // Same trade id 1 on both bots: the pair and the side tell them apart.
    let wrong_pair =
        r.h.act(exit_req(9001, "k-a", "ETH/USDC:USDC", false))
            .await
            .unwrap_err();
    assert_eq!(wrong_pair.code, fg_core::protocol::ErrorCode::StateMismatch);
    let wrong_side =
        r.h.act(exit_req(9001, "k-b", "BTC/USDC:USDC", true))
            .await
            .unwrap_err();
    assert_eq!(wrong_side.code, fg_core::protocol::ErrorCode::StateMismatch);
    let mut missing = exit_req(9001, "k-c", "BTC/USDC:USDC", false);
    missing.expected = None;
    assert_eq!(
        r.h.act(missing).await.unwrap_err().code,
        fg_core::protocol::ErrorCode::BadRequest
    );
    let mut no_trade = exit_req(9001, "k-d", "BTC/USDC:USDC", false);
    no_trade.action = WriteAction::ForceExit {
        trade_id: 99,
        ordertype: None,
        amount: None,
    };
    assert_eq!(
        r.h.act(no_trade).await.unwrap_err().code,
        fg_core::protocol::ErrorCode::StateMismatch
    );
    let unknown_bot = exit_req(9999, "k-e", "BTC/USDC:USDC", false);
    assert_eq!(
        r.h.act(unknown_bot).await.unwrap_err().code,
        fg_core::protocol::ErrorCode::NotFound
    );
    assert!(writes(&r, 9001).is_empty() && writes(&r, 9002).is_empty());
}

#[tokio::test(start_paused = true)]
async fn an_old_model_is_checked_against_the_bot_before_an_exit_is_sent() {
    let r = trading_rig().await;
    // The model still shows the position (ledger) but the bot closed it meanwhile and the
    // prices are no longer fresh: the exit must not go out on faith.
    settle(30).await;
    r.bots[0].state.lock().unwrap().status = json!([]);
    let err =
        r.h.act(exit_req(9001, "k-old", "BTC/USDC:USDC", false))
            .await
            .unwrap_err();
    assert_eq!(err.code, fg_core::protocol::ErrorCode::StateMismatch);
    assert!(writes(&r, 9001).is_empty());
}

#[tokio::test(start_paused = true)]
async fn sensitive_actions_need_the_bot_name_typed_back() {
    let r = trading_rig().await;
    let mut stop = exit_req(9001, "k-stop", "x", false);
    stop.action = WriteAction::Stop;
    stop.expected = None;
    assert_eq!(
        r.h.act(stop.clone()).await.unwrap_err().code,
        fg_core::protocol::ErrorCode::Forbidden
    );
    stop.confirm = Some("b".into());
    assert_eq!(
        r.h.act(stop.clone()).await.unwrap_err().code,
        fg_core::protocol::ErrorCode::Forbidden,
        "the name of another bot is not a confirmation"
    );
    stop.confirm = Some("a".into());
    assert_eq!(r.h.act(stop).await.unwrap().status, ActionStatus::Accepted);
    // Deleting a trade of a live bot is sensitive too.
    let mut del = exit_req(9002, "k-del", "ETH/USDC:USDC", true);
    del.action = WriteAction::DeleteTrade { trade_id: 1 };
    assert_eq!(
        r.h.act(del).await.unwrap_err().code,
        fg_core::protocol::ErrorCode::Forbidden
    );
}

#[tokio::test(start_paused = true)]
async fn a_double_click_is_one_request() {
    let r = trading_rig().await;
    r.bots[0].state.lock().unwrap().write_delay = Duration::from_secs(1);
    let (a, b) = tokio::join!(
        r.h.act(exit_req(9001, "k-dbl", "BTC/USDC:USDC", false)),
        r.h.act(exit_req(9001, "k-dbl", "BTC/USDC:USDC", false)),
    );
    let results = [a, b];
    let ok = results.iter().filter(|r| r.is_ok()).count();
    let busy = results
        .iter()
        .filter(|r| {
            r.as_ref()
                .err()
                .is_some_and(|e| e.code == fg_core::protocol::ErrorCode::InProgress)
        })
        .count();
    assert_eq!((ok, busy), (1, 1), "{results:?}");
    assert_eq!(writes(&r, 9001).len(), 1);
    // A second click with another key on the same trade while the first runs is refused too.
    r.bots[0].state.lock().unwrap().write_delay = Duration::from_secs(1);
    let (c, d) = tokio::join!(
        r.h.act(exit_req(9001, "k-x1", "BTC/USDC:USDC", false)),
        r.h.act(exit_req(9001, "k-x2", "BTC/USDC:USDC", false)),
    );
    assert_eq!(
        [&c, &d].iter().filter(|r| r.is_ok()).count(),
        1,
        "{c:?} {d:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn an_uncertain_write_is_unknown_and_is_never_sent_again() {
    let r = trading_rig().await;
    r.bots[0].state.lock().unwrap().write_result = Err(RestError::Uncertain);
    let res =
        r.h.act(exit_req(9001, "k-unc", "BTC/USDC:USDC", false))
            .await
            .unwrap();
    assert_eq!(res.status, ActionStatus::Unknown);
    assert!(res.verify.is_some());
    // The client retries with the same key: nothing leaves, the answer stays "unknown".
    r.bots[0].state.lock().unwrap().write_result = Ok(WriteOutcome {
        status: 200,
        body: json!({}),
        latency_ms: 1,
    });
    let again =
        r.h.act(exit_req(9001, "k-unc", "BTC/USDC:USDC", false))
            .await
            .unwrap();
    assert_eq!(again.status, ActionStatus::Unknown);
    assert_eq!(writes(&r, 9001).len(), 1);
}

#[tokio::test(start_paused = true)]
async fn a_refused_login_or_a_401_proves_nothing_was_done_and_may_be_retried() {
    let r = trading_rig().await;
    r.bots[0].state.lock().unwrap().write_result = Ok(WriteOutcome {
        status: 401,
        body: json!({"detail": "expired"}),
        latency_ms: 1,
    });
    let res =
        r.h.act(exit_req(9001, "k-401", "BTC/USDC:USDC", false))
            .await
            .unwrap();
    assert_eq!(
        (res.status, res.http_status),
        (ActionStatus::Rejected, Some(401))
    );
    assert_eq!(res.reason.as_deref(), Some("unauthorized"));
    // Not remembered as a final result: the same key is sent again.
    r.bots[0].state.lock().unwrap().write_result = Ok(WriteOutcome {
        status: 200,
        body: json!({}),
        latency_ms: 1,
    });
    let ok =
        r.h.act(exit_req(9001, "k-401", "BTC/USDC:USDC", false))
            .await
            .unwrap();
    assert_eq!(ok.status, ActionStatus::Accepted);
    assert_eq!(writes(&r, 9001).len(), 2);
    // A write that never left the machine is reported as such.
    r.bots[1].state.lock().unwrap().write_result = Err(RestError::NotSent);
    let res =
        r.h.act(exit_req(9002, "k-ns", "ETH/USDC:USDC", true))
            .await
            .unwrap();
    assert_eq!(res.reason.as_deref(), Some("not_sent"));
}

#[tokio::test(start_paused = true)]
async fn an_offline_bot_refuses_actions_without_sending() {
    let r = trading_rig().await;
    r.bots[0].set_mode(Mode::Fail(RestError::Refused));
    r.bots[0].state.lock().unwrap().ping_ok = false;
    settle(400).await;
    r.h.publish_now().await.unwrap();
    let err =
        r.h.act(exit_req(9001, "k-off", "BTC/USDC:USDC", false))
            .await
            .unwrap_err();
    assert_eq!(err.code, fg_core::protocol::ErrorCode::BotUnreachable);
    assert!(writes(&r, 9001).is_empty());
}

#[tokio::test(start_paused = true)]
async fn idempotency_keys_must_be_well_formed() {
    let r = trading_rig().await;
    for bad in ["", "has space", &"x".repeat(200)] {
        let e =
            r.h.act(exit_req(9001, bad, "BTC/USDC:USDC", false))
                .await
                .unwrap_err();
        assert_eq!(e.code, fg_core::protocol::ErrorCode::BadRequest);
    }
}

#[tokio::test(start_paused = true)]
async fn a_client_that_leaves_mid_write_does_not_cut_the_action_short() {
    // B52: the run belongs to a task of its own; dropping the caller changes nothing.
    let r = trading_rig().await;
    r.bots[0].state.lock().unwrap().write_delay = Duration::from_secs(5);
    let gone = tokio::time::timeout(
        Duration::from_secs(1),
        r.h.act(exit_req(9001, "k-gone", "BTC/USDC:USDC", false)),
    )
    .await;
    assert!(
        gone.is_err(),
        "the caller gave up while the write was running"
    );
    settle(10).await;
    // The outcome is on record, the feed has it, and the key is final: no "interrupted".
    let audit = r.h.audit(0, None, 10).await.unwrap();
    assert_eq!(audit.len(), 2, "intent and outcome");
    assert_eq!(audit[1].http_status, Some(200));
    assert!(
        r.h.events(Default::default())
            .await
            .iter()
            .any(|e| e.kind == EventKind::Action)
    );
    let replay =
        r.h.act(exit_req(9001, "k-gone", "BTC/USDC:USDC", false))
            .await
            .unwrap();
    assert_eq!(replay.status, ActionStatus::Accepted);
    assert_eq!(writes(&r, 9001).len(), 1);
}

#[tokio::test(start_paused = true)]
async fn a_write_that_outlasts_the_deadline_is_told_unknown_while_it_carries_on() {
    let r = trading_rig().await;
    r.bots[0].state.lock().unwrap().write_delay = Duration::from_secs(120);
    let res =
        r.h.act(exit_req(9001, "k-slow", "BTC/USDC:USDC", false))
            .await
            .unwrap();
    assert_eq!(res.status, ActionStatus::Unknown);
    assert_eq!(res.reason.as_deref(), Some("timeout"));
    assert!(res.verify.is_some());
    // Meanwhile the same key is still running: not a second send.
    let busy =
        r.h.act(exit_req(9001, "k-slow", "BTC/USDC:USDC", false))
            .await
            .unwrap_err();
    assert_eq!(busy.code, fg_core::protocol::ErrorCode::InProgress);
    settle(200).await;
    let audit = r.h.audit(0, None, 10).await.unwrap();
    assert_eq!(audit.len(), 2);
    let done =
        r.h.act(exit_req(9001, "k-slow", "BTC/USDC:USDC", false))
            .await
            .unwrap();
    assert_eq!(done.status, ActionStatus::Accepted);
    assert_eq!(writes(&r, 9001).len(), 1);
}

#[tokio::test(start_paused = true)]
async fn a_key_stands_for_one_bot_one_action_and_one_set_of_parameters() {
    // B53
    let r = trading_rig().await;
    let first =
        r.h.act(exit_req(9001, "k-same", "BTC/USDC:USDC", false))
            .await
            .unwrap();
    assert_eq!(first.status, ActionStatus::Accepted);
    let reused = fg_core::protocol::ErrorCode::IdempotencyKeyReused;
    // Another bot.
    let other_bot =
        r.h.act(exit_req(9002, "k-same", "ETH/USDC:USDC", true))
            .await
            .unwrap_err();
    assert_eq!(other_bot.code, reused);
    // Another action on the same bot.
    let mut pause = exit_req(9001, "k-same", "x", false);
    pause.action = WriteAction::Pause;
    pause.expected = None;
    assert_eq!(r.h.act(pause).await.unwrap_err().code, reused);
    // Another trade on the same bot and action.
    let mut other_trade = exit_req(9001, "k-same", "BTC/USDC:USDC", false);
    other_trade.action = WriteAction::ForceExit {
        trade_id: 2,
        ordertype: None,
        amount: None,
    };
    assert_eq!(r.h.act(other_trade).await.unwrap_err().code, reused);
    // The genuine replay still gets the stored result, and nothing else left for a bot.
    let again =
        r.h.act(exit_req(9001, "k-same", "BTC/USDC:USDC", false))
            .await
            .unwrap();
    assert_eq!(again, first);
    assert_eq!(writes(&r, 9001).len(), 1);
    assert!(writes(&r, 9002).is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_replay_is_answered_from_the_table_even_when_the_state_it_changed_is_gone() {
    // B54: the exit closed the trade and the bot went away; the lost reply is asked again.
    let r = trading_rig().await;
    let first =
        r.h.act(exit_req(9001, "k-rep", "BTC/USDC:USDC", false))
            .await
            .unwrap();
    assert_eq!(first.status, ActionStatus::Accepted);
    r.bots[0].state.lock().unwrap().status = json!([]);
    r.bots[0].set_mode(Mode::Fail(RestError::Refused));
    r.bots[0].state.lock().unwrap().ping_ok = false;
    settle(400).await;
    r.h.publish_now().await.unwrap();
    assert_eq!(r.status_of(9001).await, BotStatus::Offline);
    let again =
        r.h.act(exit_req(9001, "k-rep", "BTC/USDC:USDC", false))
            .await
            .unwrap();
    assert_eq!(again, first, "the stored result, not bot_unreachable");
    assert_eq!(writes(&r, 9001).len(), 1);
}

#[tokio::test(start_paused = true)]
async fn the_guard_of_an_action_uses_the_exact_age_of_the_position() {
    // B55: the published instant is rounded down to 30 s for the clients; the guard must not
    // read that rounding as age. A model refreshed a moment ago is trusted without a Status read.
    let r = trading_rig().await;
    // Move to a moment where the rounding alone would make the position look older than 10 s.
    while r.h.now_ms() % 30_000 < 16_000 {
        settle(1).await;
    }
    r.net
        .push(
            9001,
            snapshot(
                json!([{"trade_id": 1, "pair": "BTC/USDC:USDC", "current_rate": 102.0,
                             "profit_abs": 2.0, "profit_ratio": 0.02}]),
            ),
        )
        .await;
    settle(1).await;
    r.h.publish_now().await.unwrap();
    let p = r.h.published();
    let key_ = crate::ledger_data::trade_key(&key(9001), 1);
    let shown = p.positions[&key_].freshness.as_of_ms;
    let seen = p.positions_seen_ms[&key_];
    assert_eq!(shown % 30_000, 0, "clients get the rounded instant");
    assert!(
        seen > shown && r.h.now_ms() - seen <= 3_000,
        "{seen} {shown}"
    );
    // The bot no longer lists the trade, yet the exit is judged on the fresh model: no read.
    r.bots[0].state.lock().unwrap().status = json!([]);
    let before = r.bots[0].calls_of("status").len();
    let res =
        r.h.act(exit_req(9001, "k-fresh", "BTC/USDC:USDC", false))
            .await
            .unwrap();
    assert_eq!(res.status, ActionStatus::Accepted);
    assert_eq!(r.bots[0].calls_of("status").len(), before, "no Status read");
}

// ====================================================================== preferences

#[tokio::test(start_paused = true)]
async fn preferences_sync_across_devices_by_bot_key_with_optimistic_concurrency() {
    let r = rig(&[spec(9001, "a", true)]).await;
    let h = &r.h;
    // The phone writes the global document, the computer reads it.
    let a = h
        .prefs_put("owner", "", json!({"tz": "Europe/Paris"}), Some(0))
        .await
        .unwrap();
    assert_eq!(a.version, 1);
    let seen = h.prefs_get("owner", "").await.unwrap().unwrap();
    assert_eq!(seen.data, json!({"tz": "Europe/Paris"}));
    // Per-bot preferences are keyed by bot_key, never by a device alias.
    h.prefs_put(
        "owner",
        "local:9001",
        json!({"icon": "x", "tags": ["alpha"]}),
        None,
    )
    .await
    .unwrap();
    assert!(
        h.prefs_put("owner", "ftbot.3", json!({}), None)
            .await
            .is_err()
    );
    // Both devices edit the same version: the second one loses cleanly.
    h.prefs_put("owner", "", json!({"tz": "UTC"}), Some(1))
        .await
        .unwrap();
    let lost = h
        .prefs_put("owner", "", json!({"tz": "Asia/Tokyo"}), Some(1))
        .await
        .unwrap_err();
    assert_eq!(lost.code(), fg_core::protocol::ErrorCode::StateMismatch);
    assert_eq!(h.prefs_list("owner").await.unwrap().len(), 2);
    // They survive a restart of the gateway.
    let dir = r.dir;
    r.engine.shutdown().await;
    let r2 = rig_in(dir, &[spec(9001, "a", true)], |_| {}).await;
    assert_eq!(
        r2.h.prefs_get("owner", "local:9001")
            .await
            .unwrap()
            .unwrap()
            .data["tags"],
        json!(["alpha"])
    );
    assert!(r2.h.prefs_get("someone-else", "").await.unwrap().is_none());
}

// ====================================================================== queries

#[tokio::test(start_paused = true)]
async fn queries_read_the_published_history() {
    let r = rig(&[spec(9001, "a", true), spec(9002, "d", false)]).await;
    seed_positions(&r, "a");
    r.ledger.with(&db_path("d"), |db| {
        db.trades = vec![closed_trade(
            1,
            "BTC/USDC:USDC",
            T0 - 5 * HOUR,
            T0 - 4 * HOUR,
            100.0,
        )];
    });
    settle(60).await;
    r.h.publish_now().await.unwrap();
    let h = &r.h;
    let live = fg_core::model::BotMode::Live;
    // Journal: filters, totals over all matches, keyset pagination.
    let page = h.journal(&crate::queries::JournalQuery {
        mode: Some(live),
        limit: 2,
        descending: true,
        ..Default::default()
    });
    assert_eq!(page.matched, 3);
    assert_eq!(page.rows.len(), 2);
    assert_eq!(page.rows[0].trade_id, 5, "newest close first");
    assert_eq!(page.totals.count, 3);
    assert!((page.totals.sum - 15.5).abs() < 1e-9);
    let next = h.journal(&crate::queries::JournalQuery {
        mode: Some(live),
        limit: 2,
        descending: true,
        cursor: page.next_cursor.clone(),
        ..Default::default()
    });
    assert_eq!(
        next.rows.iter().map(|t| t.trade_id).collect::<Vec<_>>(),
        [3]
    );
    assert!(next.next_cursor.is_none());
    // Live and dry never mix in a scope.
    assert!(h.drawdown(&ScopeRefExt::mixed()).is_err());
    let dd = h
        .drawdown(&crate::queries::ScopeRef::Mode(BotMode::Live))
        .unwrap();
    assert!(dd.realized.abs >= 0.0);
    let cal = h
        .pnl_calendar(
            &crate::queries::ScopeRef::Mode(BotMode::Live),
            fg_core::calc::periods::PeriodUnit::Day,
            3,
        )
        .unwrap();
    assert_eq!(cal.len(), 3);
    assert!((cal.iter().map(|b| b.profit_abs).sum::<f64>() - 15.5).abs() < 1e-9);
    let board = h
        .leaderboard(BotMode::Dry, fg_core::calc::periods::PeriodKey::D7)
        .unwrap();
    assert_eq!(board[0].profit_abs, 100.0);
    let eq = h
        .equity(
            &crate::queries::ScopeRef::Mode(BotMode::Live),
            0,
            10,
            crate::queries::EquityMode::Realized,
        )
        .unwrap();
    assert!(eq.len() <= 10 && eq.last().unwrap().value == 15.5);
}

struct ScopeRefExt;

impl ScopeRefExt {
    fn mixed() -> crate::queries::ScopeRef {
        crate::queries::ScopeRef::Bots(vec![key(9001), key(9002)])
    }
}

// ====================================================================== lifecycle

#[tokio::test(start_paused = true)]
async fn a_replaced_bot_is_announced_and_a_vanished_bot_is_stopped_not_forgotten() {
    let r = rig(&[spec(9001, "a", true), spec(9002, "b", true)]).await;
    seed_positions(&r, "a");
    settle(100).await;
    // Port 9001 now runs another strategy: a new incarnation.
    {
        let mut bots = r.disc.bots.lock().unwrap();
        bots[0].config.strategy = Some("OTHER".into());
        // Bot b's process is gone, its database remains.
        bots.remove(1);
    }
    settle(120).await;
    r.h.publish_now().await.unwrap();
    let kinds: Vec<_> =
        r.h.events(Default::default())
            .await
            .iter()
            .map(|e| e.kind)
            .collect();
    assert!(kinds.contains(&EventKind::BotReplaced));
    let p = r.h.published();
    assert_eq!(p.bots[&key(9002)].state.status, BotStatus::Stopped);
    assert!(p.bots.contains_key(&key(9001)));
}

#[tokio::test(start_paused = true)]
async fn the_budget_and_the_engine_stop_cleanly() {
    let r = rig(&[spec(9001, "a", true)]).await;
    settle(30).await;
    r.engine.shutdown().await;
}

// ------------------------------------------------------------------ chart relay

fn chart_channel(port: u16, pair: &str, tf: &str) -> Channel {
    Channel::Chart {
        bot: key(port),
        pair: pair.into(),
        timeframe: tf.into(),
    }
}

/// A `pair_candles` answer with `n` candles of 15 minutes ending at `last_close` and an indicator
/// column that must not travel.
fn candles_body(n: i64, last_close: f64) -> Vec<u8> {
    let rows: Vec<serde_json::Value> = (0..n)
        .map(|i| {
            let t = T0 - (n - 1 - i) * 900_000;
            let c = if i == n - 1 {
                last_close
            } else {
                100.0 + i as f64
            };
            json!(["d", c - 1.0, c + 2.0, c - 2.0, c, 10.0 + i as f64, 55.0, t])
        })
        .collect();
    serde_json::to_vec(&json!({
        "pair": "BTC/USDC:USDC", "timeframe": "15m",
        "columns": ["date", "open", "high", "low", "close", "volume", "rsi", "__date_ts"],
        "data": rows,
    }))
    .unwrap()
}

fn candle_reads(r: &Rig) -> usize {
    r.bots[0]
        .calls
        .lock()
        .unwrap()
        .iter()
        .filter(|(_, w)| w.starts_with("proxy GET /pair_candles"))
        .count()
}

/// A client that applies deltas may lag on the timestamp of a freshness (it is not pushed alone).
fn without_as_of(
    mut c: BTreeMap<String, BTreeMap<String, serde_json::Value>>,
) -> BTreeMap<String, BTreeMap<String, serde_json::Value>> {
    if let Some(meta) = c.get_mut("chart").and_then(|m| m.get_mut("meta")) {
        meta["freshness"]["as_of_ms"] = json!(0);
    }
    c
}

async fn frames_until_quiet(
    sub: &mut crate::hub::Subscription,
    state: &mut ChannelState,
) -> Vec<ServerFrame> {
    let mut seen = Vec::new();
    while let Ok(Some(f)) = tokio::time::timeout(Duration::from_millis(5), sub.next()).await {
        if let ServerFrame::Up { upsert, remove, .. } = &f {
            state.apply(upsert, remove);
        }
        seen.push(f);
    }
    seen
}

#[tokio::test(start_paused = true)]
async fn an_open_chart_relays_the_candles_and_a_client_that_applies_the_frames_equals_the_snapshot()
{
    let r = rig(&[spec(9001, "a", true)]).await;
    r.bots[0].state.lock().unwrap().candles = Some(candles_body(5, 104.0));
    settle(100).await;
    let ch = chart_channel(9001, "BTC/USDC:USDC", "15m");

    // Nothing is read for a chart nobody holds; its snapshot is empty, not an error.
    assert_eq!(candle_reads(&r), 0);
    assert!(r.h.snapshot(&ch).unwrap().collections.is_empty());

    let mut sub = r.h.subscribe(&[(ch.clone(), None)]).unwrap();
    let mut client = ChannelState::default();
    settle(2).await;
    frames_until_quiet(&mut sub, &mut client).await;
    let snap = r.h.snapshot(&ch).unwrap();
    assert_eq!(snap.collections["candles"].len(), 5);
    assert_eq!(
        without_as_of(client.collections.clone()),
        without_as_of(snap.collections.clone())
    );
    let last = &snap.collections["candles"][&T0.to_string()];
    assert_eq!(last["c"], json!(104.0));
    assert!(last.get("rsi").is_none(), "only OHLCV travels: {last}");
    let meta = &snap.collections["chart"]["meta"];
    assert_eq!(meta["pair"], "BTC/USDC:USDC");
    assert_eq!(meta["candles"], 5);
    assert_eq!(meta["freshness"]["stale"], false);

    // The forming candle moves, a new one opens and the oldest leaves the window.
    let mut body: serde_json::Value = serde_json::from_slice(&candles_body(5, 104.0)).unwrap();
    let rows = body["data"].as_array_mut().unwrap();
    rows.remove(0);
    rows.last_mut().unwrap()[4] = json!(106.0);
    rows.push(json!([
        "d",
        106.0,
        109.0,
        105.0,
        108.0,
        3.0,
        50.0,
        T0 + 900_000
    ]));
    r.bots[0].state.lock().unwrap().candles = Some(serde_json::to_vec(&body).unwrap());
    settle(65).await;
    let frames = frames_until_quiet(&mut sub, &mut client).await;
    assert!(frames.iter().any(|f| matches!(f, ServerFrame::Up { .. })));
    let snap = r.h.snapshot(&ch).unwrap();
    assert_eq!(snap.collections["candles"].len(), 5);
    assert!(!snap.collections["candles"].contains_key(&(T0 - 4 * 900_000).to_string()));
    assert_eq!(
        without_as_of(client.collections.clone()),
        without_as_of(snap.collections.clone()),
        "applying the frames gives the snapshot"
    );
    assert_eq!(
        snap.collections["candles"][&T0.to_string()]["c"],
        json!(106.0)
    );
    assert_eq!(
        snap.collections["candles"][&(T0 + 900_000).to_string()]["c"],
        json!(108.0)
    );
}

#[tokio::test(start_paused = true)]
async fn many_clients_on_a_chart_cost_one_read_per_period_inside_the_budget_and_it_stops_after_them()
 {
    let r = rig(&[spec(9001, "a", true)]).await;
    r.bots[0].state.lock().unwrap().candles = Some(candles_body(5, 104.0));
    settle(100).await;
    let ch = chart_channel(9001, "BTC/USDC:USDC", "15m");
    let subs: Vec<_> = (0..20)
        .map(|_| r.h.subscribe(&[(ch.clone(), None)]).unwrap())
        .collect();
    assert_eq!(r.engine_charts(), 1, "one poller for twenty clients");
    let granted0 = r.h.budget_stats().granted;
    let reads0 = candle_reads(&r);
    settle(600).await;
    // 15m: a read every 60 s.
    let reads = candle_reads(&r) - reads0;
    assert!((9..=11).contains(&reads), "{reads} reads in 10 minutes");
    let granted = r.h.budget_stats().granted - granted0;
    assert!(
        granted >= reads as u64,
        "the reads are counted in the budget"
    );

    // Everybody leaves: it keeps going for the hold-over, then stops and forgets the chart.
    drop(subs);
    settle(100).await;
    let after = candle_reads(&r);
    settle(600).await;
    assert_eq!(candle_reads(&r), after, "no read for a chart nobody holds");
    assert_eq!(r.engine_charts(), 0);

    // Coming back starts it again from a clean state.
    let mut sub = r.h.subscribe(&[(ch.clone(), None)]).unwrap();
    settle(5).await;
    assert!(candle_reads(&r) > after);
    assert_eq!(r.h.snapshot(&ch).unwrap().collections["candles"].len(), 5);
    drop(sub.next());
}

#[tokio::test(start_paused = true)]
async fn charts_are_validated_and_capped() {
    let r = rig(&[spec(9001, "a", true)]).await;
    settle(100).await;
    let sub = |ch: Channel| r.h.subscribe(&[(ch, None)]).map(|_| ()).unwrap_err();
    assert_eq!(
        sub(chart_channel(9001, "BTC&limit=1", "15m")).code(),
        fg_core::protocol::ErrorCode::BadRequest
    );
    assert_eq!(
        sub(chart_channel(9001, "BTC/USDC:USDC", "15 m")).code(),
        fg_core::protocol::ErrorCode::BadRequest
    );
    assert_eq!(
        sub(chart_channel(9999, "BTC/USDC:USDC", "15m")).code(),
        fg_core::protocol::ErrorCode::NotFound
    );
    assert_eq!(
        r.engine_charts(),
        0,
        "a refused chart leaves nothing behind"
    );

    let mut open = Vec::new();
    for i in 0..crate::chart::MAX_CHARTS {
        open.push(
            r.h.subscribe(&[(chart_channel(9001, &format!("C{i}/USDC:USDC"), "1h"), None)])
                .unwrap(),
        );
    }
    let err = sub(chart_channel(9001, "ONE/USDC:USDC", "1h"));
    assert_eq!(err.code(), fg_core::protocol::ErrorCode::Unavailable);
    // A client joining a chart that is already open does not count against the cap.
    open.push(
        r.h.subscribe(&[(chart_channel(9001, "C0/USDC:USDC", "1h"), None)])
            .unwrap(),
    );
    assert_eq!(r.engine_charts(), crate::chart::MAX_CHARTS);
}

#[tokio::test(start_paused = true)]
async fn a_bot_that_cannot_be_read_leaves_the_last_candles_and_the_chart_goes_stale() {
    let r = rig(&[spec(9001, "a", true)]).await;
    r.bots[0].state.lock().unwrap().candles = Some(candles_body(5, 104.0));
    settle(100).await;
    let ch = chart_channel(9001, "BTC/USDC:USDC", "15m");
    let mut sub = r.h.subscribe(&[(ch.clone(), None)]).unwrap();
    let mut client = ChannelState::default();
    settle(5).await;
    frames_until_quiet(&mut sub, &mut client).await;
    assert_eq!(
        client.collections["chart"]["meta"]["freshness"]["stale"],
        false
    );

    for odd in [
        None,
        Some(b"<html>sign in</html>".to_vec()),
        Some(serde_json::to_vec(&json!({"detail": "boom"})).unwrap()),
    ] {
        r.bots[0].state.lock().unwrap().candles = odd;
        settle(300).await;
        frames_until_quiet(&mut sub, &mut client).await;
        let snap = r.h.snapshot(&ch).unwrap();
        assert_eq!(
            snap.collections["candles"].len(),
            5,
            "the last candles stay"
        );
        assert_eq!(
            snap.collections["chart"]["meta"]["freshness"]["stale"],
            true
        );
        assert_eq!(
            client.collections["chart"]["meta"]["freshness"]["stale"],
            true
        );
        assert_eq!(
            without_as_of(client.collections.clone()),
            without_as_of(snap.collections.clone())
        );
        // The bot answers again: fresh.
        r.bots[0].state.lock().unwrap().candles = Some(candles_body(5, 104.0));
        settle(70).await;
        frames_until_quiet(&mut sub, &mut client).await;
        assert_eq!(
            r.h.snapshot(&ch).unwrap().collections["chart"]["meta"]["freshness"]["stale"],
            false
        );
    }
}

#[tokio::test(start_paused = true)]
async fn a_bot_that_is_down_is_not_asked_for_candles() {
    let r = rig(&[spec(9001, "a", true)]).await;
    r.bots[0].state.lock().unwrap().candles = Some(candles_body(5, 104.0));
    settle(100).await;
    r.bots[0].state.lock().unwrap().ping_ok = false;
    r.bots[0].state.lock().unwrap().mode = Mode::Fail(RestError::Refused);
    settle(400).await;
    assert_eq!(r.status_of(9001).await, BotStatus::Offline);
    let ch = chart_channel(9001, "BTC/USDC:USDC", "15m");
    let _sub = r.h.subscribe(&[(ch.clone(), None)]).unwrap();
    let before = candle_reads(&r);
    settle(300).await;
    assert_eq!(
        candle_reads(&r),
        before,
        "no budget spent on a bot that is down"
    );
    let snap = r.h.snapshot(&ch).unwrap();
    assert_eq!(
        snap.collections["chart"]["meta"]["freshness"]["stale"],
        true
    );
}

// ------------------------------------------------------------------ the relay and the budget (B106, B107)

fn fleet_specs(n: u16, first_port: u16) -> Vec<Spec> {
    (0..n)
        .map(|i| Spec {
            port: first_port + i,
            name: Box::leak(format!("f{first_port}x{i}").into_boxed_str()),
            live: i % 3 != 0,
            wallet: (i % 3 != 0).then_some(FAKE_WALLET),
            capital: Some(100.0),
        })
        .collect()
}

/// Reads of `/status` over `secs` after a warm-up, with `charts` charts of one minute open.
async fn status_reads_with_charts(first_port: u16, charts: u16) -> (usize, usize, f64) {
    let specs = fleet_specs(24, first_port);
    let r = rig(&specs).await;
    for b in &r.bots {
        b.state.lock().unwrap().candles = Some(candles_body(5, 104.0));
    }
    settle(200).await;
    let mut subs = Vec::new();
    for i in 0..charts {
        let bot = first_port + i % 24;
        subs.push(
            r.h.subscribe(&[(chart_channel(bot, &format!("C{i}/USDC:USDC"), "1m"), None)])
                .unwrap(),
        );
    }
    settle(100).await;
    let status0: usize = r.bots.iter().map(|b| b.calls_of("status").len()).sum();
    let pc0 = r
        .bots
        .iter()
        .map(|b| {
            b.calls
                .lock()
                .unwrap()
                .iter()
                .filter(|(_, w)| w.starts_with("proxy GET /pair_candles"))
                .count()
        })
        .sum::<usize>();
    let g0 = r.h.budget_stats().granted;
    let t0 = tokio::time::Instant::now();
    settle(900).await;
    let secs = t0.elapsed().as_secs_f64();
    let status = r
        .bots
        .iter()
        .map(|b| b.calls_of("status").len())
        .sum::<usize>()
        - status0;
    let pc = r
        .bots
        .iter()
        .map(|b| {
            b.calls
                .lock()
                .unwrap()
                .iter()
                .filter(|(_, w)| w.starts_with("proxy GET /pair_candles"))
                .count()
        })
        .sum::<usize>()
        - pc0;
    let granted = (r.h.budget_stats().granted - g0) as f64 / secs;
    drop(subs);
    r.engine.shutdown().await;
    (status, pc, granted)
}

/// B106: 16 charts of one minute asked for 3.2 req/s from a bucket of 2.8 shared in arrival
/// order; the polling of the fleet (and the pre-read of a forced exit) waited behind them.
#[tokio::test(start_paused = true)]
async fn sixteen_one_minute_charts_cannot_starve_the_fleet_polling() {
    let (calm, none, _) = status_reads_with_charts(9300, 0).await;
    assert_eq!(none, 0);
    let (busy, chart_reads, granted) = status_reads_with_charts(9400, 16).await;
    assert!(calm > 100, "the fleet is polled: {calm}");
    assert!(
        busy as f64 >= calm as f64 * 0.95,
        "status reads with charts {busy}, without {calm}"
    );
    let rate = chart_reads as f64 / 900.0;
    assert!(
        rate <= crate::chart::RELAY_RATE_PER_S * 1.05,
        "the relay stays inside its share: {rate} req/s"
    );
    assert!(rate > 0.2, "and it is not starved either: {rate} req/s");
    assert!(granted <= 2.8 * 1.02, "the global ceiling holds: {granted}");
}

/// B107: a refused chart and the snapshot of a chart nobody relays left an entry of the view
/// registry and of the hub for the life of the process.
#[tokio::test(start_paused = true)]
async fn refused_charts_and_snapshots_of_unrelayed_charts_leave_no_entry() {
    let r = rig(&[spec(9001, "a", true)]).await;
    r.bots[0].state.lock().unwrap().candles = Some(candles_body(5, 104.0));
    settle(100).await;
    let mut open = Vec::new();
    for i in 0..crate::chart::MAX_CHARTS {
        open.push(
            r.h.subscribe(&[(chart_channel(9001, &format!("C{i}/USDC:USDC"), "1h"), None)])
                .unwrap(),
        );
    }
    let (views0, hub0) = r.h.sh_entries();
    for i in 0..300 {
        let ch = chart_channel(9001, &format!("X{i}/USDC:USDC"), "1h");
        assert!(r.h.subscribe(&[(ch.clone(), None)]).is_err());
        r.h.snapshot(&ch).unwrap();
        let ch = chart_channel(9001, &format!("Y{i}/USDC:USDC"), "15m");
        r.h.snapshot(&ch).unwrap();
    }
    settle(600).await;
    assert_eq!(r.h.sh_entries(), (views0, hub0));
    assert_eq!(r.engine_charts(), crate::chart::MAX_CHARTS);
    // The snapshot of a chart nobody relays is still empty and well-formed.
    let snap =
        r.h.snapshot(&chart_channel(9001, "Z/USDC:USDC", "1h"))
            .unwrap();
    assert!(snap.collections.is_empty());
}
