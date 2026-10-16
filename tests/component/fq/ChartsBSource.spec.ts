import type * as EchartsCore from 'echarts/core';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BaseChart from '../../../src/components/ds/BaseChart.vue';
import {
  CandleChart,
  ClosedTradeSheet,
  DistributionChart,
  EquityCurve,
  LogStream,
  PairNavigator,
  PnlCalendar,
} from '../../../src/components/fq';
import { FIXTURE_NOW } from '../../../src/components/fq/fixtures';
import {
  makeCandles,
  makeClosedTrades,
  makeLogLines,
  sourceB,
  type SourceB,
} from '../../../src/components/fq/fixtures/charts';
import type { JournalTrade } from '../../../src/components/fq/lib/journal';
import { charts, liveCharts, resetCharts } from './chartMock';
import { mountFq, setupWorld, teardownWorld, type FqWorld } from './helpers';

vi.mock('echarts/core', async (orig) => {
  const actual = await orig<typeof EchartsCore>();
  const mock = await import('./chartMock');
  return { ...actual, init: mock.fakeInit };
});

let world: FqWorld;
let sb: SourceB;
let bot: string;
const FLEET = { kind: 'fleet' } as const;

beforeEach(() => {
  resetCharts();
  world = setupWorld();
  sb = sourceB(world.fixture);
  bot = world.fixture.bots.find((b) => b.identity.mode === 'live')!.bot_key;
  // Frames run at once: the log batcher applies its lines synchronously
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => {
  // Whatever a test did, nothing ever wrote through the double
  expect(sb.refused).toEqual([]);
  teardownWorld();
  vi.unstubAllGlobals();
});

const lineEls = (w: { findAll: (s: string) => Array<{ text: () => string }> }) =>
  w.findAll('li.ln');

describe('LogStream', () => {
  const page = (extra: Record<string, unknown> = {}) =>
    mountFq(LogStream, {
      props: { source: sb.source, bot, mode: 'page', level: 'DEBUG', ...extra },
    });

  it('keeps two different lines that start alike and two genuine repetitions (B13)', async () => {
    const w = page();
    await flushPromises();
    const text = lineEls(w).map((l) => l.text());
    expect(text.filter((t) => t.includes('Rate limit hit on /info'))).toHaveLength(2);
    expect(text.filter((t) => t.includes('insufficient margin on wallet A'))).toHaveLength(1);
    expect(text.filter((t) => t.includes('insufficient margin on wallet B'))).toHaveLength(1);
    expect(text).toHaveLength(makeLogLines().length);
  });

  it('a line received again over the live channel is not shown twice', async () => {
    const w = page();
    await flushPromises();
    const before = lineEls(w).length;
    const again = makeLogLines()[1]!;
    sb.push('logs', { kind: 'item', seq: 1, item: again });
    sb.push('logs', { kind: 'item', seq: 2, item: again });
    await flushPromises();
    expect(lineEls(w)).toHaveLength(before);
    sb.push('logs', {
      kind: 'item',
      seq: 3,
      item: { ts_ms: FIXTURE_NOW + 1000, level: 'ERROR', message: 'a new one' },
    });
    await flushPromises();
    expect(lineEls(w)).toHaveLength(before + 1);
    expect(lineEls(w)[0]!.text()).toContain('a new one');
  });

  it('a request that never answers gives up after the deadline (B13)', async () => {
    sb.slowLogs = true;
    const w = page({ timeoutMs: 500 });
    await flushPromises();
    expect(w.find('[data-testid=log-error]').exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    await flushPromises();
    expect(w.find('[data-testid=log-error]').text()).toMatch(/timed out after 500 ms/);
    // The late answer changes nothing
    for (const release of sb.hold.logs) release();
    await flushPromises();
    expect(w.find('[data-testid=log-error]').exists()).toBe(true);
    expect(lineEls(w)).toHaveLength(0);
  });

  it('a failed load keeps the error visible and Retry loads again', async () => {
    sb.failNext.logs = true;
    const w = page();
    await flushPromises();
    expect(w.find('[data-testid=log-error]').text()).toContain('gateway 503');
    await w.find('[data-testid=log-error] button').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid=log-error]').exists()).toBe(false);
    expect(lineEls(w).length).toBeGreaterThan(0);
  });

  it('the level is a floor: Errors hides warnings, CRITICAL stays', async () => {
    const w = page({ level: 'ERROR' });
    await flushPromises();
    const text = lineEls(w).map((l) => l.text());
    expect(text.some((t) => t.includes('Bot heartbeat lost'))).toBe(true);
    expect(text.some((t) => t.includes('Order for NEAR'))).toBe(false);
    expect(text.some((t) => t.includes('Found no signals'))).toBe(false);
  });

  it('compact mode shows the limit; without a bot it is the errors of the fleet, merged', async () => {
    const w = mountFq(LogStream, { props: { source: sb.source, limit: 3 } });
    await flushPromises();
    expect(w.find('[data-testid=log-errors-only]').exists()).toBe(true);
    expect(lineEls(w)).toHaveLength(3);
    expect(w.attributes('data-mode')).toBe('compact');
    expect(sb.subscriptions()).toContain('logs:*');
  });

  it('the traceback opens on demand', async () => {
    const w = page();
    await flushPromises();
    expect(w.find('pre.trace').exists()).toBe(false);
    await w.find('button.more').trigger('click');
    expect(w.find('pre.trace').text()).toContain('DDosProtection');
  });

  it('pausing holds new lines back and resuming brings them in', async () => {
    const w = page();
    await flushPromises();
    const before = lineEls(w).length;
    const pause = w.findAll('button').find((b) => b.text() === 'Pause')!;
    await pause.trigger('click');
    sb.push('logs', {
      kind: 'item',
      seq: 9,
      item: { ts_ms: FIXTURE_NOW + 5000, level: 'ERROR', message: 'held back' },
    });
    await flushPromises();
    expect(lineEls(w)).toHaveLength(before);
    const resume = w.findAll('button').find((b) => /Resume/.test(b.text()))!;
    expect(resume.text()).toContain('1');
    await resume.trigger('click');
    expect(lineEls(w)).toHaveLength(before + 1);
  });

  it('the text search goes to the source after a pause in typing', async () => {
    const w = page();
    await flushPromises();
    await w.find('input[type=search]').setValue('rate limit');
    expect(sb.queries.logs.some((q) => q.q === 'rate limit')).toBe(false);
    await vi.advanceTimersByTimeAsync(350);
    await flushPromises();
    expect(sb.queries.logs.some((q) => q.q === 'rate limit')).toBe(true);
    expect(lineEls(w).every((l) => /rate limit/i.test(l.text()))).toBe(true);
  });

  it('unmounting leaves no subscription behind', async () => {
    const w = page();
    await flushPromises();
    expect(sb.subscriptions().length).toBe(1);
    w.unmount();
    expect(sb.subscriptions()).toEqual([]);
  });

  it('changing the bot reloads and resubscribes', async () => {
    const w = page();
    await flushPromises();
    const other = world.fixture.bots.filter((b) => b.identity.mode === 'live')[1]!.bot_key;
    await w.setProps({ bot: other });
    await flushPromises();
    expect(sb.subscriptions()).toEqual([`logs:${other}`]);
  });
});

describe('PairNavigator', () => {
  const mount = (filter: string, extra: Record<string, unknown> = {}) =>
    mountFq(PairNavigator, { props: { source: sb.source, botKey: bot, filter, ...extra } });

  it('lists the open positions of the fleet when no bot is chosen, one row per trade', () => {
    const w = mountFq(PairNavigator, { props: { source: sb.source, filter: 'positions' } });
    const keys = w.findAll('button.it').map((b) => b.attributes('data-key'));
    expect(keys).toHaveLength(world.fixture.positions.length);
    expect(new Set(keys).size).toBe(keys.length);
    // No bot, no tabs: the other lists need a bot
    expect(w.findAll('[role=tab]')).toHaveLength(0);
  });

  it('the tabs emit the filter', async () => {
    const w = mount('positions');
    const tabs = w.findAll('[role=tab]');
    expect(tabs.map((t) => t.text())).toEqual(['Positions', 'Signals', 'Locks', 'All']);
    await tabs[2]!.trigger('click');
    expect(w.emitted('update:filter')?.[0]).toEqual(['locks']);
  });

  it('signals: entries before exits, pairs without a signal left out', async () => {
    const w = mount('signals');
    await flushPromises();
    const pairs = w.findAll('button.it b.p').map((b) => b.text());
    expect(pairs).toHaveLength(3);
    expect(pairs.join(' ')).not.toContain('SOL');
    expect(sb.proxyCalls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('locks: the active one with a lift button that only asks the page', async () => {
    const w = mount('locks');
    await flushPromises();
    expect(w.findAll('button.it')).toHaveLength(1);
    expect(w.text()).toContain('WIF');
    expect(w.text()).not.toContain('OLD');
    await w.find('button.lift').trigger('click');
    expect(w.emitted('liftLock')).toHaveLength(1);
    // Lifting is the page's confirmed action: nothing but GET went to the bot
    expect(sb.proxyCalls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('whitelist: sorted, a pair listed twice appears once', async () => {
    const w = mount('all');
    await flushPromises();
    const pairs = w.findAll('button.it b.p').map((b) => b.text());
    expect(pairs).toHaveLength(3);
  });

  it('selecting a row emits it; the selected one is marked', async () => {
    const w = mountFq(PairNavigator, { props: { source: sb.source, filter: 'positions' } });
    const first = w.find('button.it');
    await first.trigger('click');
    const item = w.emitted('select')![0]![0] as { key: string };
    expect(item.key).toBe(first.attributes('data-key'));
    await w.setProps({ selectedKey: item.key });
    expect(w.find(`button[data-key="${item.key}"]`).attributes('aria-current')).toBe('true');
  });

  it('chips layout is a listbox', async () => {
    const w = mountFq(PairNavigator, {
      props: { source: sb.source, filter: 'positions', layout: 'chips' },
    });
    expect(w.find('[role=listbox]').exists()).toBe(true);
    expect(w.findAll('[role=option]').length).toBe(world.fixture.positions.length);
  });

  it('a bot that does not answer: the error, not an empty list', async () => {
    sb.failNext.proxy = true;
    const w = mount('locks');
    await flushPromises();
    expect(w.find('[data-testid=pairnav-error]').text()).toContain('bot timed out');
  });

  it('search narrows the list', async () => {
    const w = mountFq(PairNavigator, { props: { source: sb.source, filter: 'positions' } });
    const all = w.findAll('button.it').length;
    await w.find('input[type=search]').setValue('zzzzzz');
    expect(w.findAll('button.it').length).toBeLessThan(all);
  });
});

describe('CandleChart', () => {
  const props = (extra: Record<string, unknown> = {}) => ({
    botKey: bot,
    pair: 'TAO/USDC:USDC',
    tf: '15m',
    source: sb.source,
    ...extra,
  });

  it('reads the history and the plot config with GET only, and draws one chart', async () => {
    const w = mountFq(CandleChart, { props: props(), attachTo: document.body });
    await flushPromises();
    expect(sb.proxyCalls.map((c) => c.path.split('?')[0])).toEqual([
      '/pair_candles',
      '/plot_config',
    ]);
    expect(w.findAllComponents(BaseChart)).toHaveLength(1);
    expect(liveCharts()).toHaveLength(1);
    expect(w.find('[data-testid=candle-legend]').text()).toMatch(/O \d/);
    expect(w.find('[data-testid=candle-legend]').text()).toContain('ema_50');
  });

  it('is released on unmount: instance disposed, subscription gone', async () => {
    const w = mountFq(CandleChart, { props: props(), attachTo: document.body });
    await flushPromises();
    expect(sb.subscriptions().some((k) => k.startsWith('chart:'))).toBe(true);
    w.unmount();
    expect(liveCharts()).toHaveLength(0);
    expect(charts[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(sb.subscriptions()).toEqual([]);
  });

  it('a closed candle triggers a short refetch merged by time, not a reload', async () => {
    const fx = makeCandles(60);
    sb = sourceB(world.fixture, { candles: fx });
    const w = mountFq(CandleChart, { props: props(), attachTo: document.body });
    await flushPromises();
    const callsBefore = sb.proxyCalls.length;
    const last = fx.data[fx.data.length - 1]!.slice();
    const next = last.slice();
    next[0] = (last[0] as number) + fx.timeframe_ms;
    next[6] = next[0]!;
    next[4] = 7.77;
    fx.data.push(next);
    sb.push('chart', { kind: 'item', seq: 1, item: {} });
    await flushPromises();
    const added = sb.proxyCalls.slice(callsBefore);
    expect(added).toHaveLength(1);
    expect(added[0]!.path).toContain('limit=4');
    expect(w.find('[data-testid=candle-legend]').text()).toContain('7.77');
    // Two closes in a row make one request at a time
    sb.push('chart', { kind: 'item', seq: 2, item: {} });
    sb.push('chart', { kind: 'item', seq: 3, item: {} });
    await flushPromises();
    expect(sb.proxyCalls.length - callsBefore).toBeLessThanOrEqual(3);
  });

  it('overlays are in the option and the chips switch them off', async () => {
    const w = mountFq(CandleChart, {
      props: props({
        overlays: { average: 4.9123, tp: 5.2345, liquidation: 3.1111 },
        controls: true,
      }),
      attachTo: document.body,
    });
    await flushPromises();
    const json = () => JSON.stringify(charts[0]!.last());
    expect(json()).toContain('4.9123');
    expect(json()).toContain('5.2345');
    expect(json()).toContain('3.1111');
    const chips = w.findAll('.ov button');
    // The sub-chart chip is not an overlay: it sits by the legend, not in this row
    expect(chips.map((c) => c.attributes('aria-pressed'))).toEqual(['true', 'true', 'true']);
    await chips[1]!.trigger('click');
    await flushPromises();
    expect(json()).not.toContain('5.2345');
    expect(json()).toContain('4.9123');
    expect(w.emitted('update:toggles')?.[0]![0]).toMatchObject({ tp: false, average: true });
  });

  it('a pair other than the position pair gets no overlay (caller passes none)', async () => {
    const w = mountFq(CandleChart, { props: props({ controls: true }), attachTo: document.body });
    await flushPromises();
    expect(w.find('.ov').exists()).toBe(false);
  });

  it('no candle in a timeframe the bot does not serve says so, not "not yet" (B191)', async () => {
    const own = world.fixture.bots.find((b) => b.bot_key === bot)!.identity.timeframe;
    expect(own).toBe('15m');
    sb = sourceB(world.fixture, { candles: { columns: ['date'], data: [], timeframe_ms: 0 } });
    const w = mountFq(CandleChart, {
      props: props({ tf: '1h', source: sb.source }),
      attachTo: document.body,
    });
    await flushPromises();
    const empty = w.find('[data-testid=candle-empty]');
    expect(empty.text()).toContain('No candles in 1h');
    expect(empty.text()).toContain('This bot only serves 15m');
    expect(empty.text()).not.toMatch(/not .*yet/i);
  });

  it('sub-charts that fit are drawn, and the chip switches them off (B193)', async () => {
    const w = mountFq(CandleChart, { props: props({ controls: true }), attachTo: document.body });
    await flushPromises();
    const chip = w.find('[data-testid=candle-subplots]');
    expect(chip.text()).toMatch(/Sub-charts \d+\/\d+/);
    const grids = () => (charts[0]!.last() as { grid: unknown[] }).grid.length;
    const withSubs = grids();
    await chip.find('button').trigger('click');
    await flushPromises();
    expect(grids()).toBeLessThan(withSubs);
  });

  it('a bot that does not answer: the note, no chart and no zero candles', async () => {
    sb.failNext.proxy = true;
    const w = mountFq(CandleChart, { props: props(), attachTo: document.body });
    await flushPromises();
    expect(w.find('[data-testid=candle-error]').exists()).toBe(true);
    expect(liveCharts()).toHaveLength(0);
  });

  it('preloaded candles: no request, no subscription', async () => {
    const fx = makeCandles(40);
    const w = mountFq(CandleChart, {
      props: { botKey: bot, pair: 'X', tf: '15m', candles: fx, source: sb.source },
      attachTo: document.body,
    });
    await flushPromises();
    expect(sb.proxyCalls).toHaveLength(0);
    expect(sb.subscriptions()).toEqual([]);
    expect(w.emitted('ready')).toHaveLength(1);
  });

  it('heikin ashi changes the series, not the legend of real prices', async () => {
    const fx = makeCandles(60);
    const w = mountFq(CandleChart, {
      props: { botKey: bot, pair: 'X', tf: '15m', candles: fx, heikinAshi: false },
      attachTo: document.body,
    });
    await flushPromises();
    const plain = JSON.stringify(charts[0]!.last());
    await w.setProps({ heikinAshi: true });
    await flushPromises();
    expect(JSON.stringify(charts[0]!.last())).not.toBe(plain);
    expect(w.find('[data-testid=candle-legend]').text()).toContain(
      String(fx.data[fx.data.length - 1]![4]!.toFixed(3)),
    );
  });
});

describe('ClosedTradeSheet', () => {
  const closed = (): JournalTrade[] => makeClosedTrades(world.fixture.bots);
  const mount = (t: JournalTrade, extra: Record<string, unknown> = {}) =>
    mountFq(ClosedTradeSheet, {
      props: {
        botKey: t.bot_key,
        tradeId: t.trade_id,
        trade: t,
        open: true,
        inline: true,
        source: sb.source,
        ...extra,
      },
    });

  it('a known trade needs no request and shows its excursions', async () => {
    const t = closed().find((x) => !x.profit_unknown && x.mae != null)!;
    const w = mount(t);
    await flushPromises();
    expect(sb.proxyCalls).toHaveLength(0);
    expect(w.find('[data-testid=cts-excursions]').text()).toMatch(/MAE/);
    expect(w.find('[data-testid=cts-origin]').exists()).toBe(true);
  });

  it('excursions the source did not give are said to be unavailable, not drawn as 0', async () => {
    const t = { ...closed().find((x) => !x.profit_unknown)!, mae: null, mfe: null };
    const w = mount(t);
    await flushPromises();
    const ex = w.find('[data-testid=cts-excursions]').text();
    expect(ex).not.toMatch(/0\.0%/);
    expect(ex.toLowerCase()).toMatch(/not available|unavailable/);
  });

  it('an unknown result stays unknown: no 0 and no percentage', async () => {
    const t = closed().find((x) => x.profit_unknown)!;
    const w = mount(t);
    await flushPromises();
    expect(w.text()).not.toMatch(/\+0\.00/);
    // The result is an icon that says why, not a word in the figure's place
    const pnl = w.get('.pnl [data-state="unavailable"]');
    expect(pnl.attributes('aria-label')).toBe('Profit not recorded');
  });

  it('a human exit is marked as such', async () => {
    const t = closed().find((x) => x.manual && !x.profit_unknown)!;
    const w = mount(t);
    await flushPromises();
    expect(w.find('[data-testid=cts-origin]').text().toLowerCase()).toMatch(/human|you|manual/);
  });

  it('a trade without a given row is read from the bot (GET) under its own address', async () => {
    const all = closed();
    const t = all.find((x) => !x.profit_unknown)!;
    sb = sourceB(world.fixture, { trades: all });
    const w = mount(t, { trade: null });
    await flushPromises();
    expect(sb.proxyCalls).toEqual([
      { botKey: t.bot_key, method: 'GET', path: `/trade/${t.trade_id}` },
    ]);
    expect(w.find('[data-testid=closed-trade-sheet]').exists()).toBe(true);
  });

  it('a row of another trade is never shown under this address', async () => {
    const [a, b] = closed().filter((x) => !x.profit_unknown);
    sb = sourceB(world.fixture, { trades: [a!, b!] });
    const w = mount(a!, { tradeId: b!.trade_id, botKey: b!.bot_key });
    await flushPromises();
    // It asks the bot for the trade that was requested
    expect(sb.proxyCalls[0]!.path).toBe(`/trade/${b!.trade_id}`);
    expect(w.text()).toContain(`#${b!.trade_id}`);
    expect(w.text()).not.toContain(`#${a!.trade_id}`);
  });

  it('an unknown trade on the bot shows the error', async () => {
    const t = closed().find((x) => !x.profit_unknown)!;
    sb = sourceB(world.fixture, { trades: [] });
    const w = mount(t, { trade: null });
    await flushPromises();
    expect(w.find('[role=alert]').text()).toContain('404');
  });

  it('a trade that is not closed yet says so', async () => {
    const t = { ...closed().find((x) => !x.profit_unknown)!, close_ms: null };
    const w = mount(t);
    await flushPromises();
    expect(w.find('[data-testid=cts-open]').exists()).toBe(true);
  });
});

describe('charts fed by the source', () => {
  it('EquityCurve reads the equity and the drawdown through the source', async () => {
    const w = mountFq(EquityCurve, {
      props: { scope: FLEET, source: sb.source, nowMs: FIXTURE_NOW },
    });
    await flushPromises();
    expect(w.findAllComponents(BaseChart)).toHaveLength(1);
    expect(w.find('[data-testid=eq-drawdown]').text()).toContain('USDC');
    w.unmount();
    expect(liveCharts()).toHaveLength(0);
  });

  it('PnlCalendar asks for the days back to the 1st of the month, in the zone of the preferences', async () => {
    const w = mountFq(PnlCalendar, {
      props: { scope: FLEET, source: sb.source, month: '2026-10', nowMs: FIXTURE_NOW },
    });
    await flushPromises();
    const q = sb.queries.periods[0]!;
    expect(q).toMatchObject({ unit: 'day', tz: 'Europe/Paris' });
    expect(q.n).toBe(15);
    expect(w.findAll('button.d')).toHaveLength(31);
    await w.setProps({ month: '2026-09' });
    await flushPromises();
    expect(sb.queries.periods.at(-1)!.n).toBeGreaterThan(30);
  });

  it('DistributionChart reads the closed trades through the source and says when the set is partial', async () => {
    const w = mountFq(DistributionChart, {
      props: { query: { mode: ['live'] }, source: sb.source },
    });
    await flushPromises();
    expect(sb.queries.trades.length).toBeGreaterThan(0);
    expect(w.findAllComponents(BaseChart)).toHaveLength(1);
  });
});
