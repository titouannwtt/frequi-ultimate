/**
 * The stress test of the advanced risk page (02 sections 4.1 C5 and 12). A uniform move of every
 * price is applied to the open positions and each is tested against the liquidation price the
 * exchange reports for it, instead of an assumed leverage (the old card guessed it). The model is
 * deliberately plain and says what it ignores: funding, fees, slippage, a margin that moves, and
 * correlations (every coin moves by the same percentage). A liquidated position loses its whole
 * margin (`stake_amount`). Positions of the other trading modes, orphans and stale bots never count.
 */
import type { BotKey, BotMode, Market, Position } from '@/gateway/types.gen';

export const SHOCKS = [-30, -20, -10, -5, 5, 10, 20, 30] as const;
export type Shock = (typeof SHOCKS)[number];

export type StressInput = Pick<
  Position,
  | 'bot_key'
  | 'pair'
  | 'coin'
  | 'market'
  | 'side'
  | 'leverage'
  | 'stake_amount'
  | 'notional'
  | 'current_rate'
  | 'profit_abs'
  | 'liquidation_price'
  | 'orphan'
> & { freshness: Pick<Position['freshness'], 'stale'> };

export interface StressRow {
  botKey: BotKey;
  pair: string;
  coin: string;
  market: Market;
  side: 'long' | 'short';
  price: number;
  shockedPrice: number;
  liquidationPrice: number | null;
  /** The shocked price crosses the liquidation price. */
  liquidated: boolean;
  /** Change of the result of this position against now, USDC (a liquidation: the margin is lost). */
  delta: number;
}

export interface StressResult {
  shock: number;
  rows: StressRow[];
  /** Sum of `delta`, USDC. */
  delta: number;
  liquidated: number;
  /** Margin lost to liquidations, USDC. */
  marginLost: number;
  /** Positions that could not be tested (no price, or no liquidation price). */
  untested: number;
  /** Positions counted. */
  counted: number;
}

export function isLiquidated(
  side: 'long' | 'short',
  shockedPrice: number,
  liquidationPrice: number | null,
): boolean {
  if (liquidationPrice === null || !Number.isFinite(liquidationPrice) || liquidationPrice <= 0) {
    return false;
  }
  return side === 'long' ? shockedPrice <= liquidationPrice : shockedPrice >= liquidationPrice;
}

/** Positions that take part: right mode, owned by a bot, not stale. */
export function stressable(
  positions: readonly StressInput[],
  mode: BotMode,
  modeOf: (botKey: BotKey) => BotMode | null,
): StressInput[] {
  return positions.filter((p) => !p.orphan && !p.freshness.stale && modeOf(p.bot_key) === mode);
}

export function stressTest(positions: readonly StressInput[], shockPct: number): StressResult {
  const rows: StressRow[] = [];
  let untested = 0;
  for (const p of positions) {
    if (p.current_rate === null || !(p.current_rate > 0)) {
      untested += 1;
      continue;
    }
    const sign = p.side === 'long' ? 1 : -1;
    const shocked = p.current_rate * (1 + shockPct / 100);
    const liquidated = isLiquidated(p.side, shocked, p.liquidation_price);
    if (p.liquidation_price === null) untested += 1;
    // Linear P&L on the notional; a liquidation replaces it by the loss of the margin
    const delta = liquidated
      ? -p.stake_amount - (p.profit_abs ?? 0)
      : (sign * p.notional * shockPct) / 100;
    rows.push({
      botKey: p.bot_key,
      pair: p.pair,
      coin: p.coin,
      market: p.market,
      side: p.side,
      price: p.current_rate,
      shockedPrice: shocked,
      liquidationPrice: p.liquidation_price,
      liquidated,
      delta,
    });
  }
  const hit = rows.filter((r) => r.liquidated);
  return {
    shock: shockPct,
    rows: rows.slice().sort((a, b) => Number(b.liquidated) - Number(a.liquidated) || a.delta - b.delta),
    delta: rows.reduce((s, r) => s + r.delta, 0),
    liquidated: hit.length,
    marginLost: hit.reduce((s, r) => s - r.delta, 0),
    untested,
    counted: rows.length,
  };
}

/** Exposure by market (crypto and each HIP-3 dex), absolute notionals by side, biggest first. */
export interface MarketRow {
  market: Market;
  long: number;
  short: number;
  positions: number;
}

export function byMarket(positions: readonly StressInput[]): MarketRow[] {
  const map = new Map<Market, MarketRow>();
  for (const p of positions) {
    const r = map.get(p.market) ?? { market: p.market, long: 0, short: 0, positions: 0 };
    if (p.side === 'long') r.long += p.notional;
    else r.short += p.notional;
    r.positions += 1;
    map.set(p.market, r);
  }
  return [...map.values()].sort(
    (a, b) => b.long + b.short - (a.long + a.short) || a.market.localeCompare(b.market),
  );
}
