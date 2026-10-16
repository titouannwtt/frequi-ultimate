//! The relay of an open chart: channel `chart:<bot>:<pair>:<timeframe>` (03 sections 6.2 and 8.2).
//!
//! A bot only pushes dataframes over its WebSocket to a client that asks for them (heavy: a
//! dataframe per pair), and the gateway keeps one WebSocket per bot for the whole fleet. So the
//! relay does what a chart page would do on its own, once for everybody: while at least one
//! client holds the channel it reads `GET /pair_candles?pair=&timeframe=&limit=` from the bot
//! through the whitelisted proxy, counted in the global request budget (one token per read),
//! keeps the OHLCV columns of the last [`WINDOW`] candles and publishes what changed as keyed
//! upserts (collection `candles`, key = open time in ms; collection `chart`, key `meta`).
//!
//! Boundaries, on purpose:
//!
//! * the history of a chart (and every indicator column) comes from the proxy route
//!   `bots/{key}/proxy/pair_candles` or `pair_history`, which are cached; the relay only keeps the
//!   window that is still moving;
//! * at most [`MAX_CHARTS`] distinct charts are relayed at once; a read every
//!   `timeframe / 12` (between 5 and 60 s) is the whole cost of a chart;
//! * one poller per chart, however many clients watch it; it stops 30 s after the last one left;
//! * a bot that cannot be read leaves the last candles in place and turns `meta.freshness.stale`
//!   on: a frozen chart is never presented as live.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use fg_core::identity::BotKey;
use fg_core::model::{BotStatus, Candle, ChartInfo, Freshness, FreshnessSource};
use fg_core::protocol::Channel;
use fg_core::protocol::differ::{CollectionDiff, Differ, to_value};
use fg_core::time::{normalize_ts_ms, parse_date_ms};
use fg_sources::botrest::{ProxyMethod, ProxyRequest};
use serde_json::Value;
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::error::EngineError;
use crate::proxy::proxy_read;
use crate::published::Collections;
use crate::shared::Shared;
use crate::views::{ViewGuard, ViewKey};

/// Charts relayed at the same time, all clients together.
pub const MAX_CHARTS: usize = 16;
/// Candles kept (and asked for) per chart.
pub const WINDOW: usize = 150;
/// Longest answer of `pair_candles` that is parsed (every indicator column comes with it).
const MAX_BODY: usize = 8 * 1024 * 1024;
const MIN_PERIOD: Duration = Duration::from_secs(5);
const MAX_PERIOD: Duration = Duration::from_secs(60);
const READ_TIMEOUT: Duration = Duration::from_secs(20);

/// A chart: one pair of one bot at one timeframe.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ChartKey {
    pub bot: BotKey,
    pub pair: String,
    pub timeframe: String,
}

impl ChartKey {
    /// The key of a `chart:` channel, `None` for any other channel.
    #[must_use]
    pub fn of(ch: &Channel) -> Option<Self> {
        match ch {
            Channel::Chart {
                bot,
                pair,
                timeframe,
            } => Some(Self {
                bot: bot.clone(),
                pair: pair.clone(),
                timeframe: timeframe.clone(),
            }),
            _ => None,
        }
    }

    #[must_use]
    pub fn channel(&self) -> Channel {
        Channel::Chart {
            bot: self.bot.clone(),
            pair: self.pair.clone(),
            timeframe: self.timeframe.clone(),
        }
    }

    /// Refuse what could not be a pair or a timeframe of a bot (the pair travels in a query
    /// string to the bot).
    ///
    /// # Errors
    /// [`EngineError::BadRequest`].
    pub fn validate(&self) -> Result<(), EngineError> {
        let pair_ok = !self.pair.is_empty()
            && self.pair.len() <= 40
            && self.pair.bytes().all(|b| {
                b.is_ascii_alphanumeric() || matches!(b, b'/' | b':' | b'_' | b'.' | b'-')
            });
        if !pair_ok {
            return Err(EngineError::BadRequest("not a pair".into()));
        }
        if timeframe_ms(&self.timeframe).is_none() {
            return Err(EngineError::BadRequest("not a timeframe".into()));
        }
        Ok(())
    }
}

