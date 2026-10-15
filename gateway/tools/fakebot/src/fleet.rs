//! A fleet of fake bots, their ledgers and the fake daemon, in one process.

use std::collections::BTreeMap;
use std::io;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;

use crate::api::{Bot, BotInfo, Mode, WriteRecord, now_ms, router};
use crate::daemon::FakeDaemon;
use crate::ledger::{SeedSpec, Writer, WriterConfig, closed_summary, create_and_seed};

#[derive(Debug, Clone)]
pub struct FleetSpec {
    pub bots: usize,
    /// Directory of the ledgers and of the daemon socket.
    pub dir: PathBuf,
    pub closed_trades: usize,
    pub open_trades: usize,
    pub history_days: i64,
    pub snapshot_every: Duration,
    /// `None` = ledgers are written once and left alone.
    pub writer: Option<WriterConfig>,
    pub seed: u64,
    pub user: String,
    pub password: String,
}

impl FleetSpec {
    #[must_use]
    pub fn new(bots: usize, dir: impl Into<PathBuf>) -> Self {
        Self {
            bots,
            dir: dir.into(),
            closed_trades: 5000,
            open_trades: 3,
            history_days: 180,
            snapshot_every: Duration::from_secs(5),
            writer: Some(WriterConfig::default()),
            seed: 7,
            user: "fake-user".into(),
            password: "fake-pass".into(),
        }
    }
}

/// What the harness prints on its first line: everything a gateway needs to find the bots.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub bots: Vec<BotInfo>,
    pub daemon_socket: String,
    pub dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FleetStats {
    pub total_requests: u64,
    pub per_bot_requests: Vec<u64>,
    /// `"METHOD /route"` to count, all bots together.
    pub by_route: BTreeMap<String, u64>,
    pub ws_opened: u64,
    pub ws_open: usize,
    pub writes: Vec<(usize, WriteRecord)>,
    pub daemon_ops: BTreeMap<String, u64>,
    pub daemon_rejected: Vec<String>,
    pub commits: u64,
}

pub struct Fleet {
    pub manifest: Manifest,
    bots: Vec<Arc<Bot>>,
    daemon: Arc<FakeDaemon>,
    writers: Vec<Writer>,
    tasks: Vec<JoinHandle<()>>,
}

/// Wallet shared by two consecutive live bots, none for dry bots.
fn wallet_of(index: usize, live: bool) -> Option<String> {
    live.then(|| format!("0xfa4e{:036x}", index / 8))
}

