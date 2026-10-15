import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildChartTheme,
  readChartTokens,
  readChartTokensFor,
} from '../../src/components/ds/lib/chartTheme';
import { ageMs, isStale } from '../../src/components/ds/lib/freshness';
import {
  formatAge,
  formatDuration,
  formatNumber,
  formatPercent,
  formatPrice,
  formatSigned,
  priceDecimals,
  signClass,
} from '../../src/components/ds/lib/format';
import { layoutLadderV, priceToY, spreadLabels } from '../../src/components/ds/lib/ladder';
import { buildSparkline } from '../../src/components/ds/lib/sparkline';
import {
  compareValues,
  sortRows,
  virtualWindow,
  visibleColumns,
} from '../../src/components/ds/lib/table';
import { useInflightLock } from '../../src/composables/useInflightLock';
import { defaultTtl } from '../../src/composables/useToaster';

describe('format', () => {
  it('signs with + and U+2212, never for a rounded zero', () => {
    expect(formatSigned(1.234, 2)).toBe('+1.23');
    expect(formatSigned(-1.234, 2)).toBe('−1.23');
    expect(formatSigned(0.004, 2)).toBe('0.00');
    expect(formatSigned(-0.004, 2)).toBe('0.00');
    expect(formatNumber(-0.004, 2)).toBe('0.00');
    expect(formatNumber(Number.NaN)).toBe('');
  });

  it('formats FR with thin spaces and a comma, EN with commas and a point', () => {
    expect(formatNumber(1234567.891, 2, 'fr')).toBe('1\u202f234\u202f567,89');
    expect(formatNumber(1234567.891, 2, 'en')).toBe('1,234,567.89');
    expect(formatPercent(12.345, 2, 'fr')).toBe('+12,35\u202f%');
    expect(formatPercent(12.345, 2, 'en')).toBe('+12.35%');
    expect(formatPercent(12.345, 1, 'fr', false)).toBe('12,3\u202f%');
  });

  it('picks 1 to 6 decimals for a price from its magnitude', () => {
    expect(priceDecimals(43210)).toBe(1);
    expect(priceDecimals(184.2)).toBe(2);
    expect(priceDecimals(4.5)).toBe(3);
    expect(priceDecimals(0.45)).toBe(4);
    expect(priceDecimals(0.0045)).toBe(6);
    expect(formatPrice(184.2, 'en')).toBe('184.20');
  });

  it('formats durations and ages', () => {
    expect(formatDuration(0.7, 'fr')).toBe('42 min');
    expect(formatDuration(23 + 4 / 60, 'fr')).toBe('23 h 04');
    expect(formatDuration(52, 'fr')).toBe('2 j 4 h');
    expect(formatDuration(52, 'en')).toBe('2 d 4 h');
    expect(formatAge(12_000)).toBe('12 s');
    expect(formatAge(180_000)).toBe('3 min');
    expect(formatAge(7_500_000)).toBe('2 h');
    expect(formatAge(3 * 86_400_000, 'fr')).toBe('3 j');
    expect(formatAge(-5)).toBe('0 s');
  });

  it('classifies the sign for colouring', () => {
    expect(signClass(5)).toBe('up');
    expect(signClass(-5)).toBe('down');
    expect(signClass(0.001)).toBe('flat');
    expect(signClass(Number.NaN)).toBe('flat');
  });
});

describe('freshness', () => {
  it('uses the server clock: now + skew', () => {
    expect(ageMs(1000, 5000, 0)).toBe(4000);
    expect(ageMs(1000, 5000, -1500)).toBe(2500);
    expect(ageMs(9000, 5000, 0)).toBe(0);
    expect(isStale(360_001, 360_000)).toBe(true);
    expect(isStale(360_000, 360_000)).toBe(false);
  });
});

