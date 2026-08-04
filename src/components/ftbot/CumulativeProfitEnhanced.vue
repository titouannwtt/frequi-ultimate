<script setup lang="ts">
import type { EChartsOption } from 'echarts';
import ECharts from 'vue-echarts';

import { BarChart, LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

import type { ClosedTrade, Trade } from '@/types';
import type { ComputedRefWithControl } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { useSummaryCurrency } from '@/composables/summaryCurrency';

use([
  BarChart,
  LineChart,
  CanvasRenderer,
  DatasetComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TitleComponent,
  TooltipComponent,
]);

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    trades: ClosedTrade[];
    openTrades?: Trade[];
    showTitle?: boolean;
    profitColumn?: string;
  }>(),
  {
    openTrades: () => [],
    showTitle: true,
    profitColumn: 'profit_abs',
  },
);

const settingsStore = useSettingsStore();
const colorStore = useColorStore();
const botStore = useBotStore();
const { summaryCurrency } = useSummaryCurrency();

const currencyLabel = computed(() => {
  if (summaryCurrency.value && summaryCurrency.value !== 'auto') {
    return ` (${summaryCurrency.value})`;
  }
  return '';
});

const chart = ref<InstanceType<typeof ECharts>>();

// --- State ---
type TabKey = 'profit' | 'profitBalance' | 'perBot' | 'proportion';
const activeTab = ref<TabKey>('profit');
type TimeframeKey = '1D' | '7D' | '30D' | '90D' | 'YTD' | 'ALL';
const selectedTimeframe = ref<TimeframeKey>('ALL');

const tabs: { key: TabKey; labelKey: string }[] = [
  { key: 'profit', labelKey: 'cumProfit.tabProfit' },
  { key: 'profitBalance', labelKey: 'cumProfit.tabProfitBalance' },
  { key: 'perBot', labelKey: 'cumProfit.tabPerBot' },
  { key: 'proportion', labelKey: 'cumProfit.tabProportion' },
];

const timeframes: TimeframeKey[] = ['1D', '7D', '30D', '90D', 'YTD', 'ALL'];

// Bot color palette (distinct, accessible on dark backgrounds)
const BOT_COLORS = [
  '#5470c6',
  '#91cc75',
  '#fac858',
  '#ee6666',
  '#73c0de',
  '#3ba272',
  '#fc8452',
  '#9a60b4',
  '#ea7ccc',
  '#4dc9f6',
];

function botColor(index: number): string {
  return BOT_COLORS[index % BOT_COLORS.length]!;
}

// --- Timeframe filtering ---
function getTimeframeCutoff(tf: TimeframeKey): number {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  switch (tf) {
    case '1D':
      return now - 1 * day;
    case '7D':
      return now - 7 * day;
    case '30D':
      return now - 30 * day;
    case '90D':
      return now - 90 * day;
    case 'YTD': {
      const y = new Date();
      y.setMonth(0, 1);
      y.setHours(0, 0, 0, 0);
      return y.getTime();
    }
    case 'ALL':
    default:
      return 0;
  }
}

const filteredTrades = computed<ClosedTrade[]>(() => {
  const cutoff = getTimeframeCutoff(selectedTimeframe.value);
  if (cutoff === 0) return props.trades;
  return props.trades.filter((t) => t.close_timestamp >= cutoff);
});

const sortedTrades = computed<ClosedTrade[]>(() => {
  return filteredTrades.value.slice().sort((a, b) => a.close_timestamp - b.close_timestamp);
});

// --- Bot IDs present in data ---
const botIds = computed<string[]>(() => {
  const ids = new Set<string>();
  for (const t of sortedTrades.value) {
    if (t.botId) ids.add(t.botId);
  }
  return Array.from(ids);
});

function getBotName(botId: string): string {
  const desc = botStore.availableBots[botId];
  return desc?.botName ?? botId;
}

// --- Cumulative profit (total) ---
interface CumPoint {
  date: number;
  profit: number;
  [key: string]: number; // per-bot profits
}

