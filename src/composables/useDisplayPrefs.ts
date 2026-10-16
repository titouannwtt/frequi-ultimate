import { useLocalStorage } from '@vueuse/core';
import { watch } from 'vue';

/**
 * Display options that belong to this device (Settings > Display): the density, the colour-blind
 * palette and the reduced-motion override. They are attributes of <html> (`data-density`,
 * `data-cvd`, `data-motion`) because the design tokens and the motion rules are selected by them
 * (styles/tokens.css, motion.css). The theme has its own owner (`useTheme`).
 *
 * Density: `airy` (rows of 38 px, text of 14 px) is the default and sets no attribute; `compact`
 * (rows of 30 px, text of 13 px) sets `data-density="compact"`. It lives under `fqu2.density.v2`:
 * the old `fqu2.density` key held "compact" for every user (it was the stored default), so it cannot
 * tell a choice from a default and is dropped instead of being read.
 */
export type MotionPref = 'system' | 'reduce';
export type DensityPref = 'airy' | 'compact';

export const CVD_KEY = 'fqu2.cvd';
export const MOTION_KEY = 'fqu2.motion';
export const DENSITY_KEY = 'fqu2.density.v2';
const LEGACY_DENSITY_KEY = 'fqu2.density';

const cvd = useLocalStorage<boolean>(CVD_KEY, false);
const motion = useLocalStorage<MotionPref>(MOTION_KEY, 'system');
const density = useLocalStorage<DensityPref>(DENSITY_KEY, 'airy');

/** Writes the three attributes. Exported for tests; the app calls `initDisplayPrefs()` once. */
export function applyDisplayPrefs(
  state: { cvd: boolean; motion: MotionPref; density?: DensityPref },
  root: HTMLElement = document.documentElement,
): void {
  if (state.cvd) root.setAttribute('data-cvd', '1');
  else root.removeAttribute('data-cvd');
  if (state.motion === 'reduce') root.setAttribute('data-motion', 'reduce');
  else root.removeAttribute('data-motion');
  if (state.density === 'compact') root.setAttribute('data-density', 'compact');
  else root.removeAttribute('data-density');
}

let started = false;

/** Applies the stored options now and keeps the attributes in step with later changes. */
export function initDisplayPrefs(): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  try {
    localStorage.removeItem(LEGACY_DENSITY_KEY);
  } catch {
    // storage unavailable (private mode): nothing to clean
  }
  watch(
    [cvd, motion, density],
    () => applyDisplayPrefs({ cvd: cvd.value, motion: motion.value, density: density.value }),
    { immediate: true, flush: 'sync' },
  );
}

export function useDisplayPrefs() {
  initDisplayPrefs();
  return { cvd, motion, density };
}
