import { watch, type Ref } from 'vue';

import type { PrimeVueConfiguration } from 'primevue/config';

type PrimeLocale = NonNullable<PrimeVueConfiguration['locale']>;

/** The 12 months, January first. */
function monthNames(lang: string, month: 'long' | 'short') {
  const fmt = new Intl.DateTimeFormat(lang, { month, timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(Date.UTC(2023, i, 1))));
}
/** The 7 days, Sunday first (PrimeVue's order): 2023-01-01 is a Sunday. */
function dayNames(lang: string, weekday: 'long' | 'short' | 'narrow') {
  const fmt = new Intl.DateTimeFormat(lang, { weekday, timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2023, 0, 1 + i))));
}

/**
 * The part of PrimeVue's `locale` the calendar reads, built from `Intl` so that it follows the
 * language of the app without a locale package: names of the days and months, the week that
 * starts on Monday in French, the labels the calendar announces.
 */
export function primeLocale(lang: string): Partial<PrimeLocale> {
  const fr = lang === 'fr';
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  return {
    dayNames: dayNames(lang, 'long').map(cap),
    dayNamesShort: dayNames(lang, 'short').map((s) => cap(s.replace(/\.$/, ''))),
    dayNamesMin: dayNames(lang, 'short').map((s) => cap(s.replace(/\.$/, '')).slice(0, 2)),
    monthNames: monthNames(lang, 'long').map(cap),
    monthNamesShort: monthNames(lang, 'short').map((s) => cap(s.replace(/\.$/, ''))),
    firstDayOfWeek: fr ? 1 : 0,
    dateFormat: fr ? 'dd/mm/yy' : 'mm/dd/yy',
    today: fr ? "Aujourd'hui" : 'Today',
    clear: fr ? 'Effacer' : 'Clear',
    weekHeader: fr ? 'Sem' : 'Wk',
    prevMonth: fr ? 'Mois précédent' : 'Previous month',
    nextMonth: fr ? 'Mois suivant' : 'Next month',
    prevYear: fr ? 'Année précédente' : 'Previous year',
    nextYear: fr ? 'Année suivante' : 'Next year',
    prevDecade: fr ? 'Décennie précédente' : 'Previous decade',
    nextDecade: fr ? 'Décennie suivante' : 'Next decade',
    chooseYear: fr ? "Choisir l'année" : 'Choose year',
    chooseMonth: fr ? 'Choisir le mois' : 'Choose month',
    chooseDate: fr ? 'Choisir la date' : 'Choose date',
  };
}

/** Keep PrimeVue's locale (calendar included) on the language of the app, now and on a change. */
export function bindPrimeLocale(config: PrimeVueConfiguration, locale: Ref<string>) {
  watch(
    locale,
    (lang) => {
      config.locale = { ...config.locale, ...primeLocale(lang) } as PrimeLocale;
    },
    { immediate: true },
  );
}
