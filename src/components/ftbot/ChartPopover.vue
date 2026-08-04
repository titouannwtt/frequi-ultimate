<script lang="ts">
const _chartCache = new Map<string, { data: number[][]; columns: string[] }>();
</script>

<script setup lang="ts">
import type { Trade } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  trade: Trade;
  botId: string;
  /** For closed trades: show exit marker instead of "current" */
  isClosed?: boolean;
}>();

const emit = defineEmits<{ loaded: [] }>();
const botStore = useBotStore();

const loading = ref(true);
const error = ref('');
const candles = ref<number[][]>([]);
const columns = ref<string[]>([]);

const resolvedBotId = computed(() => props.botId || botStore.selectedBot);

const timeframe = computed(() => {
  const bid = resolvedBotId.value;
  if (bid) {
    const botTf = (botStore.allBotState[bid] as any)?.timeframe;
    if (botTf) return botTf as string;
  }
  const durationMs = Date.now() - props.trade.open_timestamp;
  const durationHours = durationMs / 3600000;
  if (durationHours < 6) return '5m';
  if (durationHours < 48) return '15m';
  return '1h';
});

const stakeCurrency = computed(() => {
  const bid = resolvedBotId.value;
  return (
    (botStore.allBotState[bid] as any)?.stake_currency ||
    botStore.activeBot?.stakeCurrency ||
    'USDC'
  );
});

// Fetch version counter: incremented on each trade change to cancel stale fetches
let fetchVersion = 0;

async function fetchCandles() {
  const myVersion = ++fetchVersion;
  loading.value = true;
  error.value = '';
  candles.value = [];
  columns.value = [];

  const bid = resolvedBotId.value;
  const cacheKey = `${props.trade.pair}__${timeframe.value}__${bid}`;
  const cached = _chartCache.get(cacheKey);
  if (cached) {
    if (myVersion !== fetchVersion) return; // stale
    candles.value = cached.data;
    columns.value = cached.columns;
    loading.value = false;
    emit('loaded');
    return;
  }
  try {
    const store = botStore.botStores[bid] ?? botStore.activeBot;
    if (!store) {
      error.value = 'Bot not found';
      loading.value = false;
      return;
    }
    await store.getPairCandles({ pair: props.trade.pair, timeframe: timeframe.value, limit: 5000 });
    if (myVersion !== fetchVersion) return; // stale — a newer fetch replaced us
    const key = `${props.trade.pair}__${timeframe.value}`;
    const cd = (store.candleData as Record<string, any>)[key];
    if (cd?.data?.data && cd.data.columns) {
      candles.value = cd.data.data;
      columns.value = cd.data.columns;
      _chartCache.set(cacheKey, { data: cd.data.data, columns: cd.data.columns });
    } else {
      error.value = 'No candle data';
    }
  } catch (e: any) {
    if (myVersion !== fetchVersion) return;
    error.value = e?.message || 'Fetch error';
  } finally {
    if (myVersion === fetchVersion) {
      loading.value = false;
      emit('loaded');
    }
  }
}

// Fetch on mount AND when trade changes (component may be reused by Vue)
onMounted(fetchCandles);
watch(() => props.trade.trade_id, fetchCandles);

// ── Column index helpers ──
const ci = computed(() => {
  const c = columns.value;
  return {
    date: c.indexOf('date'),
    open: c.indexOf('open'),
    high: c.indexOf('high'),
    low: c.indexOf('low'),
    close: c.indexOf('close'),
  };
});

// ── Filtered candles: trade open - 100 candles before → now ──
const tradeCandles = computed(() => {
  if (!candles.value.length || ci.value.date < 0) return [];
  const openTs = props.trade.open_timestamp;
  let entryIdx = candles.value.findIndex((c) => c[ci.value.date] >= openTs);
  if (entryIdx < 0) entryIdx = candles.value.length - 1;
  const start = Math.max(0, entryIdx - 10);
  return candles.value.slice(start);
});

