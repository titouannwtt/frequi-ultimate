//! A SQLite file in the freqtrade schema, a seed of history, and a writer that behaves like a
//! live bot: it commits all the time and never checkpoints by hand.

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread::JoinHandle;
use std::time::Duration;

use rusqlite::{Connection, params};

use crate::rng::Rng;

const SCHEMA: &str = "
CREATE TABLE trades (
    id INTEGER PRIMARY KEY, exchange VARCHAR(25) NOT NULL, pair VARCHAR(25) NOT NULL,
    base_currency VARCHAR(25), stake_currency VARCHAR(25), is_open BOOLEAN NOT NULL,
    fee_open FLOAT, fee_close FLOAT, open_rate FLOAT, close_rate FLOAT, close_profit FLOAT,
    close_profit_abs FLOAT, stake_amount FLOAT NOT NULL, amount FLOAT, leverage FLOAT,
    is_short BOOLEAN, open_date DATETIME NOT NULL, close_date DATETIME, stop_loss FLOAT,
    stop_loss_pct FLOAT, initial_stop_loss FLOAT, initial_stop_loss_pct FLOAT,
    liquidation_price FLOAT, max_rate FLOAT, min_rate FLOAT, exit_reason VARCHAR(100),
    strategy VARCHAR(100), enter_tag VARCHAR(100), timeframe INTEGER, trading_mode VARCHAR(25),
    funding_fees FLOAT, realized_profit FLOAT);
CREATE TABLE orders (
    id INTEGER PRIMARY KEY, ft_trade_id INTEGER NOT NULL, ft_order_side VARCHAR(25) NOT NULL,
    ft_pair VARCHAR(25) NOT NULL, ft_is_open BOOLEAN NOT NULL, ft_order_tag VARCHAR(100),
    order_id VARCHAR(255) NOT NULL, status VARCHAR(255), order_date DATETIME,
    order_filled_date DATETIME, filled FLOAT, amount FLOAT, average FLOAT, cost FLOAT,
    FOREIGN KEY(ft_trade_id) REFERENCES trades (id));
CREATE TABLE profit_history (
    id INTEGER PRIMARY KEY, timestamp DATETIME NOT NULL, profit_closed_abs FLOAT NOT NULL,
    profit_open_abs FLOAT NOT NULL, open_trades INTEGER NOT NULL);
CREATE INDEX ix_trades_is_open ON trades (is_open);
CREATE INDEX ix_orders_trade ON orders (ft_trade_id);
";

pub const PAIRS: [&str; 12] = [
    "BTC/USDC:USDC",
    "ETH/USDC:USDC",
    "SOL/USDC:USDC",
    "DOGE/USDC:USDC",
    "AVAX/USDC:USDC",
    "LINK/USDC:USDC",
    "ARB/USDC:USDC",
    "OP/USDC:USDC",
    "SUI/USDC:USDC",
    "INJ/USDC:USDC",
    "xyz:NVDA/USDC:USDC",
    "xyz:GOLD/USDC:USDC",
];
const EXITS: [Option<&str>; 6] = [
    Some("roi"),
    Some("exit_signal"),
    Some("stop_loss"),
    Some("force_exit"),
    Some("trailing_stop_loss"),
    None,
];

/// Naive UTC text as SQLAlchemy writes it.
#[must_use]
pub fn date_text(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .unwrap_or_default()
        .naive_utc()
        .format("%Y-%m-%d %H:%M:%S%.6f")
        .to_string()
}

#[derive(Debug, Clone)]
pub struct SeedSpec {
    pub bot_seed: u64,
    pub closed_trades: usize,
    pub open_trades: usize,
    /// Span of the history, in days ending now.
    pub history_days: i64,
    pub profit_history_every_s: i64,
    pub short_share: f64,
}

/// An open position of the seed, for the simulation of the API.
#[derive(Debug, Clone)]
pub struct SeedOpen {
    pub trade_id: i64,
    pub pair: String,
    pub is_short: bool,
    pub open_rate: f64,
    pub amount: f64,
    pub stake: f64,
    pub leverage: f64,
    pub open_ms: i64,
}

pub fn open_db(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.busy_timeout(Duration::from_secs(5))?;
    Ok(conn)
}

