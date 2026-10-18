//! Historical candles from the feather files that sit on this host: no network, never the
//! exchange.
//!
//! Two kinds of directory are read, in the order of the configuration (the first wins when two
//! files carry the same candle): the cache of the ftcache daemon (the 5000 latest candles, always
//! fresh) and the freqtrade data directory (a long history, refreshed from time to time). Both
//! hold Arrow IPC files (lz4 frames) with the columns `date`, `open`, `high`, `low`, `close` and
//! `volume`, and one file per pair and timeframe.
//!
//! A decoded series is kept in a small cache bounded in series and in rows (the gateway has a tight
//! memory budget) and keyed by the identity of the file: path, modification time and size. A
//! timeframe with no file is rebuilt from the finest timeframe that divides it exactly.
//!
//! Everything here blocks (file reads, decoding): callers run it on a blocking thread.

use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use arrow_array::cast::AsArray;
use arrow_array::types::{
    Float64Type, TimestampMicrosecondType, TimestampMillisecondType, TimestampNanosecondType,
    TimestampSecondType,
};
use arrow_array::{Array, RecordBatch};
use arrow_ipc::reader::FileReader;
use arrow_schema::{DataType, TimeUnit};

/// Opening times outside these bounds (2000-01-01 and 2100-01-01) are not candles: the ftcache
/// files of some pairs hold rows at 0 and 1 and dates divided by a million, left by an old padding.
const TS_MIN: i64 = 946_684_800_000;
const TS_MAX: i64 = 4_102_444_800_000;

/// A timeframe the route accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Timeframe {
    pub name: &'static str,
    pub ms: i64,
}

const fn tf(name: &'static str, minutes: i64) -> Timeframe {
    Timeframe {
        name,
        ms: minutes * 60_000,
    }
}

/// The accepted timeframes, finest first.
pub const TIMEFRAMES: [Timeframe; 14] = [
    tf("1m", 1),
    tf("3m", 3),
    tf("5m", 5),
    tf("15m", 15),
    tf("30m", 30),
    tf("1h", 60),
    tf("2h", 120),
    tf("4h", 240),
    tf("6h", 360),
    tf("8h", 480),
    tf("12h", 720),
    tf("1d", 1_440),
    tf("3d", 4_320),
    // Weeks are cut on the epoch, like the exchange does (a week opens on Thursday 00:00 UTC).
    tf("1w", 10_080),
];

/// The timeframe called `name`, if it is one of [`TIMEFRAMES`].
#[must_use]
pub fn timeframe(name: &str) -> Option<Timeframe> {
    TIMEFRAMES.iter().copied().find(|t| t.name == name)
}

/// The longest pair name accepted.
const PAIR_MAX_LEN: usize = 64;

/// The file stem of a pair (`BTC/USDC:USDC` gives `BTC_USDC_USDC`), or `None` when the pair is
/// not a plain pair name: only letters, digits and `_ / : - .` are allowed, neither a dot nor a
/// slash starts a name and two dots never follow each other. The result has no separator, so it
/// cannot reach outside the directory it is joined to.
#[must_use]
pub fn pair_stem(pair: &str) -> Option<String> {
    let ok = !pair.is_empty()
        && pair.len() <= PAIR_MAX_LEN
        && !pair.starts_with(['.', '/'])
        && !pair.contains("..")
        && pair
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'/' | b':' | b'-' | b'.'));
    ok.then(|| pair.replace(['/', ':'], "_"))
}

/// One candle.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bar {
    /// Opening time, milliseconds since the epoch.
    pub ts: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

/// A candle as the API sends it: `[ts_ms, open, high, low, close, volume]`.
pub type Row = (i64, f64, f64, f64, f64, f64);

impl From<Bar> for Row {
    fn from(b: Bar) -> Self {
        (b.ts, b.open, b.high, b.low, b.close, b.volume)
    }
}

/// A directory of feather files and how they are named in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CandleDir {
    pub path: PathBuf,
    /// File name with `{pair}` (the stem of the pair) and `{tf}` in it.
    pub pattern: String,
}

