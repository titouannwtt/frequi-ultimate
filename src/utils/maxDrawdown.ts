import type { ProfitStats, Trade } from '@/types';

export interface MaxDrawdownResult {
  /** Realized drawdown (closed trades only) — straight from freqtrade /profit. */
  realizedRatio: number;
  realizedAbs: number;
  /** Max drawdown INCLUDING open positions valued at the lowest they reached. */
  openRatio: number;
  openAbs: number;
  /** Combined worst unrealized PnL of currently-open positions (signed; negative = loss). */
  openWorstSum: number;
  hasOpen: boolean;
}

/**
 * Worst unrealized PnL an open trade reached, using min_rate (longs) / max_rate (shorts).
 * profit_abs already includes fees/funding at the current rate; we extend it by the
 * price move from the current rate to the extreme via the contract amount.
 */
export function tradeWorstAbs(t: Trade): number {
  const cur = t.current_rate ?? t.open_rate ?? 0;
  const profit = t.profit_abs ?? 0;
  const amt = t.amount ?? 0;
  if (!cur || !amt) return profit;
  if (t.is_short) {
    const hi = t.max_rate ?? cur;
    return profit - amt * Math.max(0, hi - cur);
  }
  const lo = t.min_rate ?? cur;
  return profit + amt * Math.min(0, lo - cur);
}

/**
 * Combine freqtrade's realized max drawdown with the worst point currently-open
 * positions reached, to produce a "max drawdown including open positions" metric.
 *
 * The open-inclusive absolute drawdown is the decline from the realized equity peak
 * down to (current realized equity + open positions at their lows):
 *   openAbs = max(realizedAbs, peak - realizedCum - openWorstSum)
 * The starting capital cancels out, so this is base-independent. The ratio reuses
 * freqtrade's own denominator (account value at the realized peak).
 */
export function computeMaxDrawdown(
  profit: ProfitStats | undefined,
  closedTrades: Trade[],
  openTrades: Trade[],
): MaxDrawdownResult {
  const realizedRatio = profit?.max_drawdown ?? 0;
  const realizedAbs = profit?.max_drawdown_abs ?? 0;

  // Realized cumulative-profit curve: peak and current value.
  const sorted = closedTrades
    .filter((t) => !t.is_open)
    .slice()
    .sort((a, b) => (a.close_timestamp ?? 0) - (b.close_timestamp ?? 0));
  let cum = 0;
  let peak = 0;
  for (const t of sorted) {
    cum += t.profit_abs ?? 0;
    if (cum > peak) peak = cum;
  }
  const realizedCum = cum;

  const opens = openTrades.filter((t) => t.is_open !== false);
  const openWorstSum = opens.reduce((s, t) => s + tradeWorstAbs(t), 0);

  const candidateAbs = peak - realizedCum - openWorstSum;
  const openAbs = Math.max(realizedAbs, candidateAbs, 0);

  // Ratio base = account value at the realized peak (reuses freqtrade's denominator).
  let base = realizedRatio > 0 ? realizedAbs / realizedRatio : 0;
  if (base <= 0) {
    const r = profit?.profit_closed_ratio ?? 0;
    const startCap = r ? (profit?.profit_closed_coin ?? 0) / r : 0;
    base = startCap + peak;
  }
  const openRatio = base > 0 ? openAbs / base : 0;

  return {
    realizedRatio,
    realizedAbs,
    openRatio,
    openAbs,
    openWorstSum,
    hasOpen: opens.length > 0,
  };
}

/**
 * Portfolio-level drawdown across several bots (a group, or the Summary row).
 * Realized DD is the max peak-to-trough decline of the merged cumulative-profit curve;
 * open DD extends it with the open positions at their lowest. `base` is the combined
 * account value used as the ratio denominator (sum of per-bot account values at peak).
 */
export function computeAggregateDrawdown(
  closedTrades: Trade[],
  openTrades: Trade[],
  base: number,
): MaxDrawdownResult {
  const sorted = closedTrades
    .filter((t) => !t.is_open)
    .slice()
    .sort((a, b) => (a.close_timestamp ?? 0) - (b.close_timestamp ?? 0));
  let cum = 0;
  let peak = 0;
  let realizedAbs = 0;
  for (const t of sorted) {
    cum += t.profit_abs ?? 0;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > realizedAbs) realizedAbs = dd;
  }
  const realizedCum = cum;

  const opens = openTrades.filter((t) => t.is_open !== false);
  const openWorstSum = opens.reduce((s, t) => s + tradeWorstAbs(t), 0);
  const openAbs = Math.max(realizedAbs, peak - realizedCum - openWorstSum, 0);

  return {
    realizedRatio: base > 0 ? realizedAbs / base : 0,
    realizedAbs,
    openRatio: base > 0 ? openAbs / base : 0,
    openAbs,
    openWorstSum,
    hasOpen: opens.length > 0,
  };
}

/** Per-bot account value at the realized peak — the ratio denominator. */
export function accountBaseFromProfit(profit: ProfitStats | undefined): number {
  if (!profit) return 0;
  const r = profit.max_drawdown ?? 0;
  const a = profit.max_drawdown_abs ?? 0;
  if (r > 0 && a > 0) return a / r;
  const cr = profit.profit_closed_ratio ?? 0;
  return cr ? (profit.profit_closed_coin ?? 0) / cr : 0;
}
