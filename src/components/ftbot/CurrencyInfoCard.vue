<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

interface CurrencyInfo {
  name: string;
  symbol: string;
  type: 'Stablecoin' | 'Cryptocurrency' | 'Fiat';
  peg: string;
  issuer: string;
  backing: string;
  chain: string;
  cmcUrl: string;
  description: string;
  risks: string;
  botImpact: string;
}

const props = defineProps<{
  currency: string;
}>();

const emit = defineEmits<{
  'filter-currency': [currency: string];
}>();

const currencyData: Record<string, CurrencyInfo> = {
  USDC: {
    name: 'USD Coin',
    symbol: 'USDC',
    type: 'Stablecoin',
    peg: 'USD (1:1)',
    issuer: 'Circle',
    backing: 'Cash reserves + US Treasury bills',
    chain: 'Multi-chain (Ethereum, Solana, etc.)',
    cmcUrl: 'https://coinmarketcap.com/currencies/usd-coin/',
    description: 'Regulated USD-pegged stablecoin by Circle, widely used in DeFi and CEX trading.',
    risks: 'Centralized, can be frozen by issuer',
    botImpact: 'Profits denominated in USDC maintain stable USD value.',
  },
  USDT: {
    name: 'Tether',
    symbol: 'USDT',
    type: 'Stablecoin',
    peg: 'USD (1:1)',
    issuer: 'Tether Limited',
    backing: 'Cash, cash equivalents, commercial paper',
    chain: 'Multi-chain',
    cmcUrl: 'https://coinmarketcap.com/currencies/tether/',
    description: 'Largest stablecoin by market cap, dominant in crypto trading pairs.',
    risks: 'Reserve transparency concerns',
    botImpact: 'Profits denominated in USDT maintain stable USD value.',
  },
  BTC: {
    name: 'Bitcoin',
    symbol: 'BTC',
    type: 'Cryptocurrency',
    peg: 'None (free market)',
    issuer: 'Decentralized (Satoshi Nakamoto)',
    backing: 'Proof of Work consensus',
    chain: 'Bitcoin',
    cmcUrl: 'https://coinmarketcap.com/currencies/bitcoin/',
    description: 'First and largest cryptocurrency. Digital gold, store of value.',
    risks: 'High volatility, price fluctuations affect all BTC-denominated profits',
    botImpact: 'BTC-denominated profits fluctuate with BTC price in fiat terms.',
  },
  ETH: {
    name: 'Ethereum',
    symbol: 'ETH',
    type: 'Cryptocurrency',
    peg: 'None (free market)',
    issuer: 'Decentralized (Vitalik Buterin)',
    backing: 'Proof of Stake consensus',
    chain: 'Ethereum',
    cmcUrl: 'https://coinmarketcap.com/currencies/ethereum/',
    description: 'Leading smart contract platform. Powers DeFi, NFTs, and L2 ecosystems.',
    risks: 'High volatility, correlated with broader crypto market',
    botImpact: 'ETH-denominated profits fluctuate with ETH price in fiat terms.',
  },
  SOL: {
    name: 'Solana',
    symbol: 'SOL',
    type: 'Cryptocurrency',
    peg: 'None (free market)',
    issuer: 'Decentralized (Solana Labs)',
    backing: 'Proof of History + Proof of Stake',
    chain: 'Solana',
    cmcUrl: 'https://coinmarketcap.com/currencies/solana/',
    description: 'High-throughput blockchain known for fast, cheap transactions and DeFi activity.',
    risks: 'High volatility, network outage history',
    botImpact: 'SOL-denominated profits fluctuate with SOL price in fiat terms.',
  },
  BNB: {
    name: 'BNB',
    symbol: 'BNB',
    type: 'Cryptocurrency',
    peg: 'None (free market)',
    issuer: 'Binance',
    backing: 'Binance ecosystem utility token',
    chain: 'BNB Chain',
    cmcUrl: 'https://coinmarketcap.com/currencies/bnb/',
    description: 'Binance ecosystem utility token. Used for fee discounts and BNB Chain gas.',
    risks: 'Tied to Binance exchange, regulatory exposure',
    botImpact: 'BNB-denominated profits fluctuate with BNB price in fiat terms.',
  },
  XRP: {
    name: 'XRP',
    symbol: 'XRP',
    type: 'Cryptocurrency',
    peg: 'None (free market)',
    issuer: 'Ripple Labs',
    backing: 'XRP Ledger consensus',
    chain: 'XRP Ledger',
    cmcUrl: 'https://coinmarketcap.com/currencies/xrp/',
    description: 'Digital payment protocol for fast, low-cost cross-border transactions.',
    risks: 'Regulatory uncertainty, centralization concerns',
    botImpact: 'XRP-denominated profits fluctuate with XRP price in fiat terms.',
  },
  BUSD: {
    name: 'Binance USD',
    symbol: 'BUSD',
    type: 'Stablecoin',
    peg: 'USD (1:1)',
    issuer: 'Paxos (for Binance)',
    backing: 'Cash reserves + US Treasury bills',
    chain: 'Ethereum / BNB Chain',
    cmcUrl: 'https://coinmarketcap.com/currencies/binance-usd/',
    description: 'Regulated USD stablecoin issued by Paxos. Being phased out by Binance.',
    risks: 'Being deprecated, liquidity declining',
    botImpact: 'Profits maintain USD value but consider migrating to USDC/USDT.',
  },
  DAI: {
    name: 'Dai',
    symbol: 'DAI',
    type: 'Stablecoin',
    peg: 'USD (1:1)',
    issuer: 'MakerDAO (decentralized)',
    backing: 'Overcollateralized crypto assets',
    chain: 'Ethereum (Multi-chain)',
    cmcUrl: 'https://coinmarketcap.com/currencies/multi-collateral-dai/',
    description: 'Decentralized USD stablecoin backed by crypto collateral via MakerDAO.',
    risks: 'Smart contract risk, collateral volatility',
    botImpact: 'Profits denominated in DAI maintain approximate USD value.',
  },
  FDUSD: {
    name: 'First Digital USD',
    symbol: 'FDUSD',
    type: 'Stablecoin',
    peg: 'USD (1:1)',
    issuer: 'First Digital Labs',
    backing: 'Cash and cash equivalents',
    chain: 'Ethereum / BNB Chain',
    cmcUrl: 'https://coinmarketcap.com/currencies/first-digital-usd/',
    description: 'USD stablecoin by First Digital, popular on Binance as BUSD replacement.',
    risks: 'Newer stablecoin, less battle-tested',
    botImpact: 'Profits denominated in FDUSD maintain stable USD value.',
  },
  EUR: {
    name: 'Euro',
    symbol: 'EUR',
    type: 'Fiat',
    peg: 'Fiat currency',
    issuer: 'European Central Bank',
    backing: 'EU monetary policy',
    chain: 'N/A (fiat)',
    cmcUrl: '',
    description: 'Official currency of the Eurozone. Used on EU-regulated exchanges like Bitvavo.',
    risks: 'EUR/USD exchange rate fluctuations',
    botImpact: 'Profits denominated in EUR. No crypto volatility on the stake currency.',
  },
  HYPE: {
    name: 'Hyperliquid',
    symbol: 'HYPE',
    type: 'Cryptocurrency',
    peg: 'None (free market)',
    issuer: 'Hyperliquid protocol',
    backing: 'Hyperliquid L1 ecosystem utility',
    chain: 'Hyperliquid L1',
    cmcUrl: 'https://coinmarketcap.com/currencies/hyperliquid/',
    description: 'Native token of the Hyperliquid L1 DEX. Used for staking and governance.',
    risks: 'High volatility, single-ecosystem dependency',
    botImpact: 'HYPE-denominated profits fluctuate with HYPE token price.',
  },
  ADA: {
    name: 'Cardano',
    symbol: 'ADA',
    type: 'Cryptocurrency',
    peg: 'None (free market)',
    issuer: 'Decentralized (IOHK)',
    backing: 'Proof of Stake (Ouroboros)',
    chain: 'Cardano',
    cmcUrl: 'https://coinmarketcap.com/currencies/cardano/',
    description: 'Research-driven blockchain platform with peer-reviewed development.',
    risks: 'High volatility, slower ecosystem growth',
    botImpact: 'ADA-denominated profits fluctuate with ADA price in fiat terms.',
  },
  DOGE: {
    name: 'Dogecoin',
    symbol: 'DOGE',
    type: 'Cryptocurrency',
    peg: 'None (free market)',
    issuer: 'Decentralized (community)',
    backing: 'Proof of Work (Scrypt)',
    chain: 'Dogecoin',
    cmcUrl: 'https://coinmarketcap.com/currencies/dogecoin/',
    description: 'Meme-origin cryptocurrency with strong community. Originally a Litecoin fork.',
    risks: 'Extreme volatility, sentiment-driven price',
    botImpact: 'DOGE-denominated profits are highly volatile in fiat terms.',
  },
  AVAX: {
    name: 'Avalanche',
    symbol: 'AVAX',
    type: 'Cryptocurrency',
    peg: 'None (free market)',
    issuer: 'Ava Labs',
    backing: 'Proof of Stake consensus',
    chain: 'Avalanche',
    cmcUrl: 'https://coinmarketcap.com/currencies/avalanche/',
    description: 'High-performance smart contract platform with subnet architecture.',
    risks: 'High volatility, competitive L1 landscape',
    botImpact: 'AVAX-denominated profits fluctuate with AVAX price in fiat terms.',
  },
  DOT: {
    name: 'Polkadot',
    symbol: 'DOT',
    type: 'Cryptocurrency',
    peg: 'None (free market)',
    issuer: 'Web3 Foundation',
    backing: 'Nominated Proof of Stake',
    chain: 'Polkadot Relay Chain',
    cmcUrl: 'https://coinmarketcap.com/currencies/polkadot-new/',
    description: 'Multi-chain protocol enabling cross-chain interoperability via parachains.',
    risks: 'High volatility, complex parachain economics',
    botImpact: 'DOT-denominated profits fluctuate with DOT price in fiat terms.',
  },
};

