<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { GaugeChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import type { RateMetricsResponse } from '@/types';
import { useI18n } from 'vue-i18n';

use([GaugeChart, BarChart, CanvasRenderer, GridComponent, TooltipComponent]);

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
const selectedBotId = ref('');

const botOptions = computed(() => {
  const all = botStore.allRateMetrics;
  const opts = [{ text: `All (${Object.keys(all).length})`, value: '' }];
  for (const [id, m] of Object.entries(all)) {
    opts.push({ text: m.exchange ?? id, value: id });
  }
  return opts;
});

const primaryMetrics = computed((): RateMetricsResponse | null => {
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

const hasData = computed(() => !!primaryMetrics.value?.exchange);

const ftcache = computed(() => primaryMetrics.value?.ftcache_extended);
const ftpairlist = computed(() => primaryMetrics.value?.ftpairlist);
const exchangeLimit = computed(() => primaryMetrics.value?.exchange_rate_limit);
const summary = computed(() => primaryMetrics.value?.summary);

const cacheHitPct = computed(() => ftcache.value?.cache_hit_rate_pct ?? 0);
const pairlistHitPct = computed(() => ftpairlist.value?.hit_rate_pct ?? 0);

const totalRequests = computed(() => summary.value?.total ?? 0);
const cachedRequests = computed(() => summary.value?.cached ?? 0);
const directRequests = computed(() => summary.value?.direct ?? 0);
const maxReqPerMin = computed(() => exchangeLimit.value?.max_requests_per_min ?? 0);

const usagePct = computed(() => {
  if (!maxReqPerMin.value || !totalRequests.value) return 0;
  return Math.min(100, Math.round((directRequests.value / maxReqPerMin.value) * 100));
});

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

const ftcacheGauge = computed((): EChartsOption => {
  const pct = cacheHitPct.value;
  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    tooltip: {
      show: true,
      formatter: () => {
        const c = ftcache.value;
        if (!c) return '';
        return [
          `<strong>ftcache</strong>`,
          `<br/>${t('cacheHealth.hitRate')}: <strong>${pct}%</strong>`,
          `<br/>${t('cacheHealth.totalRequests')}: ${c.requests_total}`,
          `<br/>${t('cacheHealth.cacheHits')}: ${c.cache_hits}`,
          `<br/>${t('cacheHealth.cacheMisses')}: ${c.cache_misses}`,
          `<br/><br/><em>${t('cacheHealth.ftcacheExplain')}</em>`,
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
    tooltip: {
      show: true,
      formatter: () => {
        const p = ftpairlist.value;
        if (!p) return '';
        return [
          `<strong>ftpairlist</strong>`,
          `<br/>${t('cacheHealth.hitRate')}: <strong>${pct}%</strong>`,
          `<br/>${t('cacheHealth.gets')}: ${p.gets}`,
          `<br/>${t('cacheHealth.hits')}: ${p.hits}`,
          `<br/>${t('cacheHealth.puts')}: ${p.puts}`,
          `<br/>${t('cacheHealth.entries')}: ${p.entries}`,
          `<br/>${t('cacheHealth.clients')}: ${p.clients}`,
          `<br/><br/><em>${t('cacheHealth.ftpairlistExplain')}</em>`,
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
        data: [{ value: pct, name: 'ftpairlist' }],
      },
    ],
  };
});

const breakdownOption = computed((): EChartsOption => {
  const cached = cachedRequests.value;
  const direct = directRequests.value;
  const total = totalRequests.value;
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
        name: t('cacheHealth.cached'),
        type: 'bar',
        stack: 'total',
        data: [cached],
        color: '#22c55e',
        barWidth: 20,
        itemStyle: { borderRadius: [4, 0, 0, 4] },
      },
      {
        name: t('cacheHealth.directToExchange'),
        type: 'bar',
        stack: 'total',
        data: [direct],
        color: '#3b82f6',
        barWidth: 20,
        itemStyle: { borderRadius: [0, 4, 4, 0] },
      },
    ],
  };
});

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
  <div class="flex flex-col h-full p-2 gap-2 overflow-auto">
    <template v-if="hasData">
      <!-- Bot selector -->
      <div v-if="multiBotView && botOptions.length > 2" class="flex items-center gap-2">
        <Select
          v-model="selectedBotId"
          size="small"
          option-label="text"
          option-value="value"
          :options="botOptions"
          class="text-xs"
          style="min-width: 100px"
        />
      </div>

      <!-- Gauges row -->
      <div class="flex gap-2 justify-center">
        <div class="flex flex-col items-center" style="min-width: 100px">
          <ECharts
            :option="ftcacheGauge"
            :theme="settingsStore.chartTheme"
            autoresize
            style="width: 100px; height: 90px"
          />
        </div>
        <div v-if="ftpairlist" class="flex flex-col items-center" style="min-width: 100px">
          <ECharts
            :option="ftpairlistGauge"
            :theme="settingsStore.chartTheme"
            autoresize
            style="width: 100px; height: 90px"
          />
        </div>
      </div>

      <!-- Request breakdown bar -->
      <div>
        <span
          class="text-xs text-surface-500 cursor-help border-b border-dotted border-surface-600"
          :title="t('cacheHealth.breakdownDesc')"
        >
          {{ t('cacheHealth.breakdown') }}
        </span>
        <ECharts
          v-if="totalRequests > 0"
          :option="breakdownOption"
          :theme="settingsStore.chartTheme"
          autoresize
          style="width: 100%; height: 35px"
        />
        <div class="flex justify-between text-xs text-surface-500 mt-0.5">
          <span>
            <span class="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />
            {{ t('cacheHealth.cached') }}: {{ cachedRequests }}
          </span>
          <span>
            <span class="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1" />
            {{ t('cacheHealth.directToExchange') }}: {{ directRequests }}
          </span>
        </div>
      </div>

      <!-- Exchange capacity -->
      <div v-if="exchangeLimit" class="text-xs">
        <span
          class="text-surface-500 cursor-help border-b border-dotted border-surface-600"
          :title="t('cacheHealth.capacityDesc')"
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
            <span>{{ directRequests }} {{ t('rateMonitor.req') }}/{{ t('rateMonitor.window').toLowerCase() }}</span>
            <span>max {{ exchangeLimit.max_requests_per_min }} req/min</span>
          </div>
        </div>
      </div>

      <!-- Stats grid -->
      <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <div
          v-if="ftcache"
          class="flex items-center gap-1 cursor-help"
          :title="t('cacheHealth.ftcacheExplain')"
        >
          <i-mdi-database class="w-3.5 h-3.5 text-green-400" />
          <span class="text-surface-500">ftcache</span>
          <span class="font-semibold ml-auto">{{ ftcache.requests_total }} req</span>
        </div>
        <div
          v-if="ftpairlist"
          class="flex items-center gap-1 cursor-help"
          :title="t('cacheHealth.ftpairlistExplain')"
        >
          <i-mdi-format-list-bulleted class="w-3.5 h-3.5 text-purple-400" />
          <span class="text-surface-500">ftpairlist</span>
          <span class="font-semibold ml-auto">{{ ftpairlist.gets }} req</span>
        </div>
        <div
          v-if="ftpairlist"
          class="flex items-center gap-1 cursor-help"
          :title="t('cacheHealth.entriesDesc')"
        >
          <i-mdi-package-variant class="w-3.5 h-3.5 text-cyan-400" />
          <span class="text-surface-500">{{ t('cacheHealth.entries') }}</span>
          <span class="font-semibold ml-auto">{{ ftpairlist.entries }}</span>
        </div>
        <div
          v-if="ftpairlist"
          class="flex items-center gap-1 cursor-help"
          :title="t('cacheHealth.clientsDesc')"
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
</template>

<style scoped>
.echarts {
  width: 100%;
  height: 100%;
  min-height: 80px;
}
</style>
