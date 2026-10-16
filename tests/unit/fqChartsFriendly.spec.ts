import { describe, expect, it } from 'vitest';

import { makeCandles } from '@/components/fq/fixtures/charts';
import {
  ALL_OVERLAYS,
  BUILTIN_RSI,
  axisLevels,
  buildCandleOption,
  levelLines,
  offscreenLevels,
  paneLayout,
  resolveSubplots,
  subplotCandidates,
  toCandleSet,
  type CandleOptionInput,
} from '@/components/fq/lib/candles';
import { DEFAULT_DISPLAY, overlayToggles } from '@/composables/useChartDisplay';

const tokens = new Proxy({}, { get: (_t, k) => `#${String(k)}` }) as CandleOptionInput['tokens'];
const labels = {
  average: 'Entrée moy.',
  tp: 'Sortie visée',
  liquidation: 'Liquidation',
  candles: 'Bougies',
  volume: 'Volume',
  entry: 'Entrée',
  dca: 'Renfort',
  exit: 'Sortie',
  dcaTag: 'R',
};

describe('the price axis: one rule for every level', () => {
  const lines = (o: Parameters<typeof levelLines>[0]) =>
    levelLines(o, ALL_OVERLAYS, tokens, labels);

  it('keeps the average entry in range whatever its distance, announces a far liquidation', () => {
    const l = lines({ average: 160, liquidation: 147, tp: 96 });
    // Last close 100: the average is +60 %, the liquidation +47 %, the target -4 %
    const kept = axisLevels(l, 100);
    expect(kept).toContain(160);
    expect(kept).toContain(96);
    expect(kept).not.toContain(147);
  });

  it('brings the orders that wait in up to 40 %, not the ones beyond', () => {
    const l = lines({
      pending: [
        { id: 'a', price: 70, kind: 'dca', n: 1 },
        { id: 'b', price: 40, kind: 'dca', n: 2 },
      ],
    });
    expect(axisLevels(l, 100)).toEqual([70]);
  });

  it('without a last close only the average entry is kept', () => {
    const l = lines({ average: 5, tp: 6 });
    expect(axisLevels(l, null)).toEqual([5]);
  });
});

describe('levels outside the price range', () => {
  const l = [
    { id: 'liq', label: 'Liquidation', price: 147 },
    { id: 'avg', label: 'Entrée moy.', price: 101 },
    { id: 'so', label: 'R4', price: 40 },
  ];

  it('names those outside, with their direction and their distance from the close', () => {
    const out = offscreenLevels(l, { lo: 90, hi: 110 }, 100);
    expect(out.map((o) => [o.id, o.dir])).toEqual([
      ['liq', 'up'],
      ['so', 'down'],
    ]);
    const liq = out.find((o) => o.id === 'liq')!;
    expect(liq.pct).toBeCloseTo(47, 5);
    expect(out.find((o) => o.id === 'so')!.pct).toBeCloseTo(-60, 5);
  });

  it('says nothing when everything is on screen, orders the nearest first', () => {
    expect(offscreenLevels(l, { lo: 30, hi: 150 }, 100)).toEqual([]);
    const out = offscreenLevels(
      [
        { id: 'far', label: 'far', price: 300 },
        { id: 'near', label: 'near', price: 120 },
      ],
      { lo: 90, hi: 110 },
      100,
    );
    expect(out.map((o) => o.id)).toEqual(['near', 'far']);
  });

  it('has no distance without a close', () => {
    expect(offscreenLevels(l, { lo: 90, hi: 110 }, null)[0]!.pct).toBeNull();
  });
});

