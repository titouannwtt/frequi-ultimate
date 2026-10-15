/**
 * Freshness of a value (docs/redesign/02-design.md, sections 10.1 and 12).
 *
 * `asOfMs` is the server time of the value (`freshness.as_of_ms`). `clockSkewMs` is
 * `serverNow - clientNow` (from the heartbeat), so the server clock at this instant is
 * `nowMs + clockSkewMs` and the age never depends on the browser clock being right.
 */

export function ageMs(asOfMs: number, nowMs: number, clockSkewMs = 0): number {
  return Math.max(0, nowMs + clockSkewMs - asOfMs);
}

/** Stale once the age exceeds the threshold (3 times the cadence of the channel). */
export function isStale(age: number, staleAfterMs: number): boolean {
  return age > staleAfterMs;
}
