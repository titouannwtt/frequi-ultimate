import type * as EchartsCore from 'echarts/core';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { CandleChart } from '../../../src/components/fq';
import { makeCandles, sourceB, type SourceB } from '../../../src/components/fq/fixtures/charts';
import { charts, resetCharts } from './chartMock';
import { mountFq, setupWorld, teardownWorld, type FqWorld } from './helpers';

vi.mock('echarts/core', async (orig) => {
  const actual = await orig<typeof EchartsCore>();
  const mock = await import('./chartMock');
  return { ...actual, init: mock.fakeInit };
});
// happy-dom has no layout: give the plot the room of a desktop chart so the sub-charts fit
vi.mock('@vueuse/core', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return { ...actual, useElementSize: () => ({ width: ref(900), height: ref(900) }) };
});

let world: FqWorld;
let sb: SourceB;
let bot: string;

beforeEach(() => {
  resetCharts();
  world = setupWorld();
  sb = sourceB(world.fixture);
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
});

/** Candles with the columns of a strategy that plots three sub-charts under its price. */
function strategyCandles() {
  const base = makeCandles(120);
  return {
    ...base,
    columns: [...base.columns, 'rsi_14', 'I-vwap_low', 'C-rsi'],
    data: base.data.map((r) => [...r, 55, r[4]! * 0.99, 60]),
  };
}
const plotConfig = {
  main_plot: { ema_50: {} },
  subplots: {
    'RSI 14': { rsi_14: {} },
    'VWAP bas': { 'I-vwap_low': {} },
    Signaux: { 'C-rsi': {} },
  },
};

describe('Charts: the sub-chart, titled and one at first', () => {
  const mountChart = (extra: Record<string, unknown> = {}) =>
    mountFq(CandleChart, {
      props: {
        botKey: bot,
        pair: 'OP/USDC:USDC',
        tf: '15m',
        candles: strategyCandles(),
        plotConfig,
        subChoice: null,
        source: sb.source,
        ...extra,
      } as never,
      attachTo: document.body,
    });

  it('draws one sub-chart with a plain title and a line of explanation, not three raw names', async () => {
    const w = mountChart();
    await flushPromises();
    const heads = w.findAll('[data-testid=candle-subhd]');
    expect(heads).toHaveLength(1);
    // The RSI is the default; the group is named "RSI 14" and holds one series: plain title
    expect(heads[0]!.find('b').text()).toBe('RSI 14, price momentum');
    expect(heads[0]!.find('.why').text()).toContain('70');
    expect(heads[0]!.find('b').attributes('title')).toBe('rsi_14');
    // price + volume + one sub-chart
    expect((charts[0]!.last() as { grid: unknown[] }).grid).toHaveLength(3);
  });

  it('offers the others under the chart, and adding one tells the parent to remember it', async () => {
    const w = mountChart();
    await flushPromises();
    const picks = w.findAll('[data-testid=candle-sub-add]');
    expect(picks.map((p) => p.text())).toEqual([
      'VWAP low',
      'RSI, signal marker',
      'RSI, price momentum',
    ]);
    expect(picks[0]!.attributes('title')).toBe('I-vwap_low');
    await picks[0]!.trigger('click');
    expect(w.emitted('update:subChoice')![0]).toEqual([['RSI 14', 'VWAP bas']]);
  });

  it('shows the ones the parent kept, and hiding one hands back the rest', async () => {
    const w = mountChart({ subChoice: ['RSI 14', 'Signaux'] });
    await flushPromises();
    expect(w.findAll('[data-testid=candle-subhd] b').map((b) => b.text())).toEqual([
      'RSI 14, price momentum',
      'RSI, signal marker',
    ]);
    // VWAP low and the app's own RSI are left to add
    expect(w.findAll('[data-testid=candle-sub-add]')).toHaveLength(2);
    await w.findAll('[data-testid=candle-sub-hide]')[0]!.trigger('click');
    expect(w.emitted('update:subChoice')![0]).toEqual([['Signaux']]);
  });

  it('reports what the strategy offers, for the indicators sheet', async () => {
    const w = mountChart();
    await flushPromises();
    const list = w.emitted('subplots')!.at(-1)![0] as Array<{ id: string; shown: boolean }>;
    expect(list.map((s) => [s.id, s.shown])).toEqual([
      ['RSI 14', true],
      ['VWAP bas', false],
      ['Signaux', false],
      ['builtin:rsi', false],
    ]);
  });

  it('without a choice from the parent (Bot page) every sub-chart is drawn, untitled', async () => {
    const w = mountChart({ subChoice: undefined });
    await flushPromises();
    expect(w.findAll('[data-testid=candle-subhd]')).toHaveLength(0);
    expect((charts[0]!.last() as { grid: unknown[] }).grid).toHaveLength(6);
  });
});

describe('Charts: a level off the price range is announced at the edge', () => {
  it('writes "↑ Liquidation à ... hors écran" with the distance, and nothing when it is on screen', async () => {
    const candles = makeCandles(120);
    const last = candles.data[candles.data.length - 1]![4]!;
    const w = mountFq(CandleChart, {
      props: {
        botKey: bot,
        pair: 'OP/USDC:USDC',
        tf: '15m',
        candles,
        plotConfig: { main_plot: {}, subplots: {} },
        subChoice: null,
        source: sb.source,
        overlays: { average: last * 1.02, liquidation: last * 1.47 },
      } as never,
      attachTo: document.body,
    });
    await flushPromises();
    const chart = charts[0]!;
    // The chart shows last*0.9 .. last*1.1 (the liquidation does not stretch the axis)
    chart.convertFromPixel.mockImplementation((_f: unknown, y: number) =>
      y < 100 ? last * 1.1 : last * 0.9,
    );
    chart.handlers.get('finished')!({});
    await flushPromises();
    const items = w.findAll('[data-testid=candle-far-level]');
    expect(items).toHaveLength(1);
    expect(items[0]!.text()).toMatch(/^↑ Liquidation at .* \(\+47%\), off screen$/);
    // The user zooms out: the liquidation is in range, the announcement goes
    chart.convertFromPixel.mockImplementation((_f: unknown, y: number) =>
      y < 100 ? last * 1.6 : last * 0.5,
    );
    chart.handlers.get('finished')!({});
    await flushPromises();
    expect(w.findAll('[data-testid=candle-far-level]')).toHaveLength(0);
  });
});
