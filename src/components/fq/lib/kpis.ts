/**
 * Figures of the Fleet KPI strip (docs/redesign/02-design.md, sections 3.1 and 12), computed from
 * one trading-mode block of a scope. Pure: the component only draws them. Rules the tests pin down:
 * live and dry are never added together (one model per mode), a bot whose figures are stale is
 * excluded from the sums and listed, the capital is the registry's (`available_capital -
 * capital_withdrawal`) and never a wallet balance.
 */
import type { BotState } from '@/components/ds/types';
import type { ScopeDetail, ScopeTotals } from '@/datasource/types';
import type { BotKey, BotMode, BotRow, Exposure, Position } from '@/gateway/types.gen';

import { botState, drawdownPct, isStaleGroup } from './bots';
import { aggregateSlot, PENDING, READY, unavailable, type Slot } from './valueState';

export interface FleetKpiModel {
  mode: BotMode;
  /** Starting capital plus realized profit; null when no bot has a known capital. */
  equityRealized: number | null;
  /** Realized equity plus the latent profit of the open positions. */
  equityOpen: number | null;
  capitalUnknown: number;
  openProfit: number | null;
  openCount: number;
  realized1d: number | null;
  realized30d: number | null;
  /** Share of winning closed trades (0 to 1), weighted by each bot's closed trades. */
  winrate: number | null;
  drawdown: { abs: number; pct: number | null } | null;
  exposure: Exposure;
  netted: boolean;
  /** Margin engaged by the open positions over the starting capital, percent. */
  marginPct: number | null;
  online: number;
  total: number;
  /** Bots that are not online, by state. */
  states: Partial<Record<BotState, number>>;
  excluded: BotKey[];
  /**
   * State of each figure. A figure that is not `ready` is null above, never 0: when every position
   * of the scope is excluded (prices unknown) the latent profit, the equity with open positions
   * and the drawdown with open positions are unavailable, not "0.00".
   */
  slots: Record<
    | 'equityOpen'
    | 'openProfit'
    | 'realized1d'
    | 'realized30d'
    | 'drawdown'
    | 'exposure'
    | 'margin'
    | 'capital',
    Slot
  >;
}

function weightedWinrate(bots: readonly BotRow[]): number | null {
  let wins = 0;
  let trades = 0;
  for (const b of bots) {
    const w = b.metrics.winrate;
    const n = b.metrics.trades_closed;
    if (w == null || n == null || n <= 0) continue;
    wins += w * n;
    trades += n;
  }
  return trades > 0 ? wins / trades : null;
}

