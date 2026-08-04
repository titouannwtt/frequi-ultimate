/**
 * Composable for fetching and caching benchmark price data from CoinGecko API.
 */

export interface PricePoint {
  timestamp: number;
  price: number;
}

interface CacheEntry {
  data: PricePoint[];
  fetchedAt: number;
  days: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache: Record<string, CacheEntry> = {};

function cacheKey(coinId: string, days: number): string {
  return `${coinId}_${days}`;
}

export interface FetchResult {
  data: PricePoint[];
  error?: string;
}

/**
 * Fetch price history for any CoinGecko coin ID.
 * Results are cached for 10 minutes.
 */
export async function fetchCoinHistory(coinId: string, days: number): Promise<FetchResult> {
  const key = cacheKey(coinId, days);
  const cached = cache[key];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS && cached.days === days) {
    return { data: cached.data };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=${days}`,
      { signal: controller.signal },
    );
    clearTimeout(timeoutId);
    if (!resp.ok) {
      if (resp.status === 429) {
        console.warn(`CoinGecko rate limited for ${coinId}, using cache if available`);
        return { data: cached?.data ?? [], error: 'rate_limited' };
      }
      if (resp.status === 404) {
        console.warn(`CoinGecko coin not found: ${coinId}`);
        return { data: [], error: 'not_found' };
      }
      console.warn(`CoinGecko API error for ${coinId}: ${resp.status}`);
      return { data: cached?.data ?? [], error: `api_error_${resp.status}` };
    }
    const json = await resp.json();
    const prices: [number, number][] = json.prices ?? [];
    const data: PricePoint[] = prices.map(([ts, price]) => ({ timestamp: ts, price }));
    cache[key] = { data, fetchedAt: Date.now(), days };
    return { data };
  } catch (err) {
    console.warn(`Failed to fetch ${coinId} benchmark data:`, err);
    return { data: cached?.data ?? [], error: 'network_error' };
  }
}

/** Well-known benchmark coins and their CoinGecko IDs */
export const KNOWN_BENCHMARKS: Record<string, string> = {
  // Major cryptos
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  AVAX: 'avalanche-2',
  DOT: 'polkadot',
  LINK: 'chainlink',
  NEAR: 'near',
  SUI: 'sui',
  // Meme coins
  DOGE: 'dogecoin',
  SHIB: 'shiba-inu',
  PEPE: 'pepe',
  WIF: 'dogwifcoin',
  BONK: 'bonk',
  FLOKI: 'floki',
  // AI / Agent sector
  TAO: 'bittensor',
  FET: 'fetch-ai',
  RNDR: 'render-token',
  VIRTUAL: 'virtual-protocol',
  // DeFi sector
  AAVE: 'aave',
  UNI: 'uniswap',
  MKR: 'maker',
  // Hyperliquid
  HYPE: 'hyperliquid',
  PURR: 'purr',
};

/** Curated benchmark categories for the dropdown */
export const BENCHMARK_CATEGORIES: { label: string; tickers: string[] }[] = [
  { label: 'Majors', tickers: ['BTC', 'ETH', 'SOL', 'BNB'] },
  { label: 'Meme Coins', tickers: ['DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK', 'FLOKI'] },
  { label: 'AI / Agents', tickers: ['TAO', 'FET', 'RNDR', 'VIRTUAL'] },
  { label: 'DeFi', tickers: ['AAVE', 'UNI', 'MKR'] },
  { label: 'L1 / L2', tickers: ['SOL', 'AVAX', 'NEAR', 'SUI', 'DOT', 'ADA'] },
  { label: 'Hyperliquid', tickers: ['HYPE', 'PURR'] },
];

/** All benchmark coin ticker symbols available in the dropdown */
export const BENCHMARK_TICKERS = Object.keys(KNOWN_BENCHMARKS);

/**
 * Resolve a ticker or CoinGecko ID to a CoinGecko ID.
 * If the input matches a known ticker, use the mapped ID.
 * Otherwise, treat it as a raw CoinGecko ID (for custom inputs).
 */
export function resolveGeckoId(input: string): string {
  const upper = input.toUpperCase();
  return KNOWN_BENCHMARKS[upper] ?? input.toLowerCase();
}

/** Fetch benchmark history for a ticker or CoinGecko ID */
export async function fetchBenchmarkHistory(
  tickerOrId: string,
  days: number,
): Promise<FetchResult> {
  const geckoId = resolveGeckoId(tickerOrId);
  return fetchCoinHistory(geckoId, days);
}

/**
 * Normalize price data to percentage change from the first data point.
 * Returns values as percentages (e.g., 5.2 means +5.2%).
 */
export function normalizeToPercent(data: PricePoint[]): PricePoint[] {
  if (data.length === 0) return [];
  const base = data[0]!.price;
  if (base === 0) return data;
  return data.map((p) => ({
    timestamp: p.timestamp,
    price: ((p.price - base) / base) * 100,
  }));
}

export function clearBenchmarkCache(): void {
  for (const key of Object.keys(cache)) {
    delete cache[key];
  }
}

/** Type alias kept for backward compatibility */
export type BenchmarkCoin = string;
