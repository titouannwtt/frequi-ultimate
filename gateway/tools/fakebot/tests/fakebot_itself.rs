//! The fake bots and the fake daemon behave like the real ones where the gateway looks.

mod common;

use std::time::Duration;

use fakebot::control::serve;
use fakebot::{Fleet, FleetSpec, Mode};
use fg_sources::botrest::{
    BotAuth, HttpBot, ReadEndpoint, RestError, RestOptions, WriteAction, build_http_client,
};
use fg_sources::discovery::ApiCredentials;
use fg_sources::ftcache::UnixDaemon;
use fg_sources::sensitive::Secret;
use fg_sources::traits::{BotRest, DaemonClient};
use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

async fn fleet(n: usize) -> (Fleet, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let mut spec = FleetSpec::new(n, dir.path().join("fb"));
    spec.closed_trades = 200;
    spec.writer = None;
    (Fleet::start(spec).await.unwrap(), dir)
}

fn client(f: &Fleet, i: usize, user: &str, pass: &str) -> HttpBot {
    let opts = RestOptions {
        read_timeout: Duration::from_secs(2),
        ..RestOptions::default()
    };
    HttpBot::new(
        "127.0.0.1",
        f.manifest.bots[i].port,
        BotAuth::Credentials(ApiCredentials {
            username: Secret::new(user),
            password: Secret::new(pass),
        }),
        build_http_client(&opts),
        opts,
    )
}

fn good(f: &Fleet, i: usize) -> HttpBot {
    let b = &f.manifest.bots[i];
    client(f, i, &b.user, &b.password)
}

#[tokio::test]
async fn the_reads_the_gateway_uses_answer_with_the_expected_shapes() {
    let (f, _d) = fleet(1).await;
    let b = good(&f, 0);
    b.ping().await.unwrap();
    let status = b.read(ReadEndpoint::Status).await.unwrap();
    assert_eq!(status.as_array().unwrap().len(), 3);
    assert!(status[0]["current_rate"].is_number() && status[0]["trade_id"].is_number());
    let bal = b.read(ReadEndpoint::Balance).await.unwrap();
    assert!(bal["total"].is_number() && bal["starting_capital"].is_number());
    let logs = b.read(ReadEndpoint::Logs { limit: 10 }).await.unwrap();
    assert_eq!(logs["logs"][0].as_array().unwrap().len(), 5);
    let trades = b
        .read(ReadEndpoint::Trades {
            limit: 5,
            offset: 0,
        })
        .await
        .unwrap();
    assert_eq!(trades["trades"].as_array().unwrap().len(), 5);
    assert_eq!(trades["total_trades"], json!(203));
    let feat = b.features().await.unwrap();
    assert!(feat.fleet_endpoints && feat.bot_name.as_deref() == Some("fake-00"));
}

#[tokio::test]
async fn a_wrong_password_is_refused_and_a_down_bot_fails_like_a_dead_one() {
    let (f, _d) = fleet(2).await;
    let bad = client(&f, 0, "someone", "wrong");
    assert_eq!(
        bad.read(ReadEndpoint::Status).await.unwrap_err(),
        RestError::AuthFailed
    );
    f.set_mode(1, Mode::Down);
    let b = good(&f, 1);
    assert!(matches!(b.ping().await, Err(RestError::Server(503))));
    f.set_mode(1, Mode::Starting);
    let b = good(&f, 1);
    b.ping().await.unwrap();
    assert_eq!(
        b.read(ReadEndpoint::Status).await.unwrap_err(),
        RestError::Starting
    );
    f.set_mode(1, Mode::Slow(400));
    let t = std::time::Instant::now();
    good(&f, 1).ping().await.unwrap();
    assert!(t.elapsed() >= Duration::from_millis(350));
}

#[tokio::test]
async fn writes_are_recorded_and_never_executed() {
    let (f, _d) = fleet(1).await;
    let b = good(&f, 0);
    let out = b
        .write(
            WriteAction::ForceExit {
                trade_id: 201,
                ordertype: Some("limit".into()),
                amount: None,
            },
            "key-1".into(),
        )
        .await
        .unwrap();
    assert!(out.is_success());
    b.write(WriteAction::Stop, "key-2".into()).await.unwrap();
    b.write(WriteAction::DeleteTrade { trade_id: 5 }, "key-3".into())
        .await
        .unwrap();
    let w = f.stats().writes;
    let seen: Vec<(&str, &str)> = w
        .iter()
        .map(|(_, r)| (r.method.as_str(), r.path.as_str()))
        .collect();
    assert_eq!(
        seen,
        [
            ("POST", "/forceexit"),
            ("POST", "/stop"),
            ("DELETE", "/trades/5")
        ]
    );
    assert_eq!(w[0].1.body["ordertype"], json!("limit"));
    // The stop changed the state the bot reports, nothing else.
    assert_eq!(
        b.read(ReadEndpoint::ShowConfig).await.unwrap()["state"],
        json!("stopped")
    );
    assert_eq!(
        b.read(ReadEndpoint::Status)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        3,
        "a recorded forceexit closes nothing"
    );
}

