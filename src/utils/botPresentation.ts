// Shared visual-presentation helpers for bots (exchange / currency brand colors).
// Used by both the bot comparison table and the "Available bots" list so badges
// look identical across views.

// Exchange brand colors (bg, text)
export const exchangeStyles: Record<string, { bg: string; text: string }> = {
  hyperliquid: { bg: '#0b0e17', text: '#00e87e' },
  binance: { bg: '#1e2026', text: '#f0b90b' },
  kraken: { bg: '#1b0d3e', text: '#7b61ff' },
  gateio: { bg: '#171a29', text: '#2ea8ff' },
  bybit: { bg: '#181c25', text: '#f7a600' },
  okx: { bg: '#121212', text: '#ffffff' },
  myokx: { bg: '#121212', text: '#ffffff' },
  bitget: { bg: '#1b1d28', text: '#00c9a7' },
  htx: { bg: '#1a1e2e', text: '#2b8af7' },
  kucoin: { bg: '#0b2e1e', text: '#23af5f' },
  bitmart: { bg: '#1a1f2e', text: '#00b8d9' },
  bingx: { bg: '#1c2030', text: '#2d8cf0' },
  bitvavo: { bg: '#0d1b2a', text: '#4d9de0' },
};

// Currency brand colors (bg, text)
export const currencyStyles: Record<string, { bg: string; text: string }> = {
  // Stablecoins
  USDC: { bg: '#2775ca', text: '#fff' },
  USDT: { bg: '#009393', text: '#fff' },
  BUSD: { bg: '#f0b90b', text: '#000' },
  DAI: { bg: '#f5ac37', text: '#000' },
  TUSD: { bg: '#002868', text: '#fff' },
  FDUSD: { bg: '#20b26c', text: '#fff' },
  // Major tokens
  BTC: { bg: '#f7931a', text: '#fff' },
  ETH: { bg: '#627eea', text: '#fff' },
  SOL: { bg: '#9945ff', text: '#fff' },
  BNB: { bg: '#f0b90b', text: '#000' },
  XRP: { bg: '#23292f', text: '#fff' },
  ADA: { bg: '#0033ad', text: '#fff' },
  DOGE: { bg: '#c2a633', text: '#fff' },
  AVAX: { bg: '#e84142', text: '#fff' },
  DOT: { bg: '#e6007a', text: '#fff' },
  MATIC: { bg: '#8247e5', text: '#fff' },
  POL: { bg: '#8247e5', text: '#fff' },
  LINK: { bg: '#2a5ada', text: '#fff' },
  HYPE: { bg: '#0b0e17', text: '#00e87e' },
  NEAR: { bg: '#000', text: '#fff' },
  ATOM: { bg: '#2e3148', text: '#a7b4cd' },
  ARB: { bg: '#213147', text: '#28a0f0' },
  OP: { bg: '#ff0420', text: '#fff' },
  SUI: { bg: '#4da2ff', text: '#fff' },
  APT: { bg: '#000', text: '#06d6a0' },
  TRX: { bg: '#eb0029', text: '#fff' },
  EUR: { bg: '#003399', text: '#ffcc00' },
};

export function getExchangeStyle(exchange: string): { background: string; color: string } {
  const style = exchangeStyles[exchange?.toLowerCase()];
  if (style) return { background: style.bg, color: style.text };
  return { background: 'var(--p-surface-700)', color: 'var(--p-surface-200)' };
}

export function capitalizeExchange(exchange: string): string {
  if (!exchange) return '';
  return exchange.charAt(0).toUpperCase() + exchange.slice(1);
}

export function getCurrencyStyle(currency: string): { background: string; color: string } | null {
  const style = currencyStyles[currency?.toUpperCase()];
  if (style) return { background: style.bg, color: style.text };
  return null;
}
