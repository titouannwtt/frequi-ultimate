import { describe, expect, it } from 'vitest';

import type { HistorySample } from '@/gateway/types.gen';
import { dropPartialSamples, mergeHistories } from '@/datasource/calc/drawdown';

const s = (ts_ms: number, closed: number, open: number, open_trades?: number): HistorySample => ({
  ts_ms,
  closed,
  open,
  open_trades,
});

// hyperliquid_hippo_original_multi, 2026-10-16: the 13:26 sample was written with no price known.
const hippo = [
  s(1, 1224.05, -545.91, 2),
  s(2, 1224.05, -545.91, 2),
  s(3, 1224.05, 0, 0),
  s(4, 1224.05, -549.42, 2),
  s(5, 1224.05, -553.4, 2),
];

describe('samples written without prices (B600)', () => {
  it('does not spike the fleet curve', () => {
    const steady = [1, 2, 3, 4, 5].map((t) => s(t, 100, -400, 1));
    const merged = mergeHistories([hippo, steady]);
    expect(merged).toHaveLength(5);
    const values = merged.map((p) => p[1]);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(10);
    expect(merged[2][1]).toBeCloseTo(1224.05 - 545.91 + 100 - 400, 9);
  });

  it('drops a sample missing one of two positions', () => {
    const kept = dropPartialSamples([
      s(1, 1224.05, -615.09, 2),
      s(2, 1224.05, -21.31, 1),
      s(3, 1224.05, -610.94, 2),
    ]);
    expect(kept.map((x) => x.ts_ms)).toEqual([1, 3]);
  });

  it('drops a run of unpriced samples over hours (hippo, 2026-10-16 07:14 to 11:36)', () => {
    const step = 25 * 60_000;
    const run = [
      s(0, 5, -528, 2),
      ...Array.from({ length: 11 }, (_, i) => s((i + 1) * step, 5, 0, 0)),
      s(12 * step, 5, -520, 2),
    ];
    expect(dropPartialSamples(run).map((x) => x.ts_ms)).toEqual([0, 12 * step]);
  });

  it('keeps a run longer than 12 hours, a real close and reopen, and samples without a count', () => {
    const H = 3_600_000;
    const long = [
      s(0, 5, -10, 2),
      ...Array.from({ length: 13 }, (_, i) => s((i + 1) * H, 5, 0, 0)),
      s(14 * H, 5, -11, 2),
    ];
    expect(dropPartialSamples(long)).toHaveLength(15);
    const reopened = [s(1, 5, -10, 2), s(2, 7, 0, 0), s(3, 7, -3, 2)];
    expect(dropPartialSamples(reopened)).toHaveLength(3);
    const noCount = [s(1, 1, -5), s(2, 1, 0), s(3, 1, -5)];
    expect(dropPartialSamples(noCount)).toHaveLength(3);
  });
});
