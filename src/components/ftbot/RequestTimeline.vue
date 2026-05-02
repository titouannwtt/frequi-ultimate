<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart, BarChart, SankeyChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components';
import { useI18n } from 'vue-i18n';
import { useRateMetrics } from '@/composables/useRateMetrics';
import type { MethodStats, RateTimelineBucket } from '@/types';

use([
  LineChart, BarChart, SankeyChart, CanvasRenderer,
  DataZoomComponent, GridComponent, LegendComponent,
  MarkLineComponent, TooltipComponent,
]);

const { t } = useI18n();

const props = withDefaults(
  defineProps<{ multiBotView?: boolean }>(),
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
} = useRateMetrics({ multiBotView: props.multiBotView });

type ViewMode = 'timeline' | 'flow' | 'table';
const viewMode = ref<ViewMode>('timeline');

const sortKey = ref<'count' | 'cached' | 'errors' | 'avg_latency_ms' | 'p95_latency_ms'>('count');
const sortAsc = ref(false);

function toggleSort(key: typeof sortKey.value) {
  if (sortKey.value === key) sortAsc.value = !sortAsc.value;
  else { sortKey.value = key; sortAsc.value = false; }
}
function sortIcon(key: string): string {
  if (sortKey.value !== key) return '↕';
  return sortAsc.value ? '↑' : '↓';
}

const timeline = computed((): RateTimelineBucket[] => primaryMetrics.value?.timeline ?? []);
const recent429s = computed(() => primaryMetrics.value?.recent_429s ?? []);
const byMethod = computed((): Record<string, MethodStats> =>
  (primaryMetrics.value?.summary?.by_method as Record<string, MethodStats>) ?? {},
);
const hasData = computed(() => timeline.value.length > 0 || Object.keys(byMethod.value).length > 0);