describe('table helpers', () => {
  it('compares numbers numerically and strings naturally', () => {
    expect(compareValues(2, 10)).toBeLessThan(0);
    expect(compareValues('bot2', 'bot10')).toBeLessThan(0);
    expect(compareValues('Alpha', 'alpha')).toBe(0);
  });

  it('sorts stably, both directions, missing last', () => {
    const rows = [
      { id: 1, v: 3 },
      { id: 2, v: null },
      { id: 3, v: 3 },
      { id: 4, v: 1 },
    ];
    const get = (r: { v: number | null }) => r.v;
    expect(sortRows(rows, { id: 'v', dir: 'asc' }, get).map((r) => r.id)).toEqual([4, 1, 3, 2]);
    expect(sortRows(rows, { id: 'v', dir: 'desc' }, get).map((r) => r.id)).toEqual([1, 3, 4, 2]);
    expect(sortRows(rows, null, get).map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });

  it('filters columns by container width', () => {
    const cols = [{ id: 'a' }, { id: 'b', hideBelow: 500 }, { id: 'c', hideBelow: 900 }];
    expect(visibleColumns(cols, 0).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(visibleColumns(cols, 500).map((c) => c.id)).toEqual(['a', 'b']);
    expect(visibleColumns(cols, 499).map((c) => c.id)).toEqual(['a']);
  });

  it('computes a virtual window whose spacers keep the full height', () => {
    const w = virtualWindow({
      count: 1000,
      rowHeight: 30,
      scrollTop: 3000,
      viewHeight: 300,
      overscan: 5,
    });
    expect(w.start).toBe(95);
    expect(w.end).toBe(115);
    expect(w.padTop + (w.end - w.start) * 30 + w.padBottom).toBe(30_000);
    const end = virtualWindow({ count: 1000, rowHeight: 30, scrollTop: 29_900, viewHeight: 300 });
    expect(end.end).toBe(1000);
    expect(end.padBottom).toBe(0);
    const empty = virtualWindow({ count: 0, rowHeight: 30, scrollTop: 0, viewHeight: 300 });
    expect(empty).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });
});

describe('ladder helpers', () => {
  it('spreads colliding labels at least minGap apart and keeps the input order', () => {
    const out = spreadLabels(
      [
        { id: 'a', y: 100 },
        { id: 'b', y: 101 },
        { id: 'c', y: 102 },
      ],
      15,
    );
    expect(out.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    expect(out.map((o) => o.labelY)).toEqual([100, 115, 130]);
  });

  it('does not move labels that are far enough apart', () => {
    const out = spreadLabels(
      [
        { id: 'a', y: 10 },
        { id: 'b', y: 60 },
      ],
      15,
    );
    expect(out.map((o) => o.labelY)).toEqual([10, 60]);
  });

  it('orders by position, not by input order', () => {
    const out = spreadLabels(
      [
        { id: 'low', y: 90 },
        { id: 'high', y: 10 },
        { id: 'mid', y: 12 },
      ],
      15,
    );
    const byId = Object.fromEntries(out.map((o) => [o.id, o.labelY]));
    expect(byId).toEqual({ high: 10, mid: 25, low: 90 });
  });

  it('shifts the stack back up when it would run past the bottom', () => {
    const out = spreadLabels(
      [
        { id: 'a', y: 95 },
        { id: 'b', y: 96 },
        { id: 'c', y: 97 },
      ],
      15,
      100,
    );
    expect(out.map((o) => o.labelY)).toEqual([70, 85, 100]);
  });

  it('maps prices to rows for a long (prices going down) and clamps outside', () => {
    const orders = [184, 180, 176].map((price, k) => ({
      id: String(k),
      label: String(k),
      price,
      stake: 1,
      state: 'filled' as const,
    }));
    expect(priceToY(184, orders)).toBe(4 + 14);
    expect(priceToY(180, orders)).toBe(4 + 14 + 28);
    expect(priceToY(182, orders)).toBe(4 + 14 + 14);
    expect(priceToY(500, orders)).toBeGreaterThanOrEqual(2);
    expect(priceToY(1, orders)).toBeLessThanOrEqual(4 + 3 * 28 - 2);
  });

  it('lays out a ladder with bar widths proportional to the stakes', () => {
    const layout = layoutLadderV(
      [
        { id: 'e', label: 'E', price: 10, stake: 10, state: 'filled' },
        { id: 's', label: 'S', price: 9, stake: 20, state: 'pending' },
      ],
      [{ kind: 'px', price: 9.5, text: 'x' }],
    );
    expect(layout.rows.map((r) => r.widthPct)).toEqual([24, 48]);
    expect(layout.lines).toHaveLength(1);
  });
});

describe('sparkline', () => {
  it('always includes zero in the range and ends on the last value', () => {
    const g = buildSparkline([2, 3, 5], 60, 20);
    expect(g.up).toBe(true);
    expect(g.last).toBe(5);
    expect(g.path.startsWith('M0.0,')).toBe(true);
    expect(g.path).toContain(' L60.0,');
    expect(buildSparkline([-1, -3], 60, 20).up).toBe(false);
  });

  it('handles empty, single and non-finite data without NaN', () => {
    for (const values of [[], [4], [Number.NaN, 2]]) {
      const g = buildSparkline(values, 60, 20);
      expect(g.path).not.toContain('NaN');
      expect(Number.isFinite(g.zeroY)).toBe(true);
    }
  });
});

describe('chart theme', () => {
  it('builds from tokens with an 11 px minimum, the figure font and animation off', () => {
    const theme = buildChartTheme(readChartTokens()) as {
      animation: boolean;
      valueAxis: { axisLabel: { fontSize: number; fontFamily: string } };
      candlestick: { itemStyle: { color: string; borderColor: string } };
    };
    expect(theme.animation).toBe(false);
    expect(theme.valueAxis.axisLabel.fontSize).toBeGreaterThanOrEqual(11);
    expect(theme.valueAxis.axisLabel.fontFamily).toMatch(/monospace|mono/i);
    expect(theme.candlestick.itemStyle.color).toBe(theme.candlestick.itemStyle.borderColor);
  });

  it('reads the tokens of the requested mode, not the document mode, and restores the attribute', () => {
    const style = document.createElement('style');
    style.textContent = `
      :root[data-theme='dark'] { --fg: #e3e8ee; }
      :root[data-theme='light'] { --fg: #0f1720; }
    `;
    document.head.appendChild(style);
    const root = document.documentElement;
    try {
      root.setAttribute('data-theme', 'dark');
      expect(readChartTokensFor('dark').fg).toBe('#e3e8ee');
      expect(readChartTokensFor('light').fg).toBe('#0f1720');
      expect(root.getAttribute('data-theme')).toBe('dark');
      root.setAttribute('data-theme', 'light');
      expect(readChartTokensFor('dark').fg).toBe('#e3e8ee');
      expect(root.getAttribute('data-theme')).toBe('light');
      root.removeAttribute('data-theme');
      readChartTokensFor('light');
      expect(root.hasAttribute('data-theme')).toBe(false);
    } finally {
      root.removeAttribute('data-theme');
      style.remove();
    }
  });
});

describe('in-flight lock and toasts', () => {
  it('acquires a key once until released', () => {
    const lock = useInflightLock();
    lock.releaseAll();
    expect(lock.acquire('a:b:1')).toBe(true);
    expect(lock.acquire('a:b:1')).toBe(false);
    expect(lock.isLocked('a:b:1')).toBe(true);
    expect(lock.isLocked('a:b:2')).toBe(false);
    expect(lock.isLocked(undefined)).toBe(false);
    lock.release('a:b:1');
    expect(lock.acquire('a:b:1')).toBe(true);
    lock.releaseAll();
  });

  it('only a success fades by itself', () => {
    expect(defaultTtl('ok')).toBe(6000);
    for (const kind of ['sent', 'verify', 'err'] as const) {
      expect(defaultTtl(kind)).toBe(0);
    }
  });
});

describe('design system auto-registration', () => {
  it('keeps the ds primitives out of the global components map', () => {
    const config = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf8');
    expect(config).toContain("globsExclude: ['src/components/ds/**']");
    // The map is generated (git-ignored): only checked when a dev or build run created it
    const path = resolve(__dirname, '../../src/components.d.ts');
    if (existsSync(path)) {
      expect(readFileSync(path, 'utf8')).not.toMatch(/components\/ds\//);
    }
  });
});
