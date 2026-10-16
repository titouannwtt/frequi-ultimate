/**
 * Per-mode figures of a set of bots, computed from their rows and positions. Used by DirectSource
 * for every scope, and by GatewaySource for the scopes the gateway does not total itself (a bot, a
 * group). Live, dry and replay are never added together: one block per mode that has bots.
 */
import type { BotMode, BotRow, Position } from '@/gateway/types.gen';

import type { ScopeTotals } from '../types';
import { sumStartingCapital } from './capital';
import { exposure } from './exposure';
import { sumFresh } from './freshness';

export const SCOPE_MODES: readonly BotMode[] = ['live', 'dry', 'replay'];

/**
 * `walletOf` returns the wallet a bot trades (or a per-bot id), so that exposure is netted per coin
 * at wallet level, never per bot.
 */
export function scopeTotalsByMode(
  rows: readonly BotRow[],
  positions: readonly Position[],
  walletOf: (botKey: string) => string,
): ScopeTotals[] {
  const totals: ScopeTotals[] = [];
  for (const mode of SCOPE_MODES) {
    const mrows = rows.filter((r) => r.identity.mode === mode);
    if (mrows.length === 0) continue;
    const sumOf = (
      pick: (r: BotRow) => number | null | undefined,
      group: 'metrics' | 'positions',
    ) =>
      sumFresh(
        mrows.map((r) => ({
          key: r.bot_key,
          value: pick(r),
          fresh: r.freshness[group] ?? { stale: true },
        })),
      );
    const r1 = sumOf((r) => r.metrics.realized_1d, 'metrics');
    const r7 = sumOf((r) => r.metrics.realized_7d, 'metrics');
    const r30 = sumOf((r) => r.metrics.realized_30d, 'metrics');
    const rt = sumOf((r) => r.metrics.realized_total, 'metrics');
    const op = sumOf((r) => r.metrics.open_profit_abs, 'positions');
    const known = (fr: ReturnType<typeof sumOf>) => (fr.included > 0 ? fr.total : null);
    const mpos = positions.filter((p) => mrows.some((r) => r.bot_key === p.bot_key));
    const ex = exposure(
      mpos.map((p) => ({
        coin: `${walletOf(p.bot_key)}|${p.coin}`,
        side: p.side,
        notional: p.notional,
      })),
    );
    totals.push({
      mode,
      bots: mrows.length,
      open_trades: mrows.reduce((a, r) => a + r.state.open_trades, 0),
      max_open_trades: mrows.every((r) => r.state.max_open_trades !== null)
        ? mrows.reduce((a, r) => a + (r.state.max_open_trades as number), 0)
        : null,
      realized_1d: known(r1),
      realized_7d: known(r7),
      realized_30d: known(r30),
      realized_total: known(rt),
      open_profit_abs: known(op),
      starting_capital: sumStartingCapital(mrows.map((r) => r.metrics.starting_capital)),
      exposure: ex,
      netted: true,
      excluded: [
        ...new Set([
          ...r1.excluded,
          ...r7.excluded,
          ...r30.excluded,
          ...rt.excluded,
          ...op.excluded,
        ]),
      ],
    });
  }
  return totals;
}
