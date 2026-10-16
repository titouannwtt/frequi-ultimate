//! Closed trades as the engine keeps them: 96 bytes each instead of a full journal row.
//!
//! 200 000 closed trades are held in memory (03 section 12: 120 MB for the whole process). A
//! [`TradeRow`] costs 224 bytes plus three heap strings; this form keeps the same figures in
//! fixed-size fields and interns the strings (pairs, entry tags and exit reasons repeat across
//! hundreds of thousands of trades). Rows are rebuilt only for the page of a journal a client
//! asks for.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use fg_core::calc::exit_reason::{ExitKind, normalize_exit_reason};
use fg_core::calc::hip3::{Market, parse_pair};
use fg_core::identity::BotKey;
use fg_core::model::{BotMode, Side, TradeRow};
use fg_sources::sqlite::LedgerTrade;

/// Most distinct strings kept. A strategy that writes a unique text in every tag would otherwise
/// grow the table without end; past the cap, new strings share the id of `(other)`.
const MAX_STRINGS: usize = 100_000;
const OTHER: &str = "(other)";
const OTHER_ID: u32 = 1;

struct Table {
    ids: HashMap<Arc<str>, u32>,
    list: Vec<Arc<str>>,
}

/// A table of interned strings, shared by every bot. Id 0 is the empty string.
pub struct Interner {
    table: Mutex<Table>,
}

impl Interner {
    fn new() -> Self {
        let empty: Arc<str> = Arc::from("");
        let other: Arc<str> = Arc::from(OTHER);
        Self {
            table: Mutex::new(Table {
                ids: HashMap::from([(Arc::clone(&empty), 0), (Arc::clone(&other), OTHER_ID)]),
                list: vec![empty, other],
            }),
        }
    }

    /// The id of `s`, adding it when it is new.
    pub fn intern(&self, s: &str) -> u32 {
        let Ok(mut t) = self.table.lock() else {
            return OTHER_ID;
        };
        if let Some(id) = t.ids.get(s) {
            return *id;
        }
        if t.list.len() >= MAX_STRINGS {
            return OTHER_ID;
        }
        let id = u32::try_from(t.list.len()).unwrap_or(OTHER_ID);
        let a: Arc<str> = Arc::from(s);
        t.ids.insert(Arc::clone(&a), id);
        t.list.push(a);
        id
    }

    #[must_use]
    pub fn resolve(&self, id: u32) -> Arc<str> {
        self.table
            .lock()
            .ok()
            .and_then(|t| t.list.get(id as usize).cloned())
            .unwrap_or_else(|| Arc::from(""))
    }

    /// Number of distinct strings held.
    #[must_use]
    pub fn len(&self) -> usize {
        self.table.lock().map_or(0, |t| t.list.len())
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// The interner of the process.
#[must_use]
pub fn strings() -> &'static Interner {
    static STRINGS: OnceLock<Interner> = OnceLock::new();
    STRINGS.get_or_init(Interner::new)
}

const NO_TS: i64 = i64::MIN;
const FLAG_PROFIT_UNKNOWN: u8 = 1;

/// One closed trade. Optional numbers are NaN when absent (a database cannot hold a NaN, so the
/// marker never collides with a real value).
#[derive(Debug, Clone, PartialEq)]
pub struct ClosedTrade {
    pub trade_id: i64,
    pub open_ms: i64,
    close_ms: i64,
    pub open_rate: f64,
    close_rate: f64,
    pub amount: f64,
    pub stake_amount: f64,
    profit_abs: f64,
    profit_ratio: f64,
    pub leverage: f64,
    pair: u32,
    enter_tag: u32,
    exit_raw: u32,
    pub market: Market,
    pub side: Side,
    pub exit_kind: ExitKind,
    flags: u8,
}

fn opt(v: Option<f64>) -> f64 {
    v.filter(|x| !x.is_nan()).unwrap_or(f64::NAN)
}

fn some(v: f64) -> Option<f64> {
    (!v.is_nan()).then_some(v)
}

impl ClosedTrade {
    /// `dexes` are the HIP-3 dexes of the bot, for the market of the pair.
    #[must_use]
    pub fn from_ledger(dexes: &[&str], t: &LedgerTrade) -> Self {
        let s = strings();
        let exit = normalize_exit_reason(t.exit_reason.as_deref());
        Self {
            trade_id: t.id,
            open_ms: t.open_ms.unwrap_or(0),
            close_ms: t.close_ms.unwrap_or(NO_TS),
            open_rate: t.open_rate,
            close_rate: opt(t.close_rate),
            amount: t.amount,
            stake_amount: t.stake_amount,
            profit_abs: opt(t.profit_abs),
            profit_ratio: opt(t.profit_ratio),
            leverage: t.leverage,
            pair: s.intern(&t.pair),
            enter_tag: t.enter_tag.as_deref().map_or(0, |e| s.intern(e)),
            exit_raw: s.intern(&exit.raw),
            market: parse_pair(&t.pair, dexes).market,
            side: Side::from_is_short(t.is_short),
            exit_kind: exit.kind,
            flags: if t.profit_unknown {
                FLAG_PROFIT_UNKNOWN
            } else {
                0
            },
        }
    }

    #[must_use]
    pub fn close_ms(&self) -> Option<i64> {
        (self.close_ms != NO_TS).then_some(self.close_ms)
    }

    #[must_use]
    pub fn close_rate(&self) -> Option<f64> {
        some(self.close_rate)
    }

    #[must_use]
    pub fn profit_abs(&self) -> Option<f64> {
        some(self.profit_abs)
    }

