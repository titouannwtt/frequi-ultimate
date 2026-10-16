/**
 * Drawdown: two named definitions, absolute first. Port of `fg-core::calc::drawdown`.
 *
 * - Realized: equity = cumulative profit of the closed trades, ordered by close time, starting from
 *   the starting capital (cumulative profit 0). The high-water mark starts at the starting
 *   capital, so a bot that loses from its first trade has a drawdown from day one. Open positions
 *   are ignored.
 * - With open (open-inclusive): the deepest peak-to-trough decline of the realized-plus-latent
 *   curve, extended by the open positions at the worst point they reached (`min_rate` for longs,
 *   `max_rate` for shorts). The curve is the sampled `profit_history` when available, prepended
 *   with the realized points that predate the first sample, otherwise the realized curve alone.
 *   The final "now" point continues that curve (see `anchoredClosed`), never restarting from the
 *   cumulative closed trades, which can sit on another base than `profit_history` (B280).
 *
 * The percentage is a ratio of `starting capital + realized peak` and is null when the starting
 * capital is unknown. The absolute value is always available and is the figure to compare across
 * bots: a percentage confuses risk and profit.
 */
import type {
  ClosedPnl,
  DrawdownInput,
  DrawdownResult,
  DrawdownValue,
  HistorySample,
  OpenRisk,
} from '@/gateway/types.gen';

/**
 * Worst unrealized profit an open position reached. `profit_abs` already includes fees and
 * funding at the current rate; it is extended by the price move from the current rate to the
 * extreme, through the contract amount.
 */
export function openWorstAbs(t: OpenRisk): number {
  const cur = t.current_rate ?? t.open_rate;
  if (cur === 0 || t.amount === 0) {
    return t.profit_abs;
  }
  if (t.is_short) {
    const hi = t.max_rate ?? cur;
    return t.profit_abs - t.amount * Math.max(hi - cur, 0);
  }
  const lo = t.min_rate ?? cur;
  return t.profit_abs + t.amount * Math.min(lo - cur, 0);
}

export interface Walk {
  max_abs: number;
  peak_ms: number | null;
  trough_ms: number | null;
  current_abs: number;
  /** Highest value reached (at least 0, the starting capital). */
  peak_value: number;
}

export type CurvePoint = [tsMs: number, value: number];

/**
 * Maximum drawdown of a curve of `[ts_ms, cumulative profit]` points ordered by time. The
 * high-water mark starts at 0 (the starting capital).
 */
export function walk(points: readonly CurvePoint[]): Walk {
  let peak = 0;
  let peakTs: number | null = null;
  let best = 0;
  let bestPeak: number | null = null;
  let bestTrough: number | null = null;
  for (const [t, v] of points) {
    if (v > peak) {
      peak = v;
      peakTs = t;
    }
    const dd = peak - v;
    if (dd > best) {
      best = dd;
      bestPeak = peakTs;
      bestTrough = t;
    }
  }
  const last = points.length > 0 ? points[points.length - 1][1] : 0;
  return {
    max_abs: best,
    peak_ms: bestPeak,
    trough_ms: bestTrough,
    current_abs: Math.max(peak - last, 0),
    peak_value: peak,
  };
}

/**
 * Merge the sampled histories of several bots into one `closed + open` curve.
 *
 * Merging starts at the first timestamp every bot has a sample for: before that, the forward
 * filled sum silently misses whole bots and fabricates an artificially low start. Each bot's last
 * sample is carried forward when timestamps do not align. Empty series are ignored.
 */
export function mergeHistories(series: ReadonlyArray<readonly HistorySample[]>): CurvePoint[] {
  const sorted = series
    .filter((s) => s.length > 0)
    .map((s) => [...s].sort((a, b) => a.ts_ms - b.ts_ms));
  if (sorted.length === 0) {
    return [];
  }
  if (sorted.length === 1) {
    return sorted[0].map((r) => [r.ts_ms, r.closed + r.open]);
  }
  const start = Math.max(...sorted.map((s) => s[0].ts_ms));
  const allTs = [
    ...new Set(sorted.flatMap((s) => s.map((r) => r.ts_ms)).filter((t) => t >= start)),
  ].sort((a, b) => a - b);
  const idx = sorted.map(() => 0);
  const last = sorted.map(() => 0);
  return allTs.map((t) => {
    sorted.forEach((s, i) => {
      while (idx[i] < s.length && s[idx[i]].ts_ms <= t) {
        last[i] = s[idx[i]].closed + s[idx[i]].open;
        idx[i] += 1;
      }
    });
    return [t, last.reduce((a, b) => a + b, 0)] as CurvePoint;
  });
}

