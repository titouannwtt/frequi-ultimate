import type { EChartsInitOpts } from 'echarts/core';

type Locale = NonNullable<EChartsInitOpts['locale']>;

function names(
  lang: string,
  options: Intl.DateTimeFormatOptions,
  at: (i: number) => Date,
  n: number,
) {
  const fmt = new Intl.DateTimeFormat(lang, { ...options, timeZone: 'UTC' });
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  return Array.from({ length: n }, (_, i) => cap(fmt.format(at(i)).replace(/\.$/, '')));
}

/**
 * The names ECharts writes on a time axis (months, days), in the language of the app. English is
 * ECharts' own default, so nothing is passed for it; French (and any other language `Intl`
 * knows) is built from `Intl`, like the rest of the app, rather than from a bundled locale file.
 */
export function echartsLocale(lang: string): Locale | undefined {
  const base = lang.slice(0, 2).toLowerCase();
  if (base === 'en' || base === '') return undefined;
  const month = (i: number) => new Date(Date.UTC(2023, i, 1));
  // 2023-01-01 is a Sunday: ECharts counts the days from Sunday
  const day = (i: number) => new Date(Date.UTC(2023, 0, 1 + i));
  return {
    time: {
      month: names(base, { month: 'long' }, month, 12),
      monthAbbr: names(base, { month: 'short' }, month, 12),
      dayOfWeek: names(base, { weekday: 'long' }, day, 7),
      dayOfWeekAbbr: names(base, { weekday: 'short' }, day, 7),
    },
  } as Locale;
}
