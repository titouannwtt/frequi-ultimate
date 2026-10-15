/**
 * Timestamp normalisation. Port of `fg-core::time`, validated on the shared vectors
 * (`gateway/fixtures/vectors/time.*.json`).
 *
 * Every timestamp of the data layer is an integer number of milliseconds since the Unix epoch
 * (UTC). Sources disagree on units (freqtrade serialises `latest_trade_timestamp` in
 * milliseconds while the old UI assumed seconds, bug B5), so values are normalised on entry
 * rather than trusted.
 */

/** Largest value still interpreted as seconds. */
const MAX_SECONDS = 1e11;
/** Largest value still interpreted as milliseconds. */
const MAX_MILLIS = 1e14;
/** Largest value still interpreted as microseconds. */
const MAX_MICROS = 1e17;

/**
 * Normalise a raw epoch value of unknown unit (s, ms, us or ns) to milliseconds.
 * Returns null for non-finite or non-positive input (0 means "never" in freqtrade payloads).
 */
export function normalizeTsMs(raw: number): number | null {
  if (!Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  let ms: number;
  if (raw < MAX_SECONDS) {
    ms = raw * 1000;
  } else if (raw < MAX_MILLIS) {
    ms = raw;
  } else if (raw < MAX_MICROS) {
    ms = raw / 1000;
  } else {
    ms = raw / 1_000_000;
  }
  // Truncation toward zero, like the Rust `as i64`: sub-millisecond precision is dropped.
  return Math.trunc(ms);
}

const DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|z|[+-]\d{2}:\d{2})?$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Parse a database or API date into epoch milliseconds.
 *
 * Accepts the naive `YYYY-MM-DD HH:MM:SS[.ffffff]` form used by freqtrade databases (always UTC)
 * and ISO 8601 with a `T` separator, with or without `Z` or an explicit offset. A date without
 * offset is UTC, never local time.
 */
export function parseDateMs(input: string): number | null {
  const s = input.trim();
  if (s.length < 10) {
    return null;
  }
  const iso = s[10] === ' ' ? `${s.slice(0, 10)}T${s.slice(11)}` : s;
  const m = DATE_RE.exec(iso);
  if (!m) {
    return null;
  }
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  // Fraction: keep the first three digits (milliseconds), truncating the rest.
  const frac = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0;
  let ms = Date.UTC(year, month - 1, day, hour, minute, second, frac);
  const zone = m[8];
  if (zone && zone.toUpperCase() !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const [oh, om] = zone.slice(1).split(':').map(Number);
    if (oh > 23 || om > 59) {
      return null;
    }
    ms -= sign * (oh * 60 + om) * 60_000;
  }
  return ms;
}

/** Elapsed hours between two millisecond timestamps (negative when `to` precedes `from`). */
export function hoursBetweenMs(fromMs: number, toMs: number): number {
  return (toMs - fromMs) / 3_600_000;
}
