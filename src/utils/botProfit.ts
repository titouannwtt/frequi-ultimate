import { startOfDay, sub } from 'date-fns';

export type ProfitPeriodKey =
  | '24h'
  | 'today'
  | '48h'
  | '7d'
  | '14d'
  | '1m'
  | '2m'
  | '3m'
  | '6m'
  | '1y'
  | 'all';

export interface ProfitPeriodOption {
  key: ProfitPeriodKey;
  /** Short label shown in the pill selector. */
  label: string;
}

export const PROFIT_PERIODS: ProfitPeriodOption[] = [
  { key: '24h', label: '24h' },
  { key: 'today', label: 'Auj.' },
  { key: '48h', label: '48h' },
  { key: '7d', label: '7j' },
  { key: '14d', label: '14j' },
  { key: '1m', label: '1M' },
  { key: '2m', label: '2M' },
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
  { key: '1y', label: '1A' },
  { key: 'all', label: 'All' },
];

/**
 * Cutoff timestamp (ms). A trade is in the period when `close_timestamp >= cutoff`.
 * Returns 0 for "all" (no lower bound). Months/years are calendar-aware (date-fns).
 */
export function getProfitPeriodCutoff(period: ProfitPeriodKey, now: number = Date.now()): number {
  const d = new Date(now);
  switch (period) {
    case '24h':
      return sub(d, { hours: 24 }).getTime();
    case '48h':
      return sub(d, { hours: 48 }).getTime();
    case 'today':
      return startOfDay(d).getTime();
    case '7d':
      return sub(d, { days: 7 }).getTime();
    case '14d':
      return sub(d, { days: 14 }).getTime();
    case '1m':
      return sub(d, { months: 1 }).getTime();
    case '2m':
      return sub(d, { months: 2 }).getTime();
    case '3m':
      return sub(d, { months: 3 }).getTime();
    case '6m':
      return sub(d, { months: 6 }).getTime();
    case '1y':
      return sub(d, { years: 1 }).getTime();
    case 'all':
    default:
      return 0;
  }
}

/** Minimal trade shape needed for per-bot profit aggregation. */
export interface TradeProfitInput {
  botId: string;
  botName?: string;
  profit_abs?: number;
  close_timestamp?: number;
}

export interface BotProfitEntry {
  botId: string;
  botName: string;
  /** Realized profit over the period, in the display currency (after `convert`). */
  profit: number;
  /** Number of trades closed within the period. */
  tradeCount: number;
}

/**
 * Aggregate realized profit per bot from closed trades whose `close_timestamp >= cutoff`.
 *
 * Every bot present in `trades` appears in the result (even with 0 trades in the period),
 * so the chart's bar set stays stable when the period changes.
 *
 * @param convert maps a raw `profit_abs` (in the bot's stake currency) to the display currency.
 */
export function aggregateProfitByBot(
  trades: TradeProfitInput[],
  cutoff: number,
  convert: (amount: number, botId: string) => number = (a) => a,
): BotProfitEntry[] {
  const byBot = new Map<string, BotProfitEntry>();
  for (const tr of trades) {
    if (!tr.botId) continue;
    let entry = byBot.get(tr.botId);
    if (!entry) {
      entry = { botId: tr.botId, botName: tr.botName || tr.botId, profit: 0, tradeCount: 0 };
      byBot.set(tr.botId, entry);
    }
    if (tr.close_timestamp && tr.close_timestamp >= cutoff) {
      entry.profit += convert(tr.profit_abs ?? 0, tr.botId);
      entry.tradeCount += 1;
    }
  }
  return Array.from(byBot.values());
}