impl Fleet {
    /// Seed the ledgers, bind one listener per bot on a free loopback port, start the daemon.
    ///
    /// # Errors
    /// Directory, database or socket errors.
    pub async fn start(spec: FleetSpec) -> io::Result<Self> {
        std::fs::create_dir_all(&spec.dir)?;
        let now = now_ms();
        let mut infos = Vec::with_capacity(spec.bots);
        let mut listeners = Vec::with_capacity(spec.bots);
        for index in 0..spec.bots {
            let listener =
                tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0))).await?;
            let port = listener.local_addr()?.port();
            let live = index % 4 == 0;
            infos.push(BotInfo {
                index,
                name: format!("fake-{index:02}"),
                port,
                db_path: spec
                    .dir
                    .join(format!("tradesv3.fake-{index:02}.sqlite"))
                    .to_string_lossy()
                    .into_owned(),
                live,
                wallet: wallet_of(index, live),
                capital: 1000.0,
                user: spec.user.clone(),
                password: spec.password.clone(),
            });
            listeners.push(listener);
        }

        // Seed the ledgers, at most 6 at a time (shared host).
        let seeds = {
            let infos = infos.clone();
            let spec = spec.clone();
            tokio::task::spawn_blocking(move || -> io::Result<Vec<_>> {
                let mut out = Vec::with_capacity(infos.len());
                for chunk in infos.chunks(6) {
                    let results: Vec<_> = std::thread::scope(|s| {
                        let handles: Vec<_> = chunk
                            .iter()
                            .map(|info| {
                                let seed = SeedSpec {
                                    bot_seed: spec.seed.wrapping_add(info.index as u64 * 7919),
                                    closed_trades: spec.closed_trades,
                                    open_trades: spec.open_trades,
                                    history_days: spec.history_days,
                                    profit_history_every_s: 300,
                                    short_share: 0.5,
                                };
                                let path = PathBuf::from(&info.db_path);
                                s.spawn(move || {
                                    let opens = create_and_seed(&path, &seed, now)?;
                                    let summary = closed_summary(&path)?;
                                    Ok::<_, rusqlite::Error>((opens, summary))
                                })
                            })
                            .collect();
                        handles.into_iter().map(|h| h.join()).collect()
                    });
                    for r in results {
                        let r = r.map_err(|_| io::Error::other("seed thread panicked"))?;
                        out.push(r.map_err(|e| io::Error::other(e.to_string()))?);
                    }
                }
                Ok(out)
            })
            .await
            .map_err(io::Error::other)??
        };

        // Wallet totals: a shared wallet holds the sum of its members.
        let total_bot: Vec<f64> = infos
            .iter()
            .zip(&seeds)
            .map(|(i, (_, s))| i.capital + s.profit_abs)
            .collect();
        let mut wallet_sum: BTreeMap<String, f64> = BTreeMap::new();
        for (i, t) in infos.iter().zip(&total_bot) {
            if let Some(w) = &i.wallet {
                *wallet_sum.entry(w.clone()).or_insert(0.0) += t;
            }
        }

        let mut bots = Vec::with_capacity(spec.bots);
        let mut tasks = Vec::new();
        for ((info, (opens, summary)), listener) in infos.iter().zip(seeds).zip(listeners) {
            let wallet_total = info
                .wallet
                .as_ref()
                .and_then(|w| wallet_sum.get(w).copied())
                .unwrap_or(info.capital + summary.profit_abs);
            let bot = Bot::new(
                info.clone(),
                opens,
                summary,
                wallet_total,
                spec.snapshot_every,
            );
            let app = router(Arc::clone(&bot));
            tasks.push(tokio::spawn(async move {
                let _ = axum::serve(listener, app).await;
            }));
            bots.push(bot);
        }

        let writers = spec
            .writer
            .map(|cfg| {
                infos
                    .iter()
                    .map(|i| {
                        Writer::spawn(
                            std::path::Path::new(&i.db_path),
                            cfg,
                            spec.seed ^ (i.index as u64 + 1),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();

        let socket = spec.dir.join("ftcache-fake.sock");
        let (daemon, dtask) = FakeDaemon::start(&socket, infos.clone())?;
        tasks.push(dtask);

        Ok(Self {
            manifest: Manifest {
                bots: infos,
                daemon_socket: socket.to_string_lossy().into_owned(),
                dir: spec.dir.to_string_lossy().into_owned(),
            },
            bots,
            daemon,
            writers,
            tasks,
        })
    }

    #[must_use]
    pub fn bot(&self, index: usize) -> Option<&Arc<Bot>> {
        self.bots.get(index)
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.bots.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.bots.is_empty()
    }

    pub fn set_mode(&self, index: usize, mode: Mode) {
        if let Some(b) = self.bots.get(index) {
            b.set_mode(mode);
        }
    }

    #[must_use]
    pub fn daemon(&self) -> &Arc<FakeDaemon> {
        &self.daemon
    }

    #[must_use]
    pub fn stats(&self) -> FleetStats {
        let mut by_route: BTreeMap<String, u64> = BTreeMap::new();
        let mut writes = Vec::new();
        let mut per_bot = Vec::with_capacity(self.bots.len());
        let (mut ws_opened, mut ws_open) = (0, 0);
        for (i, b) in self.bots.iter().enumerate() {
            per_bot.push(b.requests());
            for (k, v) in b.route_counts() {
                *by_route.entry(k).or_insert(0) += v;
            }
            writes.extend(b.writes().into_iter().map(|w| (i, w)));
            ws_opened += b.ws_opened.load(Ordering::Relaxed);
            ws_open += b.ws_open.load(Ordering::Relaxed);
        }
        FleetStats {
            total_requests: per_bot.iter().sum(),
            per_bot_requests: per_bot,
            by_route,
            ws_opened,
            ws_open,
            writes,
            daemon_ops: self.daemon.op_counts(),
            daemon_rejected: self.daemon.rejected(),
            commits: self
                .writers
                .iter()
                .map(|w| w.commits.load(Ordering::Relaxed))
                .sum(),
        }
    }
}

impl Drop for Fleet {
    fn drop(&mut self) {
        for t in &self.tasks {
            t.abort();
        }
        let _ = std::fs::remove_file(&self.daemon.path);
    }
}
