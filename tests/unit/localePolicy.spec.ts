import { describe, expect, it } from 'vitest';
import {
  isSupportedLocale,
  resolveInitialLocale,
  SUPPORTED_LOCALES,
} from '../../src/locales/localePolicy';

describe('resolveInitialLocale', () => {
  it('keeps a stored supported locale', () => {
    expect(resolveInitialLocale('fr', ['en-US'])).toEqual({ locale: 'fr', migrated: false });
    expect(resolveInitialLocale('en', ['fr-FR'])).toEqual({ locale: 'en', migrated: false });
  });

  it.each(['de', 'es', 'it', 'pt'])('migrates the removed language %s to English', (lang) => {
    expect(resolveInitialLocale(lang, ['fr-FR'])).toEqual({ locale: 'en', migrated: true });
  });

  it('migrates an unknown stored value to English', () => {
    expect(resolveInitialLocale('xx', [])).toEqual({ locale: 'en', migrated: true });
  });

  it('defaults to French for a French browser', () => {
    expect(resolveInitialLocale(null, ['fr-FR', 'en'])).toEqual({ locale: 'fr', migrated: false });
    expect(resolveInitialLocale(undefined, ['fr'])).toEqual({ locale: 'fr', migrated: false });
  });

  it('defaults to English otherwise', () => {
    expect(resolveInitialLocale(null, ['en-GB'])).toEqual({ locale: 'en', migrated: false });
    expect(resolveInitialLocale(null, ['ja'])).toEqual({ locale: 'en', migrated: false });
    expect(resolveInitialLocale(null, [])).toEqual({ locale: 'en', migrated: false });
  });

  it('uses the first browser language that is supported', () => {
    expect(resolveInitialLocale(null, ['de-DE', 'fr-CA'])).toEqual({
      locale: 'fr',
      migrated: false,
    });
  });

  it('supports French and English only', () => {
    expect([...SUPPORTED_LOCALES]).toEqual(['en', 'fr']);
    expect(isSupportedLocale('pt')).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
  });
});