const cumulativeTotal = computed<CumPoint[]>(() => {
  const points: CumPoint[] = [];
  let cum = 0;
  let hwm = 0;
  const botCum: Record<string, number> = {};
  for (const id of botIds.value) botCum[id] = 0;

  for (const trade of sortedTrades.value) {
    const p = trade[props.profitColumn] ?? 0;
    cum += p;
    if (cum > hwm) hwm = cum;
    if (trade.botId) {
      botCum[trade.botId] = (botCum[trade.botId] ?? 0) + p;
    }
    const point: CumPoint = { date: trade.close_timestamp, profit: cum, hwm };
    for (const id of botIds.value) {
      point[id] = botCum[id] ?? 0;
    }
    points.push(point);
  }
  return points;
});

// --- Proportion data (stacked % area) ---
const proportionData = computed(() => {
  return cumulativeTotal.value.map((pt) => {
    const total = Math.abs(pt.profit) || 1;
    const row: Record<string, number> = { date: pt.date };
    for (const id of botIds.value) {
      row[id] = ((pt[id] ?? 0) / total) * 100;
    }
    return row;
  });
});

// --- Statistics ---
const stats = computed(() => {
  const pts = cumulativeTotal.value;
  if (!pts || pts.length === 0)
    return {
      totalProfit: 0,
      peakProfit: 0,
      maxDrawdown: 0,
      recoveryPct: 0,
      bestBot: '-',
    };

  let peak = 0;
  let maxDd = 0;
  let totalProfit = 0;

  for (const p of pts) {
    const profit = typeof p.profit === 'number' ? p.profit : 0;
    if (profit > peak) peak = profit;
    const dd = peak - profit;
    if (dd > maxDd) maxDd = dd;
    totalProfit = profit;
  }

  const recoveryPct = peak > 0 ? (totalProfit / peak) * 100 : 0;

  // Best bot in period
  let bestBot = '-';
  let bestProfit = -Infinity;
  const lastPt = pts[pts.length - 1];
  if (lastPt) {
    for (const id of botIds.value) {
      const bp = typeof lastPt[id] === 'number' ? (lastPt[id] as number) : 0;
      if (bp > bestProfit) {
        bestProfit = bp;
        bestBot = getBotName(id);
      }
    }
  }
  if (bestProfit === -Infinity) bestBot = '-';

  return {
    totalProfit,
    peakProfit: peak,
    maxDrawdown: maxDd,
    recoveryPct: isFinite(recoveryPct) ? recoveryPct : 0,
    bestBot,
  };
});

// --- Open trades profit line ---
const openProfit = computed<number>(() => {
  return props.openTrades.reduce(
    (a, v) => a + (v['total_profit_abs'] ?? v[props.profitColumn] ?? 0),
    0,
  );
});

// --- Chart options ---
function buildProfitTab(initial: boolean): EChartsOption {
  const { colorProfit, colorLoss } = colorStore;
  const data = cumulativeTotal.value.slice();

  // Add open trades projection
  const openData: { date: number; currentProfit?: number }[] = [];
  if (props.openTrades.length > 0 && data.length > 0) {
    const last = data[data.length - 1]!;
    openData.push({ date: last.date, currentProfit: last.profit });
    openData.push({
      date: Date.now() + 24 * 60 * 60 * 1000,
      currentProfit: last.profit + openProfit.value,
    });
  }

  const combinedData = data.map((d) => ({
    date: d.date,
    profit: d.profit,
    hwm: d.hwm as number | undefined,
    currentProfit: undefined as number | undefined,
  }));
  for (const o of openData) {
    combinedData.push({
      date: o.date,
      profit: undefined as unknown as number,
      hwm: undefined,
      currentProfit: o.currentProfit,
    });
  }

  return {
    dataset: {
      dimensions: ['date', 'profit', 'hwm', 'currentProfit'],
      source: combinedData,
    },
    series: [
      {
        type: 'line',
        name: 'currentProfit',
        animation: initial,
        lineStyle: { color: openProfit.value > 0 ? colorProfit : colorLoss, type: 'dotted' },
        itemStyle: { color: openProfit.value > 0 ? colorProfit : colorLoss },
        encode: { x: 'date', y: 'currentProfit' },
      },
      {
        type: 'line',
        name: t('cumProfit.highWaterMark'),
        animation: initial,
        step: 'end',
        lineStyle: { color: '#5470c6', type: 'dashed', width: 1.5 },
        itemStyle: { color: '#5470c6' },
        symbol: 'none',
        encode: { x: 'date', y: 'hwm' },
      },
      {
        type: 'line',
        name: t('cumProfit.profit'),
        animation: initial,
        step: 'end',
        lineStyle: { color: settingsStore.chartTheme === 'dark' ? '#c2c2c2' : '#333' },
        itemStyle: { color: settingsStore.chartTheme === 'dark' ? '#c2c2c2' : '#333' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: colorProfit + '40' },
              { offset: 1, color: colorLoss + '10' },
            ],
          },
        },
        encode: { x: 'date', y: 'profit' },
      },
    ],
  };
}

