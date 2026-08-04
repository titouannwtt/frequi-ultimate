<script lang="ts">
// Module-level cache for candle data
const _rangeCache = new Map<string, { data: number[][]; columns: string[] }>();
</script>

<script setup lang="ts">
import type { Trade } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  trade: Trade;
  botId: string;
}>();

const botStore = useBotStore();

const loading = ref(true);
const candles = ref<number[][]>([]);
const columns = ref<string[]>([]);

const timeframe = computed(() => {
  const bid = props.botId || botStore.selectedBot;
  if (bid) {
    const botTf = (botStore.allBotState[bid] as any)?.timeframe;
    if (botTf) return botTf;
  }
  const durationMs = Date.now() - props.trade.open_timestamp;
  const durationHours = durationMs / 3600000;
  if (durationHours < 6) return '5m';
  if (durationHours < 48) return '15m';
  return '1h';
});

// Resolve botId: props.botId may be undefined in single-bot mode
const resolvedBotId = computed(() => props.botId || botStore.selectedBot);

onMounted(async () => {
  const bid = resolvedBotId.value;
  const cacheKey = `${props.trade.pair}__${timeframe.value}__${bid}`;
  const cached = _rangeCache.get(cacheKey);
  if (cached) {
    candles.value = cached.data;
    columns.value = cached.columns;
    loading.value = false;
    return;
  }
  try {
    const store = botStore.botStores[bid] ?? botStore.activeBot;
    if (!store) {
      loading.value = false;
      return;
    }
    await store.getPairCandles({ pair: props.trade.pair, timeframe: timeframe.value, limit: 5000 });
    const key = `${props.trade.pair}__${timeframe.value}`;
    const cd = (store.candleData as Record<string, any>)[key];
    if (cd?.data?.data && cd.data.columns) {
      candles.value = cd.data.data;
      columns.value = cd.data.columns;
      _rangeCache.set(cacheKey, { data: cd.data.data, columns: cd.data.columns });
    }
  } catch {
    /* ignore */
  } finally {
    loading.value = false;
  }
});

const colIdx = computed(() => {
  const c = columns.value;
  return {
    date: c.indexOf('date'),
    high: c.indexOf('high'),
    low: c.indexOf('low'),
    close: c.indexOf('close'),
  };
});

// Filter candles from trade open to now
const tradeCandles = computed(() => {
  if (!candles.value.length || colIdx.value.date < 0) return [];
  const openTs = props.trade.open_timestamp;
  let startIdx = candles.value.findIndex((c) => c[colIdx.value.date] >= openTs);
  if (startIdx < 0) startIdx = 0;
  startIdx = Math.max(0, startIdx - 2);
  return candles.value.slice(startIdx);
});

const entryPrice = computed(() => props.trade.open_rate ?? 0);
const currentPrice = computed(() => props.trade.current_rate ?? entryPrice.value);
const isShort = computed(() => props.trade.is_short ?? false);
const leverage = computed(() => props.trade.leverage ?? 1);

// Compute profit % for a given price
function profitPctAtPrice(price: number): number {
  if (entryPrice.value === 0) return 0;
  const direction = isShort.value ? -1 : 1;
  return ((price - entryPrice.value) / entryPrice.value) * direction * leverage.value * 100;
}

// Find highest and lowest price in the period
const priceExtremes = computed(() => {
  const tc = tradeCandles.value;
  if (tc.length === 0) return null;
  const { high: hi, low: lo, date: di } = colIdx.value;
  if (hi < 0 || lo < 0) return null;

  let maxPrice = -Infinity,
    minPrice = Infinity;
  let maxDate = 0,
    minDate = 0;

  for (const c of tc) {
    if (c[hi] > maxPrice) {
      maxPrice = c[hi];
      maxDate = c[di];
    }
    if (c[lo] < minPrice) {
      minPrice = c[lo];
      minDate = c[di];
    }
  }

  const maxProfitPct = profitPctAtPrice(maxPrice);
  const minProfitPct = profitPctAtPrice(minPrice);

  // For shorts: max price = worst, min price = best
  const bestProfitPct = isShort.value ? minProfitPct : maxProfitPct;
  const worstProfitPct = isShort.value ? maxProfitPct : minProfitPct;
  const bestPrice = isShort.value ? minPrice : maxPrice;
  const worstPrice = isShort.value ? maxPrice : minPrice;
  const bestDate = isShort.value ? minDate : maxDate;
  const worstDate = isShort.value ? maxDate : minDate;

  // PNL at each extreme
  const stake = props.trade.stake_amount ?? 0;
  const bestPnl = stake * leverage.value * (bestProfitPct / 100);
  const worstPnl = stake * leverage.value * (worstProfitPct / 100);

  return {
    maxPrice,
    minPrice,
    maxDate,
    minDate,
    bestProfitPct,
    worstProfitPct,
    bestPrice,
    worstPrice,
    bestDate,
    worstDate,
    bestPnl,
    worstPnl,
  };
});

