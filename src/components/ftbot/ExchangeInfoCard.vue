<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

interface ExchangeInfo {
  name: string;
  type: string;
  token: string;
  founded: string;
  headquarters: string;
  country: string;
  flag: string;
  website: string;
  cmcUrl: string;
  tradingTypes: string[];
  freqtradeSupport: string[];
  maxLeverage: string;
  makerFee: string;
  takerFee: string;
  kyc: string;
  description: string;
}

const props = defineProps<{
  exchange: string;
}>();

const emit = defineEmits<{
  'filter-trading-mode': [mode: string];
}>();

const exchangeData: Record<string, ExchangeInfo> = {
  hyperliquid: {
    name: 'Hyperliquid',
    type: 'DEX (Decentralized)',
    token: 'HYPE',
    founded: '2023',
    headquarters: 'Decentralized',
    country: 'Decentralized',
    flag: '🌐',
    website: 'app.hyperliquid.xyz/portfolio',
    cmcUrl: 'https://coinmarketcap.com/exchanges/hyperliquid/',
    tradingTypes: ['Futures (Perpetuals)'],
    freqtradeSupport: ['Futures'],
    maxLeverage: '50x',
    makerFee: '0.01%',
    takerFee: '0.035%',
    kyc: 'No KYC required',
    description: 'High-performance L1 DEX for perpetual futures trading with on-chain order book.',
  },
  binance: {
    name: 'Binance',
    type: 'CEX (Centralized)',
    token: 'BNB',
    founded: '2017',
    headquarters: 'Cayman Islands / Global',
    country: 'Cayman Islands',
    flag: '🇰🇾',
    website: 'binance.com',
    cmcUrl: 'https://coinmarketcap.com/exchanges/binance/',
    tradingTypes: ['Spot', 'Futures (Perpetuals)', 'Margin'],
    freqtradeSupport: ['Spot', 'Futures'],
    maxLeverage: '125x',
    makerFee: '0.1%',
    takerFee: '0.1%',
    kyc: 'Required (PSAN France)',
    description: "World's largest crypto exchange by trading volume.",
  },
  kraken: {
    name: 'Kraken',
    type: 'CEX (Centralized)',
    token: 'None',
    founded: '2011',
    headquarters: 'San Francisco, USA',
    country: 'USA',
    flag: '🇺🇸',
    website: 'kraken.com',
    cmcUrl: 'https://coinmarketcap.com/exchanges/kraken/',
    tradingTypes: ['Spot', 'Futures', 'Margin'],
    freqtradeSupport: ['Spot', 'Futures'],
    maxLeverage: '50x',
    makerFee: '0.16%',
    takerFee: '0.26%',
    kyc: 'Required (PSAN France)',
    description: 'One of the oldest and most trusted crypto exchanges.',
  },
  gateio: {
    name: 'Gate.io',
    type: 'CEX (Centralized)',
    token: 'GT',
    founded: '2013',
    headquarters: 'Cayman Islands',
    country: 'Cayman Islands',
    flag: '🇰🇾',
    website: 'gate.io',
    cmcUrl: 'https://coinmarketcap.com/exchanges/gate-io/',
    tradingTypes: ['Spot', 'Futures', 'Margin'],
    freqtradeSupport: ['Spot', 'Futures'],
    maxLeverage: '100x',
    makerFee: '0.2%',
    takerFee: '0.2%',
    kyc: 'Required (PSAN France)',
    description: 'Major exchange known for listing new altcoins early.',
  },
  bybit: {
    name: 'Bybit',
    type: 'CEX (Centralized)',
    token: 'None',
    founded: '2018',
    headquarters: 'Dubai, UAE',
    country: 'UAE',
    flag: '🇦🇪',
    website: 'bybit.com',
    cmcUrl: 'https://coinmarketcap.com/exchanges/bybit/',
    tradingTypes: ['Spot', 'Futures (Perpetuals)', 'Options'],
    freqtradeSupport: ['Spot', 'Futures'],
    maxLeverage: '100x',
    makerFee: '0.1%',
    takerFee: '0.1%',
    kyc: 'Required (PSAN France)',
    description: 'Fast-growing derivatives-focused exchange.',
  },
  okx: {
    name: 'OKX',
    type: 'CEX (Centralized)',
    token: 'OKB',
    founded: '2017',
    headquarters: 'Seychelles',
    country: 'Seychelles',
    flag: '🇸🇨',
    website: 'okx.com',
    cmcUrl: 'https://coinmarketcap.com/exchanges/okx/',
    tradingTypes: ['Spot', 'Futures', 'Options', 'Margin'],
    freqtradeSupport: ['Spot', 'Futures'],
    maxLeverage: '125x',
    makerFee: '0.08%',
    takerFee: '0.1%',
    kyc: 'Required (via MyOKX EEA)',
    description: 'Top-tier exchange with advanced trading features.',
  },
  myokx: {
    name: 'MyOKX',
    type: 'CEX (Centralized)',
    token: 'OKB',
    founded: '2017',
    headquarters: 'Seychelles',
    country: 'Seychelles',
    flag: '🇸🇨',
    website: 'okx.com',
    cmcUrl: 'https://coinmarketcap.com/exchanges/okx/',
    tradingTypes: ['Spot', 'Futures', 'Options', 'Margin'],
    freqtradeSupport: ['Spot', 'Futures'],
    maxLeverage: '125x',
    makerFee: '0.08%',
    takerFee: '0.1%',
    kyc: 'Required (via MyOKX EEA)',
    description: 'OKX European Economic Area entity with local compliance.',
  },
  bitget: {
    name: 'Bitget',
    type: 'CEX (Centralized)',
    token: 'BGB',
    founded: '2018',
    headquarters: 'Singapore',
    country: 'Singapore',
    flag: '🇸🇬',
    website: 'bitget.com',
    cmcUrl: 'https://coinmarketcap.com/exchanges/bitget/',
    tradingTypes: ['Spot', 'Futures (Perpetuals)', 'Copy Trading'],
    freqtradeSupport: ['Spot', 'Futures'],
    maxLeverage: '125x',
    makerFee: '0.1%',
    takerFee: '0.1%',
    kyc: 'Required',
    description: 'Popular exchange known for copy trading and derivatives.',
  },
  htx: {
    name: 'HTX (Huobi)',
    type: 'CEX (Centralized)',
    token: 'HT',
    founded: '2013',
    headquarters: 'Seychelles',
    country: 'Seychelles',
    flag: '🇸🇨',
    website: 'htx.com',
    cmcUrl: 'https://coinmarketcap.com/exchanges/htx/',
    tradingTypes: ['Spot', 'Futures', 'Margin'],
    freqtradeSupport: ['Spot', 'Futures'],
    maxLeverage: '200x',
    makerFee: '0.2%',
    takerFee: '0.2%',
    kyc: 'Required',
    description: 'Long-standing exchange, formerly known as Huobi Global.',
  },
  kucoin: {
    name: 'KuCoin',
    type: 'CEX (Centralized)',
    token: 'KCS',
    founded: '2017',
    headquarters: 'Seychelles',
    country: 'Seychelles',
    flag: '🇸🇨',
    website: 'kucoin.com',
    cmcUrl: 'https://coinmarketcap.com/exchanges/kucoin/',
    tradingTypes: ['Spot', 'Futures', 'Margin'],
    freqtradeSupport: ['Spot', 'Futures'],
    maxLeverage: '100x',
    makerFee: '0.1%',
    takerFee: '0.1%',
    kyc: 'Required',
    description: "The People's Exchange, known for wide altcoin selection.",
  },
  bitmart: {
    name: 'BitMart',
    type: 'CEX (Centralized)',
    token: 'BMX',
    founded: '2017',
    headquarters: 'Cayman Islands',
    country: 'Cayman Islands',
    flag: '🇰🇾',
    website: 'bitmart.com',
    cmcUrl: 'https://coinmarketcap.com/exchanges/bitmart/',
    tradingTypes: ['Spot', 'Futures'],
    freqtradeSupport: ['Spot', 'Futures'],
    maxLeverage: '100x',
    makerFee: '0.25%',
    takerFee: '0.25%',
    kyc: 'Required',
    description: 'Global exchange with focus on new token listings.',
  },
  bingx: {
    name: 'BingX',
    type: 'CEX (Centralized)',
    token: 'None',
    founded: '2018',
    headquarters: 'Singapore',
    country: 'Singapore',
    flag: '🇸🇬',
    website: 'bingx.com',
    cmcUrl: 'https://coinmarketcap.com/exchanges/bingx/',
    tradingTypes: ['Spot', 'Futures (Perpetuals)', 'Copy Trading'],
    freqtradeSupport: ['Spot', 'Futures'],
    maxLeverage: '150x',
    makerFee: '0.1%',
    takerFee: '0.1%',
    kyc: 'Required',
    description: 'Social trading platform with copy trading features.',
  },
  bitvavo: {
    name: 'Bitvavo',
    type: 'CEX (Centralized)',
    token: 'None',
    founded: '2018',
    headquarters: 'Netherlands',
    country: 'Netherlands',
    flag: '🇳🇱',
    website: 'bitvavo.com',
    cmcUrl: 'https://coinmarketcap.com/exchanges/bitvavo/',
    tradingTypes: ['Spot'],
    freqtradeSupport: ['Spot'],
    maxLeverage: 'N/A',
    makerFee: '0.15%',
    takerFee: '0.25%',
    kyc: 'Required (EU regulated)',
    description: 'Dutch exchange regulated under EU framework, spot trading only.',
  },
};

