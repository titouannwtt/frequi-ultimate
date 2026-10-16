//! The server half of the delta protocol: turns two consecutive states of keyed collections into
//! the `up` frames a client merges (`merge_entity`), such that a client that applied the frames
//! equals a client that loaded the state. Shared test vectors (`protocol.diff`) pin the contract
//! with the TypeScript hub used by the browser direct mode.

use std::collections::{BTreeMap, HashMap};

use serde::Serialize;
use serde_json::Value;

use super::{Remove, Upsert};

/// Significant digits kept in published figures: 10 digits keep the cents of a million and the
/// last digit of a price, and cut a 17-digit float to about half its length on the wire.
pub const SIGNIFICANT_DIGITS: usize = 10;

/// Round every non-integer number of `v` to [`SIGNIFICANT_DIGITS`]. Snapshots and deltas both go
/// through it, so that a client that applied deltas equals a client that loaded the snapshot.
pub fn compact(v: &mut Value) {
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

pub fn to_value<T: Serialize>(item: T) -> Option<Value> {
    let mut v = serde_json::to_value(item).ok()?;
    compact(&mut v);
    Some(v)
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
    /// Entities that have a field group which dropped a key (a coin whose position closed in
    /// `net_exposure`), as `{key: {group: null}}`. The client merges an object group key by key,
    /// so the patch cannot say that a key vanished: such a group is first reset to `null` in a
    /// frame of its own, then sent in full in the main frame (see [`frame_bodies`]). The same
    /// two-step as the TypeScript hub (B76).
    pub resets: BTreeMap<String, Value>,
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
                    let (patch, meaningful, resets) = field_patch(old, &new, volatile);
                    if meaningful {
                        if !resets.is_empty() {
                            out.resets.insert(
                                key.clone(),
                                Value::Object(
                                    resets.into_iter().map(|g| (g, Value::Null)).collect(),
                                ),
                            );
                        }
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

/// The patch from `old` to `new`, whether a non-volatile field changed, and the groups that must
/// be reset to `null` before the patch is applied. When something meaningful changed, volatile
/// changes ride along.
///
/// A field group (an object) is patched key by key, like the client merges it: only the changed
/// keys are sent. A group that dropped a key cannot be expressed that way (the client merge only
/// adds and overwrites): it is sent in full and listed in the third element, so that the caller
/// resets it first. Anything else is sent whole.
fn field_patch(
    old: &Value,
    new: &Value,
    volatile: &[&str],
) -> (serde_json::Map<String, Value>, bool, Vec<String>) {
    let mut patch = serde_json::Map::new();
    let mut meaningful = false;
    let mut resets = Vec::new();
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
                    if og.keys().any(|gk| !ng.contains_key(gk)) {
                        resets.push(k.clone());
                        patch.insert(k.clone(), v.clone());
                        continue;
                    }
                    let group: serde_json::Map<String, Value> = ng
                        .iter()
                        .filter(|(gk, gv)| og.get(*gk) != Some(*gv))
                        .map(|(gk, gv)| (gk.clone(), gv.clone()))
                        .collect();
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
    (patch, meaningful, resets)
}

/// The bodies of the `up` frames that carry the diffs of several collections of one channel,
/// in the order they must be published: first the resets of the groups that dropped a key (if
/// any), then the upserts and removals. The client applies the frames of one tick in the same
/// batch, so the reset is never rendered.
#[must_use]
pub fn frame_bodies<'a>(
    parts: impl IntoIterator<Item = (&'a str, CollectionDiff)>,
) -> Vec<(Upsert, Remove)> {
    let mut reset = Upsert::new();
    let mut up = Upsert::new();
    let mut rm = Remove::new();
    for (name, d) in parts {
        if !d.resets.is_empty() {
            reset.insert(name.to_owned(), d.resets);
        }
        if !d.upsert.is_empty() {
            up.insert(name.to_owned(), d.upsert);
        }
        if !d.remove.is_empty() {
            rm.insert(name.to_owned(), d.remove);
        }
    }
    let mut out = Vec::new();
    if !reset.is_empty() {
        out.push((reset, Remove::new()));
    }
    if !up.is_empty() || !rm.is_empty() {
        out.push((up, rm));
    }
    out
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
        // A key that vanished cannot be said by a merge patch: the group is reset first (its own
        // frame, before the main one), then sent in full.
        let r = d.diff(
            "bots",
            [(
                "k".to_owned(),
                json!({"metrics": {"a": 1}, "state": {"s": 1}}),
            )],
            &[],
        );
        assert_eq!(r.resets["k"], json!({"metrics": null}));
        assert_eq!(r.upsert["k"], json!({"metrics": {"a": 1}}));
        let bodies = frame_bodies([("bots", r)]);
        assert_eq!(bodies.len(), 2, "reset frame then main frame");
        assert_eq!(bodies[0].0["bots"]["k"], json!({"metrics": null}));
        assert_eq!(bodies[1].0["bots"]["k"], json!({"metrics": {"a": 1}}));
    }

    #[test]
    fn a_dropped_key_disappears_on_the_client_like_in_a_snapshot() {
        use super::super::ChannelState;
        let mut d = Differ::new();
        let mut client = ChannelState::default();
        let wallet = |coins: &[(&str, f64)]| {
            let net: serde_json::Map<String, Value> = coins
                .iter()
                .map(|(c, v)| ((*c).to_owned(), json!(v)))
                .collect();
            json!({"net_exposure": net, "n": coins.len()})
        };
        let mut check = |coins: &[(&str, f64)]| {
            let w = wallet(coins);
            let diff = d.diff("wallets", [("w".to_owned(), w.clone())], &[]);
            for (up, rm) in frame_bodies([("wallets", diff)]) {
                client.apply(&up, &rm);
            }
            assert_eq!(client.collections["wallets"]["w"], w);
        };
        check(&[("BTC", 1.0), ("ETH", 2.0)]);
        check(&[("BTC", 1.5), ("ETH", 2.0)]);
        // ETH closed: the key is really gone on the client, not left as null.
        check(&[("BTC", 1.5)]);
        // Closed and reopened with another coin in the same tick.
        check(&[("SOL", 3.0)]);
        check(&[]);
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
        use crate::protocol::ChannelState;
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
