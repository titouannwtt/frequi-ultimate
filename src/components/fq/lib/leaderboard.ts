/**
 * Model of the leaderboard (02 section 5.2): one bar per bot, centred on zero. Live, dry and replay
 * are never mixed: the caller asks for one mode. A bot whose figure is stale or missing gets no bar,
 * does not set the scale and is not summed; it is listed as excluded.
 */
import type { BotKey, BotMode, BotRow } from '@/gateway/types.gen';

import { isStaleGroup } from './bots';

export type LeaderboardPeriod = '1d' | '7d' | '30d' | 'total';

export const LEADERBOARD_PERIODS: LeaderboardPeriod[] = ['1d', '7d', '30d', 'total'];

export interface LeaderboardItem {
  key: BotKey;
  name: string;
  mode: BotMode;
  /** Null when unknown. */
  value: number | null;
  stale: boolean;
}

export function metricOf(bot: BotRow, period: LeaderboardPeriod): number | null {
  const m = bot.metrics;
  switch (period) {
    case '1d':
      return m.realized_1d;
    case '7d':
      return m.realized_7d;
    case '30d':
      return m.realized_30d;
    case 'total':
      return m.realized_total;
  }
}

export function itemsFromBots(
  bots: readonly BotRow[],
  period: LeaderboardPeriod,
  nowMs: number,
  skewMs: number,
): LeaderboardItem[] {
  return bots.map((b) => ({
    key: b.bot_key,
    name: b.identity.name,
    mode: b.identity.mode,
    value: metricOf(b, period),
    stale: isStaleGroup(b, 'metrics', nowMs, skewMs),
  }));
}

export interface RankedItem extends LeaderboardItem {
  /** Whether the value counts (fresh and known). */
  counted: boolean;
  /** Bar length as a share of one half of the track (0 to 1). */
  ratio: number;
}

export interface Ranking {
  rows: RankedItem[];
  /** Largest absolute counted value: the scale. */
  scale: number;
  /** Sum of the counted values of the mode. */
  total: number;
  counted: number;
  excluded: RankedItem[];
}

export function rank(items: readonly LeaderboardItem[], mode: BotMode): Ranking {
  const mine = items.filter((i) => i.mode === mode);
  const isCounted = (i: LeaderboardItem) =>
    !i.stale && i.value !== null && Number.isFinite(i.value);
  const scale = mine.reduce(
    (m, i) => (isCounted(i) ? Math.max(m, Math.abs(i.value as number)) : m),
    0,
  );
  const rows: RankedItem[] = mine.map((i) => ({
    ...i,
    counted: isCounted(i),
    ratio: isCounted(i) && scale > 0 ? Math.abs(i.value as number) / scale : 0,
  }));
  rows.sort((a, b) => {
    if (a.counted !== b.counted) return a.counted ? -1 : 1;
    if (!a.counted) return a.name.localeCompare(b.name);
    return (b.value as number) - (a.value as number) || a.name.localeCompare(b.name);
  });
  return {
    rows,
    scale,
    total: rows.reduce((s, r) => (r.counted ? s + (r.value as number) : s), 0),
    counted: rows.filter((r) => r.counted).length,
    excluded: rows.filter((r) => !r.counted),
  };
}
