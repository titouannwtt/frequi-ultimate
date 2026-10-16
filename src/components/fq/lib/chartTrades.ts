/**
 * What the Charts page draws about a trade, apart from the candles: the framing of the open
 * position, the orders that wait, the current gain and the closed trades of the pair. Pure
 * builders from the rows the data sources already give (orders of a trade, positions, closed
 * trades of the Journal): no label is translated here, no figure is invented, a row that lacks a
 * price or a time is dropped instead of guessed.
 */
import type { OrderRow } from '@/datasource/types';
import type { Position, Side, TradeRow } from '@/gateway/types.gen';

import type { ClosedMark, GainMark, PendingKind, PendingOrder } from './candles';

// ---- framing ----

/** The window is widened to show the entry up to this many candles; beyond, the edge marker shows. */
export const FRAME_MAX_CANDLES = 500;
const FRAME_MIN_MARGIN = 6;
const FRAME_MARGIN_SHARE = 0.12;

export interface Frame {
  /** Candles to show at first (the end of the zoom window). */
  visible: number;
  /** The open date is inside that window. */
  framed: boolean;
}

/**
 * Candles to show so that the open date of the position is in the window, with a margin before it.
 * Never fewer than `base` (the user's default). Past `max` candles the window stays at `base` and
 * the entry is reached by the edge marker. Without an open date or a candle size it stays at `base`.
 */
export function frameCandles(o: {
  openTs: number | null | undefined;
  lastTs: number | null | undefined;
  timeframeMs: number;
  base: number;
  max?: number;
}): Frame {
  const { openTs, lastTs, timeframeMs, base } = o;
  const max = o.max ?? FRAME_MAX_CANDLES;
  if (
    openTs == null ||
    lastTs == null ||
    !Number.isFinite(openTs) ||
    !Number.isFinite(lastTs) ||
    openTs <= 0 ||
    !(timeframeMs > 0)
  ) {
    return { visible: base, framed: false };
  }
  const span = Math.max(0, Math.ceil((lastTs - openTs) / timeframeMs));
  const needed = span + Math.max(FRAME_MIN_MARGIN, Math.ceil(span * FRAME_MARGIN_SHARE));
  if (needed > max) return { visible: base, framed: needed <= base };
  return { visible: Math.max(base, needed), framed: true };
}

export interface EntryEdge {
  /** How long ago the position was opened, in ms. */
  ageMs: number;
}

/**
 * The edge marker "entered N h ago": shown when the open date is left of the window that is on
 * screen. `windowStartTs` is the time of the first visible candle.
 */
export function entryEdge(
  openTs: number | null | undefined,
  windowStartTs: number | null | undefined,
  nowMs: number,
): EntryEdge | null {
  if (openTs == null || windowStartTs == null || !Number.isFinite(openTs) || openTs <= 0) {
    return null;
  }
  if (!Number.isFinite(windowStartTs) || openTs >= windowStartTs) return null;
  return { ageMs: Math.max(0, nowMs - openTs) };
}

/**
 * The window to jump to when the edge marker is clicked: the entry a fifth into the window, the
 * window keeping the width the user has. Clamped to the loaded candles (an entry older than the
 * first candle goes to the first one).
 */
export function recentreOn(o: {
  openTs: number;
  firstTs: number;
  lastTs: number;
  spanMs: number;
}): { startTs: number; endTs: number } {
  const span = Math.min(Math.max(o.spanMs, 1), Math.max(o.lastTs - o.firstTs, 1));
  let start = Math.max(o.firstTs, o.openTs - span * 0.2);
  let end = start + span;
  if (end > o.lastTs) {
    end = o.lastTs;
    start = Math.max(o.firstTs, end - span);
  }
  return { startTs: start, endTs: end };
}

// ---- orders that wait ----

const finitePrice = (v: number | null | undefined): v is number =>
  v != null && Number.isFinite(v) && v > 0;

const isEntryRow = (o: OrderRow, side: Side): boolean =>
  o.side !== 'stoploss' && (o.is_entry ?? o.side === (side === 'short' ? 'sell' : 'buy'));

const isFilledRow = (o: OrderRow): boolean =>
  !o.is_open && (o.filled != null ? o.filled > 0 : o.status === 'closed');

/** Rows that still wait on the exchange. */
export const openRows = (rows: readonly OrderRow[]): OrderRow[] => rows.filter((o) => o.is_open);

/**
 * The orders that wait, as lines on the chart. `rows` are the orders of the trade; an open order
 * whose price is unknown (the gateway ledger does not carry the limit price) is left out here and
 * can be completed by `rows` from the bot's own answer. A limit order that closes the position is
 * a take profit when it sits on the profit side of the average entry, a plain exit otherwise.
 */
