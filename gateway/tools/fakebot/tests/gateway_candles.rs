//! `GET /candles` end to end: the parameters are validated, the pages walk back in time, and the
//! candles come from files (the fixture directory stands for the cache of the ftcache daemon).

mod common;
mod gw_rig;

use std::path::Path;

use fg_server::config::{CandleDirSection, CandlesSection};
use gw_rig::{Gw, Opts};
use reqwest::Method;
use serde_json::Value;

/// 2026-01-01T00:00:00Z: the first of the 300 candles of 15 minutes of the fixture.
const T0: i64 = 1_767_225_600_000;
const M15: i64 = 900_000;
const PAIR: &str = "XYZ-TEST/USDC:USDC";

fn fixtures() -> String {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/candles")
        .canonicalize()
        .expect("fixtures")
        .to_string_lossy()
        .into_owned()
}

async fn gateway() -> Gw {
    Gw::start(Opts {
        bots: 1,
        candles: Some(CandlesSection {
            dirs: vec![CandleDirSection {
                path: fixtures(),
                pattern: "{pair}-{tf}.feather".into(),
            }],
            ..CandlesSection::default()
        }),
        ..Opts::default()
    })
    .await
}

/// `?a=b&c=d` with every byte but the unreserved ones percent-encoded.
fn query_string(query: &[(&str, &str)]) -> String {
    let enc = |s: &str| {
        s.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    char::from(b).to_string()
                }
                _ => format!("%{b:02X}"),
            })
            .collect::<String>()
    };
    let pairs: Vec<String> = query
        .iter()
        .map(|(k, v)| format!("{}={}", enc(k), enc(v)))
        .collect();
    format!("?{}", pairs.join("&"))
}

async fn get(gw: &Gw, token: &str, query: &[(&str, &str)]) -> (u16, Value) {
    let path = format!("/candles{}", query_string(query));
    let r = gw
        .req(Method::GET, &path, Some(token))
        .send()
        .await
        .expect("send");
    let status = r.status().as_u16();
    (status, r.json().await.expect("json"))
}

