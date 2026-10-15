import { usePreferredDark } from '@vueuse/core';
import type { ThemeMode } from '@/types';
import {
  applyThemeToDocument,
  effectiveThemeMode,
  nextThemeMode,
  resolveTheme,
} from '@/utils/theme';

/** Duration of the colour transition played when the theme is switched by the user. */
const THEME_TRANSITION_MS = 1000;

/**
 * Theme controller: system/dark/light, persisted in the `ftUISettings` store.
 *
 * It keeps `settings.currentTheme` (read by the legacy charts and components through
 * `isDarkTheme`) in sync with the resolved theme, so old pages follow the new selector.
 * Use `useTheme()` in components; this unshared version exists for tests.
 */
export function useThemeController() {
  const settings = useSettingsStore();
  const prefersDark = usePreferredDark();

  const mode = computed<ThemeMode>(() =>
    effectiveThemeMode(settings.themeMode, settings.currentTheme),
  );
  const resolved = computed(() => resolveTheme(mode.value, prefersDark.value));

  let applied = false;
  watch(
    resolved,
    (theme) => {
      // Animate only real switches, never the first paint
      if (applied && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        document.body.classList.add('ft-theme-transition');
        window.setTimeout(
          () => document.body.classList.remove('ft-theme-transition'),
          THEME_TRANSITION_MS,
        );
      }
      applied = true;
      applyThemeToDocument(theme);
      // Legacy consumers read currentTheme; keep a bootstrap variant if it already matches
      if ((theme === 'dark') !== settings.isDarkTheme) {
        settings.currentTheme = theme;
      }
    },
    { immediate: true },
  );

  function setMode(next: ThemeMode) {
    settings.themeMode = next;
  }

  function cycle() {
    setMode(nextThemeMode(mode.value));
  }

  return { mode, resolved, setMode, cycle };
}

export const useTheme = createSharedComposable(useThemeController);