/// Create the file with its schema and seed it. Returns the open positions.
pub fn create_and_seed(
    path: &Path,
    spec: &SeedSpec,
    now_ms: i64,
) -> rusqlite::Result<Vec<SeedOpen>> {
    let _ = std::fs::remove_file(path);
    let mut conn = open_db(path)?;
    conn.execute_batch(SCHEMA)?;
    let mut rng = Rng::new(spec.bot_seed);
    let tx = conn.transaction()?;
    let span_ms = spec.history_days * 86_400_000;
    {
        let mut trade = tx.prepare(
            "INSERT INTO trades (id, exchange, pair, base_currency, stake_currency, is_open,
                open_rate, close_rate, close_profit, close_profit_abs, stake_amount, amount,
                leverage, is_short, open_date, close_date, stop_loss, liquidation_price,
                exit_reason, strategy, enter_tag, trading_mode)
             VALUES (?1, 'hyperliquid', ?2, 'X', 'USDC', 0, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                ?12, ?13, ?14, ?15, 'FakeStrategy', 'tag', 'futures')",
        )?;
        for i in 0..spec.closed_trades {
            let id = i64::try_from(i).unwrap_or(0) + 1;
            let closed_at = now_ms - span_ms + span_ms * (id) / (spec.closed_trades as i64 + 1)
                - i64::try_from(rng.below(1_000)).unwrap_or(0);
            let held = 600_000 + i64::try_from(rng.below(40_000_000)).unwrap_or(0);
            let profit_ratio = rng.range(-0.03, 0.032);
            let stake = rng.range(30.0, 150.0);
            let rate = rng.range(0.5, 400.0);
            let short = rng.unit() < spec.short_share;
            let exit = EXITS[usize::try_from(rng.below(EXITS.len() as u64)).unwrap_or(0)];
            trade.execute(params![
                id,
                PAIRS[usize::try_from(rng.below(PAIRS.len() as u64)).unwrap_or(0)],
                rate,
                rate * (1.0 + profit_ratio),
                profit_ratio,
                profit_ratio * stake,
                stake,
                stake * 2.0 / rate,
                2.0,
                short,
                date_text(closed_at - held),
                date_text(closed_at),
                rate * 0.9,
                rate * 0.5,
                exit,
            ])?;
        }
    }
    let mut opens = Vec::new();
    {
        let mut ins = tx.prepare(
            "INSERT INTO trades (id, exchange, pair, base_currency, stake_currency, is_open,
                open_rate, stake_amount, amount, leverage, is_short, open_date, stop_loss,
                liquidation_price, max_rate, min_rate, strategy, enter_tag, trading_mode)
             VALUES (?1, 'hyperliquid', ?2, 'X', 'USDC', 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?3,
                ?3, 'FakeStrategy', 'tag', 'futures')",
        )?;
        let mut order = tx.prepare(
            "INSERT INTO orders (ft_trade_id, ft_order_side, ft_pair, ft_is_open, order_id, status,
                order_date, order_filled_date, filled, amount, average, cost)
             VALUES (?1, ?2, ?3, 0, ?4, 'closed', ?5, ?5, ?6, ?6, ?7, ?8)",
        )?;
        for i in 0..spec.open_trades {
            let id = i64::try_from(spec.closed_trades + i).unwrap_or(0) + 1;
            let pair = PAIRS[usize::try_from(rng.below(PAIRS.len() as u64)).unwrap_or(0)];
            let short = rng.unit() < spec.short_share;
            let rate = rng.range(0.5, 400.0);
            let stake = rng.range(30.0, 120.0);
            let amount = stake * 2.0 / rate;
            let open_ms = now_ms - i64::try_from(rng.below(40_000_000)).unwrap_or(0) - 600_000;
            ins.execute(params![
                id,
                pair,
                rate,
                stake,
                amount,
                2.0,
                short,
                date_text(open_ms),
                if short { rate * 1.1 } else { rate * 0.9 },
                if short { rate * 1.5 } else { rate * 0.5 },
            ])?;
            let entries = 1 + rng.below(3);
            for e in 0..entries {
                order.execute(params![
                    id,
                    if short { "sell" } else { "buy" },
                    pair,
                    format!("o-{id}-{e}"),
                    date_text(open_ms + i64::try_from(e).unwrap_or(0) * 60_000),
                    amount / entries as f64,
                    rate,
                    stake / entries as f64,
                ])?;
            }
            opens.push(SeedOpen {
                trade_id: id,
                pair: pair.to_owned(),
                is_short: short,
                open_rate: rate,
                amount,
                stake,
                leverage: 2.0,
                open_ms,
            });
        }
    }
    {
        let mut ph = tx.prepare(
            "INSERT INTO profit_history (timestamp, profit_closed_abs, profit_open_abs, open_trades)
             VALUES (?1, ?2, ?3, ?4)",
        )?;
        // The closed figure is the cumulated profit of the trades closed so far, as freqtrade
        // writes it: a random walk here drifted away from the trades and made the drawdown of the
        // rig jump by the whole drift (B280).
        // One pass: the closes sorted by date (the text form sorts like the time), summed as
        // the sample time moves past them.
        let mut by_date = tx.prepare(
            "SELECT close_date, COALESCE(close_profit_abs, 0.0) FROM trades
             WHERE is_open = 0 AND close_date IS NOT NULL ORDER BY close_date",
        )?;
        let closes = by_date
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut next = 0;
        let mut closed = 0.0;
        let every = spec.profit_history_every_s.max(1) * 1000;
        let mut t = now_ms - span_ms.min(30 * 86_400_000);
        while t < now_ms {
            let at = date_text(t);
            while next < closes.len() && closes[next].0 <= at {
                closed += closes[next].1;
                next += 1;
            }
            ph.execute(params![
                date_text(t),
                closed,
                rng.range(-8.0, 8.0),
                i64::try_from(spec.open_trades).unwrap_or(0)
            ])?;
            t += every;
        }
    }
    tx.commit()?;
    Ok(opens)
}

