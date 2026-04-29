<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { SankeyChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import type { MethodStats, RateMetricsResponse } from '@/types';
import { useI18n } from 'vue-i18n';

use([SankeyChart, CanvasRenderer, TooltipComponent]);

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    multiBotView?: boolean;
  }>(),
  { multiBotView: false },
);

const botStore = useBotStore();
const settingsStore = useSettingsStore();

const refreshInterval = ref<number | null>(null);
const sortKey = ref<'count' | 'cached' | 'errors' | 'avg_latency_ms' | 'p95_latency_ms'>('count');
const sortAsc = ref(false);
const showSankey = ref(true);

const windowOptions = [
  { text: '10 min', value: 600 },
  { text: '30 min', value: 1800 },
  { text: '1h', value: 3600 },
  { text: '6h', value: 21600 },
  { text: '24h', value: 86400 },
];
const selectedWindow = ref(3600);
const selectedBotId = ref('');

const botOptions = computed(() => {
  const all = botStore.allRateMetrics;
  const opts = [{ text: `All (${Object.keys(all).length})`, value: '' }];
  for (const [id, m] of Object.entries(all)) {
    opts.push({ text: m.exchange ?? id, value: id });
  }
  return opts;
});

function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms.toFixed(0)}ms`;
}

const metricsData = computed((): RateMetricsResponse | null => {
  if (props.multiBotView) {
    const all = botStore.allRateMetrics;
    if (selectedBotId.value && all[selectedBotId.value]) {
      return all[selectedBotId.value];
    }
    const entries = Object.values(all);
    return entries.length > 0 ? entries[0] : null;
  }
  const m = botStore.activeBot?.rateMetrics;
  return m?.exchange ? m : null;
});

const byMethod = computed((): Record<string, MethodStats> => {
  return (metricsData.value?.summary?.by_method as Record<string, MethodStats>) ?? {};
});

const hasData = computed(() => Object.keys(byMethod.value).length > 0);

const sortedMethods = computed(() => {
  const entries = Object.entries(byMethod.value);
  const key = sortKey.value;
  const dir = sortAsc.value ? 1 : -1;
  return entries.sort((a, b) => {
    const va = a[1][key] ?? 0;
    const vb = b[1][key] ?? 0;
    return (va - vb) * dir;
  });
});

function toggleSort(key: typeof sortKey.value) {
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value;
  } else {
    sortKey.value = key;
    sortAsc.value = false;
  }
}

function sortIcon(key: string): string {
  if (sortKey.value !== key) return '↕';
  return sortAsc.value ? '↑' : '↓';
}

const sankeyOption = computed((): EChartsOption => {
  const methods = byMethod.value;
  if (Object.keys(methods).length === 0) return {};

  const exchange = metricsData.value?.exchange ?? 'Exchange';

  interface SankeyNode {
    name: string;
    itemStyle?: { color: string };
  }
  interface SankeyLink {
    source: string;
    target: string;
    value: number;
    lineStyle?: { color: string; opacity: number };
  }

  const directLabel = t('rateMonitor.direct');
  const cachedLabel = t('rateMonitor.cached');
  const errorsLabel = t('rateMonitor.errors');

  const nodes: SankeyNode[] = [{ name: exchange, itemStyle: { color: '#6366f1' } }];
  const links: SankeyLink[] = [];
  const methodNames = new Set<string>();

  const outcomeNodes: Record<string, SankeyNode> = {
    [directLabel]: { name: directLabel, itemStyle: { color: '#3b82f6' } },
    [cachedLabel]: { name: cachedLabel, itemStyle: { color: '#22c55e' } },
    [errorsLabel]: { name: errorsLabel, itemStyle: { color: '#ef4444' } },
  };

  let totalDirect = 0;
  let totalCached = 0;
  let totalErrors = 0;

  for (const [method, stats] of Object.entries(methods)) {
    if (!methodNames.has(method)) {
      methodNames.add(method);
      nodes.push({ name: method, itemStyle: { color: '#94a3b8' } });
    }

    const total = stats.direct + stats.cached + stats.errors;
    if (total > 0) {
      links.push({
        source: exchange,
        target: method,
        value: total,
        lineStyle: { color: '#6366f1', opacity: 0.15 },
      });
    }

    if (stats.direct > 0) {
      links.push({
        source: method,
        target: directLabel,
        value: stats.direct,
        lineStyle: { color: '#3b82f6', opacity: 0.25 },
      });
      totalDirect += stats.direct;
    }
    if (stats.cached > 0) {
      links.push({
        source: method,
        target: cachedLabel,
        value: stats.cached,
        lineStyle: { color: '#22c55e', opacity: 0.25 },
      });
      totalCached += stats.cached;
    }
    if (stats.errors > 0) {
      links.push({
        source: method,
        target: errorsLabel,
        value: stats.errors,
        lineStyle: { color: '#ef4444', opacity: 0.25 },
      });
      totalErrors += stats.errors;
    }
  }

  if (totalDirect > 0) nodes.push(outcomeNodes[directLabel]);
  if (totalCached > 0) nodes.push(outcomeNodes[cachedLabel]);
  if (totalErrors > 0) nodes.push(outcomeNodes[errorsLabel]);

  if (links.length === 0) return {};

  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    tooltip: {
      trigger: 'item',
      triggerOn: 'mousemove',
      formatter: (params: unknown) => {
        const p = params as {
          dataType: string;
          name: string;
          value: number;
          data?: { source: string; target: string; value: number };
        };
        if (p.dataType === 'edge' && p.data) {
          return `${p.data.source} → ${p.data.target}: <strong>${p.data.value}</strong> ${t('rateMonitor.requests').toLowerCase()}`;
        }
        const stats = methods[p.name];
        if (stats) {
          const cachePct = stats.count > 0 ? Math.round((stats.cached / stats.count) * 100) : 0;
          const errPct = stats.count > 0 ? Math.round((stats.errors / stats.count) * 100) : 0;
          return [
            `<strong>${p.name}</strong>`,
            `Total: ${stats.count} ${t('rateMonitor.requests').toLowerCase()}`,
            `<span style="color:#3b82f6">●</span> Direct: ${stats.direct}`,
            `<span style="color:#22c55e">●</span> ${t('rateMonitor.cached')}: ${stats.cached} (${cachePct}%)`,
            `<span style="color:#ef4444">●</span> ${t('rateMonitor.errors')}: ${stats.errors} (${errPct}%)`,
            `${t('rateMonitor.avgResponse')}: ${formatLatency(stats.avg_latency_ms)}`,
            `${t('rateMonitor.p95Response')}: ${formatLatency(stats.p95_latency_ms)}`,
          ].join('<br/>');
        }
        return `<strong>${p.name}</strong>: ${p.value ?? ''} ${t('rateMonitor.requests').toLowerCase()}`;
      },
    },
    series: [
      {
        type: 'sankey',
        layout: 'none',
        emphasis: { focus: 'adjacency' },
        nodeAlign: 'justify',
        orient: 'horizontal',
        nodeWidth: 18,
        nodeGap: 10,
        left: 80,
        right: 80,
        top: 5,
        bottom: 5,
        label: {
          fontSize: 11,
          color: '#cbd5e1',
          overflow: 'break',
        },
        data: nodes,
        links,
      },
    ],
  };
});

function cacheRatio(stats: MethodStats): string {
  const total = stats.count;
  if (total === 0) return '—';
  return `${Math.round((stats.cached / total) * 100)}%`;
}

function fetchMetrics() {
  const bucketS = selectedWindow.value <= 1800 ? 10 : selectedWindow.value <= 7200 ? 30 : 60;
  if (props.multiBotView) {
    botStore.allBotStores.forEach((bot) => {
      if (bot.isBotOnline) {
        bot.getRateMetrics(selectedWindow.value, bucketS);
      }
    });
  } else {
    botStore.activeBot?.getRateMetrics(selectedWindow.value, bucketS);
  }
}

watch(selectedWindow, () => fetchMetrics());

onMounted(() => {
  fetchMetrics();
  refreshInterval.value = window.setInterval(fetchMetrics, 30000);
});

onUnmounted(() => {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value);
  }
});
</script>

<template>
  <div class="flex flex-col h-full overflow-auto">
    <template v-if="hasData">
      <!-- Toggle bar -->
      <div class="flex items-center gap-2 px-2 pt-1 pb-1">
        <button
          class="text-xs px-2 py-0.5 rounded transition-colors"
          :class="
            showSankey
              ? 'bg-indigo-500/20 text-indigo-300'
              : 'text-surface-500 hover:text-surface-300'
          "
          @click="showSankey = true"
        >
          {{ t('rateMonitor.flow') }}
        </button>
        <button
          class="text-xs px-2 py-0.5 rounded transition-colors"
          :class="
            !showSankey
              ? 'bg-indigo-500/20 text-indigo-300'
              : 'text-surface-500 hover:text-surface-300'
          "
          @click="showSankey = false"
        >
          {{ t('rateMonitor.table') }}
        </button>
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
          v-if="multiBotView && botOptions.length > 2"
          v-model="selectedBotId"
          size="small"
          option-label="text"
          option-value="value"
          :options="botOptions"
          class="text-xs"
          style="min-width: 100px"
        />
        <span class="text-xs text-surface-500 ml-auto">
          {{ t('rateMonitor.methods', { count: Object.keys(byMethod).length }) }}
        </span>
      </div>

      <!-- Sankey diagram -->
      <div v-if="showSankey" class="grow min-h-0" style="min-height: 160px">
        <ECharts
          v-if="Object.keys(sankeyOption).length > 0"
          :option="sankeyOption"
          :theme="settingsStore.chartTheme"
          autoresize
        />
        <div v-else class="flex items-center justify-center h-full text-surface-500 text-sm">
          {{ t('rateMonitor.noFlowData') }}
        </div>
      </div>

      <!-- Method table -->
      <div v-if="!showSankey" class="grow overflow-auto px-1">
        <table class="w-full text-xs">
          <thead>
            <tr class="text-surface-500 border-b border-surface-700">
              <th class="text-left py-1 px-1 font-semibold">{{ t('rateMonitor.method') }}</th>
              <th
                class="text-right py-1 px-1 font-semibold cursor-pointer select-none"
                @click="toggleSort('count')"
              >
                {{ t('rateMonitor.count') }} {{ sortIcon('count') }}
              </th>
              <th
                class="text-right py-1 px-1 font-semibold cursor-pointer select-none"
                @click="toggleSort('cached')"
              >
                {{ t('rateMonitor.cached') }} {{ sortIcon('cached') }}
              </th>
              <th
                class="text-right py-1 px-1 font-semibold cursor-pointer select-none"
                @click="toggleSort('errors')"
              >
                {{ t('rateMonitor.errors') }} {{ sortIcon('errors') }}
              </th>
              <th
                class="text-right py-1 px-1 font-semibold cursor-pointer select-none"
                :title="t('rateMonitor.avgResponseDesc')"
                @click="toggleSort('avg_latency_ms')"
              >
                {{ t('rateMonitor.avgResponse') }} {{ sortIcon('avg_latency_ms') }}
              </th>
              <th
                class="text-right py-1 px-1 font-semibold cursor-pointer select-none"
                :title="t('rateMonitor.p95ResponseDesc')"
                @click="toggleSort('p95_latency_ms')"
              >
                {{ t('rateMonitor.p95Response') }} {{ sortIcon('p95_latency_ms') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="[method, stats] in sortedMethods"
              :key="method"
              class="border-b border-surface-800 hover:bg-surface-800/50"
            >
              <td class="py-1 px-1 truncate max-w-[140px]" :title="method">
                {{ method }}
              </td>
              <td class="text-right py-1 px-1 font-mono">{{ stats.count }}</td>
              <td class="text-right py-1 px-1 font-mono text-green-400">
                {{ cacheRatio(stats) }}
              </td>
              <td
                class="text-right py-1 px-1 font-mono"
                :class="stats.errors > 0 ? 'text-red-400' : 'text-surface-500'"
              >
                {{ stats.errors }}
              </td>
              <td class="text-right py-1 px-1 font-mono">
                {{ formatLatency(stats.avg_latency_ms) }}
              </td>
              <td
                class="text-right py-1 px-1 font-mono"
                :class="stats.p95_latency_ms > 500 ? 'text-amber-400' : ''"
              >
                {{ formatLatency(stats.p95_latency_ms) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Empty state -->
    <div v-else class="flex flex-col items-center justify-center h-full text-surface-500">
      <i-mdi-source-fork class="w-8 h-8 mb-2" />
      <span class="text-sm">{{ t('rateMonitor.noMethodData') }}</span>
      <span class="text-xs">{{ t('rateMonitor.waitingActivity') }}</span>
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
