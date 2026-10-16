//! Discovery loop and actor supervision: every scan decides which bots exist, starts the actor
//! of a new one, replaces the actor of a bot whose incarnation or credentials changed, and
//! stops the actor of a bot that disappeared.

use std::collections::HashMap;
use std::sync::Arc;

use fg_core::identity::BotKey;
use fg_sources::discovery::{ApiCredentials, DiscoveredBot};
use fg_sources::traits::{BotWs, Discovery};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::connector::BotConnector;
use crate::meta::{BotMeta, meta_from_discovered};
use crate::msg::{Msg, Obs};
use crate::shared::Shared;
use fg_core::model::BotStatus;

struct Running {
    task: JoinHandle<()>,
    incarnation: String,
    listen: (String, Option<u16>),
    credentials: Option<ApiCredentials>,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn same_link(r: &Running, b: &DiscoveredBot, meta: &BotMeta) -> bool {
    r.incarnation == meta.incarnation
        && r.listen == (b.config.api.listen_ip.clone(), b.config.api.listen_port)
        && r.credentials == b.config.api.credentials
}

pub(crate) async fn run(
    shared: Arc<Shared>,
    discovery: Arc<dyn Discovery>,
    connector: Arc<dyn BotConnector>,
    ws: Arc<dyn BotWs>,
) {
    let mut running: HashMap<BotKey, Running> = HashMap::new();
    loop {
        let scan = {
            let d = Arc::clone(&discovery);
            tokio::task::spawn_blocking(move || d.scan()).await
        };
        if let Ok(report) = scan {
            let now = shared.now_ms();
            let mut metas = Vec::new();
            let mut to_start = Vec::new();
            for bot in &report.bots {
                let Some(meta) = meta_from_discovered(bot, now) else {
                    continue;
                };
                let keep = running
                    .get(&meta.key)
                    .is_some_and(|r| same_link(r, bot, &meta));
                if !keep {
                    to_start.push((meta.clone(), bot));
                }
                metas.push(meta);
            }
            let present: Vec<BotKey> = metas.iter().map(|m| m.key.clone()).collect();
            // Actors of bots that are gone stop with their `Running` guard.
            running.retain(|k, _| present.contains(k));
            if let Ok(mut links) = shared.links.write() {
                links.retain(|k, _| present.contains(k));
            }
            if let Ok(mut n) = shared.nudges.write() {
                n.retain(|k, _| present.contains(k));
            }
            // The core must know the bots before it receives their observations.
            let _ = shared.core_tx.send(Msg::Discovered(metas)).await;
            for (meta, bot) in to_start {
                running.remove(&meta.key);
                if let Ok(mut links) = shared.links.write() {
                    links.remove(&meta.key);
                }
                match connector.link(bot) {
                    Some(link) => {
                        let (nudge_tx, nudge_rx) = mpsc::channel(4);
                        if let Ok(mut links) = shared.links.write() {
                            links.insert(meta.key.clone(), link.clone());
                        }
                        if let Ok(mut n) = shared.nudges.write() {
                            n.insert(meta.key.clone(), nudge_tx);
                        }
                        let task = tokio::spawn(crate::actor::run(
                            meta.key.clone(),
                            link,
                            Arc::clone(&ws),
                            Arc::clone(&shared),
                            nudge_rx,
                        ));
                        running.insert(
                            meta.key.clone(),
                            Running {
                                task,
                                incarnation: meta.incarnation.clone(),
                                listen: (
                                    bot.config.api.listen_ip.clone(),
                                    bot.config.api.listen_port,
                                ),
                                credentials: bot.config.api.credentials.clone(),
                            },
                        );
                    }
                    None => {
                        // No credentials: nothing can be read from this bot's API.
                        if let Ok(mut n) = shared.nudges.write() {
                            n.remove(&meta.key);
                        }
                        let _ = shared
                            .core_tx
                            .send(Msg::Bot {
                                key: meta.key.clone(),
                                at_ms: now,
                                obs: Obs::Status(BotStatus::AuthExpired),
                            })
                            .await;
                    }
                }
            }
        }
        tokio::time::sleep(shared.cfg.cadences.discovery).await;
    }
}