describe('sub-charts: one by default, the rest on request', () => {
  const plot = {
    main_plot: {},
    subplots: {
      Volume: { 'I-vwap_low': {} },
      RSI: { rsi_84: {} },
      Ghost: { not_a_column: {} },
    },
  } as never;
  const columns = ['date', 'rsi_84', 'I-vwap_low', 'rsi'];

  it('lists the sub-charts that have a column, plus the app RSI when none draws it', () => {
    expect(subplotCandidates(plot, true, columns).map((c) => c.id)).toEqual(
      ['Volume', 'RSI'].concat([BUILTIN_RSI]),
    );
    expect(subplotCandidates(plot, false, columns).map((c) => c.id)).toEqual(['Volume', 'RSI']);
    expect(
      subplotCandidates(
        { main_plot: {}, subplots: { A: { rsi: {} } } } as never,
        true,
        columns,
      ).map((c) => c.id),
    ).toEqual(['A']);
  });

  it('draws ONE at first: the RSI when there is one, else the first', () => {
    const c = subplotCandidates(plot, false, columns);
    expect(resolveSubplots(c, null)).toEqual(['RSI']);
    const noRsi = subplotCandidates(
      { main_plot: {}, subplots: { B: { x: {} }, C: { y: {} } } } as never,
      false,
      ['x', 'y'],
    );
    expect(resolveSubplots(noRsi, undefined)).toEqual(['B']);
    expect(resolveSubplots([], null)).toEqual([]);
  });

  it('keeps what the user chose, in the order of the strategy, and an empty choice is a choice', () => {
    const c = subplotCandidates(plot, false, columns);
    expect(resolveSubplots(c, ['RSI', 'Volume'])).toEqual(['Volume', 'RSI']);
    expect(resolveSubplots(c, [])).toEqual([]);
    // A choice that matches nothing any more falls back to the default
    expect(resolveSubplots(c, ['gone'])).toEqual(['RSI']);
  });

  it('the chart draws only the chosen ones', () => {
    const set = toCandleSet({
      ...makeCandles(80),
      columns: [
        'date',
        'open',
        'high',
        'low',
        'close',
        'volume',
        '__date_ts',
        'rsi_84',
        'I-vwap_low',
      ],
      data: makeCandles(80).data.map((r) => [...r.slice(0, 7), 50, 5]),
    });
    const base: CandleOptionInput = {
      set,
      heikinAshi: false,
      plotConfig: plot,
      rsi: false,
      overlays: {},
      toggles: ALL_OVERLAYS,
      tokens,
      labels,
      fmtPrice: (v) => v.toFixed(2),
      visibleCandles: 50,
      initialZoom: true,
      labelSide: 'right',
      heightPx: 800,
    };
    const grids = (o: Partial<CandleOptionInput>) =>
      (buildCandleOption({ ...base, ...o }) as unknown as { grid: unknown[] }).grid.length;
    // price + volume + the sub-charts
    expect(grids({})).toBe(4);
    expect(grids({ subplotIds: ['RSI'], subTitleH: 24, subH: 78 })).toBe(3);
    expect(grids({ subplotIds: [] })).toBe(2);
    // Without the volume pane the sub-chart has room where both would not fit
    expect(grids({ subplotIds: ['RSI'], subTitleH: 24, subH: 78, hideVolume: true })).toBe(2);
  });
});

describe('pane layout with titled sub-charts', () => {
  it('leaves a band above each sub-chart for its title', () => {
    const plain = paneLayout({ heightPx: 800, hasVolume: true, subCount: 2, showSubplots: true });
    const titled = paneLayout({
      heightPx: 800,
      hasVolume: true,
      subCount: 2,
      showSubplots: true,
      subTitleH: 24,
      subH: 78,
    });
    expect(titled.subs).toHaveLength(2);
    expect(titled.subs[0]!.height).toBe(78);
    // The price pane gives room to the bands
    expect(titled.main.height).toBeLessThan(plain.main.height);
    // The first title band starts right under the volume pane
    const vol = titled.volume!;
    expect(titled.subs[0]!.top - 24).toBeGreaterThanOrEqual(vol.top + vol.height);
  });

  it('does not lose a sub-chart to floating point at the exact boundary (B343)', () => {
    // 800 * 0.55 = 440.00000000000006: four sub-charts of 70 px fit exactly in the 280 px left
    const l = paneLayout({ heightPx: 800, hasVolume: true, subCount: 4, showSubplots: true });
    expect(l.subs).toHaveLength(4);
  });

  it('draws fewer sub-charts when the chart is short, never a squeezed price pane', () => {
    const l = paneLayout({
      heightPx: 420,
      hasVolume: true,
      subCount: 3,
      showSubplots: true,
      subTitleH: 44,
      subH: 78,
    });
    expect(l.subs.length).toBeLessThan(3);
    expect(l.main.height).toBeGreaterThanOrEqual(80);
  });
});

describe('what the Affichage menu switches', () => {
  it('everything is on at first, the four level lines are one switch', () => {
    expect(overlayToggles(DEFAULT_DISPLAY)).toEqual(ALL_OVERLAYS);
    const off = overlayToggles({ ...DEFAULT_DISPLAY, levels: false });
    expect([off.average, off.tp, off.safetyOrders, off.liquidation]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect([off.fills, off.pending, off.gain, off.closed]).toEqual([true, true, true, true]);
  });
});
