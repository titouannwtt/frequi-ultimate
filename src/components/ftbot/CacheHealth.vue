<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { GaugeChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { useI18n } from 'vue-i18n';
import { useRateMetrics } from '@/composables/useRateMetrics';
import Popover from 'primevue/popover';
import { usePopoverHover, trackMouse, fakeEventAtMouse } from '@/composables/usePopoverHover';

use([GaugeChart, BarChart, CanvasRenderer, GridComponent, TooltipComponent]);

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
  primaryMetrics,
  hasData,
  secondsSinceRefresh,
} = useRateMetrics({ multiBotView: props.multiBotView, refreshMs: 15000 });

const ftcache = computed(() => primaryMetrics.value?.ftcache_extended);
const ftpairlist = computed(() => primaryMetrics.value?.ftpairlist);
const exchangeLimit = computed(() => primaryMetrics.value?.exchange_rate_limit);
const summary = computed(() => primaryMetrics.value?.summary);

const cacheHitPct = computed(() => ftcache.value?.cache_hit_rate_pct ?? 0);
const pairlistHitPct = computed(() => ftpairlist.value?.hit_rate_pct ?? 0);

const totalRequests = computed(() => summary.value?.total ?? 0);
const cachedRequests = computed(() => summary.value?.cached ?? 0);
const directRequests = computed(() => summary.value?.direct ?? 0);
const pairlistHits = computed(() => ftpairlist.value?.hits ?? 0);
const maxReqPerMin = computed(() => exchangeLimit.value?.max_requests_per_min ?? 0);

const usagePct = computed(() => {
  if (!maxReqPerMin.value || !totalRequests.value) return 0;
  return Math.min(100, Math.round((directRequests.value / maxReqPerMin.value) * 100));
});

const refreshProgress = computed(() => Math.min(100, (secondsSinceRefresh.value / 15) * 100));

// --- Metric popover ---
type MetricKey = 'ftcache' | 'ftpairlist' | 'breakdown' | 'capacity' | 'entries' | 'clients' | 'ftcacheReq' | 'ftpairlistReq';
const {
  popoverRef: metricPopoverRef,
  hoveredValue: hoveredMetric,
  startHover: startMetricHover,
  cancelHover: cancelMetricHover,
  keepPopover: keepMetricPopover,
  hide: hideMetricPopover,
} = usePopoverHover<MetricKey>(250);

// --- Gauge detail popover (replaces ECharts tooltip) ---
const gaugePopoverRef = ref<InstanceType<typeof Popover>>();
const gaugeTarget = ref<'ftcache' | 'ftpairlist' | null>(null);

function showGaugePopover(event: MouseEvent, target: 'ftcache' | 'ftpairlist') {
  trackMouse(event);
  gaugeTarget.value = target;
  nextTick(() => gaugePopoverRef.value?.show(fakeEventAtMouse()));
}
function hideGaugePopover() {
  gaugePopoverRef.value?.hide();
  gaugeTarget.value = null;
}

function statusColor(pct: number): string {
  if (pct >= 80) return '#22c55e';
  if (pct >= 50) return '#f59e0b';
  return '#ef4444';
}