const currencyStyles: Record<string, { bg: string; text: string }> = {
  USDC: { bg: '#2775ca', text: '#fff' },
  USDT: { bg: '#009393', text: '#fff' },
  BUSD: { bg: '#f0b90b', text: '#000' },
  DAI: { bg: '#f5ac37', text: '#000' },
  FDUSD: { bg: '#20b26c', text: '#fff' },
  BTC: { bg: '#f7931a', text: '#fff' },
  ETH: { bg: '#627eea', text: '#fff' },
  SOL: { bg: '#9945ff', text: '#fff' },
  BNB: { bg: '#f0b90b', text: '#000' },
  XRP: { bg: '#23292f', text: '#fff' },
  ADA: { bg: '#0033ad', text: '#fff' },
  DOGE: { bg: '#c2a633', text: '#fff' },
  AVAX: { bg: '#e84142', text: '#fff' },
  DOT: { bg: '#e6007a', text: '#fff' },
  HYPE: { bg: '#0b0e17', text: '#00e87e' },
  EUR: { bg: '#003399', text: '#ffcc00' },
};

const info = computed(() => currencyData[props.currency?.toUpperCase()] ?? null);
const style = computed(() => {
  const s = currencyStyles[props.currency?.toUpperCase()];
  return s ?? { bg: '#374151', text: '#d1d5db' };
});

