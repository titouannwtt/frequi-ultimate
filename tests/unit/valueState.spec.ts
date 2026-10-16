import { describe, expect, it } from 'vitest';

import { FIXTURE_NOW, makeBot, makePosition } from '@/components/fq/fixtures';
import { fleetKpiModel } from '@/components/fq/lib/kpis';
import {
  aggregateSlot,
  botSlot,
  lineSlot,
  positionSlot,
  PENDING,
  READY,
  unavailable,
} from '@/components/fq/lib/valueState';
import { scopeTotalsByMode } from '@/datasource/calc/scopeTotals';
import type { ScopeDetail } from '@/datasource/types';
import type { BotRow, Position } from '@/gateway/types.gen';

const ctx = { nowMs: FIXTURE_NOW, skewMs: 0 };

/** A live bot with `slots` open positions, priced (`latent`) or not (null: the 429 backoff). */
const bot = (seq: number, slots: number, latent: number | null, extra: Partial<BotRow> = {}) =>
  ({
    ...makeBot(seq, {
      name: `b${seq}`,
      mode: 'live',
      slots,
      latent,
      d1: 5,
      d30: 50,
      capital: 1000,
      long: slots * 100,
      short: 0,
    }),
    ...extra,
  }) as BotRow;

function positionsOf(bots: BotRow[], priced: (b: BotRow) => boolean): Position[] {
  return bots.flatMap((b) =>
    Array.from({ length: b.state.open_trades }, (_, i) => {
      const p = makePosition(b, 'BTC/USDC:USDC', i + 1, 'long', 0.5);
      return priced(b) ? p : { ...p, current_rate: null, profit_abs: null, profit_ratio: null };
    }),
  );
}

/** What the sources do: one totals block per mode from the rows and positions. */
function detailOf(bots: BotRow[], priced: (b: BotRow) => boolean): ScopeDetail {
  const positions = positionsOf(bots, priced);
  const totals = scopeTotalsByMode(bots, positions, (k) => k);
  return {
    scope: { kind: 'fleet' },
    bots,
    positions,
    totals,
    drawdown: {
      realized: { abs: 10, pct: 0.01, peak_ms: null, trough_ms: null, current_abs: 0 },
      with_open: { abs: 30, pct: 0.03, peak_ms: null, trough_ms: null, current_abs: 0 },
      open_worst_sum: 0,
      has_open: true,
      base: 1000,
    },
    asOfMs: FIXTURE_NOW,
  };
}

const kpis = (d: ScopeDetail) => fleetKpiModel(d.totals[0]!, d, FIXTURE_NOW, 0);

describe('botSlot', () => {
  it('a figure is ready, even a stale one (shown muted, never summed)', () => {
    expect(botSlot(bot(1, 1, 5), 'positions', 5, ctx)).toEqual(READY);
    expect(botSlot(undefined, 'positions', 0, ctx)).toEqual(READY);
  });

  it('no row, a bot that is starting, or a group never received: pending', () => {
    expect(botSlot(undefined, 'metrics', null, ctx)).toEqual(PENDING);
    const starting = bot(2, 0, null, {
      state: { ...bot(2, 0, null).state, status: 'starting' },
    } as Partial<BotRow>);
    expect(botSlot(starting, 'metrics', null, ctx)).toEqual(PENDING);
    const noGroup = bot(3, 0, null, { freshness: {} });
    expect(botSlot(noGroup, 'metrics', null, ctx)).toEqual(PENDING);
  });

  it('a bot that is offline, expired or stopped has nothing to wait for: unavailable, with its reason', () => {
    for (const [status, reason] of [
      ['offline', 'offline'],
      ['auth_expired', 'authExpired'],
      ['stopped', 'stopped'],
    ] as const) {
      const b = bot(4, 0, null, { state: { ...bot(4, 0, null).state, status } } as Partial<BotRow>);
      expect(botSlot(b, 'metrics', null, ctx)).toEqual(unavailable(reason));
    }
  });

  it('open positions without a price: unavailable (prices), counting the positions', () => {
    const b = bot(5, 4, null);
    expect(botSlot(b, 'positions', null, { ...ctx, prices: true })).toEqual(
      unavailable('prices', 4),
    );
    // Without open positions the same gap is only "still being computed"
    expect(botSlot(bot(6, 0, null), 'positions', null, { ...ctx, prices: true })).toEqual(PENDING);
  });

  it('a group received but stale says stale; a settled group says its own reason', () => {
    const stale = bot(7, 1, null, {
      freshness: {
        state: bot(7, 1, null).freshness.state,
        positions: { as_of_ms: 0, source: 'rest', stale: true },
      },
    });
    expect(botSlot(stale, 'positions', null, ctx)).toEqual(unavailable('stale'));
    expect(botSlot(bot(8, 1, null), 'capital', null, { ...ctx, settled: 'capital' })).toEqual(
      unavailable('capital'),
    );
  });
});

