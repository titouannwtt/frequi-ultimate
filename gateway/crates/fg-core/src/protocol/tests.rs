use serde_json::json;

use super::*;
use crate::model::EventKind;

fn up(entities: &[(&str, &str, Value)]) -> Upsert {
    let mut u = Upsert::new();
    for (c, k, v) in entities {
        u.entry((*c).to_owned())
            .or_default()
            .insert((*k).to_owned(), v.clone());
    }
    u
}

fn event() -> Event {
    Event {
        kind: EventKind::ExitFill,
        ts_ms: 1,
        bot_key: Some(BotKey::Local(9056)),
        trade_id: Some(412),
        pair: Some("ETH/USDC:USDC".into()),
        profit_abs: Some(4.1),
        severity: None,
        detail: None,
    }
}

#[test]
fn simple_channels_round_trip() {
    for (s, c) in [
        ("fleet", Channel::Fleet),
        ("positions", Channel::Positions),
        ("alerts", Channel::Alerts),
        ("events", Channel::Events),
        ("health", Channel::Health),
        ("recon", Channel::Recon),
        ("logs:errors", Channel::Logs(LogScope::Errors)),
        ("bot:local:9056", Channel::Bot(BotKey::Local(9056))),
        (
            "logs:local:9056",
            Channel::Logs(LogScope::Bot(BotKey::Local(9056))),
        ),
    ] {
        assert_eq!(s.parse::<Channel>().unwrap(), c, "{s}");
        assert_eq!(c.to_string(), s);
    }
}

#[test]
fn chart_channels_survive_colons_in_keys_and_pairs() {
    let c: Channel = "chart:local:9056:ETH/USDC:USDC:15m".parse().unwrap();
    assert_eq!(
        c,
        Channel::Chart {
            bot: BotKey::Local(9056),
            pair: "ETH/USDC:USDC".into(),
            timeframe: "15m".into()
        }
    );
    assert_eq!(c.to_string(), "chart:local:9056:ETH/USDC:USDC:15m");

    let c: Channel = "chart:url:http://10.0.0.4:9400:XYZ-NVDA/USDC:USDC:1h"
        .parse()
        .unwrap();
    assert_eq!(
        c,
        Channel::Chart {
            bot: BotKey::Url("http://10.0.0.4:9400".into()),
            pair: "XYZ-NVDA/USDC:USDC".into(),
            timeframe: "1h".into()
        }
    );
    assert_eq!(c.to_string().parse::<Channel>().unwrap(), c);

    // A remote bot without an explicit port.
    let c: Channel = "chart:url:https://bots.example.org:BTC/USDC:USDC:5m"
        .parse()
        .unwrap();
    assert!(matches!(&c, Channel::Chart { bot, pair, .. }
        if bot.to_string() == "url:https://bots.example.org" && pair == "BTC/USDC:USDC"));
    // A pair that starts with digits is not mistaken for a port.
    let c: Channel = "chart:url:https://bots.example.org:1000PEPE/USDC:USDC:5m"
        .parse()
        .unwrap();
    assert!(matches!(&c, Channel::Chart { pair, .. } if pair == "1000PEPE/USDC:USDC"));
}

#[test]
fn bad_channels_are_rejected() {
    assert!(matches!(
        "nope".parse::<Channel>(),
        Err(ChannelError::Unknown(_))
    ));
    assert!(matches!(
        "bot:".parse::<Channel>(),
        Err(ChannelError::Malformed(_))
    ));
    assert!(matches!(
        "bot:ftbot.3".parse::<Channel>(),
        Err(ChannelError::Malformed(_))
    ));
    assert!(matches!(
        "bot:local:9056:extra".parse::<Channel>(),
        Err(ChannelError::Malformed(_))
    ));
    assert!(matches!(
        "chart:local:9056:15m".parse::<Channel>(),
        Err(ChannelError::Malformed(_))
    ));
}

#[test]
fn channel_serde_is_a_string() {
    let c = Channel::Bot(BotKey::Local(1));
    assert_eq!(serde_json::to_value(&c).unwrap(), json!("bot:local:1"));
    assert!(serde_json::from_value::<Channel>(json!("zzz")).is_err());
}

