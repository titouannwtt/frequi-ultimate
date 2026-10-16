//! The state clients read: an immutable [`Published`] swapped atomically, the keyed [`Differ`]
//! that turns two consecutive states into `up` frames, and the per-channel snapshots.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use fg_core::alerts::Alert;
use fg_core::calc::drawdown::HistorySample;
use fg_core::identity::BotKey;
use fg_core::model::{
    BotDetail, BotMode, BotRow, Event, Health, HealthLevel, Position, ScopeTotals, Ticker,
    WalletRow,
};
use fg_core::protocol::{Channel, LogScope};
use serde::Serialize;
use serde_json::Value;

use crate::closed::ClosedTrade;
use crate::error::EngineError;
use crate::ledger_data::ClosedDerived;

/// The history of a bot, shared with the queries (journal, equity, calendar).
#[derive(Debug, Clone)]
pub struct BotData {
    pub closed: Arc<Vec<ClosedTrade>>,
    /// Mode of the bot, for the journal rows rebuilt from `closed`.
    pub mode: BotMode,
    pub derived: Arc<ClosedDerived>,
    pub profit: Arc<Vec<HistorySample>>,
    pub version: u64,
}

/// One consistent picture of the fleet. Cloning clones `Arc`s only.
#[derive(Debug, Clone)]
pub struct Published {
    pub bots: Arc<BTreeMap<BotKey, BotRow>>,
    /// Keyed `bot_key/trade_id`.
    pub positions: Arc<BTreeMap<String, Position>>,
    /// Exact instant (ms) each position was last refreshed, same keys as `positions`. Clients see
    /// `freshness.as_of_ms` rounded down to 30 s; the guard of an action needs the real age.
    pub positions_seen_ms: Arc<BTreeMap<String, i64>>,
    pub wallets: Arc<BTreeMap<String, WalletRow>>,
    /// Keyed `live`, `dry`, `replay`.
    pub scopes: Arc<BTreeMap<String, ScopeTotals>>,
    /// Firing alerts, with their silence and acknowledgement state.
    pub alerts: Arc<Vec<Alert>>,
    pub health: Arc<Health>,
    pub details: Arc<BTreeMap<BotKey, BotDetail>>,
    pub tickers: Arc<Vec<Ticker>>,
    pub data: Arc<BTreeMap<BotKey, BotData>>,
    pub generated_ms: i64,
}

impl Published {
    #[must_use]
    pub fn empty(now_ms: i64) -> Self {
        Self {
            bots: Arc::default(),
            positions: Arc::default(),
            positions_seen_ms: Arc::default(),
            wallets: Arc::default(),
            scopes: Arc::default(),
            alerts: Arc::default(),
            health: Arc::new(Health {
                level: HealthLevel::Ok,
                reasons: Vec::new(),
                rate_budget_pct: None,
                backoff_active: false,
                hit_rate: None,
                bots_process: None,
                digest_age_s: None,
                freshness: fg_core::model::Freshness {
                    as_of_ms: 0,
                    source: fg_core::model::FreshnessSource::Digest,
                    stale: true,
                },
            }),
            details: Arc::default(),
            tickers: Arc::default(),
            data: Arc::default(),
            generated_ms: now_ms,
        }
    }
}

/// The collections of a channel, as `{collection: {key: entity}}`.
pub type Collections = BTreeMap<String, BTreeMap<String, Value>>;

/// A channel's state at one sequence number: what `GET /snapshot` returns, with the value of the
/// `X-Gw-Seq` header.
#[derive(Debug, Clone, PartialEq)]
pub struct ChannelSnapshot {
    pub channel: Channel,
    pub seq: u64,
    pub collections: Collections,
    /// Recent events (channel `events` and the log channels only).
    pub events: Vec<Event>,
}

/// Significant digits kept in published figures: 10 digits keep the cents of a million and the
/// last digit of a price, and cut a 17-digit float to about half its length on the wire.
const SIGNIFICANT_DIGITS: usize = 10;

/// Round every non-integer number of `v` to [`SIGNIFICANT_DIGITS`]. Snapshots and deltas both go
/// through it, so that a client that applied deltas equals a client that loaded the snapshot.
fn compact(v: &mut Value) {
    match v {
        Value::Number(n) if n.is_f64() => {
            if let Some(x) = n.as_f64().filter(|x| x.is_finite() && *x != 0.0)
                && let Ok(r) = format!("{:.*e}", SIGNIFICANT_DIGITS - 1, x).parse::<f64>()
                && let Some(r) = serde_json::Number::from_f64(r)
            {
                *n = r;
            }
        }
        Value::Array(a) => a.iter_mut().for_each(compact),
        Value::Object(o) => o.values_mut().for_each(compact),
        _ => {}
    }
}

