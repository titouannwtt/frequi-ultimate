/**
 * Cut an equity curve to a range of dates. Port of `cut_curve` and `decimate` of
 * `gateway/crates/fg-engine/src/queries.rs`: the range is cut first, the decimation comes after,
 * so a short range keeps all its points instead of the few left over from a decimated history.
 */
import type { CurvePoint } from './drawdown';

export interface CutCurve {
  /** Value just before `fromMs`; null when the curve starts inside the range. */
  base: number | null;
  points: CurvePoint[];
}

/** At most `n` evenly spread points, the first and the last always kept. */
export function decimate(points: CurvePoint[], n: number | undefined): CurvePoint[] {
  if (!n || n < 2 || points.length <= n) return points;
  const step = (points.length - 1) / (n - 1);
  const out: CurvePoint[] = [];
  for (let i = 0; i < n; i++) {
    const p = points[Math.min(points.length - 1, Math.round(i * step))]!;
    if (out.length === 0 || out[out.length - 1]![0] !== p[0]) out.push(p);
  }
  return out;
}

/**
 * The points of `[fromMs, toMs]` (both included, open-ended when absent) of a curve sorted by
 * time, decimated to `n`, and the value reached before `fromMs`.
 */
export function cutCurve(
  raw: readonly CurvePoint[],
  fromMs: number | undefined,
  toMs: number | undefined,
  n: number | undefined,
): CutCurve {
  const from = fromMs ?? Number.NEGATIVE_INFINITY;
  const to = toMs ?? Number.POSITIVE_INFINITY;
  const before = raw.findIndex((p) => p[0] >= from);
  const start = before < 0 ? raw.length : before;
  const inRange = raw.slice(start).filter((p) => p[0] <= to);
  return {
    base: start > 0 ? raw[start - 1]![1] : null,
    points: decimate(inRange, n),
  };
}
