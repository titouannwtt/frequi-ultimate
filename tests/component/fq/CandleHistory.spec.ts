import type * as EchartsCore from 'echarts/core';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CandleChart, ClosedTradeSheet, TradeChart, TradeDrawer } from '../../../src/components/fq';
import { FIXTURE_NOW } from '../../../src/components/fq/fixtures';
import {
  makeCandles,
  makeClosedTrades,
  sourceB,
  type SourceB,
} from '../../../src/components/fq/fixtures/charts';
import type { Overlays } from '../../../src/components/fq/lib/candles';
import type { CandlesPage, CandlesQuery, OrderRow } from '../../../src/datasource/types';
import { charts, liveCharts, resetCharts } from './chartMock';
import { mountFq, setupWorld, teardownWorld, type FqWorld } from './helpers';

vi.mock('echarts/core', async (orig) => {
  const actual = await orig<typeof EchartsCore>();
  const mock = await import('./chartMock');
  return { ...actual, init: mock.fakeInit };
});

// The drawers and TradeChart read through the active source
const hoisted = vi.hoisted(() => ({ holder: { source: null as unknown } }));
vi.mock('../../../src/composables/useDataSource', async () => {
  const { computed } = await import('vue');
  return { useDataSource: () => ({ source: computed(() => hoisted.holder.source) }) };
});

const MIN = 60_000;
const TF = 15 * MIN;

let world: FqWorld;
let sb: SourceB;
let bot: string;

/**
 * A local history of `n` candles of `tf` ending at the fixture now, served like the gateway does:
 * the latest `limit` candles before `endMs`, `hasMore` while older ones remain.
 */
function history(n: number, tf = TF, endAt = FIXTURE_NOW) {
  const store = Array.from({ length: n }, (_, i) => {
    const ts = endAt - (n - 1 - i) * tf;
    return [ts, 10, 12, 9, 11 + (i % 3), 100] as [number, number, number, number, number, number];
  });
  const calls: CandlesQuery[] = [];
  const gate = { hold: false, release: [] as Array<() => void> };
  const api = vi.fn(async (q: CandlesQuery): Promise<CandlesPage> => {
    calls.push({ ...q });
    if (gate.hold) await new Promise<void>((res) => gate.release.push(res));
    const older = store.filter((c) => c[0] < (q.endMs ?? Infinity));
    const page = older.slice(-(q.limit ?? 1000));
    return {
      pair: q.pair,
      timeframe: q.timeframe,
      candles: page,
      hasMore: older.length > page.length,
      firstAvailableMs: store[0]![0],
      resampledFrom: null,
    };
  });
  return { api, calls, gate, store };
}

function withHistory(h: ReturnType<typeof history>) {
  (sb.source.query as unknown as Record<string, unknown>).candles = h.api;
}

const rows = (): number[][] =>
  ((charts[0]!.last().dataset as { source: number[][] }).source ?? []) as number[][];
// The bot's columns: date, open, high, low, close, volume, __date_ts, ema_50, rsi
const dateCol = (r: number[]) => r[6]!;

