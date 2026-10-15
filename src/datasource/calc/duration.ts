/**
 * Durations and the median of a bot's closed trades. Port of the part of `fg-core::calc::duration`
 * that the direct mode needs.
 *
 * Not ported on purpose: `percentile_rank`, `anomaly_pct` and `level` (the `pNN` label of a
 * position and its amber/critical level). They rank a position among ALL the closed trades of the
 * bot, which only the gateway has; the direct mode shows no percentile (02 section 10.4) rather
 * than a rank computed on a partial history. They are listed as gateway-only in the vector runner.
 */

/** Minimum number of closed durations for a median to mean anything. */
export const MIN_SAMPLES = 3;

/**
 * Duration of a trade in ms. An open trade runs until `nowMs`. Clamped at zero: the backend
 * serialises `open_date` with microseconds and floors `close_date` to the millisecond, so a trade
 * opened and closed within the same millisecond can read a few ms negative.
 */
export function durationMs(
  openMs: number,
  closeMs: number | null | undefined,
  nowMs: number,
): number {
  return Math.max(0, (closeMs ?? nowMs) - openMs);
}

/** Rust `f64::round`: half away from zero (JavaScript rounds half up). */
function roundHalfAway(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** Value at percentile `p` (0-100) with linear interpolation between closest ranks. */
export function percentileValue(values: readonly number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) {
    return null;
  }
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (v.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return v[lo] + (v[hi] - v[lo]) * (rank - lo);
}

export function median(values: readonly number[]): number | null {
  return percentileValue(values, 50);
}

/** Median of the strictly positive closed durations, in ms. */
export function medianDurationMs(closedMs: readonly number[]): number | null {
  const m = median(closedMs.filter((d) => d > 0));
  return m === null ? null : roundHalfAway(m);
}

const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Strict float parse: unlike `Number()`, "" and " " are not zero. */
function strictNumber(s: string): number | null {
  const t = s.trim();
  return NUM_RE.test(t) ? Number(t) : null;
}

/**
 * Parse freqtrade's `avg_duration` (`"2 days, 3:04:05"`, `"1 day, 0:00:10.5"`, `"3:04:05"`).
 *
 * Only the direct mode needs this; the gateway computes medians from the database instead.
 * Returns null for anything that does not look like a duration or for a zero duration.
 */
export function parseAvgDurationMs(input: string): number | null {
  const s = input.trim();
  let daysPart: string | null;
  let timePart: string;
  const comma = s.indexOf(',');
  if (comma >= 0) {
    daysPart = s.slice(0, comma).trim();
    timePart = s.slice(comma + 1).trim();
  } else if (s.includes('day')) {
    daysPart = s;
    timePart = '';
  } else {
    daysPart = null;
    timePart = s;
  }
  let totalS = 0;
  let any = false;
  if (daysPart !== null) {
    const first = daysPart.split(/\s+/)[0];
    const n = first ? strictNumber(first) : null;
    if (n === null || !daysPart.includes('day')) {
      return null;
    }
    totalS += n * 86_400;
    any = true;
  }
  if (timePart !== '') {
    const parts = timePart.split(':');
    if (parts.length !== 3) {
      return null;
    }
    const [h, m, sec] = parts.map(strictNumber);
    if (h === null || m === null || sec === null) {
      return null;
    }
    totalS += h * 3600 + m * 60 + sec;
    any = true;
  }
  if (!any || totalS <= 0 || !Number.isFinite(totalS)) {
    return null;
  }
  return roundHalfAway(totalS * 1000);
}
