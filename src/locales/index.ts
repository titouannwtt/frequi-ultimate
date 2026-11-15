import { createI18n } from 'vue-i18n';
import en from './en';
import fr from './fr';
import pt from './pt';

// ES, DE, IT are lazy-loaded
const i18n = createI18n({
  legacy: false,
  locale: localStorage.getItem('ft_locale') || 'en',
  fallbackLocale: 'en',
  messages: {
    en,
    fr,
    pt,
  },
});

// Lazy load additional languages
const lazyLanguages: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  es: () => import('./es'),
  de: () => import('./de'),
  it: () => import('./it'),
};

export async function loadLanguage(lang: string) {
  if (i18n.global.availableLocales.includes(lang)) {
    i18n.global.locale.value = lang;
    localStorage.setItem('ft_locale', lang);
    return;
  }

  if (lazyLanguages[lang]) {
    const messages = await lazyLanguages[lang]();
    i18n.global.setLocaleMessage(lang, messages.default);
    i18n.global.locale.value = lang;
    localStorage.setItem('ft_locale', lang);
  }
}

export const availableLocales = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
  { value: 'pt', label: 'Português' },
];

export default i18n;
