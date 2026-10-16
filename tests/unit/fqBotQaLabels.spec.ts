import { describe, expect, it } from 'vitest';

import {
  ALL_OVERLAYS,
  fillTags,
  levelLines,
  planLevelLabels,
  LABEL_H,
  type CandleOptionInput,
} from '@/components/fq/lib/candles';
import { waitingLevels } from '@/components/fq/lib/chartTrades';
import { rankRange, refillRank } from '@/components/fq/lib/orders';
import type { OrderRow } from '@/datasource/types';

const tokens = new Proxy({}, { get: (_t, k) => `#${String(k)}` }) as CandleOptionInput['tokens'];
const labels = {
  average: 'Entrée moy.',
  tp: 'Sortie visée',
  liquidation: 'Liquidation',
  refill: 'Renfort',
  refills: 'Renforts',
};
const price = (v: number) => v.toFixed(3);

describe('top-ups are named in words, never SO1', () => {
  it('reads the rank of a ladder label', () => {
    expect(refillRank('SO2')).toBe(2);
    expect(refillRank('E')).toBeNull();
    expect(refillRank('S')).toBeNull();
  });

  it('writes "Renfort 2" on the chart line', () => {
    const l = levelLines(
      {
        safetyOrders: [
          { price: 12, state: 'filled', label: 'SO1' },
          { price: 11, state: 'next', label: 'SO2' },
        ],
      },
      ALL_OVERLAYS,
      tokens,
      labels,
    );
    expect(l.map((x) => x.label)).toEqual(['Renfort 1', 'Renfort 2']);
  });

  it('ranks read as a range when they follow each other', () => {
    expect(rankRange([1, 2])).toBe('1-2');
    expect(rankRange([1, 3])).toBe('1, 3');
    expect(rankRange([2])).toBe('2');
  });
});

describe('level labels never write over each other', () => {
  const so = (n: number, p: number) => ({
    id: `so:SO${n}`,
    price: p,
    label: `Renfort ${n}`,
    side: 'start' as const,
    rank: n,
  });

  it('two top-ups at the same price are one label', () => {
    const plan = planLevelLabels([so(1, 12.456), so(2, 12.456)], price, { refills: 'Renforts' });
    expect(plan['so:SO1']!.text).toBe('Renforts 1-2 12.456');
    expect(plan['so:SO2']!.hide).toBe(true);
  });

  it('a line alone keeps its default text', () => {
    const plan = planLevelLabels([so(1, 12)], price, { refills: 'Renforts' });
    expect(plan['so:SO1']!.text).toBeUndefined();
    expect(plan['so:SO1']!.hide).toBeUndefined();
  });

  it('labels of lines a few pixels apart are stacked, not overlaid', () => {
    const geo = { lo: 0, hi: 100, top: 0, height: 200 };
    const lines = [
      { id: 'a', price: 50, label: 'A', side: 'end' as const },
      { id: 'b', price: 49.5, label: 'B', side: 'end' as const },
      { id: 'c', price: 49, label: 'C', side: 'end' as const },
    ];
    const plan = planLevelLabels(lines, price, {}, geo);
    const y = (id: string, price_: number) =>
      ((geo.hi - price_) / (geo.hi - geo.lo)) * geo.height - LABEL_H - 1 + plan[id]!.dy;
    const tops = [y('a', 50), y('b', 49.5), y('c', 49)].sort((p, q) => p - q);
    expect(tops[1]! - tops[0]!).toBeGreaterThanOrEqual(LABEL_H);
    expect(tops[2]! - tops[1]!).toBeGreaterThanOrEqual(LABEL_H);
  });

  it('labels far apart are left where they are', () => {
    const geo = { lo: 0, hi: 100, top: 0, height: 400 };
    const plan = planLevelLabels(
      [
        { id: 'a', price: 80, label: 'A', side: 'end' },
        { id: 'b', price: 20, label: 'B', side: 'end' },
      ],
      price,
      {},
      geo,
    );
    expect(plan['a']!.dy).toBe(0);
    expect(plan['b']!.dy).toBe(0);
  });

  it('the ladder side and the position side do not push each other', () => {
    const geo = { lo: 0, hi: 100, top: 0, height: 200 };
    const plan = planLevelLabels(
      [
        { id: 'a', price: 50, label: 'A', side: 'start' },
        { id: 'b', price: 50.2, label: 'B', side: 'end' },
      ],
      price,
      {},
      geo,
    );
    expect(plan['a']!.dy).toBe(0);
    expect(plan['b']!.dy).toBe(0);
  });
});

describe('execution tags', () => {
  const f = (n: number, ts: number, p: number) => ({
    ts,
    price: p,
    kind: 'dca' as const,
    label: `SO${n}`,
    n,
  });
  it('top-ups at the same time and price share one tag', () => {
    expect(fillTags([f(1, 1000, 5), f(2, 1000, 5)], 'R', 900_000)).toEqual(['R1-2', null]);
  });
  it('top-ups far apart in time keep their own tag', () => {
    expect(fillTags([f(1, 0, 5), f(2, 10_000_000, 5)], 'R', 900_000)).toEqual(['R1', 'R2']);
  });
  it('the entry and the exits keep E and S', () => {
    const tags = fillTags(
      [
        { ts: 0, price: 5, kind: 'entry', label: 'E' },
        { ts: 1, price: 5, kind: 'exit', label: 'S' },
      ],
      'R',
      900_000,
    );
    expect(tags).toEqual(['E', 'S']);
  });
});

describe('the levels the drawer says come from the orders that wait', () => {
  const row = (id: number, side: string, p: number | null): OrderRow => ({
    id,
    side,
    is_entry: side === 'buy',
    status: 'open',
    is_open: true,
    filled: 0,
    amount: 1,
    average: null,
    cost: null,
    filled_ms: null,
    tag: null,
    price: p,
  });
  const filledEntry: OrderRow = {
    ...row(1, 'buy', null),
    is_open: false,
    status: 'closed',
    filled: 1,
    average: 100,
  };

  it('gives the take profit and the next top-up of a long', () => {
    const l = waitingLevels(
      [filledEntry, row(2, 'sell', 103), row(3, 'buy', 97), row(4, 'buy', 94)],
      'long',
      100,
      99,
    );
    expect(l).toEqual({ tp: 103, nextRefill: 97 });
  });

  it('gives nothing when no waiting order has a price (never invented)', () => {
    expect(waitingLevels([filledEntry, row(2, 'sell', null)], 'long', 100, 99)).toEqual({
      tp: null,
      nextRefill: null,
    });
  });
});
