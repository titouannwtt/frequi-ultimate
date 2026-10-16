/**
 * Model of the Journal page (02 section 3.4): the filters, the query they make, the day grouping of
 * the list, the filtered totals and the CSV of the rows on screen. Pure functions: the page only
 * wires them, and the arithmetic of a screen that talks about money is tested without a component.
 *
 * Nothing here invents a figure. A trade whose profit is unknown is counted apart and left out of
 * every sum, every rate and every average; a figure the source does not give (MAE, DCA depth) is
 * `null`, and the page says it is not available instead of showing a zero.
 */
import { medianDurationMs, percentileValue } from '@/datasource/calc/duration';
import { bucketLabel, periodCutoffMs } from '@/datasource/calc/periods';
import type { TradeQuery } from '@/datasource/types';
import type { BotKey, BotRow, Tz } from '@/gateway/types.gen';

import { knownProfit, type JournalTrade } from './journal';

// ---- filters ----

export type JournalPeriod = '24h' | '7d' | '30d' | 'month' | 'year' | 'all' | 'range';
export const JOURNAL_PERIODS: readonly JournalPeriod[] = [
  '24h',
  '7d',
  '30d',
  'month',
  'year',
  'all',
  'range',
];

export type JournalGrouping = 'day' | 'bot' | 'pair';

/** Depth filter: an exact number of filled orders, or "from N on". */
export type DepthFilter = { kind: 'eq'; n: number } | { kind: 'min'; n: number };

export interface JournalFilters {
  period: JournalPeriod;
  /** Custom range, ms; each end may be open. */
  range: { fromMs: number | null; toMs: number | null };
  /** Bots picked in the chip; empty means every bot of the scope. */
  bots: BotKey[];
  side: 'long' | 'short' | null;
  /** Raw freqtrade value of the reason, or `unknown`. */
  exitReason: string | null;
  depth: DepthFilter | null;
  pair: string;
  /** Replay bots are left out (default on, always visible). */
  sansReplay: boolean;
  grouping: JournalGrouping;
}

export function defaultJournalFilters(): JournalFilters {
  return {
    period: '7d',
    range: { fromMs: null, toMs: null },
    bots: [],
    side: null,
    exitReason: null,
    depth: null,
    pair: '',
    sansReplay: true,
    grouping: 'day',
  };
}

/** Lower and upper bound of the period (ms); an open end is `undefined`. */
export function periodBounds(
  f: Pick<JournalFilters, 'period' | 'range'>,
  nowMs: number,
  tz: Tz,
): { fromMs?: number; toMs?: number } {
  switch (f.period) {
    case 'all':
      return {};
    case 'range':
      return {
        ...(f.range.fromMs !== null ? { fromMs: f.range.fromMs } : {}),
        ...(f.range.toMs !== null ? { toMs: f.range.toMs } : {}),
      };
    case 'month':
      return { fromMs: periodCutoffMs('mtd', nowMs, tz) };
    case 'year':
      return { fromMs: periodCutoffMs('ytd', nowMs, tz) };
    default:
      return { fromMs: periodCutoffMs(f.period, nowMs, tz) };
  }
}

/**
 * The bots a Journal query covers: those of the shared FleetScope (mode, search, groups, tags), the
 * ones picked in the "Bots" chip among them, and the replay bots when "Without replay" is off and
 * the scope asks for every mode. Always explicit keys: the same list goes to the gateway and to
 * the direct source, so a total never depends on how a source defaults an absent filter.
 */
export function journalBots(
  scopeBots: readonly BotRow[],
  allBots: readonly BotRow[],
  f: Pick<JournalFilters, 'bots' | 'sansReplay'>,
  mode: 'live' | 'dry' | 'all',
): BotKey[] {
  const keys = new Set(scopeBots.map((b) => b.bot_key));
  if (!f.sansReplay && mode === 'all') {
    for (const b of allBots) if (b.identity.mode === 'replay') keys.add(b.bot_key);
  }
  const picked = f.bots.length > 0 ? f.bots.filter((k) => keys.has(k)) : [...keys];
  return picked.sort();
}

export function journalQuery(opts: {
  filters: JournalFilters;
  bots: BotKey[];
  nowMs: number;
  tz: Tz;
  cursor?: string | null;
  limit?: number;
}): TradeQuery {
  const { filters: f } = opts;
  const bounds = periodBounds(f, opts.nowMs, opts.tz);
  return {
    status: 'closed',
    bots: opts.bots,
    ...(f.side ? { side: f.side } : {}),
    ...(f.exitReason ? { exitReason: f.exitReason } : {}),
    ...(f.pair.trim() ? { pair: f.pair.trim().toUpperCase() } : {}),
    ...bounds,
    sort: 'close_ms',
    order: 'desc',
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
    ...(opts.limit ? { limit: opts.limit } : {}),
  };
}

/** Whether a trade passes the depth filter; a trade without a depth passes none of them. */
export function depthMatches(t: Pick<JournalTrade, 'dca_entries'>, d: DepthFilter | null): boolean {
  if (!d) return true;
  const n = t.dca_entries;
  if (n == null || !Number.isFinite(n)) return false;
  return d.kind === 'eq' ? Math.round(n) === d.n : Math.round(n) >= d.n;
}

/** Whether any trade of the set carries its depth (the gateway does not give it yet). */
export function hasDepth(trades: readonly Pick<JournalTrade, 'dca_entries'>[]): boolean {
  return trades.some((t) => t.dca_entries != null);
}

// ---- pair filter: BTC finds BTC/USDC:USDC ----