// ── Key prices ──
const entryPrice = computed(() => props.trade.open_rate ?? 0);
const currentPrice = computed(
  () => props.trade.current_rate ?? props.trade.close_rate ?? entryPrice.value,
);
const slPrice = computed(() => props.trade.stop_loss_abs ?? null);
const liqPrice = computed(() => props.trade.liquidation_price ?? null);
const isShort = computed(() => props.trade.is_short ?? false);
const leverage = computed(() => props.trade.leverage ?? 1);

// ── DCA entries ──
const dcaEntries = computed(() => {
  if (!props.trade.orders) return [];
  return props.trade.orders
    .filter((o) => o.ft_is_entry && o.status === 'closed')
    .sort((a, b) => (a.order_filled_timestamp ?? 0) - (b.order_filled_timestamp ?? 0))
    .map((o, i) => ({
      index: i + 1,
      price: o.safe_price,
      amount: o.filled ?? o.amount ?? 0,
      cost: o.cost ?? o.safe_price * (o.filled ?? o.amount ?? 0),
      timestamp: o.order_filled_timestamp ?? 0,
    }));
});

// ── SVG dimensions ──
const W = 540;
const H = 270;
const PAD_L = 4;
const PAD_R = 4;
const PAD_T = 14;
const PAD_B = 14;
const CHART_W = W - PAD_L - PAD_R;
const CHART_H = H - PAD_T - PAD_B;

// ── Price range (only from candle data + key levels, NOT squashed by far SL/liq) ──
const priceRange = computed(() => {
  const tc = tradeCandles.value;
  if (tc.length === 0) return { min: 0, max: 1 };
  const { high: hi, low: lo } = ci.value;
  let min = Infinity,
    max = -Infinity;
  for (const c of tc) {
    if (hi >= 0 && c[hi] > max) max = c[hi];
    if (lo >= 0 && c[lo] < min) min = c[lo];
  }
  // Include entry and current
  min = Math.min(min, entryPrice.value, currentPrice.value);
  max = Math.max(max, entryPrice.value, currentPrice.value);
  dcaEntries.value.forEach((e) => {
    min = Math.min(min, e.price);
    max = Math.max(max, e.price);
  });
  const pad = (max - min) * 0.06 || max * 0.01;
  return { min: min - pad, max: max + pad };
});

// ── SL/Liq range check ──
const RANGE_THRESHOLD = 3;
function inRange(price: number | null): boolean {
  if (!price || price <= 0) return false;
  const { min, max } = priceRange.value;
  const range = max - min || max * 0.01;
  const expanded = Math.max(max, price) - Math.min(min, price);
  return expanded <= range * RANGE_THRESHOLD;
}
const slInRange = computed(() => inRange(slPrice.value));
const liqInRange = computed(() => inRange(liqPrice.value));

// ── Y-axis range: include SL/liq only if in range ──
const yRange = computed(() => {
  let { min, max } = priceRange.value;
  if (slInRange.value && slPrice.value) {
    min = Math.min(min, slPrice.value);
    max = Math.max(max, slPrice.value);
  }
  if (liqInRange.value && liqPrice.value) {
    min = Math.min(min, liqPrice.value);
    max = Math.max(max, liqPrice.value);
  }
  const pad = (max - min) * 0.04 || 0.01;
  return { min: min - pad, max: max + pad };
});

function y(price: number): number {
  const { min, max } = yRange.value;
  return PAD_T + CHART_H * (1 - (price - min) / (max - min || 1));
}
function x(index: number): number {
  const count = tradeCandles.value.length;
  if (count <= 1) return W / 2;
  return PAD_L + CHART_W * (index / (count - 1));
}

// ── Candlestick data ──
const candlesticks = computed(() => {
  const tc = tradeCandles.value;
  const { open: oi, high: hi, low: lo, close: cli } = ci.value;
  if (tc.length === 0 || oi < 0) return [];
  const barW = Math.max(1, Math.min(6, CHART_W / tc.length - 1));
  return tc.map((c, i) => {
    const o = c[oi],
      h = c[hi],
      l = c[lo],
      cl = c[cli];
    const bullish = cl >= o;
    return {
      x: x(i),
      yHigh: y(h),
      yLow: y(l),
      yOpen: y(o),
      yClose: y(cl),
      bodyTop: Math.min(y(o), y(cl)),
      bodyH: Math.max(1, Math.abs(y(o) - y(cl))),
      barW,
      color: bullish ? '#22c55e' : '#ef4444',
      wickColor: bullish ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)',
    };
  });
});

