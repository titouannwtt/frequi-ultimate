//! End to end: the whole gateway (engine and server) in front of 40 fake bots, over real HTTP and
//! WebSocket on ephemeral ports. Writes only ever reach the fakebots, which record them.

mod common;
mod gw_rig;

use std::collections::BTreeMap;
use std::time::Duration;

use fakebot::Mode;
use fg_core::protocol::{ChannelState, ServerFrame};
use gw_rig::{Got, Gw, Opts, UI_ORIGIN, Ws};
use reqwest::Method;
use serde_json::{Value, json};

const BOTS: usize = 40;

async fn forty() -> Gw {
    let gw = Gw::start(Opts {
        bots: BOTS,
        closed: 25,
        ..Opts::default()
    })
    .await;
    gw.wait_online(BOTS, Duration::from_secs(150)).await;
    gw
}

fn collections(snap: &Value, ch: &str) -> BTreeMap<String, BTreeMap<String, Value>> {
    serde_json::from_value(snap["channels"][ch]["collections"].clone()).expect("collections")
}

/// The fields the engine does not push on their own (a clock that moves every tick): a client
/// that applies deltas is allowed to lag on those.
fn stable(v: &Value) -> Value {
    match v {
        Value::Object(m) => Value::Object(
            m.iter()
                .filter(|(k, _)| !matches!(k.as_str(), "freshness" | "as_of_ms"))
                .map(|(k, v)| (k.clone(), stable(v)))
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(stable).collect()),
        other => other.clone(),
    }
}

fn seq_of(snap: &Value, ch: &str) -> u64 {
    snap["channels"][ch]["seq"].as_u64().expect("seq")
}

