/**
 * Wallet-level risk model (02 section 12, C5): exposure netted per coin on each wallet, the closest
 * liquidation, the effective leverage and the orphan positions. Exposure is never summed per bot:
 * two bots on the same wallet that hold opposite sides of a coin net each other on the exchange.
 */
import type { BotKey, BotMode, Health, HealthReason, Position, Side } from '@/gateway/types.gen';
import type { ScopeTotals } from '@/datasource/types';

export interface CoinRow {
  /** `wallet|coin`. */
  key: string;
  coin: string;
  walletId: string | null;
  bots: BotKey[];
  /** Absolute notionals by side, USDC. */
  long: number;
  short: number;
  /** Long minus short: what the exchange sees. */
  net: number;
}

export interface OrphanRow {
  pair: string;
  coin: string;
  side: Side;
  notional: number;
}

export interface NearestLiquidation {
  pair: string;
  botKey: BotKey;
  distancePct: number;
}

export interface RiskModel {
  nearest: NearestLiquidation | null;
  /** Effective leverage: netted gross notional over capital; null without a capital. */
  leverage: number | null;
  /** Some bots have no known capital: the leverage is an upper bound. */
  capitalPartial: boolean;
  capital: number | null;
  exposure: { long: number; short: number; net: number; grossNetted: number; netted: boolean };
  /** Coins held by two bots or more on the same wallet, biggest first. */
  coins: CoinRow[];
  orphans: OrphanRow[];
  /** Bots whose positions are too old to count: listed, never summed. */
  excluded: BotKey[];
}

export interface RiskInput {
  positions: readonly Position[];
  /** Totals block of the mode being shown (live by default); null when not loaded. */
  totals: ScopeTotals | null;
  mode: BotMode;
  modeOf: (botKey: BotKey) => BotMode | null;
  walletOf: (botKey: BotKey) => string | null;
}

export function riskModel(input: RiskInput): RiskModel {
  const fresh: Position[] = [];
  const excluded = new Set<BotKey>();
  const orphans: OrphanRow[] = [];
  for (const p of input.positions) {
    if (p.orphan) {
      orphans.push({ pair: p.pair, coin: p.coin, side: p.side, notional: p.notional });
      continue;
    }
    if (input.modeOf(p.bot_key) !== input.mode) continue;
    if (p.freshness.stale) {
      excluded.add(p.bot_key);
      continue;
    }
    fresh.push(p);
  }

  let nearest: NearestLiquidation | null = null;
  const byCoin = new Map<string, CoinRow>();
  for (const p of fresh) {
    if (p.liq_distance_pct != null && Number.isFinite(p.liq_distance_pct)) {
      if (!nearest || p.liq_distance_pct < nearest.distancePct) {
        nearest = { pair: p.pair, botKey: p.bot_key, distancePct: p.liq_distance_pct };
      }
    }
    const walletId = input.walletOf(p.bot_key);
    const key = `${walletId ?? p.bot_key}|${p.coin}`;
    const row = byCoin.get(key) ?? {
      key,
      coin: p.coin,
      walletId,
      bots: [],
      long: 0,
      short: 0,
      net: 0,
    };
    if (!row.bots.includes(p.bot_key)) row.bots.push(p.bot_key);
    if (p.side === 'long') row.long += p.notional;
    else row.short += p.notional;
    row.net = row.long - row.short;
    byCoin.set(key, row);
  }

  const coins = [...byCoin.values()]
    .filter((c) => c.bots.length >= 2)
    .sort((a, b) => b.long + b.short - (a.long + a.short) || a.key.localeCompare(b.key));

  const t = input.totals;
  const capital = t && t.starting_capital.known > 0 ? t.starting_capital.total : null;
  const gross = t ? t.exposure.gross_netted : 0;
  return {
    nearest,
    leverage: capital && capital > 0 && t ? gross / capital : null,
    capitalPartial: !!t && t.starting_capital.unknown > 0,
    capital,
    exposure: t
      ? {
          long: t.exposure.long,
          short: t.exposure.short,
          net: t.exposure.net,
          grossNetted: t.exposure.gross_netted,
          netted: t.netted,
        }
      : { long: 0, short: 0, net: 0, grossNetted: 0, netted: false },
    coins,
    orphans,
    excluded: [...excluded],
  };
}

/** Tone of the closest liquidation: under 15 % is critical (rule `nearLiquidation`), under 25 % warns. */
export function liquidationTone(pct: number | null): 'crit' | 'warn' | 'neutral' {
  if (pct == null) return 'neutral';
  if (pct < 15) return 'crit';
  if (pct < 25) return 'warn';
  return 'neutral';
}

// ---- system health ----

export type BudgetTone = 'ok' | 'warn' | 'crit';

/** Hyperliquid request budget used: warn from 60 %, critical from 80 % (rule `daemonDegraded`). */
export function budgetTone(pct: number | null): BudgetTone {
  if (pct == null) return 'ok';
  return pct >= 80 ? 'crit' : pct >= 60 ? 'warn' : 'ok';
}

/** Cache hit rate (0 to 1): below 90 % warns, below 75 % is critical. */
export function hitRateTone(rate: number | null): BudgetTone {
  if (rate == null) return 'ok';
  return rate < 0.75 ? 'crit' : rate < 0.9 ? 'warn' : 'ok';
}

/** Reason codes the translations know; any other code is shown as received. */
export const KNOWN_REASONS = [
  'bots_offline',
  'auth_expired',
  'data_stale',
  'daemon_backoff',
  'rate_budget',
] as const;

export function isKnownReason(code: string): boolean {
  return (KNOWN_REASONS as readonly string[]).includes(code);
}

/** Worst severity first, then by code, so the order never depends on arrival order. */
export function sortReasons(reasons: readonly HealthReason[]): HealthReason[] {
  const rank = { critical: 2, warning: 1, info: 0 } as const;
  return reasons
    .slice()
    .sort((a, b) => rank[b.severity] - rank[a.severity] || a.code.localeCompare(b.code));
}

/** Level shown by the status bar dot (`HealthLevel` of the contract to the design-system one). */
export function barLevel(h: Pick<Health, 'level'> | null): 'ok' | 'degraded' | 'crit' {
  if (!h) return 'degraded';
  return h.level === 'critical' ? 'crit' : h.level;
}
