import { describe, expect, it } from 'vitest';

import {
  buildProfitCurves,
  buildProfitOption,
  customRange,
  profitRange,
  PROFIT_PERIODS,
  rangeDates,
  valueAt,
} from '../../src/components/fq/lib/profit';
import { periodStartMs } from '../../src/components/fq/lib/equity';
import { cutCurve, decimate } from '../../src/datasource/calc/equityCurve';
import type { EquitySeries } from '../../src/datasource/types';

const H = 3_600_000;
const D = 24 * H;
// 2027-01-15 12:00 UTC: far from a daylight saving change in Paris
const NOW = Date.UTC(2027, 0, 15, 12, 0, 0);

const series = (
  points: Array<[number, number]>,
  base: number | null,
  mode: 'realized' | 'with_open' = 'realized',
): EquitySeries => ({ mode, points, base, unavailable: null, asOfMs: NOW });

describe('the periods of the Profit block', () => {
  it('offers 24 h, 7 d, 30 d, 90 d, 1 year and the whole history', () => {
    expect(PROFIT_PERIODS).toEqual(['24h', '7d', '30d', '90d', '1y', 'all']);
  });

  it('cuts 90 days as 90 days of 24 h and 1 year on the calendar', () => {
    expect(periodStartMs('90d', NOW, 'Europe/Paris')).toBe(NOW - 90 * D);
    expect(periodStartMs('7d', NOW, 'Europe/Paris')).toBe(NOW - 7 * D);
    // 2026-01-15 12:00 UTC is 13:00 in Paris, as 2027-01-15 12:00 UTC is: a whole 365 days
    expect(periodStartMs('1y', NOW, 'Europe/Paris')).toBe(NOW - 365 * D);
    expect(periodStartMs('all', NOW, 'Europe/Paris')).toBeUndefined();
  });

  it('turns a period into a range, open-ended on the right, and "all" into no range', () => {
    expect(profitRange('90d', null, NOW, 'UTC')).toEqual({ fromMs: NOW - 90 * D });
    expect(profitRange('1y', null, NOW, 'UTC')).toEqual({ fromMs: NOW - 365 * D });
    expect(profitRange('all', null, NOW, 'UTC')).toEqual({});
  });

  it('uses the custom range as is, and none when it has not been picked', () => {
    const custom = { fromMs: 10, toMs: 20 };
    expect(profitRange('custom', custom, NOW, 'UTC')).toEqual({ fromMs: 10, toMs: 20 });
    expect(profitRange('custom', null, NOW, 'UTC')).toEqual({});
  });

  it('reads the days of the picker as days of the time zone, the last one included', () => {
    const r = customRange(new Date(2027, 0, 3), new Date(2027, 0, 5), 'UTC');
    expect(r.fromMs).toBe(Date.UTC(2027, 0, 3));
    expect(r.toMs).toBe(Date.UTC(2027, 0, 6) - 1);
    // One day clicked: that day, whole
    const one = customRange(new Date(2027, 0, 3), null, 'UTC');
    expect(one).toEqual({ fromMs: Date.UTC(2027, 0, 3), toMs: Date.UTC(2027, 0, 4) - 1 });
    // The wrong way round is put right
    expect(customRange(new Date(2027, 0, 5), new Date(2027, 0, 3), 'UTC')).toEqual(r);
    // Paris is one hour ahead of UTC in winter: the day starts at 23:00 UTC the day before
    const paris = customRange(new Date(2027, 0, 3), null, 'Europe/Paris');
    expect(paris.fromMs).toBe(Date.UTC(2027, 0, 2, 23));
    expect(paris.toMs - paris.fromMs).toBe(D - 1);
  });

  it('gives the picker back the days it was given', () => {
    const r = customRange(new Date(2027, 0, 3), new Date(2027, 0, 5), 'Europe/Paris');
    const [a, b] = rangeDates(r, 'Europe/Paris')!;
    expect([a!.getFullYear(), a!.getMonth(), a!.getDate()]).toEqual([2027, 0, 3]);
    expect([b!.getFullYear(), b!.getMonth(), b!.getDate()]).toEqual([2027, 0, 5]);
    expect(rangeDates(null, 'UTC')).toBeNull();
  });
});

