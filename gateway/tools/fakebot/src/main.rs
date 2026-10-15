//! `fakebot`: N fake freqtrade bots in one process, controlled over stdin/stdout.
//!
//! The first line printed is the manifest (ports, ledger paths, credentials, daemon socket).
//! Then one JSON command per line on stdin (see `control`), one JSON reply per line.

use std::path::PathBuf;
use std::time::Duration;

use clap::Parser;
use fakebot::{Fleet, FleetSpec, WriterConfig};

#[derive(Parser, Debug)]
#[command(about = "Fake freqtrade bots (REST, WebSocket, SQLite ledger) and a fake ftcache daemon")]
struct Args {
    /// Number of fake bots.
    #[arg(long, default_value_t = 4)]
    bots: usize,
    /// Directory of the ledgers and of the daemon socket.
    #[arg(long)]
    dir: PathBuf,
    /// Closed trades per ledger.
    #[arg(long, default_value_t = 5000)]
    closed: usize,
    /// Open trades per ledger.
    #[arg(long, default_value_t = 3)]
    open: usize,
    /// Days of history ending now.
    #[arg(long, default_value_t = 180)]
    history_days: i64,
    /// Period of the `trade_snapshot` WebSocket message, in milliseconds.
    #[arg(long, default_value_t = 5000)]
    snapshot_ms: u64,
    /// Period of the ledger writer commits, in milliseconds (0 = no writer).
    #[arg(long, default_value_t = 5000)]
    writer_ms: u64,
    #[arg(long, default_value_t = 7)]
    seed: u64,
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let args = Args::parse();
    let mut spec = FleetSpec::new(args.bots, args.dir);
    spec.closed_trades = args.closed;
    spec.open_trades = args.open;
    spec.history_days = args.history_days;
    spec.snapshot_every = Duration::from_millis(args.snapshot_ms.max(10));
    spec.seed = args.seed;
    spec.writer = (args.writer_ms > 0).then(|| WriterConfig {
        commit_every: Duration::from_millis(args.writer_ms),
        ..WriterConfig::default()
    });
    let fleet = Fleet::start(spec).await?;
    println!(
        "{}",
        serde_json::to_string(&fleet.manifest).map_err(std::io::Error::other)?
    );
    fakebot::control::serve(&fleet, tokio::io::stdin(), tokio::io::stdout()).await
}
