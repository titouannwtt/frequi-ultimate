import { describe, expect, it } from 'vitest';

import { DATE_COL, toCandleSet, type CandleSet } from '@/components/fq/lib/candles';
import {
  COVER_MARGIN,
  MAX_CANDLES,
  coverTarget,
  isCovered,
  nextTailDelay,
  olderState,
  prependOlder,
  setFromPage,
  tradeStartTs,
} from '@/components/fq/lib/candlesHistory';
import { closedTradeOverlays } from '@/components/fq/lib/chartTrades';
import { normalizeExitReason } from '@/datasource/calc/exitReason';
import type { CandlesPage } from '@/datasource/types';

const H = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);

/** A page of the local history: `n` hourly candles from `from`, as the gateway sends them. */
function page(from: number, n: number, over: Partial<CandlesPage> = {}): CandlesPage {
  return {
    pair: 'BTC/USDC:USDC',
    timeframe: '1h',
    candles: Array.from({ length: n }, (_, i) => {
      const ts = from + i * H;
      return [ts, 10 + i, 12 + i, 9 + i, 11 + i, 100] as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
    }),
    hasMore: true,
    firstAvailableMs: T0,
    resampledFrom: null,
    ...over,
  };
}

/** A set as a bot sends it: the strategy's indicator comes with the OHLCV columns. */
function botSet(from: number, n: number): CandleSet {
  return toCandleSet({
    columns: ['date', 'open', 'high', 'low', 'close', 'volume', DATE_COL, 'ema_50'],
    data: Array.from({ length: n }, (_, i) => {
      const ts = from + i * H;
      return [ts, 1, 2, 0.5, 1.5, 10, ts, 1.2];
    }),
    timeframe_ms: H,
  });
}

const times = (s: CandleSet) => s.rows.map((r) => r[s.columns.indexOf(DATE_COL)] as number);

describe('local pages as a candle set', () => {
  it('reads [ts, o, h, l, c, v] into the columns the chart draws', () => {
    const s = setFromPage(page(T0, 3), H);
    expect(s.columns).toEqual([DATE_COL, 'open', 'high', 'low', 'close', 'volume']);
    expect(s.rows[1]).toEqual([T0 + H, 11, 13, 10, 12, 100]);
    expect(s.timeframeMs).toBe(H);
  });

  it('drops a candle that is not after the previous one or has no time', () => {
    const p = page(T0, 3);
    p.candles.splice(2, 0, [T0 + H, 0, 0, 0, 0, 0], [Number.NaN, 1, 1, 1, 1, 1]);
    expect(times(setFromPage(p, H))).toEqual([T0, T0 + H, T0 + 2 * H]);
  });
});

describe('older pages put in front of the candles', () => {
  it('prepends in increasing order without a twin, whatever the page overlaps', () => {
    const base = setFromPage(page(T0 + 10 * H, 10), H);
    // Ten older candles, the last two of which are already in the set
    const older = setFromPage(page(T0 + 2 * H, 10), H);
    const merged = prependOlder(base, older);
    const ts = times(merged);
    expect(ts).toHaveLength(18);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(new Set(ts).size).toBe(ts.length);
    expect(ts[0]).toBe(T0 + 2 * H);
    expect(ts[ts.length - 1]).toBe(T0 + 19 * H);
    // The candles the set already had are untouched
    expect(merged.rows.slice(8)).toEqual(base.rows);
  });

  it('keeps the columns of a bot set and leaves its indicators empty on the older rows', () => {
    const base = botSet(T0 + 5 * H, 5);
    const merged = prependOlder(base, setFromPage(page(T0, 5), H));
    expect(merged.columns).toEqual(base.columns);
    expect(merged.rows).toHaveLength(10);
    const ema = merged.columns.indexOf('ema_50');
    expect(merged.rows[0]![ema]).toBeNull();
    expect(merged.rows[9]![ema]).toBe(1.2);
    // The OHLCV of an older row is the page's
    expect(merged.rows[0]![merged.columns.indexOf('close')]).toBe(11);
  });

  it('returns the set itself when the page brings nothing older', () => {
    const base = setFromPage(page(T0, 5), H);
    expect(prependOlder(base, setFromPage(page(T0, 5), H))).toBe(base);
    expect(prependOlder(base, setFromPage(page(T0 + 9 * H, 2), H))).toBe(base);
  });

  it('unsorted pages are put in order', () => {
    const base = setFromPage(page(T0 + 10 * H, 3), H);
    const older = setFromPage(page(T0, 4), H);
    older.rows.reverse();
    expect(times(prependOlder(base, older)).slice(0, 4)).toEqual([
      T0,
      T0 + H,
      T0 + 2 * H,
      T0 + 3 * H,
    ]);
  });
});

