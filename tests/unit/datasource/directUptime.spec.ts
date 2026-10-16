/* eslint-disable @typescript-eslint/no-explicit-any -- partial bot answers */
import { describe, expect, it } from 'vitest';

import { buildBotRow, newRuntime } from '@/datasource/direct/model';

const NOW = 1_800_000_000_000;
const ctx = {
  nowMs: NOW,
  walletId: null,
  walletShared: false,
  alerts: { count: 0, worst: null, items: [] } as any,
  cadences: { statusMs: 30_000, slowMs: 180_000, digestMs: 10_000, overviewMs: 60_000 },
  statusCadenceMs: 30_000,
  slowCadenceMs: 180_000,
};

function runtime() {
  const rt = newRuntime('ftbot.0', 'local:9400', 'hippo', null, 9400, 0);
  rt.config = { data: { dry_run: false, bot_name: 'hippo' } as any, atMs: NOW };
  return rt;
}

describe('uptime of a bot read directly (B231)', () => {
  it('is the process start, like the gateway, not the last reload of the configuration', () => {
    const rt = runtime();
    // The configuration was reloaded 11 h ago; the process has run for a week
    rt.profit = { data: { bot_start_timestamp: NOW - 11 * 3_600_000 } as any, atMs: NOW };
    rt.overview = {
      data: {
        uptime: { process_start: NOW - 7 * 86_400_000 },
        pnl: {},
        trades: {},
        capital: {},
      } as any,
      atMs: NOW,
    };
    expect(buildBotRow(rt, ctx).state.started_ms).toBe(NOW - 7 * 86_400_000);
  });

  it('falls back on the bot start when the overview is not available', () => {
    const rt = runtime();
    rt.profit = { data: { bot_start_timestamp: NOW - 11 * 3_600_000 } as any, atMs: NOW };
    expect(buildBotRow(rt, ctx).state.started_ms).toBe(NOW - 11 * 3_600_000);
  });
});

describe('latent profit of a bot whose prices are unknown (B234)', () => {
  const trade = (profit: unknown) => ({ trade_id: 1, pair: 'BTC/USDC:USDC', profit_abs: profit });

  it('is unknown, not 0, when no open position has a profit', () => {
    const rt = runtime();
    rt.status = { data: [trade(null), trade(undefined)] as any, atMs: NOW };
    expect(buildBotRow(rt, ctx).metrics.open_profit_abs).toBeNull();
  });

  it('is the sum of the known ones, and 0 for a flat book', () => {
    const rt = runtime();
    rt.status = { data: [trade(2), trade(null), trade(-0.5)] as any, atMs: NOW };
    expect(buildBotRow(rt, ctx).metrics.open_profit_abs).toBe(1.5);
    rt.status = { data: [], atMs: NOW };
    expect(buildBotRow(rt, ctx).metrics.open_profit_abs).toBe(0);
  });
});