// ── Heatmap: price density bins ──
const BINS = 30;
const heatmap = computed(() => {
  const tc = tradeCandles.value;
  if (tc.length === 0) return [];
  const { close: cli } = ci.value;
  if (cli < 0) return [];
  const { min, max } = yRange.value;
  const binSize = (max - min) / BINS;
  if (binSize <= 0) return [];
  const bins = new Array(BINS).fill(0);
  for (const c of tc) {
    const bin = Math.min(Math.floor((c[cli] - min) / binSize), BINS - 1);
    if (bin >= 0) bins[bin]++;
  }
  const maxCount = Math.max(...bins, 1);
  return bins.map((count, i) => ({
    y: PAD_T + CHART_H * (1 - (i + 1) / BINS),
    h: CHART_H / BINS + 0.5,
    opacity: count > 0 ? 0.08 + (count / maxCount) * 0.22 : 0,
  }));
});

// ── Best / Worst profit on the period ──
function profitPctAt(price: number): number {
  if (entryPrice.value === 0) return 0;
  const dir = isShort.value ? -1 : 1;
  return ((price - entryPrice.value) / entryPrice.value) * dir * leverage.value * 100;
}

const extremes = computed(() => {
  const tc = tradeCandles.value;
  if (tc.length === 0) return null;
  const { high: hi, low: lo, date: di } = ci.value;
  if (hi < 0 || lo < 0) return null;

  let maxP = -Infinity,
    minP = Infinity,
    maxDate = 0,
    minDate = 0;
  for (const c of tc) {
    if (c[hi] > maxP) {
      maxP = c[hi];
      maxDate = c[di];
    }
    if (c[lo] < minP) {
      minP = c[lo];
      minDate = c[di];
    }
  }

  const bestPrice = isShort.value ? minP : maxP;
  const worstPrice = isShort.value ? maxP : minP;
  const bestDate = isShort.value ? minDate : maxDate;
  const worstDate = isShort.value ? maxDate : minDate;
  const bestPct = profitPctAt(bestPrice);
  const worstPct = profitPctAt(worstPrice);
  const stake = props.trade.stake_amount ?? 0;
  return {
    bestPrice,
    worstPrice,
    bestDate,
    worstDate,
    bestPct,
    worstPct,
    bestPnl: stake * leverage.value * (bestPct / 100),
    worstPnl: stake * leverage.value * (worstPct / 100),
  };
});

// ── DCA marker positions ──
const dcaMarkers = computed(() => {
  const tc = tradeCandles.value;
  if (!tc.length || !dcaEntries.value.length) return [];
  const di = ci.value.date;
  const timestamps = tc.map((c) => c[di]);
  return dcaEntries.value.map((entry) => {
    let closestIdx = 0,
      closestDist = Infinity;
    timestamps.forEach((ts, i) => {
      const d = Math.abs(ts - entry.timestamp);
      if (d < closestDist) {
        closestDist = d;
        closestIdx = i;
      }
    });
    return { ...entry, x: x(closestIdx), y: y(entry.price) };
  });
});

// ── Entry marker ──
const entryMarkerX = computed(() => {
  const tc = tradeCandles.value;
  if (!tc.length) return W / 2;
  const di = ci.value.date;
  const openTs = props.trade.open_timestamp;
  let idx = 0,
    best = Infinity;
  tc.forEach((c, i) => {
    const d = Math.abs(c[di] - openTs);
    if (d < best) {
      best = d;
      idx = i;
    }
  });
  return x(idx);
});

