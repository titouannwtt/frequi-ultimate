import { mount } from '@vue/test-utils';
import type { ECharts } from 'echarts/core';
import { afterEach, describe, expect, it } from 'vitest';

import BaseChart from '@/components/ds/BaseChart.vue';
// Loading the component registers the ECharts parts it needs (the dataset component)
import '@/components/fq/CandleChart.vue';
import { makeCandles } from '@/components/fq/fixtures/charts';
import {
  ALL_OVERLAYS,
  buildCandleOption,
  paneLayout,
  subplotCount,
  toCandleSet,
  type CandleOptionInput,
} from '@/components/fq/lib/candles';

const tokens = new Proxy({}, { get: () => '#888888' }) as CandleOptionInput['tokens'];

function input(over: Partial<CandleOptionInput> = {}): CandleOptionInput {
  return {
    set: toCandleSet(makeCandles(300)),
    heikinAshi: false,
    plotConfig: { main_plot: { ema_50: { color: '#4cbbe9' } }, subplots: {} } as never,
    rsi: true,
    overlays: { average: 4.1, liquidation: 3.4, tp: 4.35 },
    toggles: ALL_OVERLAYS,
    tokens,
    labels: {
      average: 'Avg',
      tp: 'TP',
      liquidation: 'Liq.',
      candles: 'Candles',
      volume: 'Volume',
      entry: 'Entry',
      dca: 'DCA',
      exit: 'Exit',
    },
    fmtPrice: (v) => v.toFixed(3),
    visibleCandles: 100,
    initialZoom: true,
    labelSide: 'right',
    ...over,
  };
}

const wrappers: Array<{ unmount: () => void }> = [];
afterEach(() => {
  for (const w of wrappers.splice(0)) w.unmount();
});

/**
 * The real BaseChart with the real option. happy-dom has no canvas, so the SVG renderer stands in:
 * what is checked is that the series receive their data, not the pixels.
 */
function render(option: ReturnType<typeof buildCandleOption>): ECharts {
  const w = mount(BaseChart, {
    props: {
      option,
      renderer: 'svg',
      replaceMerge: ['series', 'grid', 'xAxis', 'yAxis'],
      height: '320px',
    },
    attachTo: document.body,
  });
  wrappers.push(w);
  const chart = (w.vm as unknown as { chart: ECharts }).chart;
  // BaseChart updates lazily (next frame): apply the same option now so the series can be read
  chart.setOption({ ...option, animation: false }, { notMerge: true, lazyUpdate: false });
  return chart;
}

const seriesCounts = (chart: ECharts) => {
  return chart
    .getModel()
    .getSeries()
    .map((s) => s.getData().count());
};

describe('CandleChart option rendered by ECharts', () => {
  it('feeds the candles of the zoom window to the series (the dataset component is registered)', () => {
    const chart = render(buildCandleOption(input()));
    const [candles] = seriesCounts(chart);
    // 100 candles are visible out of 300; without the dataset component there would be none
    expect(candles).toBeGreaterThanOrEqual(95);
    expect(candles).toBeLessThanOrEqual(105);
  });

  it('Heikin-Ashi keeps the same number of candles', () => {
    const chart = render(buildCandleOption(input({ heikinAshi: true })));
    expect(seriesCounts(chart)[0]).toBeGreaterThanOrEqual(95);
  });

  it('the volume, the indicator and the RSI series get their data too', () => {
    const chart = render(buildCandleOption(input()));
    const counts = seriesCounts(chart);
    // candles, volume, ema_50 and rsi
    expect(counts.length).toBeGreaterThanOrEqual(4);
    expect(counts.every((n) => n > 0)).toBe(true);
  });

  it('a new candle merges into the same chart without losing the zoom window', () => {
    const fx = makeCandles(300);
    const chart = render(buildCandleOption(input({ set: toCandleSet(fx) })));
    const before = seriesCounts(chart)[0]!;
    const next = fx.data[fx.data.length - 1]!.slice();
    next[0] = (next[0] as number) + fx.timeframe_ms;
    next[6] = next[0] as number;
    // Later updates leave the zoom out (initialZoom false) and keep the user's window
    const grown = buildCandleOption(
      input({ set: toCandleSet({ ...fx, data: [...fx.data, next] }), initialZoom: false }),
    );
    chart.setOption(
      { ...grown, animation: false },
      { replaceMerge: ['series', 'grid', 'xAxis', 'yAxis'], lazyUpdate: false },
    );
    const after = seriesCounts(chart)[0]!;
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  });
});