fn to_value<T: Serialize>(item: T) -> Option<Value> {
    let mut v = serde_json::to_value(item).ok()?;
    compact(&mut v);
    Some(v)
}

fn to_map<T: Serialize>(items: impl IntoIterator<Item = (String, T)>) -> BTreeMap<String, Value> {
    items
        .into_iter()
        .filter_map(|(k, v)| Some((k, to_value(v)?)))
        .collect()
}

impl Published {
    /// The entities of a channel.
    ///
    /// # Errors
    /// [`EngineError::Unsupported`] for the chart relay, which this engine does not provide.
    pub fn collections_for(&self, ch: &Channel) -> Result<Collections, EngineError> {
        let mut out = Collections::new();
        match ch {
            Channel::Fleet => {
                out.insert(
                    "bots".into(),
                    to_map(self.bots.iter().map(|(k, v)| (k.to_string(), v))),
                );
                out.insert(
                    "wallets".into(),
                    to_map(self.wallets.iter().map(|(k, v)| (k.clone(), v))),
                );
                out.insert(
                    "scopes".into(),
                    to_map(self.scopes.iter().map(|(k, v)| (k.clone(), v))),
                );
            }
            Channel::Positions => {
                out.insert(
                    "positions".into(),
                    to_map(self.positions.iter().map(|(k, v)| (k.clone(), v))),
                );
            }
            Channel::Alerts => {
                out.insert(
                    "alerts".into(),
                    to_map(self.alerts.iter().map(|a| (a.id.clone(), a))),
                );
            }
            Channel::Health => {
                out.insert(
                    "health".into(),
                    to_map([("health".to_owned(), self.health.as_ref())]),
                );
            }
            Channel::Recon => {
                out.insert(
                    "wallets".into(),
                    to_map(self.wallets.iter().map(|(k, v)| (k.clone(), v))),
                );
            }
            Channel::Bot(key) => {
                out.insert(
                    "details".into(),
                    to_map(self.details.get(key).map(|d| (key.to_string(), d))),
                );
            }
            Channel::Events | Channel::Logs(LogScope::Errors | LogScope::Bot(_)) => {}
            Channel::Chart { .. } => return Err(EngineError::Unsupported("chart relay")),
        }
        Ok(out)
    }
}

/// Turns consecutive states of keyed collections into upserts (changed top-level fields only)
/// and removals.
#[derive(Debug, Default)]
pub struct Differ {
    last: HashMap<String, BTreeMap<String, Value>>,
}

/// Changes of one collection.
#[derive(Debug, Default, PartialEq)]
pub struct CollectionDiff {
    pub upsert: BTreeMap<String, Value>,
    pub remove: Vec<String>,
}

impl CollectionDiff {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.upsert.is_empty() && self.remove.is_empty()
    }
}

impl Differ {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Forget the last state of a collection (so that the next diff is a full upsert).
    pub fn reset(&mut self, collection: &str) {
        self.last.remove(collection);
    }

    /// Diff `items` against the previous state of `collection`. Fields named in `volatile` (at
    /// any depth) are sent only when another field changed too: a counter that ticks every
    /// evaluation, or the `as_of_ms` of a freshness, does not warrant a frame by itself.
    pub fn diff<T: Serialize>(
        &mut self,
        collection: &str,
        items: impl IntoIterator<Item = (String, T)>,
        volatile: &[&str],
    ) -> CollectionDiff {
        let items: Vec<(String, T)> = items.into_iter().collect();
        let present: Vec<String> = items.iter().map(|(k, _)| k.clone()).collect();
        self.diff_changed(collection, items, &present, volatile)
    }

    /// Like [`Differ::diff`] when the caller already knows which items may have changed (it
    /// compared them with their previous typed value, which is much cheaper than rendering every
    /// entity to JSON on every tick). `present` lists every key that still exists; the others are
    /// removed.
    pub fn diff_changed<T: Serialize>(
        &mut self,
        collection: &str,
        changed: impl IntoIterator<Item = (String, T)>,
        present: &[String],
        volatile: &[&str],
    ) -> CollectionDiff {
        let last = self.last.entry(collection.to_owned()).or_default();
        let mut out = CollectionDiff::default();
        for (key, item) in changed {
            let Some(new) = to_value(item) else {
                continue;
            };
            match last.get(&key) {
                None => {
                    out.upsert.insert(key.clone(), new.clone());
                    last.insert(key, new);
                }
                Some(old) => {
                    let (patch, meaningful) = field_patch(old, &new, volatile);
                    if meaningful {
                        out.upsert.insert(key.clone(), Value::Object(patch));
                        last.insert(key, new);
                    }
                }
            }
        }
        let present: std::collections::HashSet<&String> = present.iter().collect();
        let gone: Vec<String> = last
            .keys()
            .filter(|k| !present.contains(k))
            .cloned()
            .collect();
        for k in gone {
            last.remove(&k);
            out.remove.push(k);
        }
        out
    }
}