const typeBadgeStyle = computed(() => {
  if (!info.value) return {};
  switch (info.value.type) {
    case 'Stablecoin':
      return { background: 'rgba(34,197,94,0.15)', color: '#4ade80' };
    case 'Cryptocurrency':
      return { background: 'rgba(96,165,250,0.15)', color: '#60a5fa' };
    case 'Fiat':
      return { background: 'rgba(251,191,36,0.15)', color: '#fbbf24' };
    default:
      return { background: 'rgba(255,255,255,0.07)', color: '#a0aec0' };
  }
});
</script>

<template>
  <div class="glass-card currency-info-card text-xs" style="width: 300px">
    <!-- Unknown currency fallback -->
    <template v-if="!info">
      <div class="flex items-center gap-2 py-4">
        <i-mdi-help-circle class="text-gray-600 dark:text-gray-400" style="font-size: 1.5rem" />
        <div>
          <div class="text-sm font-bold text-gray-800 dark:text-gray-200">{{ currency || 'Unknown' }}</div>
          <div class="text-gray-600 dark:text-gray-400 mt-1">{{ t('currencyCard.currencyInfoUnavailable') }}</div>
        </div>
      </div>
    </template>

    <template v-else>
      <!-- Header -->
      <div class="flex items-center justify-between mb-2.5 pb-2 border-b border-gray-300 dark:border-gray-700">
        <div class="flex items-center gap-2">
          <div
            class="flex items-center justify-center rounded-lg font-black text-sm"
            style="width: 36px; height: 36px"
            :style="{ background: style.bg, color: style.text }"
          >
            {{ info.symbol.slice(0, 2) }}
          </div>
          <div>
            <div class="text-sm font-bold text-gray-100">{{ info.name }}</div>
            <div
              class="text-[0.8rem] text-gray-600 dark:text-gray-400 cursor-pointer hover:text-blue-400 transition-colors"
              v-tooltip.top="t('currencyCard.filterByCurrency', { currency: info.symbol })"
              @click="emit('filter-currency', info.symbol)"
            >{{ info.symbol }}</div>
          </div>
        </div>
        <span
          class="text-[0.8rem] font-bold px-2 py-0.5 rounded-full"
          :style="typeBadgeStyle"
        >{{ info.type }}</span>
      </div>

      <!-- Description -->
      <div class="text-gray-700 dark:text-gray-300 mb-2.5 leading-relaxed" style="font-size: 0.95rem">
        {{ info.description }}
      </div>

      <!-- Peg info (prominent for stablecoins) -->
      <div
        v-if="info.type === 'Stablecoin'"
        class="flex items-center gap-2 mb-2.5 px-2.5 py-1.5 rounded-lg"
        style="background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2)"
      >
        <i-mdi-link-variant class="text-green-400" style="font-size: 1rem" />
        <div>
          <div class="text-green-400 font-bold" style="font-size: 0.95rem" v-tooltip.top="t('tooltips.pegInfo')">{{ t('currencyCard.peggedTo', { peg: info.peg }) }}</div>
          <div class="text-gray-600 dark:text-gray-400" style="font-size: 0.95rem" v-tooltip.top="t('tooltips.backing')">{{ info.backing }}</div>
        </div>
      </div>

      <!-- Key info grid -->
      <div class="space-y-1 mb-2.5 pb-2.5 border-b border-gray-300 dark:border-gray-700">
        <div class="flex justify-between">
          <span class="text-gray-600 dark:text-gray-400">{{ t('currencyCard.issuer') }}</span>
          <span class="text-gray-800 dark:text-gray-200 font-semibold">{{ info.issuer }}</span>
        </div>
        <div v-if="info.type !== 'Stablecoin'" class="flex justify-between">
          <span class="text-gray-600 dark:text-gray-400" v-tooltip.top="t('tooltips.pegInfo')">{{ t('currencyCard.peg') }}</span>
          <span class="text-gray-800 dark:text-gray-200">{{ info.peg }}</span>
        </div>
        <div v-if="info.type !== 'Stablecoin'" class="flex justify-between">
          <span class="text-gray-600 dark:text-gray-400" v-tooltip.top="t('tooltips.backing')">{{ t('currencyCard.backing') }}</span>
          <span class="text-gray-800 dark:text-gray-200">{{ info.backing }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-600 dark:text-gray-400">{{ t('currencyCard.chain') }}</span>
          <span class="text-gray-800 dark:text-gray-200">{{ info.chain }}</span>
        </div>
      </div>

      <!-- Bot impact note -->
      <div class="flex items-start gap-1.5 mb-2 px-2 py-1.5 rounded-lg" style="background: rgba(96,165,250,0.08); border: 1px solid rgba(96,165,250,0.15)">
        <i-mdi-robot class="text-blue-400 mt-0.5 flex-shrink-0" style="font-size: 0.9rem" />
        <span class="text-blue-300" style="font-size: 0.9rem">{{ info.botImpact }}</span>
      </div>

      <!-- Risks note -->
      <div class="flex items-start gap-1.5 text-gray-600 dark:text-gray-500" style="font-size: 0.95rem">
        <i-mdi-alert-circle-outline class="mt-0.5 flex-shrink-0" style="font-size: 0.95rem" />
        <span>{{ info.risks }}</span>
      </div>

      <!-- CMC link -->
      <a v-if="info.cmcUrl" :href="info.cmcUrl" target="_blank" rel="noopener" class="block text-center text-blue-400 hover:underline cursor-pointer mt-2" style="font-size: 0.95rem">
        <i-mdi-open-in-new style="font-size: 0.9rem; vertical-align: middle" />
        CoinMarketCap ↗
      </a>
    </template>
  </div>
</template>

<style scoped>
.glass-card {
  font-size: 0.9rem;
  line-height: 1.4;
  background: rgba(15, 17, 23, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 16px;
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
</style>
