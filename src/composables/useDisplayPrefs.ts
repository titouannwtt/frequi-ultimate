import { useLocalStorage } from '@vueuse/core';
import { watch } from 'vue';

/**
 * Display options that belong to this device (Settings > Display): the colour-blind palette and
 * the reduced-motion override. They are attributes of <html> (`data-cvd`, `data-motion`) because
 * the design tokens and the motion rules are selected by them (styles/tokens.css, motion.css).
 * Density and theme have their own owners (`fqu2.density` in the shell, `useTheme`).
 */
export type MotionPref = 'system' | 'reduce';

export const CVD_KEY = 'fqu2.cvd';
export const MOTION_KEY = 'fqu2.motion';

const cvd = useLocalStorage<boolean>(CVD_KEY, false);
const motion = useLocalStorage<MotionPref>(MOTION_KEY, 'system');

/** Writes the two attributes. Exported for tests; the app calls `initDisplayPrefs()` once. */
export function applyDisplayPrefs(
  state: { cvd: boolean; motion: MotionPref },
  root: HTMLElement = document.documentElement,
): void {
  if (state.cvd) root.setAttribute('data-cvd', '1');
  else root.removeAttribute('data-cvd');
  if (state.motion === 'reduce') root.setAttribute('data-motion', 'reduce');
  else root.removeAttribute('data-motion');
}

let started = false;

/** Applies the stored options now and keeps the attributes in step with later changes. */
export function initDisplayPrefs(): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  watch([cvd, motion], () => applyDisplayPrefs({ cvd: cvd.value, motion: motion.value }), {
    immediate: true,
    flush: 'sync',
  });
}

export function useDisplayPrefs() {
  initDisplayPrefs();
  return { cvd, motion };
}