function buildProfitBalanceTab(initial: boolean): EChartsOption {
  const { colorProfit } = colorStore;
  const data = cumulativeTotal.value.slice();

  // Simple balance simulation: assume starting balance + cumulative profit
  // We use cumulative profit line + a "balance" line that is base + profit
  // Since we don't have real balance data per timestamp, we estimate from the profit curve
  const balanceBase = 1000; // placeholder base
  const source = data.map((d) => ({
    date: d.date,
    profit: d.profit,
    balance: balanceBase + d.profit,
  }));

  return {
    dataset: {
      dimensions: ['date', 'profit', 'balance'],
      source,
    },
    legend: {
      data: [t('cumProfit.profit'), t('cumProfit.balance')],
      right: '5%',
      top: 0,
      textStyle: { color: settingsStore.chartTheme === 'dark' ? '#ccc' : '#333' },
    },
    yAxis: [
      {
        type: 'value',
        name: t('cumProfit.profit'),
        splitLine: { show: false },
        nameRotate: 90,
        nameLocation: 'middle',
        nameGap: 40,
      },
      {
        type: 'value',
        name: t('cumProfit.balance'),
        splitLine: { show: false },
        nameRotate: -90,
        nameLocation: 'middle',
        nameGap: 50,
      },
    ],
    series: [
      {
        type: 'line',
        name: t('cumProfit.profit'),
        animation: initial,
        step: 'end',
        lineStyle: { color: colorProfit },
        itemStyle: { color: colorProfit },
        areaStyle: { color: colorProfit + '20' },
        encode: { x: 'date', y: 'profit' },
        yAxisIndex: 0,
      },
      {
        type: 'line',
        name: t('cumProfit.balance'),
        animation: initial,
        lineStyle: { color: '#5470c6', width: 2 },
        itemStyle: { color: '#5470c6' },
        encode: { x: 'date', y: 'balance' },
        yAxisIndex: 1,
      },
    ],
  };
}

function buildPerBotTab(initial: boolean): EChartsOption {
  const data = cumulativeTotal.value;
  const dims = ['date', ...botIds.value];
  const series = botIds.value.map((id, idx) => ({
    type: 'line' as const,
    name: getBotName(id),
    animation: initial,
    step: 'end' as const,
    lineStyle: { color: botColor(idx), width: 2 },
    itemStyle: { color: botColor(idx) },
    encode: { x: 'date', y: id },
  }));

  return {
    dataset: { dimensions: dims, source: data },
    legend: {
      data: botIds.value.map((id) => getBotName(id)),
      right: '5%',
      top: 0,
      textStyle: { color: settingsStore.chartTheme === 'dark' ? '#ccc' : '#333' },
    },
    series,
  };
}