#[tokio::test]
async fn the_daemon_answers_the_five_reads_and_remembers_anything_else() {
    let (f, _d) = fleet(3).await;
    let d = UnixDaemon::new(&f.manifest.daemon_socket);
    d.ping().await.unwrap();
    assert_eq!(d.summary_get(None).await.unwrap().bots.len(), 3);
    assert_eq!(d.fleet_status().await.unwrap().bots.len(), 3);
    assert!(d.fleet_events(0.0, 10).await.unwrap().events.is_empty());
    assert!(d.stats().await.unwrap().hit_rate().is_some());
    // Anything else is possible only on a raw socket, which is how a regression would look.
    let mut s = tokio::net::UnixStream::connect(&f.manifest.daemon_socket)
        .await
        .unwrap();
    s.write_all(b"{\"op\":\"some_other_op\",\"req_id\":\"x\"}\n")
        .await
        .unwrap();
    let mut line = String::new();
    BufReader::new(&mut s).read_line(&mut line).await.unwrap();
    assert!(line.contains("\"ok\":false"));
    assert_eq!(f.stats().daemon_rejected, vec!["some_other_op".to_owned()]);
    assert_eq!(f.stats().daemon_ops["summary_get"], 1);
}

#[tokio::test]
async fn the_control_protocol_drives_modes_fills_and_quits() {
    let (f, _d) = fleet(2).await;
    let (mut client_end, server_end) = tokio::io::duplex(4096);
    let (srv_r, srv_w) = tokio::io::split(server_end);
    let fleet_ref = &f;
    let driver = async {
        let (r, mut w) = tokio::io::split(&mut client_end);
        let mut lines = BufReader::new(r).lines();
        let ask = |cmd: serde_json::Value| {
            let mut text = cmd.to_string();
            text.push('\n');
            text
        };
        let mut out = Vec::new();
        for cmd in [
            json!({"cmd": "mode", "bot": 1, "mode": "down"}),
            json!({"cmd": "mode", "bot": 9, "mode": "down"}),
            json!({"cmd": "stats"}),
            json!({"cmd": "bogus"}),
            json!({"cmd": "quit"}),
        ] {
            w.write_all(ask(cmd).as_bytes()).await.unwrap();
            out.push(lines.next_line().await.unwrap().unwrap());
        }
        out
    };
    let (served, replies) = tokio::join!(serve(fleet_ref, srv_r, srv_w), driver);
    served.unwrap();
    assert!(replies[0].contains("\"ok\":true"));
    assert!(replies[1].contains("\"ok\":false"), "no such bot");
    assert!(replies[2].contains("\"stats\""));
    assert!(replies[3].contains("\"ok\":false"));
    assert!(replies[4].contains("bye"));
    assert_eq!(f.bot(1).unwrap().mode(), Mode::Down);
    assert_eq!(f.bot(0).unwrap().mode(), Mode::Up);
}

/// The closed figure of `profit_history` is the trades' own cumulated profit, as freqtrade writes
/// it: a history drifting away from the trades made the rig's drawdown jump (B280).
#[test]
fn the_profit_history_follows_the_closed_trades() {
    use fakebot::ledger::{SeedSpec, create_and_seed, open_db};
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("bot.sqlite");
    let spec = SeedSpec {
        bot_seed: 7,
        closed_trades: 300,
        open_trades: 3,
        history_days: 30,
        profit_history_every_s: 300,
        short_share: 0.5,
    };
    create_and_seed(&db, &spec, chrono::Utc::now().timestamp_millis()).unwrap();
    let conn = open_db(&db).unwrap();
    let trades: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(close_profit_abs), 0.0) FROM trades WHERE is_open = 0",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let mut stmt = conn
        .prepare("SELECT profit_closed_abs FROM profit_history ORDER BY id")
        .unwrap();
    let closed: Vec<f64> = stmt
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert!(closed.len() > 100);
    // The last sample holds every trade closed before it; later closes, if any, are few.
    let last = *closed.last().unwrap();
    assert!(
        (last - trades).abs() <= trades.abs().max(1.0) * 0.05,
        "{last} vs {trades}"
    );
    // It only moves when trades close: no step bigger than the largest single trade profit.
    let biggest: f64 = conn
        .query_row(
            "SELECT MAX(ABS(close_profit_abs)) FROM trades WHERE is_open = 0",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let max_step = closed
        .windows(2)
        .map(|w| (w[1] - w[0]).abs())
        .fold(0.0_f64, f64::max);
    assert!(
        max_step <= biggest * 20.0,
        "step {max_step}, biggest trade {biggest}"
    );
}
