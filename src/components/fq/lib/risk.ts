/**
 * Wallet-level risk model (02 section 12, C5): exposure netted per coin on each wallet, the closest
 * liquidation, the effective leverage and the orphan positions. Exposure is never summed per bot:
 * two bots on the same wallet that hold opposite sides of a coin net each other on the exchange.
 */
import {
  HEALTH_REASON_CODES,
  type BotKey,
  type BotMode,
  type Health,
  type HealthReason,
  type HealthReasonCode,
  type Position,
  type Side,
} from '@/gateway/types.gen';
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

export type RiskLevel = 'flat' | 'moderate' | 'high' | 'critical';

/**
 * The wallet risk in one word: critical when a liquidation is under 15 % away (rule
 * `nearLiquidation`), high when one is under 25 % away, when an orphan position sits on the
 * wallet or when 85 % of the capital is engaged as margin, moderate otherwise. Flat without any
 * exposure. Only thresholds the app already has: nothing here is a new rule.
 */
export function riskLevel(
  m: Pick<RiskModel, 'nearest' | 'orphans' | 'exposure'>,
  marginPct: number | null,
): RiskLevel {
  if (m.exposure.long + m.exposure.short <= 0 && m.orphans.length === 0) return 'flat';
  const tone = liquidationTone(m.nearest?.distancePct ?? null);
  if (tone === 'crit') return 'critical';
  if (tone === 'warn' || m.orphans.length > 0 || (marginPct !== null && marginPct >= 85)) {
    return 'high';
  }
  return 'moderate';
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

/**
 * Reason codes the translations know: the catalogue of the contract (`HEALTH_REASON_CODES`, from
 * the gateway), so a code the gateway adds is a type error here until it is translated. Any other
 * code is shown as received.
 */
export const KNOWN_REASONS: readonly HealthReasonCode[] = HEALTH_REASON_CODES;

export function isKnownReason(code: string): code is HealthReasonCode {
  return (KNOWN_REASONS as readonly string[]).includes(code);
}

/** Codes whose `detail` is a bare figure that the page words (the others show it as it is). */
const FIGURE_DETAILS: ReadonlySet<string> = new Set<HealthReasonCode>([
  'rate_budget_low',
  'rate_limit_events',
]);

export function hasFigureDetail(code: string): boolean {
  return FIGURE_DETAILS.has(code);
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
