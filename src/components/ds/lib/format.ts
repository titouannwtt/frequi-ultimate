/**
 * Number, price, duration and age formatting for the design system primitives
 * (docs/redesign/02-design.md, section 6.2).
 *
 * FR: thin no-break space (U+202F) for thousands and before %, decimal comma.
 * EN: comma for thousands, decimal point. Both use the true minus sign U+2212.
 */

export const MINUS = '−';
export const THIN_NBSP = '\u202f';

type Lang = string;

const formatters = new Map<string, Intl.NumberFormat>();

function intlTag(lang: Lang): string {
  return lang === 'fr' ? 'fr-FR' : 'en-US';
}

function groupedAbs(abs: number, decimals: number, lang: Lang): string {
  const key = `${lang}:${decimals}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(intlTag(lang), {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: true,
    });
    formatters.set(key, fmt);
  }
  const out = fmt.format(abs);
  return lang === 'fr' ? out.replace(/[\s\u00a0\u202f]/g, THIN_NBSP) : out;
}

/** True when the value, once rounded to `decimals`, is zero (so it gets no sign). */
export function roundsToZero(value: number, decimals: number): boolean {
  return Math.abs(value) < Math.pow(10, -decimals) / 2;
}

/** Plain number with the true minus sign (no plus). */
export function formatNumber(value: number, decimals = 2, lang: Lang = 'en'): string {
  if (!Number.isFinite(value)) {
    return '';
  }
  const neg = value < 0 && !roundsToZero(value, decimals);
  return (neg ? MINUS : '') + groupedAbs(Math.abs(value), decimals, lang);
}

/** Number with the sign always written: `+` or U+2212; a value that rounds to zero has none. */
export function formatSigned(value: number, decimals = 2, lang: Lang = 'en'): string {
  if (!Number.isFinite(value)) {
    return '';
  }
  const sign = roundsToZero(value, decimals) ? '' : value > 0 ? '+' : MINUS;
  return sign + groupedAbs(Math.abs(value), decimals, lang);
}

/** Percentage; FR puts a thin no-break space before the sign, EN none. */
export function formatPercent(
  value: number,
  decimals = 2,
  lang: Lang = 'en',
  signed = true,
): string {
  const body = signed ? formatSigned(value, decimals, lang) : formatNumber(value, decimals, lang);
  return body + (lang === 'fr' ? THIN_NBSP : '') + '%';
}

/** Decimals of a price depend on its order of magnitude: 1 to 6. */
export function priceDecimals(price: number): number {
  const v = Math.abs(price);
  return v >= 1000 ? 1 : v >= 100 ? 2 : v >= 1 ? 3 : v >= 0.01 ? 4 : 6;
}

export function formatPrice(price: number, lang: Lang = 'en'): string {
  if (!Number.isFinite(price)) {
    return '';
  }
  return formatNumber(price, priceDecimals(price), lang);
}

/** Duration given in hours: "42 min", "23 h 04", "2 j 4 h" (EN: "2 d 4 h"). */
export function formatDuration(hours: number, lang: Lang = 'en'): string {
  const minutes = Math.round(hours * 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  if (minutes < 1440) {
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
  }
  const h = Math.round(minutes / 60);
  return `${Math.floor(h / 24)} ${lang === 'fr' ? 'j' : 'd'} ${h % 24} h`;
}

/** Compact age: "12 s", "3 min", "2 h", "3 j". */
export function formatAge(ms: number, lang: Lang = 'en'): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) {
    return `${Math.floor(s)} s`;
  }
  if (s < 3600) {
    return `${Math.floor(s / 60)} min`;
  }
  if (s < 172800) {
    return `${Math.floor(s / 3600)} h`;
  }
  return `${Math.floor(s / 86400)} ${lang === 'fr' ? 'j' : 'd'}`;
}

export type SignClass = 'up' | 'down' | 'flat';

export function signClass(value: number, decimals = 2): SignClass {
  if (!Number.isFinite(value) || roundsToZero(value, decimals)) {
    return 'flat';
  }
  return value > 0 ? 'up' : 'down';
}
