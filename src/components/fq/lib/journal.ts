/**
 * Analysis of a set of closed trades for the Journal (02 section 3.4): the distribution of the
 * results, the depth of the DCA ladder, the exit reasons and the result per bot. Pure functions:
 * the same code serves the components and their tests, and none of them invents a figure.
 *
 * A trade whose profit is unknown (`profit_unknown`, or a null profit) is counted apart and left
 * out of every sum, every rate and every bar.
 */
import type { BotKey, ExitKind, TradeRow } from '@/gateway/types.gen';

/**
 * A closed trade as the Journal receives it. The three optional fields are computed by the
 * gateway when it closes the trade (02 section 13.2); they are absent in direct mode, and the
 * views then say so instead of drawing something.
 */
export type JournalTrade = TradeRow & {
  /** Orders filled on the entry side (the entry plus the safety orders). */
  dca_entries?: number | null;
  /** Maximum adverse excursion, as a ratio of the stake like `profit_ratio` (negative or zero). */
  mae?: number | null;
  /** Maximum favourable excursion, as a ratio of the stake (positive or zero). */
  mfe?: number | null;
};

/** Profit of a trade, or null when it is unknown. */
export function knownProfit(t: Pick<TradeRow, 'profit_abs' | 'profit_unknown'>): number | null {
  return t.profit_unknown || t.profit_abs == null || !Number.isFinite(t.profit_abs)
    ? null
    : t.profit_abs;
}

/** Result in percent of the stake, or null when the trade or its ratio is unknown. */
export function knownPct(
  t: Pick<TradeRow, 'profit_abs' | 'profit_ratio' | 'profit_unknown'>,
): number | null {
  if (knownProfit(t) === null) return null;
  return t.profit_ratio == null || !Number.isFinite(t.profit_ratio) ? null : t.profit_ratio * 100;
}

// ---- distribution ----

export interface DistBin {
  /** Lower edge in percent (inclusive); the first bin also holds everything below it. */
  from: number;
  /** Upper edge in percent (exclusive); the last bin also holds everything above it. */
  to: number;
  count: number;
  /** The whole bin lies under the tail threshold. */
  tail: boolean;
  /** Edge bins hold an open-ended range: `<= from` or `>= to`. */
  open: 'low' | 'high' | null;
}

export interface Distribution {
  bins: DistBin[];
  /** Trades drawn in the histogram. */
  drawn: number;
  /** Trades left out because their profit or ratio is unknown. */
  unknown: number;
  tail: {
    /** Threshold in percent (negative), `< threshold` is the tail. */
    threshold: number;
    count: number;
    /** Sum of the profits of the tail trades (<= 0). */
    sum: number;
    /** Share of the gross loss (0 to 1); null without any loss. */
    share: number | null;
  };
  /** Gross loss in absolute terms (>= 0). */
  grossLoss: number;
}

export interface DistributionOptions {
  binWidth?: number;
  lo?: number;
  hi?: number;
  tailPct?: number;
}

export function distribution(
  trades: readonly TradeRow[],
  opts: DistributionOptions = {},
): Distribution {
  const w = opts.binWidth ?? 1;
  const lo = opts.lo ?? -14;
  const hi = opts.hi ?? 4;
  const threshold = opts.tailPct ?? -5;
  const n = Math.max(1, Math.round((hi - lo) / w));
  const bins: DistBin[] = Array.from({ length: n }, (_, i) => ({
    from: lo + i * w,
    to: lo + (i + 1) * w,
    count: 0,
    tail: lo + (i + 1) * w <= threshold,
    open: i === 0 ? 'low' : i === n - 1 ? 'high' : null,
  }));
  let drawn = 0;
  let unknown = 0;
  let grossLoss = 0;
  let tailCount = 0;
  let tailSum = 0;
  for (const t of trades) {
    const profit = knownProfit(t);
    const pct = knownPct(t);
    if (profit === null || pct === null) {
      unknown += 1;
      continue;
    }
    drawn += 1;
    const idx = Math.min(n - 1, Math.max(0, Math.floor((pct - lo) / w)));
    bins[idx]!.count += 1;
    if (profit < 0) grossLoss += -profit;
    if (pct < threshold) {
      tailCount += 1;
      tailSum += profit;
    }
  }
  return {
    bins,
    drawn,
    unknown,
    tail: {
      threshold,
      count: tailCount,
      sum: tailSum,
      share: grossLoss > 0 ? -tailSum / grossLoss : null,
    },
    grossLoss,
  };
}

// ---- DCA depth ----

export interface DepthRow {
  /** Orders filled; null for the trades whose depth the source did not give. */
  depth: number | null;
  trades: number;
  wins: number;
  /** `wins / trades` (0 to 1); null without a trade. */
  winrate: number | null;
  pnl: number;
}

export interface DepthSummary {
  rows: DepthRow[];
  /** Trades without a depth (direct mode, older rows). */
  unknownDepth: DepthRow | null;
  /** Trades left out because their profit is unknown. */
  unknownProfit: number;
  /** Trades from `warnFrom` orders on against the others; null unless both exist. */
  deep: { from: number; deep: DepthRow; shallow: DepthRow } | null;
}