describe('aggregateSlot: a sum is only a figure when something contributes', () => {
  const sum = (bots: BotRow[]) =>
    aggregateSlot({
      bots,
      pick: (b) => b.metrics.open_profit_abs,
      group: 'positions',
      hasValue: true,
      prices: true,
      ...ctx,
    });

  it('none excluded: ready', () => {
    expect(sum([bot(10, 2, 5), bot(11, 3, -2)])).toEqual(READY);
  });

  it('nothing open: a true zero, ready', () => {
    expect(sum([bot(12, 0, 0), bot(13, 0, 0)])).toEqual(READY);
  });

  it('some excluded: the partial sum stays a figure (with its "N excluded" counter)', () => {
    expect(sum([bot(14, 2, 5), bot(15, 3, null)])).toEqual(READY);
  });

  it('all open positions excluded: unavailable, never 0.00, even next to a bot with nothing open', () => {
    expect(sum([bot(16, 2, null), bot(17, 3, null), bot(18, 0, 0)])).toEqual(
      unavailable('prices', 5),
    );
  });

  it('while no bot was read the sum is pending, not unavailable', () => {
    const starting = (n: number) =>
      bot(n, 0, null, {
        state: { ...bot(n, 0, null).state, status: 'starting' },
      } as Partial<BotRow>);
    expect(sum([starting(19), starting(23)])).toEqual(PENDING);
  });

  it('a bot that never answers does not hold back the verdict on the unpriced positions of the others', () => {
    const starting = bot(24, 0, null, {
      state: { ...bot(24, 0, null).state, status: 'starting' },
    } as Partial<BotRow>);
    expect(sum([bot(20, 2, null), starting])).toEqual(unavailable('prices', 2));
  });

  it('every bot silent: the reason is theirs', () => {
    const off = (n: number) =>
      bot(n, 2, null, {
        state: { ...bot(n, 2, null).state, status: 'offline' },
      } as Partial<BotRow>);
    expect(sum([off(21), off(22)])).toEqual(unavailable('offline'));
  });
});

describe('positions and lines', () => {
  it('a loaded position never "loads": a missing price says prices, a stale one says stale', () => {
    const b = bot(30, 1, 1);
    const p = makePosition(b, 'BTC/USDC:USDC', 1, 'long', 0.5);
    expect(positionSlot(p, 12)).toEqual(READY);
    expect(positionSlot(p, null)).toEqual(unavailable('prices', 1));
    expect(positionSlot({ freshness: { stale: true } }, null)).toEqual(unavailable('stale'));
  });

  it('a closed trade gap is "not recorded", not "prices"', () => {
    expect(lineSlot({ open: false, stale: false }, null)).toEqual(unavailable('noData'));
    expect(lineSlot({ open: false, stale: false }, null, 'profit')).toEqual(unavailable('profit'));
    expect(lineSlot({ open: true, stale: false }, null)).toEqual(unavailable('prices', 1));
  });
});