/// `X-Gw-Seq: fleet=12,positions=7` as a map.
fn header_seqs(h: &reqwest::header::HeaderMap) -> BTreeMap<String, u64> {
    h["x-gw-seq"]
        .to_str()
        .unwrap()
        .split(',')
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_owned(), v.parse().unwrap()))
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn forty_bots_converge_and_a_client_that_applies_deltas_equals_one_that_loads_the_snapshot() {
    let gw = forty().await;
    let token = gw.session("phone").await;

    // The snapshot: 40 bots, positions, consistent headers.
    let r = gw
        .req(
            Method::GET,
            "/snapshot?ch=fleet,positions,alerts,health,events",
            Some(&token),
        )
        .header("Accept-Encoding", "gzip")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let seqs = header_seqs(r.headers());
    assert_eq!(seqs.len(), 5);
    assert!(r.headers().contains_key("etag"));
    let snap0: Value = r.json().await.unwrap();
    assert_eq!(collections(&snap0, "fleet")["bots"].len(), BOTS);
    assert!(!collections(&snap0, "positions")["positions"].is_empty());
    for (ch, seq) in &seqs {
        assert_eq!(seq_of(&snap0, ch), *seq, "{ch}: header and body agree");
    }
    let scopes = &collections(&snap0, "fleet")["scopes"];
    assert!(
        scopes.contains_key("live") && scopes.contains_key("dry"),
        "modes are never mixed"
    );

    // A quiet channel revalidates with its ETag.
    let a = gw
        .req(Method::GET, "/snapshot?ch=alerts", Some(&token))
        .send()
        .await
        .unwrap();
    let etag = a.headers()["etag"].to_str().unwrap().to_owned();
    let again = gw
        .req(Method::GET, "/snapshot?ch=alerts", Some(&token))
        .header("If-None-Match", &etag)
        .send()
        .await
        .unwrap();
    assert_eq!(again.status(), 304);

    // A client that took the snapshot at `s0` and resumes from it receives every later frame, in
    // order; applying them gives what a fresh snapshot says.
    let mut ws = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
    assert_eq!(ws.auth(&token, "phone").await["t"], "authed");
    let resume: BTreeMap<String, u64> = ["fleet", "positions"]
        .iter()
        .map(|c| ((*c).to_owned(), seqs[*c]))
        .collect();
    ws.send(json!({"t": "sub", "ch": ["fleet", "positions"], "resume": resume}))
        .await;
    let subscribed = ws
        .until(Duration::from_secs(10), |v| v["t"] == "subscribed")
        .await;
    assert_eq!(subscribed.len(), 1, "`subscribed` comes before any frame");
    let heads = subscribed[0]["seq"].as_object().unwrap();
    assert!(heads["fleet"].as_u64().unwrap() >= seqs["fleet"]);

    let mut state: BTreeMap<&str, ChannelState> = BTreeMap::new();
    let mut last: BTreeMap<&str, u64> = BTreeMap::new();
    for ch in ["fleet", "positions"] {
        state.insert(
            ch,
            ChannelState {
                collections: collections(&snap0, ch),
            },
        );
        last.insert(ch, seqs[ch]);
    }
    // Let the fleet move for a few seconds, then freeze a reference snapshot.
    tokio::time::sleep(Duration::from_secs(3)).await;
    let snap1: Value = gw.get_json("/snapshot?ch=fleet,positions", &token).await;
    let target: BTreeMap<&str, u64> = ["fleet", "positions"]
        .iter()
        .map(|c| (*c, seq_of(&snap1, c)))
        .collect();
    let mut applied = 0;
    while ["fleet", "positions"].iter().any(|c| last[*c] < target[*c]) {
        let frames = ws.until(Duration::from_secs(10), |v| v["t"] == "up").await;
        for f in frames {
            let Ok(ServerFrame::Up {
                ch,
                seq,
                upsert,
                remove,
                ..
            }) = serde_json::from_value::<ServerFrame>(f.clone())
            else {
                continue;
            };
            let key = if ch == "fleet" { "fleet" } else { "positions" };
            let l = last.get_mut(key).unwrap();
            if seq <= *l {
                continue;
            }
            assert_eq!(seq, *l + 1, "{ch}: frames arrive in order, without a hole");
            if seq <= target[key] {
                state.get_mut(key).unwrap().apply(&upsert, &remove);
                applied += 1;
            }
            *l = seq;
        }
    }
    assert!(applied > 0, "the fleet moved during the test");
    for ch in ["fleet", "positions"] {
        let fresh = collections(&snap1, ch);
        assert_eq!(
            state[ch].collections.keys().collect::<Vec<_>>(),
            fresh.keys().collect::<Vec<_>>(),
            "{ch}: same collections"
        );
        for (coll, entities) in &fresh {
            let mine = &state[ch].collections[coll];
            assert_eq!(mine.len(), entities.len(), "{ch}.{coll}: same entities");
            for (k, v) in entities {
                assert_eq!(stable(&mine[k]), stable(v), "{ch}.{coll}.{k}");
            }
        }
    }
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn events_reach_clients_and_a_resume_replays_exactly_what_was_missed() {
    let gw = Gw::start(Opts {
        bots: 3,
        ..Opts::default()
    })
    .await;
    gw.wait_online(3, Duration::from_secs(60)).await;
    let token = gw.session("phone").await;
    let fill = |id: i64| {
        gw.fleet.bot(1).unwrap().push(
            "entry_fill",
            &json!({"trade_id": id, "pair": "ETH/USDC:USDC", "profit_amount": 0.0}),
        );
    };

    let mut ws = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
    ws.auth(&token, "phone").await;
    ws.send(json!({"t": "sub", "ch": ["events"], "resume": {}}))
        .await;
    let sub = ws
        .until(Duration::from_secs(5), |v| v["t"] == "subscribed")
        .await;
    let head = sub[0]["seq"]["events"].as_u64().unwrap();
    for id in [7001, 7002, 7003] {
        fill(id);
    }
    let mut seen: Vec<(u64, i64)> = Vec::new();
    let mut last_seq = head;
    while seen.len() < 3 {
        let f = ws
            .until(Duration::from_secs(5), |v| v["t"] == "ev")
            .await
            .pop()
            .unwrap();
        let seq = f["seq"].as_u64().unwrap();
        assert_eq!(seq, last_seq + 1, "events arrive in order");
        last_seq = seq;
        if let Some(id) = f["data"]["trade_id"]
            .as_i64()
            .filter(|i| (7001..7004).contains(i))
        {
            seen.push((seq, id));
        }
    }
    assert_eq!(
        seen.iter().map(|s| s.1).collect::<Vec<_>>(),
        vec![7001, 7002, 7003]
    );
    drop(ws);

    // Two more while the client is away.
    for id in [7004, 7005] {
        fill(id);
    }
    tokio::time::sleep(Duration::from_millis(500)).await;

    // It comes back with the sequence number it had applied: it gets what it missed, no resync.
    let mut ws = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
    ws.auth(&token, "phone").await;
    ws.send(json!({"t": "sub", "ch": ["events"], "resume": {"events": last_seq}}))
        .await;
    let mut got = Vec::new();
    let mut expect = last_seq;
    while got.len() < 2 {
        let f = match ws.next(Duration::from_secs(5)).await {
            Some(Got::Json(v)) => v,
            other => panic!("no frame: {}", other.is_some()),
        };
        assert_ne!(f["t"], "resync", "{f}");
        if f["t"] == "ev" {
            let seq = f["seq"].as_u64().unwrap();
            assert_eq!(seq, expect + 1, "no hole, no duplicate");
            expect = seq;
            if let Some(id) = f["data"]["trade_id"]
                .as_i64()
                .filter(|i| (7004..7006).contains(i))
            {
                got.push(id);
            }
        }
    }
    assert_eq!(got, vec![7004, 7005]);
    drop(ws);

    // A resume the buffer cannot honour is told to reload: far behind, a previous gateway
    // incarnation (a small number), or ahead of the server.
    for bogus in [last_seq.saturating_sub(100_000), 5, last_seq + 1_000_000] {
        let mut ws = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
        ws.auth(&token, "phone").await;
        ws.send(json!({"t": "sub", "ch": ["events"], "resume": {"events": bogus}}))
            .await;
        let frames = ws
            .until(Duration::from_secs(5), |v| v["t"] == "resync")
            .await;
        assert_eq!(frames.last().unwrap()["ch"], "events");
        assert_eq!(
            frames.last().unwrap()["reason"],
            "stale_resume",
            "resume {bogus}"
        );
    }

    // Unsubscribe stops the flow; a ping gets a heartbeat; garbage gets an error, not a crash.
    let mut ws = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
    ws.auth(&token, "phone").await;
    ws.send(json!({"t": "sub", "ch": ["events"], "resume": {}}))
        .await;
    ws.until(Duration::from_secs(5), |v| v["t"] == "subscribed")
        .await;
    ws.send(json!({"t": "unsub", "ch": ["events"]})).await;
    ws.send(json!({"t": "ping", "ts": 1})).await;
    ws.until(Duration::from_secs(5), |v| v["t"] == "hb").await;
    fill(7100);
    ws.send(json!({"t": "sub", "ch": ["no-such-channel"], "resume": {}}))
        .await;
    let e = ws.until(Duration::from_secs(5), |v| v["t"] == "err").await;
    assert_eq!(e.last().unwrap()["code"], "unknown_channel");
    assert!(
        e.iter().all(|f| f["t"] != "ev"),
        "no event after unsubscribe: {e:?}"
    );
    ws.send(json!({"nonsense": true})).await;
    let e = ws.until(Duration::from_secs(5), |v| v["t"] == "err").await;
    assert_eq!(e.last().unwrap()["code"], "bad_request");
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn a_revoked_session_is_cut_off_at_once() {
    let gw = Gw::start(Opts {
        bots: 2,
        ..Opts::default()
    })
    .await;
    let a = gw.session("phone").await;
    let b = gw.session("laptop").await;
    let mut wa = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
    wa.auth(&a, "phone").await;
    let mut wb = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
    wb.auth(&b, "laptop").await;
    wb.send(json!({"t": "sub", "ch": ["health"], "resume": {}}))
        .await;
    wb.until(Duration::from_secs(5), |v| v["t"] == "subscribed")
        .await;

    // The phone revokes the laptop: its socket closes at once with 4401, the phone's stays open.
    let list = gw.get_json("/sessions", &a).await;
    let laptop = list["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["device_id"] == "laptop")
        .expect("the laptop session is listed")["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        gw.req(Method::DELETE, &format!("/sessions/{laptop}"), Some(&a))
            .send()
            .await
            .unwrap()
            .status(),
        204
    );
    loop {
        match wb.next(Duration::from_secs(5)).await {
            Some(Got::Closed(code)) => {
                assert_eq!(code, Some(4401));
                break;
            }
            Some(Got::Json(_)) => {}
            None => panic!("the revoked socket stayed open"),
        }
    }
    assert_eq!(
        gw.req(Method::GET, "/snapshot?ch=health", Some(&b))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        gw.req(Method::GET, "/snapshot?ch=health", Some(&a))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    wa.send(json!({"t": "ping", "ts": 1})).await;
    wa.until(Duration::from_secs(5), |v| v["t"] == "hb").await;
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn every_read_route_answers_on_a_full_fleet() {
    let gw = forty().await;
    let token = gw.session("phone").await;
    let live = (0..BOTS).find(|i| gw.fleet.manifest.bots[*i].live).unwrap();
    let key = gw.key(live);

    // The routes that carry the pages, with their expected shape.
    let health = gw.get_json("/health", &token).await;
    assert_eq!(health["bots"]["total"], BOTS);
    assert!(health["health"]["level"].is_string());
    let bots = gw.get_json("/bots", &token).await;
    assert_eq!(bots["bots"].as_array().unwrap().len(), BOTS);
    assert_eq!(
        gw.get_json("/bots/discovered", &token).await["discovered"]
            .as_array()
            .unwrap()
            .len(),
        BOTS
    );

    // The ledgers load a little after the bots come online.
    let started = std::time::Instant::now();
    while gw.get_json("/trades?limit=1&mode=live", &token).await["matched"]
        .as_u64()
        .unwrap_or(0)
        <= 20
    {
        assert!(
            started.elapsed() < Duration::from_secs(90),
            "the ledgers never loaded"
        );
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    let trades = gw
        .get_json("/trades?status=closed&limit=20&mode=live", &token)
        .await;
    assert_eq!(trades["rows"].as_array().unwrap().len(), 20);
    assert!(trades["matched"].as_u64().unwrap() > 20);
    assert!(trades["totals"].is_object());
    let cursor = trades["next_cursor"]
        .as_str()
        .expect("a next page")
        .to_owned();
    let page2 = gw
        .get_json(
            &format!(
                "/trades?status=closed&limit=20&mode=live&cursor={}",
                cursor.replace('|', "%7C")
            ),
            &token,
        )
        .await;
    let ids = |v: &Value| -> Vec<String> {
        v["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| format!("{}/{}", r["bot_key"], r["trade_id"]))
            .collect()
    };
    assert!(
        ids(&trades).iter().all(|i| !ids(&page2).contains(i)),
        "pages do not overlap"
    );
    let open = gw.get_json("/trades?status=open", &token).await;
    assert!(!open["open"].as_array().unwrap().is_empty());

    let one = &trades["rows"][0];
    let detail = gw
        .get_json(
            &format!(
                "/trades/{}/{}",
                one["bot_key"].as_str().unwrap(),
                one["trade_id"]
            ),
            &token,
        )
        .await;
    assert_eq!(detail["trade"]["trade_id"], one["trade_id"]);
    assert_eq!(detail["orders_error"], false);

    let csv = gw
        .req(Method::GET, "/trades/export.csv?mode=live", Some(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(csv.status(), 200);
    assert!(
        csv.headers()["content-type"]
            .to_str()
            .unwrap()
            .starts_with("text/csv")
    );
    let csv = csv.text().await.unwrap();
    let mut lines = csv.lines();
    assert!(
        lines
            .next()
            .unwrap()
            .starts_with("bot_key,trade_id,pair,side,mode")
    );
    assert_eq!(
        lines.count() as u64,
        gw.get_json("/trades?mode=live&limit=1", &token).await["matched"]
            .as_u64()
            .unwrap()
    );

    for scope in ["live", "dry"] {
        let cal = gw
            .get_json(&format!("/pnl/periods?scope={scope}&unit=day&n=30"), &token)
            .await;
        assert_eq!(cal["tz"], "Europe/Paris");
        assert!(!cal["buckets"].as_array().unwrap().is_empty());
        let eq = gw
            .get_json(
                &format!("/equity?scope={scope}&points=50&mode=realized"),
                &token,
            )
            .await;
        assert!(eq["points"].as_array().unwrap().len() <= 50);
        let dd = gw
            .get_json(&format!("/drawdown?scope={scope}"), &token)
            .await;
        assert!(dd["realized"].is_object() && dd["with_open"].is_object());
        let risk = gw.get_json(&format!("/risk?scope={scope}"), &token).await;
        assert!(risk["exposure"]["net"].is_number());
        let lb = gw
            .get_json(&format!("/leaderboard?scope={scope}&period=7d"), &token)
            .await;
        assert!(lb["rows"].is_array());
        let sc = gw.get_json(&format!("/scope/{scope}"), &token).await;
        assert_eq!(sc["kind"], "mode");
    }
    assert_eq!(gw.get_json("/scope/fleet", &token).await["bots"], BOTS);
    let bot_scope = gw.get_json(&format!("/scope/bot:{key}"), &token).await;
    assert_eq!(bot_scope["bots"].as_array().unwrap().len(), 1);
    // Mixed scopes are refused, not summed.
    let mixed = gw
        .req(
            Method::GET,
            &format!("/equity?bots={},{}", gw.key(0), gw.key(1)),
            Some(&token),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(mixed.status(), 400, "bot 0 is live and bot 1 is dry");
    assert_eq!(
        gw.req(Method::GET, "/equity?scope=fleet", Some(&token))
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        gw.req(Method::GET, "/pnl/periods?tz=Asia/Tokyo", Some(&token))
            .send()
            .await
            .unwrap()
            .status(),
        400
    );

    let pairs = gw.get_json(&format!("/pairs/{key}"), &token).await;
    assert!(pairs["whitelist"].is_array());
    assert!(gw.get_json("/events?since=0", &token).await["events"].is_array());
    assert!(gw.get_json("/logs?level=info", &token).await["lines"].is_array());
    assert!(gw.get_json("/market", &token).await["tickers"].is_array());
    assert!(gw.get_json("/alerts", &token).await["alerts"].is_array());
    assert!(gw.get_json("/alerts/rules", &token).await["global"].is_object());
    assert!(gw.get_json("/audit", &token).await["entries"].is_array());
    assert!(gw.get_json("/prefs", &token).await["docs"].is_array());
    assert_eq!(
        gw.get_json(&format!("/health/rate?bot={key}"), &token)
            .await["proxied"],
        "/rate_metrics"
    );

    // The registry is the discovery of the host: the writes of a remote registry say so.
    for (m, p) in [
        (Method::POST, "/bots".to_owned()),
        (Method::PATCH, format!("/bots/{key}")),
        (Method::DELETE, format!("/bots/{key}")),
        (Method::POST, format!("/bots/{key}/credentials")),
    ] {
        let r = gw
            .req(m.clone(), &p, Some(&token))
            .json(&json!({}))
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 501, "{m} {p}");
    }

    // Reading never wrote anything to a bot.
    for i in 0..BOTS {
        assert!(gw.fleet.bot(i).unwrap().writes().is_empty(), "bot {i}");
    }
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn preferences_follow_the_user_across_devices_and_groups_resolve_from_them() {
    let gw = Gw::start(Opts {
        bots: 8,
        ..Opts::default()
    })
    .await;
    gw.wait_online(8, Duration::from_secs(60)).await;
    let phone = gw.session("phone").await;
    let laptop = gw.session("laptop").await;
    // Bots 0 and 4 are live, 1 is dry (see the fakebot fleet).
    let groups = json!({"groups": {"core": [gw.key(0), gw.key(4)], "mixed": [gw.key(0), gw.key(1)]}, "columns": ["pair"]});

    let put = |tok: &str, scope: &str, if_match: Option<&str>, body: &Value| {
        let mut rb = gw
            .req(Method::PUT, &format!("/prefs{scope}"), Some(tok))
            .json(body);
        if let Some(m) = if_match {
            rb = rb.header("If-Match", m);
        }
        rb.send()
    };
    let r = put(&phone, "", None, &groups).await.unwrap();
    assert_eq!(r.status(), 200);
    assert_eq!(r.headers()["etag"], "\"1\"");
    let doc: Value = r.json().await.unwrap();
    assert_eq!(doc["version"], 1);

    // The laptop reads what the phone wrote.
    let got = gw
        .req(Method::GET, "/prefs?scope=", Some(&laptop))
        .send()
        .await
        .unwrap();
    assert_eq!(got.status(), 200);
    assert_eq!(got.json::<Value>().await.unwrap()["data"], groups);

    // Both edit from version 1: the first wins, the second is told to reload.
    let mut next = groups.clone();
    next["columns"] = json!(["pair", "profit"]);
    assert_eq!(
        put(&laptop, "", Some("\"1\""), &next)
            .await
            .unwrap()
            .status(),
        200
    );
    let stale = put(&phone, "", Some("\"1\""), &groups).await.unwrap();
    assert_eq!(stale.status(), 409);
    assert_eq!(
        stale.json::<Value>().await.unwrap()["code"],
        "state_mismatch"
    );

    // Per-bot preferences are keyed by bot_key; a device alias never reaches the store.
    assert_eq!(
        put(
            &phone,
            &format!("?scope={}", gw.key(0)),
            None,
            &json!({"icon": "x"})
        )
        .await
        .unwrap()
        .status(),
        200
    );
    assert_eq!(
        put(&phone, "?scope=ftbot.3", None, &json!({}))
            .await
            .unwrap()
            .status(),
        400
    );

    // A first bootstrap seeds the preferences; later ones never overwrite them.
    let mut body = gw.bootstrap_body(&[0], "tablet").await;
    body["prefs"] = json!({"groups": {}, "evil": true});
    let r = gw
        .http
        .post(gw.url("/session/bootstrap"))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    assert_eq!(gw.get_json("/prefs?scope=", &phone).await["data"], next);

    // A group defined there is a scope; a group of mixed modes is refused.
    let core = gw.get_json("/scope/group:core", &phone).await;
    assert_eq!(core["kind"], "group");
    assert_eq!(core["bots"].as_array().unwrap().len(), 2);
    let eq = gw
        .req(
            Method::GET,
            "/equity?scope=group:core&mode=realized",
            Some(&phone),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(eq.status(), 200);
    assert_eq!(
        gw.req(Method::GET, "/equity?scope=group:mixed", Some(&phone))
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        gw.req(Method::GET, "/equity?scope=group:nope", Some(&phone))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    assert_eq!(
        gw.req(
            Method::DELETE,
            &format!("/prefs?scope={}", gw.key(0)),
            Some(&phone)
        )
        .send()
        .await
        .unwrap()
        .status(),
        204
    );
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn alerts_follow_a_bot_going_down_and_can_be_acknowledged_silenced_and_configured() {
    let gw = Gw::start(Opts {
        bots: 3,
        ..Opts::default()
    })
    .await;
    gw.wait_online(3, Duration::from_secs(60)).await;
    let token = gw.session("phone").await;

    let mut ws = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
    ws.auth(&token, "phone").await;
    ws.send(json!({"t": "sub", "ch": ["alerts"], "resume": {}}))
        .await;
    ws.until(Duration::from_secs(5), |v| v["t"] == "subscribed")
        .await;

    gw.fleet.set_mode(2, Mode::Down);
    let key = gw.key(2);
    let started = std::time::Instant::now();
    let alert = loop {
        let list = gw.get_json("/alerts?state=active", &token).await;
        if let Some(a) = list["alerts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["type_id"] == "botOffline" && a["bot_key"] == key.as_str())
        {
            break a.clone();
        }
        assert!(
            started.elapsed() < Duration::from_secs(90),
            "no botOffline alert"
        );
        tokio::time::sleep(Duration::from_millis(300)).await;
    };
    assert_eq!(alert["severity"], "critical");
    // The same alert came over the WebSocket.
    ws.until(Duration::from_secs(10), |v| {
        v["t"] == "up" && v["upsert"]["alerts"].is_object()
    })
    .await;

    // A write to a bot that is down is refused up front, not sent into the void.
    let r = gw
        .req(
            Method::POST,
            &format!("/bots/{key}/actions/start"),
            Some(&token),
        )
        .header("Idempotency-Key", "down-1")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 502);
    assert_eq!(r.json::<Value>().await.unwrap()["code"], "bot_unreachable");
    assert!(gw.fleet.bot(2).unwrap().writes().is_empty());

    // Acknowledge; it shows as acked, and a stranger's id is a 404.
    let id = alert["id"].as_str().unwrap();
    assert_eq!(
        gw.req(Method::POST, &format!("/alerts/{id}/ack"), Some(&token))
            .send()
            .await
            .unwrap()
            .status(),
        204
    );
    assert_eq!(
        gw.req(Method::POST, "/alerts/nope/ack", Some(&token))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );
    let acked = gw.get_json("/alerts?state=acked", &token).await;
    assert!(
        acked["alerts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["id"] == id)
    );

    // Silence the rule for that bot, then lift it.
    let s = gw
        .req(Method::POST, "/alerts/silence", Some(&token))
        .json(&json!({"type_id": "botOffline", "bot_key": key, "duration_s": 3600}))
        .send()
        .await
        .unwrap();
    assert_eq!(s.status(), 201);
    let sid = s.json::<Value>().await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        gw.req(Method::POST, "/alerts/silence", Some(&token))
            .json(&json!({"type_id": "botOffline"}))
            .send()
            .await
            .unwrap()
            .status(),
        400,
        "a silence needs an end"
    );
    assert_eq!(
        gw.req(
            Method::DELETE,
            &format!("/alerts/silence/{sid}"),
            Some(&token)
        )
        .send()
        .await
        .unwrap()
        .status(),
        204
    );
    assert_eq!(
        gw.req(
            Method::DELETE,
            &format!("/alerts/silence/{sid}"),
            Some(&token)
        )
        .send()
        .await
        .unwrap()
        .status(),
        404
    );

    // The rules round-trip.
    let mut rules = gw.get_json("/alerts/rules", &token).await;
    rules["global"]["capacityFull"] = json!({"enabled": false});
    let put = gw
        .req(Method::PUT, "/alerts/rules", Some(&token))
        .json(&rules)
        .send()
        .await
        .unwrap();
    assert_eq!(put.status(), 204);
    assert_eq!(
        gw.get_json("/alerts/rules", &token).await["global"]["capacityFull"]["enabled"],
        false
    );

    // The bot comes back; the alert resolves.
    gw.fleet.set_mode(2, Mode::Up);
    let started = std::time::Instant::now();
    loop {
        let list = gw.get_json("/alerts?state=active", &token).await;
        if !list["alerts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["type_id"] == "botOffline" && a["bot_key"] == key.as_str())
        {
            break;
        }
        assert!(
            started.elapsed() < Duration::from_secs(120),
            "the alert never resolved"
        );
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn a_stopping_gateway_closes_its_sockets_with_going_away() {
    let gw = Gw::start(Opts {
        bots: 2,
        ..Opts::default()
    })
    .await;
    let token = gw.session("phone").await;
    let mut ws = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
    ws.auth(&token, "phone").await;
    ws.send(json!({"t": "sub", "ch": ["health"], "resume": {}}))
        .await;
    ws.until(Duration::from_secs(5), |v| v["t"] == "subscribed")
        .await;

    let Gw { server, engine, .. } = gw;
    let started = std::time::Instant::now();
    let stopper = tokio::spawn(async move {
        server.shutdown().await;
        engine.shutdown().await;
    });
    loop {
        match ws.next(Duration::from_secs(10)).await {
            Some(Got::Closed(code)) => {
                assert_eq!(code, Some(1001));
                break;
            }
            Some(Got::Json(_)) => {}
            None => panic!("the socket was never closed"),
        }
    }
    stopper.await.unwrap();
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "stopped in {:?}",
        started.elapsed()
    );
}
