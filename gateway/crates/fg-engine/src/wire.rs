//! Typed views of what the bots send. REST bodies and WebSocket messages are parsed once, where
//! they arrive, into small structs; everything downstream works on those. Parsing is lenient on
//! purpose: a missing or malformed field is `None`, never an error and never a default.

use fg_core::alerts::LogLine;
use fg_core::model::{Event, EventKind, PairLock, Severity};
use fg_core::time::{normalize_ts_ms, parse_date_ms};
use fg_sources::botws::BotMessage;
use serde_json::Value;

use fg_core::identity::BotKey;

fn f64_of(v: &Value, key: &str) -> Option<f64> {
    v.get(key)?.as_f64().filter(|x| x.is_finite())
}

fn i64_of(v: &Value, key: &str) -> Option<i64> {
    let x = v.get(key)?;
    x.as_i64().or_else(|| x.as_f64().map(|f| f as i64))
}

fn str_of(v: &Value, key: &str) -> Option<String> {
    v.get(key)?.as_str().map(str::to_owned)
}

fn ts_of(v: &Value, key: &str) -> Option<i64> {
    match v.get(key)? {
        Value::Number(n) => normalize_ts_ms(n.as_f64()?),
        Value::String(s) => parse_date_ms(s),
        _ => None,
    }
}

/// One open trade as `/status` describes it.
#[derive(Debug, Clone, PartialEq)]
pub struct LivePosition {
    pub trade_id: i64,
    pub pair: String,
    pub is_short: Option<bool>,
    pub leverage: Option<f64>,
    pub amount: Option<f64>,
    pub stake_amount: Option<f64>,
    pub open_rate: Option<f64>,
    pub open_ms: Option<i64>,
    pub current_rate: Option<f64>,
    pub profit_abs: Option<f64>,
    pub profit_ratio: Option<f64>,
    pub stop_loss_abs: Option<f64>,
    pub liquidation_price: Option<f64>,
    pub entries: Option<u32>,
}

/// Parse the body of `/status`: an array of trades. `None` when the body is not one (an error
/// envelope under a success status, a login page, `null`, a list of something else): that is an
/// unreadable answer, not "no open trades", and must not replace what is known. An empty array is
/// a real answer; items without an id or a pair are dropped one by one.
#[must_use]
pub fn parse_status(v: &Value) -> Option<Vec<LivePosition>> {
    let items = v.as_array()?;
    let parsed: Vec<LivePosition> = items
        .iter()
        .filter_map(|t| {
            let trade_id = i64_of(t, "trade_id")?;
            Some(LivePosition {
                trade_id,
                pair: str_of(t, "pair")?,
                is_short: t.get("is_short").and_then(Value::as_bool),
                leverage: f64_of(t, "leverage"),
                amount: f64_of(t, "amount"),
                stake_amount: f64_of(t, "stake_amount"),
                open_rate: f64_of(t, "open_rate"),
                open_ms: ts_of(t, "open_timestamp").or_else(|| ts_of(t, "open_date")),
                current_rate: f64_of(t, "current_rate"),
                profit_abs: f64_of(t, "profit_abs"),
                profit_ratio: f64_of(t, "profit_ratio"),
                stop_loss_abs: f64_of(t, "stop_loss_abs"),
                liquidation_price: f64_of(t, "liquidation_price"),
                entries: i64_of(t, "nr_of_successful_entries").and_then(|n| u32::try_from(n).ok()),
            })
        })
        .collect();
    // A non-empty list of which nothing is a trade is not a list of trades.
    (!parsed.is_empty() || items.is_empty()).then_some(parsed)
}

/// Figures of `/balance` the engine uses.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct BalanceInfo {
    /// Wallet total as the bot sees it (the whole wallet on a shared wallet).
    pub total: Option<f64>,
    /// The part managed by this bot.
    pub total_bot: Option<f64>,
    pub starting_capital: Option<f64>,
    pub wallet_age_s: Option<f64>,
}

#[must_use]
pub fn parse_balance(v: &Value) -> BalanceInfo {
    BalanceInfo {
        total: f64_of(v, "total"),
        total_bot: f64_of(v, "total_bot"),
        starting_capital: f64_of(v, "starting_capital"),
        wallet_age_s: f64_of(v, "wallet_age_s"),
    }
}

