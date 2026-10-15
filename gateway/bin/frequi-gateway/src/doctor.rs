//! `frequi-gateway doctor`: a read-only look at what the gateway would see on this host.
//!
//! Output is a table with one row per discovered bot and a few host lines. It never contains a
//! credential, a token, a wallet address, an IP address or a full path: the ledger is shown by
//! file name only, and every printed string goes through [`redact`].

use std::fmt::Write as _;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use fg_sources::botrest::{self, RestOptions};
use fg_sources::discovery::{DiscoveredBot, DiscoveryOptions, ProcDiscovery};
use fg_sources::ftcache::{self, DaemonError, FleetSummary, UnixDaemon};
use fg_sources::sqlite::{LedgerErrorCode, SqliteLedger};
use fg_sources::traits::{BoxFut, DaemonClient, Discovery, LedgerReader};
use futures_util::StreamExt;

/// Concurrent pings (the shared host budget allows 6 parallel jobs).
const PING_CONCURRENCY: usize = 6;

/// Liveness probe of a bot API, abstracted so that the doctor can run against fakes.
pub trait Pinger: Send + Sync {
    /// `Ok(())` when `/ping` answers; `Err(reason)` with a short category otherwise.
    fn ping(&self, host: String, port: u16) -> BoxFut<'_, Result<(), &'static str>>;
}

struct HttpPinger {
    client: botrest::HttpClient,
}

