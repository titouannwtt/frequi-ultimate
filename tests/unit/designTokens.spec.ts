import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DURATIONS, EASINGS, HOLD_MS } from '../../src/utils/motion';

const css = readFileSync(resolve(__dirname, '../../src/styles/tokens.css'), 'utf-8');

/** Declarations of the first rule whose selector contains `selector`. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThan(-1);
  const open = css.indexOf('{', start);
  const close = css.indexOf('\n}', open);
  const out: Record<string, string> = {};
  const body = css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].replace(/\s+/g, ' ').trim();
  }
  return out;
}

const dark = block(":root[data-theme='dark']");
const light = block(":root[data-theme='light']");

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('design tokens', () => {
  it('defines the same color tokens in both themes', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });

  it('gives every semantic color a -w background variant', () => {
    for (const name of ['accent', 'profit', 'loss', 'crit', 'warn', 'info', 'live', 'dry']) {
      expect(dark[`--${name}-w`], `dark --${name}-w`).toBeDefined();
      expect(light[`--${name}-w`], `light --${name}-w`).toBeDefined();
    }
  });

  it('maps long/short to profit/loss (owner decision 2026-10-15)', () => {
    for (const theme of [dark, light]) {
      expect(theme['--long']).toBe('var(--profit)');
      expect(theme['--short']).toBe('var(--loss)');
      expect(theme['--long-w']).toBe('var(--profit-w)');
      expect(theme['--short-w']).toBe('var(--loss-w)');
    }
  });

  it('keeps text tokens at AA contrast (4.5:1) on --bg-1 in both themes', () => {
    for (const [name, theme] of [
      ['dark', dark],
      ['light', light],
    ] as const) {
      for (const token of [
        'fg',
        'fg-2',
        'fg-3',
        'accent',
        'profit',
        'loss',
        'crit',
        'warn',
        'info',
        'live',
        'dry',
      ]) {
        const ratio = contrast(theme[`--${token}`], theme['--bg-1']);
        expect(ratio, `${name} --${token} on --bg-1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps --crit visibly distinct from --loss and --live reserved', () => {
    expect(dark['--crit']).not.toBe(dark['--loss']);
    expect(light['--crit']).not.toBe(light['--loss']);
    expect(dark['--live']).not.toBe(dark['--accent']);
  });

  it('uses 11 px as the smallest text size', () => {
    expect(css).toContain('--t-xs: 11px');
  });

  it('mirrors the motion constants of utils/motion.ts', () => {
    const root = block(':root {\n  --font-ui');
    expect(root['--d-instant']).toBe(`${DURATIONS.instant}ms`);
    expect(root['--d-fast']).toBe(`${DURATIONS.fast}ms`);
    expect(root['--d-base']).toBe(`${DURATIONS.base}ms`);
    expect(root['--d-slow']).toBe(`${DURATIONS.slow}ms`);
    expect(root['--d-flash']).toBe(`${DURATIONS.flash}ms`);
    expect(root['--hold']).toBe(`${HOLD_MS}ms`);
    const compact = (s: string) => s.replace(/\s+/g, '').replace(/(^|[^\d])\.(\d)/g, '$10.$2');
    expect(compact(root['--e-out'])).toBe(compact(EASINGS.out));
    expect(compact(root['--e-inout'])).toBe(compact(EASINGS.inout));
    expect(compact(root['--e-spring'])).toBe(compact(EASINGS.spring));
  });

  it('never reduces the hold delay under reduced motion', () => {
    const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
    const reduced = css.slice(start);
    expect(reduced).not.toContain('--hold');
    expect(reduced).toContain('--d-flash: 1ms');
  });
});
