//! Runs the shared test vectors (`gateway/fixtures/vectors/*.json`).
//!
//! The same files are executed by the browser direct mode with vitest, so a vector is the
//! executable contract between the Rust and the TypeScript implementations. See `README.md` in
//! the vectors directory for the format.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use fg_core::alerts::book::BookState;
use fg_core::alerts::{
    AlertBook, AlertRulesConfig, AlertTypeId, BotAlertContext, Evaluation, evaluate_bot,
};
use fg_core::calc::{
    capital, drawdown, duration, exit_reason, exposure, freshness, hip3, periods, stats,
};
use fg_core::model::Freshness;
use fg_core::protocol::{
    Channel, ChannelState, DELTA_BUFFER_SIZE, DeltaBuffer, Remove, Resume, SeqTracker, Upsert,
};
use fg_core::time;
use serde::Deserialize;
use serde_json::{Value, json};

const TOLERANCE: f64 = 1e-9;

fn vectors_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/vectors")
}

#[derive(Deserialize)]
struct VectorFile {
    function: String,
    #[serde(default)]
    defaults: Value,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    name: String,
    input: Value,
    expected: Value,
}

fn from<T: serde::de::DeserializeOwned>(v: &Value) -> T {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("bad input {v}: {e}"))
}

fn to<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap()
}

/// Shallow merge of `over` onto `base` (both objects).
fn overlay(base: &Value, over: &Value) -> Value {
    let mut out = base.clone();
    if let (Some(o), Some(src)) = (out.as_object_mut(), over.as_object()) {
        for (k, v) in src {
            o.insert(k.clone(), v.clone());
        }
    }
    out
}

fn dexes(input: &Value) -> Vec<String> {
    input
        .get("dexes")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|d| d.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_else(|| {
            hip3::DEFAULT_DEXES
                .iter()
                .map(|s| (*s).to_owned())
                .collect()
        })
}

/// Build the effective rules of the vector: everything disabled except `enabled`, with optional
/// thresholds and `for_s`.
fn rules_from(input: &Value) -> BTreeMap<AlertTypeId, fg_core::alerts::RuleConfig> {
    let mut cfg = AlertRulesConfig::default();
    let enabled: Vec<AlertTypeId> = from(&input["enabled"]);
    let thresholds: BTreeMap<AlertTypeId, f64> =
        input.get("thresholds").map_or_else(Default::default, from);
    let for_s: BTreeMap<AlertTypeId, u32> = input.get("for_s").map_or_else(Default::default, from);
    for t in AlertTypeId::ALL {
        let e = cfg.global.entry(t).or_default();
        e.enabled = enabled.contains(&t);
        if let Some(th) = thresholds.get(&t) {
            e.threshold = Some(*th);
        }
        if let Some(f) = for_s.get(&t) {
            e.for_s = Some(*f);
        }
    }
    cfg.effective_for("vector")
}

