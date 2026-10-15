/**
 * HIP-3 (builder dex) coin naming and market classification. Port of `fg-core::calc::hip3`.
 *
 * The same instrument is spelled differently depending on where it comes from: freqtrade pairs
 * use `XYZ-NVDA/USDC:USDC`, Hyperliquid uses `xyz:NVDA`. Both map to the single net-exposure key
 * `xyz:NVDA`, so a long and a short on the same instrument net out whichever spelling each bot
 * used. Crypto coins keep their name as is (`BTC`, `kPEPE`).
 */
import type { Market, PairInfo } from '@/gateway/types.gen';

/** Dexes recognised in the `DEX-SYMBOL` spelling when no explicit list is given. */
export const DEFAULT_DEXES: readonly string[] = ['xyz'];

const XYZ_INDICES = new Set([
  'SP500',
  'XYZ100',
  'JP225',
  'KR200',
  'DAX',
  'FTSE100',
  'EU50',
  'US2000',
  'HSI',
  'NIKKEI',
]);

const XYZ_COMMODITIES = new Set([
  'GOLD',
  'SILVER',
  'COPPER',
  'PLATINUM',
  'PALLADIUM',
  'BRENTOIL',
  'WTI',
  'CL',
  'NATGAS',
  'GAS',
  'CORN',
  'WHEAT',
  'SUGAR',
  'COFFEE',
  'COCOA',
  'SOYBEAN',
]);

/** ASCII-only case mapping (the Rust side uses `to_ascii_lowercase`). */
export function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

export function asciiUpper(s: string): string {
  return s.replace(/[a-z]/g, (c) => c.toUpperCase());
}

/** `true` for any builder-dex market. */
export function isHip3Market(m: Market): boolean {
  return m === 'xyz_stocks' || m === 'xyz_indices' || m === 'xyz_commodities' || m === 'hip3_other';
}

function hip3(dex: string, symbol: string): PairInfo {
  const lowerDex = asciiLower(dex);
  const upper = asciiUpper(symbol);
  let market: Market;
  if (lowerDex === 'xyz') {
    if (XYZ_INDICES.has(upper)) {
      market = 'xyz_indices';
    } else if (XYZ_COMMODITIES.has(upper)) {
      market = 'xyz_commodities';
    } else {
      // Unknown xyz symbols default to stocks.
      market = 'xyz_stocks';
    }
  } else {
    market = 'hip3_other';
  }
  return { market, coin_key: `${lowerDex}:${symbol}`, dex: lowerDex, symbol };
}

function splitOnce(s: string, sep: string): [string, string] | null {
  const i = s.indexOf(sep);
  return i < 0 ? null : [s.slice(0, i), s.slice(i + sep.length)];
}

/**
 * Parse a freqtrade pair (`BASE/QUOTE:SETTLE`) or a bare coin.
 *
 * `dashedDexes` lists the dexes recognised in the `DEX-SYMBOL` spelling; the `dex:SYMBOL`
 * spelling is unambiguous (a colon before the slash only occurs on HIP-3 names) and is always
 * recognised.
 */
export function parsePair(pair: string, dashedDexes: readonly string[] = DEFAULT_DEXES): PairInfo {
  const base = pair.split('/')[0].trim();
  const colon = splitOnce(base, ':');
  if (colon && colon[0] !== '' && colon[1] !== '') {
    return hip3(colon[0], colon[1]);
  }
  const dash = splitOnce(base, '-');
  if (dash && dash[1] !== '' && dashedDexes.some((d) => asciiLower(d) === asciiLower(dash[0]))) {
    return hip3(dash[0], dash[1]);
  }
  return { market: 'crypto', dex: null, symbol: base, coin_key: base };
}

/**
 * Market of a bot, derived from its whitelist: `mixed` as soon as two markets appear, null for
 * an empty whitelist.
 */
export function whitelistMarket(
  whitelist: readonly string[],
  dashedDexes: readonly string[] = DEFAULT_DEXES,
): Market | null {
  let found: Market | null = null;
  for (const pair of whitelist) {
    const m = parsePair(pair, dashedDexes).market;
    if (found === null) {
      found = m;
    } else if (found !== m) {
      return 'mixed';
    }
  }
  return found;
}
