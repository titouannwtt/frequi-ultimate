/**
 * The "Measure" tool of the Charts page (02 section 3.3): Shift + drag (long press on a touch
 * screen) between two points of a chart gives the move in price, in percent, in candles and in
 * time. Pure, so the arithmetic is tested; the component only converts pixels to data.
 */
export interface MeasurePoint {
  /** Time, ms. */
  ts: number;
  price: number;
}

export interface Measure {
  /** `b - a` in price. */
  dPrice: number;
  /** Move in percent of the start price; null when the start price is not positive. */
  dPct: number | null;
  /** Whole candles between the two points. */
  candles: number;
  /** Always positive, ms. */
  durationMs: number;
}

export function measure(a: MeasurePoint, b: MeasurePoint, timeframeMs: number): Measure {
  const durationMs = Math.abs(b.ts - a.ts);
  const dPrice = b.price - a.price;
  return {
    dPrice,
    dPct: a.price > 0 ? (dPrice / a.price) * 100 : null,
    candles: timeframeMs > 0 ? Math.round(durationMs / timeframeMs) : 0,
    durationMs,
  };
}