/// A string list under `key` (`/whitelist`, `/blacklist`).
#[must_use]
pub fn parse_list(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// Active locks of `/locks`.
#[must_use]
pub fn parse_locks(v: &Value) -> Vec<PairLock> {
    v.get("locks")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter(|l| l.get("active").and_then(Value::as_bool).unwrap_or(true))
                .filter_map(|l| {
                    Some(PairLock {
                        pair: str_of(l, "pair")?,
                        reason: str_of(l, "reason"),
                        until_ms: ts_of(l, "lock_end_timestamp"),
                        side: str_of(l, "side"),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// A log line of `/logs`: `[time, epoch_ms, logger, level, message]`.
#[derive(Debug, Clone, PartialEq)]
pub struct LogEntry {
    pub ts_ms: i64,
    pub logger: String,
    pub level: String,
    pub message: String,
}

impl LogEntry {
    #[must_use]
    pub fn line(&self) -> LogLine {
        LogLine {
            ts_ms: self.ts_ms,
            level: self.level.clone(),
            message: self.message.clone(),
        }
    }
}

#[must_use]
pub fn parse_logs(v: &Value) -> Vec<LogEntry> {
    v.get("logs")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|r| {
                    let r = r.as_array()?;
                    let ts_ms = normalize_ts_ms(r.get(1)?.as_f64()?)?;
                    Some(LogEntry {
                        ts_ms,
                        logger: r.get(2)?.as_str()?.to_owned(),
                        level: r.get(3)?.as_str()?.to_owned(),
                        message: r.get(4)?.as_str()?.to_owned(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Live price of one open trade (`trade_snapshot`).
#[derive(Debug, Clone, PartialEq)]
pub struct SnapEntry {
    pub trade_id: i64,
    pub current_rate: Option<f64>,
    pub profit_abs: Option<f64>,
    pub profit_ratio: Option<f64>,
}

/// A WebSocket message the engine understands.
#[derive(Debug, Clone, PartialEq)]
pub enum WsMsg {
    TradeSnapshot(Vec<SnapEntry>),
    Whitelist(Vec<String>),
    Event(Event),
    /// `status`, `entry`, `exit`: proof of life only.
    Other,
}

/// Interpret a bot message. `now_ms` stamps events that carry no date of their own.
#[must_use]
pub fn parse_ws(key: &BotKey, msg: &BotMessage, now_ms: i64) -> WsMsg {
    let d = &msg.data;
    let ev = |kind: EventKind| Event {
        kind,
        ts_ms: now_ms,
        bot_key: Some(key.clone()),
        trade_id: i64_of(d, "trade_id"),
        pair: str_of(d, "pair"),
        profit_abs: f64_of(d, "profit_amount"),
        severity: None,
        detail: None,
    };
    match msg.kind.as_str() {
        "trade_snapshot" => WsMsg::TradeSnapshot(
            d.as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|e| {
                            Some(SnapEntry {
                                trade_id: i64_of(e, "trade_id")?,
                                current_rate: f64_of(e, "current_rate"),
                                profit_abs: f64_of(e, "profit_abs"),
                                profit_ratio: f64_of(e, "profit_ratio"),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default(),
        ),
        "whitelist" => WsMsg::Whitelist(
            d.as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default(),
        ),
        "entry_fill" => WsMsg::Event(ev(EventKind::EntryFill)),
        "exit_fill" => {
            let mut e = ev(EventKind::ExitFill);
            e.detail = str_of(d, "exit_reason");
            WsMsg::Event(e)
        }
        "entry_cancel" => {
            let mut e = ev(EventKind::EntryCancel);
            e.detail = str_of(d, "reason");
            WsMsg::Event(e)
        }
        "exit_cancel" => {
            let mut e = ev(EventKind::ExitCancel);
            e.detail = str_of(d, "reason");
            WsMsg::Event(e)
        }
        "protection_trigger" | "protection_trigger_global" => {
            let mut e = ev(EventKind::ProtectionTrigger);
            e.severity = Some(Severity::Info);
            e.detail = str_of(d, "reason");
            WsMsg::Event(e)
        }
        "warning" => {
            let mut e = ev(EventKind::Warning);
            e.severity = Some(Severity::Warning);
            e.detail = d.as_str().map(str::to_owned).or_else(|| str_of(d, "msg"));
            WsMsg::Event(e)
        }
        "startup" => {
            let mut e = ev(EventKind::Startup);
            e.detail = d.as_str().map(str::to_owned).or_else(|| str_of(d, "msg"));
            WsMsg::Event(e)
        }
        "strategy_msg" => {
            let mut e = ev(EventKind::StrategyMsg);
            e.detail = d.as_str().map(str::to_owned).or_else(|| str_of(d, "msg"));
            WsMsg::Event(e)
        }
        _ => WsMsg::Other,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn key() -> BotKey {
        BotKey::Local(9056)
    }

    #[test]
    fn status_items_without_an_id_or_a_pair_are_dropped() {
        let v = json!([
            {"trade_id": 1, "pair": "BTC/USDC:USDC", "is_short": true, "open_timestamp": 1_760_000_000_000_i64,
             "current_rate": 1.5, "profit_abs": -2.0, "nr_of_successful_entries": 3},
            {"pair": "ETH/USDC:USDC"},
            {"trade_id": 2}
        ]);
        let got = parse_status(&v).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].is_short, Some(true));
        assert_eq!(got[0].open_ms, Some(1_760_000_000_000));
        assert_eq!(got[0].entries, Some(3));
        assert_eq!(parse_status(&json!([])), Some(vec![]));
        for odd in [
            json!({"detail": "x"}),
            json!(null),
            json!("<html>"),
            json!(["a", 3]),
            json!([{"pair": "ETH/USDC:USDC"}]),
        ] {
            assert_eq!(parse_status(&odd), None, "{odd}");
        }
    }

    #[test]
    fn logs_are_read_positionally_and_malformed_rows_skipped() {
        let v = json!({"log_count": 3, "logs": [
            ["2026-10-15 12:00:00", 1_760_530_000_000.5, "freqtrade.worker", "ERROR", "boom"],
            ["short"],
            ["2026-10-15 12:00:01", "nan", "x", "INFO", "m"]
        ]});
        let got = parse_logs(&v);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].level, "ERROR");
        assert_eq!(got[0].ts_ms, 1_760_530_000_000);
    }

    #[test]
    fn locks_keep_only_active_ones() {
        let v = json!({"locks": [
            {"pair": "A/USDC:USDC", "active": true, "reason": "r", "lock_end_timestamp": 1_760_600_000_000_i64},
            {"pair": "B/USDC:USDC", "active": false}
        ]});
        let got = parse_locks(&v);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].until_ms, Some(1_760_600_000_000));
    }

    #[test]
    fn websocket_messages_become_events_or_prices() {
        let snap = BotMessage {
            kind: "trade_snapshot".into(),
            data: json!([{"trade_id": 4, "pair": "X", "current_rate": 2.0, "profit_abs": 1.0, "profit_ratio": 0.1}]),
        };
        let WsMsg::TradeSnapshot(entries) = parse_ws(&key(), &snap, 5) else {
            panic!("not a snapshot");
        };
        assert_eq!(entries[0].trade_id, 4);

        let fill = BotMessage {
            kind: "exit_fill".into(),
            data: json!({"trade_id": 9, "pair": "ETH/USDC:USDC", "profit_amount": 4.1, "exit_reason": "roi"}),
        };
        let WsMsg::Event(e) = parse_ws(&key(), &fill, 77) else {
            panic!("not an event");
        };
        assert_eq!(e.kind, EventKind::ExitFill);
        assert_eq!(e.profit_abs, Some(4.1));
        assert_eq!(e.ts_ms, 77);
        assert_eq!(e.detail.as_deref(), Some("roi"));

        let st = BotMessage {
            kind: "status".into(),
            data: json!({"status": "running"}),
        };
        assert_eq!(parse_ws(&key(), &st, 1), WsMsg::Other);
    }
}