/// Length of a freqtrade timeframe (`5m`, `1h`, `1d`, `1w`, `1M`) in milliseconds.
#[must_use]
pub fn timeframe_ms(tf: &str) -> Option<i64> {
    let unit = tf.chars().last()?;
    let n: i64 = tf[..tf.len() - unit.len_utf8()].parse().ok()?;
    if !(1..=999).contains(&n) {
        return None;
    }
    let base = match unit {
        's' => 1_000,
        'm' => 60_000,
        'h' => 3_600_000,
        'd' => 86_400_000,
        'w' => 7 * 86_400_000,
        'M' => 30 * 86_400_000,
        _ => return None,
    };
    Some(n * base)
}

/// Reading period of a chart: a twelfth of the timeframe, between 5 and 60 s (compressed time
/// compresses it too).
fn period_of(tf_ms: i64, time_scale: f64) -> Duration {
    let raw = Duration::from_millis(u64::try_from(tf_ms / 12).unwrap_or(0));
    raw.clamp(MIN_PERIOD, MAX_PERIOD)
        .div_f64(time_scale.max(1e-3))
}

fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(char::from(b));
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// The OHLCV columns of an answer of `GET /pair_candles`, oldest first, at most [`WINDOW`].
///
/// The open time is `__date_ts` (ms) when the bot sends it, else `date` (ms or a date text). A
/// row with a missing or non-finite figure is dropped; an answer that is not a dataframe at all,
/// or of which no row can be read, is `None`.
#[must_use]
pub fn parse_candles(body: &[u8]) -> Option<Vec<Candle>> {
    let v: Value = serde_json::from_slice(body).ok()?;
    let cols = v.get("columns")?.as_array()?;
    let col = |name: &str| cols.iter().position(|c| c.as_str() == Some(name));
    let (io, ih, il, ic, iv) = (
        col("open")?,
        col("high")?,
        col("low")?,
        col("close")?,
        col("volume")?,
    );
    let (its, idate) = (col("__date_ts"), col("date"));
    let rows = v.get("data")?.as_array()?;
    let mut out: Vec<Candle> = rows
        .iter()
        .filter_map(|r| {
            let r = r.as_array()?;
            let num = |i: usize| r.get(i)?.as_f64().filter(|x| x.is_finite());
            let t = its.and_then(num).and_then(normalize_ts_ms).or_else(|| {
                let d = r.get(idate?)?;
                match d {
                    Value::Number(n) => n.as_f64().and_then(normalize_ts_ms),
                    Value::String(s) => parse_date_ms(s),
                    _ => None,
                }
            })?;
            Some(Candle {
                t,
                o: num(io)?,
                h: num(ih)?,
                l: num(il)?,
                c: num(ic)?,
                v: num(iv)?,
            })
        })
        .collect();
    if out.is_empty() && !rows.is_empty() {
        return None;
    }
    out.sort_by_key(|c| c.t);
    out.dedup_by_key(|c| c.t);
    let skip = out.len().saturating_sub(WINDOW);
    out.drain(..skip);
    Some(out)
}

struct Slot {
    state: Arc<Mutex<Collections>>,
    task: JoinHandle<()>,
}

/// The charts being relayed.
#[derive(Default)]
pub(crate) struct Charts {
    map: Mutex<HashMap<ChartKey, Slot>>,
}

impl Charts {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<ChartKey, Slot>> {
        self.map
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// The state of a chart that is being relayed.
    pub(crate) fn state_of(&self, key: &ChartKey) -> Option<Arc<Mutex<Collections>>> {
        self.lock().get(key).map(|s| Arc::clone(&s.state))
    }

