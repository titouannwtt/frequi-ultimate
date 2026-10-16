/**
 * Plain names for the indicator columns of a strategy (`rsi_14`, `ema_200`, `I-vwap_low`...), for
 * the Charts page: a trader reads "RSI 14, élan du prix", not a variable name. A name that is not
 * recognised is kept as is (never guessed), and the raw name always stays available (`raw`) for a
 * tooltip. Pure, French by default; English on request.
 */
export type IndicatorLang = 'fr' | 'en';

export interface IndicatorLabel {
  /** The column name, untouched. */
  raw: string;
  /** Plain title: "RSI 14, élan du prix". The raw name when the indicator is not recognised. */
  label: string;
  /** Short form for tight places (legend): "RSI 14". */
  short: string;
  /** One line that says how to read it; null when the indicator is not recognised. */
  explain: string | null;
  known: boolean;
}

interface Words {
  /** Title suffix after the short name, "" for none. */
  suffix: string;
  explain: string;
}

type Dict = Record<string, Words>;

const FR: Dict = {
  rsi: {
    suffix: 'élan du prix',
    explain: 'Au-dessus de 70, la montée est tendue ; sous 30, la baisse est tendue.',
  },
  ema: {
    suffix: '',
    explain:
      'Prix moyen récent, plus sensible aux dernières bougies. Le prix s’en écarte puis y revient.',
  },
  sma: {
    suffix: '',
    explain: 'Prix moyen sur la période, toutes les bougies pèsent pareil.',
  },
  vwap: {
    suffix: '',
    explain: 'Prix moyen pondéré par les volumes échangés : le prix « juste » du moment.',
  },
  bb: {
    suffix: '',
    explain: 'Bande de Bollinger : l’écart habituel du prix autour de sa moyenne.',
  },
  macd: {
    suffix: 'élan de la tendance',
    explain: 'Compare deux moyennes : au-dessus de zéro la tendance monte, dessous elle baisse.',
  },
  atr: {
    suffix: 'amplitude moyenne',
    explain: 'Combien le prix bouge en moyenne par bougie. Haut : marché agité.',
  },
  adx: {
    suffix: 'force de la tendance',
    explain: 'Au-dessus de 25, il y a une vraie tendance ; en dessous, le marché hésite.',
  },
  cci: {
    suffix: 'écart à la moyenne',
    explain: 'Au-dessus de 100 ou sous -100, le prix s’éloigne beaucoup de sa moyenne.',
  },
  mfi: {
    suffix: 'flux d’argent',
    explain: 'Comme le RSI mais pondéré par les volumes. Au-dessus de 80 ou sous 20, excès.',
  },
};

const EN: Dict = {
  rsi: {
    suffix: 'price momentum',
    explain: 'Above 70, the rise is stretched; under 30, the fall is stretched.',
  },
  ema: {
    suffix: '',
    explain:
      'Recent average price, more sensitive to the latest candles. Price strays, then returns.',
  },
  sma: { suffix: '', explain: 'Average price over the period, every candle weighs the same.' },
  vwap: {
    suffix: '',
    explain: 'Average price weighted by traded volume: the "fair" price of the moment.',
  },
  bb: { suffix: '', explain: 'Bollinger band: the usual spread of the price around its average.' },
  macd: {
    suffix: 'trend momentum',
    explain: 'Compares two averages: above zero the trend rises, below it falls.',
  },
  atr: {
    suffix: 'average range',
    explain: 'How far the price moves per candle on average. High: a restless market.',
  },
  adx: {
    suffix: 'trend strength',
    explain: 'Above 25 there is a real trend; below, the market hesitates.',
  },
  cci: {
    suffix: 'distance from average',
    explain: 'Above 100 or under -100, the price is far from its average.',
  },
  mfi: {
    suffix: 'money flow',
    explain: 'Like the RSI but weighted by volume. Above 80 or under 20, an excess.',
  },
};

const NAMES: Record<IndicatorLang, Record<string, string>> = {
  fr: {
    rsi: 'RSI',
    ema: 'Moyenne',
    sma: 'Moyenne simple',
    vwap: 'VWAP',
    macd: 'MACD',
    atr: 'ATR',
    adx: 'ADX',
    cci: 'CCI',
    mfi: 'MFI',
    bb: 'Bollinger',
    macdsignal: 'MACD, signal',
    macdhist: 'MACD, histogramme',
  },
  en: {
    rsi: 'RSI',
    ema: 'Average',
    sma: 'Simple average',
    vwap: 'VWAP',
    macd: 'MACD',
    atr: 'ATR',
    adx: 'ADX',
    cci: 'CCI',
    mfi: 'MFI',
    bb: 'Bollinger',
    macdsignal: 'MACD, signal',
    macdhist: 'MACD, histogram',
  },
};

