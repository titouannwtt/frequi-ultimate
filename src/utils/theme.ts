import type { ThemeMode, ThemeName } from '@/types';

export type ResolvedTheme = 'dark' | 'light';

export const THEME_MODES: readonly ThemeMode[] = ['system', 'dark', 'light'];

/** Map the legacy theme names stored in `ftUISettings.currentTheme` to a resolved theme. */
export function legacyThemeToResolved(name: ThemeName | string | undefined): ResolvedTheme {
  return name === 'light' || name === 'bootstrap' ? 'light' : 'dark';
}

/**
 * Mode actually in use. A user who never picked a mode with the redesigned selector keeps the
 * explicit light/dark choice already stored in `currentTheme`; an unknown stored value is ignored.
 */
export function effectiveThemeMode(
  stored: ThemeMode | null | undefined,
  legacy: ThemeName | string | undefined,
): ThemeMode {
  if (stored && THEME_MODES.includes(stored)) {
    return stored;
  }
  return legacyThemeToResolved(legacy);
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') {
    return prefersDark ? 'dark' : 'light';
  }
  return mode;
}

/** Next mode of the cycle button: dark, light, system. */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  const order: ThemeMode[] = ['dark', 'light', 'system'];
  return order[(order.indexOf(mode) + 1) % order.length];
}

/**
 * Apply a resolved theme to the document.
 * `data-theme` drives the redesign tokens; the `dark` and `ft-dark-theme` classes are kept for
 * Tailwind and PrimeVue and for the legacy components until they are migrated (section 6.6).
 */
export function applyThemeToDocument(
  resolved: ResolvedTheme,
  root: HTMLElement = document.documentElement,
) {
  const dark = resolved === 'dark';
  root.setAttribute('data-theme', resolved);
  root.classList.toggle('dark', dark);
  root.classList.toggle('ft-dark-theme', dark);
  root.style.colorScheme = resolved;
}