#[test]
fn spec_frames_deserialize() {
    let auth: ClientFrame =
        serde_json::from_str(r#"{"t":"auth","token":"abc","device_id":"d-7f3a"}"#).unwrap();
    assert!(matches!(auth, ClientFrame::Auth { ref device_id, .. } if device_id == "d-7f3a"));
    let sub: ClientFrame = serde_json::from_str(
        r#"{"t":"sub","ch":["fleet","alerts","health","positions"],"resume":{"fleet":1842,"alerts":77}}"#,
    )
    .unwrap();
    assert!(
        matches!(sub, ClientFrame::Sub { ref ch, ref resume } if ch.len() == 4 && resume["fleet"] == 1842)
    );

    let frame: ServerFrame = serde_json::from_str(
        r#"{"t":"up","ch":"fleet","seq":1843,"ts":1760530000123,
            "upsert":{"bots":{"local:9056":{"metrics":{"open_profit_abs":-3.42},
              "freshness":{"metrics":{"as_of_ms":1760530000000,"source":"ws","stale":false}}}}},
            "remove":{"bots":[]}}"#,
    )
    .unwrap();
    assert_eq!(frame.seq(), Some(1843));
    let hb: ServerFrame = serde_json::from_str(r#"{"t":"hb","ts":1760530015000}"#).unwrap();
    assert_eq!(
        hb,
        ServerFrame::Hb {
            ts: 1_760_530_015_000
        }
    );
    let rs: ServerFrame =
        serde_json::from_str(r#"{"t":"resync","ch":"fleet","reason":"gap"}"#).unwrap();
    assert_eq!(
        rs,
        ServerFrame::Resync {
            ch: "fleet".into(),
            reason: ResyncReason::Gap
        }
    );
}

#[test]
fn event_frame_shape() {
    let mut buf = DeltaBuffer::new(&Channel::Events, 8);
    let f = buf.push_ev(event());
    let v = serde_json::to_value(&f).unwrap();
    assert_eq!(v["t"], "ev");
    assert_eq!(v["ch"], "events");
    assert_eq!(v["seq"], 1);
    assert_eq!(v["data"]["kind"], "exit_fill");
    assert_eq!(v["data"]["trade_id"], 412);
}

#[test]
fn auth_token_never_appears_in_debug_output() {
    let f = ClientFrame::Auth {
        token: "super-secret-token".into(),
        device_id: "d1".into(),
    };
    let dbg = format!("{f:?}");
    assert!(!dbg.contains("super-secret-token"));
    assert!(dbg.contains("***"));
    assert!(dbg.contains("d1"));
}

#[test]
fn error_codes_map_to_http_statuses() {
    assert_eq!(ErrorCode::StateMismatch.http_status(), 409);
    assert_eq!(ErrorCode::InProgress.http_status(), 409);
    assert_eq!(ErrorCode::IdempotencyKeyReused.http_status(), 422);
    assert_eq!(ErrorCode::Unauthorized.http_status(), 401);
    assert_eq!(ErrorCode::RateLimited.http_status(), 429);
    assert_eq!(ErrorCode::OriginNotAllowed.http_status(), 403);
    assert_eq!(
        serde_json::to_value(ErrorCode::StateMismatch).unwrap(),
        "state_mismatch"
    );
}

#[test]
fn reconnect_backoff_saturates() {
    let d: Vec<u64> = (0..8).map(reconnect_delay_s).collect();
    assert_eq!(d, [1, 2, 5, 10, 30, 30, 30, 30]);
}

#[test]
fn sequence_numbers_are_monotonic_per_channel() {
    let mut a = DeltaBuffer::new(&Channel::Fleet, 8);
    let mut b = DeltaBuffer::new(&Channel::Alerts, 8);
    for i in 1..=3 {
        let f = a.push_up(i, Upsert::new(), Remove::new());
        assert_eq!(f.seq(), Some(i as u64));
    }
    assert_eq!(b.push_up(0, Upsert::new(), Remove::new()).seq(), Some(1));
    assert_eq!(a.head(), 3);
    assert_eq!(b.head(), 1);
}

fn filled(n: u64, cap: usize) -> DeltaBuffer {
    let mut b = DeltaBuffer::new(&Channel::Fleet, cap);
    for i in 0..n {
        b.push_up(i as i64, Upsert::new(), Remove::new());
    }
    b
}

#[test]
fn resume_replays_what_the_client_missed() {
    let b = filled(10, 512);
    assert_eq!(b.resume(10), Resume::UpToDate);
    let Resume::Replay(frames) = b.resume(7) else {
        panic!("expected replay")
    };
    assert_eq!(
        frames
            .iter()
            .filter_map(ServerFrame::seq)
            .collect::<Vec<_>>(),
        [8, 9, 10]
    );
    let Resume::Replay(all) = b.resume(0) else {
        panic!("expected replay")
    };
    assert_eq!(all.len(), 10);
}

#[test]
fn resume_outside_the_buffer_or_ahead_of_it_resyncs() {
    // Capacity 4 after 10 frames keeps 7..=10.
    let b = filled(10, 4);
    assert!(matches!(b.resume(6), Resume::Replay(f) if f.len() == 4));
    assert_eq!(b.resume(5), Resume::Resync(ResyncReason::StaleResume));
    assert_eq!(b.resume(0), Resume::Resync(ResyncReason::StaleResume));
    // Server restarted: the client claims a sequence number the server never issued.
    assert_eq!(b.resume(11), Resume::Resync(ResyncReason::StaleResume));
    assert_eq!(filled(0, 4).resume(0), Resume::UpToDate);
}

/// A resume after a gateway restart must not replay the frames of another incarnation: the
/// counters restart, so the only thing telling the two apart is the sequence base.
#[test]
fn resume_after_gateway_restart_resyncs_instead_of_replaying() {
    let old_base = 1_760_000_000_000;
    let mut old = DeltaBuffer::with_base(&Channel::Alerts, 16, old_base);
    for i in 0..5 {
        old.push_up(i, Upsert::new(), Remove::new());
    }
    let client_seq = old.head();
    // The process restarts later and emits more frames than the client had seen.
    let new_base = old_base + 60_000;
    let mut new = DeltaBuffer::with_base(&Channel::Alerts, 16, new_base);
    for i in 0..8 {
        new.push_up(i, Upsert::new(), Remove::new());
    }
    assert_eq!(
        new.resume(client_seq),
        Resume::Resync(ResyncReason::StaleResume)
    );
    // Nothing emitted yet since the restart: still a resync, never "up to date".
    let quiet = DeltaBuffer::with_base(&Channel::Alerts, 16, new_base);
    assert_eq!(
        quiet.resume(client_seq),
        Resume::Resync(ResyncReason::StaleResume)
    );
    // A client that took its snapshot from the new incarnation resumes normally.
    assert!(matches!(new.resume(new_base + 5), Resume::Replay(f) if f.len() == 3));
}

#[test]
fn the_boot_base_is_exact_in_javascript_and_grows_between_boots() {
    let a = boot_seq_base();
    assert!(a > 1_700_000_000_000);
    assert!(a < (1_u64 << 53));
    assert!(boot_seq_base() >= a);
}

#[test]
fn buffer_never_exceeds_its_capacity() {
    let b = filled(2_000, DELTA_BUFFER_SIZE);
    let Resume::Replay(f) = b.resume(2_000 - DELTA_BUFFER_SIZE as u64) else {
        panic!()
    };
    assert_eq!(f.len(), DELTA_BUFFER_SIZE);
    assert_eq!(
        b.resume(2_000 - DELTA_BUFFER_SIZE as u64 - 1),
        Resume::Resync(ResyncReason::StaleResume)
    );
}

#[test]
fn tracker_detects_gaps_and_duplicates() {
    let mut t = SeqTracker::new();
    t.reset(41);
    assert_eq!(t.observe(42), SeqCheck::InOrder);
    assert_eq!(t.observe(42), SeqCheck::Duplicate);
    assert_eq!(t.observe(40), SeqCheck::Duplicate);
    assert_eq!(
        t.observe(45),
        SeqCheck::Gap {
            expected: 43,
            got: 45
        }
    );
    // A gap does not move the baseline: the client resyncs instead.
    assert_eq!(t.last(), Some(42));
    t.reset(50);
    assert_eq!(t.observe(51), SeqCheck::InOrder);
    // Without a baseline the first frame becomes the baseline.
    let mut fresh = SeqTracker::new();
    assert_eq!(fresh.observe(7), SeqCheck::InOrder);
    assert_eq!(fresh.last(), Some(7));
}

#[test]
fn merge_is_shallow_per_group() {
    let mut e = json!({"identity": {"name": "hippo"}, "metrics": {"a": 0.0, "b": 2.0},
                       "freshness": {"state": {"as_of_ms": 1}, "metrics": {"as_of_ms": 1}}});
    merge_entity(
        &mut e,
        &json!({"metrics": {"a": 1.0}, "freshness": {"metrics": {"as_of_ms": 5}}}),
    );
    assert_eq!(e["metrics"], json!({"a": 1.0, "b": 2.0}));
    // The freshness group is merged key by key; the key `metrics` is replaced wholesale.
    assert_eq!(
        e["freshness"],
        json!({"state": {"as_of_ms": 1}, "metrics": {"as_of_ms": 5}})
    );
    assert_eq!(e["identity"], json!({"name": "hippo"}));
}

#[test]
fn merge_replaces_non_object_groups_and_handles_nulls() {
    let mut e = json!({"severity": "warning", "value": 1.0, "metrics": {"a": 1}});
    merge_entity(
        &mut e,
        &json!({"severity": "critical", "value": null, "metrics": null}),
    );
    assert_eq!(
        e,
        json!({"severity": "critical", "value": null, "metrics": null})
    );
    let mut n = json!(null);
    merge_entity(&mut n, &json!({"x": {"y": 1}}));
    assert_eq!(n, json!({"x": {"y": 1}}));
}

#[test]
fn applying_the_same_upsert_twice_changes_nothing() {
    let u = up(&[("bots", "local:1", json!({"metrics": {"a": 1}}))]);
    let mut s = ChannelState::default();
    s.apply(&u, &Remove::new());
    let once = s.clone();
    s.apply(&u, &Remove::new());
    assert_eq!(s, once);
}

#[test]
fn upsert_order_between_independent_entities_does_not_matter() {
    let a = up(&[("bots", "local:1", json!({"metrics": {"a": 1}}))]);
    let b = up(&[("bots", "local:2", json!({"metrics": {"a": 2}}))]);
    let (mut s1, mut s2) = (ChannelState::default(), ChannelState::default());
    s1.apply(&a, &Remove::new());
    s1.apply(&b, &Remove::new());
    s2.apply(&b, &Remove::new());
    s2.apply(&a, &Remove::new());
    assert_eq!(s1, s2);
}

#[test]
fn removals_apply_after_upserts() {
    let mut s = ChannelState::default();
    s.apply(
        &up(&[("positions", "local:1/5", json!({"pair": "ETH"}))]),
        &Remove::new(),
    );
    assert!(s.collections["positions"].contains_key("local:1/5"));
    let mut rm = Remove::new();
    rm.insert(
        "positions".into(),
        vec!["local:1/5".into(), "never-existed".into()],
    );
    s.apply(&Upsert::new(), &rm);
    assert!(s.collections["positions"].is_empty());
    // A key both upserted and removed in one frame ends up removed.
    s.apply(
        &up(&[("positions", "local:1/6", json!({"pair": "BTC"}))]),
        &{
            let mut r = Remove::new();
            r.insert("positions".into(), vec!["local:1/6".into()]);
            r
        },
    );
    assert!(s.collections["positions"].is_empty());
    // Removing from an unknown collection is harmless.
    let mut rm = Remove::new();
    rm.insert("ghosts".into(), vec!["x".into()]);
    s.apply(&Upsert::new(), &rm);
}

#[test]
fn client_replays_a_gap_free_stream_to_the_server_state() {
    // End to end: the server pushes through a buffer, a client that missed some frames resumes
    // and ends up identical to a client that saw everything.
    let mut buf = DeltaBuffer::new(&Channel::Fleet, 16);
    let mut full = ChannelState::default();
    let mut partial = ChannelState::default();
    let mut tracker = SeqTracker::new();
    tracker.reset(buf.head());
    for i in 0..6 {
        let u = up(&[
            ("bots", "local:1", json!({"metrics": {"n": i}})),
            ("bots", "local:2", json!({"state": {"i": i}})),
        ]);
        let f = buf.push_up(i, u.clone(), Remove::new());
        full.apply(&u, &Remove::new());
        if i < 2 {
            let ServerFrame::Up {
                seq,
                upsert,
                remove,
                ..
            } = f
            else {
                panic!()
            };
            assert_eq!(tracker.observe(seq), SeqCheck::InOrder);
            partial.apply(&upsert, &remove);
        }
    }
    let Resume::Replay(missed) = buf.resume(tracker.last().unwrap()) else {
        panic!()
    };
    for f in missed {
        let ServerFrame::Up {
            seq,
            upsert,
            remove,
            ..
        } = f
        else {
            panic!()
        };
        assert_eq!(tracker.observe(seq), SeqCheck::InOrder);
        partial.apply(&upsert, &remove);
    }
    assert_eq!(partial, full);
}

#[test]
fn collections_list_matches_the_typescript_prelude() {
    for c in COLLECTIONS {
        assert!(
            crate::ts_export::PRELUDE.contains(c),
            "PRELUDE misses collection {c}"
        );
    }
}