/** Band or edge named in the column: `vwap_low`, `bb_upperband`... */
const EDGES: Record<IndicatorLang, Array<[RegExp, string]>> = {
  fr: [
    [/^(low|lower|lowerband|bottom)$/, 'bas'],
    [/^(high|up|upper|upperband|top)$/, 'haut'],
    [/^(mid|middle|middleband|basis)$/, 'milieu'],
  ],
  en: [
    [/^(low|lower|lowerband|bottom)$/, 'low'],
    [/^(high|up|upper|upperband|top)$/, 'high'],
    [/^(mid|middle|middleband|basis)$/, 'middle'],
  ],
};

const SIGNAL: Record<IndicatorLang, string> = {
  fr: 'repère de signal',
  en: 'signal marker',
};

/** Indicators that carry a period: rsi_14, ema_200. */
const PERIODIC = new Set(['rsi', 'ema', 'sma', 'atr', 'adx', 'cci', 'mfi']);
/** Indicators that carry a band or an edge in their name. */
const BANDED = new Set(['vwap', 'bb']);

function unknown(raw: string): IndicatorLabel {
  return { raw, label: raw, short: raw, explain: null, known: false };
}

/**
 * The plain name of an indicator column. `I-` and `C-` prefixes (the convention of the strategies
 * of this fleet: indicator, condition marker) are understood; `%-` too (freqtrade features).
 */
export function indicatorLabel(raw: string, lang: IndicatorLang = 'fr'): IndicatorLabel {
  const dict = lang === 'en' ? EN : FR;
  const names = NAMES[lang];
  const prefixed = /^([IiCc%])-(.+)$/.exec(raw);
  const marker = prefixed?.[1]?.toLowerCase() === 'c';
  const base = (prefixed ? prefixed[2]! : raw).trim().toLowerCase();
  if (base === '' || /^[_\s]|[_\s]$/.test(base)) return unknown(raw);

  const parts = base.split(/[_\s]+/).filter((p) => p !== '');
  const head = parts[0] ?? '';
  const rest = parts.slice(1);
  let short: string | null = null;
  let key: string | null = null;

  if (head === 'macdsignal' || head === 'macdhist') {
    if (rest.length > 0) return unknown(raw);
    short = names[head] ?? null;
    key = 'macd';
  } else if (head === 'macd') {
    if (rest.length > 0) return unknown(raw);
    short = names.macd!;
    key = 'macd';
  } else if (PERIODIC.has(head)) {
    // `rsi`, `rsi_14`, `rsi14`: only a number may follow
    if (rest.length > 1 || (rest.length === 1 && !/^\d{1,4}$/.test(rest[0]!))) return unknown(raw);
    short = rest.length === 1 ? `${names[head]} ${rest[0]}` : names[head]!;
    key = head;
  } else if (/^(rsi|ema|sma|atr|adx|cci|mfi)(\d{1,4})$/.test(head) && rest.length === 0) {
    const m = /^([a-z]+)(\d+)$/.exec(head)!;
    short = `${names[m[1]!]} ${m[2]}`;
    key = m[1]!;
  } else if (BANDED.has(head)) {
    // `vwap`, `vwap_low`, `bb_lowerband`: an optional edge, nothing else
    const edgeWord = rest.length === 1 ? rest[0]! : '';
    if (rest.length > 1) return unknown(raw);
    const edge = EDGES[lang].find(([re]) => re.test(edgeWord))?.[1];
    if (rest.length === 1 && !edge) return unknown(raw);
    short = edge ? `${names[head]} ${edge}` : names[head]!;
    key = head;
  }
  if (short === null || key === null) return unknown(raw);

  const words = dict[key]!;
  const shortMarked = marker ? `${short}, ${SIGNAL[lang]}` : short;
  const titled = !marker && words.suffix !== '' && (key !== 'macd' || head === 'macd');
  const label = titled ? `${short}, ${words.suffix}` : shortMarked;
  return { raw, label, short: shortMarked, explain: words.explain, known: true };
}

/**
 * The names of a group of series on one sub-chart (the plot config names the group, the series are
 * the columns): the series name when there is one, else the group's name.
 */
export function subplotLabel(
  group: string,
  series: readonly string[],
  lang: IndicatorLang = 'fr',
): IndicatorLabel {
  if (series.length === 1) return indicatorLabel(series[0]!, lang);
  const g = indicatorLabel(group, lang);
  if (g.known) return g;
  // `MACD` as a group name: case does not matter
  const lower = indicatorLabel(group.toLowerCase(), lang);
  return lower.known ? lower : g;
}
