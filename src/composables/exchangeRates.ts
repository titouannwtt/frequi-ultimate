import { ref, computed, onScopeDispose } from 'vue';

// CoinGecko IDs for common stake currencies
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  AVAX: 'avalanche-2',
  DOT: 'polkadot',
  MATIC: 'matic-network',
  POL: 'matic-network',
  LINK: 'chainlink',
  HYPE: 'hyperliquid',
  NEAR: 'near',
  ATOM: 'cosmos',
  ARB: 'arbitrum',
  OP: 'optimism',
  SUI: 'sui',
  APT: 'aptos',
  TRX: 'tron',
};

// Stablecoins pegged to USD (1:1)
const USD_STABLECOINS = new Set(['USDC', 'USDT', 'BUSD', 'DAI', 'FDUSD', 'TUSD']);

// Rates in USD (base currency)
const ratesUSD = ref<Record<string, number>>({});
const lastFetchTime = ref(0);
const isLoading = ref(false);
const fetchError = ref('');

// Fetch interval: 5 minutes
const FETCH_INTERVAL = 5 * 60 * 1000;
let fetchInterval: ReturnType<typeof setInterval> | null = null;

async function fetchRates() {
  // Get unique CoinGecko IDs needed
  const ids = Object.values(COINGECKO_IDS).join(',');
  if (!ids) return;

  isLoading.value = true;
  fetchError.value = '';

  try {
    // Fetch USD and EUR rates in a single call (5s timeout)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,eur`,
      { signal: controller.signal },
    );
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`CoinGecko API error: ${response.status}`);

    const data = await response.json();

    // Map back to currency symbols
    const newRates: Record<string, number> = {};
    for (const [symbol, geckoId] of Object.entries(COINGECKO_IDS)) {
      if (data[geckoId]?.usd) {
        newRates[symbol] = data[geckoId].usd;
      }
    }

    // Stablecoins = 1 USD
    for (const stable of USD_STABLECOINS) {
      newRates[stable] = 1;
    }

    // EUR: derive from any stablecoin's EUR rate (1 USDC in EUR = EUR/USD rate)
    const eurRate = data['usd-coin']?.eur;
    if (eurRate && eurRate > 0) {
      // 1 USDC = eurRate EUR, so 1 EUR = 1/eurRate USD
      newRates['EUR'] = 1 / eurRate;
    }
    // No hardcoded fallback — convert() returns null if EUR rate unavailable

    ratesUSD.value = newRates;
    lastFetchTime.value = Date.now();
  } catch (err) {
    fetchError.value = String(err);
    console.warn('Failed to fetch exchange rates:', err);
  } finally {
    isLoading.value = false;
  }
}

let subscriberCount = 0;

export function useExchangeRates() {
  // Start periodic fetch if not already running
  if (!fetchInterval) {
    fetchRates(); // Fetch immediately
    fetchInterval = setInterval(fetchRates, FETCH_INTERVAL);
  }
  subscriberCount++;

  onScopeDispose(() => {
    subscriberCount--;
    if (subscriberCount <= 0 && fetchInterval) {
      clearInterval(fetchInterval);
      fetchInterval = null;
      subscriberCount = 0;
    }
  });

  /**
   * Convert an amount from one currency to another
   * Returns null if rate is unavailable
   */
  function convert(amount: number, from: string, to: string): number | null {
    if (from === to) return amount;

    const fromRate = ratesUSD.value[from.toUpperCase()];
    const toRate = ratesUSD.value[to.toUpperCase()];

    if (!fromRate || !toRate) return null;

    // Convert via USD: amount * (fromRate / toRate)
    return amount * (fromRate / toRate);
  }

  /**
   * Get the USD value of an amount in a given currency
   */
  function toUSD(amount: number, currency: string): number | null {
    const rate = ratesUSD.value[currency.toUpperCase()];
    if (!rate) return null;
    return amount * rate;
  }

  /**
   * Get the rate of a currency in terms of another
   */
  function getRate(from: string, to: string): number | null {
    if (from === to) return 1;
    const fromRate = ratesUSD.value[from.toUpperCase()];
    const toRate = ratesUSD.value[to.toUpperCase()];
    if (!fromRate || !toRate) return null;
    return fromRate / toRate;
  }

  const hasRates = computed(() => Object.keys(ratesUSD.value).length > 0);

  return {
    ratesUSD,
    isLoading,
    fetchError,
    lastFetchTime,
    hasRates,
    convert,
    toUSD,
    getRate,
    fetchRates,
  };
}
