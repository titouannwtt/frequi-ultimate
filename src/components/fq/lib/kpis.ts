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

import { botState, drawdownPct } from './bots';

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
  const excluded = new Set(block.excluded);

  const capital = block.starting_capital.known > 0 ? block.starting_capital.total : null;
  const equityRealized =
    capital !== null && block.realized_total !== null ? capital + block.realized_total : null;
  const equityOpen =
    equityRealized !== null && block.open_profit_abs !== null
      ? equityRealized + block.open_profit_abs
      : null;

  // Margin is summed over fresh, owned positions of the bots of this mode only
  const margin = detail.positions
    .filter(
      (p: Position) =>
        keys.has(p.bot_key) && !p.orphan && !p.freshness.stale && !excluded.has(p.bot_key),
    )
    .reduce((sum, p) => sum + p.stake_amount, 0);

  // A bot that announces more positions than were read (direct mode reads the bots in turn, or
  // the prices are not known yet) makes the sum a fragment: unknown, not "0,0 %"
  const read = new Map<BotKey, number>();
  for (const p of detail.positions) {
    if (!p.orphan) read.set(p.bot_key, (read.get(p.bot_key) ?? 0) + 1);
  }
  const marginPartial = bots.some(
    (b) =>
      !excluded.has(b.bot_key) &&
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

  return {
    mode: block.mode,
    equityRealized,
    equityOpen,
    capitalUnknown: block.starting_capital.unknown,
    openProfit: block.open_profit_abs,
    openCount: block.open_trades,
    realized1d: block.realized_1d,
    realized30d: block.realized_30d,
    winrate: weightedWinrate(bots),
    drawdown: dd ? { abs: dd.abs, pct: drawdownPct(dd) } : null,
    exposure: block.exposure,
    netted: block.netted,
    marginPct: capital !== null && capital > 0 && !marginPartial ? (margin / capital) * 100 : null,
    online,
    total: bots.length,
    states,
    excluded: block.excluded,
  };
}
