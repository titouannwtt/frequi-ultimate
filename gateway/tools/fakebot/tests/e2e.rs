//! The real engine, with its real HTTP, WebSocket, SQLite and Unix-socket clients, against a small
//! fleet of fake bots in the same process. Writes only ever reach the fakebot, which records them.

mod common;

use std::sync::Arc;
use std::time::{Duration, Instant};

use common::{ManifestDiscovery, discovered};
use fakebot::{Fleet, FleetSpec, Mode, WriterConfig};
use fg_core::identity::BotKey;
use fg_core::model::{ActionStatus, BotStatus, EventKind};
use fg_core::protocol::{Channel, ErrorCode, ServerFrame};
use fg_engine::budget::BudgetConfig;
use fg_engine::{
    ActionOrigin, ActionRequest, Cadences, Engine, EngineConfig, EngineHandle, EngineSources,
    ExpectedTrade, HttpConnector, SystemClock,
};
use fg_sources::botrest::{RestOptions, WriteAction};
use fg_sources::botws::WsClient;
use fg_sources::ftcache::UnixDaemon;
use fg_sources::sqlite::{LedgerOptions, SqliteLedger};

const SCALE: f64 = 20.0;

struct Rig {
    fleet: Fleet,
    engine: Engine,
    h: EngineHandle,
    _dir: tempfile::TempDir,
}

async fn rig(bots: usize) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let mut spec = FleetSpec::new(bots, dir.path().join("fb"));
    spec.closed_trades = 300;
    spec.snapshot_every = Duration::from_millis(300);
    spec.writer = Some(WriterConfig::default());
    let fleet = Fleet::start(spec).await.unwrap();
    let discovered: Vec<_> = fleet.manifest.bots.iter().map(discovered).collect();
    let state = dir.path().join("gw");
    std::fs::create_dir_all(&state).unwrap();
    let mut cfg = EngineConfig::new(&state);
    cfg.cadences = Cadences::default().scaled(SCALE);
    cfg.budget = BudgetConfig {
        rate_per_s: 2.8 * SCALE,
        burst: 30,
        max_in_flight: 6,
    };
    let engine = Engine::start(
        cfg,
        EngineSources {
            discovery: Arc::new(ManifestDiscovery(discovered)),
            ledger: Arc::new(SqliteLedger::new(LedgerOptions::default())),
            daemon: Some(Arc::new(UnixDaemon::new(&fleet.manifest.daemon_socket))),
            connector: Arc::new(HttpConnector::new(RestOptions::default())),
            ws: Arc::new(WsClient::default()),
            ticker: None,
        },
        Arc::new(SystemClock),
    )
    .await
    .unwrap();
    let h = engine.handle();
    Rig {
        fleet,
        engine,
        h,
        _dir: dir,
    }
}

