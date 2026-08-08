/**
 * setInterval that skips its work while the tab is hidden.
 *
 * A monitoring dashboard is typically left open in a background tab for hours. Every
 * poller in it fans out across the whole fleet, so a hidden tab was still issuing
 * hundreds of requests per minute — spending the bot's rate-limit budget, and its CPU,
 * to compute figures nobody is looking at.
 *
 * Skipping rather than clearing the timer is deliberate: the cadence stays honest, so a
 * consumer that reasons about "last refreshed N seconds ago" keeps working, and there is
 * no drift to reconcile when the tab comes back.
 *
 * On becoming visible again the callback fires immediately, because the first thing a
 * user does when returning to a monitoring tab is read it — waiting up to a full period
 * for fresh numbers would trade a real cost for a visible one.
 */
import { onScopeDispose } from 'vue';

export interface VisibleIntervalHandle {
  stop: () => void;
  /** True while ticks are being skipped. Exposed for tests and for UI freshness hints. */
  isPaused: () => boolean;
}

export function useVisibleInterval(
  fn: () => void | Promise<void>,
  ms: number,
  { immediate = false, runOnVisible = true } = {},
): VisibleIntervalHandle {
  let paused = typeof document !== 'undefined' && document.hidden;

  const tick = () => {
    if (typeof document !== 'undefined' && document.hidden) {
      paused = true;
      return;
    }
    paused = false;
    void fn();
  };

  const onVisibility = () => {
    if (typeof document === 'undefined' || document.hidden) {
      paused = true;
      return;
    }
    const wasPaused = paused;
    paused = false;
    if (wasPaused && runOnVisible) {
      void fn();
    }
  };

  const timer = window.setInterval(tick, ms);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }
  if (immediate) {
    tick();
  }

  const stop = () => {
    window.clearInterval(timer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };

  // Tied to the owning component/composable scope, so a caller that forgets to stop it
  // does not leak a timer that keeps polling the fleet forever.
  onScopeDispose(stop);

  return { stop, isPaused: () => paused };
}
