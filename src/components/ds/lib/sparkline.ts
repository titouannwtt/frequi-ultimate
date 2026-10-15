export interface SparklineGeometry {
  path: string;
  zeroY: number;
  last: number;
  up: boolean;
}

/**
 * Geometry of a sparkline in a `width` x `height` box. The y range always includes zero so the
 * dashed zero line is visible; with fewer than two usable points the path is a flat segment.
 */
export function buildSparkline(values: number[], width: number, height: number): SparklineGeometry {
  const data = values.filter((v) => Number.isFinite(v));
  if (data.length === 0) {
    const y = (height / 2).toFixed(1);
    return { path: `M0,${y} L${width},${y}`, zeroY: height / 2, last: 0, up: true };
  }
  const mn = Math.min(...data, 0);
  const mx = Math.max(...data, 0);
  const span = mx - mn || 1;
  const yOf = (v: number) => height - 1 - ((v - mn) / span) * (height - 2);
  const last = data[data.length - 1];
  const pts =
    data.length === 1
      ? [
          [0, yOf(last)],
          [width, yOf(last)],
        ]
      : data.map((v, i) => [(i / (data.length - 1)) * width, yOf(v)]);
  return {
    path: 'M' + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L'),
    zeroY: yOf(0),
    last,
    up: last >= 0,
  };
}