function buildProportionTab(initial: boolean): EChartsOption {
  const data = proportionData.value;
  const dims = ['date', ...botIds.value];
  const series = botIds.value.map((id, idx) => ({
    type: 'line' as const,
    name: getBotName(id),
    animation: initial,
    stack: 'proportion',
    areaStyle: { color: botColor(idx) + 'AA' },
    lineStyle: { color: botColor(idx), width: 1 },
    itemStyle: { color: botColor(idx) },
    encode: { x: 'date', y: id },
  }));

  return {
    dataset: { dimensions: dims, source: data },
    legend: {
      data: botIds.value.map((id) => getBotName(id)),
      right: '5%',
      top: 0,
      textStyle: { color: settingsStore.chartTheme === 'dark' ? '#ccc' : '#333' },
    },
    yAxis: [
      {
        type: 'value',
        name: '%',
        max: 100,
        min: -100,
        splitLine: { show: false },
        nameRotate: 90,
        nameLocation: 'middle',
        nameGap: 30,
      },
    ],
    series,
  };
}

function buildTabOptions(initial: boolean): EChartsOption {
  switch (activeTab.value) {
    case 'profitBalance':
      return buildProfitBalanceTab(initial);
    case 'perBot':
      return buildPerBotTab(initial);
    case 'proportion':
      return buildProportionTab(initial);
    case 'profit':
    default:
      return buildProfitTab(initial);
  }
}

const chartOptions: ComputedRefWithControl<EChartsOption> = computedWithControl(
  () => [props.trades, activeTab.value, selectedTimeframe.value, summaryCurrency.value],
  () => {
    const tabOpts = buildTabOptions(false);

    const baseOpts: EChartsOption = {
      title: {
        text: props.showTitle ? t('cumProfit.title') : '',
        left: 'center',
        show: props.showTitle,
        textStyle: { color: settingsStore.chartTheme === 'dark' ? '#eee' : '#333' },
      },
      backgroundColor: 'rgba(0, 0, 0, 0)',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 20, 30, 0.92)',
        borderColor: 'rgba(255,255,255,0.08)',
        textStyle: { color: '#e0e0e0', fontSize: 12 },
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const dateStr = timestampToDateString(params[0].data?.date ?? params[0].axisValue);
          let html = `<div style="font-weight:600;margin-bottom:4px">${dateStr}</div>`;
          for (const p of params) {
            if (p.value === undefined || p.value === null) continue;
            const dim = p.dimensionNames?.[p.encode?.y?.[0]] ?? p.seriesName;
            const val =
              dim === '%' || activeTab.value === 'proportion'
                ? `${formatPrice(p.value[p.encode?.y?.[0]], 1)}%`
                : formatPrice(p.value[p.encode?.y?.[0]], 3);
            html += `<div>${p.marker} ${p.seriesName}: <b>${val}</b></div>`;
          }
          return html;
        },
        axisPointer: {
          type: 'cross',
          label: { backgroundColor: '#6a7985' },
        },
      },
      legend: tabOpts.legend ?? {
        data: [t('cumProfit.profit')],
        right: '5%',
        top: 0,
        textStyle: { color: settingsStore.chartTheme === 'dark' ? '#ccc' : '#333' },
        selectedMode: false,
      },
      useUTC: false,
      xAxis: { type: 'time' },
      yAxis: tabOpts.yAxis ?? [
        {
          type: 'value',
          name: t('cumProfit.profit') + currencyLabel.value,
          splitLine: { show: false },
          nameRotate: 90,
          nameLocation: 'middle',
          nameGap: 40,
        },
      ],
      grid: { ...echartsGridDefault },
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        { bottom: 10, start: 0, end: 100, ...dataZoomPartial },
      ],
      dataset: tabOpts.dataset,
      series: tabOpts.series,
    };

    return baseOpts;
  },
);

watchThrottled(
  () => props.openTrades,
  () => chartOptions.trigger(),
  { throttle: 60 * 1000 },
);
watch(
  () => settingsStore.chartTheme,
  () => chartOptions.trigger(),
);
watch(
  () => activeTab.value,
  () => chartOptions.trigger(),
);
watch(
  () => selectedTimeframe.value,
  () => chartOptions.trigger(),
);
</script>

