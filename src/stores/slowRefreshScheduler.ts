/**
 * Coalesces "something moved, refresh the slow tier" into one fleet-wide sweep.
 *
 * A bot whose open-trade list changed used to run its own eight-endpoint slow refresh on the
 * spot, off-cadence. On one bot that is a nicety. On forty-five it is the dominant amplifier:
 * at any instant some bot has just opened, filled or closed something, so the tier nominally
 * running "every 60 s" ran essentially without pause.
 *
 * Dropping the off-cadence refresh entirely would have cost up to a minute of latency on a
 * closed trade, which is not acceptable on a money dashboard. So instead of firing per bot,
 * every bot that flags itself arms a single shared timer. One short wait later, one batched
 * sweep runs and picks up every bot that flagged itself in the meantime — the wrapper's
 * `allRefreshSlow` already skips bots whose `refreshRequired` is false, so the sweep costs
 * exactly the bots that moved.
 *
 * Net effect: latency goes from "immediately" to "within a few seconds" (imperceptible for
 * 15 m-candle strategies), while N simultaneous per-bot storms collapse into one batch.
 */

/** How long to gather flags before sweeping. Long enough to merge a burst, short enough to feel live. */
const COALESCE_MS = 3_000;

/** Never sweep more often than this, however much the fleet churns. */
const MIN_INTERVAL_MS = 15_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let lastRun = 0;
let runner: (() => void) | null = null;

/**
 * The wrapper store registers the sweep here rather than the sub-store importing the wrapper:
 * the wrapper already imports the sub-store factory, and closing that loop would make module
 * initialisation order load-bearing.
 */
export function registerSlowRefreshRunner(fn: () => void) {
  runner = fn;
}

/**
 * Ask for a slow-tier sweep soon. Idempotent: calling it forty-five times in one tick still
 * produces one sweep.
 */
export function scheduleSlowRefresh() {
  if (timer || !runner) return;
  const sinceLast = Date.now() - lastRun;
  const delay = Math.max(COALESCE_MS, MIN_INTERVAL_MS - sinceLast);
  timer = setTimeout(() => {
    timer = null;
    lastRun = Date.now();
    runner?.();
  }, delay);
}
