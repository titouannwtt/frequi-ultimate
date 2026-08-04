<script lang="ts">
// Module-level cache: persists across component instances
const _candleCache = new Map<string, { data: number[][]; columns: string[] }>();
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
const error = ref(false);
const errorMessage = ref('');
const tradeTooOld = ref(false);
const candles = ref<number[][]>([]);
const columns = ref<string[]>([]);

// Use the bot's actual timeframe, falling back to duration-based heuristic
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

// Fetch candle data when the component mounts, with caching
onMounted(async () => {
  const cacheKey = `${props.trade.pair}__${timeframe.value}__${props.botId}`;

  // Check cache first
  const cached = _candleCache.get(cacheKey);
  if (cached) {
    candles.value = cached.data;
    columns.value = cached.columns;
    const dateIdx = cached.columns.indexOf('date');
    if (dateIdx >= 0 && cached.data.length > 0) {
      const firstCandleTs = cached.data[0][dateIdx];
      if (props.trade.open_timestamp < firstCandleTs) {
        tradeTooOld.value = true;
      }
    }
    loading.value = false;
    return;
  }

  try {
    const store = botStore.botStores[props.botId] ?? botStore.activeBot;
    if (!store) {
      error.value = true;
      errorMessage.value = t('stoplossChart.botNotFound');
      loading.value = false;
      return;
    }
    await store.getPairCandles({
      pair: props.trade.pair,
      timeframe: timeframe.value,
      limit: 5000,
    });
    const key = `${props.trade.pair}__${timeframe.value}`;
    const cd = (store.candleData as Record<string, any>)[key];
    if (cd?.data?.data && cd.data.columns) {
      candles.value = cd.data.data;
      columns.value = cd.data.columns;
      // Store in cache
      _candleCache.set(cacheKey, { data: cd.data.data, columns: cd.data.columns });
      // Check if trade is too old for available candle data
      const dateIdx = cd.data.columns.indexOf('date');
      if (dateIdx >= 0 && cd.data.data.length > 0) {
        const firstCandleTs = cd.data.data[0][dateIdx];
        if (props.trade.open_timestamp < firstCandleTs) {
          tradeTooOld.value = true;
        }
      }
    } else {
      error.value = true;
      errorMessage.value = t('stoplossChart.noData');
    }
  } catch (e: any) {
    error.value = true;
    errorMessage.value = e?.message || e?.toString() || t('stoplossChart.fetchError');
  } finally {
    loading.value = false;
  }
});

// Parse candle data
const colIndex = computed(() => {
  const cols = columns.value;
  return {
    date: cols.indexOf('date'),
    open: cols.indexOf('open'),
    high: cols.indexOf('high'),
    low: cols.indexOf('low'),
    close: cols.indexOf('close'),
  };
});

// Filter candles: from ~10 candles before trade open to now
const filteredCandles = computed(() => {
  if (!candles.value.length || colIndex.value.date < 0) return [];
  const dateIdx = colIndex.value.date;
  const openTs = props.trade.open_timestamp;

  // Find the index of the candle closest to trade open
  let entryIdx = candles.value.findIndex((c) => c[dateIdx] >= openTs);
  if (entryIdx < 0) entryIdx = candles.value.length - 1;

  const startIdx = Math.max(0, entryIdx - 10);
  return candles.value.slice(startIdx);
});

// Close prices for the line chart
const closePrices = computed(() => {
  if (!filteredCandles.value.length || colIndex.value.close < 0) return [];
  return filteredCandles.value.map((c) => c[colIndex.value.close]);
});

const timestamps = computed(() => {
  if (!filteredCandles.value.length || colIndex.value.date < 0) return [];
  return filteredCandles.value.map((c) => c[colIndex.value.date]);
});

// Key price levels
const entryPrice = computed(() => props.trade.open_rate);
const stoplossPrice = computed(() => props.trade.stop_loss_abs);
const currentPrice = computed(() => props.trade.current_rate ?? props.trade.open_rate);
const liquidationPrice = computed(() => props.trade.liquidation_price ?? null);
const isShort = computed(() => props.trade.is_short ?? false);

// DCA entry points
const dcaEntries = computed(() => {
  if (!props.trade.orders) return [];
  return props.trade.orders
    .filter((o) => o.ft_is_entry && o.status === 'closed')
    .map((o) => ({
      price: o.safe_price,
      timestamp: o.order_filled_timestamp ?? 0,
    }));
});

// SVG dimensions - bigger chart
const W = 400;
const H = 200;
const PAD_X = 4;
const PAD_Y = 16;

