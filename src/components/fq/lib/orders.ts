/**
 * From the orders of a trade to what the drawer and the chart draw (02 sections 3.2 and 5.1): the
 * ladder levels (entry first, then SO1...), the fills at their real execution price and time, and
 * the number of orders still waiting. Pure. Nothing is invented: a missing price or time drops the
 * level or the marker instead of guessing one.
 */
import type { LadderOrder } from '@/components/ds';
import type { OrderRow } from '@/datasource/types';
import type { Side } from '@/gateway/types.gen';

import type { FillMark } from './candles';

export interface OrderModel {
  /** Entry orders in execution order, as ladder rows. */
  ladder: LadderOrder[];
  /** Executions with their time, entries and exits. */
  fills: FillMark[];
  filled: number;
  pending: number;
}

const isEntry = (o: OrderRow, side: Side): boolean =>
  o.is_entry ?? o.side === (side === 'short' ? 'sell' : 'buy');

const priceOf = (o: OrderRow): number | null =>
  o.average != null && Number.isFinite(o.average) && o.average > 0 ? o.average : null;

const isFilled = (o: OrderRow): boolean =>
  !o.is_open && (o.filled != null ? o.filled > 0 : o.status === 'closed');

/**
 * Rank of a safety order from its ladder label ("SO2" is 2); null for the entry ("E") and for a
 * label that is not a ladder one. The label stays a stable identifier, what the owner reads is
 * "Renfort 2": the surfaces translate it from this rank.
 */
export function refillRank(label: string): number | null {
  const m = /^SO(\d+)$/.exec(label);
  return m ? Number(m[1]) : null;
}

/** "1-2" for consecutive ranks, "1, 3" otherwise: the numbers of merged top-ups in one label. */
export function rankRange(ranks: readonly number[]): string {
  const r = [...new Set(ranks)].sort((a, b) => a - b);
  if (r.length <= 1) return r.map(String).join('');
  const consecutive = r.every((v, i) => i === 0 || v === r[i - 1]! + 1);
  return consecutive ? `${r[0]}-${r[r.length - 1]}` : r.join(', ');
}

export function orderModel(rows: readonly OrderRow[], side: Side): OrderModel {
  const entries = rows
    .filter((o) => isEntry(o, side) && o.side !== 'stoploss')
    .slice()
    .sort((a, b) => (a.filled_ms ?? Infinity) - (b.filled_ms ?? Infinity) || a.id - b.id);

  const ladder: LadderOrder[] = [];
  let nextMarked = false;
  entries.forEach((o, i) => {
    const price = priceOf(o);
    if (price === null) return;
    const done = isFilled(o);
    // The first order that is not filled is the next one; the following ones are only planned
    const state = done ? 'filled' : nextMarked ? 'pending' : 'next';
    if (!done) nextMarked = true;
    ladder.push({
      id: `o${o.id}`,
      label: i === 0 ? 'E' : `SO${i}`,
      price,
      stake: o.cost ?? 0,
      state,
    });
  });

  const fills: FillMark[] = [];
  rows.forEach((o) => {
    if (!isFilled(o) || o.filled_ms == null) return;
    const price = priceOf(o);
    if (price === null || o.side === 'stoploss') return;
    if (isEntry(o, side)) {
      const idx = entries.indexOf(o);
      fills.push({
        ts: o.filled_ms,
        price,
        kind: idx === 0 ? 'entry' : 'dca',
        side,
        label: idx === 0 ? 'E' : `SO${idx}`,
        n: idx > 0 ? idx : undefined,
        amount: o.filled ?? o.amount ?? null,
        cost: o.cost ?? null,
      });
    } else {
      fills.push({
        ts: o.filled_ms,
        price,
        kind: 'exit',
        side,
        label: 'S',
        amount: o.filled ?? o.amount ?? null,
        cost: o.cost ?? null,
      });
    }
  });
  fills.sort((a, b) => a.ts - b.ts);

  const filled = entries.filter(isFilled).length;
  return { ladder, fills, filled, pending: entries.length - filled };
}
