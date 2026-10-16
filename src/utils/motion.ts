/**
 * Motion constants and helpers (docs/redesign/02-design.md, section 9).
 * The numbers mirror the `--d-*`, `--e-*` and `--hold` tokens in styles/tokens.css; a unit test
 * keeps both in sync.
 */

export const DURATIONS = {
  instant: 80,
  fast: 140,
  base: 200,
  slow: 320,
  flash: 900,
} as const;

/** Duration of a counter tween (fixed width thanks to tabular numerals). */
export const COUNTER_MS = 420;

/** Hold-to-confirm delay of a live exit: a safety delay, never reduced by reduced motion. */
export const HOLD_MS = 1000;

export const EASINGS = {
  out: 'cubic-bezier(.2,.8,.2,1)',
  inout: 'cubic-bezier(.65,0,.35,1)',
  spring: 'cubic-bezier(.34,1.4,.64,1)',
} as const;

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  // The Settings override (`data-motion` on <html>) counts as much as the system preference
  if (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduce') {
    return true;
  }
  return typeof window !== 'undefined' && !!window.matchMedia?.(REDUCED_MOTION_QUERY).matches;
}

/** Duration to use for a UI transition: 1 ms under reduced motion. The hold delay is not concerned. */
export function motionDuration(ms: number, reduced = prefersReducedMotion()): number {
  return reduced ? 1 : ms;
}

export function easeOutCubic(k: number): number {
  return 1 - Math.pow(1 - k, 3);
}

export interface TweenOptions {
  from: number;
  to: number;
  duration?: number;
  onFrame: (value: number) => void;
  /** Injected in tests; defaults to requestAnimationFrame. */
  raf?: (cb: (t: number) => void) => number;
  cancelRaf?: (id: number) => void;
  now?: () => number;
}

/**
 * Run an eased tween from `from` to `to`. The last frame is always exactly `to`.
 * Returns a cancel function; after cancelling no further frame is emitted.
 */
export function runTween(opts: TweenOptions): () => void {
  const duration = opts.duration ?? COUNTER_MS;
  const raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
  const cancelRaf = opts.cancelRaf ?? ((id) => cancelAnimationFrame(id));
  const now = opts.now ?? (() => performance.now());
  const t0 = now();
  let id = 0;
  let cancelled = false;

  const step = () => {
    if (cancelled) {
      return;
    }
    const k = duration <= 0 ? 1 : Math.min(1, (now() - t0) / duration);
    opts.onFrame(k >= 1 ? opts.to : opts.from + (opts.to - opts.from) * easeOutCubic(k));
    if (k < 1) {
      id = raf(step);
    }
  };
  id = raf(step);

  return () => {
    cancelled = true;
    cancelRaf(id);
  };
}