// Threshold: if SL/Liq would expand Y range more than 3x actual price range, use arrow
const RANGE_THRESHOLD = 3;

// Y-axis range: based on actual price data only (not squashed by far-away SL/liq)
const priceRange = computed(() => {
  const prices = [...closePrices.value, entryPrice.value, currentPrice.value];
  dcaEntries.value.forEach((e) => prices.push(e.price));

  const validPrices = prices.filter((p) => p > 0);
  if (validPrices.length === 0) return { min: 0, max: 1 };

  const min = Math.min(...validPrices);
  const max = Math.max(...validPrices);
  return { min, max };
});

// Determine if SL and Liq are within visible range or too far
function isWithinRange(price: number | null): boolean {
  if (price === null || price <= 0) return false;
  const { min, max } = priceRange.value;
  const range = max - min || max * 0.01;
  // Check if including this price would expand range by more than threshold
  const expandedMin = Math.min(min, price);
  const expandedMax = Math.max(max, price);
  const expandedRange = expandedMax - expandedMin;
  return expandedRange <= range * RANGE_THRESHOLD;
}

const slInRange = computed(() => isWithinRange(stoplossPrice.value));
const liqInRange = computed(() => isWithinRange(liquidationPrice.value));

// Y-axis range: include SL/liq only if in range
const yRange = computed(() => {
  const prices = [...closePrices.value, entryPrice.value, currentPrice.value];
  dcaEntries.value.forEach((e) => prices.push(e.price));

  if (slInRange.value) prices.push(stoplossPrice.value);
  if (liqInRange.value && liquidationPrice.value !== null) prices.push(liquidationPrice.value);

  const validPrices = prices.filter((p) => p > 0);
  if (validPrices.length === 0) return { min: 0, max: 1 };

  const min = Math.min(...validPrices);
  const max = Math.max(...validPrices);
  const pad = (max - min) * 0.08 || max * 0.01;
  return { min: min - pad, max: max + pad };
});

function yToSvg(price: number): number {
  const { min, max } = yRange.value;
  const range = max - min || 1;
  return PAD_Y + (H - 2 * PAD_Y) * (1 - (price - min) / range);
}

function xToSvg(index: number): number {
  const count = closePrices.value.length;
  if (count <= 1) return W / 2;
  return PAD_X + (W - 2 * PAD_X) * (index / (count - 1));
}