/// Whether `old` and `new` differ in something other than volatile fields, at any depth.
fn differs(old: &Value, new: &Value, volatile: &[&str]) -> bool {
    match (old, new) {
        (Value::Object(o), Value::Object(n)) => {
            n.iter().any(|(k, v)| {
                !volatile.contains(&k.as_str())
                    && o.get(k).is_none_or(|ov| differs(ov, v, volatile))
            }) || o
                .keys()
                .any(|k| !n.contains_key(k) && !volatile.contains(&k.as_str()))
        }
        _ => old != new,
    }
}

/// The patch from `old` to `new`, and whether a non-volatile field changed. When one did,
/// volatile changes ride along.
///
/// A field group (an object) is patched key by key, like the client merges it: only the changed
/// keys are sent, a vanished key is sent as `null`. Anything else is sent whole.
fn field_patch(
    old: &Value,
    new: &Value,
    volatile: &[&str],
) -> (serde_json::Map<String, Value>, bool) {
    let mut patch = serde_json::Map::new();
    let mut meaningful = false;
    if let (Value::Object(o), Value::Object(n)) = (old, new) {
        for (k, v) in n {
            let Some(ov) = o.get(k) else {
                if !volatile.contains(&k.as_str()) {
                    meaningful = true;
                }
                patch.insert(k.clone(), v.clone());
                continue;
            };
            if ov == v {
                continue;
            }
            if !volatile.contains(&k.as_str()) && differs(ov, v, volatile) {
                meaningful = true;
            }
            match (ov, v) {
                (Value::Object(og), Value::Object(ng)) => {
                    let mut group = serde_json::Map::new();
                    for (gk, gv) in ng {
                        if og.get(gk) != Some(gv) {
                            group.insert(gk.clone(), gv.clone());
                        }
                    }
                    for gk in og.keys().filter(|gk| !ng.contains_key(*gk)) {
                        group.insert(gk.clone(), Value::Null);
                    }
                    patch.insert(k.clone(), Value::Object(group));
                }
                _ => {
                    patch.insert(k.clone(), v.clone());
                }
            }
        }
        for k in o.keys().filter(|k| !n.contains_key(*k)) {
            if !volatile.contains(&k.as_str()) {
                meaningful = true;
            }
            patch.insert(k.clone(), Value::Null);
        }
    } else if old != new {
        meaningful = true;
    }
    (patch, meaningful)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn first_diff_is_a_full_upsert_then_only_changed_fields_then_removals() {
        let mut d = Differ::new();
        let a = |x: i64, y: i64| json!({"metrics": {"a": x}, "state": {"y": y}});
        let r1 = d.diff(
            "bots",
            [("k1".to_owned(), a(1, 1)), ("k2".to_owned(), a(2, 2))],
            &[],
        );
        assert_eq!(r1.upsert.len(), 2);
        assert!(r1.remove.is_empty());
        // Nothing changed: no frame.
        let r2 = d.diff(
            "bots",
            [("k1".to_owned(), a(1, 1)), ("k2".to_owned(), a(2, 2))],
            &[],
        );
        assert!(r2.is_empty());
        // Only the changed group is sent, whole (the client merges groups key by key).
        let r3 = d.diff(
            "bots",
            [("k1".to_owned(), a(5, 1)), ("k2".to_owned(), a(2, 2))],
            &[],
        );
        assert_eq!(r3.upsert.len(), 1);
        assert_eq!(r3.upsert["k1"], json!({"metrics": {"a": 5}}));
        // A vanished key is removed.
        let r4 = d.diff("bots", [("k1".to_owned(), a(5, 1))], &[]);
        assert_eq!(r4.remove, vec!["k2".to_owned()]);
        // Re-adding it later is a full upsert again.
        let r5 = d.diff(
            "bots",
            [("k1".to_owned(), a(5, 1)), ("k2".to_owned(), a(2, 2))],
            &[],
        );
        assert_eq!(r5.upsert["k2"], a(2, 2));
    }

    #[test]
    fn figures_are_rounded_to_ten_significant_digits_but_integers_are_left_alone() {
        let mut v = json!({"p": 187.929_657_972_095_04, "ms": 1_792_096_612_324_i64, "z": 0.0, "n": [0.1 + 0.2]});
        compact(&mut v);
        assert_eq!(v["p"], json!(187.929_658));
        assert_eq!(v["ms"], json!(1_792_096_612_324_i64));
        assert_eq!(v["z"], json!(0.0));
        assert_eq!(v["n"][0], json!(0.3));
    }

    #[test]
    fn items_known_to_be_unchanged_are_not_rendered_but_still_present() {
        let mut d = Differ::new();
        let v = |n: i64| json!({"metrics": {"n": n}});
        d.diff(
            "bots",
            [("a".to_owned(), v(1)), ("b".to_owned(), v(1))],
            &[],
        );
        // Only `a` changed; `b` is present and untouched, `c` is new.
        let present = ["a".to_owned(), "b".to_owned(), "c".to_owned()];
        let r = d.diff_changed(
            "bots",
            [("a".to_owned(), v(2)), ("c".to_owned(), v(9))],
            &present,
            &[],
        );
        assert_eq!(r.upsert["a"], json!({"metrics": {"n": 2}}));
        assert_eq!(r.upsert["c"], v(9));
        assert!(!r.upsert.contains_key("b") && r.remove.is_empty());
        // `b` missing from `present` is removed.
        let r =
            d.diff_changed::<serde_json::Value>("bots", [], &["a".to_owned(), "c".to_owned()], &[]);
        assert_eq!(r.remove, vec!["b".to_owned()]);
    }

    #[test]
    fn a_changed_group_is_patched_key_by_key() {
        let mut d = Differ::new();
        let v = |a: i64, b: i64| json!({"metrics": {"a": a, "b": b}, "state": {"s": 1}});
        d.diff("bots", [("k".to_owned(), v(1, 2))], &[]);
        let r = d.diff("bots", [("k".to_owned(), v(1, 3))], &[]);
        assert_eq!(r.upsert["k"], json!({"metrics": {"b": 3}}));
        // A key that vanished is cleared with null, which the client's merge applies.
        let r = d.diff(
            "bots",
            [(
                "k".to_owned(),
                json!({"metrics": {"a": 1}, "state": {"s": 1}}),
            )],
            &[],
        );
        assert_eq!(r.upsert["k"], json!({"metrics": {"b": null}}));
    }

    #[test]
    fn a_freshness_that_only_moved_in_time_rides_along_but_never_alone() {
        let mut d = Differ::new();
        let v = |n: i64, as_of: i64, stale: bool| {
            json!({
                "metrics": {"n": n},
                "freshness": {"metrics": {"as_of_ms": as_of, "source": "ws", "stale": stale}},
            })
        };
        d.diff("bots", [("k".to_owned(), v(1, 100, false))], &["as_of_ms"]);
        let r = d.diff("bots", [("k".to_owned(), v(1, 200, false))], &["as_of_ms"]);
        assert!(r.is_empty(), "a refreshed timestamp alone is not a frame");
        // The stale flag flipping is meaningful and carries the newest timestamp.
        let r = d.diff("bots", [("k".to_owned(), v(1, 300, true))], &["as_of_ms"]);
        assert_eq!(
            r.upsert["k"],
            json!({"freshness": {"metrics": {"as_of_ms": 300, "source": "ws", "stale": true}}})
        );
    }

    #[test]
    fn volatile_fields_alone_do_not_produce_a_frame_but_ride_along() {
        let mut d = Differ::new();
        let v = |sev: &str, seen: i64| json!({"severity": sev, "last_seen_ms": seen});
        d.diff(
            "alerts",
            [("a".to_owned(), v("info", 1))],
            &["last_seen_ms"],
        );
        let r = d.diff(
            "alerts",
            [("a".to_owned(), v("info", 2))],
            &["last_seen_ms"],
        );
        assert!(r.is_empty());
        let r = d.diff(
            "alerts",
            [("a".to_owned(), v("critical", 3))],
            &["last_seen_ms"],
        );
        assert_eq!(r.upsert["a"], v("critical", 3));
    }

    #[test]
    fn applying_the_diffs_in_order_reproduces_the_state() {
        use fg_core::protocol::ChannelState;
        let mut d = Differ::new();
        let mut client = ChannelState::default();
        let states = [
            vec![("a", 1), ("b", 1)],
            vec![("a", 2), ("b", 1)],
            vec![("b", 1), ("c", 9)],
            vec![],
        ];
        for st in states {
            let items: Vec<(String, Value)> = st
                .iter()
                .map(|(k, n)| {
                    (
                        (*k).to_owned(),
                        json!({"metrics": {"n": n}, "state": {"s": "x"}}),
                    )
                })
                .collect();
            let diff = d.diff("bots", items.clone(), &[]);
            let mut up = BTreeMap::new();
            up.insert("bots".to_owned(), diff.upsert);
            let mut rm = BTreeMap::new();
            rm.insert("bots".to_owned(), diff.remove);
            client.apply(&up, &rm);
            let expected: BTreeMap<String, Value> = items.into_iter().collect();
            assert_eq!(
                client.collections.get("bots").cloned().unwrap_or_default(),
                expected
            );
        }
    }
}
