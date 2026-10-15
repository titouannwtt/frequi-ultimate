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
