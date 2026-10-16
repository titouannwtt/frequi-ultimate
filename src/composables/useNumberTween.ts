import type { MaybeRefOrGetter } from 'vue';

import { COUNTER_MS, DURATIONS, prefersReducedMotion, runTween } from '@/utils/motion';

export type FlashDirection = 'up' | 'dn' | null;

export interface NumberTweenOptions {
  /** Counter duration in ms (default 420). */
  duration?: number;
  /** Flash the cell green or red when the value moves (default true). */
  flash?: boolean;
  /**
   * Only visible cells animate: pass false (for example from useElementVisibility) to snap to
   * the new value with no tween and no flash.
   */
  active?: MaybeRefOrGetter<boolean>;
  /** Override of the reduced motion detection, mostly for tests. */
  reducedMotion?: MaybeRefOrGetter<boolean>;
  /** Formats the displayed number; `text` is the formatted displayed value. */
  format?: (value: number) => string;
}

/**
 * Animated number for KPIs and table cells (section 9).
 *
 * `displayed` eases toward `source` over 420 ms. The change direction drives `flash` ('up' or 'dn')
 * for 900 ms; bind `flashClass` on the cell (`fl-up` / `fl-dn` in styles/motion.css). With reduced
 * motion, or when the cell is not visible, the value snaps and there is no flash.
 */
export function useNumberTween(source: MaybeRefOrGetter<number>, options: NumberTweenOptions = {}) {
  const duration = options.duration ?? COUNTER_MS;
  const initial = toValue(source);
  const displayed = ref(initial);
  const flash = ref<FlashDirection>(null);
  const flashClass = computed(() =>
    flash.value === 'up' ? 'fl-up' : flash.value === 'dn' ? 'fl-dn' : '',
  );
  const text = computed(() =>
    options.format ? options.format(displayed.value) : String(displayed.value),
  );

  let cancelTween: (() => void) | undefined;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  let last = initial;

  function stop() {
    cancelTween?.();
    cancelTween = undefined;
  }

  function clearFlash() {
    if (flashTimer !== undefined) {
      clearTimeout(flashTimer);
      flashTimer = undefined;
    }
  }

  watch(
    () => toValue(source),
    async (to) => {
      const from = last;
      last = to;
      stop();
      const reduced = options.reducedMotion
        ? toValue(options.reducedMotion)
        : prefersReducedMotion();
      const visible = options.active === undefined ? true : toValue(options.active);

      if (!Number.isFinite(to) || !Number.isFinite(from) || from === to || reduced || !visible) {
        clearFlash();
        flash.value = null;
        displayed.value = to;
        return;
      }

      if (options.flash !== false) {
        // Drop the class first so the CSS animation restarts on consecutive changes
        clearFlash();
        flash.value = null;
        await nextTick();
        // A newer change may have superseded this one while waiting
        if (last !== to) {
          return;
        }
        flash.value = to > from ? 'up' : 'dn';
        flashTimer = setTimeout(() => {
          flash.value = null;
          flashTimer = undefined;
        }, DURATIONS.flash);
      }

      cancelTween = runTween({
        from: displayed.value,
        to,
        duration,
        onFrame: (v) => {
          displayed.value = v;
        },
      });
    },
  );

  onScopeDispose(() => {
    stop();
    clearFlash();
  });

  return { displayed, text, flash, flashClass };
}