impl CandleDir {
    fn file(&self, stem: &str, tf: &str) -> PathBuf {
        self.path
            .join(self.pattern.replace("{pair}", stem).replace("{tf}", tf))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CandleStoreConfig {
    /// By decreasing priority.
    pub dirs: Vec<CandleDir>,
    /// Decoded files kept in memory at most.
    pub max_series: usize,
    /// Candles kept in memory at most, all files together (48 bytes each).
    pub max_rows: usize,
}

/// A page of candles.
#[derive(Debug, Clone, PartialEq)]
pub struct Page {
    /// Oldest first, the opening time below the requested `end`.
    pub bars: Vec<Bar>,
    /// Older candles exist than the first one of `bars`.
    pub has_more: bool,
    /// Opening time of the oldest candle there is for this pair and timeframe.
    pub first_available_ms: Option<i64>,
    /// The timeframe the candles were rebuilt from, when there is no file for the one asked.
    pub resampled_from: Option<&'static str>,
}

impl Page {
    fn empty() -> Self {
        Self {
            bars: Vec::new(),
            has_more: false,
            first_available_ms: None,
            resampled_from: None,
        }
    }
}

type Series = Arc<Vec<Bar>>;

struct Entry {
    mtime: SystemTime,
    len: u64,
    series: Series,
    used: u64,
}

#[derive(Default)]
struct Lru {
    entries: HashMap<PathBuf, Entry>,
    tick: u64,
    rows: usize,
}

/// The candles of this host.
pub struct CandleStore {
    cfg: CandleStoreConfig,
    lru: Mutex<Lru>,
    /// One decoding at a time: a burst of requests for the same file decodes it once, and the
    /// host is never asked for several decodings in parallel.
    gate: Mutex<()>,
    loads: AtomicU64,
}

impl CandleStore {
    #[must_use]
    pub fn new(cfg: CandleStoreConfig) -> Self {
        Self {
            cfg,
            lru: Mutex::new(Lru::default()),
            gate: Mutex::new(()),
            loads: AtomicU64::new(0),
        }
    }

    /// How many files were decoded so far (a cache hit does not count).
    #[must_use]
    pub fn loads(&self) -> u64 {
        self.loads.load(Ordering::Relaxed)
    }

    /// The `limit` candles of `pair` (as [`pair_stem`] returned it) that open just before `end`
    /// (exclusive; `None` for the latest).
    #[must_use]
    pub fn page(&self, stem: &str, tf: Timeframe, end: Option<i64>, limit: usize) -> Page {
        let limit = limit.max(1);
        let native = self.sources(stem, tf.name);
        if native.iter().any(|s| !s.is_empty()) {
            return window(&native, end, limit);
        }
        // The timeframes that make this one exactly, each with its data.
        let bases: Vec<(Timeframe, Vec<Series>)> = TIMEFRAMES
            .iter()
            .filter(|b| b.ms < tf.ms && tf.ms % b.ms == 0)
            .map(|b| (*b, self.sources(stem, b.name)))
            .filter(|(_, s)| s.iter().any(|s| !s.is_empty()))
            .collect();
        // The finest one, unless a coarser one reaches back by a bucket or more: the files of the
        // fine timeframes are often the shorter ones, and the history is what this is for.
        let oldest = bases.iter().filter_map(|(_, s)| first_ts(s)).min();
        let base = bases
            .iter()
            .find(|(_, s)| first_ts(s).zip(oldest).is_some_and(|(f, o)| f - o < tf.ms));
        if let Some((base, srcs)) = base {
            return resample(srcs, *base, tf, end, limit);
        }
        Page::empty()
    }

    /// The series of every file that exists for this pair and timeframe, by priority.
    fn sources(&self, stem: &str, tf: &str) -> Vec<Series> {
        self.cfg
            .dirs
            .iter()
            .filter_map(|d| self.series(&d.file(stem, tf)))
            .collect()
    }

    /// The decoded file, from the cache when it did not change. A missing or unreadable file is
    /// no source.
    fn series(&self, path: &Path) -> Option<Series> {
        let meta = std::fs::metadata(path).ok()?;
        if let Some(s) = self.cached(path, &meta) {
            return Some(s);
        }
        let _gate = self
            .gate
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // Somebody may have decoded it while this call waited.
        if let Some(s) = self.cached(path, &meta) {
            return Some(s);
        }
        let file = File::open(path).ok()?;
        // The identity comes from the handle that is decoded, so a file replaced meanwhile is
        // seen as changed by the next call.
        let meta = file.metadata().ok()?;
        let series = match decode(file) {
            Ok(v) => Arc::new(v),
            Err(e) => {
                tracing::warn!(file = %path.display(), error = %e, "candle file not readable");
                return None;
            }
        };
        self.loads.fetch_add(1, Ordering::Relaxed);
        self.insert(path, &meta, &series);
        Some(series)
    }

    fn cached(&self, path: &Path, meta: &std::fs::Metadata) -> Option<Series> {
        let mtime = meta.modified().ok()?;
        let mut lru = self
            .lru
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        lru.tick += 1;
        let tick = lru.tick;
        let e = lru.entries.get_mut(path)?;
        if e.mtime != mtime || e.len != meta.len() {
            return None;
        }
        e.used = tick;
        Some(Arc::clone(&e.series))
    }

    fn insert(&self, path: &Path, meta: &std::fs::Metadata, series: &Series) {
        // A file with no modification time cannot be told from its successor: never kept.
        let Ok(mtime) = meta.modified() else { return };
        let mut lru = self
            .lru
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(old) = lru.entries.remove(path) {
            lru.rows -= old.series.len();
        }
        // Too big to ever fit: served, not kept.
        if series.len() > self.cfg.max_rows || self.cfg.max_series == 0 {
            return;
        }
        while !lru.entries.is_empty()
            && (lru.entries.len() >= self.cfg.max_series
                || lru.rows + series.len() > self.cfg.max_rows)
        {
            let Some(oldest) = lru
                .entries
                .iter()
                .min_by_key(|(_, e)| e.used)
                .map(|(k, _)| k.clone())
            else {
                break;
            };
            if let Some(old) = lru.entries.remove(&oldest) {
                lru.rows -= old.series.len();
            }
        }
        lru.tick += 1;
        let used = lru.tick;
        lru.rows += series.len();
        lru.entries.insert(
            path.to_path_buf(),
            Entry {
                mtime,
                len: meta.len(),
                series: Arc::clone(series),
                used,
            },
        );
    }
}

/// The candles of several series, newest first, one per opening time; on a tie the series that
/// comes first in `srcs` wins. Only candles that open before `upper` (exclusive).
struct Newest<'a> {
    srcs: Vec<&'a [Bar]>,
}

impl<'a> Newest<'a> {
    fn new(srcs: &'a [Series], upper: i64) -> Self {
        Self {
            srcs: srcs
                .iter()
                .map(|s| &s[..s.partition_point(|b| b.ts < upper)])
                .collect(),
        }
    }
}

impl Iterator for Newest<'_> {
    type Item = Bar;