    #[must_use]
    pub fn profit_ratio(&self) -> Option<f64> {
        some(self.profit_ratio)
    }

    #[must_use]
    pub fn profit_unknown(&self) -> bool {
        self.flags & FLAG_PROFIT_UNKNOWN != 0
    }

    /// Closed by a human: a forced exit is the closest thing the ledger can tell.
    #[must_use]
    pub fn manual(&self) -> bool {
        self.exit_kind == ExitKind::ForceExit
    }

    /// Interned id of the pair, for filters that compare many rows against one pattern.
    #[must_use]
    pub fn pair_id(&self) -> u32 {
        self.pair
    }

    /// Interned id of the raw exit reason (0 when unknown).
    #[must_use]
    pub fn exit_id(&self) -> u32 {
        self.exit_raw
    }

    #[must_use]
    pub fn pair(&self) -> Arc<str> {
        strings().resolve(self.pair)
    }

    /// The journal row of this trade.
    #[must_use]
    pub fn to_row(&self, bot: &BotKey, mode: BotMode) -> TradeRow {
        let s = strings();
        TradeRow {
            bot_key: bot.clone(),
            trade_id: self.trade_id,
            pair: s.resolve(self.pair).to_string(),
            market: self.market,
            side: self.side,
            mode,
            leverage: self.leverage,
            open_ms: self.open_ms,
            close_ms: self.close_ms(),
            open_rate: self.open_rate,
            close_rate: self.close_rate(),
            amount: self.amount,
            stake_amount: self.stake_amount,
            profit_abs: self.profit_abs(),
            profit_ratio: self.profit_ratio(),
            profit_unknown: self.profit_unknown(),
            exit_reason: fg_core::calc::exit_reason::ExitReason {
                raw: s.resolve(self.exit_raw).to_string(),
                kind: self.exit_kind,
                class: self.exit_kind.class(),
            },
            enter_tag: (self.enter_tag != 0).then(|| s.resolve(self.enter_tag).to_string()),
            manual: self.manual(),
        }
    }
}

#[cfg(test)]
mod tests {
    use fg_core::calc::exit_reason::normalize_exit_reason;

    use super::*;

    fn lt(id: i64) -> LedgerTrade {
        LedgerTrade {
            id,
            pair: "xyz:NVDA/USDC:USDC".into(),
            is_short: true,
            is_open: false,
            amount: 1.5,
            stake_amount: 30.0,
            open_rate: 100.0,
            close_rate: Some(98.5),
            leverage: 2.1,
            open_ms: Some(1_000),
            close_ms: Some(5_000),
            profit_abs: Some(-1.25),
            profit_ratio: Some(-0.0417),
            profit_unknown: false,
            exit_reason: Some("force_exit".into()),
            enter_tag: Some("dip".into()),
            stop_loss: None,
            initial_stop_loss: None,
            liquidation_price: None,
            funding_fees: None,
            realized_profit: None,
            strategy: None,
        }
    }

    #[test]
    fn a_closed_trade_rebuilds_the_same_journal_row_as_the_direct_conversion() {
        let t = lt(7);
        let c = ClosedTrade::from_ledger(&["xyz"], &t);
        let key = BotKey::Local(9056);
        let row = c.to_row(&key, BotMode::Live);
        assert_eq!(row.trade_id, 7);
        assert_eq!(row.pair, "xyz:NVDA/USDC:USDC");
        assert_eq!(row.side, Side::Short);
        assert_eq!(row.leverage, 2.1, "leverage keeps its exact value");
        assert_eq!(row.close_rate, Some(98.5));
        assert_eq!(row.profit_abs, Some(-1.25));
        assert_eq!(row.enter_tag.as_deref(), Some("dip"));
        assert_eq!(row.exit_reason, normalize_exit_reason(Some("force_exit")));
        assert!(row.manual);
        assert_eq!(
            row.market,
            parse_pair("xyz:NVDA/USDC:USDC", &["xyz"]).market
        );
    }

    #[test]
    fn missing_values_stay_missing_and_are_never_invented() {
        let mut t = lt(8);
        t.close_rate = None;
        t.profit_abs = None;
        t.profit_ratio = None;
        t.profit_unknown = true;
        t.exit_reason = None;
        t.enter_tag = None;
        t.close_ms = None;
        let row = ClosedTrade::from_ledger(&[], &t).to_row(&BotKey::Local(1), BotMode::Dry);
        assert_eq!(
            (
                row.close_rate,
                row.profit_abs,
                row.profit_ratio,
                row.close_ms
            ),
            (None, None, None, None)
        );
        assert!(row.profit_unknown && row.enter_tag.is_none() && !row.manual);
        assert_eq!(row.exit_reason.raw, "");
    }

    #[test]
    fn a_closed_trade_is_small_and_strings_are_shared() {
        assert!(std::mem::size_of::<ClosedTrade>() <= 96);
        let a = ClosedTrade::from_ledger(&[], &lt(1));
        let b = ClosedTrade::from_ledger(&[], &lt(2));
        assert_eq!(a.pair_id(), b.pair_id());
        assert!(Arc::ptr_eq(&a.pair(), &b.pair()), "one allocation for both");
    }

    #[test]
    fn the_table_is_capped() {
        let i = Interner::new();
        for n in 0..(MAX_STRINGS + 10) {
            i.intern(&format!("tag-{n}"));
        }
        assert!(i.len() <= MAX_STRINGS);
        assert_eq!(i.intern("one more"), OTHER_ID);
        assert_eq!(&*i.resolve(OTHER_ID), OTHER);
        assert_eq!(i.intern(""), 0);
    }
}
