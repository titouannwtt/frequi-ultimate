import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import i18n, { availableLocales, loadLanguage } from '../../src/locales';
import fqEn from '../../src/locales/redesign/en';
import fqFr from '../../src/locales/redesign/fr';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') {
      out[prefix + k] = v;
    } else {
      Object.assign(out, flatten(v, `${prefix}${k}.`));
    }
  }
  return out;
}

const en = flatten(fqEn);
const fr = flatten(fqFr);

describe('redesign messages (fq namespace)', () => {
  it('defines the same keys in French and English', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty message and no em dash', () => {
    for (const [key, value] of [...Object.entries(en), ...Object.entries(fr)]) {
      expect(value.trim(), key).not.toBe('');
      expect(value, key).not.toContain('—');
    }
  });

  it('keeps the same placeholders in both languages', () => {
    // A plural message repeats its placeholders once per form: compare the sets
    const placeholders = (s: string) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort();
    for (const key of Object.keys(en)) {
      expect(placeholders(fr[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('puts a no-break space before : ? ! in French', () => {
    for (const [key, value] of Object.entries(fr)) {
      expect(value, key).not.toMatch(/ [:?!]/);
      expect(value, key).not.toMatch(/\S[:?!](?=\s|$)/);
    }
  });

  it('is merged under fq in both loaded locales', () => {
    expect(i18n.global.t('fq.nav.fleet', {}, { locale: 'fr' })).toBe('Flotte');
    expect(i18n.global.t('fq.nav.fleet', {}, { locale: 'en' })).toBe('Fleet');
    expect(i18n.global.t('fq.kpi.excluded', { n: 3 }, { locale: 'fr' })).toBe('3 exclus');
  });
});

describe('available languages', () => {
  it('offers French and English only', () => {
    expect(availableLocales.map((l) => l.value)).toEqual(['en', 'fr']);
    expect(i18n.global.availableLocales.sort()).toEqual(['en', 'fr']);
  });

  it('removed the locale files of the dropped languages', () => {
    for (const lang of ['de', 'es', 'it', 'pt']) {
      expect(existsSync(resolve(__dirname, `../../src/locales/${lang}.ts`)), lang).toBe(false);
    }
  });

  it('ignores a request for a removed language', async () => {
    await loadLanguage('fr');
    await loadLanguage('de');
    expect(i18n.global.locale.value).toBe('fr');
    expect(localStorage.getItem('ft_locale')).toBe('fr');
    await loadLanguage('en');
    expect(document.documentElement.lang).toBe('en');
  });
});
