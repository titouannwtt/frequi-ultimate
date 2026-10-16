//! Security tests of the gateway server against fake bots, over real HTTP/WebSocket on ephemeral
//! ports. Writes only ever reach the fakebot, which records them and does nothing.
//!
//! * unauthenticated access to every route is refused (table built from the router itself);
//! * CORS answers only for the configured UI origins, and a foreign `Origin` is refused;
//! * login and bootstrap are rate limited and lock an address out;
//! * an idempotent replay returns the first result without a second call to the bot;
//! * the passthrough refuses what is not whitelisted, whatever the encoding;
//! * the session scope keeps a session out of bots it has no proof for.

mod common;
mod gw_rig;

use std::collections::BTreeSet;
use std::time::Duration;

use fg_server::config::AuthMode;
use gw_rig::{Got, Gw, Opts, UI_ORIGIN, Ws};
use reqwest::Method;
use serde_json::{Value, json};

const PW: &str = "correct horse battery";
const BOT_PASSWORD: &str = "fake-pass";

fn fill(path: &str) -> String {
    path.replace("{*rest}", "pair_candles")
        .replace("{key}", "local:1")
        .replace("{id}", "x")
        .replace("{trade_id}", "1")
        .replace("{scope}", "live")
        .replace("{action}", "stop")
}

