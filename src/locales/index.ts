import { createI18n } from 'vue-i18n';
import en from './en';
import fr from './fr';
import fqEn from './redesign/en';
import fqFr from './redesign/fr';
import { isSupportedLocale, resolveInitialLocale } from './localePolicy';

const STORAGE_KEY = 'ft_locale';

function readStoredLocale(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredLocale(lang: string) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // storage unavailable (private mode): the choice only lasts for the session
  }
}

// A stored language that no longer exists (de, es, it, pt) is migrated to English
const initial = resolveInitialLocale(
  readStoredLocale(),
  typeof navigator === 'undefined'
    ? []
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language],
);
if (initial.migrated) {
  writeStoredLocale(initial.locale);
}

const i18n = createI18n({
  legacy: false,
  locale: initial.locale,
  fallbackLocale: 'en',
  messages: {
    // Redesign keys live in the `fq` namespace so the legacy message files stay untouched
    en: { ...en, fq: fqEn },
    fr: { ...fr, fq: fqFr },
  },
});

if (typeof document !== 'undefined') {
  document.documentElement.lang = initial.locale;
}

export async function loadLanguage(lang: string) {
  if (!isSupportedLocale(lang)) {
    return;
  }
  i18n.global.locale.value = lang;
  writeStoredLocale(lang);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
  }
}

export const availableLocales = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
];

export default i18n;