function loadColor(pct: number): string {
  if (pct < 50) return '#22c55e';
  if (pct < 80) return '#f59e0b';
  return '#ef4444';
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const ftcacheGauge = computed((): EChartsOption => {
  const pct = cacheHitPct.value;
  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    tooltip: { show: false },
    series: [
      {
        type: 'gauge',
        startAngle: 220,
        endAngle: -40,
        min: 0,
        max: 100,
        radius: '100%',
        center: ['50%', '65%'],
        progress: {
          show: true,
          width: 10,
          roundCap: true,
          itemStyle: { color: statusColor(pct) },
        },
        axisLine: {
          lineStyle: { width: 10, color: [[1, '#334155']] },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        title: {
          show: true,
          offsetCenter: [0, '40%'],
          fontSize: 10,
          color: '#94a3b8',
        },
        detail: {
          valueAnimation: true,
          fontSize: 16,
          fontWeight: 'bold',
          color: statusColor(pct),
          offsetCenter: [0, '-5%'],
          formatter: '{value}%',
        },
        data: [{ value: pct, name: 'ftcache' }],
      },
    ],
  };
});

const ftpairlistGauge = computed((): EChartsOption => {
  const pct = pairlistHitPct.value;
  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    tooltip: { show: false },
    series: [
      {
        type: 'gauge',
        startAngle: 220,
        endAngle: -40,
        min: 0,
        max: 100,
        radius: '100%',
        center: ['50%', '65%'],
        progress: {
          show: true,
          width: 10,
          roundCap: true,
          itemStyle: { color: '#3b82f6' },
        },
        axisLine: {
          lineStyle: { width: 10, color: [[1, '#334155']] },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        title: {
          show: true,
          offsetCenter: [0, '40%'],
          fontSize: 10,
          color: '#94a3b8',
        },
        detail: {
          valueAnimation: true,
          fontSize: 16,
          fontWeight: 'bold',
          color: '#3b82f6',
          offsetCenter: [0, '-5%'],
          formatter: '{value}%',
        },
        data: [{ value: pct, name: 'ftpairlist' }],
      },
    ],
  };
});

const breakdownOption = computed((): EChartsOption => {
  const cached = cachedRequests.value;
  const direct = directRequests.value;
  const pairlist = pairlistHits.value;
  const total = totalRequests.value + pairlist;
  if (total === 0) return {};

  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        if (!Array.isArray(params)) return '';
        let html = '';
        for (const s of params as Array<{ seriesName: string; value: number; color: string }>) {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
          html += `<span style="color:${s.color}">●</span> ${s.seriesName}: <strong>${s.value}</strong> (${pct}%)<br/>`;
        }
        if (maxReqPerMin.value) {
          html += `<br/>${t('cacheHealth.exchangeMax')}: ${maxReqPerMin.value} req/min`;
        }
        return html;
      },
    },
    grid: { left: 5, right: 5, top: 5, bottom: 5 },
    xAxis: {
      type: 'value',
      show: false,
      max: total,
    },
    yAxis: {
      type: 'category',
      data: [''],
      show: false,
    },
    series: [
      {
        name: t('cacheHealth.cachedFtcache'),
        type: 'bar',
        stack: 'total',
        data: [cached],
        color: '#22c55e',
        barWidth: 20,
        itemStyle: { borderRadius: [4, 0, 0, 4] },
      },
      {
        name: t('cacheHealth.cachedFtpairlist'),
        type: 'bar',
        stack: 'total',
        data: [pairlist],
        color: '#3b82f6',
        barWidth: 20,
      },
      {
        name: t('cacheHealth.directToExchange'),
        type: 'bar',
        stack: 'total',
        data: [direct],
        color: '#f59e0b',
        barWidth: 20,
        itemStyle: { borderRadius: [0, 4, 4, 0] },
      },
    ],
  };
});