export function pendingOrders(
  rows: readonly OrderRow[],
  side: Side,
  average: number | null | undefined,
): PendingOrder[] {
  const filledEntries = rows.filter((o) => isEntryRow(o, side) && isFilledRow(o)).length;
  const out: PendingOrder[] = [];
  let rank = 0;
  for (const o of openRows(rows)) {
    const price = finitePrice(o.price) ? o.price : finitePrice(o.average) ? o.average : null;
    if (price === null) continue;
    let kind: PendingKind;
    let n: number | undefined;
    if (o.side === 'stoploss') {
      kind = 'stop';
    } else if (isEntryRow(o, side)) {
      // The entry that has not filled yet is the entry; after it, a safety order (R1, R2...)
      kind = filledEntries === 0 ? 'entry' : 'dca';
      if (kind === 'dca') n = filledEntries + rank;
      rank += 1;
    } else if (finitePrice(average)) {
      kind = (side === 'short' ? price < average : price > average) ? 'tp' : 'exit';
    } else {
      kind = 'exit';
    }
    out.push({ id: `p${o.id}`, price, kind, n, amount: o.amount ?? o.filled ?? null });
  }
  return out;
}

// ---- current gain ----

/**
 * Gain of the open position at the current price. The price is the bot's `current_rate`, or the
 * last close when the position has none. Null when the position has neither a profit nor a price:
 * nothing is drawn rather than a made-up figure.
 */
export function gainFromPosition(
  position: Pick<
    Position,
    'open_rate' | 'current_rate' | 'profit_abs' | 'profit_ratio' | 'open_ms'
  > | null,
  lastClose: number | null,
): GainMark | null {
  if (!position) return null;
  const abs = Number.isFinite(position.profit_abs as number)
    ? (position.profit_abs as number)
    : null;
  const ratio = Number.isFinite(position.profit_ratio as number)
    ? (position.profit_ratio as number)
    : null;
  if (abs === null && ratio === null) return null;
  const price = finitePrice(position.current_rate)
    ? position.current_rate
    : finitePrice(lastClose)
      ? lastClose
      : null;
  return {
    price,
    entry: finitePrice(position.open_rate) ? position.open_rate : null,
    sinceTs: position.open_ms > 0 ? position.open_ms : null,
    profitAbs: abs,
    profitPct: ratio === null ? null : ratio * 100,
  };
}

// ---- closed trades ----

/** Exit reason of a closed trade as text: the strategy's own words for a custom one. */
export type ReasonText = (r: TradeRow['exit_reason']) => string;

/**
 * Closed trades of one pair as marks. A trade with an unknown time or price is dropped; one whose
 * profit is unknown is kept, without a result colour. Open trades (no close) are not closed trades.
 */
export function closedMarks(
  trades: readonly TradeRow[],
  pair: string,
  reasonText: ReasonText,
): ClosedMark[] {
  const out: ClosedMark[] = [];
  for (const t of trades) {
    if (t.pair !== pair || t.close_ms == null || !(t.open_ms > 0)) continue;
    if (!finitePrice(t.open_rate) || !finitePrice(t.close_rate)) continue;
    const known = !t.profit_unknown && t.profit_abs != null && Number.isFinite(t.profit_abs);
    const ratio = known && t.profit_ratio != null && Number.isFinite(t.profit_ratio);
    out.push({
      id: `${t.bot_key}/${t.trade_id}`,
      side: t.side,
      openTs: t.open_ms,
      openPrice: t.open_rate,
      closeTs: t.close_ms,
      closePrice: t.close_rate,
      profitAbs: known ? (t.profit_abs as number) : null,
      profitPct: ratio ? (t.profit_ratio as number) * 100 : null,
      exitReason: t.exit_reason.kind === 'unknown' ? '' : reasonText(t.exit_reason),
    });
  }
  return out.sort((a, b) => a.closeTs - b.closeTs);
}

/**
 * The part of a closed trade that falls in `[fromTs, toTs]`: its segment is cut at the edges of the
 * loaded candles (a marker is only kept where its own time is inside), or null when none of it is.
 */
export function visibleClosed(
  m: ClosedMark,
  fromTs: number,
  toTs: number,
): {
  a: [number, number];
  b: [number, number];
  showOpen: boolean;
  showClose: boolean;
} | null {
  if (m.closeTs < fromTs || m.openTs > toTs) return null;
  const at = (t: number): number => {
    if (m.closeTs === m.openTs) return m.openPrice;
    return m.openPrice + ((m.closePrice - m.openPrice) * (t - m.openTs)) / (m.closeTs - m.openTs);
  };
  const t0 = Math.max(m.openTs, fromTs);
  const t1 = Math.min(m.closeTs, toTs);
  return {
    a: [t0, at(t0)],
    b: [t1, at(t1)],
    showOpen: m.openTs >= fromTs,
    showClose: m.closeTs <= toTs,
  };
}

/** A closed trade made money: null when its result is unknown. */
export const markWin = (m: Pick<ClosedMark, 'profitAbs'>): boolean | null =>
  m.profitAbs === null ? null : m.profitAbs > 0;