const sortedMethods = computed(() => {
  const entries = Object.entries(byMethod.value);
  const key = sortKey.value;
  const dir = sortAsc.value ? 1 : -1;
  return entries.sort((a, b) => ((a[1][key] ?? 0) - (b[1][key] ?? 0)) * dir);
});

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms.toFixed(0)}ms`;
}

function cacheRatio(stats: MethodStats): string {
  if (stats.count === 0) return '—';
  return `${Math.round((stats.cached / stats.count) * 100)}%`;
}

// --- Timeline chart ---
const timelineOption = computed((): EChartsOption => {
  const data = timeline.value;
  if (data.length === 0) return {};

  const times = data.map((b) => formatTime(b.ts));
  const mark429Lines = recent429s.value.slice(0, 20).map((e) => ({
    xAxis: formatTime(e.ts),
    label: { show: false },
    lineStyle: { color: '#ef4444', type: 'dashed' as const, width: 1 },
  }));


  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter: (params: unknown) => {
        if (!Array.isArray(params) || params.length === 0) return '';
        const p = params as Array<{ axisValue: string; seriesName: string; value: number; color: string }>;
        let html = `<strong>${p[0].axisValue}</strong><br/>`;
        for (const s of p) {
          const isLatency = s.seriesName === t('rateMonitor.responseTime');
          const display = isLatency ? formatLatency(s.value) : s.value?.toFixed(0) ?? '0';
          html += `<span style="color:${s.color}">●</span> ${s.seriesName}: <strong>${display}</strong><br/>`;
        }
        return html;
      },
    },
    legend: {
      data: [t('rateMonitor.direct'), t('rateMonitor.cached'), t('rateMonitor.errors'), t('rateMonitor.responseTime')],
      top: 0,
      right: '5%',
      textStyle: { fontSize: 10 },
      selectedMode: true,
    },
    grid: [{ left: 45, right: 45, top: 28, bottom: 50 }],
    xAxis: {
      type: 'category',
      data: times,
      boundaryGap: false,
      axisLabel: { fontSize: 9, rotate: 0 },
      axisLine: { lineStyle: { color: '#334155' } },
    },
    yAxis: [
      {
        type: 'value',
        name: t('rateMonitor.requests'),
        nameTextStyle: { fontSize: 9 },
        splitLine: { lineStyle: { color: '#1e293b' } },
        axisLabel: { fontSize: 9 },
      },
      {
        type: 'value',
        name: 'ms',
        nameTextStyle: { fontSize: 9 },
        splitLine: { show: false },
        axisLabel: { fontSize: 9 },
      },
    ],
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      {
        type: 'slider', bottom: 4, height: 16, start: 0, end: 100,
        borderColor: '#334155', fillerColor: 'rgba(59, 130, 246, 0.15)', handleSize: '60%',
      },
    ],
    series: [
      {
        name: t('rateMonitor.direct'),
        type: 'line', stack: 'requests',
        areaStyle: { opacity: 0.35 }, lineStyle: { width: 1.5 }, symbol: 'none',
        data: data.map((b) => b.direct), color: '#3b82f6',
        markLine: mark429Lines.length > 0 ? { silent: true, symbol: 'none', data: mark429Lines } : undefined,
      },
      {
        name: t('rateMonitor.cached'),
        type: 'line', stack: 'requests',
        areaStyle: { opacity: 0.35 }, lineStyle: { width: 1.5 }, symbol: 'none',
        data: data.map((b) => b.cached), color: '#22c55e',
      },
      {
        name: t('rateMonitor.errors'),
        type: 'bar',
        data: data.map((b) => b.errors), color: '#ef4444', barMaxWidth: 5,
      },
      {
        name: t('rateMonitor.responseTime'),
        type: 'line', yAxisIndex: 1,
        lineStyle: { width: 1, type: 'dotted' }, symbol: 'none',
        data: data.map((b) => b.avg_latency_ms), color: '#f59e0b',
      },
    ],
  };
});

// --- Sankey chart ---
const sankeyOption = computed((): EChartsOption => {
  const allMetrics = Object.values(filteredMetrics.value);
  const methods = byMethod.value;
  if (Object.keys(methods).length === 0) return {};

  const directLabel = t('rateMonitor.direct');
  const cachedLabel = t('rateMonitor.cached');
  const errorsLabel = t('rateMonitor.errors');
  const exchangeColors = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#7c3aed'];

  interface SNode { name: string; itemStyle?: { color: string } }
  interface SLink { source: string; target: string; value: number; lineStyle?: { color: string; opacity: number } }

  const nodes: SNode[] = [];
  const links: SLink[] = [];
  const nameSet = new Set<string>();
  let totDirect = 0, totCached = 0, totErrors = 0;

  const perExchange: Record<string, Record<string, MethodStats>> = {};
  const pairlistMethods: Record<string, MethodStats> = {};
  const seenPL = new Set<string>();
  for (const m of allMetrics) {
    const ex = m.exchange ?? 'unknown';
    if (!perExchange[ex]) perExchange[ex] = {};
    for (const [method, stats] of Object.entries(m.summary?.by_method ?? {})) {
      const isPL = method.startsWith('pl:');
      const key = isPL ? method.slice(3) : method;
      if (isPL) {
        if (seenPL.has(method)) continue;
        seenPL.add(method);
        const existing = pairlistMethods[key];
        if (existing) {
          existing.count += stats.count;
          existing.cached += stats.cached;
          existing.direct += stats.direct;
          existing.errors += stats.errors;
        } else {
          pairlistMethods[key] = { ...stats };
        }
        continue;
      }
      const existing = perExchange[ex][key];
      if (existing) {
        existing.count += stats.count;
        existing.cached += stats.cached;
        existing.direct += stats.direct;
        existing.errors += stats.errors;
      } else {
        perExchange[ex][key] = { ...stats };
      }
    }
  }

  const exchangeNames = Object.keys(perExchange);
  for (let i = 0; i < exchangeNames.length; i++) {
    const ex = exchangeNames[i];
    const color = exchangeColors[i % exchangeColors.length];
    nodes.push({ name: ex, itemStyle: { color } });

    for (const [method, stats] of Object.entries(perExchange[ex])) {
      if (!nameSet.has(method)) {
        nameSet.add(method);
        nodes.push({ name: method, itemStyle: { color: '#94a3b8' } });
      }
      const total = stats.direct + stats.cached + stats.errors;
      if (total > 0) links.push({ source: ex, target: method, value: total, lineStyle: { color, opacity: 0.15 } });
      if (stats.direct > 0) { links.push({ source: method, target: directLabel, value: stats.direct, lineStyle: { color: '#3b82f6', opacity: 0.25 } }); totDirect += stats.direct; }
      if (stats.cached > 0) { links.push({ source: method, target: cachedLabel, value: stats.cached, lineStyle: { color: '#22c55e', opacity: 0.25 } }); totCached += stats.cached; }
      if (stats.errors > 0) { links.push({ source: method, target: errorsLabel, value: stats.errors, lineStyle: { color: '#ef4444', opacity: 0.25 } }); totErrors += stats.errors; }
    }
  }

  if (Object.keys(pairlistMethods).length > 0) {
    const plColor = '#06b6d4';
    nodes.push({ name: 'Pairlist', itemStyle: { color: plColor } });
    for (const [method, stats] of Object.entries(pairlistMethods)) {
      if (!nameSet.has(method)) {
        nameSet.add(method);
        nodes.push({ name: method, itemStyle: { color: '#94a3b8' } });
      }
      const total = stats.direct + stats.cached + stats.errors;
      if (total > 0) links.push({ source: 'Pairlist', target: method, value: total, lineStyle: { color: plColor, opacity: 0.15 } });
      if (stats.direct > 0) { links.push({ source: method, target: directLabel, value: stats.direct, lineStyle: { color: '#3b82f6', opacity: 0.25 } }); totDirect += stats.direct; }
      if (stats.cached > 0) { links.push({ source: method, target: cachedLabel, value: stats.cached, lineStyle: { color: '#22c55e', opacity: 0.25 } }); totCached += stats.cached; }
      if (stats.errors > 0) { links.push({ source: method, target: errorsLabel, value: stats.errors, lineStyle: { color: '#ef4444', opacity: 0.25 } }); totErrors += stats.errors; }
    }
  }
  if (totDirect > 0) nodes.push({ name: directLabel, itemStyle: { color: '#3b82f6' } });
  if (totCached > 0) nodes.push({ name: cachedLabel, itemStyle: { color: '#22c55e' } });
  if (totErrors > 0) nodes.push({ name: errorsLabel, itemStyle: { color: '#ef4444' } });
  if (links.length === 0) return {};

  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    tooltip: {
      trigger: 'item',
      triggerOn: 'mousemove',
      formatter: (params: unknown) => {
        const p = params as { dataType: string; name: string; data?: { source: string; target: string; value: number } };
        if (p.dataType === 'edge' && p.data)
          return `${p.data.source} → ${p.data.target}: <strong>${p.data.value}</strong>`;
        const stats = methods[p.name] ?? methods[`pl:${p.name}`];
        if (stats) {
          const pct = stats.count > 0 ? Math.round((stats.cached / stats.count) * 100) : 0;
          return [
            `<strong>${p.name}</strong>`,
            `Total: ${stats.count}`,
            `<span style="color:#22c55e">●</span> Cached: ${stats.cached} (${pct}%)`,
            `<span style="color:#ef4444">●</span> Errors: ${stats.errors}`,
            `Avg: ${formatLatency(stats.avg_latency_ms)} · P95: ${formatLatency(stats.p95_latency_ms)}`,
          ].join('<br/>');
        }
        return `<strong>${p.name}</strong>`;
      },
    },
    series: [{
      type: 'sankey', layout: 'none',
      emphasis: { focus: 'adjacency' },
      nodeAlign: 'justify', orient: 'horizontal',
      nodeWidth: 16, nodeGap: 8,
      left: 70, right: 70, top: 5, bottom: 5,
      label: { fontSize: 10, color: '#cbd5e1', overflow: 'break' },
      data: nodes, links,
    }],
  };
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Toolbar -->
    <div class="flex items-center gap-2 px-2 pt-1 pb-1 shrink-0">
      <!-- View mode toggle -->
      <div class="flex bg-surface-800 rounded p-0.5">
        <button
          v-for="mode in (['timeline', 'flow', 'table'] as ViewMode[])"
          :key="mode"
          class="text-[10px] px-2 py-0.5 rounded transition-colors capitalize"
          :class="viewMode === mode ? 'bg-indigo-500/20 text-indigo-300' : 'text-surface-500 hover:text-surface-300'"
          @click="viewMode = mode"
        >
          {{ mode === 'timeline' ? '📈' : mode === 'flow' ? '🔀' : '📊' }} {{ mode }}
        </button>
      </div>

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

      <!-- Summary stats in toolbar -->
      <div v-if="primaryMetrics?.summary" class="flex items-center gap-2 ml-auto text-[10px]">
        <span class="text-surface-400 font-mono">
          {{ primaryMetrics.summary.total }} {{ t('rateMonitor.req') }}
        </span>
        <span
          class="font-mono"
          :class="(primaryMetrics.summary.errors_429 ?? 0) > 0 ? 'text-red-400' : 'text-surface-500'"
        >
          {{ primaryMetrics.summary.errors_429 ?? 0 }} {{ t('rateMonitor.429s') }}
        </span>
        <span class="text-surface-400 font-mono">
          {{ formatLatency(primaryMetrics.summary.avg_latency_ms ?? 0) }}
        </span>
      </div>
    </div>

    <!-- Content area -->
    <div class="grow min-h-0">
      <!-- Timeline view -->
      <template v-if="viewMode === 'timeline'">
        <ECharts
          v-if="timeline.length > 0"
          :option="timelineOption"
          :theme="settingsStore.chartTheme"
          autoresize
        />
        <div v-else class="flex flex-col items-center justify-center h-full text-surface-500">
          <i-mdi-pulse class="w-8 h-8 mb-2" />
          <span class="text-sm">{{ t('rateMonitor.noTimeline') }}</span>
          <span class="text-xs">{{ t('rateMonitor.waitingActivity') }}</span>
        </div>
      </template>

      <!-- Flow (Sankey) view -->
      <template v-else-if="viewMode === 'flow'">
        <ECharts
          v-if="Object.keys(sankeyOption).length > 0"
          :option="sankeyOption"
          :theme="settingsStore.chartTheme"
          autoresize
        />
        <div v-else class="flex items-center justify-center h-full text-surface-500 text-sm">
          {{ t('rateMonitor.noFlowData') }}
        </div>
      </template>

      <!-- Table view -->
      <template v-else>
        <div v-if="sortedMethods.length > 0" class="h-full overflow-auto px-1">
          <table class="w-full text-xs">
            <thead>
              <tr class="text-surface-500 border-b border-surface-700 sticky top-0 bg-surface-900">
                <th class="text-left py-1 px-1 font-semibold">{{ t('rateMonitor.method') }}</th>
                <th class="text-right py-1 px-1 font-semibold cursor-pointer select-none" @click="toggleSort('count')">
                  # {{ sortIcon('count') }}
                </th>
                <th class="text-right py-1 px-1 font-semibold cursor-pointer select-none" @click="toggleSort('cached')">
                  cache {{ sortIcon('cached') }}
                </th>
                <th class="text-right py-1 px-1 font-semibold cursor-pointer select-none" @click="toggleSort('errors')">
                  err {{ sortIcon('errors') }}
                </th>
                <th class="text-right py-1 px-1 font-semibold cursor-pointer select-none" @click="toggleSort('avg_latency_ms')">
                  avg {{ sortIcon('avg_latency_ms') }}
                </th>
                <th class="text-right py-1 px-1 font-semibold cursor-pointer select-none" @click="toggleSort('p95_latency_ms')">
                  p95 {{ sortIcon('p95_latency_ms') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="[method, stats] in sortedMethods"
                :key="method"
                class="border-b border-surface-800/50 hover:bg-surface-800/40 transition-colors"
              >
                <td class="py-0.5 px-1 truncate max-w-[140px]" :title="method">
                  <span
                    v-if="method.startsWith('pl:')"
                    class="text-[8px] font-bold px-0.5 rounded mr-0.5 bg-blue-500/15 text-blue-400"
                  >PL</span>
                  {{ method.startsWith('pl:') ? method.slice(3) : method }}
                </td>
                <td class="text-right py-0.5 px-1 font-mono">{{ stats.count }}</td>
                <td class="text-right py-0.5 px-1 font-mono text-green-400">{{ cacheRatio(stats) }}</td>
                <td
                  class="text-right py-0.5 px-1 font-mono"
                  :class="stats.errors > 0 ? 'text-red-400' : 'text-surface-500'"
                >{{ stats.errors }}</td>
                <td class="text-right py-0.5 px-1 font-mono">{{ formatLatency(stats.avg_latency_ms) }}</td>
                <td
                  class="text-right py-0.5 px-1 font-mono"
                  :class="stats.p95_latency_ms > 500 ? 'text-amber-400' : ''"
                >{{ formatLatency(stats.p95_latency_ms) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="flex flex-col items-center justify-center h-full text-surface-500">
          <i-mdi-source-fork class="w-8 h-8 mb-2" />
          <span class="text-sm">{{ t('rateMonitor.noMethodData') }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.echarts {
  width: 100%;
  height: 100%;
  min-height: 150px;
}
</style>