/// What the background writer does.
#[derive(Debug, Clone, Copy)]
pub struct WriterConfig {
    /// Period of the commits that touch the open trades (min and max rate, as a live bot does).
    pub commit_every: Duration,
    /// Period of the `profit_history` samples.
    pub profit_every: Duration,
    /// Period at which a trade closes and another opens (0 = never on its own).
    pub trade_every: Duration,
}

impl Default for WriterConfig {
    fn default() -> Self {
        Self {
            commit_every: Duration::from_secs(5),
            profit_every: Duration::from_secs(300),
            trade_every: Duration::ZERO,
        }
    }
}

/// A live bot's database writer. Dropping it stops the thread.
pub struct Writer {
    stop: Option<std::sync::mpsc::Sender<()>>,
    pub commits: Arc<AtomicU64>,
    thread: Option<JoinHandle<()>>,
}

impl Writer {
    #[must_use]
    pub fn spawn(path: &Path, cfg: WriterConfig, seed: u64) -> Self {
        let (stop, stop_rx) = std::sync::mpsc::channel::<()>();
        let commits = Arc::new(AtomicU64::new(0));
        let path = path.to_path_buf();
        let c = Arc::clone(&commits);
        let thread = std::thread::Builder::new()
            .name("fakebot-writer".into())
            .spawn(move || {
                let Ok(mut conn) = open_db(&path) else { return };
                let mut rng = Rng::new(seed);
                let mut last_profit = std::time::Instant::now();
                let mut last_trade = std::time::Instant::now();
                // Same rule as the seed: the closed figure is the trades' own sum, read once and
                // then kept up to date by the closes this writer makes (a sum per sample would
                // slow a fast writer down).
                let mut closed_sum: f64 = conn
                    .query_row(
                        "SELECT COALESCE(SUM(close_profit_abs), 0.0) FROM trades WHERE is_open = 0",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(0.0);
                // The sleep is the receive timeout: a drop of the sender ends it at once.
                while let Err(std::sync::mpsc::RecvTimeoutError::Timeout) =
                    stop_rx.recv_timeout(cfg.commit_every)
                {
                    let now_ms = chrono::Utc::now().timestamp_millis();
                    let Ok(tx) = conn.transaction() else { continue };
                    let _ = tx.execute(
                        "UPDATE trades SET max_rate = open_rate * ?1, min_rate = open_rate * ?2
                         WHERE is_open = 1",
                        params![rng.range(1.0, 1.05), rng.range(0.95, 1.0)],
                    );
                    if !cfg.profit_every.is_zero() && last_profit.elapsed() >= cfg.profit_every {
                        last_profit = std::time::Instant::now();
                        let _ = tx.execute(
                            "INSERT INTO profit_history (timestamp, profit_closed_abs,
                                profit_open_abs, open_trades) VALUES (?1, ?2, ?3, 3)",
                            params![date_text(now_ms), closed_sum, rng.range(-8.0, 8.0)],
                        );
                    }
                    if !cfg.trade_every.is_zero() && last_trade.elapsed() >= cfg.trade_every {
                        last_trade = std::time::Instant::now();
                        if let Ok(Some((_, _, profit))) = rotate_one_trade(&tx, &mut rng, now_ms) {
                            closed_sum += profit;
                        }
                    }
                    if tx.commit().is_ok() {
                        c.fetch_add(1, Ordering::Relaxed);
                    }
                }
            })
            .ok();
        Self {
            stop: Some(stop),
            commits,
            thread,
        }
    }
}

