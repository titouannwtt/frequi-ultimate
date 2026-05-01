<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { GaugeChart, BarChart } from 'echarts/charts';
import { GridComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { useI18n } from 'vue-i18n';
import { useRateMetrics } from '@/composables/useRateMetrics';

use([GaugeChart, BarChart, CanvasRenderer, GridComponent, TitleComponent, TooltipComponent]);

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    multiBotView?: boolean;
  }>(),
  { multiBotView: false },
);

const settingsStore = useSettingsStore();

const {
  selectedWindow,
  selectedExchange,
  windowOptions,
  exchangeOptions,
  filteredMetrics,
  primaryMetrics,
  hasData,
} = useRateMetrics({ multiBotView: props.multiBotView });

function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms.toFixed(0)}ms`;
}

const tokenBucketPct = computed(() => {
  const c = primaryMetrics.value?.current;
  if (!c || !c.tokens_max) return 100;
  return Math.round((c.tokens_available / c.tokens_max) * 100);
});

const backoffActive = computed(() => primaryMetrics.value?.current?.backoff_active ?? false);
const backoffFactor = computed(() => primaryMetrics.value?.current?.backoff_factor ?? 1.0);
const backoffRemaining = computed(() => primaryMetrics.value?.current?.backoff_remaining_s ?? 0);
const consecutiveBackoffs = computed(
  () => primaryMetrics.value?.current?.consecutive_backoffs ?? 0,
);
const shedCount = computed(() => primaryMetrics.value?.current?.shed_count ?? 0);
const backoffCount = computed(() => primaryMetrics.value?.current?.backoff_count ?? 0);

const queueTotal = computed(() => {
  const depths = primaryMetrics.value?.current?.queue_depths ?? {};
  return Object.values(depths).reduce((sum, v) => sum + v, 0);
});

const recent429Count = computed(() => primaryMetrics.value?.recent_429s?.length ?? 0);

const summaryTotal = computed(() => primaryMetrics.value?.summary?.total ?? 0);
const summaryErrors = computed(() => primaryMetrics.value?.summary?.errors ?? 0);
const summaryAvgLatency = computed(() => primaryMetrics.value?.summary?.avg_latency_ms ?? 0);
const summaryP95Latency = computed(() => primaryMetrics.value?.summary?.p95_latency_ms ?? 0);

const cacheHitPct = computed(() => primaryMetrics.value?.ftcache_extended?.cache_hit_rate_pct ?? 0);
const tickersHitPct = computed(
  () => primaryMetrics.value?.ftcache_extended?.tickers_hit_rate_pct ?? 0,
);
const positionsHitPct = computed(
  () => primaryMetrics.value?.ftcache_extended?.positions_hit_rate_pct ?? 0,
);

function bucketColor(pct: number): string {
  if (pct > 60) return '#22c55e';
  if (pct > 30) return '#f59e0b';
  return '#ef4444';
}

function hitRateColor(pct: number): string {
  if (pct >= 80) return '#22c55e';
  if (pct >= 50) return '#f59e0b';
  return '#ef4444';
}

const gaugeOption = computed((): EChartsOption => {
  const pct = tokenBucketPct.value;
  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    tooltip: {
      show: true,
      formatter: () => {
        const c = primaryMetrics.value?.current;
        const avail = c?.tokens_available?.toFixed(0) ?? '?';
        const max = c?.tokens_max ?? '?';
        return [
          `<strong>${t('rateMonitor.tokenBucket')}</strong>`,
          `<br/>${t('rateMonitor.tokenBucketAvail', { avail, max })}`,
          `<br/>${t('rateMonitor.tokenBucketFill', { pct })}`,
          `<br/><br/><em>${t('rateMonitor.tokenBucketExplain')}</em>`,
          pct <= 30
            ? `<br/><br/><span style="color:#ef4444">⚠ ${t('rateMonitor.tokenBucketLow')}</span>`
            : '',
        ].join('');
      },
    },
    series: [
      {
        type: 'gauge',
        startAngle: 220,
        endAngle: -40,
        min: 0,
        max: 100,
        radius: '100%',
        center: ['50%', '60%'],
        progress: {
          show: true,
          width: 12,
          roundCap: true,
          itemStyle: { color: bucketColor(pct) },
        },
        axisLine: {
          lineStyle: { width: 12, color: [[1, '#334155']] },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        title: { show: false },
        detail: {
          valueAnimation: true,
          fontSize: 18,
          fontWeight: 'bold',
          color: bucketColor(pct),
          offsetCenter: [0, '0%'],
          formatter: '{value}%',
        },
        data: [{ value: pct }],
      },
    ],
  };
});

const hitRateBarsOption = computed((): EChartsOption => {
  const categories = ['OHLCV', 'Tickers', 'Positions'];
  const values = [cacheHitPct.value, tickersHitPct.value, positionsHitPct.value];
  const explanations: Record<string, string> = {
    OHLCV: t('rateMonitor.ohlcvDesc'),
    Tickers: t('rateMonitor.tickersDesc'),
    Positions: t('rateMonitor.positionsDesc'),
  };
  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        if (!Array.isArray(params) || params.length === 0) return '';
        const p = params[0] as { name: string; value: number };
        return [
          `<strong>${p.name}</strong>: ${p.value}%`,
          `<br/><em>${explanations[p.name] ?? ''}</em>`,
          p.value < 50
            ? `<br/><span style="color:#ef4444">${t('rateMonitor.lowCacheEfficiency')}</span>`
            : '',
        ].join('');
      },
    },
    grid: { left: 65, right: 15, top: 5, bottom: 5 },
    xAxis: {
      type: 'value',
      max: 100,
      show: false,
    },
    yAxis: {
      type: 'category',
      data: categories,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 11, color: '#94a3b8' },
    },
    series: [
      {
        type: 'bar',
        data: values.map((v) => ({
          value: v,
          itemStyle: { color: hitRateColor(v), borderRadius: [0, 4, 4, 0] },
        })),
        barWidth: 14,
        label: {
          show: true,
          position: 'right',
          formatter: '{c}%',
          fontSize: 11,
          color: '#94a3b8',
        },
      },
    ],
  };
});
</script>

<template>
  <div class="flex flex-col h-full p-2 gap-2 overflow-auto">
    <template v-if="hasData">
      <!-- Window & exchange selector -->
      <div class="flex items-center gap-2 pb-1">
        <label class="text-xs text-surface-500">{{ t('rateMonitor.window') }}</label>
        <Select
          v-model="selectedWindow"
          size="small"
          option-label="text"
          option-value="value"
          :options="windowOptions"
          class="text-xs"
          style="min-width: 80px"
        />
        <Select
          v-if="multiBotView && exchangeOptions.length > 2"
          v-model="selectedExchange"
          size="small"
          option-label="text"
          option-value="value"
          :options="exchangeOptions"
          class="text-xs"
          style="min-width: 100px"
        />
      </div>

      <!-- Top row: gauge + stats -->
      <div class="flex gap-3">
        <!-- Token bucket gauge -->
        <div class="flex flex-col items-center" style="min-width: 120px">
          <span
            class="text-xs text-surface-500 mb-1 cursor-help border-b border-dotted border-surface-600"
            :title="t('rateMonitor.rateBudgetDesc')"
          >
            {{ t('rateMonitor.rateBudget') }}
          </span>
          <ECharts
            :option="gaugeOption"
            :theme="settingsStore.chartTheme"
            autoresize
            style="width: 120px; height: 100px"
          />
          <span v-if="primaryMetrics?.current?.tokens_max" class="text-xs text-surface-500">
            {{ primaryMetrics.current.tokens_available.toFixed(0) }} /
            {{ primaryMetrics.current.tokens_max }} tokens
          </span>
        </div>

        <!-- Key stats -->
        <div class="flex flex-col gap-1.5 grow text-sm">
          <!-- 429 alert -->
          <div
            v-if="recent429Count > 0"
            class="flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/15 text-red-400"
            :title="t('rateMonitor.errorsDesc')"
          >
            <i-mdi-alert-circle class="w-4 h-4" />
            <span class="font-semibold">
              {{ t('rateMonitor.rateLimitHits', { count: recent429Count }, recent429Count) }}
            </span>
          </div>

          <!-- Backoff alert -->
          <div
            v-if="backoffActive"
            class="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/15 text-amber-400"
            :title="t('rateMonitor.backoffDesc')"
          >
            <i-mdi-timer-sand class="w-4 h-4 animate-pulse" />
            <span>
              {{ t('rateMonitor.backoff', { factor: backoffFactor.toFixed(1), remaining: backoffRemaining.toFixed(0) }) }}
            </span>
            <span
              v-if="consecutiveBackoffs > 1"
              class="ml-auto text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400"
            >
              L{{ consecutiveBackoffs }}/4
            </span>
          </div>

          <!-- Shed/429 counters (persistent, not just during backoff) -->
          <div
            v-if="backoffCount > 0 && !backoffActive"
            class="flex items-center gap-3 text-xs text-surface-500"
          >
            <span>
              <i-mdi-shield-alert-outline class="w-3.5 h-3.5 inline text-amber-500" />
              {{ backoffCount }} backoffs
            </span>
            <span v-if="shedCount > 0">
              <i-mdi-filter-remove-outline class="w-3.5 h-3.5 inline text-orange-400" />
              {{ shedCount }} shed
            </span>
          </div>

          <!-- Stats grid -->
          <div class="grid grid-cols-2 gap-x-3 gap-y-1">
            <div
              class="flex items-center gap-1 cursor-help"
              :title="t('rateMonitor.requestsDesc')"
            >
              <i-mdi-swap-horizontal class="w-4 h-4 text-blue-400" />
              <span class="text-surface-500">{{ t('rateMonitor.requests') }}</span>
              <span class="font-semibold ml-auto">{{ summaryTotal }}</span>
            </div>
            <div
              class="flex items-center gap-1 cursor-help"
              :title="t('rateMonitor.errorsDesc')"
            >
              <i-mdi-alert-outline class="w-4 h-4 text-red-400" />
              <span class="text-surface-500">{{ t('rateMonitor.errors') }}</span>
              <span class="font-semibold ml-auto">{{ summaryErrors }}</span>
            </div>
            <div
              class="flex items-center gap-1 cursor-help"
              :title="t('rateMonitor.avgResponseDesc')"
            >
              <i-mdi-speedometer class="w-4 h-4 text-green-400" />
              <span class="text-surface-500">{{ t('rateMonitor.avgResponse') }}</span>
              <span class="font-semibold ml-auto">{{ formatLatency(summaryAvgLatency) }}</span>
            </div>
            <div
              class="flex items-center gap-1 cursor-help"
              :title="t('rateMonitor.p95ResponseDesc')"
            >
              <i-mdi-speedometer-slow class="w-4 h-4 text-amber-400" />
              <span class="text-surface-500">{{ t('rateMonitor.p95Response') }}</span>
              <span class="font-semibold ml-auto">{{ formatLatency(summaryP95Latency) }}</span>
            </div>
            <div
              class="flex items-center gap-1 cursor-help"
              :title="t('rateMonitor.queueDesc')"
            >
              <i-mdi-tray-full class="w-4 h-4 text-purple-400" />
              <span class="text-surface-500">{{ t('rateMonitor.queue') }}</span>
              <span class="font-semibold ml-auto">{{ queueTotal }}</span>
            </div>
            <div
              class="flex items-center gap-1 cursor-help"
              :title="t('rateMonitor.exchangeDesc')"
            >
              <i-mdi-server class="w-4 h-4 text-cyan-400" />
              <span class="text-surface-500">{{ t('rateMonitor.exchange') }}</span>
              <span class="font-semibold ml-auto text-xs">{{
                primaryMetrics?.exchange ?? '—'
              }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Cache hit rates -->
      <div>
        <span
          class="text-xs text-surface-500 cursor-help border-b border-dotted border-surface-600"
          :title="t('rateMonitor.cacheHitRatesDesc')"
        >
          {{ t('rateMonitor.cacheHitRates') }}
        </span>
        <ECharts
          :option="hitRateBarsOption"
          :theme="settingsStore.chartTheme"
          autoresize
          style="width: 100%; height: 80px"
        />
      </div>

      <!-- Method breakdown (compact table) -->
      <div v-if="primaryMetrics?.summary?.by_method" class="text-xs">
        <span
          class="text-surface-500 cursor-help border-b border-dotted border-surface-600"
          :title="t('rateMonitor.topMethodsDesc')"
        >
          {{ t('rateMonitor.topMethods') }}
        </span>
        <div class="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 gap-y-0.5 mt-1">
          <span class="text-surface-500 font-semibold">{{ t('rateMonitor.method') }}</span>
          <span class="text-surface-500 font-semibold text-right">{{ t('rateMonitor.count') }}</span>
          <span
            class="text-surface-500 font-semibold text-right cursor-help"
            :title="t('rateMonitor.avgResponseDesc')"
          >
            {{ t('rateMonitor.avgResponse') }}
          </span>
          <span class="text-surface-500 font-semibold text-right">{{ t('rateMonitor.cached') }}</span>
          <template
            v-for="[method, stats] in Object.entries(primaryMetrics.summary.by_method)
              .sort((a, b) => (b[1] as any).count - (a[1] as any).count)
              .slice(0, 6)"
            :key="method"
          >
            <span class="truncate" :title="method">{{ method }}</span>
            <span class="text-right font-mono">{{ (stats as any).count }}</span>
            <span class="text-right font-mono">{{
              formatLatency((stats as any).avg_latency_ms ?? 0)
            }}</span>
            <span class="text-right font-mono">{{ (stats as any).cached ?? 0 }}</span>
          </template>
        </div>
      </div>

      <!-- Multi-bot: show per-bot summary -->
      <template v-if="multiBotView && Object.keys(filteredMetrics).length > 1">
        <div class="border-t border-surface-700 pt-1 mt-1">
          <span class="text-xs text-surface-500">{{ t('rateMonitor.perBot') }}</span>
          <div
            v-for="[botId, m] in Object.entries(filteredMetrics)"
            :key="botId"
            class="flex items-center justify-between text-xs gap-2 py-0.5"
          >
            <span class="truncate">{{ m.exchange }}</span>
            <span class="font-mono">{{ m.summary?.total ?? 0 }} {{ t('rateMonitor.req') }}</span>
            <span
              class="font-mono"
              :class="(m.summary?.errors_429 ?? 0) > 0 ? 'text-red-400' : 'text-surface-500'"
            >
              {{ m.summary?.errors_429 ?? 0 }} {{ t('rateMonitor.429s') }}
            </span>
          </div>
        </div>
      </template>
    </template>

    <!-- Empty state -->
    <div v-else class="flex flex-col items-center justify-center h-full text-surface-500">
      <i-mdi-chart-line class="w-8 h-8 mb-2" />
      <span class="text-sm">{{ t('rateMonitor.noMetrics') }}</span>
      <span class="text-xs">{{ t('rateMonitor.noMetricsHint') }}</span>
    </div>
  </div>
</template>

<style scoped>
.echarts {
  width: 100%;
  height: 100%;
  min-height: 80px;
}
</style>