    fn next(&mut self) -> Option<Bar> {
        let ts = self
            .srcs
            .iter()
            .filter_map(|s| s.last())
            .map(|b| b.ts)
            .max()?;
        let mut found = None;
        for s in &mut self.srcs {
            if let Some((last, rest)) = s.split_last()
                && last.ts == ts
            {
                found.get_or_insert(*last);
                *s = rest;
            }
        }
        found
    }
}

fn first_ts(srcs: &[Series]) -> Option<i64> {
    srcs.iter().filter_map(|s| s.first()).map(|b| b.ts).min()
}

fn last_ts(srcs: &[Series]) -> Option<i64> {
    srcs.iter().filter_map(|s| s.last()).map(|b| b.ts).max()
}

/// The newest `limit` candles that open before `end`.
fn window(srcs: &[Series], end: Option<i64>, limit: usize) -> Page {
    let first_available_ms = first_ts(srcs);
    let mut bars: Vec<Bar> = Newest::new(srcs, end.unwrap_or(i64::MAX))
        .take(limit)
        .collect();
    bars.reverse();
    let has_more = match (bars.first(), first_available_ms) {
        (Some(b), Some(first)) => first < b.ts,
        _ => false,
    };
    Page {
        bars,
        has_more,
        first_available_ms,
        resampled_from: None,
    }
}

fn floor_to(x: i64, m: i64) -> i64 {
    x.div_euclid(m) * m
}

fn ceil_to(x: i64, m: i64) -> i64 {
    (x + m - 1).div_euclid(m) * m
}

/// The candles of `target`, built from those of `base` (which divides it). The buckets are cut on
/// the epoch. The oldest one is left out when the data starts inside it, since it would be
/// partial; the newest one, which may still be forming, is kept like a native candle is.
fn resample(
    srcs: &[Series],
    base: Timeframe,
    target: Timeframe,
    end: Option<i64>,
    limit: usize,
) -> Page {
    let m = target.ms;
    let (Some(first), Some(last)) = (first_ts(srcs), last_ts(srcs)) else {
        return Page::empty();
    };
    let oldest = ceil_to(first, m);
    if last < oldest {
        return Page::empty();
    }
    let mut page = Page {
        bars: Vec::new(),
        has_more: false,
        first_available_ms: Some(oldest),
        resampled_from: Some(base.name),
    };
    let newest = floor_to(last, m);
    let top = end.map_or(newest, |e| newest.min(floor_to(e.saturating_sub(1), m)));
    if top < oldest {
        return page;
    }
    let mut out: Vec<Bar> = Vec::with_capacity(limit.min(1024));
    let mut cur: Option<Bar> = None;
    for b in Newest::new(srcs, top + m) {
        if b.ts < oldest {
            break;
        }
        let bucket = floor_to(b.ts, m);
        match &mut cur {
            Some(c) if c.ts == bucket => {
                // Going back in time: this candle opens before the bucket's current opening.
                c.open = b.open;
                c.high = c.high.max(b.high);
                c.low = c.low.min(b.low);
                c.volume += b.volume;
            }
            _ => {
                if let Some(done) = cur.take() {
                    out.push(done);
                    if out.len() == limit {
                        break;
                    }
                }
                cur = Some(Bar { ts: bucket, ..b });
            }
        }
    }
    if out.len() < limit {
        out.extend(cur);
    }
    out.reverse();
    page.has_more = out.first().is_some_and(|b| oldest < b.ts);
    page.bars = out;
    page
}

/// Decode a feather file into sorted candles, one per opening time. Rows with no date, a date
/// outside `TS_MIN..TS_MAX` (the ftcache files are padded with rows at the epoch, and the weekly
/// ones hold dates divided by a million) or a price that is not a number are dropped; a volume
/// that is not a number is read as 0.
fn decode(file: File) -> Result<Vec<Bar>, String> {
    let reader = FileReader::try_new(BufReader::new(file), None).map_err(|e| e.to_string())?;
    let mut bars = Vec::new();
    for batch in reader {
        append(&mut bars, &batch.map_err(|e| e.to_string())?)?;
    }
    if bars.windows(2).any(|w| w[0].ts >= w[1].ts) {
        // Stable: of two rows with the same opening time, the later one in the file wins.
        bars.sort_by_key(|b| b.ts);
        let mut dedup: Vec<Bar> = Vec::with_capacity(bars.len());
        for b in bars {
            match dedup.last_mut() {
                Some(l) if l.ts == b.ts => *l = b,
                _ => dedup.push(b),
            }
        }
        bars = dedup;
    }
    bars.shrink_to_fit();
    Ok(bars)
}