impl Drop for Writer {
    fn drop(&mut self) {
        drop(self.stop.take());
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// Figures of the closed history, for `/profit` and `/balance`.
#[derive(Debug, Clone, Copy, Default)]
pub struct ClosedSummary {
    pub count: i64,
    pub wins: i64,
    pub profit_abs: f64,
    pub first_open_ms: i64,
    pub last_close_ms: i64,
}

pub fn closed_summary(path: &Path) -> rusqlite::Result<ClosedSummary> {
    let conn = open_db(path)?;
    conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(close_profit_abs > 0), 0), COALESCE(SUM(close_profit_abs), 0.0),
                COALESCE(CAST(strftime('%s', MIN(open_date)) AS INTEGER) * 1000, 0),
                COALESCE(CAST(strftime('%s', MAX(close_date)) AS INTEGER) * 1000, 0)
         FROM trades WHERE is_open = 0",
        [],
        |r| {
            Ok(ClosedSummary {
                count: r.get(0)?,
                wins: r.get(1)?,
                profit_abs: r.get(2)?,
                first_open_ms: r.get(3)?,
                last_close_ms: r.get(4)?,
            })
        },
    )
}

/// Close the oldest open trade and open a new one on the same pair.
pub fn rotate_one_trade(
    conn: &Connection,
    rng: &mut Rng,
    now_ms: i64,
) -> rusqlite::Result<Option<(i64, String, f64)>> {
    let row: Option<(i64, String, f64, f64, f64, bool)> = conn
        .query_row(
            "SELECT id, pair, open_rate, stake_amount, amount, is_short FROM trades
             WHERE is_open = 1 ORDER BY id ASC LIMIT 1",
            [],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get::<_, Option<bool>>(5)?.unwrap_or(false),
                ))
            },
        )
        .ok();
    let Some((id, pair, rate, stake, amount, short)) = row else {
        return Ok(None);
    };
    let ratio = rng.range(-0.05, 0.06);
    let profit = ratio * stake;
    conn.execute(
        "UPDATE trades SET is_open = 0, close_date = ?2, close_rate = ?3, close_profit = ?4,
            close_profit_abs = ?5, exit_reason = 'roi' WHERE id = ?1",
        params![id, date_text(now_ms), rate * (1.0 + ratio), ratio, profit],
    )?;
    conn.execute(
        "INSERT INTO trades (exchange, pair, base_currency, stake_currency, is_open, open_rate,
            stake_amount, amount, leverage, is_short, open_date, stop_loss, liquidation_price,
            max_rate, min_rate, strategy, enter_tag, trading_mode)
         VALUES ('hyperliquid', ?1, 'X', 'USDC', 1, ?2, ?3, ?4, 2.0, ?5, ?6, ?7, ?8, ?2, ?2,
            'FakeStrategy', 'tag', 'futures')",
        params![
            pair,
            rate,
            stake,
            amount,
            short,
            date_text(now_ms),
            if short { rate * 1.1 } else { rate * 0.9 },
            if short { rate * 1.5 } else { rate * 0.5 },
        ],
    )?;
    Ok(Some((id, pair, profit)))
}
