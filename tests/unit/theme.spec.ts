import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { effectScope, nextTick } from 'vue';
import {
  applyThemeToDocument,
  effectiveThemeMode,
  legacyThemeToResolved,
  nextThemeMode,
  resolveTheme,
} from '../../src/utils/theme';

describe('theme helpers', () => {
  it('maps legacy theme names', () => {
    expect(legacyThemeToResolved('dark')).toBe('dark');
    expect(legacyThemeToResolved('bootstrap_dark')).toBe('dark');
    expect(legacyThemeToResolved('light')).toBe('light');
    expect(legacyThemeToResolved('bootstrap')).toBe('light');
    expect(legacyThemeToResolved(undefined)).toBe('dark');
  });

  it('keeps the legacy choice until a mode is picked', () => {
    expect(effectiveThemeMode(null, 'light')).toBe('light');
    expect(effectiveThemeMode(undefined, 'dark')).toBe('dark');
    expect(effectiveThemeMode('system', 'light')).toBe('system');
    expect(effectiveThemeMode('bogus' as never, 'light')).toBe('light');
  });

  it('resolves system from the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('cycles dark, light, system', () => {
    expect(nextThemeMode('dark')).toBe('light');
    expect(nextThemeMode('light')).toBe('system');
    expect(nextThemeMode('system')).toBe('dark');
  });

  it('applies the theme and the legacy classes to the document', () => {
    const root = document.createElement('html');
    applyThemeToDocument('dark', root);
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.classList.contains('ft-dark-theme')).toBe(true);
    applyThemeToDocument('light', root);
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.classList.contains('ft-dark-theme')).toBe(false);
  });
});

describe('useThemeController', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark', 'ft-dark-theme');
  });

  it('applies the stored legacy theme on init and keeps currentTheme in sync', async () => {
    const settings = useSettingsStore();
    settings.currentTheme = 'light';
    const scope = effectScope();
    const theme = scope.run(() => useThemeController())!;
    expect(theme.mode.value).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    theme.setMode('dark');
    await nextTick();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.classList.contains('ft-dark-theme')).toBe(true);
    expect(settings.currentTheme).toBe('dark');
    expect(settings.isDarkTheme).toBe(true);
    scope.stop();
  });

  it('persists the mode in the ftUISettings store state', async () => {
    const settings = useSettingsStore();
    const scope = effectScope();
    const theme = scope.run(() => useThemeController())!;
    theme.setMode('system');
    await nextTick();
    expect(settings.themeMode).toBe('system');
    expect(theme.mode.value).toBe('system');
    theme.cycle();
    expect(settings.themeMode).toBe('dark');
    scope.stop();
  });
});
