<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { SankeyChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import type { MethodStats, RateMetricsResponse } from '@/types';

use([SankeyChart, CanvasRenderer, TooltipComponent]);

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

const metricsData = computed((): RateMetricsResponse | null => {
  if (props.multiBotView) {
    const all = botStore.allRateMetrics;
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

  const nodes: SankeyNode[] = [{ name: exchange, itemStyle: { color: '#6366f1' } }];
  const links: SankeyLink[] = [];
  const methodNames = new Set<string>();

  const outcomeNodes: Record<string, SankeyNode> = {
    Direct: { name: 'Direct', itemStyle: { color: '#3b82f6' } },
    Cached: { name: 'Cached', itemStyle: { color: '#22c55e' } },
    Errors: { name: 'Errors', itemStyle: { color: '#ef4444' } },
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
        target: 'Direct',
        value: stats.direct,
        lineStyle: { color: '#3b82f6', opacity: 0.25 },
      });
      totalDirect += stats.direct;
    }
    if (stats.cached > 0) {
      links.push({
        source: method,
        target: 'Cached',
        value: stats.cached,
        lineStyle: { color: '#22c55e', opacity: 0.25 },
      });
      totalCached += stats.cached;
    }
    if (stats.errors > 0) {
      links.push({
        source: method,
        target: 'Errors',
        value: stats.errors,
        lineStyle: { color: '#ef4444', opacity: 0.25 },
      });
      totalErrors += stats.errors;
    }
  }

  if (totalDirect > 0) nodes.push(outcomeNodes['Direct']);
  if (totalCached > 0) nodes.push(outcomeNodes['Cached']);
  if (totalErrors > 0) nodes.push(outcomeNodes['Errors']);

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
          return `${p.data.source} → ${p.data.target}: <strong>${p.data.value}</strong>`;
        }
        return `<strong>${p.name}</strong>: ${p.value ?? ''}`;
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
        left: 10,
        right: 10,
        top: 5,
        bottom: 5,
        label: {
          fontSize: 10,
          color: '#cbd5e1',
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
  if (props.multiBotView) {
    botStore.allGetRateMetrics();
  } else {
    botStore.activeBot?.getRateMetrics();
  }
}

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
          Flow
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
          Table
        </button>
        <span class="text-xs text-surface-500 ml-auto">
          {{ Object.keys(byMethod).length }} methods
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
          Not enough data for flow diagram
        </div>
      </div>

      <!-- Method table -->
      <div v-if="!showSankey" class="grow overflow-auto px-1">
        <table class="w-full text-xs">
          <thead>
            <tr class="text-surface-500 border-b border-surface-700">
              <th class="text-left py-1 px-1 font-semibold">Method</th>
              <th
                class="text-right py-1 px-1 font-semibold cursor-pointer select-none"
                @click="toggleSort('count')"
              >
                Count {{ sortIcon('count') }}
              </th>
              <th
                class="text-right py-1 px-1 font-semibold cursor-pointer select-none"
                @click="toggleSort('cached')"
              >
                Cache {{ sortIcon('cached') }}
              </th>
              <th
                class="text-right py-1 px-1 font-semibold cursor-pointer select-none"
                @click="toggleSort('errors')"
              >
                Err {{ sortIcon('errors') }}
              </th>
              <th
                class="text-right py-1 px-1 font-semibold cursor-pointer select-none"
                @click="toggleSort('avg_latency_ms')"
              >
                Avg ms {{ sortIcon('avg_latency_ms') }}
              </th>
              <th
                class="text-right py-1 px-1 font-semibold cursor-pointer select-none"
                @click="toggleSort('p95_latency_ms')"
              >
                P95 ms {{ sortIcon('p95_latency_ms') }}
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
                {{ stats.avg_latency_ms.toFixed(0) }}
              </td>
              <td
                class="text-right py-1 px-1 font-mono"
                :class="stats.p95_latency_ms > 500 ? 'text-amber-400' : ''"
              >
                {{ stats.p95_latency_ms.toFixed(0) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Empty state -->
    <div v-else class="flex flex-col items-center justify-center h-full text-surface-500">
      <i-mdi-source-fork class="w-8 h-8 mb-2" />
      <span class="text-sm">No method data available</span>
      <span class="text-xs">Waiting for API activity</span>
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