    /// Stop every poller (the engine is going away).
    pub(crate) fn abort_all(&self) {
        for (_, slot) in self.lock().drain() {
            slot.task.abort();
        }
    }

    /// Number of charts being relayed.
    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.lock().len()
    }
}

/// Start looking at a chart: the relay runs for as long as the returned guard (or another one
/// for the same chart) lives, plus the hold-over of the views.
///
/// # Errors
/// The chart is malformed, the bot is unknown or has no API link, or too many charts are open.
pub(crate) fn open(sh: &Arc<Shared>, key: ChartKey) -> Result<ViewGuard, EngineError> {
    key.validate()?;
    if !sh.published.load().bots.contains_key(&key.bot) {
        return Err(EngineError::NotFound);
    }
    let linked = sh.links.read().is_ok_and(|l| l.contains_key(&key.bot));
    if !linked {
        return Err(EngineError::Unavailable("the bot has no API link"));
    }
    let Ok(runtime) = tokio::runtime::Handle::try_current() else {
        return Err(EngineError::Closed);
    };
    // The flag goes up before the map is looked at: a poller that is retiring either sees it
    // or has already left the map.
    let guard = sh.views.acquire(ViewKey::Chart(key.clone()));
    let mut map = sh.charts.lock();
    if !map.contains_key(&key) {
        if map.len() >= MAX_CHARTS {
            return Err(EngineError::Unavailable("too many charts are open"));
        }
        let state = Arc::new(Mutex::new(Collections::new()));
        let task = runtime.spawn(run(Arc::clone(sh), key.clone(), Arc::clone(&state)));
        map.insert(key, Slot { state, task });
    }
    Ok(guard)
}

/// Leave the map if nobody looks any more. `false` when somebody came back.
fn retire(sh: &Shared, key: &ChartKey, rx: &watch::Receiver<bool>) -> bool {
    {
        let mut map = sh.charts.lock();
        if *rx.borrow() {
            return false;
        }
        map.remove(key);
    }
    // After the map lock is gone: these take the locks of the views and of the hub.
    sh.views.forget_idle(&ViewKey::Chart(key.clone()));
    sh.hub.forget(&key.channel());
    true
}

/// Read the window once.
async fn read(sh: &Arc<Shared>, key: &ChartKey) -> Option<Vec<Candle>> {
    // A bot known to be down is not asked: the budget is for bots that can answer.
    let status = sh
        .published
        .load()
        .bots
        .get(&key.bot)
        .map(|b| b.state.status);
    if matches!(
        status,
        None | Some(BotStatus::Offline | BotStatus::AuthExpired | BotStatus::Stopped)
    ) {
        return None;
    }
    let req = ProxyRequest {
        method: ProxyMethod::Get,
        path: "/pair_candles".into(),
        query: Some(format!(
            "pair={}&timeframe={}&limit={WINDOW}",
            encode(&key.pair),
            encode(&key.timeframe)
        )),
        body: None,
        content_type: None,
        timeout: READ_TIMEOUT,
    };
    let resp = proxy_read(sh, &key.bot, req, true).await.ok()?;
    if resp.status != 200 || resp.body.len() > MAX_BODY {
        return None;
    }
    parse_candles(&resp.body)
}