const currentProfitPct = computed(() => profitPctAtPrice(currentPrice.value));
const stoplossPrice = computed(() => props.trade.stop_loss_abs ?? null);
const liquidationPrice = computed(() => props.trade.liquidation_price ?? null);

// Price distribution heatmap: split the price range into bins and count candle closes
const HEATMAP_BINS = 40;
const SVG_W = 320;
const SVG_H = 160;
const PAD_L = 0;
const PAD_R = 0;
const PAD_T = 8;
const PAD_B = 8;

const heatmapData = computed(() => {
  const tc = tradeCandles.value;
  if (tc.length === 0 || !priceExtremes.value) return null;
  const { close: ci } = colIdx.value;
  if (ci < 0) return null;

  // Use high/low range + a small margin
  let lo = priceExtremes.value.minPrice;
  let hi = priceExtremes.value.maxPrice;
  const margin = (hi - lo) * 0.02;
  lo -= margin;
  hi += margin;
  if (hi === lo) hi = lo + 1;

  const binSize = (hi - lo) / HEATMAP_BINS;
  const bins = new Array(HEATMAP_BINS).fill(0);

  for (const c of tc) {
    const price = c[ci];
    const bin = Math.min(Math.floor((price - lo) / binSize), HEATMAP_BINS - 1);
    if (bin >= 0) bins[bin]++;
  }

  const maxCount = Math.max(...bins, 1);

  return { bins, binSize, lo, hi, maxCount };
});

function priceToY(price: number): number {
  if (!heatmapData.value) return SVG_H / 2;
  const { lo, hi } = heatmapData.value;
  return PAD_T + (1 - (price - lo) / (hi - lo)) * (SVG_H - PAD_T - PAD_B);
}

function binColor(count: number): string {
  if (!heatmapData.value || count === 0) return 'transparent';
  const intensity = count / heatmapData.value.maxCount;
  // Blue gradient: from very light to deep blue
  const r = Math.round(10 + (1 - intensity) * 20);
  const g = Math.round(20 + (1 - intensity) * 30);
  const b = Math.round(60 + intensity * 195);
  const a = 0.15 + intensity * 0.65;
  return `rgba(${r},${g},${b},${a})`;
}

// Are current price and extreme close enough to merge?
const MERGE_THRESHOLD_PCT = 3; // % of Y range
function areMerged(pct1: number, pct2: number): boolean {
  if (!priceExtremes.value) return false;
  const range = Math.abs(priceExtremes.value.bestProfitPct - priceExtremes.value.worstProfitPct);
  if (range === 0) return true;
  return (Math.abs(pct1 - pct2) / range) * 100 < MERGE_THRESHOLD_PCT;
}

const isNearBest = computed(() =>
  priceExtremes.value
    ? areMerged(currentProfitPct.value, priceExtremes.value.bestProfitPct)
    : false,
);
const isNearWorst = computed(() =>
  priceExtremes.value
    ? areMerged(currentProfitPct.value, priceExtremes.value.worstProfitPct)
    : false,
);

const blinkClass = ref(true);
const blinkInterval = ref<ReturnType<typeof setInterval>>();
onMounted(() => {
  blinkInterval.value = setInterval(() => {
    blinkClass.value = !blinkClass.value;
  }, 800);
});
onUnmounted(() => {
  if (blinkInterval.value) clearInterval(blinkInterval.value);
});

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPrc(v: number): string {
  return v.toPrecision(6);
}

const stakeCurrency = computed(() => {
  const bid = props.botId || botStore.selectedBot;
  return (
    (botStore.allBotState[bid] as any)?.stake_currency ||
    botStore.activeBot?.stakeCurrency ||
    'USDC'
  );
});
</script>