// Percentage from entry
function pctFromEntry(price: number): string {
  if (entryPrice.value === 0) return '0';
  const pct = ((price - entryPrice.value) / entryPrice.value) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

// Arrow labels for out-of-range SL / Liq
const slArrowLabel = computed(() => {
  if (slInRange.value) return '';
  const pct = pctFromEntry(stoplossPrice.value);
  const direction = stoplossPrice.value < priceRange.value.min ? '\u2193' : '\u2191';
  return `SL: ${pct} ${direction}`;
});

const liqArrowLabel = computed(() => {
  if (liqInRange.value || liquidationPrice.value === null) return '';
  const pct = pctFromEntry(liquidationPrice.value);
  const direction = liquidationPrice.value < priceRange.value.min ? '\u2193' : '\u2191';
  return `Liq: ${pct} ${direction}`;
});

// Arrow Y position (at edge of chart)
function arrowY(price: number, offset: number = 0): number {
  const base = price < priceRange.value.min ? H - PAD_Y + 6 : PAD_Y - 6;
  return base + offset;
}

// Check if both SL and Liq are on the same side (both would overlap)
const bothOutOfRangeSameSide = computed(() => {
  if (slInRange.value || liqInRange.value) return false;
  const slBelow = (stoplossPrice.value ?? 0) < priceRange.value.min;
  const liqBelow = (liquidationPrice.value ?? 0) < priceRange.value.min;
  return slBelow === liqBelow;
});

// SVG path for the price line
const linePath = computed(() => {
  if (closePrices.value.length === 0) return '';
  return closePrices.value
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xToSvg(i).toFixed(1)},${yToSvg(p).toFixed(1)}`)
    .join(' ');
});

// Area fill path (from line down to bottom or up to top depending on profit zone)
const areaPath = computed(() => {
  if (closePrices.value.length === 0) return '';
  const entryY = yToSvg(entryPrice.value);
  const points = closePrices.value.map((p, i) => {
    const x = xToSvg(i).toFixed(1);
    const y = yToSvg(p).toFixed(1);
    return `${x},${y}`;
  });
  // Close the area to the entry price line
  const lastX = xToSvg(closePrices.value.length - 1).toFixed(1);
  const firstX = xToSvg(0).toFixed(1);
  return `M${points.join(' L')} L${lastX},${entryY.toFixed(1)} L${firstX},${entryY.toFixed(1)} Z`;
});

// Determine area fill color: green for profit zone, red for loss zone
const areaFillColor = computed(() => {
  const lastPrice = closePrices.value[closePrices.value.length - 1] ?? currentPrice.value;
  const inProfit = isShort.value ? lastPrice < entryPrice.value : lastPrice > entryPrice.value;
  return inProfit ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)';
});

// Line color
const lineColor = computed(() => {
  const lastPrice = closePrices.value[closePrices.value.length - 1] ?? currentPrice.value;
  const inProfit = isShort.value ? lastPrice < entryPrice.value : lastPrice > entryPrice.value;
  return inProfit ? '#22c55e' : '#ef4444';
});

// DCA marker positions on the SVG
const dcaMarkers = computed(() => {
  if (!dcaEntries.value.length || !timestamps.value.length) return [];
  return dcaEntries.value
    .map((entry) => {
      // Find the closest candle index for this entry
      let closestIdx = 0;
      let closestDist = Infinity;
      timestamps.value.forEach((ts, i) => {
        const dist = Math.abs(ts - entry.timestamp);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = i;
        }
      });
      return {
        x: xToSvg(closestIdx),
        y: yToSvg(entry.price),
        price: entry.price,
      };
    })
    .filter((m) => m.x >= PAD_X && m.x <= W - PAD_X);
});

// Entry marker position on the chart
const entryMarker = computed(() => {
  if (!timestamps.value.length) return null;
  const openTs = props.trade.open_timestamp;
  let closestIdx = 0;
  let closestDist = Infinity;
  timestamps.value.forEach((ts, i) => {
    const dist = Math.abs(ts - openTs);
    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = i;
    }
  });
  return { x: xToSvg(closestIdx), y: yToSvg(entryPrice.value) };
});
</script>

<template>
  <div
    class="p-3 min-w-[420px] max-w-[440px] text-xs"
    style="backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px)"
  >
    <!-- Header -->
    <div class="flex items-center gap-2 mb-2">
      <span class="font-bold text-sm">{{ trade.pair }}</span>
      <span
        v-if="trade.trading_mode !== 'spot'"
        class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold"
        :class="trade.is_short ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'"
      >
        {{ trade.is_short ? 'SHORT' : 'LONG' }}
      </span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-8">
      <i class="pi pi-spin pi-spinner text-lg mr-2" />
      <span class="text-surface-400">{{ t('stoplossChart.loadingPriceData') }}</span>
    </div>

    <!-- Error -->
    <div v-else-if="error || closePrices.length === 0" class="text-center py-6 text-surface-400">
      <div>{{ t('stoplossChart.unavailable') }}</div>
      <div v-if="errorMessage" class="text-[10px] mt-1 opacity-60">{{ errorMessage }}</div>
    </div>

    <!-- Chart -->
    <template v-else>
      <div v-if="tradeTooOld" class="text-[10px] text-amber-400 opacity-70 mb-1 text-center">
        {{ t('stoplossChart.tradeTooOld') }}
      </div>
      <svg
        :width="W"
        :height="H"
        class="w-full"
        :viewBox="`0 0 ${W} ${H}`"
        preserveAspectRatio="none"
      >
        <!-- Area fill -->
        <path :d="areaPath" :fill="areaFillColor" />

        <!-- Entry price line (green dashed) -->
        <line
          :x1="0"
          :y1="yToSvg(entryPrice)"
          :x2="W"
          :y2="yToSvg(entryPrice)"
          stroke="#22c55e"
          stroke-width="0.8"
          stroke-dasharray="4,3"
          opacity="0.7"
        />

        <!-- Stoploss line (red dashed) - only if within visible range -->
        <line
          v-if="slInRange"
          :x1="0"
          :y1="yToSvg(stoplossPrice)"
          :x2="W"
          :y2="yToSvg(stoplossPrice)"
          stroke="#ef4444"
          stroke-width="0.8"
          stroke-dasharray="4,3"
          opacity="0.7"
        />

        <!-- Stoploss arrow indicator (when out of range) -->
        <g v-if="!slInRange">
          <!-- Arrow at edge -->
          <polygon
            v-if="stoplossPrice < priceRange.min"
            :points="`${W - 12},${H - PAD_Y + 2} ${W - 8},${H - PAD_Y + 8} ${W - 16},${H - PAD_Y + 8}`"
            fill="#ef4444"
            opacity="0.8"
          />
          <polygon
            v-else
            :points="`${W - 12},${PAD_Y - 2} ${W - 8},${PAD_Y - 8} ${W - 16},${PAD_Y - 8}`"
            fill="#ef4444"
            opacity="0.8"
          />
          <text
            :x="W - 20"
            :y="arrowY(stoplossPrice)"
            text-anchor="end"
            fill="#ef4444"
            font-size="8"
            font-weight="bold"
            opacity="0.9"
          >
            {{ slArrowLabel }}
          </text>
        </g>

        <!-- Liquidation line (orange dashed) - only if within visible range -->
        <line
          v-if="liquidationPrice !== null && liqInRange"
          :x1="0"
          :y1="yToSvg(liquidationPrice)"
          :x2="W"
          :y2="yToSvg(liquidationPrice)"
          stroke="#f97316"
          stroke-width="0.8"
          stroke-dasharray="2,2"
          opacity="0.6"
        />

        <!-- Liquidation arrow indicator (when out of range) -->
        <g v-if="liquidationPrice !== null && !liqInRange">
          <polygon
            v-if="liquidationPrice < priceRange.min"
            :points="`${W - 36},${H - PAD_Y + 2} ${W - 32},${H - PAD_Y + 8} ${W - 40},${H - PAD_Y + 8}`"
            fill="#f97316"
            opacity="0.8"
          />
          <polygon
            v-else
            :points="`${W - 36},${PAD_Y - 2} ${W - 32},${PAD_Y - 8} ${W - 40},${PAD_Y - 8}`"
            fill="#f97316"
            opacity="0.8"
          />
          <text
            :x="W - 44"
            :y="arrowY(liquidationPrice, bothOutOfRangeSameSide ? 16 : 0)"
            text-anchor="end"
            fill="#f97316"
            font-size="8"
            font-weight="bold"
            opacity="0.9"
          >
            {{ liqArrowLabel }}
          </text>
        </g>

        <!-- Price line -->
        <path
          :d="linePath"
          fill="none"
          :stroke="lineColor"
          stroke-width="1.5"
          stroke-linejoin="round"
        />

        <!-- Entry marker (green dot) -->
        <circle
          v-if="entryMarker"
          :cx="entryMarker.x"
          :cy="entryMarker.y"
          r="3.5"
          fill="#22c55e"
          stroke="#fff"
          stroke-width="1"
        />

        <!-- DCA markers (purple dots) -->
        <circle
          v-for="(marker, idx) in dcaMarkers"
          :key="'dca-' + idx"
          :cx="marker.x"
          :cy="marker.y"
          r="2.5"
          fill="#a855f7"
          stroke="#fff"
          stroke-width="0.8"
          opacity="0.9"
        />

        <!-- Current price marker (blue dot at the end) -->
        <circle
          :cx="xToSvg(closePrices.length - 1)"
          :cy="yToSvg(closePrices[closePrices.length - 1])"
          r="3"
          fill="#3b82f6"
          stroke="#fff"
          stroke-width="1"
        />
      </svg>

      <!-- Legend -->
      <div class="flex flex-wrap gap-2 mt-2 text-[10px]">
        <span class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-green-500 inline-block" />
          {{ t('stoplossChart.entryPrice') }}
          <span class="font-mono text-surface-400">{{ formatPrice(entryPrice) }}</span>
        </span>
        <span class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-red-500 inline-block" />
          {{ t('stoplossChart.stoploss') }}
          <span class="font-mono text-surface-400">
            {{ formatPrice(stoplossPrice) }}
            <template v-if="!slInRange"> ({{ pctFromEntry(stoplossPrice) }})</template>
          </span>
        </span>
        <span class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-blue-500 inline-block" />
          {{ t('stoplossChart.currentPrice') }}
          <span class="font-mono text-surface-400">{{ formatPrice(currentPrice) }}</span>
        </span>
        <span v-if="liquidationPrice !== null" class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-orange-500 inline-block" />
          {{ t('stoplossChart.liquidation') }}
          <span class="font-mono text-surface-400">
            {{ formatPrice(liquidationPrice) }}
            <template v-if="!liqInRange"> ({{ pctFromEntry(liquidationPrice) }})</template>
          </span>
        </span>
        <span v-if="dcaEntries.length > 1" class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-purple-500 inline-block" />
          {{ t('stoplossChart.dcaEntries') }}
          <span class="font-mono text-surface-400">{{ dcaEntries.length }}</span>
        </span>
      </div>
    </template>
  </div>
</template>