export function fleetKpiModel(
  block: ScopeTotals,
  detail: Pick<ScopeDetail, 'bots' | 'positions' | 'drawdown'>,
  nowMs: number,
  skewMs: number,
  /** The drawdown belongs to the first block of the detail: pass it only for that one. */
  withDrawdown = true,
): FleetKpiModel {
  const bots = detail.bots.filter((b) => b.identity.mode === block.mode);
  const keys = new Set(bots.map((b) => b.bot_key));

  const capital = block.starting_capital.known > 0 ? block.starting_capital.total : null;
  const equityRealized =
    capital !== null && block.realized_total !== null ? capital + block.realized_total : null;
  const equityOpen =
    equityRealized !== null && block.open_profit_abs !== null
      ? equityRealized + block.open_profit_abs
      : null;

  // Margin is summed over fresh, owned positions of the bots of this mode only. A bot left out of
  // the sums because its prices are missing still has a known stake: only a silent bot is left out.
  const posStale = new Set(
    bots.filter((b) => isStaleGroup(b, 'positions', nowMs, skewMs)).map((b) => b.bot_key),
  );
  const marginPositions = detail.positions.filter(
    (p: Position) =>
      keys.has(p.bot_key) && !p.orphan && !p.freshness.stale && !posStale.has(p.bot_key),
  );
  const margin = marginPositions.reduce((sum, p) => sum + p.stake_amount, 0);

  // A bot that announces more positions than were read (direct mode reads the bots in turn, or
  // the prices are not known yet) makes the sum a fragment: unknown, not "0,0 %"
  const read = new Map<BotKey, number>();
  for (const p of detail.positions) {
    if (!p.orphan) read.set(p.bot_key, (read.get(p.bot_key) ?? 0) + 1);
  }
  const marginPartial = bots.some(
    (b) =>
      !posStale.has(b.bot_key) &&
      (b.state.status === 'online' || b.state.status === 'starting') &&
      b.state.open_trades > (read.get(b.bot_key) ?? 0),
  );

  const states: Partial<Record<BotState, number>> = {};
  let online = 0;
  for (const b of bots) {
    const st = botState(b, nowMs, skewMs);
    if (st === 'online') online += 1;
    else states[st] = (states[st] ?? 0) + 1;
  }

  const ddSource =
    block.drawdown !== undefined ? block.drawdown : withDrawdown ? detail.drawdown : null;
  const dd = ddSource?.with_open ?? null;

  const base = { bots, nowMs, skewMs };
  const openSlot = aggregateSlot({
    ...base,
    pick: (b) => b.metrics.open_profit_abs,
    group: 'positions',
    hasValue: block.open_profit_abs !== null,
    prices: true,
  });
  const day = aggregateSlot({
    ...base,
    pick: (b) => b.metrics.realized_1d,
    group: 'metrics',
    hasValue: block.realized_1d !== null,
  });
  const month = aggregateSlot({
    ...base,
    pick: (b) => b.metrics.realized_30d,
    group: 'metrics',
    hasValue: block.realized_30d !== null,
  });
  // Nothing to sum yet: the common state of the bots says why (still being read, silent...)
  const whyNot = (group: 'metrics' | 'capital'): Slot => {
    if (group === 'capital') {
      // The capital is a registry fact: once the bots that answer were read, a missing one stays
      // missing. A bot that never answers (starting, silent) does not hold the others back
      const answering = bots.filter((b) => b.state.status === 'online');
      const reading = answering.length === 0 || answering.some((b) => !b.freshness.capital);
      return reading ? PENDING : unavailable('capital');
    }
    return aggregateSlot({ ...base, pick: () => null, group, hasValue: false });
  };
  const equitySlot: Slot =
    equityRealized === null ? whyNot(capital === null ? 'capital' : 'metrics') : openSlot;
  const drawdownSlot: Slot = openSlot.state !== 'ready' ? openSlot : dd ? READY : whyNot('metrics');
  const marginKnown = capital !== null && capital > 0;
  // Margin and exposure need the positions to have been read, not priced
  const positionsSlot = aggregateSlot({
    ...base,
    pick: (b) => b.metrics.exposure_long ?? b.metrics.exposure_short,
    group: 'positions',
    hasValue: true,
  });
  // A bot announcing more positions than were read makes the sum a fragment: still being read
  const marginSlot: Slot = marginKnown
    ? marginPartial
      ? PENDING
      : positionsSlot
    : capital === null
      ? whyNot('capital')
      : PENDING;
  const exposureSlot = positionsSlot;
  const ok = (slot: Slot) => slot.state === 'ready';

  return {
    mode: block.mode,
    equityRealized,
    equityOpen: ok(equitySlot) ? equityOpen : null,
    capitalUnknown: block.starting_capital.unknown,
    openProfit: ok(openSlot) ? block.open_profit_abs : null,
    openCount: block.open_trades,
    realized1d: ok(day) ? block.realized_1d : null,
    realized30d: ok(month) ? block.realized_30d : null,
    winrate: weightedWinrate(bots),
    drawdown: ok(drawdownSlot) && dd ? { abs: dd.abs, pct: drawdownPct(dd) } : null,
    exposure: block.exposure,
    netted: block.netted,
    marginPct: ok(marginSlot) && marginKnown ? (margin / capital) * 100 : null,
    online,
    total: bots.length,
    states,
    excluded: block.excluded,
    slots: {
      equityOpen: equitySlot,
      openProfit: openSlot,
      realized1d: day,
      realized30d: month,
      drawdown: drawdownSlot,
      exposure: exposureSlot,
      margin: marginSlot,
      capital: capital === null ? whyNot('capital') : READY,
    },
  };
}