beforeEach(() => {
  resetCharts();
  world = setupWorld();
  bot = world.fixture.bots.find((b) => b.identity.mode === 'live')!.bot_key;
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => {
  expect(sb.refused).toEqual([]);
  teardownWorld();
  vi.unstubAllGlobals();
  hoisted.holder.source = null;
});

const props = (extra: Record<string, unknown> = {}) => ({
  botKey: bot,
  pair: 'TAO/USDC:USDC',
  tf: '15m',
  source: sb.source,
  ...extra,
});
const calls = (path: string) => sb.proxyCalls.filter((c) => c.path.startsWith(path));

describe('a timeframe the bot does not serve', () => {
  it('reads the local history when the bot answers with no candle, and says so', async () => {
    sb = sourceB(world.fixture, { candles: { ...makeCandles(0), data: [] } });
    const h = history(3000);
    withHistory(h);
    const w = mountFq(CandleChart, { props: props(), attachTo: document.body });
    await flushPromises();
    // The bot was asked first (it is the strategy timeframe), then the history, newest page
    expect(calls('/pair_candles')).toHaveLength(1);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ pair: 'TAO/USDC:USDC', timeframe: '15m', limit: 1000 });
    expect(h.calls[0]!.endMs ?? null).toBeNull();
    expect(rows()).toHaveLength(1000);
    expect(w.find('[data-testid=candle-local-note]').text()).toContain('without the strategy');
    expect(w.find('[data-testid=candle-empty]').exists()).toBe(false);
  });

  it('goes straight to the history for a timeframe other than the strategy one', async () => {
    sb = sourceB(world.fixture);
    const h = history(3000, 60 * MIN);
    withHistory(h);
    const w = mountFq(CandleChart, { props: props({ tf: '1h' }), attachTo: document.body });
    await flushPromises();
    expect(calls('/pair_candles')).toHaveLength(0);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ timeframe: '1h' });
    expect(rows()).toHaveLength(1000);
    expect(w.find('[data-testid=candle-local-note]').exists()).toBe(true);
  });

  it('keeps the bot candles, with no local note, for the strategy timeframe', async () => {
    sb = sourceB(world.fixture, { candles: makeCandles(120) });
    const h = history(3000);
    withHistory(h);
    const w = mountFq(CandleChart, { props: props(), attachTo: document.body });
    await flushPromises();
    expect(h.api).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(120);
    expect(w.find('[data-testid=candle-local-note]').exists()).toBe(false);
  });

  it('a history that fails does not blank the chart behind it: the bot candles stay', async () => {
    sb = sourceB(world.fixture, { candles: makeCandles(80) });
    withHistory(history(10));
    (sb.source.query as unknown as { candles: unknown }).candles = vi.fn(async () => {
      throw new Error('gateway 404');
    });
    const w = mountFq(CandleChart, { props: props({ tf: '1h' }), attachTo: document.body });
    await flushPromises();
    // The bot answered (its test double serves any timeframe): that is what is drawn
    expect(rows()).toHaveLength(80);
    expect(w.find('[data-testid=candle-local-note]').exists()).toBe(false);
  });

  it('without the local history (direct mode) the empty state says the other timeframes need the gateway', async () => {
    sb = sourceB(world.fixture, { candles: { ...makeCandles(0), data: [] } });
    const w = mountFq(CandleChart, { props: props({ tf: '1h' }), attachTo: document.body });
    await flushPromises();
    expect(w.find('[data-testid=candle-empty]').text()).toContain('gateway');
  });
});

describe('every load says it is loading', () => {
  it('a change of timeframe dims the chart that stays, then draws the new candles', async () => {
    sb = sourceB(world.fixture, { candles: makeCandles(100) });
    const h = history(3000, 60 * MIN);
    withHistory(h);
    const w = mountFq(CandleChart, { props: props(), attachTo: document.body });
    await flushPromises();
    expect(rows()).toHaveLength(100);
    expect(w.find('[data-testid=candle-loading]').exists()).toBe(false);

    h.gate.hold = true;
    await w.setProps({ tf: '1h' });
    await flushPromises();
    // The veil is there and the old chart is still under it
    expect(w.find('[data-testid=candle-loading]').text()).toContain('1h');
    expect(w.attributes('aria-busy')).toBe('true');
    expect(liveCharts()).toHaveLength(1);
    expect(w.find('[data-testid=candle-empty]').exists()).toBe(false);

    for (const release of h.gate.release) release();
    await flushPromises();
    expect(w.find('[data-testid=candle-loading]').exists()).toBe(false);
    expect(rows()).toHaveLength(1000);
    expect(w.find('[data-testid=candle-local-note]').exists()).toBe(true);
    // Still one chart instance: the change did not rebuild it
    expect(charts).toHaveLength(1);
  });

  it('the old timeframe does not stay on screen when the new one cannot be read', async () => {
    sb = sourceB(world.fixture, { candles: makeCandles(100) });
    const h = history(10);
    withHistory(h);
    const w = mountFq(CandleChart, { props: props(), attachTo: document.body });
    await flushPromises();
    h.api.mockRejectedValue(new Error('gateway 503'));
    sb.failNext.proxy = true;
    await w.setProps({ tf: '1h' });
    await flushPromises();
    expect(w.find('[data-testid=candle-empty]').exists()).toBe(true);
    expect(w.find('[data-testid=candle-error]').exists()).toBe(true);
  });

  it('a first load shows the loading label too', async () => {
    sb = sourceB(world.fixture);
    const h = history(3000);
    h.gate.hold = true;
    withHistory(h);
    const w = mountFq(CandleChart, { props: props({ tf: '1h' }), attachTo: document.body });
    await flushPromises();
    expect(w.find('[data-testid=candle-loading]').exists()).toBe(true);
    for (const release of h.gate.release) release();
    await flushPromises();
    expect(w.find('[data-testid=candle-loading]').exists()).toBe(false);
  });
});

