//! Entry point of `frequi-gateway`.
//!
//! Implemented here: `doctor` (read-only host check) and `version`. The service itself (`run`)
//! and the remaining subcommands (`check-config`, `print-default-config`, `hash-password`) land
//! with the server lot.

mod doctor;

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "frequi-gateway", version, about = "FreqUI Ultimate gateway")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Discover the running bots of this host and print a redacted health table (read-only).
    ///
    /// Reads /proc, the bot config files, the ledgers (stat only unless --deep) and the ftcache
    /// summary, and pings each bot REST API. Never logs in, never writes, never prints a secret.
    Doctor {
        /// Also open every ledger read-only and count its trades.
        #[arg(long)]
        deep: bool,
        /// ftcache socket (default: /tmp/ftcache-<uid>.sock).
        #[arg(long)]
        socket: Option<PathBuf>,
    },
    /// Print the version and the protocol version.
    Version,
}

#[tokio::main]
async fn main() -> ExitCode {
    match Cli::parse().command {
        Command::Version => {
            println!(
                "frequi-gateway {} (protocol {})",
                env!("CARGO_PKG_VERSION"),
                fg_core::protocol::PROTOCOL_VERSION
            );
            ExitCode::SUCCESS
        }
        Command::Doctor { deep, socket } => doctor::run(deep, socket).await,
    }
}
