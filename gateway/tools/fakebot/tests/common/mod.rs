//! Helpers shared by the integration tests: the fakebot process, discovery from its manifest,
//! and `/proc` readings of the test process (which hosts the engine under test).

#![allow(dead_code)]

use std::path::PathBuf;
use std::process::Stdio;

use fakebot::{BotInfo, FleetStats, Manifest};
use fg_sources::discovery::{
    ApiCredentials, ApiServerInfo, BotConfig, ConfigStamp, DiscoveredBot, DiscoveryReport,
    ExchangeInfo,
};
use fg_sources::sensitive::Secret;
use fg_sources::traits::Discovery;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

/// A running `fakebot` process, driven over its stdin/stdout protocol. Killed on drop.
pub struct Harness {
    child: Child,
    stdin: ChildStdin,
    out: Lines<BufReader<ChildStdout>>,
    pub manifest: Manifest,
}

impl Harness {
    pub async fn spawn(args: &[String]) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_fakebot"))
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .expect("spawn fakebot");
        let stdin = child.stdin.take().expect("stdin");
        let mut out = BufReader::new(child.stdout.take().expect("stdout")).lines();
        let first = tokio::time::timeout(std::time::Duration::from_secs(120), out.next_line())
            .await
            .expect("fakebot manifest in time")
            .expect("read manifest")
            .expect("manifest line");
        let manifest: Manifest = serde_json::from_str(&first).expect("manifest json");
        Self {
            child,
            stdin,
            out,
            manifest,
        }
    }

    pub async fn ask(&mut self, cmd: Value) -> Value {
        let mut line = cmd.to_string();
        line.push('\n');
        self.stdin.write_all(line.as_bytes()).await.expect("write");
        self.stdin.flush().await.expect("flush");
        let reply = self
            .out
            .next_line()
            .await
            .expect("read reply")
            .expect("reply line");
        serde_json::from_str(&reply).expect("reply json")
    }

    pub async fn stats(&mut self) -> FleetStats {
        let r = self.ask(json!({"cmd": "stats"})).await;
        serde_json::from_value(r["stats"].clone()).expect("stats")
    }

    /// Ask the process to leave and wait for it.
    pub async fn quit(mut self) {
        let _ = self.ask(json!({"cmd": "quit"})).await;
        drop(self.stdin);
        let _ = self.child.wait().await;
    }
}

pub fn discovered(info: &BotInfo) -> DiscoveredBot {
    DiscoveredBot {
        pid: 1000 + u32::from(info.port),
        process_start_ms: Some(1_700_000_000_000),
        cwd: PathBuf::from("/fake"),
        config_files: vec![],
        config_name: format!("{}.json", info.name),
        config: BotConfig {
            bot_name: Some(info.name.clone()),
            strategy: Some("FakeStrategy".into()),
            db_url: None,
            dry_run: Some(!info.live),
            stake_currency: Some("USDC".into()),
            available_capital: Some(info.capital),
            capital_withdrawal: 0.0,
            max_open_trades: Some(3),
            api: ApiServerInfo {
                listen_ip: "127.0.0.1".into(),
                listen_port: Some(info.port),
                credentials: Some(ApiCredentials {
                    username: Secret::new(info.user.as_str()),
                    password: Secret::new(info.password.as_str()),
                }),
                jwt_fingerprint: None,
                ws_token: None,
            },
            exchange: ExchangeInfo {
                name: Some("hyperliquid".into()),
                trading_mode: Some("futures".into()),
                wallet: info.wallet.as_deref().map(Secret::new),
                vault: None,
                hip3_dexes: vec![],
            },
        },
        db_path: Some(PathBuf::from(&info.db_path)),
        db_ignored: false,
        stamp: ConfigStamp::default(),
    }
}

/// Discovery that always reports the bots of a manifest.
pub struct ManifestDiscovery(pub Vec<DiscoveredBot>);

impl Discovery for ManifestDiscovery {
    fn scan(&self) -> DiscoveryReport {
        DiscoveryReport {
            bots: self.0.clone(),
            issues: Vec::new(),
        }
    }
}

/// CPU time (user + system) of this process, in seconds. `CLK_TCK` is 100 on Linux.
pub fn cpu_seconds() -> f64 {
    let stat = std::fs::read_to_string("/proc/self/stat").unwrap_or_default();
    // The command name is parenthesised and may contain spaces: fields start after the last ')'.
    let rest = stat.rsplit_once(')').map_or("", |(_, r)| r);
    let f: Vec<&str> = rest.split_whitespace().collect();
    let tick = |i: usize| f.get(i).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
    // After ')': state is field 0, utime is 11, stime is 12.
    (tick(11) + tick(12)) / 100.0
}

fn status_kb(key: &str) -> u64 {
    std::fs::read_to_string("/proc/self/status")
        .unwrap_or_default()
        .lines()
        .find_map(|l| l.strip_prefix(key))
        .and_then(|v| v.split_whitespace().next()?.parse().ok())
        .unwrap_or(0)
}

/// Peak resident set size of this process, in megabytes.
pub fn peak_rss_mb() -> f64 {
    status_kb("VmHWM:") as f64 / 1024.0
}

/// Number of threads of this process.
pub fn thread_count() -> u64 {
    status_kb("Threads:")
}

/// Anonymous (heap, stacks) and file-backed (executable, shared libraries) parts of the resident
/// size, in megabytes.
pub fn rss_split_mb() -> (f64, f64) {
    (
        status_kb("RssAnon:") as f64 / 1024.0,
        status_kb("RssFile:") as f64 / 1024.0,
    )
}

pub fn rss_mb() -> f64 {
    status_kb("VmRSS:") as f64 / 1024.0
}

/// CPU seconds per thread of this process: `(tid, name, seconds)`.
pub fn thread_cpu() -> Vec<(u32, String, f64)> {
    let mut out = Vec::new();
    let Ok(dir) = std::fs::read_dir("/proc/self/task") else {
        return out;
    };
    for e in dir.flatten() {
        let Some(tid) = e.file_name().to_str().and_then(|t| t.parse::<u32>().ok()) else {
            continue;
        };
        let stat = std::fs::read_to_string(e.path().join("stat")).unwrap_or_default();
        let name = stat
            .split_once('(')
            .and_then(|(_, r)| r.rsplit_once(')'))
            .map(|(n, _)| n.to_owned())
            .unwrap_or_default();
        let rest = stat.rsplit_once(')').map_or("", |(_, r)| r);
        let f: Vec<&str> = rest.split_whitespace().collect();
        let tick = |i: usize| f.get(i).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
        out.push((tid, name, (tick(11) + tick(12)) / 100.0));
    }
    out
}