/// The poller of one chart.
async fn run(sh: Arc<Shared>, key: ChartKey, state: Arc<Mutex<Collections>>) {
    let channel = key.channel();
    let tf_ms = timeframe_ms(&key.timeframe).unwrap_or(60_000);
    let period = period_of(tf_ms, sh.cfg.cadences.time_scale);
    let period_ms = i64::try_from(period.as_millis()).unwrap_or(i64::MAX);
    let mut rx = sh.views.watch(&ViewKey::Chart(key.clone()));
    let mut differ = Differ::new();
    let mut window: BTreeMap<i64, Candle> = BTreeMap::new();
    let mut last_ok: Option<i64> = None;
    loop {
        if *rx.borrow() {
            if let Some(candles) = read(&sh, &key).await {
                last_ok = Some(sh.now_ms());
                window = candles.into_iter().map(|c| (c.t, c)).collect();
            }
            publish(
                &sh,
                &channel,
                &state,
                &mut differ,
                &window,
                last_ok,
                period_ms,
                &key,
                tf_ms,
            );
        }
        tokio::select! {
            () = tokio::time::sleep(period) => {}
            changed = rx.changed() => {
                if changed.is_err() {
                    return;
                }
            }
        }
        if !*rx.borrow() && retire(&sh, &key, &rx) {
            return;
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn publish(
    sh: &Shared,
    channel: &Channel,
    state: &Mutex<Collections>,
    differ: &mut Differ,
    window: &BTreeMap<i64, Candle>,
    last_ok: Option<i64>,
    period_ms: i64,
    key: &ChartKey,
    tf_ms: i64,
) {
    let now = sh.now_ms();
    let info = ChartInfo {
        pair: key.pair.clone(),
        timeframe: key.timeframe.clone(),
        timeframe_ms: tf_ms,
        candles: u32::try_from(window.len()).unwrap_or(u32::MAX),
        freshness: Freshness::compute(
            FreshnessSource::Rest,
            last_ok.unwrap_or(0),
            now,
            period_ms,
            true,
        ),
    };
    let candles: Vec<(String, &Candle)> = window.values().map(|c| (c.t.to_string(), c)).collect();
    let cdiff: CollectionDiff = differ.diff("candles", candles, &[]);
    let mdiff = differ.diff("chart", [("meta".to_owned(), &info)], &["as_of_ms"]);
    let mut full = Collections::new();
    full.insert(
        "candles".into(),
        window
            .values()
            .filter_map(|c| Some((c.t.to_string(), to_value(c)?)))
            .collect(),
    );
    full.insert(
        "chart".into(),
        BTreeMap::from([("meta".to_owned(), to_value(&info).unwrap_or(Value::Null))]),
    );
    sh.hub.transaction(|tx| {
        tx.up_diffs(channel, now, [("candles", cdiff), ("chart", mdiff)]);
        *state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = full;
    });
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn timeframes_are_read_in_milliseconds_and_nonsense_is_refused() {
        assert_eq!(timeframe_ms("5m"), Some(300_000));
        assert_eq!(timeframe_ms("1h"), Some(3_600_000));
        assert_eq!(timeframe_ms("1d"), Some(86_400_000));
        assert_eq!(timeframe_ms("1w"), Some(604_800_000));
        assert_eq!(timeframe_ms("1M"), Some(2_592_000_000));
        for bad in [
            "", "m", "0m", "1000m", "5x", "5", "-5m", "5 m", "1.5h", "5mm",
        ] {
            assert_eq!(timeframe_ms(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn the_period_follows_the_timeframe_between_five_and_sixty_seconds() {
        let p = |tf: &str, k: f64| period_of(timeframe_ms(tf).unwrap(), k);
        assert_eq!(p("1m", 1.0), Duration::from_secs(5));
        assert_eq!(p("5m", 1.0), Duration::from_secs(25));
        assert_eq!(p("15m", 1.0), Duration::from_secs(60));
        assert_eq!(p("1d", 1.0), Duration::from_secs(60));
        assert_eq!(p("5m", 10.0), Duration::from_millis(2_500));
    }

    #[test]
    fn pairs_and_timeframes_that_could_not_exist_are_refused_before_a_query_is_built() {
        let key = |pair: &str, tf: &str| ChartKey {
            bot: BotKey::Local(9001),
            pair: pair.into(),
            timeframe: tf.into(),
        };
        for ok in ["BTC/USDC:USDC", "XYZ-NVDA/USDC:USDC", "1000PEPE/USDC:USDC"] {
            assert!(key(ok, "15m").validate().is_ok(), "{ok}");
        }
        for bad in [
            "",
            "BTC&limit=1",
            "BTC USDC",
            "a%2Fb",
            "x\n",
            &"A".repeat(41),
        ] {
            assert!(key(bad, "15m").validate().is_err(), "{bad:?}");
        }
        assert!(key("BTC/USDC:USDC", "15").validate().is_err());
        assert_eq!(encode("BTC/USDC:USDC"), "BTC%2FUSDC%3AUSDC");
        assert_eq!(encode("XYZ-NVDA"), "XYZ-NVDA");
    }

    fn frame(rows: &Value) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "strategy": "S", "pair": "BTC/USDC:USDC", "timeframe": "15m",
            "columns": ["date", "open", "high", "low", "close", "volume", "rsi", "__date_ts"],
            "data": rows,
        }))
        .unwrap()
    }

    #[test]
    fn a_dataframe_is_reduced_to_its_ohlcv_columns_oldest_first() {
        let rows = json!([
            [
                "2026-10-16 10:15:00",
                2.0,
                3.0,
                1.0,
                2.5,
                20.0,
                55.0,
                1_792_145_700_000_i64
            ],
            [
                "2026-10-16 10:00:00",
                1.0,
                2.0,
                0.5,
                2.0,
                10.0,
                50.0,
                1_792_144_800_000_i64
            ],
        ]);
        let got = parse_candles(&frame(&rows)).unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].t, 1_792_144_800_000);
        assert_eq!(got[1].c, 2.5);
        assert_eq!(got[1].v, 20.0);
    }

    #[test]
    fn the_open_time_falls_back_to_the_date_column() {
        let body = serde_json::to_vec(&json!({
            "columns": ["date", "open", "high", "low", "close", "volume"],
            "data": [
                ["2026-10-16 10:00:00", 1.0, 2.0, 0.5, 2.0, 10.0],
                [1_792_145_700_000_i64, 2.0, 3.0, 1.0, 2.5, 20.0],
            ],
        }))
        .unwrap();
        let got = parse_candles(&body).unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].t, 1_792_144_800_000);
        assert_eq!(got[1].t, 1_792_145_700_000);
    }

    #[test]
    fn a_window_keeps_the_newest_candles_and_unreadable_rows_are_dropped() {
        let rows: Vec<Value> = (0..200)
            .map(|i| {
                json!([
                    i,
                    1.0,
                    2.0,
                    0.5,
                    1.5,
                    3.0,
                    0.0,
                    1_792_000_000_000_i64 + i * 60_000
                ])
            })
            .chain([
                json!([1, null, 2.0, 0.5, 1.5, 3.0, 0.0, 1_792_100_000_000_i64]),
                json!("garbage"),
            ])
            .collect();
        let got = parse_candles(&frame(&json!(rows))).unwrap();
        assert_eq!(got.len(), WINDOW);
        assert_eq!(got.last().unwrap().t, 1_792_000_000_000 + 199 * 60_000);
    }

    #[test]
    fn what_is_not_a_dataframe_is_not_candles() {
        for body in [
            json!({"detail": "x"}),
            json!(null),
            json!([1, 2]),
            json!({"columns": ["open"], "data": []}),
            json!({"columns": ["date", "open", "high", "low", "close", "volume"], "data": [["x", 1, 1, 1, 1, 1]]}),
        ] {
            assert!(
                parse_candles(&serde_json::to_vec(&body).unwrap()).is_none(),
                "{body}"
            );
        }
        assert!(parse_candles(b"<html>").is_none());
        // An empty window is an answer (a pair that has no data yet).
        let empty =
            json!({"columns": ["date", "open", "high", "low", "close", "volume"], "data": []});
        assert_eq!(
            parse_candles(&serde_json::to_vec(&empty).unwrap()),
            Some(vec![])
        );
    }
}