<template>
  <div class="p-3 text-xs min-w-[340px] max-w-[380px]">
    <div class="font-bold text-[11px] mb-2">{{ t('profitRange.title') }}</div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-6 text-surface-400">
      <span
        class="animate-spin inline-block w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full"
      />
    </div>

    <template v-else-if="priceExtremes && heatmapData">
      <!-- Summary: Best / Worst profit -->
      <div class="grid grid-cols-2 gap-x-4 gap-y-1 mb-3">
        <div>
          <div class="text-[9px] text-surface-400 uppercase tracking-wider">
            {{ t('profitRange.bestProfit') }}
          </div>
          <div class="font-mono font-bold text-green-400 text-sm">
            +{{ priceExtremes.bestProfitPct.toFixed(2) }}%
          </div>
          <div class="font-mono text-[10px] text-green-300">
            +{{ priceExtremes.bestPnl.toFixed(2) }} {{ stakeCurrency }}
          </div>
          <div class="text-[9px] text-surface-500">{{ formatDate(priceExtremes.bestDate) }}</div>
        </div>
        <div>
          <div class="text-[9px] text-surface-400 uppercase tracking-wider">
            {{ t('profitRange.worstProfit') }}
          </div>
          <div class="font-mono font-bold text-red-400 text-sm">
            {{ priceExtremes.worstProfitPct.toFixed(2) }}%
          </div>
          <div class="font-mono text-[10px] text-red-300">
            {{ priceExtremes.worstPnl.toFixed(2) }} {{ stakeCurrency }}
          </div>
          <div class="text-[9px] text-surface-500">{{ formatDate(priceExtremes.worstDate) }}</div>
        </div>
      </div>

      <!-- SVG Heatmap + price markers -->
      <svg :width="SVG_W" :height="SVG_H" class="w-full rounded bg-surface-900/50 mb-2">
        <!-- Heatmap bins (horizontal bars) -->
        <rect
          v-for="(count, i) in heatmapData.bins"
          :key="i"
          :x="PAD_L"
          :y="PAD_T + (HEATMAP_BINS - 1 - i) * ((SVG_H - PAD_T - PAD_B) / HEATMAP_BINS)"
          :width="SVG_W - PAD_L - PAD_R"
          :height="(SVG_H - PAD_T - PAD_B) / HEATMAP_BINS + 0.5"
          :fill="binColor(count)"
        />

        <!-- Entry price line -->
        <line
          :x1="PAD_L"
          :x2="SVG_W - PAD_R"
          :y1="priceToY(entryPrice)"
          :y2="priceToY(entryPrice)"
          stroke="#94a3b8"
          stroke-width="1"
          stroke-dasharray="4,3"
        />
        <text
          :x="SVG_W - PAD_R - 2"
          :y="priceToY(entryPrice) - 3"
          text-anchor="end"
          fill="#94a3b8"
          font-size="8"
        >
          {{ t('profitRange.entry') }} {{ formatPrc(entryPrice) }}
        </text>

        <!-- Stoploss line -->
        <template v-if="stoplossPrice">
          <line
            :x1="PAD_L"
            :x2="SVG_W - PAD_R"
            :y1="priceToY(stoplossPrice)"
            :y2="priceToY(stoplossPrice)"
            stroke="#ef4444"
            stroke-width="1"
            stroke-dasharray="2,2"
          />
          <text :x="4" :y="priceToY(stoplossPrice) - 3" fill="#ef4444" font-size="7">
            SL {{ formatPrc(stoplossPrice) }}
          </text>
        </template>

        <!-- Liquidation line -->
        <template v-if="liquidationPrice">
          <line
            :x1="PAD_L"
            :x2="SVG_W - PAD_R"
            :y1="priceToY(liquidationPrice)"
            :y2="priceToY(liquidationPrice)"
            stroke="#dc2626"
            stroke-width="1.5"
            stroke-dasharray="1,2"
          />
          <text :x="4" :y="priceToY(liquidationPrice) + 10" fill="#dc2626" font-size="7">
            LIQ {{ formatPrc(liquidationPrice) }}
          </text>
        </template>

        <!-- Best price marker -->
        <template v-if="!isNearBest">
          <line
            :x1="PAD_L"
            :x2="SVG_W - PAD_R"
            :y1="priceToY(priceExtremes.bestPrice)"
            :y2="priceToY(priceExtremes.bestPrice)"
            stroke="#22c55e"
            stroke-width="1"
            opacity="0.6"
          />
          <text
            :x="SVG_W - PAD_R - 2"
            :y="priceToY(priceExtremes.bestPrice) + 10"
            text-anchor="end"
            fill="#22c55e"
            font-size="7"
          >
            MAX +{{ priceExtremes.bestProfitPct.toFixed(1) }}%
          </text>
        </template>

        <!-- Worst price marker -->
        <template v-if="!isNearWorst">
          <line
            :x1="PAD_L"
            :x2="SVG_W - PAD_R"
            :y1="priceToY(priceExtremes.worstPrice)"
            :y2="priceToY(priceExtremes.worstPrice)"
            stroke="#ef4444"
            stroke-width="1"
            opacity="0.6"
          />
          <text
            :x="SVG_W - PAD_R - 2"
            :y="priceToY(priceExtremes.worstPrice) - 3"
            text-anchor="end"
            fill="#ef4444"
            font-size="7"
          >
            MIN {{ priceExtremes.worstProfitPct.toFixed(1) }}%
          </text>
        </template>

        <!-- Current price marker (blinking) -->
        <line
          :x1="PAD_L"
          :x2="SVG_W - PAD_R"
          :y1="priceToY(currentPrice)"
          :y2="priceToY(currentPrice)"
          :stroke="isNearBest ? '#22c55e' : isNearWorst ? '#ef4444' : '#60a5fa'"
          stroke-width="2"
          :opacity="blinkClass ? 1 : 0.3"
          style="transition: opacity 0.3s"
        />
        <circle
          :cx="SVG_W / 2"
          :cy="priceToY(currentPrice)"
          r="3"
          :fill="isNearBest ? '#22c55e' : isNearWorst ? '#ef4444' : '#60a5fa'"
          :opacity="blinkClass ? 1 : 0.4"
          style="transition: opacity 0.3s"
        />
        <text
          :x="4"
          :y="priceToY(currentPrice) - 4"
          :fill="isNearBest ? '#22c55e' : isNearWorst ? '#ef4444' : '#60a5fa'"
          font-size="8"
          font-weight="bold"
          :opacity="blinkClass ? 1 : 0.5"
          style="transition: opacity 0.3s"
        >
          {{ isNearBest ? 'MAX ' : isNearWorst ? 'MIN ' : '' }}{{ formatPrc(currentPrice) }} ({{
            currentProfitPct >= 0 ? '+' : ''
          }}{{ currentProfitPct.toFixed(2) }}%)
        </text>
      </svg>

      <!-- Price grid details -->
      <div class="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-0.5 text-[10px]">
        <span class="text-surface-400">{{ t('profitRange.entry') }}</span>
        <span class="font-mono text-surface-300">{{ formatPrc(entryPrice) }}</span>
        <span></span>

        <span class="text-green-400">{{ t('profitRange.bestLabel') }}</span>
        <span class="font-mono text-green-300">{{ formatPrc(priceExtremes.bestPrice) }}</span>
        <span class="font-mono text-green-400">+{{ priceExtremes.bestProfitPct.toFixed(2) }}%</span>

        <span class="text-red-400">{{ t('profitRange.worstLabel') }}</span>
        <span class="font-mono text-red-300">{{ formatPrc(priceExtremes.worstPrice) }}</span>
        <span class="font-mono text-red-400">{{ priceExtremes.worstProfitPct.toFixed(2) }}%</span>

        <template v-if="stoplossPrice">
          <span class="text-red-400">SL</span>
          <span class="font-mono text-red-300">{{ formatPrc(stoplossPrice) }}</span>
          <span class="font-mono text-red-400"
            >{{ profitPctAtPrice(stoplossPrice).toFixed(2) }}%</span
          >
        </template>

        <template v-if="liquidationPrice">
          <span class="text-red-500 font-bold">LIQ</span>
          <span class="font-mono text-red-400">{{ formatPrc(liquidationPrice) }}</span>
          <span class="font-mono text-red-500"
            >{{ profitPctAtPrice(liquidationPrice).toFixed(2) }}%</span
          >
        </template>
      </div>

      <div class="mt-2 text-[9px] text-surface-500 italic">
        {{ tradeCandles.length }} {{ t('profitRange.candlesLabel') }} · {{ timeframe }}
      </div>
    </template>

    <div v-else class="text-center py-4 text-surface-400">{{ t('profitRange.noData') }}</div>
  </div>
</template>
