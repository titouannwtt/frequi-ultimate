//! Entry point of `frequi-gateway`.
//!
//! Subcommands: `run` (the service), `doctor` (read-only host check), `check-config`,
//! `print-default-config`, `hash-password` and `version`.

mod doctor;
mod serve;
mod tools;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

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
    /// Run the gateway: poll the bots, serve `/gw/v1` over HTTP and WebSocket.
    ///
    /// Stops cleanly on SIGINT or SIGTERM (WebSockets are closed with code 1001).
    Run {
        /// Configuration file (default: ~/.config/frequi-gateway/config.toml).
        #[arg(long)]
        config: Option<PathBuf>,
        /// Secrets file, mode 600 (default: secrets.toml next to the configuration).
        #[arg(long)]
        secrets: Option<PathBuf>,
    },
    /// Read the configuration, report every problem and what it means; starts nothing.
    CheckConfig {
        #[arg(long)]
        config: Option<PathBuf>,
        #[arg(long)]
        secrets: Option<PathBuf>,
    },
    /// Print the default configuration as a commented TOML file.
    PrintDefaultConfig,
    /// Read a password (asked twice on a terminal, or one line from a pipe) and print its
    /// Argon2id hash for `auth.password_hash` in secrets.toml.
    HashPassword,
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

fn runtime() -> std::io::Result<tokio::runtime::Runtime> {
    // A few worker threads are plenty for 40 bots and a handful of clients; the shared host has
    // other tenants.
    let workers = std::thread::available_parallelism().map_or(2, |n| n.get().clamp(2, 4));
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(workers)
        .max_blocking_threads(16)
        .thread_name("fg-worker")
        .enable_all()
        .build()
}

fn main() -> ExitCode {
    let command = Cli::parse().command;
    match command {
        Command::Version => {
            println!(
                "frequi-gateway {} (protocol {})",
                env!("CARGO_PKG_VERSION"),
                fg_core::protocol::PROTOCOL_VERSION
            );
            ExitCode::SUCCESS
        }
        Command::PrintDefaultConfig => tools::print_default_config(),
        Command::CheckConfig { config, secrets } => tools::check_config(config, secrets),
        Command::HashPassword => tools::hash_password_cmd(),
        Command::Doctor { deep, socket } => match runtime() {
            Ok(rt) => rt.block_on(doctor::run(deep, socket)),
            Err(e) => fail(&e),
        },
        Command::Run { config, secrets } => match runtime() {
            Ok(rt) => rt.block_on(serve::run(config, secrets)),
            Err(e) => fail(&e),
        },
    }
}

fn fail(e: &std::io::Error) -> ExitCode {
    eprintln!("cannot start the async runtime: {e}");
    ExitCode::from(1)
}