fn method_of(m: &str) -> Method {
    if m == "ANY" {
        Method::GET
    } else {
        Method::from_bytes(m.as_bytes()).expect("method")
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn every_route_but_the_public_ones_refuses_a_stranger() {
    let gw = Gw::start(Opts {
        bots: 2,
        ..Opts::default()
    })
    .await;
    let valid = gw.session("d1").await;

    let public: BTreeSet<(String, String)> = gw
        .server
        .routes
        .iter()
        .filter(|r| r.public)
        .map(|r| (r.method.to_owned(), r.path.clone()))
        .collect();
    let expected: BTreeSet<(String, String)> = [
        ("GET", "/gw/v1/hello"),
        ("POST", "/gw/v1/session/bootstrap"),
        ("POST", "/gw/v1/session/login"),
        ("GET", "/gw/v1/ws"),
    ]
    .iter()
    .map(|(m, p)| ((*m).to_owned(), (*p).to_owned()))
    .collect();
    assert_eq!(
        public, expected,
        "the public surface is exactly these four routes"
    );

    let guarded: Vec<_> = gw.server.routes.iter().filter(|r| !r.public).collect();
    assert!(guarded.len() >= 35, "{} protected routes", guarded.len());

    let wrong_headers: Vec<Option<String>> = vec![
        None,
        Some("Bearer".into()),
        Some("Bearer ".into()),
        Some("Bearer fgs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".into()),
        Some(format!("Bearer {valid}x")),
        Some(format!("Bearer {}", &valid[..valid.len() - 1])),
        Some(valid.clone()),
        Some(format!("Basic {valid}")),
        Some("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln".into()),
    ];
    let mut checked = 0;
    for r in &guarded {
        let m = method_of(r.method);
        let path = fill(&r.path);
        let url = format!("http://{}{path}", gw.server.addr);
        for h in &wrong_headers {
            let mut rb = gw.http.request(m.clone(), &url);
            if let Some(h) = h {
                rb = rb.header("Authorization", h);
            }
            if m != Method::GET && m != Method::DELETE {
                rb = rb.json(&json!({}));
            }
            let resp = rb.send().await.expect("send");
            assert_eq!(resp.status(), 401, "{} {path} with {h:?}", r.method);
            let body: Value = resp.json().await.expect("json error body");
            assert_eq!(body["code"], "unauthorized", "{} {path}", r.method);
            checked += 1;
        }
        // A valid token in the query string is not a credential.
        let q = gw
            .http
            .request(m.clone(), format!("{url}?token={valid}"))
            .send()
            .await
            .expect("send");
        assert_eq!(
            q.status(),
            401,
            "{} {path} with the token in the query",
            r.method
        );
        checked += 1;
    }
    assert!(checked > 300, "{checked} unauthenticated requests refused");

    // Unknown paths do not reveal what exists: 401 to a stranger, 404 to a session.
    let stranger = gw
        .req(Method::GET, "/no/such/route", None)
        .send()
        .await
        .unwrap();
    assert_eq!(stranger.status(), 401);
    let member = gw
        .req(Method::GET, "/no/such/route", Some(&valid))
        .send()
        .await
        .unwrap();
    assert_eq!(member.status(), 404);
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn hello_says_nothing_about_the_fleet() {
    let gw = Gw::start(Opts {
        bots: 2,
        ..Opts::default()
    })
    .await;
    let v: Value = gw
        .req(Method::GET, "/hello", None)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let keys: BTreeSet<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(
        keys,
        BTreeSet::from([
            "service",
            "version",
            "protocol",
            "auth_modes",
            "hb_interval_s",
            "server_time_ms"
        ])
    );
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cors_answers_only_for_the_configured_ui_origin() {
    let gw = Gw::start(Opts {
        bots: 1,
        ..Opts::default()
    })
    .await;
    let preflight = |origin: &'static str| {
        gw.http
            .request(Method::OPTIONS, gw.url("/session/bootstrap"))
            .header("Origin", origin)
            .header("Access-Control-Request-Method", "POST")
            .header(
                "Access-Control-Request-Headers",
                "authorization,content-type,idempotency-key,if-match",
            )
            .send()
    };
    let ok = preflight(UI_ORIGIN).await.unwrap();
    assert!(ok.status().is_success(), "{}", ok.status());
    let h = ok.headers();
    assert_eq!(h["access-control-allow-origin"], UI_ORIGIN);
    let methods = h["access-control-allow-methods"].to_str().unwrap();
    for m in ["GET", "POST", "PUT", "PATCH", "DELETE"] {
        assert!(methods.contains(m), "{methods}");
    }
    let headers = h["access-control-allow-headers"]
        .to_str()
        .unwrap()
        .to_ascii_lowercase();
    for name in [
        "authorization",
        "content-type",
        "idempotency-key",
        "if-match",
        "if-none-match",
    ] {
        assert!(headers.contains(name), "{headers}");
    }
    assert_eq!(h["access-control-max-age"], "600");
    assert!(
        !h.contains_key("access-control-allow-credentials"),
        "bearer auth: no credentials mode"
    );

    for evil in [
        "http://evil.example",
        "http://ui.example.test:9401",
        "null",
        "https://ui.example.test:9400",
    ] {
        let r = preflight(evil).await.unwrap();
        assert!(
            !r.headers().contains_key("access-control-allow-origin"),
            "{evil} must not be allowed: {:?}",
            r.headers()
        );
    }

    // A real request from the UI is answered and exposes the headers the client needs.
    let r = gw
        .req(Method::GET, "/hello", None)
        .header("Origin", UI_ORIGIN)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    assert_eq!(r.headers()["access-control-allow-origin"], UI_ORIGIN);

    // A request that carries a foreign Origin is refused outright, reads and writes alike.
    for (method, path) in [
        (Method::GET, "/hello"),
        (Method::POST, "/session/login"),
        (Method::POST, "/session/bootstrap"),
        (Method::GET, "/snapshot"),
    ] {
        let r = gw
            .req(method.clone(), path, None)
            .header("Origin", "http://evil.example")
            .json(&json!({}))
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 403, "{method} {path}");
        assert!(!r.headers().contains_key("access-control-allow-origin"));
        let b: Value = r.json().await.unwrap();
        assert_eq!(b["code"], "origin_not_allowed");
    }
    let r = gw
        .req(Method::GET, "/hello", None)
        .header("Origin", "null")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403);

    // A write from a foreign origin is refused even with a valid session.
    let token = gw.session("d1").await;
    let r = gw
        .req(
            Method::POST,
            &format!("/bots/{}/actions/start", gw.key(0)),
            Some(&token),
        )
        .header("Origin", "http://evil.example")
        .header("Idempotency-Key", "k-evil")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403);
    assert!(
        gw.fleet.bot(0).unwrap().writes().is_empty(),
        "nothing reached the bot"
    );

    // WebSocket: the close code a browser can read.
    let mut ws = Ws::connect(&gw.ws_url(), Some("http://evil.example")).await;
    match ws.next(Duration::from_secs(5)).await {
        Some(Got::Closed(Some(4403))) => {}
        Some(Got::Closed(code)) => panic!("closed with {code:?}"),
        _ => panic!("not closed"),
    }
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn login_attempts_are_rate_limited_per_address() {
    let gw = Gw::start(Opts {
        bots: 1,
        modes: vec![AuthMode::Password, AuthMode::TokenProof],
        password: Some(PW.to_owned()),
        login_per_min: 3,
        ..Opts::default()
    })
    .await;
    let login = |pw: &'static str| {
        gw.http
            .post(gw.url("/session/login"))
            .json(&json!({"mode": "password", "password": pw, "device_id": "d1"}))
            .send()
    };
    for i in 0..3 {
        let r = login("wrong").await.unwrap();
        assert_eq!(r.status(), 401, "attempt {i}");
    }
    let limited = login(PW).await.unwrap();
    assert_eq!(
        limited.status(),
        429,
        "the quota binds even a correct password"
    );
    let retry = limited.headers()["retry-after"]
        .to_str()
        .unwrap()
        .parse::<u64>()
        .unwrap();
    assert!((1..=60).contains(&retry), "{retry}");
    let body: Value = limited.json().await.unwrap();
    assert_eq!(body["code"], "rate_limited");
    assert!(body["retry_after_ms"].as_u64().unwrap() > 0);

    // The bootstrap shares the quota.
    let r = gw
        .http
        .post(gw.url("/session/bootstrap"))
        .json(&json!({"device_id": "d", "bots": []}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 429);
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn too_many_failures_lock_the_address_out_even_for_the_right_password() {
    let gw = Gw::start(Opts {
        bots: 1,
        modes: vec![AuthMode::Password],
        password: Some(PW.to_owned()),
        lockout_after: 3,
        ..Opts::default()
    })
    .await;
    let login = |pw: &'static str| {
        gw.http
            .post(gw.url("/session/login"))
            .json(&json!({"mode": "password", "password": pw, "device_id": "d1"}))
            .send()
    };
    // A success in between resets the count.
    assert_eq!(login("wrong").await.unwrap().status(), 401);
    assert_eq!(login("wrong").await.unwrap().status(), 401);
    assert_eq!(login(PW).await.unwrap().status(), 200);
    for _ in 0..3 {
        assert_eq!(login("wrong").await.unwrap().status(), 401);
    }
    let locked = login(PW).await.unwrap();
    assert_eq!(locked.status(), 429);
    let body: Value = locked.json().await.unwrap();
    assert!(
        body["retry_after_ms"].as_u64().unwrap() > 14 * 60 * 1000,
        "{body}"
    );
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn login_modes_that_are_not_enabled_are_refused() {
    let gw = Gw::start(Opts {
        bots: 1,
        modes: vec![AuthMode::BotCredentials],
        ..Opts::default()
    })
    .await;
    let post = |body: Value| gw.http.post(gw.url("/session/login")).json(&body).send();
    // Password mode is off.
    assert_eq!(
        post(json!({"mode": "password", "password": "x", "device_id": "d"}))
            .await
            .unwrap()
            .status(),
        403
    );
    // Token proof is the bootstrap's business, not the login's.
    assert_eq!(
        post(json!({"mode": "token_proof", "password": "x", "device_id": "d"}))
            .await
            .unwrap()
            .status(),
        403
    );
    // The bootstrap is off too.
    let body = gw.bootstrap_body(&[0], "d").await;
    let r = gw
        .http
        .post(gw.url("/session/bootstrap"))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403);
    // Bot credentials: right, wrong password, unknown user.
    let ok = post(json!({"mode": "bot_credentials", "username": "fake-user", "password": BOT_PASSWORD, "device_id": "d"})).await.unwrap();
    assert_eq!(ok.status(), 200);
    let v: Value = ok.json().await.unwrap();
    assert!(v["session"].as_str().unwrap().starts_with("fgs_"));
    for (u, p) in [("fake-user", "nope"), ("nobody", "fake-pass")] {
        let r = post(
            json!({"mode": "bot_credentials", "username": u, "password": p, "device_id": "d"}),
        )
        .await
        .unwrap();
        assert_eq!(r.status(), 401, "{u}");
    }
    // Malformed bodies are 400, not a crash.
    assert_eq!(
        gw.http
            .post(gw.url("/session/login"))
            .body("{")
            .header("content-type", "application/json")
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_bootstrap_proves_tokens_against_discovered_bots_only() {
    let gw = Gw::start(Opts {
        bots: 3,
        ..Opts::default()
    })
    .await;

    // A listener standing in for "some other service on this machine": the browser names it, the
    // gateway must not call it.
    let decoy = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let decoy_port = decoy.local_addr().unwrap().port();

    let good = gw.bot_token(0).await;
    let body = json!({
        "device_id": "phone-1",
        "bots": [
            {"ui_id": "ftbot.0", "apiUrl": format!("http://127.0.0.1:{}", gw.port(0)), "accessToken": good},
            {"ui_id": "ftbot.1", "apiUrl": format!("http://localhost:{}/", gw.port(1)), "accessToken": "A-wrong"},
            {"ui_id": "ftbot.2", "apiUrl": format!("http://127.0.0.1:{decoy_port}"), "accessToken": good},
            {"ui_id": "ftbot.3", "apiUrl": "http://203.0.113.9:9056", "accessToken": good},
            {"ui_id": "ftbot.4", "apiUrl": "not a url", "accessToken": good},
        ],
    });
    let started = std::time::Instant::now();
    let r = gw
        .http
        .post(gw.url("/session/bootstrap"))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "no call to a remote address"
    );
    let v: Value = r.json().await.unwrap();
    let scope_of = |ui: &str| {
        v["bots"]
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["ui_id"] == ui)
            .unwrap()["scope"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    assert_eq!(scope_of("ftbot.0"), "granted");
    // All fake bots share one trust group: the proof on bot 0 covers bot 1 as well.
    assert_eq!(scope_of("ftbot.1"), "granted");
    assert_eq!(scope_of("ftbot.2"), "unknown_bot");
    assert_eq!(scope_of("ftbot.3"), "remote_unsupported");
    assert_eq!(scope_of("ftbot.4"), "invalid");
    assert!(
        tokio::time::timeout(Duration::from_millis(400), decoy.accept())
            .await
            .is_err(),
        "the gateway connected to a port that is not a discovered bot"
    );
    // The aliases of the device follow the bot keys.
    let token = v["session"].as_str().unwrap();
    let bots = gw.get_json("/bots", token).await;
    let b1 = bots["bots"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["bot_key"] == gw.key(1))
        .unwrap();
    assert_eq!(b1["ui_ids"], json!(["ftbot.1"]));

    // Nothing proven: refused, and counted as a failure.
    let bad = json!({"device_id": "d", "bots": [
        {"ui_id": "ftbot.0", "apiUrl": format!("http://127.0.0.1:{}", gw.port(0)), "accessToken": "A-wrong"}]});
    let r = gw
        .http
        .post(gw.url("/session/bootstrap"))
        .json(&bad)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
    // No token at all.
    let none = json!({"device_id": "d", "bots": [
        {"ui_id": "ftbot.0", "apiUrl": format!("http://127.0.0.1:{}", gw.port(0))}]});
    assert_eq!(
        gw.http
            .post(gw.url("/session/bootstrap"))
            .json(&none)
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    // Bad shapes.
    for body in [
        json!({"device_id": "", "bots": [{"ui_id": "a", "apiUrl": "http://x"}]}),
        json!({"device_id": "d", "bots": []}),
        json!({"device_id": "bad id!", "bots": [{"ui_id": "a", "apiUrl": "http://x"}]}),
    ] {
        assert_eq!(
            gw.http
                .post(gw.url("/session/bootstrap"))
                .json(&body)
                .send()
                .await
                .unwrap()
                .status(),
            400,
            "{body}"
        );
    }
    // Too big a body.
    let big = json!({"device_id": "d", "bots": [], "pad": "x".repeat(70 * 1024)});
    assert_eq!(
        gw.http
            .post(gw.url("/session/bootstrap"))
            .json(&big)
            .send()
            .await
            .unwrap()
            .status(),
        413
    );
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_session_ends_when_it_is_deleted_and_can_be_listed_and_revoked() {
    let gw = Gw::start(Opts {
        bots: 1,
        ..Opts::default()
    })
    .await;
    let a = gw.session("phone").await;
    let b = gw.session("laptop").await;
    let list = gw.get_json("/sessions", &a).await;
    let sessions = list["sessions"].as_array().unwrap();
    assert_eq!(sessions.len(), 2);
    assert!(
        sessions
            .iter()
            .all(|s| s.get("token").is_none() && s.get("hash").is_none())
    );
    let other = sessions
        .iter()
        .find(|s| s["device_id"] == "laptop")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(sessions.iter().filter(|s| s["current"] == true).count(), 1);

    // Revoke the laptop from the phone: the laptop's token stops working at once.
    let r = gw
        .req(Method::DELETE, &format!("/sessions/{other}"), Some(&a))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 204);
    assert_eq!(
        gw.req(Method::GET, "/bots", Some(&b))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        gw.req(Method::DELETE, &format!("/sessions/{other}"), Some(&a))
            .send()
            .await
            .unwrap()
            .status(),
        404
    );

    // Log out.
    assert_eq!(
        gw.req(Method::DELETE, "/session", Some(&a))
            .send()
            .await
            .unwrap()
            .status(),
        204
    );
    assert_eq!(
        gw.req(Method::GET, "/bots", Some(&a))
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    gw.stop().await;
}

/// The first position of the snapshot: `(bot index, trade id, pair, is_short)`.
async fn some_position(gw: &Gw, token: &str) -> (usize, i64, String, bool) {
    let snap = gw.get_json("/snapshot?ch=positions", token).await;
    let positions = snap["channels"]["positions"]["collections"]["positions"]
        .as_object()
        .unwrap();
    let (_, p) = positions.iter().next().expect("a position");
    let key = p["bot_key"].as_str().unwrap();
    let idx = (0..gw.fleet.len()).find(|i| gw.key(*i) == key).unwrap();
    (
        idx,
        p["trade_id"].as_i64().unwrap(),
        p["pair"].as_str().unwrap().to_owned(),
        p["side"] == "short",
    )
}

fn forceexit(trade: i64, pair: &str, short: bool) -> Value {
    json!({"trade_id": trade, "expected": {"pair": pair, "is_short": short}})
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_idempotent_replay_returns_the_first_result_without_a_second_call_to_the_bot() {
    let gw = Gw::start(Opts {
        bots: 2,
        ..Opts::default()
    })
    .await;
    gw.wait_online(2, Duration::from_secs(60)).await;
    let token = gw.session("d1").await;
    let (i, trade, pair, short) = some_position(&gw, &token).await;
    let url = format!("/bots/{}/actions/forceexit", gw.key(i));
    let bot = gw.fleet.bot(i).unwrap();
    let send = |key: &'static str, body: Value| {
        gw.req(Method::POST, &url, Some(&token))
            .header("Idempotency-Key", key)
            .json(&body)
            .send()
    };

    let first = send("click-1", forceexit(trade, &pair, short))
        .await
        .unwrap();
    assert_eq!(first.status(), 200);
    let first: Value = first.json().await.unwrap();
    assert_eq!(first["status"], "accepted");
    assert_eq!(first["idempotency_key"], "click-1");
    assert_eq!(bot.writes().len(), 1);
    assert_eq!(bot.writes()[0].path, "/forceexit");

    // Again, and again: the stored result comes back, nothing leaves for the bot.
    for _ in 0..3 {
        let again: Value = send("click-1", forceexit(trade, &pair, short))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(again, first);
    }
    assert_eq!(bot.writes().len(), 1, "no second call to the bot");

    // A double click is two requests at once: still one call.
    let (a, b) = tokio::join!(
        send("click-2", forceexit(trade, &pair, short)),
        send("click-2", forceexit(trade, &pair, short)),
    );
    let (a, b) = (a.unwrap().status(), b.unwrap().status());
    assert!(a == 200 || a == 409, "{a}");
    assert!(b == 200 || b == 409, "{b}");
    assert!(a == 200 || b == 200);
    assert_eq!(
        bot.writes().len(),
        2,
        "click-2 reached the bot exactly once"
    );

    // The audit trail has the intent and the outcome, and never a token.
    gw.engine.handle().flush().await;
    let audit = gw
        .get_json(&format!("/audit?bot={}", gw.key(i)), &token)
        .await;
    let text = audit.to_string();
    assert!(text.contains("click-1") && text.contains("forceexit"));
    assert!(
        !text.contains(&token),
        "the session token is not in the audit"
    );
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn actions_are_guarded_by_idempotency_state_confirmation_and_quota() {
    let gw = Gw::start(Opts {
        bots: 2,
        ..Opts::default()
    })
    .await;
    gw.wait_online(2, Duration::from_secs(60)).await;
    let token = gw.session("d1").await;
    let (i, trade, pair, short) = some_position(&gw, &token).await;
    let bot = gw.fleet.bot(i).unwrap();
    let url = format!("/bots/{}/actions/forceexit", gw.key(i));
    let post = |path: String, key: Option<&'static str>, body: Value| {
        let mut rb = gw.req(Method::POST, &path, Some(&token)).json(&body);
        if let Some(k) = key {
            rb = rb.header("Idempotency-Key", k);
        }
        rb.send()
    };

    // No key: refused before anything is counted or sent.
    assert_eq!(
        post(url.clone(), None, forceexit(trade, &pair, short))
            .await
            .unwrap()
            .status(),
        400
    );
    // A key of the wrong shape.
    assert_eq!(
        post(
            url.clone(),
            Some("bad key!"),
            forceexit(trade, &pair, short)
        )
        .await
        .unwrap()
        .status(),
        400
    );
    // The trade is not the one the form showed: nothing is sent.
    let r = post(
        url.clone(),
        Some("k1"),
        forceexit(trade, "WRONG/USDC:USDC", short),
    )
    .await
    .unwrap();
    assert_eq!(r.status(), 409);
    assert_eq!(r.json::<Value>().await.unwrap()["code"], "state_mismatch");
    let r = post(url.clone(), Some("k2"), forceexit(trade, &pair, !short))
        .await
        .unwrap();
    assert_eq!(r.status(), 409);
    // No expected state at all is not a forceexit.
    assert_eq!(
        post(url.clone(), Some("k3"), json!({"trade_id": trade}))
            .await
            .unwrap()
            .status(),
        400
    );
    // A trade id that does not exist.
    assert_eq!(
        post(url.clone(), Some("k4"), forceexit(987_654, &pair, short))
            .await
            .unwrap()
            .status(),
        409
    );
    assert!(bot.writes().is_empty(), "none of the above reached the bot");

    // Unknown action, unknown fields, bad key, unknown bot.
    assert_eq!(
        post(
            format!("/bots/{}/actions/launch_missiles", gw.key(i)),
            Some("k5"),
            json!({})
        )
        .await
        .unwrap()
        .status(),
        404
    );
    assert_eq!(
        post(
            url.clone(),
            Some("k6"),
            json!({"trade_id": 1, "evil": true})
        )
        .await
        .unwrap()
        .status(),
        400
    );
    assert_eq!(
        post("/bots/nonsense/actions/stop".into(), Some("k7"), json!({}))
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        post("/bots/local:1/actions/stop".into(), Some("k8"), json!({}))
            .await
            .unwrap()
            .status(),
        403
    );

    // A stop needs the bot's name typed back.
    let name = gw.fleet.manifest.bots[i].name.clone();
    let stop = format!("/bots/{}/actions/stop", gw.key(i));
    assert_eq!(
        post(stop.clone(), Some("s1"), json!({}))
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        post(stop.clone(), Some("s2"), json!({"confirm": "not-the-name"}))
            .await
            .unwrap()
            .status(),
        403
    );
    assert!(bot.writes().is_empty());
    let ok = post(stop.clone(), Some("s3"), json!({"confirm": name}))
        .await
        .unwrap();
    assert_eq!(ok.status(), 200);
    assert_eq!(bot.writes().len(), 1);
    assert_eq!(bot.writes()[0].path, "/stop");
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_action_quota_is_per_session_and_answers_429() {
    let gw = Gw::start(Opts {
        bots: 1,
        actions_per_min: 3,
        ..Opts::default()
    })
    .await;
    gw.wait_online(1, Duration::from_secs(60)).await;
    let a = gw.session("a").await;
    let b = gw.session("b").await;
    let url = format!("/bots/{}/actions/start", gw.key(0));
    let mut statuses = Vec::new();
    for n in 0..5 {
        let r = gw
            .req(Method::POST, &url, Some(&a))
            .header("Idempotency-Key", format!("q-{n}"))
            .send()
            .await
            .unwrap();
        statuses.push(r.status().as_u16());
    }
    assert_eq!(
        statuses.iter().filter(|s| **s == 429).count(),
        2,
        "{statuses:?}"
    );
    // Another session has its own quota.
    let r = gw
        .req(Method::POST, &url, Some(&b))
        .header("Idempotency-Key", "q-other")
        .send()
        .await
        .unwrap();
    assert_ne!(r.status(), 429);
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_passthrough_forwards_only_what_is_whitelisted() {
    let gw = Gw::start(Opts {
        bots: 1,
        ..Opts::default()
    })
    .await;
    gw.wait_online(1, Duration::from_secs(60)).await;
    let token = gw.session("d1").await;
    let bot = gw.fleet.bot(0).unwrap();
    let base = format!("/bots/{}/proxy", gw.key(0));
    let before = bot.writes().len();

    // Things that must never reach the bot, with every trick the path allows.
    let refused: Vec<(Method, String)> = vec![
        (Method::POST, "forceexit".into()),
        (Method::POST, "forceenter".into()),
        (Method::POST, "stop".into()),
        (Method::POST, "start".into()),
        (Method::POST, "reload_config".into()),
        (Method::DELETE, "trades/1".into()),
        (Method::GET, "status".into()),
        (Method::GET, "show_config".into()),
        (Method::POST, "token/login".into()),
        (Method::GET, "token/refresh".into()),
        (Method::POST, "stratdev/../forceexit".into()),
        (Method::GET, "stratdev/./runs".into()),
        (Method::POST, "stratdev/%2e%2e/forceexit".into()),
        (Method::POST, "stratdev%2f..%2fforceexit".into()),
        (Method::POST, "stratdev/%2E%2E/stop".into()),
        (Method::GET, "stratdev//runs".into()),
        (Method::GET, "stratdev\\runs".into()),
        (Method::GET, "stratdevil/x".into()),
        (Method::GET, "replayer".into()),
        (Method::PUT, "blacklist".into()),
        (Method::POST, "fleetview/overview".into()),
        (Method::GET, "pair_candles/../status".into()),
        (Method::GET, "".into()),
    ];
    for (m, p) in &refused {
        // By hand, so that no client library tidies the path first.
        let target = format!("/gw/v1{base}/{p}");
        let bearer = format!("Bearer {token}");
        let s = gw_rig::raw_status(
            gw.server.addr,
            m.as_str(),
            &target,
            &[("Authorization", &bearer), ("Idempotency-Key", "refused-1")],
        )
        .await;
        assert!(s == 404 || s == 405 || s == 400, "{m} {p:?} -> {s}");
    }
    assert_eq!(bot.writes().len(), before, "no write reached the bot");
    let routes = bot.route_counts();
    for forbidden in [
        "POST /forceexit",
        "POST /forceenter",
        "POST /stop",
        "POST /start",
        "POST /reload_config",
        "DELETE /trades/{id}",
    ] {
        assert!(
            !routes.contains_key(forbidden),
            "{forbidden} was called: {routes:?}"
        );
    }

    // A whitelisted read is forwarded, cached, and its limit capped.
    let q = "pair=ETH/USDC:USDC&timeframe=5m&limit=99999";
    let first = gw
        .req(
            Method::GET,
            &format!("{base}/pair_candles?{q}"),
            Some(&token),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(first.status(), 200);
    assert_eq!(first.headers()["x-gw-cache"], "miss");
    let v: Value = first.json().await.unwrap();
    assert!(v["query"].as_str().unwrap().contains("limit=5000"), "{v}");
    let second = gw
        .req(
            Method::GET,
            &format!("{base}/pair_candles?{q}"),
            Some(&token),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(second.headers()["x-gw-cache"], "hit");
    assert_eq!(
        bot.route_counts()
            .get("GET /pair_candles")
            .copied()
            .unwrap_or(0),
        1,
        "one upstream read"
    );

    // Long reads of the Python tooling go through, uncached.
    for _ in 0..2 {
        let r = gw
            .req(Method::GET, &format!("{base}/stratdev/runs"), Some(&token))
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 200);
        assert!(!r.headers().contains_key("x-gw-cache"));
    }
    assert_eq!(
        bot.route_counts()
            .get("GET /stratdev/runs")
            .copied()
            .unwrap_or(0),
        2
    );

    // A mutation: key, confirmation, one call, replayable.
    let file = format!("{base}/stratdev/editor/file");
    let body = json!({"path": "strategies/x.py", "content": "print('not for the audit trail')"});
    let send = |key: Option<&'static str>, confirm: Option<String>| {
        let mut rb = gw.req(Method::POST, &file, Some(&token)).json(&body);
        if let Some(k) = key {
            rb = rb.header("Idempotency-Key", k);
        }
        if let Some(c) = confirm {
            rb = rb.header("X-Confirm-Bot", c);
        }
        rb.send()
    };
    let name = gw.fleet.manifest.bots[0].name.clone();
    assert_eq!(
        send(None, Some(name.clone())).await.unwrap().status(),
        400,
        "no key"
    );
    assert_eq!(
        send(Some("e1"), None).await.unwrap().status(),
        403,
        "no confirmation"
    );
    assert_eq!(
        send(Some("e1"), Some("other".into()))
            .await
            .unwrap()
            .status(),
        403,
        "wrong confirmation"
    );
    assert_eq!(bot.writes().len(), before);
    let ok: Value = send(Some("e1"), Some(name.clone()))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(ok["status"], "accepted");
    assert_eq!(bot.writes().len(), before + 1);
    assert_eq!(bot.writes()[before].path, "/stratdev/editor/file");
    let replay: Value = send(Some("e1"), Some(name))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(replay, ok);
    assert_eq!(bot.writes().len(), before + 1, "replay: no second call");

    // The audit names the file, not its content.
    gw.engine.handle().flush().await;
    let audit = gw.get_json("/audit", &token).await.to_string();
    assert!(audit.contains("strategies/x.py"));
    assert!(!audit.contains("not for the audit trail"));
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_session_reaches_only_the_bots_it_proved() {
    // Two trust groups: bots 0 and 2 in g0, bots 1 and 3 in g1.
    let gw = Gw::start(Opts {
        bots: 4,
        groups: 2,
        ..Opts::default()
    })
    .await;
    gw.wait_online(4, Duration::from_secs(60)).await;
    let token = {
        let mut body = gw.bootstrap_body(&[0], "d1").await;
        // Bot 1 is on the device but its token is not offered.
        body["bots"].as_array_mut().unwrap().push(json!({
            "ui_id": "ftbot.1", "apiUrl": format!("http://127.0.0.1:{}", gw.port(1))
        }));
        let r = gw
            .http
            .post(gw.url("/session/bootstrap"))
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 200);
        let v: Value = r.json().await.unwrap();
        assert_eq!(v["bots"][1]["scope"], "denied");
        v["session"].as_str().unwrap().to_owned()
    };
    let get = |path: String| gw.req(Method::GET, &path, Some(&token)).send();

    // Whole-fleet views carry every bot: refused to a partial session.
    for p in [
        "/snapshot",
        "/snapshot?ch=fleet",
        "/health",
        "/scope/live",
        "/equity?scope=live",
        "/leaderboard",
        "/risk",
        "/alerts/rules",
    ] {
        assert_eq!(get(p.to_owned()).await.unwrap().status(), 403, "{p}");
    }
    // Single-bot views: in or out.
    assert_eq!(
        get(format!("/snapshot?ch=bot:{}", gw.key(0)))
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        get(format!("/snapshot?ch=bot:{}", gw.key(2)))
            .await
            .unwrap()
            .status(),
        200,
        "same group"
    );
    assert_eq!(
        get(format!("/snapshot?ch=bot:{}", gw.key(1)))
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        get(format!("/scope/bot:{}", gw.key(3)))
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        get(format!("/scope/bot:{}", gw.key(0)))
            .await
            .unwrap()
            .status(),
        200
    );
    assert_eq!(
        get(format!("/pairs/{}", gw.key(1))).await.unwrap().status(),
        403
    );
    assert_eq!(
        get(format!("/trades/{}/1", gw.key(1)))
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        get(format!("/trades?bots={}", gw.key(1)))
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        get(format!("/health/rate?bot={}", gw.key(1)))
            .await
            .unwrap()
            .status(),
        403
    );
    // Lists are filtered, not refused.
    let bots = gw.get_json("/bots", &token).await;
    let keys: BTreeSet<String> = bots["bots"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["bot_key"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(keys, BTreeSet::from([gw.key(0), gw.key(2)]));
    let journal = gw.get_json("/trades", &token).await;
    for r in journal["rows"].as_array().unwrap() {
        assert!(keys.contains(r["bot_key"].as_str().unwrap()), "{r}");
    }
    // Writes and the passthrough obey the same scope.
    for p in [
        format!("/bots/{}/actions/start", gw.key(1)),
        format!("/bots/{}/proxy/stratdev/runs", gw.key(1)),
    ] {
        let r = gw
            .req(Method::POST, &p, Some(&token))
            .header("Idempotency-Key", "scope-1")
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 403, "{p}");
    }
    assert!(gw.fleet.bot(1).unwrap().writes().is_empty());
    // A WebSocket subscription too.
    let mut ws = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
    ws.auth(&token, "d1").await;
    ws.send(json!({"t": "sub", "ch": ["fleet"], "resume": {}}))
        .await;
    let frames = ws.until(Duration::from_secs(5), |v| v["t"] == "err").await;
    assert_eq!(frames.last().unwrap()["code"], "forbidden");
    ws.send(json!({"t": "sub", "ch": [format!("bot:{}", gw.key(1))], "resume": {}}))
        .await;
    let frames = ws.until(Duration::from_secs(5), |v| v["t"] == "err").await;
    assert_eq!(frames.last().unwrap()["code"], "forbidden");
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_websocket_demands_its_first_frame_and_keeps_the_token_out_of_the_url() {
    let gw = Gw::start(Opts {
        bots: 1,
        ..Opts::default()
    })
    .await;
    let token = gw.session("d1").await;

    // A token in the URL is not read.
    let mut ws = Ws::connect(&format!("{}?token={token}", gw.ws_url()), Some(UI_ORIGIN)).await;
    ws.send(json!({"t": "sub", "ch": ["fleet"], "resume": {}}))
        .await;
    assert!(matches!(
        ws.next(Duration::from_secs(5)).await,
        Some(Got::Closed(Some(4401)))
    ));

    // Silence: closed after the delay.
    let mut ws = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
    let started = std::time::Instant::now();
    assert!(matches!(
        ws.next(Duration::from_secs(10)).await,
        Some(Got::Closed(Some(4401)))
    ));
    let waited = started.elapsed();
    assert!(
        waited > Duration::from_secs(4) && waited < Duration::from_secs(8),
        "{waited:?}"
    );

    // Wrong token.
    let mut ws = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
    ws.send(json!({"t": "auth", "token": "fgs_nope", "device_id": "d"}))
        .await;
    assert!(matches!(
        ws.next(Duration::from_secs(5)).await,
        Some(Got::Closed(Some(4401)))
    ));

    // Good token: authed, and the ninth socket of a session is refused.
    let mut open = Vec::new();
    for n in 0..8 {
        let mut w = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
        let authed = w.auth(&token, "d1").await;
        assert_eq!(authed["t"], "authed", "socket {n}");
        assert_eq!(authed["protocol"], 1);
        open.push(w);
    }
    let mut ninth = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
    ninth
        .send(json!({"t": "auth", "token": token, "device_id": "d1"}))
        .await;
    let frames = ninth
        .until(Duration::from_secs(5), |v| v["t"] == "err")
        .await;
    assert_eq!(frames.last().unwrap()["code"], "too_many_connections");
    assert!(matches!(
        ninth.next(Duration::from_secs(5)).await,
        Some(Got::Closed(Some(4429)))
    ));
    gw.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn request_bodies_are_bounded() {
    let gw = Gw::start(Opts {
        bots: 1,
        ..Opts::default()
    })
    .await;
    let token = gw.session("d1").await;
    // 100 KB of preferences are fine (the limit is 256 KB), 400 KB are not.
    let ok = gw
        .req(Method::PUT, "/prefs", Some(&token))
        .json(&json!({"blob": "x".repeat(100 * 1024)}))
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status(), 200);
    let big = gw
        .req(Method::PUT, "/prefs?scope=", Some(&token))
        .json(&json!({"blob": "x".repeat(400 * 1024)}))
        .send()
        .await
        .unwrap();
    assert_eq!(big.status(), 413);
    // Other routes keep the 64 KB default.
    let r = gw
        .req(
            Method::POST,
            &format!("/bots/{}/actions/start", gw.key(0)),
            Some(&token),
        )
        .header("Idempotency-Key", "big-1")
        .json(&json!({"pair": "x".repeat(70 * 1024)}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 413);
    gw.stop().await;
}
