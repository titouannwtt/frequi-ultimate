/**
 * Candle history of the chart beyond what a bot serves: the local OHLCV pages of the gateway
 * (`query.candles`), merged into the set the chart draws. Pure builders: no request, no
 * translation. A bot only serves the candles of its strategy timeframe and nothing older than its
 * window, so a timeframe change and the "load previous candles" button read these pages instead.
 */
import type { CandlesPage } from '@/datasource/types';

import { DATE_COL, type CandleSet, type Overlays } from './candles';

/** Candles per page of history. */
export const OLDER_PAGE = 1000;
/** Candles kept before the open of the trade once it is covered. */
export const COVER_MARGIN = 30;
/** Memory ceiling of one chart: no page is asked beyond it. */
export const MAX_CANDLES = 20_000;

const LOCAL_COLUMNS = [DATE_COL, 'open', 'high', 'low', 'close', 'volume'] as const;

/** The candles of a page as a set of the shape the chart reads (time, OHLCV). */
export function setFromPage(page: Pick<CandlesPage, 'candles'>, timeframeMs: number): CandleSet {
  const rows: Array<Array<number | null>> = [];
  let last = -Infinity;
  for (const c of page.candles) {
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || c[0] <= last) continue;
    last = c[0];
    rows.push([c[0], c[1], c[2], c[3], c[4], c[5]].map((v) => (Number.isFinite(v) ? v : null)));
  }
  return { columns: [...LOCAL_COLUMNS], rows, timeframeMs };
}

/**
 * Older candles put in front of the set, by time: only those strictly before the first candle of
 * the set are kept, in increasing order, without a twin. The columns of the set are kept (the
 * indicators of a bot are empty on the older rows). Returns the set itself when nothing is added.
 */
export function prependOlder(base: CandleSet, older: CandleSet): CandleSet {
  const di = base.columns.indexOf(DATE_COL);
  const oi = older.columns.indexOf(DATE_COL);
  if (di < 0 || oi < 0) return base;
  const firstTs = base.rows.length > 0 ? (base.rows[0]![di] as number) : Infinity;
  const fresh: Array<Array<number | null>> = [];
  let prev = -Infinity;
  for (const r of [...older.rows].sort((a, b) => (a[oi] as number) - (b[oi] as number))) {
    const ts = r[oi] as number | null;
    if (ts === null || !Number.isFinite(ts) || ts >= firstTs || ts <= prev) continue;
    prev = ts;
    fresh.push(
      base.columns.map((c) => {
        const k = older.columns.indexOf(c);
        return k >= 0 ? (r[k] ?? null) : null;
      }),
    );
  }
  if (fresh.length === 0) return base;
  return { columns: base.columns, rows: [...fresh, ...base.rows], timeframeMs: base.timeframeMs };
}

/** The earliest moment the trade draws: its open, its first fill or the open of a closed mark. */
export function tradeStartTs(o: Overlays): number | null {
  const all = [
    o.openTs,
    ...(o.fills ?? []).map((f) => f.ts),
    ...(o.closed ?? []).map((c) => c.openTs),
  ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  return all.length > 0 ? Math.min(...all) : null;
}

/** First candle time that covers the open of the trade with its margin. */
export const coverTarget = (tradeStart: number, timeframeMs: number): number =>
  tradeStart - COVER_MARGIN * timeframeMs;

/** The open of the trade is covered by the candles from `firstTs` on, margin included. */
export const isCovered = (
  firstTs: number | null,
  tradeStart: number | null,
  timeframeMs: number,
): boolean =>
  tradeStart === null || firstTs === null || firstTs <= coverTarget(tradeStart, timeframeMs);

export type OlderState = 'hidden' | 'show' | 'needGateway' | 'noMore' | 'capped';

/**
 * What the chart says about older candles. The button shows when the trade opened before the first
 * candle, or when the user is at the left edge and the history is not known to end there. Without
 * the local history (direct mode) the button is absent and, for a trade that opened earlier, a note
 * says the history needs the gateway.
 */
export function olderState(o: {
  hasApi: boolean;
  firstTs: number | null;
  tradeStart: number | null;
  /** `null`: not known yet (the candles came from a bot). */
  hasMore: boolean | null;
  atEdge: boolean;
  count: number;
  max?: number;
}): OlderState {
  if (o.firstTs === null) return 'hidden';
  const tradeBefore = o.tradeStart !== null && o.tradeStart < o.firstTs;
  if (!tradeBefore && !o.atEdge) return 'hidden';
  if (!o.hasApi) return tradeBefore ? 'needGateway' : 'hidden';
  if (o.count >= (o.max ?? MAX_CANDLES)) return 'capped';
  if (o.hasMore === false) return tradeBefore ? 'noMore' : 'hidden';
  return 'show';
}

/**
 * Time to wait before asking the local history for its newest candles: the next candle boundary
 * plus a few seconds for the files to be written. One request per candle, whatever the timeframe.
 */
export function nextTailDelay(nowMs: number, timeframeMs: number, lagMs = 5_000): number {
  if (!(timeframeMs > 0)) return 60_000;
  const boundary = (Math.floor(nowMs / timeframeMs) + 1) * timeframeMs;
  return boundary - nowMs + lagMs;
}

/** The tail update asks for a few candles, not a page: a candle closes at a time. */
export const TAIL_LIMIT = 50;

/** Candles to ask for to catch up with `lastTs`: the few missing ones, never a whole page. */
export function tailLimit(lastTs: number, nowMs: number, timeframeMs: number): number {
  const missing = Math.ceil((nowMs - lastTs) / timeframeMs) + 2;
  return Math.min(TAIL_LIMIT, Math.max(4, missing));
}

/**
 * Whether the few candles asked leave a hole after the last one held (the tab slept longer than
 * they cover): the chart then reloads instead of gluing a tail with a gap.
 */
export function tailHasGap(lastTs: number, firstTailTs: number | null, timeframeMs: number): boolean {
  return firstTailTs !== null && firstTailTs - lastTs > timeframeMs;
}

/** Age of the last local candle when it is more than two candles old, else null. */
export function staleAgeMs(lastTs: number | null, nowMs: number, timeframeMs: number): number | null {
  if (lastTs === null || !(timeframeMs > 0)) return null;
  const age = nowMs - lastTs;
  return age > 2 * timeframeMs ? age : null;
}

/** An age as a count and a unit ('min' | 'h' | 'd'), rounded down, at least one minute. */
export function ageParts(ageMs: number): { n: number; unit: 'min' | 'h' | 'd' } {
  const min = Math.max(1, Math.floor(ageMs / 60_000));
  if (min < 60) return { n: min, unit: 'min' };
  const h = Math.floor(min / 60);
  return h < 48 ? { n: h, unit: 'h' } : { n: Math.floor(h / 24), unit: 'd' };
}