fn run_book_script(input: &Value) -> Value {
    let mut book = AlertBook::new();
    let mut results = Vec::new();
    for step in input["steps"].as_array().expect("steps") {
        let op = step["op"].as_str().expect("op");
        let now = step["now_ms"].as_i64().expect("now_ms");
        let mut transitions = Vec::new();
        match op {
            "evaluate" => {
                let ev = Evaluation {
                    conditions: from(&step["conditions"]),
                    evaluated: from::<BTreeSet<AlertTypeId>>(&step["evaluated"]),
                    disabled: step.get("disabled").map_or_else(Default::default, from),
                };
                let bot = step["bot_key"].as_str().unwrap();
                transitions = book.evaluate_bot(now, bot, &ev);
            }
            "ack" | "silence" => {
                let t: Option<AlertTypeId> = step.get("type_id").map(from);
                let bot = step.get("bot_key").and_then(Value::as_str);
                let subject = step.get("subject").and_then(Value::as_str);
                if op == "ack" {
                    let id = book
                        .alerts(now)
                        .into_iter()
                        .find(|a| {
                            Some(a.type_id) == t
                                && a.bot_key.as_deref() == bot
                                && a.subject.as_deref() == subject
                        })
                        .expect("alert to ack")
                        .id;
                    book.ack(&id, step.get("session").and_then(Value::as_str), now)
                        .unwrap();
                } else {
                    book.silence(t, bot, subject, step["until_ms"].as_i64().unwrap(), now)
                        .unwrap();
                }
            }
            "snapshot" => {}
            other => panic!("unknown op {other}"),
        }
        let active: Vec<Value> = book
            .alerts(now)
            .iter()
            .map(|a| {
                json!({"type_id": a.type_id, "bot_key": a.bot_key, "subject": a.subject,
                       "severity": a.severity, "view": a.view(now)})
            })
            .collect();
        let tr: Vec<Value> = transitions
            .iter()
            .map(|t| {
                json!({"kind": t.kind, "type_id": t.alert.type_id, "bot_key": t.alert.bot_key,
                       "subject": t.alert.subject, "silenced": t.alert.silenced_until_ms.is_some()})
            })
            .collect();
        results.push(json!({"transitions": tr, "active": active, "bell": book.bell_count(now)}));
    }
    // A book must also survive persistence between steps.
    let state: BookState = book.to_state();
    let reloaded = AlertBook::from_state(
        serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap(),
    );
    let last_now = input["steps"]
        .as_array()
        .and_then(|s| s.last())
        .and_then(|s| s["now_ms"].as_i64())
        .unwrap_or(0);
    assert_eq!(
        reloaded.alerts(last_now),
        book.alerts(last_now),
        "book state does not round-trip"
    );
    Value::Array(results)
}