const exchangeStyles: Record<string, { bg: string; text: string; accent: string }> = {
  hyperliquid: { bg: '#0b0e17', text: '#00e87e', accent: '#00e87e' },
  binance: { bg: '#1e2026', text: '#f0b90b', accent: '#f0b90b' },
  kraken: { bg: '#1b0d3e', text: '#7b61ff', accent: '#7b61ff' },
  gateio: { bg: '#171a29', text: '#2ea8ff', accent: '#2ea8ff' },
  bybit: { bg: '#181c25', text: '#f7a600', accent: '#f7a600' },
  okx: { bg: '#121212', text: '#ffffff', accent: '#818cf8' },
  myokx: { bg: '#121212', text: '#ffffff', accent: '#818cf8' },
  bitget: { bg: '#1b1d28', text: '#00c9a7', accent: '#00c9a7' },
  htx: { bg: '#1a1e2e', text: '#2b8af7', accent: '#2b8af7' },
  kucoin: { bg: '#0b2e1e', text: '#23af5f', accent: '#23af5f' },
  bitmart: { bg: '#1a1f2e', text: '#00b8d9', accent: '#00b8d9' },
  bingx: { bg: '#1c2030', text: '#2d8cf0', accent: '#2d8cf0' },
  bitvavo: { bg: '#0d1b2a', text: '#4d9de0', accent: '#4d9de0' },
};

