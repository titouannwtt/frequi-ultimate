//! No credential reaches the logs: run the gateway with the process-wide subscriber writing into
//! memory through the redacting writer, push every kind of secret through it, and look for them.
//! This file holds one test: the subscriber is global to the process.

mod common;
mod gw_rig;

use std::time::Duration;

use fg_server::config::AuthMode;
use fg_server::redact::{MemorySink, RedactingMakeWriter};
use gw_rig::{Gw, Opts, UI_ORIGIN, Ws};
use reqwest::Method;
use serde_json::{Value, json};
use tracing_subscriber::EnvFilter;

const PASSWORD: &str = "correct-horse-battery-staple-91";
const WRONG_PASSWORD: &str = "wrong-password-xyz";
const BOT_PASSWORD: &str = "fake-pass";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_token_password_or_header_reaches_the_logs() {
    let sink = MemorySink::default();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::new("debug"))
        .with_writer(RedactingMakeWriter::new(sink.clone()))
        .with_target(true)
        .json()
        .try_init()
        .expect("the subscriber is installed once per process");

    let gw = Gw::start(Opts {
        bots: 3,
        modes: vec![
            AuthMode::TokenProof,
            AuthMode::BotCredentials,
            AuthMode::Password,
        ],
        password: Some(PASSWORD.to_owned()),
        ..Opts::default()
    })
    .await;
    gw.wait_online(3, Duration::from_secs(60)).await;

    // Everything that must never be printed.
    let mut secrets: Vec<String> = vec![PASSWORD.to_owned(), BOT_PASSWORD.to_owned()];
    let bot_token = gw.bot_token(0).await;
    secrets.push(bot_token.clone());
    let session = gw.session("phone").await;
    secrets.push(session.clone());

    // Failed attempts quote the secrets they were given.
    let junk = "fgs_0123456789abcdef0123456789abcdef0123456789abcdef";
    let forged_jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmU";
    secrets.push(junk.to_owned());
    secrets.push(forged_jwt.to_owned());
    for tok in [junk, forged_jwt] {
        let r = gw
            .req(Method::GET, "/bots", Some(tok))
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 401);
    }
    let r = gw
        .http
        .get(gw.url("/bots"))
        .header(
            "Authorization",
            format!("Basic {}", "ZmFrZS11c2VyOmZha2UtcGFzcw=="),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
    secrets.push("ZmFrZS11c2VyOmZha2UtcGFzcw==".to_owned());

    // A wrong password, a bad bootstrap token, a forged bootstrap entry.
    let r = gw
        .http
        .post(gw.url("/session/login"))
        .json(&json!({"mode": "password", "password": WRONG_PASSWORD, "device_id": "x"}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
    secrets.push(WRONG_PASSWORD.to_owned());
    let mut body = gw.bootstrap_body(&[0], "attacker").await;
    body["bots"][0]["accessToken"] = json!(forged_jwt);
    let r = gw
        .http
        .post(gw.url("/session/bootstrap"))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);

    // The good paths too: password login, bot credentials login, actions, passthrough, sockets.
    let r = gw
        .http
        .post(gw.url("/session/login"))
        .json(&json!({"mode": "password", "password": PASSWORD, "device_id": "pw"}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let pw_session = r.json::<Value>().await.unwrap()["session"]
        .as_str()
        .unwrap()
        .to_owned();
    secrets.push(pw_session.clone());
    let r = gw
        .http
        .post(gw.url("/session/login"))
        .json(&json!({"mode": "bot_credentials", "username": "fake-user", "password": BOT_PASSWORD, "device_id": "bc"}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200, "{}", r.text().await.unwrap_or_default());

    let key = gw.key(1);
    let r = gw
        .req(
            Method::POST,
            &format!("/bots/{key}/actions/start"),
            Some(&session),
        )
        .header("Idempotency-Key", "log-1")
        .send()
        .await
        .unwrap();
    assert!(
        r.status().is_success() || r.status().is_client_error(),
        "{}",
        r.status()
    );
    for path in [
        "/proxy/api/v1/status",
        "/proxy/api/v1/token/refresh",
        "/proxy/api/v1/nothing",
    ] {
        let _ = gw
            .req(Method::GET, &format!("/bots/{key}{path}"), Some(&session))
            .send()
            .await
            .unwrap();
    }
    let mut ws = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
    ws.auth(&session, "phone").await;
    ws.send(json!({"t": "sub", "ch": ["fleet"], "resume": {}}))
        .await;
    ws.until(Duration::from_secs(5), |v| v["t"] == "subscribed")
        .await;
    let mut bad = Ws::connect(&gw.ws_url(), Some(UI_ORIGIN)).await;
    bad.send(json!({"t": "auth", "token": junk, "device_id": "evil"}))
        .await;
    let _ = bad.next(Duration::from_secs(5)).await;
    assert_eq!(
        gw.req(Method::DELETE, "/session", Some(&pw_session))
            .send()
            .await
            .unwrap()
            .status(),
        204
    );
    // Let the engine and the connectors run a few rounds with the tokens in play.
    gw.fleet.bot(2).unwrap().expire_tokens();
    tokio::time::sleep(Duration::from_secs(4)).await;
    gw.stop().await;

    // The code never logs these, and the writer would not let them through if it did: a careless
    // line quoting each secret in the shapes seen in practice.
    for sec in &secrets {
        tracing::warn!("upstream said Authorization: Bearer {sec} and token={sec}");
        tracing::warn!(detail = %format!("{{\"access_token\":\"{sec}\",\"password\":\"{sec}\"}}"), "bad reply");
        tracing::warn!(token = %sec, "careless field");
    }

    let logs = sink.contents();
    assert!(
        logs.lines().count() > 20,
        "the capture is not empty: {} lines",
        logs.lines().count()
    );
    assert!(logs.contains("auth_failed"), "the failures are logged");
    for s in &secrets {
        assert!(
            !logs.contains(s.as_str()),
            "a secret of {} characters reached the logs: {:?}",
            s.len(),
            logs.lines()
                .filter(|l| l.contains(s.as_str()))
                .collect::<Vec<_>>()
        );
    }
    // The password hash and the Basic scheme are as secret as the rest.
    assert!(
        !logs.contains("$argon2"),
        "a password hash reached the logs"
    );
    assert!(
        !logs.to_ascii_lowercase().contains("bearer ey"),
        "a bearer token reached the logs"
    );
}