fn run(function: &str, input: &Value, defaults: &Value) -> Value {
    match function {
        "time.normalize_ts_ms" => to(&time::normalize_ts_ms(input.as_f64().unwrap())),
        "time.parse_date_ms" => to(&time::parse_date_ms(input.as_str().unwrap())),
        "drawdown.compute" => to(&drawdown::compute(&from(input))),
        "drawdown.open_worst_abs" => to(&drawdown::open_worst_abs(&from(input))),
        "drawdown.merge_histories" => to(&drawdown::merge_histories(&from::<
            Vec<Vec<drawdown::HistorySample>>,
        >(input))),
        "periods.cutoff" => to(&periods::period_cutoff_ms(
            from(&input["key"]),
            input["now_ms"].as_i64().unwrap(),
            from(&input["tz"]),
        )),
        "periods.pnl_periods" => to(&periods::pnl_periods(
            &from::<Vec<drawdown::ClosedPnl>>(&input["trades"]),
            from(&input["unit"]),
            from(&input["tz"]),
            input["now_ms"].as_i64().unwrap(),
            input["n"].as_u64().unwrap() as usize,
        )),
        "capital.starting_capital" => to(&capital::starting_capital(&from(input))),
        "capital.sum_starting_capital" => to(&capital::sum_starting_capital(&from::<
            Vec<Option<f64>>,
        >(input))),
        "capital.wallet_totals" => to(&capital::wallet_totals(
            &from::<Vec<capital::WalletReport>>(input),
        )),
        "duration.percentile_rank" => to(&duration::percentile_rank(
            &from::<Vec<i64>>(&input["closed_ms"]),
            input["ms"].as_i64().unwrap(),
        )),
        "duration.anomaly_pct" => to(&duration::anomaly_pct(
            input["ms"].as_i64().unwrap(),
            &from::<Vec<i64>>(&input["closed_ms"]),
        )),
        "duration.level" => to(&duration::DurationLevel::from_pct(input.as_f64().unwrap())),
        "duration.median_duration_ms" => {
            to(&duration::median_duration_ms(&from::<Vec<i64>>(input)))
        }
        "duration.percentile_value" => to(&duration::percentile_value(
            &from::<Vec<f64>>(&input["values"]),
            input["p"].as_f64().unwrap(),
        )),
        "duration.parse_avg_duration_ms" => {
            to(&duration::parse_avg_duration_ms(input.as_str().unwrap()))
        }
        "hip3.parse_pair" => {
            let d = dexes(input);
            let refs: Vec<&str> = d.iter().map(String::as_str).collect();
            to(&hip3::parse_pair(input["pair"].as_str().unwrap(), &refs))
        }
        "hip3.whitelist_market" => {
            let d = dexes(input);
            let refs: Vec<&str> = d.iter().map(String::as_str).collect();
            to(&hip3::whitelist_market(
                &from::<Vec<String>>(&input["whitelist"]),
                &refs,
            ))
        }
        "exit_reason.normalize" => to(&exit_reason::normalize_exit_reason(input.as_str())),
        "exposure.exposure" => to(&exposure::exposure(
            &from::<Vec<exposure::ExposurePosition>>(input),
        )),
        "stats.trade_totals" => to(&stats::trade_totals(&from::<Vec<Option<f64>>>(input))),
        "freshness.compute" => to(&Freshness::compute(
            from(&input["source"]),
            input["as_of_ms"].as_i64().unwrap(),
            input["now_ms"].as_i64().unwrap(),
            input["cadence_ms"].as_i64().unwrap_or(0),
            input["has_positions"].as_bool().unwrap_or(false),
        )),
        "freshness.sum_fresh" => {
            let items: Vec<(String, Option<f64>, Freshness)> = input
                .as_array()
                .unwrap()
                .iter()
                .map(|i| {
                    (
                        i["key"].as_str().unwrap().to_owned(),
                        i["value"].as_f64(),
                        from(&i["fresh"]),
                    )
                })
                .collect();
            let s = freshness::sum_fresh(items.iter().map(|(k, v, f)| (k.as_str(), *v, f)));
            json!({"total": s.total, "included": s.included, "excluded": s.excluded})
        }
        "alerts.evaluate_bot" => {
            let ctx_json = overlay(&defaults["ctx"], &input["ctx"]);
            let ctx: BotAlertContext = from(&ctx_json);
            let mut out = to(&evaluate_bot(&rules_from(input), &ctx));
            // `evaluated` and `disabled` are sets: compare them as sorted lists.
            for k in ["evaluated", "disabled"] {
                if let Some(a) = out[k].as_array_mut() {
                    a.sort_by_key(|v| v.as_str().unwrap_or_default().to_owned());
                }
            }
            out
        }
        "alerts.book_script" => run_book_script(input),
        "protocol.channel_parse" => match input.as_str().unwrap().parse::<Channel>() {
            Ok(c) => json!({"channel": c.to_string()}),
            Err(fg_core::protocol::ChannelError::Unknown(_)) => json!({"error": "unknown"}),
            Err(fg_core::protocol::ChannelError::Malformed(_)) => json!({"error": "malformed"}),
        },
        "protocol.seq_script" => {
            let mut t = SeqTracker::new();
            if let Some(b) = input["baseline"].as_u64() {
                t.reset(b);
            }
            let out: Vec<Value> = input["observe"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| to(&t.observe(s.as_u64().unwrap())))
                .collect();
            json!({"verdicts": out, "last": t.last()})
        }
        "protocol.apply" => {
            let mut s = ChannelState::default();
            for f in input["frames"].as_array().unwrap() {
                let up: Upsert = f.get("upsert").map_or_else(Default::default, from);
                let rm: Remove = f.get("remove").map_or_else(Default::default, from);
                s.apply(&up, &rm);
            }
            to(&s.collections)
        }
        "protocol.buffer_resume" => {
            let cap = input
                .get("capacity")
                .and_then(Value::as_u64)
                .map_or(DELTA_BUFFER_SIZE, |c| c as usize);
            let mut b = DeltaBuffer::new(&Channel::Fleet, cap);
            for i in 0..input["pushed"].as_u64().unwrap() {
                b.push_up(i64::try_from(i).unwrap(), Upsert::new(), Remove::new());
            }
            match b.resume(input["from"].as_u64().unwrap()) {
                Resume::UpToDate => json!({"resume": "up_to_date", "head": b.head()}),
                Resume::Replay(f) => json!({"resume": "replay", "head": b.head(),
                    "seqs": f.iter().filter_map(fg_core::protocol::ServerFrame::seq).collect::<Vec<_>>()}),
                Resume::Resync(r) => json!({"resume": "resync", "head": b.head(), "reason": r}),
            }
        }
        other => panic!("vector references unknown function {other:?}"),
    }
}