describe('Load previous candles', () => {
  const OPEN_BACK = 1500; // candles before the first one the bot gave

  /** The bot gives 300 candles; the trade opened 1500 candles before the first of them. */
  function setup(extra: { openBack?: number; stored?: number } = {}) {
    sb = sourceB(world.fixture, { candles: makeCandles(300) });
    const h = history(extra.stored ?? 6000);
    withHistory(h);
    const firstBot = FIXTURE_NOW - 299 * TF;
    const overlays: Overlays = { openTs: firstBot - (extra.openBack ?? OPEN_BACK) * TF };
    return { h, overlays, firstBot };
  }
  const button = (w: ReturnType<typeof mountFq>) => w.find('[data-testid=candle-load-older]');

  it('shows when the trade opened before the first candle, and nothing older is asked before the click', async () => {
    const { h, overlays } = setup();
    const w = mountFq(CandleChart, { props: props({ overlays }), attachTo: document.body });
    await flushPromises();
    expect(button(w).exists()).toBe(true);
    expect(button(w).text()).toBe('Load previous candles');
    expect(h.api).not.toHaveBeenCalled();
  });

  it('is absent when the trade opened inside the candles loaded', async () => {
    const { overlays } = setup({ openBack: -100 });
    const w = mountFq(CandleChart, { props: props({ overlays }), attachTo: document.body });
    await flushPromises();
    expect(button(w).exists()).toBe(false);
  });

  it('reads pages back from the first candle shown until the open is covered, then stops', async () => {
    const { h, overlays, firstBot } = setup();
    const w = mountFq(CandleChart, { props: props({ overlays }), attachTo: document.body });
    await flushPromises();
    await button(w).trigger('click');
    await flushPromises();

    // Pages are asked from the first candle on screen, each ending where the previous one began
    expect(h.calls.map((c) => c.endMs)).toEqual([firstBot, firstBot - 1000 * TF]);
    expect(h.calls.every((c) => c.timeframe === '15m' && c.limit === 1000)).toBe(true);
    // 1000 + 1000 candles in front of the 300: increasing, no twin
    const ts = rows().map(dateCol);
    expect(ts).toHaveLength(2300);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(new Set(ts).size).toBe(ts.length);
    expect(ts[0]).toBe(firstBot - 2000 * TF);
    expect(ts[ts.length - 1]).toBe(FIXTURE_NOW);
    // The open is covered with its margin: no third page, no button
    expect(overlays.openTs! - ts[0]!).toBeGreaterThanOrEqual(30 * TF);
    expect(button(w).exists()).toBe(false);
    expect(w.find('[data-testid=candle-older-progress]').exists()).toBe(false);
    // The bot candles keep their indicators; the older ones have none
    expect(w.find('[data-testid=candle-local-note]').exists()).toBe(false);
  });

  it('one page is enough when it covers the open', async () => {
    const { h, overlays } = setup({ openBack: 400 });
    const w = mountFq(CandleChart, { props: props({ overlays }), attachTo: document.body });
    await flushPromises();
    await button(w).trigger('click');
    await flushPromises();
    expect(h.calls).toHaveLength(1);
    expect(rows()).toHaveLength(1300);
  });

  it('brings the open of the trade back into view at the end', async () => {
    const { overlays } = setup();
    const w = mountFq(CandleChart, { props: props({ overlays }), attachTo: document.body });
    await flushPromises();
    charts[0]!.dispatchAction.mockClear();
    await button(w).trigger('click');
    await flushPromises();
    // Too far back for the first window to take in: the chart is moved to the entry
    const moved = charts[0]!.dispatchAction.mock.calls.map((c) => c[0] as Record<string, unknown>);
    const zoom = moved.find((a) => a.type === 'dataZoom');
    expect(zoom).toBeDefined();
    expect(overlays.openTs!).toBeGreaterThanOrEqual(zoom!.startValue as number);
    expect(overlays.openTs!).toBeLessThanOrEqual(zoom!.endValue as number);
  });

  it('says the history ends when the trade is older than all of it', async () => {
    const { h, overlays } = setup({ stored: 600, openBack: 1500 });
    const w = mountFq(CandleChart, { props: props({ overlays }), attachTo: document.body });
    await flushPromises();
    await button(w).trigger('click');
    await flushPromises();
    // 600 stored, 300 are the bot's: one page of 300 and the end of the history
    expect(h.calls).toHaveLength(1);
    expect(rows()).toHaveLength(600);
    expect(button(w).exists()).toBe(false);
    expect(w.find('[data-testid=candle-no-more]').text()).toContain('No older local history');
  });

  it('shows its progress and can be cancelled', async () => {
    const { h, overlays } = setup();
    const w = mountFq(CandleChart, { props: props({ overlays }), attachTo: document.body });
    await flushPromises();
    h.gate.hold = true;
    await button(w).trigger('click');
    await flushPromises();
    expect(w.find('[data-testid=candle-older-progress]').exists()).toBe(true);
    expect(button(w).exists()).toBe(false);
    await w.find('[data-testid=candle-older-cancel]').trigger('click');
    expect(w.find('[data-testid=candle-older-progress]').exists()).toBe(false);
    // The page that was in flight arrives late and changes nothing
    for (const release of h.gate.release) release();
    await flushPromises();
    expect(rows()).toHaveLength(300);
    expect(h.calls).toHaveLength(1);
    // The button is back
    expect(button(w).exists()).toBe(true);
  });

  it('shows at the left edge while the history has more, one page per click', async () => {
    sb = sourceB(world.fixture, { candles: makeCandles(300) });
    const h = history(6000);
    withHistory(h);
    const w = mountFq(CandleChart, { props: props(), attachTo: document.body });
    await flushPromises();
    // No trade, and the window is not at the edge
    expect(button(w).exists()).toBe(false);
    charts[0]!.handlers.get('datazoom')!({ start: 0, end: 40 });
    await flushPromises();
    expect(button(w).exists()).toBe(true);
    await button(w).trigger('click');
    await flushPromises();
    expect(h.calls).toHaveLength(1);
    expect(rows()).toHaveLength(1300);
  });

  it('in direct mode there is no button, and a trade out of reach says the history needs the gateway', async () => {
    sb = sourceB(world.fixture, { candles: makeCandles(300) });
    const overlays: Overlays = { openTs: FIXTURE_NOW - 1000 * TF };
    const w = mountFq(CandleChart, { props: props({ overlays }), attachTo: document.body });
    await flushPromises();
    charts[0]!.handlers.get('datazoom')!({ start: 0, end: 40 });
    await flushPromises();
    expect(button(w).exists()).toBe(false);
    expect(w.find('[data-testid=candle-need-gateway]').text()).toContain('gateway');
  });

  it('a page that fails is said, and the candles already loaded stay', async () => {
    const { h, overlays } = setup();
    const w = mountFq(CandleChart, { props: props({ overlays }), attachTo: document.body });
    await flushPromises();
    h.api.mockRejectedValueOnce(new Error('gateway 503'));
    await button(w).trigger('click');
    await flushPromises();
    expect(w.find('[data-testid=candle-older-error]').text()).toContain('gateway 503');
    expect(rows()).toHaveLength(300);
    expect(button(w).exists()).toBe(true);
  });
});

