/**
 * Model of the pair navigator (02 sections 3.3 and 4.1 C11). Four lists share one row model: the
 * open positions of the fleet (worst first), the recent signals of a bot, its pair locks and its
 * whitelist. The key of a position row is `bot_key/trade_id`, so the same pair held by two bots is
 * two rows that never get mixed up; the other lists are keyed by pair.
 */
import type { BotKey, Position, Side } from '@/gateway/types.gen';

import { tradeKey } from './trades';

export type PairFilter = 'positions' | 'signals' | 'locks' | 'all';

export const PAIR_FILTERS: PairFilter[] = ['positions', 'signals', 'locks', 'all'];

export interface PairItem {
  key: string;
  pair: string;
  botKey: BotKey | null;
  tradeId: number | null;
  side: Side | null;
  /** Position rows only. */
  profitAbs: number | null;
  profitPct: number | null;
  dca: number | null;
  stale: boolean;
  orphan: boolean;
  /** Signal rows: what the strategy flagged on the last candle. */
  signals: SignalKind[];
  /** Lock rows. */
  lockId: number | null;
  lockEndMs: number | null;
  lockReason: string | null;
}

export type SignalKind = 'enter_long' | 'exit_long' | 'enter_short' | 'exit_short';

const blank = (): Omit<PairItem, 'key' | 'pair'> => ({
  botKey: null,
  tradeId: null,
  side: null,
  profitAbs: null,
  profitPct: null,
  dca: null,
  stale: false,
  orphan: false,
  signals: [],
  lockId: null,
  lockEndMs: null,
  lockReason: null,
});

/** Worst P&L first (those need a look), unknown last; ties by pair then key. */
export function positionItems(positions: readonly Position[], botKey?: BotKey | null): PairItem[] {
  return positions
    .filter((p) => (botKey ? p.bot_key === botKey : true))
    .map<PairItem>((p) => ({
      ...blank(),
      key: tradeKey(p.bot_key, p.trade_id),
      pair: p.pair,
      botKey: p.orphan ? null : p.bot_key,
      tradeId: p.trade_id,
      side: p.side,
      profitAbs: p.profit_abs,
      profitPct: p.profit_ratio == null ? null : p.profit_ratio * 100,
      dca: p.dca_entries,
      stale: p.freshness.stale,
      orphan: p.orphan,
    }))
    .sort((a, b) => {
      const x = a.profitAbs;
      const y = b.profitAbs;
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      return x - y || a.pair.localeCompare(b.pair) || a.key.localeCompare(b.key);
    });
}

export interface SignalSummary {
  pairs: Record<string, Partial<Record<SignalKind, number>>>;
}

const SIGNAL_ORDER: SignalKind[] = ['enter_long', 'enter_short', 'exit_long', 'exit_short'];

/** Pairs with at least one signal in `/signal_summary`, entries before exits. */
export function signalItems(summary: SignalSummary | null | undefined, botKey: BotKey): PairItem[] {
  if (!summary) return [];
  return Object.entries(summary.pairs ?? {})
    .map<PairItem | null>(([pair, counts]) => {
      const signals = SIGNAL_ORDER.filter((k) => (counts[k] ?? 0) > 0);
      if (signals.length === 0) return null;
      return { ...blank(), key: pair, pair, botKey, signals };
    })
    .filter((x): x is PairItem => x !== null)
    .sort(
      (a, b) =>
        SIGNAL_ORDER.indexOf(a.signals[0]!) - SIGNAL_ORDER.indexOf(b.signals[0]!) ||
        a.pair.localeCompare(b.pair),
    );
}

export interface LockRecord {
  /** Absent behind the gateway, which does not report it: the lock is listed, not liftable. */
  id?: number | null;
  pair: string;
  lock_end_timestamp: number;
  reason?: string | null;
  side?: string | null;
  active?: boolean;
}

/** Active locks, the one ending last first. */
export function lockItems(locks: readonly LockRecord[] | undefined, botKey: BotKey): PairItem[] {
  return (locks ?? [])
    .filter((l) => l.active !== false)
    .map<PairItem>((l) => ({
      ...blank(),
      key: `lock:${l.id ?? l.pair}`,
      pair: l.pair,
      botKey,
      lockId: l.id ?? null,
      lockEndMs: l.lock_end_timestamp,
      lockReason: l.reason ?? null,
    }))
    .sort((a, b) => (b.lockEndMs ?? 0) - (a.lockEndMs ?? 0) || a.pair.localeCompare(b.pair));
}

export function whitelistItems(pairs: readonly string[] | undefined, botKey: BotKey): PairItem[] {
  return [...new Set(pairs ?? [])]
    .sort((a, b) => a.localeCompare(b))
    .map<PairItem>((pair) => ({ ...blank(), key: pair, pair, botKey }));
}

/** Search over the pair and, for positions, the name of the bot. */
export function matchesPair(item: PairItem, q: string, botName: string | null): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return `${item.pair} ${botName ?? ''}`.toLowerCase().includes(needle);
}