fn append(out: &mut Vec<Bar>, batch: &RecordBatch) -> Result<(), String> {
    let column = |name: &str| {
        batch
            .column_by_name(name)
            .ok_or_else(|| format!("column {name} is missing"))
    };
    let floats = |name: &str| {
        column(name).and_then(|c| {
            c.as_primitive_opt::<Float64Type>()
                .ok_or_else(|| format!("column {name} is not float64"))
        })
    };
    let date = column("date")?;
    let ts: Vec<Option<i64>> = match date.data_type() {
        DataType::Timestamp(TimeUnit::Millisecond, _) => date
            .as_primitive::<TimestampMillisecondType>()
            .iter()
            .collect(),
        DataType::Timestamp(TimeUnit::Second, _) => date
            .as_primitive::<TimestampSecondType>()
            .iter()
            .map(|t| t.and_then(|t| t.checked_mul(1000)))
            .collect(),
        DataType::Timestamp(TimeUnit::Microsecond, _) => date
            .as_primitive::<TimestampMicrosecondType>()
            .iter()
            .map(|t| t.map(|t| t.div_euclid(1_000)))
            .collect(),
        DataType::Timestamp(TimeUnit::Nanosecond, _) => date
            .as_primitive::<TimestampNanosecondType>()
            .iter()
            .map(|t| t.map(|t| t.div_euclid(1_000_000)))
            .collect(),
        other => return Err(format!("column date is {other}, not a timestamp")),
    };
    let (open, high, low, close, volume) = (
        floats("open")?,
        floats("high")?,
        floats("low")?,
        floats("close")?,
        floats("volume")?,
    );
    out.reserve(ts.len());
    for (i, t) in ts.into_iter().enumerate() {
        let Some(t) = t.filter(|t| (TS_MIN..TS_MAX).contains(t)) else {
            continue;
        };
        let price = |a: &arrow_array::Float64Array| {
            (a.is_valid(i) && a.value(i).is_finite()).then(|| a.value(i))
        };
        let (Some(o), Some(h), Some(l), Some(c)) =
            (price(open), price(high), price(low), price(close))
        else {
            continue;
        };
        out.push(Bar {
            ts: t,
            open: o,
            high: h,
            low: l,
            close: c,
            volume: price(volume).unwrap_or(0.0),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use arrow_array::{Float64Array, Int64Array, TimestampMillisecondArray};
    use arrow_ipc::CompressionType;
    use arrow_ipc::writer::{FileWriter, IpcWriteOptions};
    use arrow_schema::{Field, Schema};

    use super::*;

    const MIN: i64 = 60_000;
    /// 2026-01-01T00:00:00Z, a Thursday like every epoch week.
    const T0: i64 = 1_767_225_600_000;

    /// A candle whose prices say where it sits: open `n`, high `n + 5`, low `n - 5`, close `n + 1`.
    fn bar(ts: i64, n: f64) -> Bar {
        Bar {
            ts,
            open: n,
            high: n + 5.0,
            low: n - 5.0,
            close: n + 1.0,
            volume: 2.0,
        }
    }

    /// `count` candles from `start`, `step` apart, priced by `price(i)`.
    fn run(start: i64, step: i64, count: usize, price: impl Fn(usize) -> f64) -> Vec<Bar> {
        (0..count)
            .map(|i| bar(start + step * i as i64, price(i)))
            .collect()
    }

    fn write_feather(path: &Path, bars: &[Bar], lz4: bool) {
        let schema = Arc::new(Schema::new(vec![
            Field::new(
                "date",
                DataType::Timestamp(TimeUnit::Millisecond, Some("UTC".into())),
                false,
            ),
            Field::new("open", DataType::Float64, false),
            Field::new("high", DataType::Float64, false),
            Field::new("low", DataType::Float64, false),
            Field::new("close", DataType::Float64, false),
            Field::new("volume", DataType::Float64, false),
        ]));
        let col = |f: fn(&Bar) -> f64| -> Arc<dyn Array> {
            Arc::new(Float64Array::from(bars.iter().map(f).collect::<Vec<_>>()))
        };
        let dates = TimestampMillisecondArray::from(bars.iter().map(|b| b.ts).collect::<Vec<_>>())
            .with_timezone("UTC");
        let batch = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![
                Arc::new(dates),
                col(|b| b.open),
                col(|b| b.high),
                col(|b| b.low),
                col(|b| b.close),
                col(|b| b.volume),
            ],
        )
        .unwrap();
        let opts = IpcWriteOptions::default()
            .try_with_compression(lz4.then_some(CompressionType::LZ4_FRAME))
            .unwrap();
        let mut w =
            FileWriter::try_new_with_options(File::create(path).unwrap(), &schema, opts).unwrap();
        w.write(&batch).unwrap();
        w.finish().unwrap();
    }

    struct Rig {
        _dir: tempfile::TempDir,
        fast: PathBuf,
        long: PathBuf,
        store: CandleStore,
    }

    impl Rig {
        fn new() -> Self {
            Self::with_cache(12, 400_000)
        }

        fn with_cache(max_series: usize, max_rows: usize) -> Self {
            let dir = tempfile::tempdir().unwrap();
            let fast = dir.path().join("ftcache");
            let long = dir.path().join("data");
            std::fs::create_dir_all(&fast).unwrap();
            std::fs::create_dir_all(&long).unwrap();
            let store = CandleStore::new(CandleStoreConfig {
                dirs: vec![
                    CandleDir {
                        path: fast.clone(),
                        pattern: "{pair}-{tf}.feather".into(),
                    },
                    CandleDir {
                        path: long.clone(),
                        pattern: "{pair}-{tf}-futures.feather".into(),
                    },
                ],
                max_series,
                max_rows,
            });
            Self {
                _dir: dir,
                fast,
                long,
                store,
            }
        }

        /// A file of the ftcache directory.
        fn put_fast(&self, stem: &str, tf: &str, bars: &[Bar]) {
            write_feather(&self.fast.join(format!("{stem}-{tf}.feather")), bars, true);
        }

        /// A file of the data directory.
        fn put_long(&self, stem: &str, tf: &str, bars: &[Bar]) {
            write_feather(
                &self.long.join(format!("{stem}-{tf}-futures.feather")),
                bars,
                false,
            );
        }

        fn page(&self, tf: &str, end: Option<i64>, limit: usize) -> Page {
            self.store
                .page("BTC_USDC_USDC", timeframe(tf).unwrap(), end, limit)
        }
    }

    fn stamps(p: &Page) -> Vec<i64> {
        p.bars.iter().map(|b| b.ts).collect()
    }

    #[test]
    fn a_pair_is_a_plain_name_and_never_a_path() {
        assert_eq!(pair_stem("BTC/USDC:USDC").as_deref(), Some("BTC_USDC_USDC"));
        assert_eq!(
            pair_stem("XYZ-AAPL/USDC:USDC").as_deref(),
            Some("XYZ-AAPL_USDC_USDC")
        );
        assert_eq!(
            pair_stem("k.PEPE/USDC:USDC").as_deref(),
            Some("k.PEPE_USDC_USDC")
        );
        for bad in [
            "",
            "..",
            "../etc/passwd",
            "BTC/../../x",
            "a..b",
            ".hidden",
            "/etc/passwd",
            "a b",
            "BTC\\USDC",
            "BTC/USDC:USDC\0",
            "BTC/USDC?x=1",
            "BTC/USDC%2e%2e",
            "é/USDC",
            &"A".repeat(PAIR_MAX_LEN + 1),
        ] {
            assert_eq!(pair_stem(bad), None, "{bad:?}");
        }
        // No separator survives, so the stem stays inside the directory it is joined to.
        let stem = pair_stem("A/B:C").unwrap();
        assert!(!stem.contains(['/', ':']));
    }

    #[test]
    fn a_page_holds_the_newest_candles_before_end_and_says_whether_more_exist() {
        let rig = Rig::new();
        let m15 = 15 * MIN;
        rig.put_fast("BTC_USDC_USDC", "15m", &run(T0, m15, 100, |i| i as f64));

        // Latest: the 10 newest, oldest first.
        let p = rig.page("15m", None, 10);
        assert_eq!(p.bars.len(), 10);
        assert_eq!(p.bars[0].ts, T0 + 90 * m15);
        assert_eq!(p.bars[9].ts, T0 + 99 * m15);
        assert!(p.has_more);
        assert_eq!(p.first_available_ms, Some(T0));
        assert_eq!(p.resampled_from, None);

        // `end` is exclusive: the candle that opens at `end` is not in the page.
        let end = T0 + 50 * m15;
        let p = rig.page("15m", Some(end), 5);
        assert_eq!(
            stamps(&p),
            (45..50).map(|i| T0 + i * m15).collect::<Vec<_>>()
        );
        assert!(p.has_more);
        // Between two candles.
        let p = rig.page("15m", Some(end + 1), 1);
        assert_eq!(stamps(&p), vec![end]);

        // The page that reaches the start has no more.
        let p = rig.page("15m", Some(T0 + 5 * m15), 5000);
        assert_eq!(p.bars.len(), 5);
        assert_eq!(p.bars[0].ts, T0);
        assert!(!p.has_more);
        // Exactly the whole history: nothing older.
        let p = rig.page("15m", None, 100);
        assert_eq!(p.bars.len(), 100);
        assert!(!p.has_more);
        let p = rig.page("15m", None, 99);
        assert!(p.has_more);

        // Walking back page by page gives every candle once, in order.
        let mut all = Vec::new();
        let mut end = None;
        loop {
            let p = rig.page("15m", end, 30);
            all.splice(0..0, stamps(&p));
            if !p.has_more {
                break;
            }
            end = p.bars.first().map(|b| b.ts);
        }
        assert_eq!(all, (0..100).map(|i| T0 + i * m15).collect::<Vec<_>>());

        // Before the first candle, or a limit of zero: no candle, no panic.
        let p = rig.page("15m", Some(T0), 10);
        assert!(p.bars.is_empty() && !p.has_more);
        assert_eq!(p.first_available_ms, Some(T0));
        assert_eq!(rig.page("15m", Some(i64::MIN), 10).bars.len(), 0);
        assert_eq!(rig.page("15m", Some(i64::MAX), 0).bars.len(), 1);
    }

    #[test]
    fn no_file_is_an_empty_page() {
        let rig = Rig::new();
        let p = rig.page("15m", None, 10);
        assert_eq!(p, Page::empty());
        assert_eq!(rig.page("1m", None, 10), Page::empty());
        // A directory that does not exist is no source either.
        let store = CandleStore::new(CandleStoreConfig {
            dirs: vec![CandleDir {
                path: PathBuf::from("/nonexistent/candles"),
                pattern: "{pair}-{tf}.feather".into(),
            }],
            max_series: 4,
            max_rows: 1000,
        });
        assert_eq!(
            store.page("BTC_USDC_USDC", timeframe("1h").unwrap(), None, 10),
            Page::empty()
        );
    }

    #[test]
    fn the_two_sources_are_merged_and_the_first_directory_wins() {
        let rig = Rig::new();
        let m15 = 15 * MIN;
        // The long history: candles 0..60, priced 1000 + i. The cache: candles 40..100, priced
        // 2000 + i (it overlaps the history by 20 candles, and disagrees with it there).
        rig.put_long(
            "BTC_USDC_USDC",
            "15m",
            &run(T0, m15, 60, |i| 1000.0 + i as f64),
        );
        rig.put_fast(
            "BTC_USDC_USDC",
            "15m",
            &run(T0 + 40 * m15, m15, 60, |i| 2000.0 + (40 + i) as f64),
        );

        let p = rig.page("15m", None, 5000);
        assert_eq!(p.bars.len(), 100);
        assert_eq!(p.first_available_ms, Some(T0));
        assert!(!p.has_more);
        assert!(p.bars.windows(2).all(|w| w[0].ts + m15 == w[1].ts));
        for (i, b) in p.bars.iter().enumerate() {
            let want = if i < 40 { 1000.0 } else { 2000.0 } + i as f64;
            assert_eq!(b.open, want, "candle {i}");
        }

        // A page across the seam keeps the same rule.
        let p = rig.page("15m", Some(T0 + 45 * m15), 10);
        assert_eq!(p.bars.len(), 10);
        assert_eq!(p.bars[0].open, 1035.0);
        assert_eq!(p.bars[4].open, 1039.0);
        assert_eq!(p.bars[5].open, 2040.0);
        assert_eq!(p.bars[9].open, 2044.0);
    }

    #[test]
    fn a_missing_timeframe_is_rebuilt_from_the_finest_one_that_divides_it() {
        let rig = Rig::new();
        // Three hours of 15 minutes from midnight, then the next hour is cut in the middle:
        // 15m candles at 00:00 ... 03:30 are 15 candles.
        let m15 = 15 * MIN;
        let hour = 60 * MIN;
        // Priced so that every field of an hour can be checked: open `i`, high `i + 5`, low
        // `i - 5`, close `i + 1`, volume 2.
        rig.put_fast("BTC_USDC_USDC", "15m", &run(T0, m15, 15, |i| i as f64));

        let p = rig.page("1h", None, 100);
        assert_eq!(p.resampled_from, Some("15m"));
        assert_eq!(
            stamps(&p),
            vec![T0, T0 + hour, T0 + 2 * hour, T0 + 3 * hour]
        );
        // The first hour: candles 0..4.
        assert_eq!(
            p.bars[0],
            Bar {
                ts: T0,
                open: 0.0,
                high: 3.0 + 5.0,
                low: 0.0 - 5.0,
                close: 3.0 + 1.0,
                volume: 8.0
            }
        );
        // The last hour is still forming: two candles of it, kept like a native candle is.
        assert_eq!(p.bars[3].open, 12.0);
        assert_eq!(p.bars[3].close, 15.0);
        assert_eq!(p.bars[3].volume, 6.0);
        assert!(!p.has_more);
        assert_eq!(p.first_available_ms, Some(T0));

        // Pages work on the rebuilt series too.
        let p = rig.page("1h", Some(T0 + 3 * hour), 2);
        assert_eq!(stamps(&p), vec![T0 + hour, T0 + 2 * hour]);
        assert!(p.has_more);
        assert_eq!(p.first_available_ms, Some(T0));
        let p = rig.page("1h", Some(T0 + 2 * hour + 1), 1);
        assert_eq!(stamps(&p), vec![T0 + 2 * hour]);
    }

    #[test]
    fn a_bucket_that_starts_before_the_data_is_left_out() {
        let rig = Rig::new();
        let hour = 60 * MIN;
        // Data from 00:30: the 00:00 hour would be half of an hour.
        rig.put_fast(
            "BTC_USDC_USDC",
            "30m",
            &run(T0 + 30 * MIN, 30 * MIN, 5, |i| i as f64),
        );
        let p = rig.page("1h", None, 100);
        assert_eq!(stamps(&p), vec![T0 + hour, T0 + 2 * hour]);
        assert_eq!(p.first_available_ms, Some(T0 + hour));
        assert!(!p.has_more);
        // The page that stops right there has nothing older.
        let p = rig.page("1h", Some(T0 + 2 * hour), 100);
        assert_eq!(stamps(&p), vec![T0 + hour]);
        assert!(!p.has_more);
        // Data that ends inside the first bucket gives nothing.
        let rig = Rig::new();
        rig.put_fast(
            "BTC_USDC_USDC",
            "30m",
            &run(T0 + 30 * MIN, 30 * MIN, 1, |_| 1.0),
        );
        assert_eq!(rig.page("1h", None, 10), Page::empty());
    }

    #[test]
    fn the_finest_timeframe_that_divides_is_used() {
        let rig = Rig::new();
        let hour = 60 * MIN;
        rig.put_fast("BTC_USDC_USDC", "2h", &run(T0, 2 * hour, 6, |i| i as f64));
        let p = rig.page("6h", None, 10);
        assert_eq!(p.resampled_from, Some("2h"));
        assert_eq!(stamps(&p), vec![T0, T0 + 6 * hour]);
        // With a 1h file as well, the 1h file is the base.
        rig.put_long(
            "BTC_USDC_USDC",
            "1h",
            &run(T0, hour, 12, |i| 100.0 + i as f64),
        );
        let p = rig.page("6h", None, 10);
        assert_eq!(p.resampled_from, Some("1h"));
        assert_eq!(p.bars[0].open, 100.0);
        assert_eq!(p.bars[0].close, 106.0);
        assert_eq!(p.bars[0].volume, 12.0);
        // A timeframe that does not divide is no base: 5m cannot make 3m, 4h cannot make 6h.
        let rig = Rig::new();
        rig.put_fast("BTC_USDC_USDC", "5m", &run(T0, 5 * MIN, 30, |i| i as f64));
        assert_eq!(rig.page("3m", None, 10), Page::empty());
        let rig = Rig::new();
        rig.put_fast("BTC_USDC_USDC", "4h", &run(T0, 240 * MIN, 30, |i| i as f64));
        assert_eq!(rig.page("6h", None, 10), Page::empty());
        // Nothing finer than a minute.
        assert_eq!(rig.page("1m", None, 10), Page::empty());
    }

    #[test]
    fn a_coarser_timeframe_that_reaches_back_further_is_the_base() {
        let rig = Rig::new();
        let hour = 60 * MIN;
        // The 5m file starts a day after the 1h file: 6h candles built from it would lose a day
        // of history (more than a bucket).
        rig.put_long("BTC_USDC_USDC", "1h", &run(T0, hour, 72, |i| i as f64));
        rig.put_fast(
            "BTC_USDC_USDC",
            "5m",
            &run(T0 + 24 * hour, 5 * MIN, 12 * 24, |i| i as f64),
        );
        let p = rig.page("6h", None, 100);
        assert_eq!(p.resampled_from, Some("1h"));
        assert_eq!(p.first_available_ms, Some(T0));
        assert_eq!(p.bars.len(), 12);
        // Starting less than a bucket later, the finest one stays the base.
        let rig = Rig::new();
        rig.put_long("BTC_USDC_USDC", "1h", &run(T0, hour, 72, |i| i as f64));
        rig.put_fast(
            "BTC_USDC_USDC",
            "5m",
            &run(T0 + 5 * hour, 5 * MIN, 12 * 48, |i| i as f64),
        );
        assert_eq!(rig.page("6h", None, 100).resampled_from, Some("5m"));
    }

    #[test]
    fn weeks_are_cut_on_the_epoch_like_the_exchange_does() {
        let rig = Rig::new();
        let day = 24 * 60 * MIN;
        // Weeks open on Thursdays: 2025-12-25 is one.
        let thursday = T0 - 7 * day;
        assert_eq!(thursday.rem_euclid(7 * day), 0);
        rig.put_fast(
            "BTC_USDC_USDC",
            "1d",
            &run(thursday - 7 * day, day, 24, |i| i as f64),
        );
        let p = rig.page("1w", None, 10);
        assert_eq!(p.resampled_from, Some("1d"));
        // 24 days: three weeks and the start of a fourth, still forming.
        assert_eq!(
            stamps(&p),
            (0..4)
                .map(|w| thursday + (w - 1) * 7 * day)
                .collect::<Vec<_>>()
        );
        assert!(p.bars.iter().all(|b| b.ts.rem_euclid(7 * day) == 0));
        // The week of `thursday` is days 7..14 of the file.
        assert_eq!(p.bars[1].open, 7.0);
        assert_eq!(p.bars[1].close, 13.0 + 1.0);
        assert_eq!(p.bars[1].volume, 14.0);
        let p = rig.page("1w", Some(thursday + 1), 10);
        assert_eq!(stamps(&p), vec![thursday - 7 * day, thursday]);
    }

    #[test]
    fn a_native_file_is_not_rebuilt() {
        let rig = Rig::new();
        let hour = 60 * MIN;
        rig.put_fast("BTC_USDC_USDC", "1h", &run(T0, hour, 3, |i| 7.0 * i as f64));
        rig.put_fast("BTC_USDC_USDC", "15m", &run(T0, 15 * MIN, 12, |i| i as f64));
        let p = rig.page("1h", None, 10);
        assert_eq!(p.resampled_from, None);
        assert_eq!(p.bars[1].open, 7.0);
    }

    #[test]
    fn a_decoded_file_is_reused_until_its_modification_time_or_size_changes() {
        let rig = Rig::new();
        let m15 = 15 * MIN;
        rig.put_fast("BTC_USDC_USDC", "15m", &run(T0, m15, 10, |i| i as f64));
        assert_eq!(rig.page("15m", None, 100).bars.len(), 10);
        assert_eq!(rig.store.loads(), 1);
        for _ in 0..5 {
            rig.page("15m", Some(T0 + 5 * m15), 3);
        }
        assert_eq!(rig.store.loads(), 1, "served from the cache");

        // Rewritten with another size: read again.
        rig.put_fast(
            "BTC_USDC_USDC",
            "15m",
            &run(T0, m15, 12, |i| 50.0 + i as f64),
        );
        let p = rig.page("15m", None, 100);
        assert_eq!(p.bars.len(), 12);
        assert_eq!(p.bars[0].open, 50.0);
        assert_eq!(rig.store.loads(), 2);

        // Same size (uncompressed files of the same length), same modification time: the file
        // is taken for unchanged, whatever it holds.
        let path = rig.long.join("BTC_USDC_USDC-1h-futures.feather");
        let hour = 60 * MIN;
        rig.put_long(
            "BTC_USDC_USDC",
            "1h",
            &run(T0, hour, 12, |i| 10.0 + i as f64),
        );
        let old = std::fs::metadata(&path).unwrap().modified().unwrap();
        assert_eq!(rig.page("1h", None, 100).bars[0].open, 10.0);
        let loads = rig.store.loads();
        let set_mtime = |t: SystemTime| {
            File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_modified(t)
                .unwrap();
        };
        let size = std::fs::metadata(&path).unwrap().len();
        rig.put_long(
            "BTC_USDC_USDC",
            "1h",
            &run(T0, hour, 12, |i| 90.0 + i as f64),
        );
        assert_eq!(std::fs::metadata(&path).unwrap().len(), size);
        set_mtime(old);
        assert_eq!(rig.page("1h", None, 100).bars[0].open, 10.0);
        assert_eq!(rig.store.loads(), loads);

        // Only the modification time moves: read again.
        set_mtime(old + Duration::from_secs(5));
        assert_eq!(rig.page("1h", None, 100).bars[0].open, 90.0);
        assert_eq!(rig.store.loads(), loads + 1);
        rig.page("1h", None, 100);
        assert_eq!(rig.store.loads(), loads + 1);
    }

    #[test]
    fn the_cache_is_bounded_in_series_and_in_rows() {
        let rig = Rig::with_cache(2, 400_000);
        for tf in ["5m", "15m", "30m"] {
            rig.put_fast("BTC_USDC_USDC", tf, &run(T0, 30 * MIN, 10, |i| i as f64));
        }
        for tf in ["5m", "15m", "30m"] {
            rig.page(tf, None, 10);
        }
        assert_eq!(rig.store.loads(), 3);
        // 30m and 15m are the two latest: still cached. 5m was evicted.
        rig.page("30m", None, 10);
        rig.page("15m", None, 10);
        assert_eq!(rig.store.loads(), 3);
        rig.page("5m", None, 10);
        assert_eq!(rig.store.loads(), 4);
        assert!(rig.store.lru.lock().unwrap().entries.len() <= 2);

        // Rows: two files of 10 rows do not fit a budget of 15.
        let rig = Rig::with_cache(12, 15);
        rig.put_fast("BTC_USDC_USDC", "5m", &run(T0, 5 * MIN, 10, |i| i as f64));
        rig.put_fast("BTC_USDC_USDC", "15m", &run(T0, 15 * MIN, 10, |i| i as f64));
        rig.page("5m", None, 10);
        rig.page("15m", None, 10);
        assert_eq!(rig.store.lru.lock().unwrap().rows, 10);
        // A file bigger than the whole budget is served and never kept.
        let rig = Rig::with_cache(12, 5);
        rig.put_fast("BTC_USDC_USDC", "5m", &run(T0, 5 * MIN, 10, |i| i as f64));
        assert_eq!(rig.page("5m", None, 100).bars.len(), 10);
        assert_eq!(rig.store.lru.lock().unwrap().rows, 0);
        rig.page("5m", None, 100);
        assert_eq!(rig.store.loads(), 2);
    }

    #[test]
    fn rows_that_cannot_be_trusted_are_dropped_and_the_rest_is_sorted() {
        let rig = Rig::new();
        let m15 = 15 * MIN;
        let mut rows = vec![
            bar(T0 + 2 * m15, 3.0),
            bar(0, 9.0), // padding of a young pair: the epoch
            bar(T0, 1.0),
            bar(T0 + m15, 2.0),
            bar(T0 + m15, 2.5), // the same candle again: the later row wins
            bar(-5, 9.0),
            bar(1, 9.0),
            bar(1_788_393, 9.0), // a date divided by a million (the weekly ftcache files)
            bar(9_999_999_999_999, 9.0),
            bar(T0 + 3 * m15, f64::NAN),
        ];
        rows[2].volume = f64::NAN;
        write_feather(&rig.fast.join("BTC_USDC_USDC-15m.feather"), &rows, true);
        let p = rig.page("15m", None, 100);
        assert_eq!(stamps(&p), vec![T0, T0 + m15, T0 + 2 * m15]);
        assert_eq!(p.bars[0].volume, 0.0, "a volume that is not a number is 0");
        assert_eq!(p.bars[1].open, 2.5);
        assert_eq!(p.first_available_ms, Some(T0));
    }

    #[test]
    fn a_file_that_is_not_a_candle_file_is_no_source() {
        let rig = Rig::new();
        let m15 = 15 * MIN;
        let long = rig.long.join("BTC_USDC_USDC-15m-futures.feather");
        std::fs::write(&long, b"not an arrow file").unwrap();
        // A truncated file, as a writer that is not atomic would leave it.
        let fast = rig.fast.join("BTC_USDC_USDC-1h.feather");
        write_feather(&fast, &run(T0, 60 * MIN, 50, |i| i as f64), true);
        let bytes = std::fs::read(&fast).unwrap();
        std::fs::write(&fast, &bytes[..bytes.len() / 2]).unwrap();
        assert_eq!(rig.page("15m", None, 10), Page::empty());
        assert_eq!(rig.page("1h", None, 10), Page::empty());
        assert_eq!(rig.store.loads(), 0);

        // The healthy source still answers when the other one is broken.
        rig.put_fast("BTC_USDC_USDC", "15m", &run(T0, m15, 4, |i| i as f64));
        assert_eq!(rig.page("15m", None, 10).bars.len(), 4);

        // Another schema.
        let schema = Arc::new(Schema::new(vec![Field::new(
            "date",
            DataType::Int64,
            false,
        )]));
        let batch = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![Arc::new(Int64Array::from(vec![1, 2, 3]))],
        )
        .unwrap();
        let path = rig.fast.join("BTC_USDC_USDC-4h.feather");
        let mut w = FileWriter::try_new(File::create(&path).unwrap(), &schema).unwrap();
        w.write(&batch).unwrap();
        w.finish().unwrap();
        // Not a source: the 4h candles are rebuilt from the healthy 15m file.
        let p = rig.page("4h", None, 10);
        assert_eq!(p.resampled_from, Some("15m"));
        assert_eq!(p.bars.len(), 1);
    }

    #[test]
    fn a_lz4_file_written_by_pyarrow_is_read() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/candles");
        let store = CandleStore::new(CandleStoreConfig {
            dirs: vec![CandleDir {
                path: dir,
                pattern: "{pair}-{tf}.feather".into(),
            }],
            max_series: 4,
            max_rows: 10_000,
        });
        let stem = pair_stem("XYZ-TEST/USDC:USDC").unwrap();
        let p = store.page(&stem, timeframe("15m").unwrap(), None, 5000);
        assert_eq!(p.bars.len(), 300);
        assert_eq!(p.first_available_ms, Some(T0));
        for (i, b) in p.bars.iter().enumerate() {
            let open = 100.0 + (i % 10) as f64;
            assert_eq!(
                *b,
                Bar {
                    ts: T0 + 900_000 * i as i64,
                    open,
                    high: open + 1.5,
                    low: open - 1.5,
                    close: open + 0.5,
                    volume: 10.0 + (i % 3) as f64,
                },
                "candle {i}"
            );
        }
        // And it can be rebuilt into hours: 75 of them.
        let p = store.page(&stem, timeframe("1h").unwrap(), None, 5000);
        assert_eq!(p.resampled_from, Some("15m"));
        assert_eq!(p.bars.len(), 75);
    }
}