describe('the newest local candles', () => {
  it('are asked once per candle, from the history, without an end', async () => {
    sb = sourceB(world.fixture);
    const h = history(3000, 60 * MIN);
    withHistory(h);
    mountFq(CandleChart, { props: props({ tf: '1h' }), attachTo: document.body });
    await flushPromises();
    expect(h.calls).toHaveLength(1);
    // The fixture "now" is on a boundary: the next candle closes in one hour
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(h.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(31 * MIN);
    await flushPromises();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.endMs ?? null).toBeNull();
    expect(h.calls[1]!.limit).toBeLessThanOrEqual(10);
    // And only once for the next one too
    await vi.advanceTimersByTimeAsync(60 * MIN);
    await flushPromises();
    expect(h.calls).toHaveLength(3);
  });

  it('say how old the last local candle is when it lags by more than two candles', async () => {
    sb = sourceB(world.fixture);
    withHistory(history(3000, 60 * MIN, FIXTURE_NOW - 3 * 60 * MIN));
    const w = mountFq(CandleChart, { props: props({ tf: '1h' }), attachTo: document.body });
    await flushPromises();
    expect(w.get('[data-testid=candle-local-stale]').text()).toBe('Last local candle 3 h ago');
  });

  it('say nothing when the last local candle is recent', async () => {
    sb = sourceB(world.fixture);
    withHistory(history(3000, 60 * MIN));
    const w = mountFq(CandleChart, { props: props({ tf: '1h' }), attachTo: document.body });
    await flushPromises();
    expect(w.find('[data-testid=candle-local-stale]').exists()).toBe(false);
  });

  it('are caught up when the tab is shown again, a few candles at a time, and a failure is forgotten', async () => {
    sb = sourceB(world.fixture);
    const h = history(3000, 60 * MIN);
    withHistory(h);
    const w = mountFq(CandleChart, { props: props({ tf: '1h' }), attachTo: document.body });
    await flushPromises();
    expect(h.calls).toHaveLength(1);
    const hidden = vi.spyOn(document, 'hidden', 'get');
    // A tab that is still hidden asks nothing
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(h.calls).toHaveLength(1);
    // Shown again: the tail is asked at once, and it is small
    hidden.mockReturnValue(false);
    const real = h.api.getMockImplementation()!;
    h.api.mockImplementationOnce(async () => {
      throw new Error('gateway 500');
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(h.calls).toHaveLength(1);
    expect(w.find('[data-testid=candle-error]').exists()).toBe(true);
    h.api.mockImplementation(real);
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.limit).toBeLessThanOrEqual(50);
    expect(w.find('[data-testid=candle-error]').exists()).toBe(false);
    // The listener goes with the chart
    w.unmount();
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(h.calls).toHaveLength(2);
    hidden.mockRestore();
  });

  it('never ask for a page: a long lag is still capped at 50 candles', async () => {
    sb = sourceB(world.fixture);
    const h = history(3000, 15 * MIN, FIXTURE_NOW - 5 * 24 * 60 * MIN);
    withHistory(h);
    mountFq(CandleChart, { props: props({ tf: '15m', botKey: 'none' }), attachTo: document.body });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(16 * MIN);
    await flushPromises();
    for (const c of h.calls.slice(1)) expect(c.limit).toBeLessThanOrEqual(50);
  });

  it('go back to the bot when it answers again on its own timeframe', async () => {
    const botCandles = { ...makeCandles(0), data: [] as unknown[][] };
    sb = sourceB(world.fixture, { candles: botCandles as never });
    withHistory(history(300));
    const w = mountFq(CandleChart, { props: props(), attachTo: document.body });
    await flushPromises();
    expect(w.find('[data-testid=candle-local-note]').exists()).toBe(true);
    botCandles.data.push(...makeCandles(60).data);
    sb.push('chart', { kind: 'item', seq: 1, item: {} });
    await flushPromises();
    expect(w.find('[data-testid=candle-local-note]').exists()).toBe(false);
    expect(rows()).toHaveLength(60);
  });

  it('are not asked after the chart is gone', async () => {
    sb = sourceB(world.fixture);
    const h = history(3000, 60 * MIN);
    withHistory(h);
    const w = mountFq(CandleChart, { props: props({ tf: '1h' }), attachTo: document.body });
    await flushPromises();
    w.unmount();
    await vi.advanceTimersByTimeAsync(3 * 60 * MIN);
    expect(h.calls).toHaveLength(1);
  });
});

describe('the chart of a trade', () => {
  const ORDERS: OrderRow[] = [
    {
      id: 1,
      side: 'buy',
      is_entry: true,
      status: 'closed',
      is_open: false,
      filled: 1,
      amount: 1,
      average: 10,
      cost: 10,
      filled_ms: 0,
      tag: null,
    },
    {
      id: 2,
      side: 'buy',
      is_entry: true,
      status: 'closed',
      is_open: false,
      filled: 1,
      amount: 1,
      average: 9.5,
      cost: 9.5,
      filled_ms: 0,
      tag: null,
    },
    {
      id: 3,
      side: 'sell',
      is_entry: false,
      status: 'closed',
      is_open: false,
      filled: 2,
      amount: 2,
      average: 11,
      cost: 22,
      filled_ms: 0,
      tag: null,
    },
  ];
  // A trade closed 3000 candles ago, open for 200: beyond what a bot holds
  const CLOSE = FIXTURE_NOW - 3000 * TF;
  const OPEN = CLOSE - 200 * TF;

  function trade(over: Record<string, unknown> = {}) {
    return {
      bot_key: bot,
      trade_id: 41,
      pair: 'TAO/USDC:USDC',
      side: 'long' as const,
      open_ms: OPEN,
      close_ms: CLOSE,
      open_rate: 9.8,
      close_rate: 11,
      profit_abs: 2.4,
      profit_ratio: 0.12,
      profit_unknown: false,
      exit_reason: { kind: 'roi', raw: 'roi' },
      ...over,
    };
  }
  function setup() {
    sb = sourceB(world.fixture, { candles: makeCandles(300) });
    const h = history(6000);
    withHistory(h);
    (sb.source.query as unknown as Record<string, unknown>).tradeOrders = vi.fn(async () =>
      ORDERS.map((o, i) => ({
        ...o,
        filled_ms: [OPEN, OPEN + 60 * TF, CLOSE][i]!,
      })),
    );
    hoisted.holder.source = sb.source;
    return h;
  }

  it('a closed trade that ended long ago opens on the history around its end, with its entry, top-up and exit', async () => {
    const h = setup();
    const w = mountFq(TradeChart, {
      props: { trade: trade(), source: sb.source },
      attachTo: document.body,
    });
    await flushPromises();
    // The first page ends a margin after the exit, not at the latest candle
    expect(h.calls[0]!.endMs).toBe(CLOSE + 30 * TF);
    // The open is within that page, margin included: one page is enough
    expect(h.calls).toHaveLength(1);
    expect(w.find('[data-testid=candle-local-note]').exists()).toBe(true);
    expect(w.find('[data-testid=trade-chart]').attributes('data-closed')).toBe('1');
    const option = JSON.stringify(charts[0]!.last());
    expect(option).toContain('"id":"fills"');
    expect(option).toContain('"id":"closed"');
    // The entry (10), the top-up (9.5) and the exit (11) of the orders are on the chart
    expect(w.find('[data-testid=candle-chart]').attributes('data-fills')).toBe('3');
    expect(w.find('[data-testid=candle-chart]').attributes('data-closed')).toBe('1');
  });

  it('reads back more than one page when the trade lasted longer than that', async () => {
    const h = setup();
    mountFq(TradeChart, {
      props: { trade: trade({ open_ms: CLOSE - 1800 * TF }), source: sb.source },
      attachTo: document.body,
    });
    await flushPromises();
    expect(h.calls.length).toBeGreaterThanOrEqual(2);
    expect(h.calls[1]!.endMs).toBeLessThan(h.calls[0]!.endMs!);
  });

  it('draws the trade with its segment when the orders cannot be read', async () => {
    setup();
    (sb.source.query as unknown as Record<string, unknown>).tradeOrders = vi.fn(async () => null);
    const w = mountFq(TradeChart, {
      props: { trade: trade(), source: sb.source },
      attachTo: document.body,
    });
    await flushPromises();
    expect(w.find('[data-testid=trade-chart-no-orders]').exists()).toBe(true);
    expect(w.find('[data-testid=candle-chart]').attributes('data-closed')).toBe('1');
    expect(w.find('[data-testid=candle-chart]').attributes('data-fills')).toBe('0');
  });

  it('shows the timeframes and starts on the strategy one', async () => {
    setup();
    const w = mountFq(TradeChart, {
      props: { trade: trade(), source: sb.source },
      attachTo: document.body,
    });
    await flushPromises();
    const pressed = w
      .findAll('[role=radio][aria-checked=true], button[aria-pressed=true]')
      .map((b) => b.text());
    expect(pressed).toContain('15m');
  });

  it('is folded in the closed trade sheet until one click', async () => {
    setup();
    const t = makeClosedTrades(world.fixture.bots).find(
      (x) => x.close_ms !== null && !x.profit_unknown,
    )!;
    const w = mountFq(ClosedTradeSheet, {
      props: {
        botKey: t.bot_key,
        tradeId: t.trade_id,
        trade: t,
        open: true,
        inline: true,
        source: sb.source,
      },
      attachTo: document.body,
    });
    await flushPromises();
    expect(sb.proxyCalls).toHaveLength(0);
    expect(w.find('[data-testid=trade-chart]').exists()).toBe(false);
    await w.find('[data-testid=trade-chart-toggle]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid=trade-chart]').exists()).toBe(true);
    expect(w.find('[data-testid=trade-chart]').attributes('data-closed')).toBe('1');
  });

  it('is folded in the drawer of an open position until one click, and absent when the page has its own', async () => {
    setup();
    const p = world.fixture.positions.find((x) => !x.orphan)!;
    const w = mountFq(TradeDrawer, {
      props: { botKey: p.bot_key, tradeId: p.trade_id, docked: true },
      attachTo: document.body,
    });
    await flushPromises();
    expect(w.find('[data-testid=trade-chart]').exists()).toBe(false);
    await w.find('[data-testid=trade-chart-toggle]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid=trade-chart]').attributes('data-closed')).toBe('0');
    await w.setProps({ chart: false });
    expect(w.find('[data-testid=trade-chart-toggle]').exists()).toBe(false);
  });
});
