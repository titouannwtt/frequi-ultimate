/** Totals shown under a filtered trade list. Port of `fg-core::calc::stats`. */
import type { TradeTotals } from '@/gateway/types.gen';

/**
 * Aggregate the `profit_abs` of closed trades (null = unknown). Trades whose profit is unknown are
 * counted apart and left out of every other figure.
 */
export function tradeTotals(profits: ReadonlyArray<number | null>): TradeTotals {
  const t: TradeTotals = {
    count: 0,
    unknown: 0,
    sum: 0,
    wins: 0,
    losses: 0,
    winrate: null,
    profit_factor: null,
    worst_abs: null,
    best_abs: null,
  };
  let grossWin = 0;
  let grossLoss = 0;
  for (const p of profits) {
    if (p == null || !Number.isFinite(p)) {
      t.unknown += 1;
      continue;
    }
    t.count += 1;
    t.sum += p;
    if (p > 0) {
      t.wins += 1;
      grossWin += p;
    } else if (p < 0) {
      t.losses += 1;
      grossLoss += -p;
    }
    t.worst_abs = t.worst_abs === null ? p : Math.min(t.worst_abs, p);
    t.best_abs = t.best_abs === null ? p : Math.max(t.best_abs, p);
  }
  if (t.count > 0) {
    t.winrate = t.wins / t.count;
  }
  if (grossLoss > 0) {
    t.profit_factor = grossWin / grossLoss;
  }
  return t;
}