<template>
  <div class="cum-profit-enhanced flex flex-col h-full">
    <!-- Controls bar -->
    <div class="flex flex-wrap items-center gap-2 px-2 pt-1 pb-1">
      <!-- Tabs as pills -->
      <div
        class="flex rounded-lg overflow-hidden"
        style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.06)"
      >
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="px-3 py-1 text-xs font-medium transition-all duration-200 cursor-pointer"
          :class="
            activeTab === tab.key
              ? 'bg-primary text-white shadow-sm'
              : 'text-surface-400 hover:text-surface-200 hover:bg-surface-700/50'
          "
          style="border: none; outline: none"
          @click="activeTab = tab.key"
        >
          {{ t(tab.labelKey) }}
        </button>
      </div>

      <!-- Timeframe selector -->
      <div
        class="flex rounded-lg overflow-hidden ml-auto"
        style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.06)"
      >
        <button
          v-for="tf in timeframes"
          :key="tf"
          class="px-2 py-1 text-xs font-medium transition-all duration-200 cursor-pointer"
          :class="
            selectedTimeframe === tf
              ? 'bg-primary text-white shadow-sm'
              : 'text-surface-400 hover:text-surface-200 hover:bg-surface-700/50'
          "
          style="border: none; outline: none"
          @click="selectedTimeframe = tf"
        >
          {{ tf }}
        </button>
      </div>
    </div>

    <!-- Chart -->
    <div class="flex-1 min-h-0">
      <ECharts
        v-if="trades && trades.length > 0"
        :key="activeTab"
        ref="chart"
        :option="chartOptions"
        :theme="settingsStore.chartTheme"
        autoresize
      />
      <div v-else class="flex items-center justify-center h-full text-surface-400 text-sm">
        {{ t('cumProfit.noData') }}
      </div>
    </div>

    <!-- Statistics panel -->
    <div
      class="grid grid-cols-5 gap-2 px-3 py-2 mt-1 text-xs rounded-lg"
      style="
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        backdrop-filter: blur(12px);
      "
    >
      <div class="flex flex-col items-center">
        <span class="text-surface-400">{{ t('cumProfit.statTotalProfit') }}</span>
        <span
          class="font-semibold"
          :class="stats.totalProfit >= 0 ? 'text-green-400' : 'text-red-400'"
        >
          {{ formatPrice(stats.totalProfit, 2) }}
          <span v-if="currencyLabel" class="text-[0.6rem] font-normal opacity-50">{{
            currencyLabel.trim()
          }}</span>
        </span>
      </div>
      <div class="flex flex-col items-center">
        <span class="text-surface-400">{{ t('cumProfit.statPeak') }}</span>
        <span class="font-semibold text-blue-400">
          {{ formatPrice(stats.peakProfit, 2) }}
          <span v-if="currencyLabel" class="text-[0.6rem] font-normal opacity-50">{{
            currencyLabel.trim()
          }}</span>
        </span>
      </div>
      <div class="flex flex-col items-center">
        <span class="text-surface-400">{{ t('cumProfit.statDrawdown') }}</span>
        <span class="font-semibold text-red-400">
          {{ formatPrice(stats.maxDrawdown, 2) }}
          <span v-if="currencyLabel" class="text-[0.6rem] font-normal opacity-50">{{
            currencyLabel.trim()
          }}</span>
        </span>
      </div>
      <div class="flex flex-col items-center">
        <span class="text-surface-400">{{ t('cumProfit.statRecovery') }}</span>
        <span class="font-semibold text-yellow-400">
          {{ formatPrice(stats.recoveryPct, 1) }}%
        </span>
      </div>
      <div class="flex flex-col items-center">
        <span class="text-surface-400">{{ t('cumProfit.statBestBot') }}</span>
        <span class="font-semibold text-emerald-400 truncate max-w-full" :title="stats.bestBot">
          {{ stats.bestBot }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cum-profit-enhanced {
  width: 100%;
  height: 100%;
}

.echarts {
  width: 100%;
  height: 100%;
  min-height: 150px;
}

.bg-primary {
  background-color: rgba(99, 102, 241, 0.85);
}
</style>
