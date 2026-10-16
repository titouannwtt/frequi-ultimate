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

/// The async runtime. A few worker threads are plenty for 40 bots and a handful of clients, and
/// the host has other tenants: 2 to 4 (`scheduler.worker_threads`, automatic by default).
fn runtime(workers: usize, ledger_threads: usize) -> std::io::Result<tokio::runtime::Runtime> {
    fg_server::runtime::build(
        workers,
        fg_server::runtime::blocking_threads(ledger_threads),
    )
}

/// mimalloc keeps the pages a thread freed committed until a later allocation purges them, and the
/// gateway allocates in bursts (a ledger read) then sits idle: with the default delay the resident
/// size stayed 30 to 50 MB above what is in use (measured: 40 bots, 200 000 trades, 50 clients,
/// 140-160 MB against 110-117 MB). A delay of 0 purges at once; the allocator only reads its
/// settings from the environment, and changing one's own environment is `unsafe` since edition
/// 2024 (this crate forbids `unsafe`), so the service starts itself again, in place (same pid,
/// same descriptors), with the setting. An explicit `MIMALLOC_PURGE_DELAY` wins; `FG_NO_REEXEC=1`
/// disables it.
fn reexec_with_allocator_settings() {
    use std::os::unix::process::CommandExt;

    const VAR: &str = "MIMALLOC_PURGE_DELAY";
    if std::env::var_os(VAR).is_some() || std::env::var_os("FG_NO_REEXEC").is_some() {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let mut args = std::env::args_os();
    let argv0 = args.next();
    let mut cmd = std::process::Command::new(exe);
    if let Some(a) = argv0 {
        cmd.arg0(a);
    }
    // `exec` only returns when it failed: the service then runs with the default setting.
    let err = cmd.args(args).env(VAR, "0").exec();
    eprintln!("note: could not restart with {VAR}=0 ({err}); continuing with the default");
}

fn main() -> ExitCode {
    let command = Cli::parse().command;
    if matches!(command, Command::Run { .. }) {
        reexec_with_allocator_settings();
    }
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
        Command::Doctor { deep, socket } => match runtime(2, 4) {
            Ok(rt) => rt.block_on(doctor::run(deep, socket)),
            Err(e) => fail(&e),
        },
        Command::Run { config, secrets } => {
            // The configuration is read first: it sizes the runtime.
            let Some(cfg) = serve::load_config(config.as_ref(), secrets.as_ref()) else {
                return ExitCode::from(2);
            };
            let cpus = std::thread::available_parallelism().map_or(2, std::num::NonZero::get);
            match runtime(cfg.scheduler.workers(cpus), cfg.scheduler.ledger_threads) {
                Ok(rt) => rt.block_on(serve::run(cfg)),
                Err(e) => fail(&e),
            }
        }
    }
}

fn fail(e: &std::io::Error) -> ExitCode {
    eprintln!("cannot start the async runtime: {e}");
    ExitCode::from(1)
}