// ── Helpers ──
function pctLabel(price: number): string {
  if (entryPrice.value === 0) return '';
  const pct = ((price - entryPrice.value) / entryPrice.value) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function formatPrc(v: number): string {
  return v.toPrecision(6);
}

function formatDate(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<template>
  <div class="p-4 min-w-[560px] max-w-[580px]">
    <!-- Header -->
    <div class="text-[11px] text-surface-500 uppercase tracking-wider mb-0.5">
      Price levels & zones
    </div>
    <div class="flex items-center gap-2 mb-2">
      <span class="font-bold text-sm text-surface-100">{{ trade.pair }}</span>
      <span
        v-if="trade.is_short !== undefined"
        class="px-1.5 py-0.5 rounded text-[13px] font-bold"
        :class="trade.is_short ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'"
        >{{ trade.is_short ? 'SHORT' : 'LONG' }}</span
      >
      <span v-if="(trade.leverage ?? 1) > 1" class="text-[13px] font-bold text-yellow-400"
        >{{ trade.leverage }}x</span
      >
      <span class="ml-auto text-[13px] text-surface-500">{{ timeframe }}</span>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="space-y-2">
      <div class="h-[220px] rounded-lg bg-surface-800 animate-pulse" />
      <div class="flex gap-4">
        <div class="h-3 w-24 bg-surface-800 rounded animate-pulse" />
        <div class="h-3 w-20 bg-surface-800 rounded animate-pulse" />
        <div class="h-3 w-16 bg-surface-800 rounded animate-pulse" />
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error || tradeCandles.length === 0" class="text-center py-8 text-surface-400">
      <div class="text-sm">{{ error || 'No candle data' }}</div>
    </div>

    <!-- Chart -->
    <template v-else>
      <!-- Best / Worst summary -->
      <div v-if="extremes" class="flex gap-3 mb-2 text-[13px]">
        <div>
          <span class="text-surface-500">Best:</span>
          <span class="font-mono font-bold text-green-400 ml-1"
            >+{{ extremes.bestPct.toFixed(1) }}%</span
          >
          <span class="text-surface-500 ml-1"
            >(+{{ extremes.bestPnl.toFixed(1) }} {{ stakeCurrency }})</span
          >
        </div>
        <div>
          <span class="text-surface-500">Worst:</span>
          <span class="font-mono font-bold text-red-400 ml-1"
            >{{ extremes.worstPct.toFixed(1) }}%</span
          >
          <span class="text-surface-500 ml-1"
            >({{ extremes.worstPnl.toFixed(1) }} {{ stakeCurrency }})</span
          >
        </div>
      </div>

      <!-- SVG Candlestick Chart -->
      <svg
        :width="W"
        :height="H"
        class="w-full rounded bg-surface-900/30"
        :viewBox="`0 0 ${W} ${H}`"
      >
        <!-- Heatmap bins (price density) -->
        <rect
          v-for="(bin, i) in heatmap"
          :key="'h' + i"
          :x="PAD_L"
          :y="bin.y"
          :width="CHART_W"
          :height="bin.h"
          fill="#3b82f6"
          :opacity="bin.opacity"
        />

        <!-- Entry price line -->
        <line
          :x1="PAD_L"
          :x2="W - PAD_R"
          :y1="y(entryPrice)"
          :y2="y(entryPrice)"
          stroke="#94a3b8"
          stroke-width="0.7"
          stroke-dasharray="4,3"
          opacity="0.6"
        />

        <!-- SL line -->
        <line
          v-if="slPrice && slInRange"
          :x1="PAD_L"
          :x2="W - PAD_R"
          :y1="y(slPrice)"
          :y2="y(slPrice)"
          stroke="#ef4444"
          stroke-width="0.7"
          stroke-dasharray="3,2"
          opacity="0.6"
        />
        <!-- SL arrow if out of range -->
        <text
          v-if="slPrice && !slInRange"
          :x="W - 6"
          :y="slPrice < priceRange.min ? H - 4 : 10"
          text-anchor="end"
          fill="#ef4444"
          font-size="11"
          font-weight="bold"
          opacity="0.8"
        >
          SL {{ pctLabel(slPrice) }} {{ slPrice < priceRange.min ? '↓' : '↑' }}
        </text>

        <!-- Liq line -->
        <line
          v-if="liqPrice && liqInRange"
          :x1="PAD_L"
          :x2="W - PAD_R"
          :y1="y(liqPrice)"
          :y2="y(liqPrice)"
          stroke="#dc2626"
          stroke-width="1"
          stroke-dasharray="2,2"
          opacity="0.5"
        />
        <!-- Liq arrow if out of range -->
        <text
          v-if="liqPrice && !liqInRange"
          :x="W - 6"
          :y="liqPrice < priceRange.min ? H - 14 : 20"
          text-anchor="end"
          fill="#dc2626"
          font-size="11"
          font-weight="bold"
          opacity="0.8"
        >
          LIQ {{ pctLabel(liqPrice) }} {{ liqPrice < priceRange.min ? '↓' : '↑' }}
        </text>

        <!-- Candlesticks -->
        <g v-for="(c, i) in candlesticks" :key="'c' + i">
          <!-- Wick -->
          <line
            :x1="c.x"
            :x2="c.x"
            :y1="c.yHigh"
            :y2="c.yLow"
            :stroke="c.wickColor"
            stroke-width="0.8"
          />
          <!-- Body -->
          <rect
            :x="c.x - c.barW / 2"
            :y="c.bodyTop"
            :width="c.barW"
            :height="c.bodyH"
            :fill="c.color"
            rx="0.5"
          />
        </g>

        <!-- Entry marker -->
        <circle
          :cx="entryMarkerX"
          :cy="y(entryPrice)"
          r="4"
          fill="#22c55e"
          stroke="#fff"
          stroke-width="1"
        />

        <!-- DCA markers with labels -->
        <g v-for="(m, i) in dcaMarkers" :key="'d' + i">
          <circle :cx="m.x" :cy="m.y" r="3" fill="#a855f7" stroke="#fff" stroke-width="0.8" />
          <text
            v-if="dcaMarkers.length > 1 && i > 0"
            :x="m.x"
            :y="m.y - 6"
            text-anchor="middle"
            fill="#c084fc"
            font-size="9"
            font-weight="bold"
          >
            #{{ m.index }} {{ m.cost.toFixed(0) }}
          </text>
        </g>

        <!-- Current/Exit price marker -->
        <circle
          :cx="x(tradeCandles.length - 1)"
          :cy="y(currentPrice)"
          r="4"
          fill="#3b82f6"
          stroke="#fff"
          stroke-width="1"
        />
      </svg>

      <!-- Legend -->
      <div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 text-[13px]">
        <span class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-green-500 inline-block" />
          Entry <span class="font-mono text-surface-400">{{ formatPrc(entryPrice) }}</span>
        </span>
        <span v-if="slPrice" class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-red-500 inline-block" />
          SL <span class="font-mono text-surface-400">{{ formatPrc(slPrice) }}</span>
          <span class="text-red-400 text-[12px]">{{ pctLabel(slPrice) }}</span>
        </span>
        <span class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-blue-500 inline-block" />
          {{ isClosed ? 'Exit' : 'Current' }}
          <span class="font-mono text-surface-400">{{ formatPrc(currentPrice) }}</span>
          <span
            :class="profitPctAt(currentPrice) >= 0 ? 'text-green-400' : 'text-red-400'"
            class="text-[12px]"
          >
            {{ profitPctAt(currentPrice) >= 0 ? '+' : ''
            }}{{ profitPctAt(currentPrice).toFixed(2) }}%
          </span>
        </span>
        <span v-if="liqPrice" class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-orange-500 inline-block" />
          Liq <span class="font-mono text-surface-400">{{ formatPrc(liqPrice) }}</span>
        </span>
        <span v-if="dcaEntries.length > 1" class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-purple-500 inline-block" />
          {{ dcaEntries.length }} DCA
        </span>
      </div>

      <!-- Candle count + timeframe -->
      <div class="text-[12px] text-surface-500 mt-1">
        {{ tradeCandles.length }} candles · {{ timeframe }}
        <template v-if="extremes">
          · Best: {{ formatDate(extremes.bestDate) }} · Worst:
          {{ formatDate(extremes.worstDate) }}</template
        >
      </div>
    </template>
  </div>
</template>