/** Compute both drawdown definitions. */
/** Missing fields mean empty (the Rust input is `#[serde(default)]`). */
/**
 * Closed part of the final point, anchored per bot on its last `profit_history` sample: the
 * sample's `closed` plus the profits of that bot's trades closed strictly after it. A bot without
 * any sample contributes its cumulative closed trades. Null when the trades cannot be attributed
 * to the histories (several series and no aligned `history_trades`).
 */
export function anchoredClosed(input: Partial<DrawdownInput>): number | null {
  const histories = input.histories ?? [];
  const historyTrades = input.history_trades ?? [];
  let perBot: readonly ClosedPnl[][];
  if (historyTrades.length === histories.length) {
    perBot = historyTrades;
  } else if (historyTrades.length === 0 && histories.length === 1) {
    perBot = [input.closed ?? []];
  } else {
    return null;
  }
  let total = 0;
  histories.forEach((h, i) => {
    const trades = perBot[i];
    if (h.length === 0) {
      total += trades.reduce((acc, t) => acc + t.profit_abs, 0);
      return;
    }
    const last = h.reduce((a, b) => (b.ts_ms > a.ts_ms ? b : a));
    total += trades.reduce(
      (acc, t) => (t.ts_ms > last.ts_ms ? acc + t.profit_abs : acc),
      last.closed,
    );
  });
  return total;
}

export function computeDrawdown(input: Partial<DrawdownInput>): DrawdownResult {
  const closed = [...(input.closed ?? [])].sort((a, b) => a.ts_ms - b.ts_ms);
  let cum = 0;
  const realizedPoints: CurvePoint[] = closed.map((c) => {
    cum += c.profit_abs;
    return [c.ts_ms, cum];
  });
  const realizedCum = cum;
  const rw = walk(realizedPoints);

  const open = input.open ?? [];
  const openWorstSum = open.reduce((acc, o) => acc + openWorstAbs(o), 0);
  const hasOpen = open.length > 0;

  // Curve of realized + latent, then the open positions projected to their worst point.
  const history = mergeHistories(input.histories ?? []);
  const fromHistory = history.length >= 2;
  const curve: CurvePoint[] = fromHistory
    ? [...realizedPoints.filter((p) => p[0] < history[0][0]), ...history]
    : [...realizedPoints];
  const observed = walk(curve);
  if (hasOpen) {
    const closedNow = fromHistory ? (anchoredClosed(input) ?? realizedCum) : realizedCum;
    curve.push([input.now_ms ?? 0, closedNow + openWorstSum]);
  }
  const ow = walk(curve);

  const base =
    input.starting_capital != null &&
    Number.isFinite(input.starting_capital) &&
    input.starting_capital > 0
      ? input.starting_capital + rw.peak_value
      : null;
  const pct = (abs: number): number | null => (base === null ? null : abs / base);

  const realized: DrawdownValue = {
    abs: rw.max_abs,
    pct: pct(rw.max_abs),
    peak_ms: rw.peak_ms,
    trough_ms: rw.trough_ms,
    current_abs: rw.current_abs,
  };
  const withOpen: DrawdownValue =
    ow.max_abs > rw.max_abs
      ? {
          abs: ow.max_abs,
          pct: pct(ow.max_abs),
          peak_ms: ow.peak_ms,
          trough_ms: ow.trough_ms,
          current_abs: observed.current_abs,
        }
      : { ...realized, current_abs: observed.current_abs };

  return {
    realized,
    with_open: withOpen,
    open_worst_sum: openWorstSum,
    has_open: hasOpen,
    base,
  };
}