describe('fleet KPI strip: the latent profit is never a made up 0.00 (P&L latent, owner report)', () => {
  const sumOpen = (bots: BotRow[]) =>
    bots.reduce((a, b) => a + (b.metrics.open_profit_abs ?? 0), 0);

  it('none excluded: every figure is there', () => {
    const bots = [bot(40, 2, 12.5), bot(41, 1, -3.25), bot(42, 0, 0)];
    const m = kpis(detailOf(bots, () => true));
    expect(m.slots.openProfit).toEqual(READY);
    expect(m.openProfit).toBeCloseTo(sumOpen(bots), 6);
    expect(m.equityOpen).not.toBeNull();
    expect(m.slots.equityOpen).toEqual(READY);
    expect(m.drawdown).not.toBeNull();
    expect(m.slots.drawdown).toEqual(READY);
    expect(m.marginPct).not.toBeNull();
    expect(m.slots.margin).toEqual(READY);
    expect(m.slots.exposure).toEqual(READY);
    expect(m.excluded).toEqual([]);
  });

  it('some excluded: the partial sum is shown and the unpriced bots are listed as excluded', () => {
    const priced = bot(43, 2, 8);
    const blind = bot(44, 3, null);
    const m = kpis(detailOf([priced, blind], (b) => b === priced));
    expect(m.slots.openProfit).toEqual(READY);
    expect(m.openProfit).toBeCloseTo(8, 6);
    expect(m.excluded).toContain(blind.bot_key);
    expect(m.excluded).not.toContain(priced.bot_key);
    expect(m.slots.equityOpen).toEqual(READY);
    expect(m.slots.drawdown).toEqual(READY);
  });

  it('all excluded (the exchange ticker is blocked): unavailable, with 0 nowhere', () => {
    // The fleet of the owner: bots hold positions, current_rate and profit_abs are null, and a
    // few bots hold nothing, so the sources' sum is a clean 0 over the bots left in
    const bots = [bot(45, 4, null), bot(46, 3, null), bot(47, 0, 0), bot(48, 0, 0)];
    const d = detailOf(bots, () => false);
    expect(d.totals[0]!.open_profit_abs).toBe(0);
    const m = kpis(d);
    expect(m.slots.openProfit).toEqual(unavailable('prices', 7));
    expect(m.openProfit).toBeNull();
    // Equity with open positions and drawdown with open positions need the prices too
    expect(m.slots.equityOpen).toEqual(unavailable('prices', 7));
    expect(m.equityOpen).toBeNull();
    expect(m.slots.drawdown).toEqual(unavailable('prices', 7));
    expect(m.drawdown).toBeNull();
    // What does not need a price stays: realized equity, margin (stakes), exposure (notionals)
    expect(m.equityRealized).not.toBeNull();
    expect(m.slots.margin).toEqual(READY);
    expect(m.marginPct).toBeGreaterThan(0);
    expect(m.slots.exposure).toEqual(READY);
  });

  it('nothing open anywhere: the latent profit is a true zero, not a gap', () => {
    const m = kpis(detailOf([bot(49, 0, 0), bot(50, 0, 0)], () => true));
    expect(m.slots.openProfit).toEqual(READY);
    expect(m.openProfit).toBe(0);
  });

  it('bots not read yet: pending everywhere a figure is missing', () => {
    const unread = (n: number) =>
      bot(n, 0, null, {
        state: { ...bot(n, 0, null).state, status: 'starting' },
        freshness: {},
        metrics: {
          ...bot(n, 0, null).metrics,
          realized_1d: null,
          realized_30d: null,
          realized_total: null,
          starting_capital: null,
          exposure_long: null,
          exposure_short: null,
          drawdown_with_open: null,
        },
      } as Partial<BotRow>);
    const d = detailOf([unread(51), unread(52)], () => true);
    const m = fleetKpiModel(d.totals[0]!, { ...d, drawdown: null }, FIXTURE_NOW, 0);
    for (const k of ['openProfit', 'realized1d', 'realized30d', 'exposure'] as const) {
      expect(m.slots[k], k).toEqual(PENDING);
    }
    expect(m.slots.equityOpen).toEqual(PENDING);
    expect(m.slots.capital).toEqual(PENDING);
    expect(m.openProfit).toBeNull();
    expect(m.realized1d).toBeNull();
  });
});
