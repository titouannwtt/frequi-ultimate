//! The control protocol of the binary: one JSON object per line on stdin, one JSON reply per
//! line on stdout. The process exits at `quit` or at the end of stdin, so that a test that
//! dies never leaves a fleet behind.

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};

use crate::api::Mode;
use crate::fleet::Fleet;

fn mode_of(v: &Value) -> Option<Mode> {
    Some(match v.get("mode")?.as_str()? {
        "up" => Mode::Up,
        "down" => Mode::Down,
        "starting" => Mode::Starting,
        "auth_fail" => Mode::AuthFail,
        "slow" => Mode::Slow(v.get("ms").and_then(Value::as_u64).unwrap_or(500)),
        _ => return None,
    })
}

/// Run one command. `None` = quit.
fn apply(fleet: &Fleet, cmd: &Value) -> Option<Value> {
    let bot = cmd
        .get("bot")
        .and_then(Value::as_u64)
        .and_then(|b| fleet.bot(usize::try_from(b).ok()?));
    let name = cmd.get("cmd").and_then(Value::as_str).unwrap_or("");
    Some(match (name, bot) {
        ("quit", _) => return None,
        ("stats", _) => json!({"ok": true, "stats": fleet.stats()}),
        ("mode", Some(b)) => match mode_of(cmd) {
            Some(m) => {
                b.set_mode(m);
                json!({"ok": true})
            }
            None => json!({"ok": false, "error": "unknown mode"}),
        },
        ("fill", Some(b)) => {
            let kind = cmd
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("entry_fill");
            b.push(
                kind,
                &json!({
                    "trade_id": cmd.get("trade_id").cloned().unwrap_or(json!(9_000_001)),
                    "pair": cmd.get("pair").cloned().unwrap_or(json!("BTC/USDC:USDC")),
                    "profit_amount": cmd.get("profit_amount").cloned().unwrap_or(json!(1.5)),
                }),
            );
            json!({"ok": true})
        }
        ("log", Some(b)) => {
            b.push_log(
                cmd.get("level").and_then(Value::as_str).unwrap_or("ERROR"),
                cmd.get("message").and_then(Value::as_str).unwrap_or("boom"),
            );
            json!({"ok": true})
        }
        ("expire_tokens", Some(b)) => {
            b.expire_tokens();
            json!({"ok": true})
        }
        ("ws_close", Some(b)) => {
            b.close_websockets();
            json!({"ok": true})
        }
        _ => json!({"ok": false, "error": "unknown command or bot"}),
    })
}

/// Serve the protocol on any reader/writer pair (stdin/stdout in the binary).
pub async fn serve<R, W>(fleet: &Fleet, input: R, mut out: W) -> std::io::Result<()>
where
    R: tokio::io::AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut lines = BufReader::new(input).lines();
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(cmd) => match apply(fleet, &cmd) {
                Some(r) => r,
                None => {
                    out.write_all(b"{\"ok\":true,\"bye\":true}\n").await?;
                    out.flush().await?;
                    return Ok(());
                }
            },
            Err(_) => json!({"ok": false, "error": "invalid json"}),
        };
        let mut text = reply.to_string();
        text.push('\n');
        out.write_all(text.as_bytes()).await?;
        out.flush().await?;
    }
    Ok(())
}