const info = computed(() => exchangeData[props.exchange?.toLowerCase()] ?? null);
const style = computed(
  () =>
    exchangeStyles[props.exchange?.toLowerCase()] ?? {
      bg: '#1a1a2e',
      text: '#a0aec0',
      accent: '#a0aec0',
    },
);
const isDex = computed(() => info.value?.type?.includes('DEX') ?? false);
</script>

<template>
  <div class="glass-card exchange-info-card text-xs" style="width: 320px">
    <!-- Unknown exchange fallback -->
    <template v-if="!info">
      <div class="flex items-center gap-2 py-4">
        <i-mdi-help-circle class="text-gray-600 dark:text-gray-400" style="font-size: 1.5rem" />
        <div>
          <div class="text-sm font-bold text-gray-800 dark:text-gray-200">
            {{ exchange || 'Unknown' }}
          </div>
          <div class="text-gray-600 dark:text-gray-400 mt-1">
            {{ t('exchangeCard.exchangeInfoUnavailable') }}
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <!-- Header -->
      <div
        class="flex items-center justify-between mb-2.5 pb-2 border-b"
        :style="{ borderColor: style.accent + '33' }"
      >
        <div class="flex items-center gap-2">
          <div
            class="flex items-center justify-center rounded-lg font-black text-sm"
            style="width: 36px; height: 36px"
            :style="{ background: style.accent + '22', color: style.accent }"
          >
            {{ info.name.charAt(0) }}
          </div>
          <div>
            <div class="text-sm font-bold" :style="{ color: style.text }">{{ info.name }}</div>
            <a
              :href="`https://${info.website}`"
              target="_blank"
              rel="noopener"
              class="text-[0.8rem] text-blue-400 hover:underline cursor-pointer"
              >{{ info.website }} ↗</a
            >
          </div>
        </div>
        <span
          class="text-[0.8rem] font-bold px-2 py-0.5 rounded-full"
          :style="{
            background: isDex ? '#00e87e22' : '#818cf822',
            color: isDex ? '#00e87e' : '#818cf8',
          }"
          >{{ isDex ? 'DEX' : 'CEX' }}</span
        >
      </div>

      <!-- Description -->
      <div
        class="text-gray-700 dark:text-gray-300 mb-2.5 leading-relaxed"
        style="font-size: 0.95rem"
      >
        {{ info.description }}
      </div>

      <!-- Key metrics grid -->
      <div
        class="grid grid-cols-3 gap-2 mb-2.5 pb-2.5 border-b border-gray-300 dark:border-gray-700"
      >
        <div class="flex flex-col items-center text-center">
          <span class="text-gray-600 dark:text-gray-500" style="font-size: 0.95rem">{{
            t('exchangeCard.founded')
          }}</span>
          <span class="font-bold text-gray-800 dark:text-gray-200">{{ info.founded }}</span>
        </div>
        <div class="flex flex-col items-center text-center">
          <span
            class="text-gray-600 dark:text-gray-500"
            style="font-size: 0.95rem"
            v-tooltip.top="t('tooltips.maxLeverage')"
            >{{ t('exchangeCard.maxLeverage') }}</span
          >
          <span class="font-bold" :style="{ color: style.accent }">{{ info.maxLeverage }}</span>
        </div>
        <div class="flex flex-col items-center text-center">
          <span class="text-gray-600 dark:text-gray-500" style="font-size: 0.95rem">{{
            t('exchangeCard.token')
          }}</span>
          <span class="font-bold text-gray-800 dark:text-gray-200">{{ info.token }}</span>
        </div>
      </div>

      <!-- Fees -->
      <div class="flex items-center gap-1 mb-1.5 text-gray-700 dark:text-gray-300 font-semibold">
        <i-mdi-percent class="text-amber-400" style="font-size: 0.9rem" />
        {{ t('exchangeCard.fees') }}
      </div>
      <div class="flex gap-4 mb-2.5 pb-2.5 border-b border-gray-300 dark:border-gray-700">
        <div class="flex gap-1.5 items-baseline">
          <span
            class="text-gray-600 dark:text-gray-500"
            style="font-size: 0.95rem"
            v-tooltip.top="t('tooltips.makerFee')"
            >{{ t('exchangeCard.makerFee') }}</span
          >
          <span class="font-bold text-green-400">{{ info.makerFee }}</span>
        </div>
        <div class="flex gap-1.5 items-baseline">
          <span
            class="text-gray-600 dark:text-gray-500"
            style="font-size: 0.95rem"
            v-tooltip.top="t('tooltips.takerFee')"
            >{{ t('exchangeCard.takerFee') }}</span
          >
          <span class="font-bold text-amber-400">{{ info.takerFee }}</span>
        </div>
      </div>

      <!-- Trading types -->
      <div class="flex items-center gap-1 mb-1.5 text-gray-700 dark:text-gray-300 font-semibold">
        <i-mdi-swap-horizontal class="text-blue-400" style="font-size: 0.9rem" />
        {{ t('exchangeCard.tradingTypes') }}
      </div>
      <div class="flex flex-wrap gap-1 mb-2">
        <span
          v-for="tt in info.tradingTypes"
          :key="tt"
          class="text-[0.85rem] font-semibold px-1.5 py-0.5 rounded"
          style="background: rgba(255, 255, 255, 0.07); color: #e5e7eb"
          >{{ tt }}</span
        >
      </div>

      <!-- Freqtrade support -->
      <div class="flex items-center gap-1 mb-1.5 text-gray-700 dark:text-gray-300 font-semibold">
        <i-mdi-check-circle class="text-green-400" style="font-size: 0.9rem" />
        {{ t('exchangeCard.freqtradeSupport') }}
      </div>
      <div class="flex flex-wrap gap-1 mb-2.5 pb-2.5 border-b border-gray-300 dark:border-gray-700">
        <span
          v-for="fs in info.freqtradeSupport"
          :key="fs"
          class="text-[0.85rem] font-semibold px-1.5 py-0.5 rounded cursor-pointer hover:ring-1 hover:ring-green-400/50 transition-all"
          style="background: rgba(34, 197, 94, 0.15); color: #4ade80"
          v-tooltip.top="t('exchangeCard.filterByMode', { mode: fs })"
          @click="emit('filter-trading-mode', fs)"
          >{{ fs }}</span
        >
      </div>

      <!-- KYC + HQ -->
      <div class="space-y-1 mb-2">
        <div class="flex justify-between">
          <span class="text-gray-600 dark:text-gray-400" v-tooltip="t('tooltips.kycStatus')">{{
            t('exchangeCard.kyc')
          }}</span>
          <span class="text-gray-800 dark:text-gray-200 font-semibold">{{ info.kyc }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-600 dark:text-gray-400">{{ t('exchangeCard.hq') }}</span>
          <span class="text-gray-800 dark:text-gray-200"
            >{{ info.flag }} {{ info.headquarters }}</span
          >
        </div>
      </div>

      <!-- CMC link -->
      <a
        :href="info.cmcUrl"
        target="_blank"
        rel="noopener"
        class="block text-center text-blue-400 hover:underline cursor-pointer"
        style="font-size: 0.95rem"
      >
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
