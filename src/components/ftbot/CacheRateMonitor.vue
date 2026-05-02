<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { GaugeChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { useI18n } from 'vue-i18n';
import { useRateMetrics } from '@/composables/useRateMetrics';
import { usePopoverHover, trackMouse, fakeEventAtMouse } from '@/composables/usePopoverHover';
import Popover from 'primevue/popover';

use([GaugeChart, BarChart, CanvasRenderer, GridComponent, TooltipComponent]);

const { t } = useI18n();
const settingsStore = useSettingsStore();

const props = withDefaults(
  defineProps<{
    multiBotView?: boolean;
  }>(),
  { multiBotView: false },
);

const {
  selectedWindow,
  selectedExchange,
  windowOptions,
  exchangeOptions,
  primaryMetrics,
  hasData,
  secondsSinceRefresh,
} = useRateMetrics({ multiBotView: props.multiBotView, refreshMs: 15_000 });

// --- data ---
const current = computed(() => primaryMetrics.value?.current);
const ftcache = computed(() => primaryMetrics.value?.ftcache_extended);
const ftpairlist = computed(() => primaryMetrics.value?.ftpairlist);
const summary = computed(() => primaryMetrics.value?.summary);
const exchangeLimit = computed(() => primaryMetrics.value?.exchange_rate_limit);
const recent429s = computed(() => primaryMetrics.value?.recent_429s ?? []);

// --- derived ---
const tokenPct = computed(() => {
  const c = current.value;
  if (!c?.tokens_max) return 100;
  return Math.round((c.tokens_available / c.tokens_max) * 100);
});

const ohlcvHitPct = computed(() => (ftcache.value as any)?.cache_hit_rate_pct ?? 0);
const tickersHitPct = computed(() => (ftcache.value as any)?.tickers_hit_rate_pct ?? 0);
const pairlistHitPct = computed(() => ftpairlist.value?.hit_rate_pct ?? 0);

const globalCacheHitPct = computed(() => {
  const ext = ftcache.value;
  const pl = ftpairlist.value;
  if (!ext) return 0;
  const oTotal = ext.requests_total || 0;
  const oHits = ext.cache_hits || 0;
  const tTotal = ext.tickers_requests || 0;
  const tHits = ext.tickers_cache_hits || 0;
  const pTotal = pl?.gets || 0;
  const pHits = pl?.hits || 0;
  const total = oTotal + tTotal + pTotal;
  const hits = oHits + tHits + pHits;
  return total > 0 ? Math.round(hits / total * 100) : 0;
});

const directRequests = computed(() => summary.value?.direct ?? 0);
const maxReqPerMin = computed(() => exchangeLimit.value?.max_requests_per_min ?? 0);
const loadPct = computed(() => {
  if (!maxReqPerMin.value) return 0;
  return Math.min(100, Math.round((directRequests.value / maxReqPerMin.value) * 100));
});

const refreshProgress = computed(() => Math.min(100, (secondsSinceRefresh.value / 15) * 100));

const detailOpen = ref(false);

// --- popovers ---
type CardKey = 'budget' | 'cache' | 'load';
const cardPopoverRef = ref<InstanceType<typeof Popover>>();
const cardTarget = ref<CardKey | null>(null);

function showCardPopover(event: MouseEvent, target: CardKey) {
  trackMouse(event);
  cardTarget.value = target;
  nextTick(() => cardPopoverRef.value?.show(fakeEventAtMouse()));
}
function hideCardPopover() {
  cardPopoverRef.value?.hide();
  cardTarget.value = null;
}

// --- colors ---
function bucketColor(pct: number): string {
  if (pct > 60) return '#22c55e';
  if (pct > 30) return '#f59e0b';
  return '#ef4444';
}
function hitColor(pct: number): string {
  if (pct >= 80) return '#22c55e';
  if (pct >= 50) return '#f59e0b';
  return '#ef4444';
}
function loadColor(pct: number): string {
  if (pct < 50) return '#22c55e';
  if (pct < 80) return '#f59e0b';
  return '#ef4444';
}

// --- formatters ---
function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function fmtLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms.toFixed(0)}ms`;
}

// --- gauge builders ---
function makeGauge(pct: number, color: string, width = 10): EChartsOption {
  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    tooltip: { show: false },
    series: [{
      type: 'gauge', startAngle: 220, endAngle: -40,
      min: 0, max: 100, radius: '100%', center: ['50%', '62%'],
      progress: { show: true, width, roundCap: true, itemStyle: { color } },
      axisLine: { lineStyle: { width, color: [[1, '#1e293b']] } },
      axisTick: { show: false }, splitLine: { show: false },
      axisLabel: { show: false }, pointer: { show: false },
      title: { show: false },
      detail: {
        valueAnimation: true, fontSize: 18, fontWeight: 'bold',
        color, offsetCenter: [0, '-2%'], formatter: '{value}%',
      },
      data: [{ value: pct }],
    }],
  };
}

const budgetGauge = computed(() => makeGauge(tokenPct.value, bucketColor(tokenPct.value), 12));
const cacheGauge = computed(() => makeGauge(globalCacheHitPct.value, hitColor(globalCacheHitPct.value)));
const loadGauge = computed(() => makeGauge(loadPct.value, loadColor(loadPct.value)));

// --- hit bars for cache card ---
const hitBarsOption = computed((): EChartsOption => {
  const cats = ['OHLCV', 'Tickers', 'Pairlist'];
  const vals = [ohlcvHitPct.value, tickersHitPct.value, pairlistHitPct.value];
  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    tooltip: { show: false },
    grid: { left: 50, right: 32, top: 0, bottom: 0 },
    xAxis: { type: 'value', max: 100, show: false },
    yAxis: {
      type: 'category', data: cats,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { fontSize: 9, color: '#94a3b8' },
    },
    series: [{
      type: 'bar', barWidth: 8,
      data: vals.map(v => ({
        value: v,
        itemStyle: { color: hitColor(v), borderRadius: [0, 3, 3, 0] },
      })),
      label: { show: true, position: 'right', formatter: '{c}%', fontSize: 9, color: '#94a3b8' },
    }],
  };
});
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden" @mousemove="trackMouse">
    <!-- Refresh progress bar -->
    <div class="h-0.5 w-full bg-surface-800 shrink-0">
      <div
        class="h-full transition-all duration-1000 ease-linear"
        :style="{ width: `${refreshProgress}%`, backgroundColor: bucketColor(tokenPct) }"
      />
    </div>

    <div class="flex flex-col h-full p-2 gap-1.5 overflow-auto">
      <template v-if="hasData">
        <!-- Toolbar -->
        <div class="flex items-center gap-2 shrink-0">
          <Select
            v-model="selectedWindow"
            size="small"
            option-label="text"
            option-value="value"
            :options="windowOptions"
            class="text-xs"
            style="min-width: 75px"
          />
          <Select
            v-if="multiBotView && exchangeOptions.length > 2"
            v-model="selectedExchange"
            size="small"
            option-label="text"
            option-value="value"
            :options="exchangeOptions"
            class="text-xs"
            style="min-width: 90px"
          />
          <span class="ml-auto text-[10px] text-surface-500 font-mono tabular-nums">
            {{ secondsSinceRefresh }}s
          </span>
        </div>

        <!-- ZONE 1: Alerts (conditional) -->
        <div
          v-if="recent429s.length > 0"
          class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-500/10 text-red-400 text-xs border border-red-500/20 shrink-0"
        >
          <i-mdi-alert-circle class="w-3.5 h-3.5 shrink-0" />
          <span class="font-semibold">{{ recent429s.length }} {{ t('rateMonitor.429s') }}</span>
          <span class="text-[10px] text-red-400/70 ml-auto truncate">
            {{ recent429s[0]?.method ?? '' }}
          </span>
        </div>
        <div
          v-if="current?.backoff_active"
          class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 text-amber-400 text-xs border border-amber-500/20 shrink-0"
        >
          <i-mdi-timer-sand class="w-3.5 h-3.5 animate-pulse shrink-0" />
          <span>BACKOFF {{ current.backoff_remaining_s?.toFixed(0) }}s</span>
          <div class="grow mx-2 h-1.5 bg-amber-900/30 rounded-full overflow-hidden">
            <div
              class="h-full bg-amber-400 rounded-full transition-all"
              :style="{ width: `${Math.max(5, 100 - (current.backoff_remaining_s / (current.current_backoff_duration_s || 30)) * 100)}%` }"
            />
          </div>
          <span
            v-if="current.consecutive_backoffs > 1"
            class="text-[10px] px-1.5 rounded-full bg-red-500/20 text-red-400 font-semibold shrink-0"
          >
            L{{ current.consecutive_backoffs }}/4
          </span>
        </div>

        <!-- ZONE 2: Three summary cards -->
        <div class="grid grid-cols-3 gap-1.5 shrink-0">
          <!-- Card 1: Rate Budget -->
          <div
            class="flex flex-col items-center p-1.5 rounded-lg cursor-help transition-colors hover:bg-surface-800/50"
            style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04)"
            @mouseenter="showCardPopover($event, 'budget')"
            @mouseleave="hideCardPopover"
          >
            <span class="text-[9px] text-surface-500 mb-0.5">{{ t('rateMonitor.rateBudget') }}</span>
            <ECharts
              :option="budgetGauge"
              :theme="settingsStore.chartTheme"
              autoresize
              style="width: 90px; height: 70px; pointer-events: none"
            />
            <span v-if="current?.tokens_max" class="text-[9px] text-surface-500 font-mono -mt-0.5">
              {{ current.tokens_available.toFixed(0) }}/{{ current.tokens_max }} tk
            </span>
          </div>

          <!-- Card 2: Cache Hit Rate -->
          <div
            class="flex flex-col items-center p-1.5 rounded-lg cursor-help transition-colors hover:bg-surface-800/50"
            style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04)"
            @mouseenter="showCardPopover($event, 'cache')"
            @mouseleave="hideCardPopover"
          >
            <span class="text-[9px] text-surface-500 mb-0.5">{{ t('rateMonitor.cacheHitRates') }}</span>
            <ECharts
              :option="cacheGauge"
              :theme="settingsStore.chartTheme"
              autoresize
              style="width: 90px; height: 70px; pointer-events: none"
            />
            <ECharts
              :option="hitBarsOption"
              :theme="settingsStore.chartTheme"
              autoresize
              style="width: 100%; height: 42px; pointer-events: none"
            />
          </div>

          <!-- Card 3: Exchange Load -->
          <div
            class="flex flex-col items-center p-1.5 rounded-lg cursor-help transition-colors hover:bg-surface-800/50"
            style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04)"
            @mouseenter="showCardPopover($event, 'load')"
            @mouseleave="hideCardPopover"
          >
            <span class="text-[9px] text-surface-500 mb-0.5">{{ t('cacheHealth.exchangeCapacity') }}</span>
            <ECharts
              :option="loadGauge"
              :theme="settingsStore.chartTheme"
              autoresize
              style="width: 90px; height: 70px; pointer-events: none"
            />
            <span class="text-[9px] text-surface-500 font-mono -mt-0.5">
              {{ fmt(directRequests) }} / {{ maxReqPerMin }} r/m
            </span>
          </div>
        </div>

        <!-- ZONE 3: Expandable detail -->
        <button
          class="flex items-center gap-1 text-[10px] text-surface-500 hover:text-surface-300 transition-colors shrink-0 self-start"
          @click="detailOpen = !detailOpen"
        >
          <i-mdi-chevron-right
            class="w-3.5 h-3.5 transition-transform duration-200"
            :class="{ 'rotate-90': detailOpen }"
          />
          {{ detailOpen ? t('cacheHealth.breakdown') : t('cacheHealth.breakdown') }}
        </button>

        <template v-if="detailOpen">
          <!-- Request breakdown bar -->
          <div class="text-xs shrink-0">
            <div class="flex items-center h-5 w-full rounded-md overflow-hidden bg-surface-800">
              <div
                v-if="(summary?.cached ?? 0) > 0"
                class="h-full bg-green-500/80"
                :style="{ width: `${((summary?.cached ?? 0) / ((summary?.total ?? 0) + (ftpairlist?.hits ?? 0) || 1)) * 100}%` }"
              />
              <div
                v-if="(ftpairlist?.hits ?? 0) > 0"
                class="h-full bg-blue-500/80"
                :style="{ width: `${((ftpairlist?.hits ?? 0) / ((summary?.total ?? 0) + (ftpairlist?.hits ?? 0) || 1)) * 100}%` }"
              />
              <div
                v-if="(summary?.direct ?? 0) > 0"
                class="h-full bg-amber-500/80"
                :style="{ width: `${((summary?.direct ?? 0) / ((summary?.total ?? 0) + (ftpairlist?.hits ?? 0) || 1)) * 100}%` }"
              />
            </div>
            <div class="flex gap-3 mt-1 text-[10px] text-surface-500 flex-wrap">
              <span><span class="inline-block w-1.5 h-1.5 rounded-full bg-green-500 mr-0.5" />{{ t('cacheHealth.cachedFtcache') }} {{ fmt(summary?.cached ?? 0) }}</span>
              <span v-if="(ftpairlist?.hits ?? 0) > 0"><span class="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 mr-0.5" />{{ t('cacheHealth.cachedFtpairlist') }} {{ fmt(ftpairlist?.hits ?? 0) }}</span>
              <span><span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 mr-0.5" />{{ t('cacheHealth.directToExchange') }} {{ fmt(summary?.direct ?? 0) }}</span>
              <span v-if="(summary?.errors ?? 0) > 0" class="text-red-400"><span class="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mr-0.5" />{{ t('rateMonitor.errors') }} {{ summary?.errors }}</span>
            </div>
          </div>

          <!-- Compact stats row -->
          <div class="flex items-center gap-3 text-[10px] text-surface-500 shrink-0 flex-wrap">
            <span v-if="summary?.total">
              <i-mdi-swap-horizontal class="w-3 h-3 inline text-blue-400" />
              {{ fmt(summary.total) }} {{ t('rateMonitor.req') }}
            </span>
            <span v-if="summary?.avg_latency_ms">
              <i-mdi-speedometer class="w-3 h-3 inline text-green-400" />
              {{ fmtLatency(summary.avg_latency_ms) }} avg
            </span>
            <span v-if="(current?.backoff_count ?? 0) > 0">
              <i-mdi-shield-alert-outline class="w-3 h-3 inline text-amber-500" />
              {{ current?.backoff_count }} backoffs
            </span>
            <span v-if="(current?.shed_count ?? 0) > 0">
              <i-mdi-filter-remove-outline class="w-3 h-3 inline text-orange-400" />
              {{ fmt(current?.shed_count ?? 0) }} shed
            </span>
            <span v-if="Object.values(current?.queue_depths ?? {}).reduce((s: number, v: number) => s + v, 0) > 0">
              <i-mdi-tray-full class="w-3 h-3 inline text-purple-400" />
              queue {{ Object.values(current?.queue_depths ?? {}).reduce((s: number, v: number) => s + v, 0) }}
            </span>
          </div>
        </template>
      </template>

      <!-- Empty state -->
      <div v-else class="flex flex-col items-center justify-center h-full text-surface-500">
        <i-mdi-database-cog class="w-8 h-8 mb-2" />
        <span class="text-sm">{{ t('cacheHealth.noData') }}</span>
        <span class="text-xs">{{ t('cacheHealth.noDataHint') }}</span>
      </div>
    </div>

    <!-- Card detail popover -->
    <Popover ref="cardPopoverRef" :dismissable="true" class="!p-0 z-50">
      <div
        class="p-3 text-xs space-y-1.5 max-w-[280px]"
        @mouseenter="() => {}"
        @mouseleave="hideCardPopover"
      >
        <!-- Budget detail -->
        <template v-if="cardTarget === 'budget'">
          <div class="font-semibold" :style="{ color: bucketColor(tokenPct) }">
            {{ t('rateMonitor.rateBudget') }}
          </div>
          <div class="space-y-0.5">
            <div class="flex justify-between">
              <span class="text-surface-400">Tokens</span>
              <span class="font-mono font-bold" :style="{ color: bucketColor(tokenPct) }">
                {{ current?.tokens_available?.toFixed(1) ?? '?' }} / {{ current?.tokens_max ?? '?' }}
              </span>
            </div>
            <div v-if="current?.refill_rate" class="flex justify-between">
              <span class="text-surface-400">Refill</span>
              <span class="font-mono">{{ current.refill_rate }}/s</span>
            </div>
            <div v-if="(current?.backoff_count ?? 0) > 0" class="flex justify-between">
              <span class="text-surface-400">Backoffs</span>
              <span class="font-mono text-amber-400">{{ current?.backoff_count }}</span>
            </div>
            <div v-if="(current?.shed_count ?? 0) > 0" class="flex justify-between">
              <span class="text-surface-400">Shed</span>
              <span class="font-mono text-orange-400">{{ current?.shed_count }}</span>
            </div>
          </div>
          <div class="border-t border-surface-700 pt-1.5 text-surface-500 leading-relaxed">
            {{ t('rateMonitor.rateBudgetDesc') }}
          </div>
        </template>

        <!-- Cache detail -->
        <template v-if="cardTarget === 'cache'">
          <div class="font-semibold" :style="{ color: hitColor(globalCacheHitPct) }">
            {{ t('rateMonitor.cacheHitRates') }} — {{ globalCacheHitPct }}%
          </div>
          <div class="space-y-0.5">
            <div class="flex justify-between">
              <span class="text-surface-400">OHLCV</span>
              <span class="font-mono" :style="{ color: hitColor(ohlcvHitPct) }">{{ ohlcvHitPct }}%</span>
            </div>
            <div class="flex justify-between">
              <span class="text-surface-400">Tickers</span>
              <span class="font-mono" :style="{ color: hitColor(tickersHitPct) }">{{ tickersHitPct }}%</span>
            </div>
            <div class="flex justify-between">
              <span class="text-surface-400">Pairlist</span>
              <span class="font-mono" :style="{ color: hitColor(pairlistHitPct) }">{{ pairlistHitPct }}%</span>
            </div>
            <div v-if="ftcache" class="border-t border-surface-700 mt-1 pt-1 space-y-0.5">
              <div class="flex justify-between">
                <span class="text-surface-400">{{ t('cacheHealth.cacheHits') }}</span>
                <span class="font-mono text-green-400">{{ fmt(ftcache.cache_hits) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-surface-400">{{ t('cacheHealth.cacheMisses') }}</span>
                <span class="font-mono text-red-400">{{ fmt(ftcache.cache_misses) }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-surface-400">Partial</span>
                <span class="font-mono text-amber-400">{{ fmt(ftcache.cache_partial) }}</span>
              </div>
            </div>
          </div>
          <div class="border-t border-surface-700 pt-1.5 text-surface-500 leading-relaxed">
            {{ t('rateMonitor.cacheHitRatesDesc') }}
          </div>
        </template>

        <!-- Load detail -->
        <template v-if="cardTarget === 'load'">
          <div class="font-semibold" :style="{ color: loadColor(loadPct) }">
            {{ t('cacheHealth.exchangeCapacity') }} — {{ loadPct }}%
          </div>
          <div class="space-y-0.5">
            <div class="flex justify-between">
              <span class="text-surface-400">{{ t('cacheHealth.directLoad') }}</span>
              <span class="font-mono">{{ fmt(directRequests) }} {{ t('rateMonitor.req') }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-surface-400">{{ t('cacheHealth.exchangeMax') }}</span>
              <span class="font-mono">{{ maxReqPerMin }} req/min</span>
            </div>
            <div v-if="summary" class="flex justify-between">
              <span class="text-surface-400">{{ t('rateMonitor.avgResponse') }}</span>
              <span class="font-mono">{{ fmtLatency(summary.avg_latency_ms ?? 0) }}</span>
            </div>
          </div>
          <div class="border-t border-surface-700 pt-1.5 text-surface-500 leading-relaxed">
            {{ t('cacheHealth.capacityDesc') }}
          </div>
        </template>
      </div>
    </Popover>
  </div>
</template>
