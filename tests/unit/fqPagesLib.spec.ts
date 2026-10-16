import { describe, expect, it } from 'vitest';

import { makeFixture, scopeDetailOf, FIXTURE_NOW } from '@/components/fq/fixtures';
import { fleetKpiModel } from '@/components/fq/lib/kpis';
import { orderModel } from '@/components/fq/lib/orders';
import { scopeTotalsByMode } from '@/datasource/calc/scopeTotals';
import { pageTradeRows } from '@/datasource/calc/tradePage';
import { parseSnapshot } from '@/datasource/gateway/snapshot';
import type { OrderRow } from '@/datasource/types';
import type { DrawdownResult, TradeRow } from '@/gateway/types.gen';

const f = makeFixture(40);
const detail = scopeDetailOf(f, { kind: 'fleet' });

describe('fleetKpiModel', () => {
  it('makes one model per mode and never adds live and dry', () => {
    const live = detail.totals.find((t) => t.mode === 'live')!;
    const dry = detail.totals.find((t) => t.mode === 'dry')!;
    const a = fleetKpiModel(live, detail, FIXTURE_NOW, 0);
    const b = fleetKpiModel(dry, detail, FIXTURE_NOW, 0);
    expect(a.mode).toBe('live');
    expect(b.mode).toBe('dry');
    expect(a.total + b.total).toBe(detail.bots.filter((x) => x.identity.mode !== 'replay').length);
    expect(a.openProfit).toBe(live.open_profit_abs);
  });

  it('equity is the starting capital plus the realized profit, not a wallet balance', () => {
    const live = detail.totals.find((t) => t.mode === 'live')!;
    const m = fleetKpiModel(live, detail, FIXTURE_NOW, 0);
    expect(m.equityRealized).toBe(live.starting_capital.total + (live.realized_total ?? 0));
    expect(m.equityOpen).toBe((m.equityRealized as number) + (live.open_profit_abs ?? 0));
  });

  it('has no equity when no capital is known', () => {
    const live = {
      ...detail.totals.find((t) => t.mode === 'live')!,
      starting_capital: { total: 0, known: 0, unknown: 3 },
    };
    const m = fleetKpiModel(live, detail, FIXTURE_NOW, 0);
    expect(m.equityRealized).toBeNull();
    expect(m.marginPct).toBeNull();
    expect(m.capitalUnknown).toBe(3);
  });

  it('the margin is unknown while the positions the bots announce are not read (B234)', () => {
    const live = detail.totals.find((t) => t.mode === 'live')!;
    const liveKeys = new Set(
      detail.bots
        .filter((b) => b.identity.mode === 'live' && b.state.status === 'online')
        .map((b) => b.bot_key),
    );
    // Consistent book: every announced position is there
    const bots = detail.bots.map((b) => ({
      ...b,
      state: {
        ...b.state,
        open_trades: detail.positions.filter((p) => p.bot_key === b.bot_key && !p.orphan).length,
      },
    }));
    const whole = { ...detail, bots };
    expect(fleetKpiModel(live, whole, FIXTURE_NOW, 0).marginPct).not.toBeNull();
    // Positions announced, none read: not "0,0 %"
    const unread = { ...whole, positions: whole.positions.filter((p) => !liveKeys.has(p.bot_key)) };
    expect(liveKeys.size).toBeGreaterThan(0);
    expect(fleetKpiModel(live, unread, FIXTURE_NOW, 0).marginPct).toBeNull();
  });

  it('takes the drawdown of the block when the source gives one per mode', () => {
    const dd: DrawdownResult = {
      realized: { abs: 1, pct: 0.01, peak_ms: null, trough_ms: null, current_abs: 0 },
      with_open: { abs: 77, pct: 0.5, peak_ms: null, trough_ms: null, current_abs: 0 },
      open_worst_sum: 0,
      has_open: true,
      base: 100,
    };
    const live = { ...detail.totals.find((t) => t.mode === 'live')!, drawdown: dd };
    expect(fleetKpiModel(live, detail, FIXTURE_NOW, 0).drawdown?.abs).toBe(77);
    // A block without its own falls back on the detail's, for the first block only.
    const dry = detail.totals.find((t) => t.mode === 'dry')!;
    expect(fleetKpiModel(dry, detail, FIXTURE_NOW, 0, false).drawdown).toBeNull();
    expect(fleetKpiModel(dry, detail, FIXTURE_NOW, 0, true).drawdown?.abs).toBe(412);
  });

  it('lists the excluded bots of the block', () => {
    const live = { ...detail.totals.find((t) => t.mode === 'live')!, excluded: ['local:1'] };
    expect(fleetKpiModel(live, detail, FIXTURE_NOW, 0).excluded).toEqual(['local:1']);
  });
});