describe('the range cut of a curve (port of the gateway)', () => {
  const raw = Array.from({ length: 10 }, (_, i): [number, number] => [i * 1000, i]);

  it('includes both ends and gives the value before the range', () => {
    const c = cutCurve(raw, 2000, 5000, undefined);
    expect(c.points.map((p) => p[0])).toEqual([2000, 3000, 4000, 5000]);
    expect(c.base).toBe(1);
    expect(cutCurve(raw, 3500, undefined, undefined).base).toBe(3);
    expect(cutCurve(raw, undefined, undefined, undefined).base).toBeNull();
  });

  it('cuts first and decimates after, keeping the ends of the range', () => {
    const long = Array.from({ length: 1000 }, (_, i): [number, number] => [i * 1000, i]);
    const c = cutCurve(long, 100_000, 199_000, 10);
    expect(c.points.length).toBeLessThanOrEqual(10);
    expect(c.points.length).toBeGreaterThanOrEqual(9);
    expect(c.points[0]![0]).toBe(100_000);
    expect(c.points[c.points.length - 1]![0]).toBe(199_000);
  });

  it('answers an empty range with nothing, not an error', () => {
    expect(cutCurve(raw, 50_000, 60_000, 10).points).toEqual([]);
    expect(cutCurve(raw, 5000, 2000, 10).points).toEqual([]);
    expect(cutCurve([], 0, 10, 10)).toEqual({ base: null, points: [] });
    expect(decimate([[1, 1]], 5)).toEqual([[1, 1]]);
  });
});

describe('the two curves, set to zero where the period starts', () => {
  const from = NOW - 30 * D;

  it('shifts the realised curve by what was earned before the period', () => {
    const r = series(
      [
        [from + 2 * D, 107],
        [from + 5 * D, 90],
      ],
      100,
    );
    const c = buildProfitCurves(r, null, from, NOW);
    // Starts at 0 on the first day of the period, then the profit of the period only
    expect(c.realized[0]).toEqual([from, 0]);
    expect(c.realized.slice(1, 3)).toEqual([
      [from + 2 * D, 7],
      [from + 5 * D, -10],
    ]);
    expect(c.realizedProfit).toBe(-10);
    expect(c.withOpen).toEqual([]);
    expect(c.profit).toBe(-10);
    expect(c.trackedSince).toBeNull();
  });

  it('extends the realised curve flat to the end of the range', () => {
    const c = buildProfitCurves(series([[from + D, 5]], 0), null, from, NOW);
    expect(c.realized[c.realized.length - 1]).toEqual([NOW, 5]);
  });

  it('draws a flat zero when the bots made no trade over the period', () => {
    const c = buildProfitCurves(series([], 42), null, from, NOW);
    expect(c.realized).toEqual([
      [from, 0],
      [NOW, 0],
    ]);
    expect(c.realizedProfit).toBe(0);
  });

  it('starts at the first point when the history begins inside the period, from zero profit', () => {
    const c = buildProfitCurves(series([[from + D, 3]], null), null, from, NOW);
    expect(c.realized[0]).toEqual([from + D, 3]);
  });

  it('shifts the curve with the open positions by its own value at the start of the period', () => {
    const r = series([[from + D, 110]], 100);
    const o = series(
      [
        [from + H, 104],
        [from + D, 115],
        [NOW, 112],
      ],
      102,
      'with_open',
    );
    const c = buildProfitCurves(r, o, from, NOW);
    expect(c.withOpen[0]).toEqual([from, 0]);
    expect(c.withOpen.slice(1)).toEqual([
      [from + H, 2],
      [from + D, 13],
      [NOW, 10],
    ]);
    expect(c.profit).toBe(10);
    expect(c.realizedProfit).toBe(10);
    expect(c.trackedSince).toBeNull();
  });

  it('starts the curve with the open positions at its first point, on the realised curve, and says since when', () => {
    const tracked = from + 20 * D;
    const r = series(
      [
        [from + 3 * D, 105],
        [tracked - D, 120],
      ],
      100,
    );
    // Its first point is 130 when 20 had been won by the closed trades: 10 of latent profit
    const o = series(
      [
        [tracked, 130],
        [tracked + D, 135],
      ],
      null,
      'with_open',
    );
    const c = buildProfitCurves(r, o, from, NOW);
    expect(c.withOpen[0]).toEqual([tracked, 20]);
    expect(c.withOpen[1]).toEqual([tracked + D, 25]);
    expect(c.trackedSince).toBe(tracked);
    expect(c.profit).toBe(25);
  });

  it('says nothing when the tracking starts with the period, or within the hour', () => {
    const o = series([[from + 10 * 60_000, 5]], null, 'with_open');
    expect(buildProfitCurves(series([], 0), o, from, NOW).trackedSince).toBeNull();
    // The whole history: tracked since the first point of the sample, after the first trade
    const all = buildProfitCurves(
      series([[NOW - 400 * D, 1]], null),
      series([[NOW - 60 * D, 50]], null, 'with_open'),
      undefined,
      NOW,
    );
    expect(all.trackedSince).toBe(NOW - 60 * D);
  });

  it('reads a curve at an instant, carrying the last value forward', () => {
    const pts: Array<[number, number]> = [
      [10, 1],
      [20, 5],
    ];
    expect(valueAt(pts, 5)).toBeNull();
    expect(valueAt(pts, 10)).toBe(1);
    expect(valueAt(pts, 19)).toBe(1);
    expect(valueAt(pts, 99)).toBe(5);
    expect(valueAt([], 1)).toBeNull();
  });
});