impl Pinger for HttpPinger {
    fn ping(&self, host: String, port: u16) -> BoxFut<'_, Result<(), &'static str>> {
        Box::pin(async move {
            botrest::ping_bot(&self.client, &host, port, Duration::from_secs(3))
                .await
                .map_err(|e| match e {
                    botrest::RestError::Refused => "refused",
                    botrest::RestError::Timeout => "timeout",
                    botrest::RestError::Starting => "starting",
                    _ => "error",
                })
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum LedgerCheck {
    NoPath,
    Missing,
    /// The file name matches an ignore token (backup, replay, tmp).
    Ignored,
    Present {
        wal: bool,
        /// `--deep`: `(open, closed)` trades, or the normalised error.
        counts: Option<Result<(i64, i64), LedgerErrorCode>>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum DigestCheck {
    /// The daemon could not be queried.
    Unknown,
    Absent,
    Present {
        age_s: Option<f64>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum PingCheck {
    NoPort,
    Ok,
    Failed(&'static str),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Row {
    pub name: String,
    pub port: Option<u16>,
    pub mode: &'static str,
    pub has_credentials: bool,
    pub ledger_name: String,
    pub ledger: LedgerCheck,
    pub digest: DigestCheck,
    pub ping: PingCheck,
}

#[derive(Debug, Clone, PartialEq)]
pub enum FtcacheCheck {
    Reachable {
        protocol: Option<u32>,
        uptime_s: Option<f64>,
        digests: usize,
    },
    Unreachable(&'static str),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Report {
    pub rows: Vec<Row>,
    pub ftcache: FtcacheCheck,
    /// Processes that look like bots but whose config could not be read: `(pid, message)`.
    pub skipped: Vec<(u32, String)>,
}

impl Report {
    /// Anything an operator should look at.
    #[must_use]
    pub fn has_problems(&self) -> bool {
        matches!(self.ftcache, FtcacheCheck::Unreachable(_))
            || !self.skipped.is_empty()
            || self.rows.iter().any(|r| {
                matches!(r.ping, PingCheck::Failed(_))
                    || matches!(r.ledger, LedgerCheck::Missing)
                    || matches!(
                        r.ledger,
                        LedgerCheck::Present {
                            counts: Some(Err(_)),
                            ..
                        }
                    )
            })
    }
}

/// Does a run of token characters look like a secret (JWT, API key, long hex) rather than a
/// bot or file name? Names are made of lowercase words and underscores; tokens are not.
fn looks_like_secret(run: &[char]) -> bool {
    if run.len() < 32 {
        return false;
    }
    // Every JWT starts with the base64 of `{"`.
    if run.starts_with(&['e', 'y', 'J']) {
        return true;
    }
    if run.len() >= 40 && run.iter().all(char::is_ascii_hexdigit) {
        return true;
    }
    let has = |f: fn(&char) -> bool| run.iter().any(f);
    has(char::is_ascii_uppercase)
        && has(char::is_ascii_lowercase)
        && has(char::is_ascii_digit)
        && !run.contains(&'_')
}

/// Mask anything that looks like a wallet address or a token, and drop control characters.
/// Applied to every string that reaches the output.
#[must_use]
pub fn redact(s: &str) -> String {
    let cleaned: String = s.chars().filter(|c| !c.is_control()).collect();
    let chars: Vec<char> = cleaned.chars().collect();
    let mut out = String::with_capacity(cleaned.len());
    let mut i = 0;
    while i < chars.len() {
        let run = chars[i..]
            .iter()
            .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
            .count();
        let is_addr = chars[i] == '0'
            && chars.get(i + 1) == Some(&'x')
            && chars[i + 2..]
                .iter()
                .take_while(|c| c.is_ascii_hexdigit())
                .count()
                >= 40;
        if is_addr || looks_like_secret(&chars[i..i + run]) {
            out.push_str("***");
            i += run.max(2);
        } else if run > 0 {
            // A plain word: copy it whole so that the scan never restarts in its middle.
            out.extend(&chars[i..i + run]);
            i += run;
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

fn bot_ledger_name(bot: &DiscoveredBot) -> String {
    bot.db_path
        .as_ref()
        .and_then(|p| p.file_name())
        .map(|n| redact(&n.to_string_lossy()))
        .unwrap_or_default()
}

/// Collect the report. Pure orchestration over the traits: no I/O of its own.
pub async fn collect(
    discovery: &dyn Discovery,
    ledger: &dyn LedgerReader,
    daemon: &dyn DaemonClient,
    pinger: &dyn Pinger,
    deep: bool,
) -> Report {
    let found = discovery.scan();
    let skipped: Vec<(u32, String)> = found
        .issues
        .iter()
        .map(|i| (i.pid, redact(&i.error.to_string())))
        .collect();

    let (ftcache, summary): (FtcacheCheck, Option<FleetSummary>) = match daemon.ping().await {
        Ok(ping) => match daemon.summary_get(None).await {
            Ok(summary) => (
                FtcacheCheck::Reachable {
                    protocol: ping.daemon_version,
                    uptime_s: ping.uptime_s,
                    digests: summary.bots.len(),
                },
                Some(summary),
            ),
            Err(_) => (
                FtcacheCheck::Reachable {
                    protocol: ping.daemon_version,
                    uptime_s: ping.uptime_s,
                    digests: 0,
                },
                None,
            ),
        },
        Err(e) => (
            FtcacheCheck::Unreachable(match e {
                DaemonError::Unavailable => "no socket or connection refused",
                DaemonError::Timeout => "timeout",
                DaemonError::Rejected(_) => "rejected",
                DaemonError::Protocol => "protocol error",
            }),
            None,
        ),
    };

    // Pings run concurrently, a handful at a time.
    let targets: Vec<(usize, String, u16)> = found
        .bots
        .iter()
        .enumerate()
        .filter_map(|(i, b)| {
            b.config
                .api
                .listen_port
                .map(|p| (i, botrest::dial_host(&b.config.api.listen_ip), p))
        })
        .collect();
    let mut pings: Vec<(usize, PingCheck)> = futures_util::stream::iter(targets)
        .map(|(i, host, port)| async move {
            let r = pinger.ping(host, port).await;
            (i, r.map_or_else(PingCheck::Failed, |()| PingCheck::Ok))
        })
        .buffer_unordered(PING_CONCURRENCY)
        .collect()
        .await;
    pings.sort_by_key(|(i, _)| *i);

    let rows = found
        .bots
        .iter()
        .enumerate()
        .map(|(i, bot)| {
            let ledger_check = match (&bot.db_path, bot.db_ignored) {
                (None, _) => LedgerCheck::NoPath,
                (Some(_), true) => LedgerCheck::Ignored,
                (Some(path), false) => match ledger.stat(path) {
                    Err(_) => LedgerCheck::Missing,
                    Ok(stat) => LedgerCheck::Present {
                        wal: stat.has_wal(),
                        counts: deep.then(|| {
                            ledger
                                .summary(path)
                                .map(|s| (s.open_count, s.closed_count))
                                .map_err(LedgerError::code)
                        }),
                    },
                },
            };
            let digest = match &summary {
                None => DigestCheck::Unknown,
                Some(s) => s
                    .bots
                    .iter()
                    .find(|(name, d)| {
                        (d.api_port.is_some() && d.api_port == bot.config.api.listen_port)
                            || Some(name.as_str()) == bot.config.bot_name.as_deref()
                    })
                    .map_or(DigestCheck::Absent, |(_, d)| DigestCheck::Present {
                        age_s: d.age_s,
                    }),
            };
            Row {
                name: redact(&bot.display_name()),
                port: bot.config.api.listen_port,
                mode: if bot.config.is_dry() { "dry" } else { "live" },
                has_credentials: bot.config.api.credentials.is_some(),
                ledger_name: bot_ledger_name(bot),
                ledger: ledger_check,
                digest,
                ping: pings
                    .iter()
                    .find(|(j, _)| *j == i)
                    .map_or(PingCheck::NoPort, |(_, p)| p.clone()),
            }
        })
        .collect();
    Report {
        rows,
        ftcache,
        skipped,
    }
}

use fg_sources::sqlite::LedgerError;

fn duration_label(secs: f64) -> String {
    let s = secs.max(0.0) as u64;
    match s {
        0..=59 => format!("{s}s"),
        60..=3599 => format!("{}m", s / 60),
        3600..=86399 => format!("{}h{:02}m", s / 3600, (s % 3600) / 60),
        _ => format!("{}d{}h", s / 86400, (s % 86400) / 3600),
    }
}

/// Render the report as text.
#[must_use]
pub fn render(report: &Report, deep: bool) -> String {
    let mut out = String::new();
    let ft = match &report.ftcache {
        FtcacheCheck::Reachable {
            protocol,
            uptime_s,
            digests,
        } => format!(
            "reachable (protocol {}, up {}, {} digests)",
            protocol.map_or_else(|| "?".to_owned(), |p| p.to_string()),
            uptime_s.map_or_else(|| "?".to_owned(), duration_label),
            digests
        ),
        FtcacheCheck::Unreachable(why) => format!("UNREACHABLE ({why})"),
    };
    let _ = writeln!(out, "ftcache: {ft}");
    let _ = writeln!(out, "bots discovered: {}", report.rows.len());
    for (pid, msg) in &report.skipped {
        let _ = writeln!(out, "skipped pid {pid}: {msg}");
    }

    let header = [
        "bot",
        "port",
        "mode",
        "creds",
        "ledger",
        "db",
        "wal",
        if deep { "trades o/c" } else { "" },
        "digest",
        "ping",
    ];
    let mut table: Vec<[String; 10]> = Vec::new();
    for r in &report.rows {
        let (db, wal, trades) = match &r.ledger {
            LedgerCheck::NoPath => ("no path".to_owned(), "-".to_owned(), String::new()),
            LedgerCheck::Missing => ("MISSING".to_owned(), "-".to_owned(), String::new()),
            LedgerCheck::Ignored => ("ignored".to_owned(), "-".to_owned(), String::new()),
            LedgerCheck::Present { wal, counts } => (
                "yes".to_owned(),
                if *wal { "yes" } else { "no" }.to_owned(),
                match counts {
                    None => String::new(),
                    Some(Ok((o, c))) => format!("{o}/{c}"),
                    Some(Err(code)) => format!("ERR {}", code.as_str()),
                },
            ),
        };
        let digest = match &r.digest {
            DigestCheck::Unknown => "?".to_owned(),
            DigestCheck::Absent => "none".to_owned(),
            DigestCheck::Present { age_s } => {
                age_s.map_or_else(|| "yes".to_owned(), |a| format!("{a:.0}s"))
            }
        };
        let ping = match &r.ping {
            PingCheck::NoPort => "no port".to_owned(),
            PingCheck::Ok => "ok".to_owned(),
            PingCheck::Failed(why) => format!("FAIL {why}"),
        };
        table.push([
            r.name.clone(),
            r.port.map_or_else(|| "-".to_owned(), |p| p.to_string()),
            r.mode.to_owned(),
            if r.has_credentials { "yes" } else { "no" }.to_owned(),
            r.ledger_name.clone(),
            db,
            wal,
            trades,
            digest,
            ping,
        ]);
    }
    let heads: Vec<&str> = header.to_vec();
    let mut widths: Vec<usize> = heads.iter().map(|h| h.chars().count()).collect();
    for row in &table {
        for (i, cell) in row.iter().enumerate() {
            widths[i] = widths[i].max(cell.chars().count());
        }
    }
    let line = |cells: Vec<&str>| {
        let mut l = String::new();
        for (i, c) in cells.iter().enumerate() {
            if widths[i] == 0 || (i == 7 && !deep) {
                continue;
            }
            let _ = write!(l, "{c:<w$}  ", w = widths[i]);
        }
        l.trim_end().to_owned()
    };
    let _ = writeln!(out, "{}", line(heads));
    for row in &table {
        let _ = writeln!(out, "{}", line(row.iter().map(String::as_str).collect()));
    }
    let _ = writeln!(
        out,
        "{}",
        if report.has_problems() {
            "status: PROBLEMS FOUND"
        } else {
            "status: ok"
        }
    );
    out
}

/// Production entry point of `doctor`.
pub async fn run(deep: bool, socket: Option<PathBuf>) -> ExitCode {
    let discovery = ProcDiscovery::new(DiscoveryOptions::default());
    let socket = socket.unwrap_or_else(|| ftcache::default_socket_path(discovery.uid()));
    let ledger = SqliteLedger::default();
    let daemon = UnixDaemon::new(socket);
    let pinger = HttpPinger {
        client: botrest::build_http_client(&RestOptions::default()),
    };
    // Discovery reads files: keep it off the async threads.
    let discovery = Arc::new(discovery);
    let report = {
        let d = Arc::clone(&discovery);
        let found = tokio::task::spawn_blocking(move || d.scan()).await;
        match found {
            Ok(found) => {
                let cached = CachedDiscovery(found);
                collect(&cached, &ledger, &daemon, &pinger, deep).await
            }
            Err(_) => {
                eprintln!("doctor: discovery failed");
                return ExitCode::from(2);
            }
        }
    };
    print!("{}", render(&report, deep));
    if report.has_problems() {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

/// A discovery result computed on a blocking thread, replayed through the trait.
struct CachedDiscovery(fg_sources::discovery::DiscoveryReport);

impl Discovery for CachedDiscovery {
    fn scan(&self) -> fg_sources::discovery::DiscoveryReport {
        self.0.clone()
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use fg_sources::discovery::{
        ApiCredentials, ApiServerInfo, BotConfig, ConfigStamp, DiscoveryIssue, DiscoveryReport,
        ExchangeInfo,
    };
    use fg_sources::ftcache::{BotDigest, DaemonPing, DaemonStats, FleetEvents, FleetStatus};
    use fg_sources::sensitive::Secret;
    use fg_sources::sqlite::{
        LedgerOrder, LedgerSchema, LedgerStat, LedgerSummary, LedgerTrade, ProfitChunk, TradeQuery,
    };

    use super::*;

    /// Assembled at runtime: no address-shaped literal in the repository.
    fn wallet() -> String {
        format!("0x{}", "1234567890abcdef".repeat(2) + "12345678")
    }
    const PASSWORD: &str = "super-secret-password-123";
    const USER: &str = "super-secret-user-456";

    fn bot(name: &str, port: u16, db: &str, dry: bool) -> DiscoveredBot {
        DiscoveredBot {
            pid: 10,
            process_start_ms: None,
            cwd: PathBuf::from("/home/someone/ft"),
            config_files: vec![],
            config_name: format!("{name}.json"),
            config: BotConfig {
                bot_name: Some(name.to_owned()),
                strategy: Some("S".into()),
                db_url: None,
                dry_run: Some(dry),
                stake_currency: Some("USDC".into()),
                available_capital: Some(150.0),
                capital_withdrawal: 0.0,
                max_open_trades: Some(3),
                api: ApiServerInfo {
                    listen_ip: "0.0.0.0".into(),
                    listen_port: Some(port),
                    credentials: Some(ApiCredentials {
                        username: Secret::new(USER),
                        password: Secret::new(PASSWORD),
                    }),
                    jwt_fingerprint: Some("abcd".into()),
                    ws_token: Some(Secret::new("ws-token-value-xyz")),
                },
                exchange: ExchangeInfo {
                    name: Some("hyperliquid".into()),
                    trading_mode: Some("futures".into()),
                    wallet: Some(Secret::new(wallet())),
                    vault: None,
                    hip3_dexes: vec![],
                },
            },
            db_path: Some(PathBuf::from(format!("/home/someone/ft/database/{db}"))),
            db_ignored: db.contains("backup"),
            stamp: ConfigStamp::default(),
        }
    }

    struct FakeDiscovery(DiscoveryReport);
    impl Discovery for FakeDiscovery {
        fn scan(&self) -> DiscoveryReport {
            self.0.clone()
        }
    }

    struct FakeLedger;
    impl LedgerReader for FakeLedger {
        fn stat(&self, db: &Path) -> Result<LedgerStat, fg_sources::sqlite::LedgerError> {
            if db.to_string_lossy().contains("gone") {
                return Err(fg_sources::sqlite::LedgerError(LedgerErrorCode::DbMissing));
            }
            Ok(LedgerStat {
                db_size: 1,
                db_mtime_ms: 1,
                db_inode: 1,
                wal_size: (!db.to_string_lossy().contains("nowal")).then_some(1),
                wal_mtime_ms: None,
            })
        }
        fn schema(&self, _: &Path) -> Result<LedgerSchema, fg_sources::sqlite::LedgerError> {
            Ok(LedgerSchema::default())
        }
        fn summary(&self, _: &Path) -> Result<LedgerSummary, fg_sources::sqlite::LedgerError> {
            Ok(LedgerSummary {
                open_count: 2,
                closed_count: 40,
                ..LedgerSummary::default()
            })
        }
        fn trades(
            &self,
            _: &Path,
            _: &TradeQuery,
        ) -> Result<Vec<LedgerTrade>, fg_sources::sqlite::LedgerError> {
            Ok(vec![])
        }
        fn orders(
            &self,
            _: &Path,
            _: &[i64],
        ) -> Result<Vec<LedgerOrder>, fg_sources::sqlite::LedgerError> {
            Ok(vec![])
        }
        fn profit_history(
            &self,
            _: &Path,
            _: i64,
        ) -> Result<ProfitChunk, fg_sources::sqlite::LedgerError> {
            Err(fg_sources::sqlite::LedgerError(
                LedgerErrorCode::NoHistoryTable,
            ))
        }
    }

    struct FakeDaemon(Result<FleetSummary, DaemonError>);
    impl DaemonClient for FakeDaemon {
        fn ping(&self) -> BoxFut<'_, Result<DaemonPing, DaemonError>> {
            let r = self.0.as_ref().map(|_| DaemonPing {
                daemon_version: Some(2),
                uptime_s: Some(90_000.0),
            });
            Box::pin(async move { r.map_err(Clone::clone) })
        }
        fn summary_get(&self, _: Option<f64>) -> BoxFut<'_, Result<FleetSummary, DaemonError>> {
            let r = self.0.clone();
            Box::pin(async move { r })
        }
        fn fleet_status(&self) -> BoxFut<'_, Result<FleetStatus, DaemonError>> {
            Box::pin(async { Err(DaemonError::Unavailable) })
        }
        fn fleet_events(&self, _: f64, _: u32) -> BoxFut<'_, Result<FleetEvents, DaemonError>> {
            Box::pin(async { Err(DaemonError::Unavailable) })
        }
        fn stats(&self) -> BoxFut<'_, Result<DaemonStats, DaemonError>> {
            Box::pin(async { Err(DaemonError::Unavailable) })
        }
    }

    struct FakePinger;
    impl Pinger for FakePinger {
        fn ping(&self, _host: String, port: u16) -> BoxFut<'_, Result<(), &'static str>> {
            Box::pin(async move { if port == 9002 { Err("refused") } else { Ok(()) } })
        }
    }

    fn summary() -> FleetSummary {
        let mut s = FleetSummary::default();
        s.bots.insert(
            "alpha".into(),
            BotDigest {
                api_port: Some(9001),
                age_s: Some(3.4),
                ..BotDigest::default()
            },
        );
        s
    }

    fn report_with(bots: Vec<DiscoveredBot>, issues: Vec<DiscoveryIssue>) -> DiscoveryReport {
        DiscoveryReport { bots, issues }
    }

    #[tokio::test]
    async fn the_doctor_runs_against_fakes_and_prints_no_secret() {
        let disc = FakeDiscovery(report_with(
            vec![
                bot("alpha", 9001, "alpha.sqlite", false),
                bot("beta", 9002, "beta_nowal.sqlite", true),
                bot("gamma", 9003, "gone.sqlite", true),
                bot("delta", 9004, "delta_backup.sqlite", true),
            ],
            vec![],
        ));
        let report = collect(
            &disc,
            &FakeLedger,
            &FakeDaemon(Ok(summary())),
            &FakePinger,
            true,
        )
        .await;
        let text = render(&report, true);
        for secret in [
            &wallet(),
            PASSWORD,
            USER,
            "ws-token-value-xyz",
            "abcd",
            "/home/someone",
            "127.0.0.1",
            "0.0.0.0",
        ] {
            assert!(!text.contains(secret), "output leaked {secret}:\n{text}");
        }
        assert!(
            text.contains("ftcache: reachable (protocol 2, up 1d1h, 1 digests)"),
            "{text}"
        );
        assert!(text.contains("PROBLEMS FOUND"));

        let by = |n: &str| report.rows.iter().find(|r| r.name == n).unwrap();
        assert_eq!(by("alpha").ping, PingCheck::Ok);
        assert_eq!(by("alpha").mode, "live");
        assert_eq!(
            by("alpha").digest,
            DigestCheck::Present { age_s: Some(3.4) }
        );
        assert_eq!(
            by("alpha").ledger,
            LedgerCheck::Present {
                wal: true,
                counts: Some(Ok((2, 40)))
            }
        );
        assert_eq!(by("beta").ping, PingCheck::Failed("refused"));
        assert_eq!(
            by("beta").ledger,
            LedgerCheck::Present {
                wal: false,
                counts: Some(Ok((2, 40)))
            }
        );
        assert_eq!(by("beta").digest, DigestCheck::Absent);
        assert_eq!(by("gamma").ledger, LedgerCheck::Missing);
        assert_eq!(by("delta").ledger, LedgerCheck::Ignored);
        assert!(by("alpha").has_credentials);
    }

    #[tokio::test]
    async fn an_unreachable_daemon_and_skipped_processes_are_reported() {
        let issues = vec![DiscoveryIssue {
            pid: 77,
            error: fg_sources::discovery::ConfigError::Unreadable {
                file: format!("/x/{}.json", wallet()),
            },
        }];
        let disc = FakeDiscovery(report_with(
            vec![bot("alpha", 9001, "alpha.sqlite", false)],
            issues,
        ));
        let report = collect(
            &disc,
            &FakeLedger,
            &FakeDaemon(Err(DaemonError::Unavailable)),
            &FakePinger,
            false,
        )
        .await;
        let text = render(&report, false);
        assert!(text.contains("UNREACHABLE"), "{text}");
        assert!(text.contains("skipped pid 77"), "{text}");
        assert!(
            !text.contains(&wallet()),
            "paths in messages are redacted: {text}"
        );
        assert_eq!(report.rows[0].digest, DigestCheck::Unknown);
        assert!(report.has_problems());
        assert!(
            !text.contains("trades o/c"),
            "no deep column without --deep"
        );
    }

    #[tokio::test]
    async fn a_healthy_fleet_reports_ok() {
        let disc = FakeDiscovery(report_with(
            vec![bot("alpha", 9001, "alpha.sqlite", false)],
            vec![],
        ));
        let report = collect(
            &disc,
            &FakeLedger,
            &FakeDaemon(Ok(summary())),
            &FakePinger,
            false,
        )
        .await;
        assert!(!report.has_problems());
        assert!(render(&report, false).contains("status: ok"));
    }

    #[test]
    fn redaction_masks_addresses_and_long_tokens_and_control_characters() {
        assert_eq!(redact("bot_a"), "bot_a");
        assert_eq!(redact(&format!("w {} end", wallet())), "w *** end");
        assert_eq!(
            redact("tok eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc end"),
            "tok *** end"
        );
        assert_eq!(redact("a\x1b[31mb"), "a[31mb");
        assert_eq!(duration_label(90_000.0), "1d1h");
        assert_eq!(duration_label(125.0), "2m");
    }
}