describe('scopeTotalsByMode', () => {
  it('counts the stale bots out of the sums and lists them', () => {
    const bots = detail.bots
      .filter((b) => b.identity.mode === 'live')
      .map((b) => structuredClone(b));
    const victim = bots[0]!;
    victim.freshness = {
      ...victim.freshness,
      metrics: { as_of_ms: 0, source: 'rest', stale: true },
    };
    const [live] = scopeTotalsByMode(bots, [], (k) => k);
    expect(live!.excluded).toContain(victim.bot_key);
    const fresh = bots
      .filter((b) => !b.freshness.metrics?.stale)
      .reduce((a, b) => a + (b.metrics.realized_30d ?? 0), 0);
    expect(live!.realized_30d).toBeCloseTo(fresh, 6);
  });

  it('nets the exposure per coin at wallet level', () => {
    const [a, b] = detail.bots.filter((x) => x.identity.mode === 'live');
    const mk = (bot: string, side: 'long' | 'short') =>
      ({ ...f.positions[0]!, bot_key: bot, coin: 'BTC', side, notional: 100 }) as never;
    const shared = scopeTotalsByMode(
      [a!, b!],
      [mk(a!.bot_key, 'long'), mk(b!.bot_key, 'short')],
      () => 'w',
    );
    const alone = scopeTotalsByMode(
      [a!, b!],
      [mk(a!.bot_key, 'long'), mk(b!.bot_key, 'short')],
      (k) => k,
    );
    expect(shared[0]!.exposure.gross_netted).toBe(0);
    expect(alone[0]!.exposure.gross_netted).toBe(200);
  });
});

describe('pageTradeRows', () => {
  const row = (id: number, profit: number | null, close: number): TradeRow =>
    ({
      bot_key: 'local:1',
      trade_id: id,
      pair: id % 2 ? 'A' : 'B',
      side: 'long',
      open_ms: close - 10,
      close_ms: close,
      profit_abs: profit,
      profit_unknown: profit === null,
      exit_reason: { raw: 'roi', kind: 'roi', class: 'profit' },
    }) as unknown as TradeRow;

  it('sorts, pages with an offset cursor and totals the whole filtered set', () => {
    const rows = [row(1, 5, 100), row(2, -2, 200), row(3, null, 300), row(4, 1, 400)];
    const p1 = pageTradeRows(rows, { status: 'closed', limit: 2 }, true);
    expect(p1.items.map((r) => r.trade_id)).toEqual([4, 3]);
    expect(p1.nextCursor).toBe('2');
    expect(p1.totals).toMatchObject({ count: 3, unknown: 1, sum: 4 });
    const p2 = pageTradeRows(rows, { status: 'closed', limit: 2, cursor: p1.nextCursor }, true);
    expect(p2.items.map((r) => r.trade_id)).toEqual([2, 1]);
    expect(p2.nextCursor).toBeNull();
  });

  it('filters by pair and says when the history is partial', () => {
    const rows = [row(1, 5, 100), row(2, -2, 200)];
    const p = pageTradeRows(rows, { status: 'closed', pair: 'B' }, false);
    expect(p.items.map((r) => r.trade_id)).toEqual([2]);
    expect(p.complete).toBe(false);
  });
});

describe('orderModel', () => {
  const o = (id: number, p: Partial<OrderRow>): OrderRow => ({
    id,
    side: 'buy',
    is_entry: true,
    status: 'closed',
    is_open: false,
    filled: 1,
    amount: 1,
    average: 100 - id,
    cost: 10,
    filled_ms: 1000 * id,
    tag: null,
    ...p,
  });

  it('numbers the entries E, SO1... and marks the first unfilled one as next', () => {
    const m = orderModel(
      [
        o(1, {}),
        o(2, {}),
        o(3, { status: 'open', is_open: true, filled: 0, filled_ms: null }),
        o(4, { status: 'open', is_open: true, filled: 0, filled_ms: null }),
      ],
      'long',
    );
    expect(m.ladder.map((l) => [l.label, l.state])).toEqual([
      ['E', 'filled'],
      ['SO1', 'filled'],
      ['SO2', 'next'],
      ['SO3', 'pending'],
    ]);
    expect([m.filled, m.pending]).toEqual([2, 2]);
    expect(m.fills.map((x) => x.kind)).toEqual(['entry', 'dca']);
  });

  it('draws the exit at its real price and time, and invents nothing without a price', () => {
    const m = orderModel(
      [
        o(1, {}),
        o(2, { side: 'sell', is_entry: false, average: 120, filled_ms: 9000 }),
        o(3, { average: null }),
      ],
      'long',
    );
    expect(m.fills.at(-1)).toMatchObject({ kind: 'exit', price: 120, ts: 9000 });
    expect(m.ladder).toHaveLength(1);
  });

  it('leaves the stop-loss order out of the ladder', () => {
    const m = orderModel([o(1, {}), o(2, { side: 'stoploss', is_entry: false })], 'long');
    expect(m.ladder).toHaveLength(1);
  });
});

describe('parseSnapshot, the shape the gateway really answers', () => {
  it('reads `channels[name].collections` and its own sequence number', () => {
    const body = {
      ts: 5,
      channels: {
        fleet: {
          seq: 12,
          collections: { bots: { 'local:1': { bot_key: 'local:1' } }, wallets: {} },
        },
        positions: { seq: 3, collections: { positions: { 'local:1/1': {} } } },
      },
    };
    const r = parseSnapshot(body, undefined, ['fleet', 'positions']);
    expect(r.seq).toEqual({ fleet: 12, positions: 3 });
    expect(Object.keys(r.byChannel.fleet!.bots!)).toEqual(['local:1']);
    expect(Object.keys(r.byChannel.positions!.positions!)).toEqual(['local:1/1']);
  });
});
