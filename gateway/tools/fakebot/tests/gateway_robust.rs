//! A bot that misbehaves while staying "up" must not hurt the rest of the fleet: here, `/status`
//! answers 200 with something that is not a list of trades.

mod common;
mod gw_rig;

use std::time::Duration;

use fakebot::OddBody;
use gw_rig::{Gw, Opts};

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn an_odd_status_body_neither_blocks_the_positions_of_other_bots_nor_wipes_its_own() {
    for odd in [
        OddBody::Object,
        OddBody::Html,
        OddBody::Null,
        OddBody::Strings,
    ] {
        let gw = Gw::start(Opts {
            bots: 5,
            closed: 5,
            // No price over the WebSocket for a long while: `/status` is the only price source.
            snapshot_every: Duration::from_secs(3600),
            odd_status: vec![(1, odd)],
            ..Opts::default()
        })
        .await;
        gw.wait_online(5, Duration::from_secs(60)).await;
        let odd_key = gw.key(1);
        // Give `/status` several rounds (cadences are compressed 20 times).
        tokio::time::sleep(Duration::from_secs(6)).await;
        let routes = gw.fleet.bot(1).unwrap().route_counts();
        let polled: u64 = routes
            .iter()
            .filter(|(k, _)| k.ends_with("/status"))
            .map(|(_, n)| *n)
            .sum();
        assert!(
            polled >= 2,
            "{odd:?}: /status of the odd bot was polled ({routes:?})"
        );

        let p = gw.engine.handle().published();
        for i in [0, 2, 3, 4] {
            let k = gw.key(i);
            let mine: Vec<_> = p
                .positions
                .values()
                .filter(|x| x.bot_key.to_string() == k)
                .collect();
            if p.bots[&mine_key(&gw, i)].state.open_trades == 0 {
                continue;
            }
            assert!(!mine.is_empty(), "{odd:?}: positions of {k} are published");
            assert!(
                mine.iter()
                    .any(|x| x.current_rate.is_some() && !x.freshness.stale),
                "{odd:?}: {k} has fresh prices from /status"
            );
        }
        // The odd bot is alive and keeps its positions (from its ledger), without invented prices.
        let row = &p.bots[&mine_key(&gw, 1)];
        assert_eq!(
            row.state.status,
            fg_core::model::BotStatus::Online,
            "{odd_key}"
        );
        assert!(
            p.positions
                .values()
                .all(|x| x.bot_key.to_string() != odd_key
                    || x.current_rate.is_none()
                    || x.freshness.stale)
        );
        gw.stop().await;
    }
}

fn mine_key(gw: &Gw, i: usize) -> fg_core::identity::BotKey {
    fg_core::identity::BotKey::Local(gw.port(i))
}