fn stamps(v: &Value) -> Vec<i64> {
    v["candles"]
        .as_array()
        .expect("candles")
        .iter()
        .map(|c| c[0].as_i64().expect("an integer timestamp"))
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_page_has_the_documented_shape_and_walks_back_in_time() {
    let gw = gateway().await;
    let token = gw.session("phone").await;

    let (status, v) = get(
        &gw,
        &token,
        &[("pair", PAIR), ("tf", "15m"), ("limit", "10")],
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(v["pair"], PAIR);
    assert_eq!(v["tf"], "15m");
    assert_eq!(v["has_more"], true);
    assert_eq!(v["first_available_ms"], T0);
    assert!(v["resampled_from"].is_null());
    let candles = v["candles"].as_array().unwrap();
    assert_eq!(candles.len(), 10);
    let last = &candles[9];
    assert_eq!(last.as_array().unwrap().len(), 6);
    assert_eq!(last[0], T0 + 299 * M15);
    // The 300th candle: i = 299, open 100 + 9, high +1.5, low -1.5, close +0.5, volume 10 + 2.
    assert_eq!(last[1], 109.0);
    assert_eq!(last[2], 110.5);
    assert_eq!(last[3], 107.5);
    assert_eq!(last[4], 109.5);
    assert_eq!(last[5], 12.0);

    // `end` is exclusive and the next page follows the first one without a hole or an overlap.
    let first = stamps(&v)[0];
    let (_, v2) = get(
        &gw,
        &token,
        &[
            ("pair", PAIR),
            ("tf", "15m"),
            ("limit", "10"),
            ("end", &first.to_string()),
        ],
    )
    .await;
    let s2 = stamps(&v2);
    assert_eq!(s2.len(), 10);
    assert_eq!(s2[9] + M15, first);
    assert!(s2.windows(2).all(|w| w[0] + M15 == w[1]));
    assert_eq!(v2["has_more"], true);

    // The whole history in one page: nothing more. The default limit is 1000.
    let (_, all) = get(&gw, &token, &[("pair", PAIR), ("tf", "15m")]).await;
    assert_eq!(stamps(&all).len(), 300);
    assert_eq!(all["has_more"], false);
    // The limit is bounded to [1, 5000].
    for (limit, n) in [("0", 1), ("-4", 1), ("1", 1), ("5000", 300), ("99999", 300)] {
        let (status, v) = get(
            &gw,
            &token,
            &[("pair", PAIR), ("tf", "15m"), ("limit", limit)],
        )
        .await;
        assert_eq!(status, 200, "limit={limit}");
        assert_eq!(stamps(&v).len(), n, "limit={limit}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_timeframe_with_no_file_is_rebuilt_and_an_unknown_pair_is_empty() {
    let gw = gateway().await;
    let token = gw.session("phone").await;

    let (status, v) = get(&gw, &token, &[("pair", PAIR), ("tf", "1h")]).await;
    assert_eq!(status, 200);
    assert_eq!(v["resampled_from"], "15m");
    assert_eq!(stamps(&v).len(), 75);
    // Hour 0: candles 0..4 of the fixture, open 100, close 103.5, volume 10 + 11 + 12 + 10.
    let h0 = &v["candles"][0];
    assert_eq!(h0[0], T0);
    assert_eq!(h0[1], 100.0);
    assert_eq!(h0[4], 103.5);
    assert_eq!(h0[5], 43.0);

    let (status, v) = get(&gw, &token, &[("pair", "NOPE/USDC:USDC"), ("tf", "15m")]).await;
    assert_eq!(status, 200);
    assert_eq!(stamps(&v), Vec::<i64>::new());
    assert_eq!(v["has_more"], false);
    assert!(v["first_available_ms"].is_null());
    assert!(v["resampled_from"].is_null());
    // No finer timeframe to build a minute from.
    let (status, v) = get(&gw, &token, &[("pair", PAIR), ("tf", "1m")]).await;
    assert_eq!(status, 200);
    assert_eq!(stamps(&v), Vec::<i64>::new());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bad_parameters_are_refused_and_no_pair_reaches_outside_the_directory() {
    let gw = gateway().await;
    let token = gw.session("phone").await;

    let bad: Vec<Vec<(&str, &str)>> = vec![
        vec![("tf", "15m")],
        vec![("pair", PAIR)],
        vec![("pair", ""), ("tf", "15m")],
        vec![("pair", PAIR), ("tf", "7m")],
        vec![("pair", PAIR), ("tf", "15M")],
        vec![("pair", PAIR), ("tf", "")],
        vec![("pair", PAIR), ("tf", "15m"), ("end", "yesterday")],
        vec![("pair", PAIR), ("tf", "15m"), ("end", "1.5")],
        vec![("pair", PAIR), ("tf", "15m"), ("limit", "many")],
        vec![("pair", "../../etc/passwd"), ("tf", "15m")],
        vec![("pair", "..\\..\\x"), ("tf", "15m")],
        vec![("pair", "BTC/../../x"), ("tf", "15m")],
        vec![("pair", ".."), ("tf", "15m")],
        vec![("pair", "/etc/passwd"), ("tf", "15m")],
        vec![("pair", "BTC USDC"), ("tf", "15m")],
        vec![("pair", "BTC/USDC;rm"), ("tf", "15m")],
        vec![("pair", "BTC/USDC\0"), ("tf", "15m")],
        vec![("pair", "é"), ("tf", "15m")],
    ];
    for q in &bad {
        let (status, v) = get(&gw, &token, q).await;
        assert_eq!(status, 400, "{q:?}");
        assert_eq!(v["code"], "bad_request", "{q:?}");
        assert!(
            !v.to_string().contains("etc/passwd"),
            "an error never echoes the input: {v}"
        );
    }

    // A session is required.
    let r = gw
        .req(
            Method::GET,
            &format!("/candles{}", query_string(&[("pair", PAIR), ("tf", "15m")])),
            None,
        )
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
    // Read only.
    let r = gw
        .req(Method::POST, "/candles", Some(&token))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 405);
}
