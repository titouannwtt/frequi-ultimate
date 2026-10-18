import { describe, expect, it } from 'vitest';

import { echartsLocale } from '@/components/ds/lib/chartLocale';
import { primeLocale } from '@/plugins/primeLocale';
import i18n from '@/locales';

describe('primeLocale: the calendar speaks the language of the app', () => {
  it('French: Monday first, French names', () => {
    const l = primeLocale('fr');
    expect(l.firstDayOfWeek).toBe(1);
    expect(l.monthNames?.[9]).toBe('Octobre');
    expect(l.dayNames?.[0]).toBe('Dimanche');
    expect(l.dayNamesMin?.[1]).toBe('Lu');
    expect(l.monthNames).toHaveLength(12);
    expect(l.dayNamesMin).toHaveLength(7);
  });
  it('English: Sunday first, English names', () => {
    const l = primeLocale('en');
    expect(l.firstDayOfWeek).toBe(0);
    expect(l.monthNames?.[9]).toBe('October');
    expect(l.dayNamesMin?.[0]).toBe('Su');
  });
});

describe('echartsLocale: the time axis speaks the language of the app', () => {
  it('French month and day names, without a trailing dot', () => {
    const l = echartsLocale('fr') as { time: { monthAbbr: string[]; dayOfWeekAbbr: string[] } };
    expect(l.time.monthAbbr[9]).toBe('Oct');
    expect(l.time.monthAbbr).toHaveLength(12);
    expect(l.time.dayOfWeekAbbr[0]).toBe('Dim');
    expect(l.time.dayOfWeekAbbr).toHaveLength(7);
  });
  it('English is the default of ECharts: nothing is passed', () => {
    expect(echartsLocale('en')).toBeUndefined();
    expect(echartsLocale('')).toBeUndefined();
  });
});

describe('olderProgress: the plural of "candles added"', () => {
  // The real instance of the app, with its own French plural rule (zero is singular)
  const say = (locale: 'fr' | 'en', n: number) => {
    i18n.global.locale.value = locale;
    return i18n.global.t('fq.candle.olderProgress', { n }, n);
  };

  it('French: zero and one are singular', () => {
    expect(say('fr', 0)).toContain('0 bougie ajoutée');
    expect(say('fr', 1)).toContain('1 bougie ajoutée');
    expect(say('fr', 2)).toContain('2 bougies ajoutées');
  });
  it('English: zero is plural', () => {
    expect(say('en', 0)).toContain('0 candles added');
    expect(say('en', 1)).toContain('1 candle added');
  });
});
