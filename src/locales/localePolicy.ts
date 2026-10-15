/** Languages kept by the redesign: French and English only. */
export const SUPPORTED_LOCALES = ['en', 'fr'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Pick the language to start with.
 *
 * - A stored `ft_locale` that is still supported wins.
 * - A stored locale of a removed language (de, es, it, pt) or any unknown value falls back to
 *   English and `migrated` tells the caller to rewrite the stored value.
 * - Without a stored value the first browser language that is French or English is used, so a
 *   French browser gets French and everything else gets English.
 */
export function resolveInitialLocale(
  stored: string | null | undefined,
  browserLanguages: readonly string[] = [],
): { locale: SupportedLocale; migrated: boolean } {
  if (stored) {
    if (isSupportedLocale(stored)) {
      return { locale: stored, migrated: false };
    }
    return { locale: DEFAULT_LOCALE, migrated: true };
  }
  for (const lang of browserLanguages) {
    const primary = lang.toLowerCase().split('-')[0];
    if (isSupportedLocale(primary)) {
      return { locale: primary, migrated: false };
    }
  }
  return { locale: DEFAULT_LOCALE, migrated: false };
}