async fn until(what: &str, limit: Duration, mut ok: impl FnMut() -> bool) {
    let started = Instant::now();
    while !ok() {
        assert!(started.elapsed() < limit, "timed out waiting for: {what}");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

fn key_of(r: &Rig, i: usize) -> BotKey {
    BotKey::Local(r.fleet.manifest.bots[i].port)
}

fn origin() -> ActionOrigin {
    ActionOrigin {
        session_hash: "sess".into(),
        ip: None,
        user_agent: None,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_fleet_converges_and_a_fill_reaches_a_subscriber() {
    let r = rig(4).await;
    until(
        "every bot online with positions",
        Duration::from_secs(60),
        || {
            let p = r.h.published();
            p.bots.len() == 4
                && p.bots.values().all(|b| b.state.status == BotStatus::Online)
                && p.positions.len() >= 12
        },
    )
    .await;
    // Two live bots, two dry: modes are never mixed.
    r.h.publish_now().await.unwrap();
    let scopes = r.h.published().scopes.clone();
    assert!(scopes.contains_key("live") && scopes.contains_key("dry"));

    let mut sub = r.h.subscribe(&[(Channel::Events, None)]).unwrap();
    r.fleet.bot(1).unwrap().push(
        "entry_fill",
        &serde_json::json!({"trade_id": 777, "pair": "ETH/USDC:USDC", "profit_amount": 0.0}),
    );
    let got = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(ServerFrame::Ev { data, .. }) = sub.next().await
                && data.trade_id == Some(777)
            {
                return data;
            }
        }
    })
    .await
    .expect("the fill reaches the event channel");
    assert_eq!(got.kind, EventKind::EntryFill);
    assert_eq!(got.bot_key, Some(key_of(&r, 1)));
    r.engine.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_forced_exit_reaches_the_fakebot_once_and_is_audited() {
    let r = rig(2).await;
    until(
        "bot 0 online with positions",
        Duration::from_secs(60),
        || {
            let p = r.h.published();
            p.bots.values().all(|b| b.state.status == BotStatus::Online) && p.positions.len() >= 6
        },
    )
    .await;
    r.h.publish_now().await.unwrap();
    let key = key_of(&r, 0);
    let pos =
        r.h.published()
            .positions
            .values()
            .find(|p| p.bot_key == key)
            .cloned()
            .unwrap();
    let req = |idem: &str| ActionRequest {
        bot_key: key.clone(),
        action: WriteAction::ForceExit {
            trade_id: pos.trade_id,
            ordertype: None,
            amount: None,
        },
        idempotency_key: idem.to_owned(),
        expected: Some(ExpectedTrade {
            pair: pos.pair.clone(),
            is_short: pos.side == fg_core::model::Side::Short,
        }),
        confirm: None,
        origin: origin(),
    };
    let res =
        r.h.act(req("0b1c2d3e-0000-4000-8000-000000000001"))
            .await
            .unwrap();
    assert_eq!(res.status, ActionStatus::Accepted, "{res:?}");
    // The same click again: the stored result, and nothing more on the wire.
    let again =
        r.h.act(req("0b1c2d3e-0000-4000-8000-000000000001"))
            .await
            .unwrap();
    assert_eq!(again, res);
    let writes = r.fleet.stats().writes;
    assert_eq!(writes.len(), 1, "{writes:?}");
    assert_eq!(writes[0].0, 0, "only the bot of the request");
    assert_eq!(writes[0].1.path, "/forceexit");
    assert_eq!(
        writes[0].1.body["tradeid"],
        serde_json::json!(pos.trade_id.to_string())
    );

    // A wrong expectation is refused before anything is sent.
    let mut wrong = req("0b1c2d3e-0000-4000-8000-000000000002");
    wrong.expected = Some(ExpectedTrade {
        pair: "NOPE/USDC:USDC".into(),
        is_short: false,
    });
    assert_eq!(
        r.h.act(wrong).await.unwrap_err().code,
        ErrorCode::StateMismatch
    );
    assert_eq!(r.fleet.stats().writes.len(), 1);

    let audit = r.h.audit(0, None, 10).await.unwrap();
    assert!(audit.len() >= 2, "intent and outcome are both recorded");
    r.engine.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_bot_that_goes_down_is_offline_and_comes_back_by_itself() {
    let r = rig(2).await;
    until("fleet online", Duration::from_secs(60), || {
        let p = r.h.published();
        p.bots.len() == 2 && p.bots.values().all(|b| b.state.status == BotStatus::Online)
    })
    .await;
    let key = key_of(&r, 1);
    r.fleet.set_mode(1, Mode::Down);
    until("bot 1 offline", Duration::from_secs(60), || {
        r.h.published().bots[&key].state.status == BotStatus::Offline
    })
    .await;
    // The other bot is untouched, and an action on the offline one is refused without a request.
    assert_eq!(
        r.h.published().bots[&key_of(&r, 0)].state.status,
        BotStatus::Online
    );
    let refused =
        r.h.act(ActionRequest {
            bot_key: key.clone(),
            action: WriteAction::Pause,
            idempotency_key: "0b1c2d3e-0000-4000-8000-0000000000aa".into(),
            expected: None,
            confirm: None,
            origin: origin(),
        })
        .await;
    assert!(refused.is_err(), "no write to an offline bot");
    assert!(r.fleet.stats().writes.is_empty());

    r.fleet.set_mode(1, Mode::Up);
    until("bot 1 back online", Duration::from_secs(90), || {
        r.h.published().bots[&key].state.status == BotStatus::Online
    })
    .await;
    r.engine.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn expired_tokens_are_renewed_without_the_bot_noticing() {
    let r = rig(1).await;
    until("online", Duration::from_secs(60), || {
        r.h.published()
            .bots
            .values()
            .all(|b| b.state.status == BotStatus::Online)
            && !r.h.published().bots.is_empty()
    })
    .await;
    r.fleet.bot(0).unwrap().expire_tokens();
    // The 401 is answered with the refresh token, not with a new password login.
    let count = |route: &str| r.fleet.stats().by_route.get(route).copied().unwrap_or(0);
    let (logins, refreshes) = (count("POST /token/login"), count("POST /token/refresh"));
    until("a token refresh", Duration::from_secs(30), || {
        count("POST /token/refresh") > refreshes
    })
    .await;
    assert_eq!(count("POST /token/login"), logins, "no new password login");
    assert_eq!(
        r.h.published().bots.values().next().unwrap().state.status,
        BotStatus::Online
    );
    r.engine.shutdown().await;
}