const metricDescriptions: Record<MetricKey, () => string> = {
  ftcache: () => t('cacheHealth.ftcacheExplain') + '\n\n' + t('cacheHealth.gaugeExplain0') + '\n' + t('cacheHealth.gaugeExplain100'),
  ftpairlist: () => t('cacheHealth.ftpairlistExplain') + '\n\n' + t('cacheHealth.gaugeExplain0') + '\n' + t('cacheHealth.gaugeExplain100'),
  breakdown: () => t('cacheHealth.breakdownDesc'),
  capacity: () => t('cacheHealth.capacityDesc'),
  entries: () => t('cacheHealth.entriesDesc'),
  clients: () => t('cacheHealth.clientsDesc'),
  ftcacheReq: () => t('cacheHealth.ftcacheExplain'),
  ftpairlistReq: () => t('cacheHealth.ftpairlistExplain'),
};
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden" @mousemove="trackMouse">
    <!-- Refresh progress bar -->
    <div class="h-0.5 w-full bg-surface-800 shrink-0">
      <div
        class="h-full transition-all duration-1000 ease-linear"
        :style="{ width: `${refreshProgress}%`, backgroundColor: refreshProgress > 80 ? '#f59e0b' : '#3b82f6' }"
      />
    </div>

    <div class="flex flex-col h-full p-2 gap-2 overflow-auto">
      <template v-if="hasData">
        <!-- Toolbar: window selector + refresh indicator -->
        <div class="flex items-center gap-2">
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

        <!-- Gauges row -->
        <div class="flex gap-2 justify-center">
          <div
            class="flex flex-col items-center cursor-help"
            style="min-width: 100px"
            @mouseenter="showGaugePopover($event, 'ftcache')"
            @mouseleave="hideGaugePopover"
          >
            <ECharts
              :option="ftcacheGauge"
              :theme="settingsStore.chartTheme"
              autoresize
              style="width: 100px; height: 90px; pointer-events: none"
            />
          </div>
          <div
            v-if="ftpairlist"
            class="flex flex-col items-center cursor-help"
            style="min-width: 100px"
            @mouseenter="showGaugePopover($event, 'ftpairlist')"
            @mouseleave="hideGaugePopover"
          >
            <ECharts
              :option="ftpairlistGauge"
              :theme="settingsStore.chartTheme"
              autoresize
              style="width: 100px; height: 90px; pointer-events: none"
            />
          </div>
        </div>

        <!-- Request breakdown bar -->
        <div>
          <span
            class="text-xs text-surface-500 cursor-help border-b border-dotted border-surface-600"
            @mouseenter="startMetricHover($event, 'breakdown')"
            @mouseleave="cancelMetricHover"
          >
            {{ t('cacheHealth.breakdown') }}
          </span>
          <ECharts
            v-if="totalRequests > 0 || pairlistHits > 0"
            :option="breakdownOption"
            :theme="settingsStore.chartTheme"
            autoresize
            style="width: 100%; height: 35px"
          />
          <div class="flex justify-between text-xs text-surface-500 mt-0.5 flex-wrap gap-1">
            <span>
              <span class="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />
              {{ t('cacheHealth.cachedFtcache') }}: {{ fmtNum(cachedRequests) }}
            </span>
            <span v-if="pairlistHits > 0">
              <span class="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1" />
              {{ t('cacheHealth.cachedFtpairlist') }}: {{ fmtNum(pairlistHits) }}
            </span>
            <span>
              <span class="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1" />
              {{ t('cacheHealth.directToExchange') }}: {{ fmtNum(directRequests) }}
            </span>
          </div>
        </div>

        <!-- Exchange capacity -->
        <div v-if="exchangeLimit" class="text-xs">
          <span
            class="text-surface-500 cursor-help border-b border-dotted border-surface-600"
            @mouseenter="startMetricHover($event, 'capacity')"
            @mouseleave="cancelMetricHover"
          >
            {{ t('cacheHealth.exchangeCapacity') }}
          </span>
          <div class="mt-1">
            <div class="flex justify-between mb-0.5">
              <span class="text-surface-500">{{ t('cacheHealth.directLoad') }}</span>
              <span class="font-mono" :style="{ color: loadColor(usagePct) }">
                {{ usagePct }}%
              </span>
            </div>
            <div class="w-full h-2 bg-surface-700 rounded-full overflow-hidden">
              <div
                class="h-full rounded-full transition-all"
                :style="{ width: `${Math.min(100, usagePct)}%`, backgroundColor: loadColor(usagePct) }"
              />
            </div>
            <div class="flex justify-between mt-0.5 text-surface-500">
              <span>{{ fmtNum(directRequests) }} {{ t('rateMonitor.req') }}</span>
              <span>max {{ exchangeLimit.max_requests_per_min }} req/min</span>
            </div>
          </div>
        </div>

        <!-- Stats grid -->
        <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div
            v-if="ftcache"
            class="flex items-center gap-1 cursor-help"
            @mouseenter="startMetricHover($event, 'ftcacheReq')"
            @mouseleave="cancelMetricHover"
          >
            <i-mdi-database class="w-3.5 h-3.5 text-green-400" />
            <span class="text-surface-500">ftcache</span>
            <span class="font-semibold ml-auto">{{ fmtNum(ftcache.requests_total) }} req</span>
          </div>
          <div
            v-if="ftpairlist"
            class="flex items-center gap-1 cursor-help"
            @mouseenter="startMetricHover($event, 'ftpairlistReq')"
            @mouseleave="cancelMetricHover"
          >
            <i-mdi-format-list-bulleted class="w-3.5 h-3.5 text-blue-400" />
            <span class="text-surface-500">ftpairlist</span>
            <span class="font-semibold ml-auto">{{ fmtNum(ftpairlist.gets) }} req</span>
          </div>
          <div
            v-if="ftpairlist"
            class="flex items-center gap-1 cursor-help"
            @mouseenter="startMetricHover($event, 'entries')"
            @mouseleave="cancelMetricHover"
          >
            <i-mdi-package-variant class="w-3.5 h-3.5 text-cyan-400" />
            <span class="text-surface-500">{{ t('cacheHealth.entries') }}</span>
            <span class="font-semibold ml-auto">{{ ftpairlist.entries }}</span>
          </div>
          <div
            v-if="ftpairlist"
            class="flex items-center gap-1 cursor-help"
            @mouseenter="startMetricHover($event, 'clients')"
            @mouseleave="cancelMetricHover"
          >
            <i-mdi-account-multiple class="w-3.5 h-3.5 text-amber-400" />
            <span class="text-surface-500">{{ t('cacheHealth.clients') }}</span>
            <span class="font-semibold ml-auto">{{ ftpairlist.clients }}</span>
          </div>
        </div>
      </template>

      <!-- Empty state -->
      <div v-else class="flex flex-col items-center justify-center h-full text-surface-500">
        <i-mdi-database-cog class="w-8 h-8 mb-2" />
        <span class="text-sm">{{ t('cacheHealth.noData') }}</span>
        <span class="text-xs">{{ t('cacheHealth.noDataHint') }}</span>
      </div>
    </div>

    <!-- Gauge detail popover -->
    <Popover ref="gaugePopoverRef" :dismissable="true" class="!p-0 z-50">
      <div
        class="p-3 text-xs space-y-1.5 max-w-[280px]"
        @mouseenter="() => {}"
        @mouseleave="hideGaugePopover"
      >
        <template v-if="gaugeTarget === 'ftcache' && ftcache">
          <div class="font-semibold text-green-400">ftcache</div>
          <div class="space-y-0.5">
            <div class="flex justify-between">
              <span class="text-surface-400">{{ t('cacheHealth.hitRate') }}</span>
              <span class="font-mono font-bold" :style="{ color: statusColor(cacheHitPct) }">{{ cacheHitPct }}%</span>
            </div>
            <div class="flex justify-between">
              <span class="text-surface-400">{{ t('cacheHealth.totalRequests') }}</span>
              <span class="font-mono">{{ fmtNum(ftcache.requests_total) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-surface-400">{{ t('cacheHealth.cacheHits') }}</span>
              <span class="font-mono text-green-400">{{ fmtNum(ftcache.cache_hits) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-surface-400">{{ t('cacheHealth.cacheMisses') }}</span>
              <span class="font-mono text-red-400">{{ fmtNum(ftcache.cache_misses) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-surface-400">Partial</span>
              <span class="font-mono text-amber-400">{{ fmtNum(ftcache.cache_partial) }}</span>
            </div>
          </div>
          <div class="border-t border-surface-700 pt-1.5 text-surface-500 leading-relaxed">
            {{ t('cacheHealth.ftcacheExplain') }}
          </div>
        </template>
        <template v-else-if="gaugeTarget === 'ftpairlist' && ftpairlist">
          <div class="font-semibold text-blue-400">ftpairlist</div>
          <div class="space-y-0.5">
            <div class="flex justify-between">
              <span class="text-surface-400">{{ t('cacheHealth.hitRate') }}</span>
              <span class="font-mono font-bold text-blue-400">{{ pairlistHitPct }}%</span>
            </div>
            <div class="flex justify-between">
              <span class="text-surface-400">{{ t('cacheHealth.gets') }}</span>
              <span class="font-mono">{{ fmtNum(ftpairlist.gets) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-surface-400">{{ t('cacheHealth.hits') }}</span>
              <span class="font-mono text-green-400">{{ fmtNum(ftpairlist.hits) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-surface-400">{{ t('cacheHealth.puts') }}</span>
              <span class="font-mono">{{ fmtNum(ftpairlist.puts) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-surface-400">{{ t('cacheHealth.entries') }}</span>
              <span class="font-mono">{{ ftpairlist.entries }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-surface-400">{{ t('cacheHealth.clients') }}</span>
              <span class="font-mono">{{ ftpairlist.clients }}</span>
            </div>
          </div>
          <div class="border-t border-surface-700 pt-1.5 text-surface-500 leading-relaxed">
            {{ t('cacheHealth.ftpairlistExplain') }}
          </div>
        </template>
      </div>
    </Popover>

    <!-- Metric description popover -->
    <Popover ref="metricPopoverRef" :dismissable="true" class="!p-0 z-50">
      <div
        v-if="hoveredMetric"
        class="p-2.5 text-xs max-w-[250px] text-surface-300 leading-relaxed whitespace-pre-line"
        @mouseenter="keepMetricPopover"
        @mouseleave="cancelMetricHover"
      >
        {{ metricDescriptions[hoveredMetric]() }}
      </div>
    </Popover>
  </div>
</template>

<style scoped>
.echarts {
  width: 100%;
  height: 100%;
  min-height: 80px;
}
</style>
