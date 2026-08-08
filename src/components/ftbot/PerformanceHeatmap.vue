<script setup lang="ts">
import type { EChartsOption } from 'echarts';
import ECharts from 'vue-echarts';

import { HeatmapChart } from 'echarts/charts';
import {
  CalendarComponent,
  DatasetComponent,
  GridComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

import type { ClosedTrade } from '@/types';
import { useI18n } from 'vue-i18n';
import { useSummaryCurrency } from '@/composables/summaryCurrency';

use([
  HeatmapChart,
  CanvasRenderer,
  CalendarComponent,
  DatasetComponent,
  GridComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
]);

const { t } = useI18n();
const settingsStore = useSettingsStore();
const colorStore = useColorStore();
const { summaryCurrency } = useSummaryCurrency();

const props = withDefaults(
  defineProps<{
    trades: ClosedTrade[];
    showTitle?: boolean;
  }>(),
  {
    showTitle: false,
  },
);

// Timeframe filter
type HeatmapTimeframe = 'day' | 'week' | 'month';
const selectedTimeframe = ref<HeatmapTimeframe>('day');

const currencyUnit = computed(() => {
  if (summaryCurrency.value && summaryCurrency.value !== 'auto') {
    return summaryCurrency.value;
  }
  return 'USD';
});

// Compute lookback days based on timeframe
const lookbackDays = computed(() => {
  switch (selectedTimeframe.value) {
    case 'week':
      return 90; // ~13 weeks
    case 'month':
      return 365; // ~12 months
    default:
      return 30;
  }
});

// Group key function based on timeframe
function groupKey(timestamp: number): string {
  const d = new Date(timestamp);
  switch (selectedTimeframe.value) {
    case 'week': {
      // ISO week: get Monday of that week
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setDate(diff);
      return monday.toISOString().slice(0, 10);
    }
    case 'month':
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    default:
      return d.toISOString().slice(0, 10);
  }
}

// Build profit data
const dailyProfitData = computed(() => {
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - lookbackDays.value);
  startDate.setHours(0, 0, 0, 0);

  // Init map
  const dayMap: Record<string, number> = {};
  if (selectedTimeframe.value === 'day') {
    for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 1)) {
      dayMap[d.toISOString().slice(0, 10)] = 0;
    }
  } else if (selectedTimeframe.value === 'week') {
    for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 7)) {
      dayMap[groupKey(d.getTime())] = 0;
    }
  } else {
    for (let d = new Date(startDate); d <= now; d.setMonth(d.getMonth() + 1)) {
      dayMap[groupKey(d.getTime())] = 0;
    }
  }

  // Sum profits
  for (const trade of props.trades) {
    if (trade.close_timestamp < startDate.getTime()) continue;
    const key = groupKey(trade.close_timestamp);
    if (key in dayMap) {
      dayMap[key] = (dayMap[key] ?? 0) + (trade.profit_abs ?? 0);
    }
  }

  return Object.entries(dayMap)
    .map(([date, profit]) => [date, profit])
    .sort((a, b) => (a[0] as string).localeCompare(b[0] as string));
});

const chartOptions = computed<EChartsOption>(() => {
  const { colorProfit, colorLoss } = colorStore;
  const data = dailyProfitData.value;

  if (data.length === 0) return {};

  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - lookbackDays.value);

  const profits = data.map((d) => d[1] as number);
  const maxVal = Math.max(...profits.map(Math.abs), 1);

  return {
    animation: false,
    backgroundColor: 'rgba(0, 0, 0, 0)',
    tooltip: {
      backgroundColor: 'rgba(20, 20, 30, 0.92)',
      borderColor: 'rgba(255,255,255,0.08)',
      textStyle: { color: '#e0e0e0', fontSize: 12 },
      formatter: (params: any) => {
        const val = params.value;
        if (!val) return '';
        const profit = val[1] as number;
        const color = profit >= 0 ? colorProfit : colorLoss;
        const unit = currencyUnit.value;
        return `<div style="font-weight:600">${val[0]}</div>
          <div style="color:${color};font-weight:600">${formatPrice(profit, 2)} ${unit}</div>`;
      },
    },
    visualMap: {
      min: -maxVal,
      max: maxVal,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 12,
      itemHeight: 80,
      textStyle: { color: settingsStore.chartTheme === 'dark' ? '#ccc' : '#333', fontSize: 10 },
      inRange: {
        color: [colorLoss, '#1a1a2e', colorProfit],
      },
      show: false,
    },
    calendar: {
      top: 30,
      left: 30,
      right: 10,
      bottom: 10,
      cellSize: ['auto', 'auto'],
      range: [startDate.toISOString().slice(0, 10), now.toISOString().slice(0, 10)],
      itemStyle: {
        borderWidth: 2,
        borderColor: settingsStore.chartTheme === 'dark' ? '#1e1e2e' : '#f0f0f0',
      },
      splitLine: {
        lineStyle: {
          color: settingsStore.chartTheme === 'dark' ? '#333' : '#ccc',
        },
      },
      yearLabel: { show: false },
      dayLabel: {
        nameMap: 'en',
        fontSize: 10,
        color: settingsStore.chartTheme === 'dark' ? '#999' : '#666',
      },
      monthLabel: {
        nameMap: 'en',
        fontSize: 10,
        color: settingsStore.chartTheme === 'dark' ? '#999' : '#666',
      },
    },
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: data,
        label: { show: false },
        itemStyle: {
          borderRadius: 3,
        },
      },
    ],
  } as EChartsOption;
});
</script>

<template>
  <div class="performance-heatmap flex flex-col h-full">
    <!-- Timeframe pills -->
    <div class="flex items-center gap-1 px-2 py-1">
      <button
        v-for="tf in ['day', 'week', 'month'] as HeatmapTimeframe[]"
        :key="tf"
        class="px-2 py-0.5 rounded-full text-[11px] font-medium transition-all"
        :class="
          selectedTimeframe === tf
            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
            : 'text-surface-400 hover:text-surface-200 border border-transparent hover:border-surface-600'
        "
        @click="selectedTimeframe = tf"
      >
        {{ t(`performanceHeatmap.tf_${tf}`) }}
      </button>
    </div>
    <div class="flex-1 min-h-0">
      <ECharts
        v-if="trades && trades.length > 0"
        :option="chartOptions"
        :theme="settingsStore.chartTheme"
        autoresize
      />
      <div v-else class="flex items-center justify-center h-full text-surface-400 text-sm">
        {{ t('performanceHeatmap.noData') }}
      </div>
    </div>

    <!-- Legend bar -->
    <div
      class="flex items-center justify-between px-3 py-1.5 text-xs rounded-lg"
      style="
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        backdrop-filter: blur(12px);
      "
    >
      <span class="text-red-400">{{ t('performanceHeatmap.loss') }}</span>
      <div class="flex gap-1 items-center">
        <div class="w-3 h-3 rounded-sm bg-red-500/70"></div>
        <div class="w-3 h-3 rounded-sm bg-red-500/30"></div>
        <div class="w-3 h-3 rounded-sm" style="background: #1a1a2e"></div>
        <div class="w-3 h-3 rounded-sm bg-green-500/30"></div>
        <div class="w-3 h-3 rounded-sm bg-green-500/70"></div>
      </div>
      <span class="text-green-400">{{ t('performanceHeatmap.profit') }}</span>
    </div>
  </div>
</template>

<style scoped>
.performance-heatmap {
  width: 100%;
  height: 100%;
}

.echarts {
  width: 100%;
  height: 100%;
  min-height: 120px;
}
</style>
