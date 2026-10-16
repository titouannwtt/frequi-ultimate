//! `check-config`, `print-default-config` and `hash-password`.

use std::io::{BufRead, IsTerminal, Write};
use std::path::PathBuf;
use std::process::{Command, ExitCode, Stdio};

use fg_server::config::{self, DEFAULT_CONFIG_TOML};
use fg_server::password::hash_password;

pub fn print_default_config() -> ExitCode {
    print!("{DEFAULT_CONFIG_TOML}");
    ExitCode::SUCCESS
}

/// Read the file, report every problem, and say what the gateway would do. Prints no secret.
pub fn check_config(config_path: Option<PathBuf>, secrets: Option<PathBuf>) -> ExitCode {
    let loaded = match config::load(config_path.as_deref(), secrets.as_deref()) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("FAIL {e}");
            return ExitCode::from(2);
        }
    };
    let c = &loaded.config;
    let mut failed = false;
    let mut line = |ok: bool, msg: String| {
        println!("{} {msg}", if ok { "ok  " } else { "FAIL" });
        failed |= !ok;
    };
    println!(
        "config file : {}",
        loaded.config_file.as_ref().map_or_else(
            || "(none, defaults)".to_owned(),
            |p| p.display().to_string()
        )
    );
    println!(
        "secrets file: {}",
        loaded
            .secrets_file
            .as_ref()
            .map_or_else(|| "(none)".to_owned(), |p| p.display().to_string())
    );
    let problems = c.problems();
    line(
        problems.is_empty(),
        format!("{} configuration problem(s)", problems.len()),
    );
    for p in &problems {
        println!("       - {p}");
    }
    let data = c.data_dir();
    // Do not create anything: look at the directory, or at the nearest one that exists.
    let probe = data
        .ancestors()
        .find(|a| a.is_dir())
        .map(std::path::Path::to_path_buf);
    let usable = probe
        .as_ref()
        .is_some_and(|d| std::fs::metadata(d).is_ok_and(|m| !m.permissions().readonly()));
    line(
        usable,
        format!("data directory {} can be used", data.display()),
    );
    if c.server.cors_origins.is_empty() {
        println!(
            "warn no UI origin is allowed by CORS: a browser UI served from a bot cannot call the gateway"
        );
    } else {
        println!(
            "ok   {} UI origin(s) allowed by CORS",
            c.server.cors_origins.len()
        );
    }
    println!("listen      : {}", c.server.listen);
    println!(
        "auth modes  : {}",
        c.auth
            .modes
            .iter()
            .map(|m| m.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    );
    println!("time zone   : {}", c.general.timezone);
    if failed {
        ExitCode::from(2)
    } else {
        ExitCode::SUCCESS
    }
}

fn read_line_hidden(prompt: &str) -> Option<String> {
    eprint!("{prompt}");
    let _ = std::io::stderr().flush();
    let hide = std::io::stdin().is_terminal()
        && Command::new("stty")
            .arg("-echo")
            .stdin(Stdio::inherit())
            .status()
            .is_ok_and(|s| s.success());
    let mut s = String::new();
    let got = std::io::stdin().lock().read_line(&mut s).ok();
    if hide {
        let _ = Command::new("stty")
            .arg("echo")
            .stdin(Stdio::inherit())
            .status();
        eprintln!();
    }
    got.filter(|n| *n > 0)?;
    Some(s.trim_end_matches(['\n', '\r']).to_owned())
}

/// Print the Argon2id hash of a password read from the terminal (asked twice) or from a pipe.
pub fn hash_password_cmd() -> ExitCode {
    let interactive = std::io::stdin().is_terminal();
    let Some(pw) = read_line_hidden("Password: ") else {
        eprintln!("no password given");
        return ExitCode::from(2);
    };
    if interactive {
        let again = read_line_hidden("Again: ");
        if again.as_deref() != Some(pw.as_str()) {
            eprintln!("the two entries differ");
            return ExitCode::from(2);
        }
    }
    match hash_password(&pw) {
        Ok(h) => {
            println!("{h}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{e}");
            ExitCode::from(2)
        }
    }
}