/// `expected` must be contained in `actual`: objects compare key by key (extra keys in `actual`
/// are ignored), arrays must have the same length, numbers match within [`TOLERANCE`].
fn subset(expected: &Value, actual: &Value, path: &str, errors: &mut Vec<String>) {
    match (expected, actual) {
        (Value::Object(e), Value::Object(a)) => {
            for (k, ev) in e {
                match a.get(k) {
                    Some(av) => subset(ev, av, &format!("{path}.{k}"), errors),
                    None => errors.push(format!("{path}.{k}: missing (expected {ev})")),
                }
            }
        }
        (Value::Array(e), Value::Array(a)) => {
            if e.len() != a.len() {
                errors.push(format!(
                    "{path}: length {} != expected {}",
                    a.len(),
                    e.len()
                ));
                return;
            }
            for (i, (ev, av)) in e.iter().zip(a).enumerate() {
                subset(ev, av, &format!("{path}[{i}]"), errors);
            }
        }
        (Value::Number(e), Value::Number(a)) => {
            let (e, a) = (e.as_f64().unwrap(), a.as_f64().unwrap());
            if (e - a).abs() > TOLERANCE * e.abs().max(1.0) {
                errors.push(format!("{path}: {a} != expected {e}"));
            }
        }
        (e, a) if e == a => {}
        (e, a) => errors.push(format!("{path}: {a} != expected {e}")),
    }
}

#[test]
fn all_vectors_pass() {
    let mut files: Vec<PathBuf> = std::fs::read_dir(vectors_dir())
        .expect("vectors directory")
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no vector files found");

    let mut failures = Vec::new();
    let mut covered = BTreeSet::new();
    let mut cases = 0;
    for path in &files {
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let file: VectorFile = serde_json::from_str(&std::fs::read_to_string(path).unwrap())
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(!file.cases.is_empty(), "{name}: no cases");
        covered.insert(file.function.clone());
        for case in &file.cases {
            cases += 1;
            let actual =
                std::panic::catch_unwind(|| run(&file.function, &case.input, &file.defaults));
            match actual {
                Ok(actual) => {
                    let mut errors = Vec::new();
                    subset(&case.expected, &actual, "$", &mut errors);
                    for e in errors {
                        failures.push(format!("{name} / {} / {}: {e}", file.function, case.name));
                    }
                }
                Err(_) => failures.push(format!(
                    "{name} / {} / {}: panicked",
                    file.function, case.name
                )),
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} vector failure(s):\n{}",
        failures.len(),
        failures.join("\n")
    );
    assert!(
        cases >= 100,
        "expected a substantial vector set, found {cases} cases"
    );

    // Every function the harness knows must be exercised by at least one vector file.
    let known = [
        "time.normalize_ts_ms",
        "time.parse_date_ms",
        "drawdown.compute",
        "drawdown.open_worst_abs",
        "drawdown.merge_histories",
        "periods.cutoff",
        "periods.pnl_periods",
        "capital.starting_capital",
        "capital.sum_starting_capital",
        "capital.wallet_totals",
        "duration.percentile_rank",
        "duration.anomaly_pct",
        "duration.level",
        "duration.median_duration_ms",
        "duration.percentile_value",
        "duration.parse_avg_duration_ms",
        "hip3.parse_pair",
        "hip3.whitelist_market",
        "exit_reason.normalize",
        "exposure.exposure",
        "stats.trade_totals",
        "freshness.compute",
        "freshness.sum_fresh",
        "alerts.evaluate_bot",
        "alerts.book_script",
        "protocol.channel_parse",
        "protocol.seq_script",
        "protocol.apply",
        "protocol.buffer_resume",
    ];
    let missing: Vec<_> = known.iter().filter(|k| !covered.contains(**k)).collect();
    assert!(missing.is_empty(), "no vector for: {missing:?}");
}