/** The `pair` filter is an exact market name; a typed coin is matched against the loaded pairs. */
export function resolvePair(typed: string, pairs: readonly string[]): string {
  const q = typed.trim().toUpperCase();
  if (!q) return '';
  const exact = pairs.find((p) => p.toUpperCase() === q);
  if (exact) return exact;
  const byCoin = pairs.find((p) => p.toUpperCase().replace(/^XYZ:/, '').split('/')[0] === q);
  return byCoin ?? q;
}

// ---- grouping of the list ----

/** `YYYY-MM-DD` of the day a trade closed, in the P&L time zone. */
export function dayKey(ms: number, tz: Tz): string {
  return bucketLabel('day', tz, ms);
}

export function dayLabel(ms: number, tz: Tz, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(ms));
}

export interface GroupTotal {
  trades: number;
  /** Sum of the known profits; trades without one are counted but not summed. */
  sum: number;
  unknown: number;
}

export function groupTotal(rows: readonly JournalTrade[]): GroupTotal {
  let sum = 0;
  let unknown = 0;
  for (const r of rows) {
    const p = knownProfit(r);
    if (p === null) unknown += 1;
    else sum += p;
  }
  return { trades: rows.length, sum, unknown };
}

// ---- filtered totals ----

export interface JournalStats {
  /** Trades in the set, including those without a result. */
  trades: number;
  unknown: number;
  net: number;
  wins: number;
  losses: number;
  winrate: number | null;
  /** Gross profit over gross loss; null without a loss (undefined, not infinite). */
  profitFactor: number | null;
  /** Mean result per known trade. */
  expectancy: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  /** Worst single result in absolute USDC (<= 0), null without a known trade. */
  worstTrade: { profit: number; botKey: BotKey; pair: string; tradeId: number } | null;
  /** Largest adverse excursion in USDC (<= 0) when the source gave MAE; null otherwise. */
  worstDrawdown: number | null;
  medianHours: number | null;
  p90Hours: number | null;
  /** Closed trades per day over the span they cover. */
  perDay: number | null;
  days: number;
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

export function journalStats(
  trades: readonly JournalTrade[],
  span?: { fromMs?: number; toMs?: number },
  nowMs?: number,
): JournalStats {
  let net = 0;
  let wins = 0;
  let losses = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let unknown = 0;
  let worst: JournalStats['worstTrade'] = null;
  let worstMae: number | null = null;
  const durations: number[] = [];
  let first = Infinity;
  let last = -Infinity;
  for (const t of trades) {
    if (t.close_ms != null) {
      first = Math.min(first, t.close_ms);
      last = Math.max(last, t.close_ms);
      durations.push(t.close_ms - t.open_ms);
    }
    const p = knownProfit(t);
    if (p === null) {
      unknown += 1;
      continue;
    }
    net += p;
    if (p > 0) {
      wins += 1;
      grossWin += p;
    } else if (p < 0) {
      losses += 1;
      grossLoss += -p;
    }
    if (!worst || p < worst.profit) {
      worst = { profit: p, botKey: t.bot_key, pair: t.pair, tradeId: t.trade_id };
    }
    if (t.mae != null && Number.isFinite(t.mae) && t.stake_amount > 0) {
      const usd = t.mae * t.stake_amount;
      if (worstMae === null || usd < worstMae) worstMae = usd;
    }
  }
  // A break-even trade is a known result: it counts in the rate and the mean, as neither a win nor a loss
  const known = trades.length - unknown;
  // Days the set covers: the period when it is closed, else the span of the trades themselves
  const from = span?.fromMs ?? (Number.isFinite(first) ? first : undefined);
  const to = span?.toMs ?? nowMs ?? (Number.isFinite(last) ? last : undefined);
  const days =
    from !== undefined && to !== undefined && to > from ? Math.max(1, (to - from) / DAY) : 0;
  const dur = durations.filter((d) => d > 0);
  const median = medianDurationMs(dur);
  return {
    trades: trades.length,
    unknown,
    net,
    wins,
    losses,
    winrate: known > 0 ? wins / known : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    expectancy: known > 0 ? net / known : null,
    avgWin: wins > 0 ? grossWin / wins : null,
    avgLoss: losses > 0 ? -grossLoss / losses : null,
    worstTrade: worst,
    worstDrawdown: worstMae,
    medianHours: median === null ? null : median / HOUR,
    p90Hours: dur.length > 0 ? (percentileValue(dur, 90) as number) / HOUR : null,
    perDay: days > 0 ? trades.length / days : null,
    days,
  };
}

// ---- CSV of the rows on screen (direct mode; the gateway exports the whole set itself) ----

export const CSV_COLUMNS = [
  'bot_key',
  'trade_id',
  'pair',
  'side',
  'mode',
  'leverage',
  'open_ms',
  'close_ms',
  'open_rate',
  'close_rate',
  'amount',
  'stake_amount',
  'profit_abs',
  'profit_ratio',
  'profit_unknown',
  'exit_reason',
  'enter_tag',
  'manual',
] as const;

/** A text cell a spreadsheet would run as a formula is prefixed so that it stays text. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let text = typeof v === 'string' ? v : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Same columns as `GET /trades/export.csv`; the exit reason is the raw freqtrade value. */
export function tradesToCsv(rows: readonly JournalTrade[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    const rec: Record<(typeof CSV_COLUMNS)[number], unknown> = {
      ...r,
      exit_reason: r.exit_reason.raw,
    };
    lines.push(CSV_COLUMNS.map((c) => csvCell(rec[c])).join(','));
  }
  return `${lines.join('\n')}\n`;
}