describe('the drawing of the two curves', () => {
  const tokens = {
    fg: '#fff',
    fg2: '#ccc',
    fg3: '#999',
    line: '#111',
    line2: '#222',
    bg1: '#000',
    bg2: '#000',
    accent: '#00f',
    profit: '#0f0',
    loss: '#f00',
    warn: '#ff0',
    info: '#0ff',
    fontNum: 'mono',
    fontUi: 'sans',
  };
  const input = (withOpen: Array<[number, number]>) => ({
    curves: {
      realized: [
        [0, 0],
        [10, 4],
      ] as Array<[number, number]>,
      withOpen,
      profit: 1,
      realizedProfit: 4,
      trackedSince: null,
    },
    tokens,
    fmtValue: (v: number) => v.toFixed(2),
    fmtDate: String,
    fmtFull: (ts: number) => `t${ts}`,
    labels: { realized: 'Réalisé', withOpen: 'Avec positions', gap: 'Écart' },
  });

  it('draws both curves and reads date, realised, with positions and the gap in the tooltip', () => {
    const opt = buildProfitOption(
      input([
        [0, 0],
        [10, 1],
      ]),
    );
    const series = opt.series as Array<{ id: string }>;
    expect(series.map((s) => s.id)).toEqual(['realized', 'with_open']);
    const fn = (opt.tooltip as { formatter: (p: unknown) => string }).formatter;
    const html = fn([{ axisValue: 10 }]);
    expect(html).toContain('t10');
    expect(html).toContain('Réalisé');
    expect(html).toContain('+4.00');
    expect(html).toContain('Avec positions');
    expect(html).toContain('+1.00');
    expect(html).toContain('Écart');
    expect(html).toContain('-3.00');
  });

  it('leaves out the second curve and the gap when there is no sampled history', () => {
    const fn = (buildProfitOption(input([])).tooltip as { formatter: (p: unknown) => string })
      .formatter;
    const html = fn([{ axisValue: 10 }]);
    expect(html).toContain('Réalisé');
    expect(html).not.toContain('Écart');
    expect(html).not.toContain('Avec positions');
  });
});
