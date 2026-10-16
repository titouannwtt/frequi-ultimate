//! The chart relay end to end: a client subscribes to `chart:<bot>:<pair>:<tf>` over the WebSocket
//! of the gateway and receives the candles that the gateway reads from the fake bot, once for all
//! its clients, until the last one leaves.

mod common;
mod gw_rig;

use std::collections::BTreeMap;
use std::time::Duration;

use fg_core::protocol::{ChannelState, ServerFrame};
use gw_rig::{Gw, Opts, UI_ORIGIN, Ws};
use serde_json::{Value, json};

fn candle_reads(gw: &Gw, i: usize) -> u64 {
    gw.fleet
        .bot(i)
        .unwrap()
        .route_counts()
        .get("GET /pair_candles")
        .copied()
        .unwrap_or(0)
}

fn without_as_of(
    mut c: BTreeMap<String, BTreeMap<String, Value>>,
) -> BTreeMap<String, BTreeMap<String, Value>> {
    if let Some(meta) = c.get_mut("chart").and_then(|m| m.get_mut("meta")) {
        meta["freshness"]["as_of_ms"] = json!(0);
    }
    c
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn a_chart_is_relayed_once_for_every_client_and_stops_with_the_last_one() {
    let gw = Gw::start(Opts {
        bots: 3,
        ..Opts::default()
    })
    .await;
    gw.wait_online(3, Duration::from_secs(60)).await;
    let token = gw.session("phone").await;
    let chart = format!("chart:{}:BTC/USDC:USDC:5m", gw.key(1));

    // Nobody holds it: no read, an empty snapshot.
    let idle = gw.get_json(&format!("/snapshot?ch={chart}"), &token).await;
    assert!(
        idle["channels"][&chart]["collections"]
            .as_object()
            .unwrap()
            .is_empty()
    );
    assert_eq!(candle_reads(&gw, 1), 0);

    // Two clients on the same chart.
    let mut a = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
    a.auth(&token, "phone").await;
    let mut b = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
    b.auth(&token, "laptop").await;
    for ws in [&mut a, &mut b] {
        ws.send(json!({"t": "sub", "ch": [chart], "resume": {}}))
            .await;
        ws.until(Duration::from_secs(5), |v| v["t"] == "subscribed")
            .await;
    }
    let mut state = ChannelState::default();
    let mut last = 0;
    // The first frame carries the whole window.
    loop {
        let frames = a.until(Duration::from_secs(10), |v| v["t"] == "up").await;
        let f: ServerFrame = serde_json::from_value(frames.last().unwrap().clone()).unwrap();
        if let ServerFrame::Up {
            seq,
            upsert,
            remove,
            ..
        } = f
        {
            state.apply(&upsert, &remove);
            last = seq;
        }
        if state
            .collections
            .get("candles")
            .is_some_and(|c| c.len() >= 150)
        {
            break;
        }
    }
    let candles = &state.collections["candles"];
    assert_eq!(candles.len(), 150);
    let any = candles.values().next().unwrap();
    for k in ["t", "o", "h", "l", "c", "v"] {
        assert!(any.get(k).is_some(), "{k} in {any}");
    }
    assert!(any.get("rsi").is_none(), "indicator columns do not travel");
    assert_eq!(state.collections["chart"]["meta"]["timeframe"], "5m");

    // The snapshot agrees with what the frames built.
    tokio::time::sleep(Duration::from_secs(2)).await;
    let snap = gw.get_json(&format!("/snapshot?ch={chart}"), &token).await;
    let seq = snap["channels"][&chart]["seq"].as_u64().unwrap();
    assert!(seq >= last);
    let from_snapshot: BTreeMap<String, BTreeMap<String, Value>> =
        serde_json::from_value(snap["channels"][&chart]["collections"].clone()).unwrap();
    assert_eq!(from_snapshot["candles"].len(), 150);
    assert_eq!(from_snapshot["chart"]["meta"]["freshness"]["stale"], false);
    // Catch the client up to the snapshot, then compare.
    loop {
        let Some(Ok(f)) = a.next(Duration::from_millis(300)).await.map(|g| match g {
            gw_rig::Got::Json(v) => Ok(v),
            gw_rig::Got::Closed(_) => Err(()),
        }) else {
            break;
        };
        if let Ok(ServerFrame::Up {
            seq: s,
            upsert,
            remove,
            ..
        }) = serde_json::from_value::<ServerFrame>(f)
            && s <= seq
        {
            state.apply(&upsert, &remove);
        }
    }
    assert_eq!(
        without_as_of(state.collections.clone()),
        without_as_of(from_snapshot)
    );

    // Two clients, one poller: 5 minutes of timeframe is a read every 25 s, 1.25 s with time
    // compressed 20 times (0.8 a second); two pollers would make 1.6.
    let r0 = candle_reads(&gw, 1);
    tokio::time::sleep(Duration::from_secs(3)).await;
    let rate = (candle_reads(&gw, 1) - r0) as f64 / 3.0;
    assert!(rate > 0.4 && rate < 1.2, "{rate} reads per second");
    // The other bots are left alone.
    assert_eq!(candle_reads(&gw, 0), 0);
    assert_eq!(candle_reads(&gw, 2), 0);

    // One client leaves: the relay goes on. Both leave: it stops after the hold-over.
    drop(a);
    tokio::time::sleep(Duration::from_secs(1)).await;
    let r1 = candle_reads(&gw, 1);
    tokio::time::sleep(Duration::from_millis(2_700)).await;
    assert!(
        candle_reads(&gw, 1) > r1,
        "the other client still gets its chart"
    );
    drop(b);
    tokio::time::sleep(Duration::from_secs(5)).await;
    let stopped = candle_reads(&gw, 1);
    tokio::time::sleep(Duration::from_secs(3)).await;
    assert_eq!(
        candle_reads(&gw, 1),
        stopped,
        "no read for a chart nobody holds"
    );
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn a_malformed_or_unknown_chart_is_an_error_frame_not_a_poller() {
    let gw = Gw::start(Opts {
        bots: 2,
        ..Opts::default()
    })
    .await;
    gw.wait_online(2, Duration::from_secs(60)).await;
    let token = gw.session("phone").await;
    let mut ws = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
    ws.auth(&token, "phone").await;
    for (ch, code) in [
        (format!("chart:{}:BTC&x=1:5m", gw.key(0)), "bad_request"),
        (
            format!("chart:{}:BTC/USDC:USDC:5 m", gw.key(0)),
            "bad_request",
        ),
        ("chart:local:1:BTC/USDC:USDC:5m".to_owned(), "forbidden"),
    ] {
        ws.send(json!({"t": "sub", "ch": [ch], "resume": {}})).await;
        let e = ws.until(Duration::from_secs(5), |v| v["t"] == "err").await;
        assert_eq!(e.last().unwrap()["code"], code, "{ch}");
    }
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert_eq!(candle_reads(&gw, 0), 0);
    gw.stop().await;
}

/// B108: one connection could hold every chart of the relay (16 for all clients together).
#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn one_connection_cannot_hold_more_than_eight_charts() {
    let gw = Gw::start(Opts {
        bots: 2,
        ..Opts::default()
    })
    .await;
    gw.wait_online(2, Duration::from_secs(60)).await;
    let token = gw.session("phone").await;
    let mut ws = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
    ws.auth(&token, "phone").await;
    let chart = |i: usize| format!("chart:{}:C{i}/USDC:USDC:1h", gw.key(0));
    let first: Vec<String> = (0..8).map(chart).collect();
    ws.send(json!({"t": "sub", "ch": first, "resume": {}}))
        .await;
    ws.until(Duration::from_secs(10), |v| v["t"] == "subscribed")
        .await;
    // The ninth is refused, and so is a batch that would go past the cap.
    for ch in [vec![chart(8)], vec![chart(9), chart(10)]] {
        ws.send(json!({"t": "sub", "ch": ch, "resume": {}})).await;
        let e = ws.until(Duration::from_secs(5), |v| v["t"] == "err").await;
        assert_eq!(e.last().unwrap()["code"], "bad_request");
    }
    // Joining again a chart already held does not count.
    ws.send(json!({"t": "sub", "ch": [chart(0)], "resume": {}}))
        .await;
    ws.until(Duration::from_secs(10), |v| v["t"] == "subscribed")
        .await;
    // Leaving one makes room.
    ws.send(json!({"t": "unsub", "ch": [chart(0)]})).await;
    ws.send(json!({"t": "sub", "ch": [chart(8)], "resume": {}}))
        .await;
    ws.until(Duration::from_secs(10), |v| v["t"] == "subscribed")
        .await;
    gw.stop().await;
}