/** The ladder turns amber from this many filled orders (02 section 5.1, DcaPips). */
export const DCA_WARN_FROM = 4;

function foldDepth(rows: DepthRow[], depth: number | null): DepthRow {
  const out: DepthRow = { depth, trades: 0, wins: 0, winrate: null, pnl: 0 };
  for (const r of rows) {
    out.trades += r.trades;
    out.wins += r.wins;
    out.pnl += r.pnl;
  }
  out.winrate = out.trades > 0 ? out.wins / out.trades : null;
  return out;
}

export function dcaDepth(
  trades: readonly JournalTrade[],
  warnFrom: number = DCA_WARN_FROM,
): DepthSummary {
  const byDepth = new Map<number | null, DepthRow>();
  let unknownProfit = 0;
  for (const t of trades) {
    const profit = knownProfit(t);
    if (profit === null) {
      unknownProfit += 1;
      continue;
    }
    const depth =
      t.dca_entries == null || !Number.isFinite(t.dca_entries) ? null : Math.round(t.dca_entries);
    let row = byDepth.get(depth);
    if (!row) {
      row = { depth, trades: 0, wins: 0, winrate: null, pnl: 0 };
      byDepth.set(depth, row);
    }
    row.trades += 1;
    if (profit > 0) row.wins += 1;
    row.pnl += profit;
  }
  for (const r of byDepth.values()) r.winrate = r.trades > 0 ? r.wins / r.trades : null;
  const rows = [...byDepth.values()]
    .filter((r): r is DepthRow & { depth: number } => r.depth !== null)
    .sort((a, b) => a.depth - b.depth);
  const deepRows = rows.filter((r) => r.depth >= warnFrom);
  const shallowRows = rows.filter((r) => r.depth < warnFrom);
  return {
    rows,
    unknownDepth: byDepth.get(null) ?? null,
    unknownProfit,
    deep:
      deepRows.length > 0 && shallowRows.length > 0
        ? { from: warnFrom, deep: foldDepth(deepRows, null), shallow: foldDepth(shallowRows, null) }
        : null,
  };
}

// ---- exit reasons ----

export interface ExitRow {
  /** Stable key: the kind, or the raw value for a custom reason. */
  key: string;
  kind: ExitKind;
  /** Raw freqtrade values seen under this row (tooltip and export). */
  raws: string[];
  trades: number;
  wins: number;
  pnl: number;
  /** Trades closed by a human (from the audit). */
  manual: number;
}

export interface ExitSummary {
  rows: ExitRow[];
  unknownProfit: number;
}

/**
 * P&L per exit reason, best first. Reasons are grouped by their normalised kind; a custom reason
 * (a strategy's own string) keeps its raw value as its row, so two different custom exits are
 * never merged. An unknown reason is its own row, never folded into another.
 */
export function exitReasons(trades: readonly TradeRow[]): ExitSummary {
  const map = new Map<string, ExitRow>();
  let unknownProfit = 0;
  for (const t of trades) {
    const profit = knownProfit(t);
    if (profit === null) {
      unknownProfit += 1;
      continue;
    }
    const kind = t.exit_reason.kind;
    const key = kind === 'custom' ? `custom:${t.exit_reason.raw}` : kind;
    let row = map.get(key);
    if (!row) {
      row = { key, kind, raws: [], trades: 0, wins: 0, pnl: 0, manual: 0 };
      map.set(key, row);
    }
    if (t.exit_reason.raw !== '' && !row.raws.includes(t.exit_reason.raw)) {
      row.raws.push(t.exit_reason.raw);
    }
    row.trades += 1;
    if (profit > 0) row.wins += 1;
    row.pnl += profit;
    if (t.manual) row.manual += 1;
  }
  return {
    rows: [...map.values()].sort((a, b) => b.pnl - a.pnl || a.key.localeCompare(b.key)),
    unknownProfit,
  };
}

// ---- per bot ----

export interface BotResult {
  botKey: BotKey;
  trades: number;
  pnl: number;
}

export function resultByBot(trades: readonly TradeRow[]): BotResult[] {
  const map = new Map<BotKey, BotResult>();
  for (const t of trades) {
    const profit = knownProfit(t);
    if (profit === null) continue;
    const row = map.get(t.bot_key) ?? { botKey: t.bot_key, trades: 0, pnl: 0 };
    row.trades += 1;
    row.pnl += profit;
    map.set(t.bot_key, row);
  }
  return [...map.values()].sort((a, b) => b.pnl - a.pnl || a.botKey.localeCompare(b.botKey));
}

/** Label of a bin: `-5 %`, `<= -14 %` for the open low end, `>= 4 %` for the open high end. */
export function binLabel(b: DistBin): string {
  if (b.open === 'low') return `≤ ${b.to}`;
  if (b.open === 'high') return `≥ ${b.from}`;
  return `${b.from}`;
}
