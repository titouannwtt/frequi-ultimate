import { describe, expect, it } from 'vitest';

import i18n from '@/locales';

const t = (locale: 'fr' | 'en', key: string, named: Record<string, unknown>, count: number) =>
  i18n.global.t(key, named, { locale, plural: count }) as string;

describe('counts agree with their noun (B196)', () => {
  it('one position, then positions, in French and English', () => {
    for (const key of ['fq.kpi.positions', 'fq.header.openTrades']) {
      expect(t('fr', key, { n: 1 }, 1)).toBe('1 position');
      expect(t('fr', key, { n: 2 }, 2)).toBe('2 positions');
      expect(t('en', key, { n: 1 }, 1)).toBe('1 position');
      expect(t('en', key, { n: 5 }, 5)).toBe('5 positions');
    }
  });

  it('French counts zero as singular, English as plural', () => {
    expect(t('fr', 'fq.kpi.positions', { n: 0 }, 0)).toBe('0 position');
    expect(t('en', 'fq.kpi.positions', { n: 0 }, 0)).toBe('0 positions');
  });

  it('"1 entrée remplie sur 1" and "1 ordre rempli sur 2", never "1 entrées" or "1 ordres"', () => {
    expect(t('fr', 'fq.drawer.ordersUnavailable', { n: 1 }, 1)).toContain('1 entrée remplie.');
    expect(t('fr', 'fq.drawer.ordersUnavailable', { n: 3 }, 3)).toContain('3 entrées remplies.');
    expect(t('fr', 'fq.ds.dcaFilled', { filled: 1, max: 2 }, 1)).toBe('1 ordre rempli sur 2');
    expect(t('fr', 'fq.ds.dcaFilled', { filled: 2, max: 2 }, 2)).toBe('2 ordres remplis sur 2');
    expect(t('en', 'fq.drawer.ordersUnavailable', { n: 1 }, 1)).toContain('1 entry filled.');
  });

  it('the dialog subtitle counts the entries', () => {
    const named = { pair: 'X', side: 'L', lev: 2, stake: '100' };
    expect(t('fr', 'fq.dialog.subtitle', { ...named, n: 1 }, 1)).toContain('1 entrée ·');
    expect(t('fr', 'fq.dialog.subtitle', { ...named, n: 3 }, 3)).toContain('3 entrées ·');
    expect(t('en', 'fq.dialog.subtitle', { ...named, n: 1 }, 1)).toContain('1 entry ·');
  });

  it('bots and stress-test counts too', () => {
    expect(t('fr', 'fq.pg.fleet.tableMeta', { n: 1, online: 1 }, 1)).toBe('1 bot · 1 en ligne');
    expect(t('fr', 'fq.pg.fleet.tableMeta', { n: 24, online: 22 }, 24)).toBe(
      '24 bots · 22 en ligne',
    );
    expect(t('fr', 'fq.stress.deltaSub', { n: 1 }, 1)).toBe('sur 1 position');
    expect(t('fr', 'fq.kpi.excluded', { n: 1 }, 1)).toBe('1 exclu');
    expect(t('fr', 'fq.kpi.excluded', { n: 3 }, 3)).toBe('3 exclus');
  });
});