describe('the open of the trade is covered', () => {
  it('needs the open date and a margin of candles before it', () => {
    const open = T0 + 100 * H;
    expect(coverTarget(open, H)).toBe(open - COVER_MARGIN * H);
    expect(isCovered(open, open, H)).toBe(false);
    expect(isCovered(open - (COVER_MARGIN - 1) * H, open, H)).toBe(false);
    expect(isCovered(open - COVER_MARGIN * H, open, H)).toBe(true);
    expect(isCovered(open - 500 * H, open, H)).toBe(true);
  });

  it('is covered when there is no trade to reach', () => {
    expect(isCovered(T0, null, H)).toBe(true);
  });

  it('the start of a trade is its open, its first fill or the open of its closed mark', () => {
    expect(tradeStartTs({})).toBeNull();
    expect(tradeStartTs({ openTs: T0 + 5 * H })).toBe(T0 + 5 * H);
    expect(
      tradeStartTs({
        openTs: T0 + 5 * H,
        fills: [
          { ts: T0 + 3 * H, price: 1, kind: 'entry', side: 'long', label: 'E' },
          { ts: T0 + 7 * H, price: 1, kind: 'dca', side: 'long', label: 'SO1' },
        ],
      }),
    ).toBe(T0 + 3 * H);
  });
});

describe('when the button "Load previous candles" shows', () => {
  const base = {
    hasApi: true,
    firstTs: T0 + 100 * H,
    hasMore: true as boolean | null,
    atEdge: false,
    count: 1000,
  };

  it('shows when the trade opened before the first candle loaded', () => {
    expect(olderState({ ...base, tradeStart: T0 + 50 * H })).toBe('show');
  });

  it('is hidden when the trade opened inside the candles loaded and the user is not at the edge', () => {
    expect(olderState({ ...base, tradeStart: T0 + 150 * H })).toBe('hidden');
    expect(olderState({ ...base, tradeStart: null })).toBe('hidden');
  });

  it('shows at the left edge when the history is not known to end there', () => {
    expect(olderState({ ...base, tradeStart: null, atEdge: true })).toBe('show');
    expect(olderState({ ...base, tradeStart: null, atEdge: true, hasMore: null })).toBe('show');
    expect(olderState({ ...base, tradeStart: null, atEdge: true, hasMore: false })).toBe('hidden');
  });

  it('says there is nothing older when the trade is older than the history', () => {
    expect(olderState({ ...base, tradeStart: T0 + 50 * H, hasMore: false })).toBe('noMore');
  });

  it('stops at the memory ceiling', () => {
    expect(olderState({ ...base, tradeStart: T0 + 50 * H, count: MAX_CANDLES })).toBe('capped');
  });

  it('has no button without the local history (direct mode) and only says the history needs the gateway', () => {
    expect(olderState({ ...base, hasApi: false, tradeStart: T0 + 50 * H })).toBe('needGateway');
    expect(olderState({ ...base, hasApi: false, tradeStart: null, atEdge: true })).toBe('hidden');
    expect(olderState({ ...base, hasApi: false, tradeStart: T0 + 150 * H })).toBe('hidden');
  });

  it('shows nothing before any candle', () => {
    expect(olderState({ ...base, firstTs: null, tradeStart: T0 })).toBe('hidden');
  });
});

describe('refresh of the local tail', () => {
  it('waits for the next candle boundary and a few seconds, never more than once per candle', () => {
    const now = T0 + 10 * 60_000;
    expect(nextTailDelay(now, H, 5_000)).toBe(50 * 60_000 + 5_000);
    // Just after a boundary: the next one is a whole candle away
    expect(nextTailDelay(T0 + 1_000, H, 5_000)).toBe(H - 1_000 + 5_000);
    expect(nextTailDelay(now, 0)).toBe(60_000);
  });
});

describe('overlays of a closed trade', () => {
  const trade = {
    bot_key: 'local:1',
    trade_id: 7,
    pair: 'BTC/USDC:USDC',
    side: 'long' as const,
    open_ms: T0 + 5 * H,
    close_ms: T0 + 9 * H,
    open_rate: 10,
    close_rate: 12,
    profit_abs: 3,
    profit_ratio: 0.2,
    profit_unknown: false,
    exit_reason: normalizeExitReason('roi'),
  };

  it('draws the entry-to-exit segment and the executions, framed on the open', () => {
    const o = closedTradeOverlays(
      trade,
      [
        { ts: T0 + 5 * H, price: 10, kind: 'entry', side: 'long', label: 'E' },
        { ts: T0 + 7 * H, price: 9, kind: 'dca', side: 'long', label: 'SO1', n: 1 },
        { ts: T0 + 9 * H, price: 12, kind: 'exit', side: 'long', label: 'S' },
      ],
      () => 'roi',
    );
    expect(o.openTs).toBe(trade.open_ms);
    expect(o.closed).toHaveLength(1);
    expect(o.closed![0]).toMatchObject({
      openTs: trade.open_ms,
      closeTs: trade.close_ms,
      closePrice: 12,
    });
    expect(o.fills!.map((f) => f.kind)).toEqual(['entry', 'dca', 'exit']);
    // The exit above the entry of a long made money
    expect(o.fills![2]!.win).toBe(true);
  });

  it('keeps the segment when the orders could not be read', () => {
    const o = closedTradeOverlays(trade, [], () => '');
    expect(o.fills).toEqual([]);
    expect(o.closed).toHaveLength(1);
  });

  it('an exit under the entry of a short made money', () => {
    const o = closedTradeOverlays(
      { ...trade, side: 'short' },
      [{ ts: T0 + 9 * H, price: 8, kind: 'exit', side: 'short', label: 'S' }],
      () => '',
    );
    expect(o.fills![0]!.win).toBe(true);
  });
});