describe('pane layout of the candle chart (B193)', () => {
  const four = {
    main_plot: {},
    subplots: { a: { a: {} }, b: { b: {} }, c: { c: {} }, d: { d: {} } },
  } as never;

  it('keeps a price pane of a useful height when four sub-charts are asked for', () => {
    // The QA chart was about 330 px high: the old percent layout left ~60 px to the price pane
    const l = paneLayout({ heightPx: 330, hasVolume: true, subCount: 4, showSubplots: true });
    expect(l.main.height).toBeGreaterThanOrEqual(160);
    expect(l.main.height).toBeGreaterThan(330 * 0.5);
    // What does not fit is dropped, not squeezed
    expect(l.subs.length).toBeLessThan(4);
    const last = l.subs[l.subs.length - 1] ?? l.volume!;
    expect(last.top + last.height).toBeLessThanOrEqual(330);
  });

  it('shows every sub-chart when the chart is tall enough, and none when they are switched off', () => {
    expect(
      paneLayout({ heightPx: 900, hasVolume: true, subCount: 4, showSubplots: true }).subs,
    ).toHaveLength(4);
    const off = paneLayout({ heightPx: 900, hasVolume: true, subCount: 4, showSubplots: false });
    expect(off.subs).toHaveLength(0);
    expect(off.volume).not.toBeNull();
    expect(off.main.height).toBeGreaterThan(700);
  });

  it('never gives the panes overlapping positions, and survives an unknown height', () => {
    const l = paneLayout({ heightPx: 0, hasVolume: true, subCount: 2, showSubplots: true });
    const panes = [l.main, l.volume!, ...l.subs];
    for (let i = 1; i < panes.length; i++) {
      expect(panes[i]!.top).toBeGreaterThanOrEqual(panes[i - 1]!.top + panes[i - 1]!.height);
    }
  });

  it('the option has one grid per drawn pane: the sub-charts that do not fit leave no series', () => {
    const set = toCandleSet(makeCandles(60));
    const plotConfig = {
      main_plot: {},
      subplots: { rsi_pane: { rsi: {} }, ema_pane: { ema_50: {} } },
    } as never;
    const small = buildCandleOption(input({ set, plotConfig, heightPx: 330 })) as {
      grid: unknown[];
    };
    const tall = buildCandleOption(input({ set, plotConfig, heightPx: 900 })) as {
      grid: unknown[];
    };
    const off = buildCandleOption(
      input({ set, plotConfig, heightPx: 900, showSubplots: false }),
    ) as {
      grid: unknown[];
    };
    expect(small.grid.length).toBeLessThan(tall.grid.length);
    expect(tall.grid).toHaveLength(4); // price, volume, two sub-charts
    expect(off.grid).toHaveLength(2);
  });

  it('counts the sub-charts the plot config asks for, RSI included when it is added', () => {
    const columns = ['date', 'rsi'];
    expect(subplotCount(four, true, columns)).toBe(5);
    expect(subplotCount(four, false, columns)).toBe(4);
    expect(subplotCount({ main_plot: {}, subplots: {} } as never, true, ['rsi'])).toBe(1);
    expect(
      subplotCount({ main_plot: {}, subplots: { r: { rsi: {} } } } as never, true, columns),
    ).toBe(1);
  });
});
