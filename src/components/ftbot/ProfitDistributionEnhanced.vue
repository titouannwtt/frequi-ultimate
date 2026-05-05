<script setup lang="ts">
import type { EChartsOption } from 'echarts';
import ECharts from 'vue-echarts';

import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

import type { ClosedTrade } from '@/types';
import type { ComputedRefWithControl } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { useSummaryCurrency } from '@/composables/summaryCurrency';

use([
  BarChart,
  LineChart,
  ScatterChart,
  CanvasRenderer,
  DatasetComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
]);

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    trades: ClosedTrade[];
    showTitle?: boolean;
  }>(),
  {
    showTitle: true,
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

// Local cache of histogram data for tooltip access
let _histogramData: { bucket: string; count: number; isPositive: boolean }[] = [];

// --- State ---
type TabKey = 'histogram' | 'perBot' | 'perPair' | 'byDuration' | 'byLeverage';
const activeTab = ref<TabKey>('histogram');

type FilterKey = 'all' | 'spot' | 'futures' | 'long' | 'short';
const activeFilter = ref<FilterKey>('all');

// Histogram range filter and bin count
// Histogram filter refs (driven by sliders with debounce)
const histMinPct = ref<number | null>(null);
const histMaxPct = ref<number | null>(null);
const histBinCount = ref<number>(20);

const tabs: { key: TabKey; labelKey: string }[] = [
  { key: 'histogram', labelKey: 'profitDist.tabHistogram' },
  { key: 'perBot', labelKey: 'profitDist.tabPerBot' },
  { key: 'perPair', labelKey: 'profitDist.tabPerPair' },
  { key: 'byDuration', labelKey: 'profitDist.tabByDuration' },
  { key: 'byLeverage', labelKey: 'profitDist.tabByLeverage' },
];

const filters: { key: FilterKey; labelKey: string }[] = [
  { key: 'all', labelKey: 'profitDist.filterAll' },
  { key: 'spot', labelKey: 'profitDist.filterSpot' },
  { key: 'futures', labelKey: 'profitDist.filterFutures' },
  { key: 'long', labelKey: 'profitDist.filterLong' },
  { key: 'short', labelKey: 'profitDist.filterShort' },
];

// Bot color palette
const BOT_COLORS = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#4dc9f6',
];

function botColor(index: number): string {
  return BOT_COLORS[index % BOT_COLORS.length]!;
}

// --- Helpers ---
function getBotName(botId: string): string {
  const desc = botStore.availableBots[botId];
  return desc?.botName ?? botId;
}

const botIds = computed<string[]>(() => {
  const ids = new Set<string>();
  for (const t of props.trades) {
    if (t.botId) ids.add(t.botId);
  }
  return Array.from(ids);
});

// --- Filtered trades based on active filter ---
const filteredTrades = computed<ClosedTrade[]>(() => {
  let trades = props.trades;
  switch (activeFilter.value) {
    case 'spot':
      trades = trades.filter((t) => !t.leverage || t.leverage <= 1);
      break;
    case 'futures':
      trades = trades.filter((t) => (t.leverage ?? 1) > 1);
      break;
    case 'long':
      trades = trades.filter((t) => !t.is_short);
      break;
    case 'short':
      trades = trades.filter((t) => t.is_short);
      break;
  }
  return trades;
});

// --- Profit values (with optional range filter for histogram) ---
const profitValuesRaw = computed(() =>
  filteredTrades.value
    .filter((t) => t.profit_ratio !== null && t.profit_ratio !== undefined)
    .map((t) => (t.profit_ratio ?? 0) * 100),
);

// Slider state (immediate visual feedback, debounced for chart update)
const sliderMin = ref<number>(0);
const sliderMax = ref<number>(0);
const sliderBins = ref<number>(20);
let sliderDebounce: ReturnType<typeof setTimeout> | null = null;

const dataRangeMin = computed(() => profitValuesRaw.value.length ? Math.floor(Math.min(...profitValuesRaw.value)) : -50);
const dataRangeMax = computed(() => profitValuesRaw.value.length ? Math.ceil(Math.max(...profitValuesRaw.value)) : 50);

watch(profitValuesRaw, () => {
  if (histMinPct.value === null) sliderMin.value = dataRangeMin.value;
  if (histMaxPct.value === null) sliderMax.value = dataRangeMax.value;
}, { immediate: true });

function onSliderMinChange(val: number) {
  sliderMin.value = val;
  if (sliderDebounce) clearTimeout(sliderDebounce);
  sliderDebounce = setTimeout(() => { histMinPct.value = val <= dataRangeMin.value ? null : val; }, 200);
}
function onSliderMaxChange(val: number) {
  sliderMax.value = val;
  if (sliderDebounce) clearTimeout(sliderDebounce);
  sliderDebounce = setTimeout(() => { histMaxPct.value = val >= dataRangeMax.value ? null : val; }, 200);
}
function onSliderBinsChange(val: number) {
  sliderBins.value = val;
  if (sliderDebounce) clearTimeout(sliderDebounce);
  sliderDebounce = setTimeout(() => { histBinCount.value = val; }, 200);
}

const profitValues = computed(() => {
  let vals = profitValuesRaw.value;
  if (histMinPct.value !== null) vals = vals.filter((v) => v >= histMinPct.value!);
  if (histMaxPct.value !== null) vals = vals.filter((v) => v <= histMaxPct.value!);
  return vals;
});

function clearHistogramFilter() {
  histMinPct.value = null;
  histMaxPct.value = null;
  histBinCount.value = 20;
  sliderMin.value = dataRangeMin.value;
  sliderMax.value = dataRangeMax.value;
  sliderBins.value = 20;
}

// --- Statistics ---
const stats = computed(() => {
  const vals = profitValues.value;
  if (vals.length === 0) {
    return {
      mean: 0, median: 0, stdDev: 0, skewness: 0,
      best: 0, worst: 0, winRate: 0, count: 0,
    };
  }

  const n = vals.length;
  const sorted = [...vals].sort((a, b) => a - b);
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2
    : sorted[Math.floor(n / 2)]!;

  const variance = vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  let skewness = 0;
  if (stdDev > 0) {
    skewness = vals.reduce((sum, v) => sum + ((v - mean) / stdDev) ** 3, 0) / n;
  }

  const best = sorted[n - 1]!;
  const worst = sorted[0]!;
  const winRate = (vals.filter((v) => v > 0).length / n) * 100;

  return { mean, median, stdDev, skewness, best, worst, winRate, count: n };
});

// --- Histogram data ---
function buildHistogramData(): { bucket: string; count: number; isPositive: boolean }[] {
  const vals = profitValues.value;
  if (vals.length === 0) return [];

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min;
  if (range === 0) return [{ bucket: `${min.toFixed(1)}%`, count: vals.length, isPositive: min >= 0 }];

  // Auto bucket size: aim for ~N buckets (user-configurable)
  const rawStep = range / histBinCount.value;
  // Round to nice number
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const niceSteps = [1, 2, 2.5, 5, 10];
  let step = niceSteps.find((s) => s * mag >= rawStep)! * mag;
  if (!step) step = rawStep;

  const bucketStart = Math.floor(min / step) * step;
  const bucketEnd = Math.ceil(max / step) * step;
  const buckets: { bucket: string; count: number; isPositive: boolean }[] = [];

  for (let b = bucketStart; b < bucketEnd + step * 0.5; b += step) {
    const bRound = Math.round(b * 100) / 100;
    const nextB = Math.round((b + step) * 100) / 100;
    const count = vals.filter((v) => v >= bRound && v < nextB).length;
    buckets.push({
      bucket: `${bRound.toFixed(1)}%`,
      count,
      isPositive: bRound >= 0,
    });
  }
  return buckets;
}

// --- Per Bot data ---
function buildPerBotData(): { botName: string; buckets: Record<string, number> }[] {
  if (botIds.value.length === 0) return [];

  // Group trades by bot, compute histogram per bot
  const allVals = profitValues.value;
  if (allVals.length === 0) return [];

  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min;
  const rawStep = range / 15 || 1;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const niceSteps = [1, 2, 2.5, 5, 10];
  let step = niceSteps.find((s) => s * mag >= rawStep)! * mag;
  if (!step) step = rawStep;

  const bucketStart = Math.floor(min / step) * step;
  const bucketEnd = Math.ceil(max / step) * step;
  const bucketLabels: string[] = [];
  for (let b = bucketStart; b < bucketEnd + step * 0.5; b += step) {
    bucketLabels.push(`${(Math.round(b * 100) / 100).toFixed(1)}%`);
  }

  return botIds.value.map((id) => {
    const botTrades = filteredTrades.value.filter((t) => t.botId === id && t.profit_ratio !== null);
    const botVals = botTrades.map((t) => (t.profit_ratio ?? 0) * 100);
    const buckets: Record<string, number> = {};

    for (let i = 0; i < bucketLabels.length; i++) {
      const bVal = bucketStart + i * step;
      const nextB = bVal + step;
      buckets[bucketLabels[i]!] = botVals.filter(
        (v) => v >= Math.round(bVal * 100) / 100 && v < Math.round(nextB * 100) / 100,
      ).length;
    }

    return { botName: getBotName(id), buckets };
  });
}

// --- Per Pair data (top 15) ---
function buildPerPairData(): { pair: string; avgProfit: number; tradeCount: number }[] {
  const pairMap = new Map<string, { sum: number; count: number }>();
  for (const trade of filteredTrades.value) {
    if (trade.profit_ratio === null || trade.profit_ratio === undefined) continue;
    const entry = pairMap.get(trade.pair) ?? { sum: 0, count: 0 };
    entry.sum += (trade.profit_ratio ?? 0) * 100;
    entry.count++;
    pairMap.set(trade.pair, entry);
  }

  return Array.from(pairMap.entries())
    .map(([pair, { sum, count }]) => ({
      pair,
      avgProfit: sum / count,
      tradeCount: count,
    }))
    .sort((a, b) => b.avgProfit - a.avgProfit)
    .slice(0, 15);
}

// --- By Duration data ---
function buildDurationData(): { duration: number; profit: number; botId: string; pair: string }[] {
  return filteredTrades.value
    .filter((t) => t.profit_ratio !== null && t.open_timestamp && t.close_timestamp)
    .map((t) => ({
      duration: ((t.close_timestamp ?? 0) - t.open_timestamp) / (1000 * 60), // minutes
      profit: (t.profit_ratio ?? 0) * 100,
      botId: t.botId ?? '',
      pair: t.pair,
    }));
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

// --- Chart builders ---
function buildHistogramChart(): EChartsOption {
  const { colorProfit, colorLoss } = colorStore;
  const data = buildHistogramData();
  _histogramData = data;
  const mean = stats.value.mean;

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20, 20, 30, 0.92)',
      borderColor: 'rgba(255,255,255,0.08)',
      textStyle: { color: '#e0e0e0', fontSize: 12 },
      formatter: (params: any) => {
        if (!Array.isArray(params) || params.length === 0) return '';
        const d = params[0];
        const idx = d.dataIndex;
        const item = _histogramData[idx];
        if (!item) return '';
        return `<div style="font-weight:600">${item.bucket}</div>
                <div>${t('profitDist.tradeCount')}: <b>${item.count}</b></div>`;
      },
    },
    xAxis: {
      type: 'category',
      data: data.map((d) => d.bucket),
      name: t('profitDist.profitPct'),
      nameLocation: 'middle',
      nameGap: 30,
      axisLabel: { rotate: 45, fontSize: 9, interval: 'auto' },
    },
    yAxis: {
      type: 'value',
      name: t('profitDist.tradeCount'),
      splitLine: { show: false },
      nameRotate: 90,
      nameLocation: 'middle',
      nameGap: 35,
    },
    grid: { ...echartsGridDefault, bottom: 60 },
    series: [
      {
        type: 'bar',
        data: data.map((d) => ({
          value: d.count,
          itemStyle: {
            color: d.isPositive ? `${colorProfit}80` : `${colorLoss}80`,
            borderRadius: [2, 2, 0, 0],
          },
        })),
        barMaxWidth: 30,
        markLine: {
          silent: true,
          symbol: 'none',
          data: [
            {
              xAxis: data.findIndex((d) => {
                const val = parseFloat(d.bucket);
                return val >= 0;
              }),
              lineStyle: { color: '#ffffff80', type: 'solid', width: 1 },
              label: { show: true, formatter: '0%', color: '#ffffffaa', fontSize: 10 },
            },
            {
              xAxis: (() => {
                // Find closest bucket to mean
                let closest = 0;
                let minDist = Infinity;
                data.forEach((d, i) => {
                  const dist = Math.abs(parseFloat(d.bucket) - mean);
                  if (dist < minDist) { minDist = dist; closest = i; }
                });
                return closest;
              })(),
              lineStyle: { color: '#fac858', type: 'dashed', width: 1 },
              label: {
                show: true,
                formatter: `${t('profitDist.mean')}: ${mean.toFixed(2)}%`,
                color: '#fac858',
                fontSize: 10,
              },
            },
          ],
        },
      },
    ],
  };
}

function buildPerBotChart(): EChartsOption {
  const data = buildPerBotData();
  if (data.length === 0) return { series: [] };

  const bucketLabels = Object.keys(data[0]!.buckets);
  const series = data.map((bot, idx) => ({
    type: 'bar' as const,
    name: bot.botName,
    data: bucketLabels.map((label) => bot.buckets[label] ?? 0),
    itemStyle: { color: botColor(idx), borderRadius: [2, 2, 0, 0] },
    barMaxWidth: 20,
  }));

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20, 20, 30, 0.92)',
      borderColor: 'rgba(255,255,255,0.08)',
      textStyle: { color: '#e0e0e0', fontSize: 12 },
    },
    legend: {
      data: data.map((d) => d.botName),
      right: '5%',
      top: 0,
      textStyle: { color: settingsStore.chartTheme === 'dark' ? '#ccc' : '#333' },
    },
    xAxis: {
      type: 'category',
      data: bucketLabels,
      name: t('profitDist.profitPct'),
      nameLocation: 'middle',
      nameGap: 30,
      axisLabel: { rotate: 45, fontSize: 9, interval: 'auto' },
    },
    yAxis: {
      type: 'value',
      name: t('profitDist.tradeCount'),
      splitLine: { show: false },
      nameRotate: 90,
      nameLocation: 'middle',
      nameGap: 35,
    },
    grid: { ...echartsGridDefault, bottom: 60 },
    series,
  };
}

function buildPerPairChart(): EChartsOption {
  const { colorProfit, colorLoss } = colorStore;
  const data = buildPerPairData();
  if (data.length === 0) return { series: [] };

  // Reverse for horizontal bar (bottom = highest profit)
  const reversed = [...data].reverse();

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20, 20, 30, 0.92)',
      borderColor: 'rgba(255,255,255,0.08)',
      textStyle: { color: '#e0e0e0', fontSize: 12 },
      formatter: (params: any) => {
        if (!Array.isArray(params) || params.length === 0) return '';
        const d = params[0];
        const idx = d.dataIndex;
        const item = reversed[idx];
        if (!item) return '';
        return `<div style="font-weight:600">${item.pair}</div>
                <div>${t('profitDist.avgProfit')}: <b>${item.avgProfit.toFixed(2)}%</b></div>
                <div>${t('profitDist.tradeCount')}: <b>${item.tradeCount}</b></div>`;
      },
    },
    xAxis: {
      type: 'value',
      name: t('profitDist.avgProfitPct'),
      nameLocation: 'middle',
      nameGap: 30,
    },
    yAxis: {
      type: 'category',
      data: reversed.map((d) => d.pair),
      axisLabel: { fontSize: 10 },
    },
    grid: { ...echartsGridDefault, left: 120, bottom: 40 },
    series: [
      {
        type: 'bar',
        data: reversed.map((d) => ({
          value: d.avgProfit,
          itemStyle: {
            color: d.avgProfit >= 0 ? `${colorProfit}80` : `${colorLoss}80`,
            borderRadius: d.avgProfit >= 0 ? [0, 3, 3, 0] : [3, 0, 0, 3],
          },
        })),
        barMaxWidth: 18,
      },
    ],
  };
}

function buildDurationChart(): EChartsOption {
  const { colorProfit, colorLoss } = colorStore;
  const data = buildDurationData();
  if (data.length === 0) return { series: [] };

  // Group by bot for coloring
  const botIdList = botIds.value;
  const seriesByBot = botIdList.map((id, idx) => {
    const botData = data.filter((d) => d.botId === id);
    return {
      type: 'scatter' as const,
      name: getBotName(id),
      data: botData.map((d) => [d.duration, d.profit]),
      symbolSize: 6,
      itemStyle: {
        color: botColor(idx),
        opacity: 0.7,
      },
    };
  });

  // If no bots, single series
  if (seriesByBot.length === 0) {
    seriesByBot.push({
      type: 'scatter',
      name: t('profitDist.trades'),
      data: data.map((d) => [d.duration, d.profit]),
      symbolSize: 6,
      itemStyle: {
        color: colorProfit,
        opacity: 0.7,
      },
    });
  }

  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(20, 20, 30, 0.92)',
      borderColor: 'rgba(255,255,255,0.08)',
      textStyle: { color: '#e0e0e0', fontSize: 12 },
      formatter: (params: any) => {
        const d = params.data;
        if (!d) return '';
        return `<div style="font-weight:600">${params.seriesName}</div>
                <div>${t('profitDist.duration')}: <b>${formatDuration(d[0])}</b></div>
                <div>${t('profitDist.profitPct')}: <b>${d[1].toFixed(2)}%</b></div>`;
      },
    },
    legend: {
      data: botIdList.map((id) => getBotName(id)),
      right: '5%',
      top: 0,
      textStyle: { color: settingsStore.chartTheme === 'dark' ? '#ccc' : '#333' },
    },
    xAxis: {
      type: 'value',
      name: t('profitDist.duration'),
      nameLocation: 'middle',
      nameGap: 30,
      axisLabel: {
        formatter: (val: number) => formatDuration(val),
      },
    },
    yAxis: {
      type: 'value',
      name: t('profitDist.profitPct'),
      splitLine: { show: false },
      nameRotate: 90,
      nameLocation: 'middle',
      nameGap: 40,
      axisLabel: {
        formatter: (val: number) => `${val.toFixed(1)}%`,
      },
    },
    grid: { ...echartsGridDefault, bottom: 50 },
    visualMap: {
      show: false,
      dimension: 1,
      pieces: [
        { min: 0, color: colorProfit },
        { max: 0, color: colorLoss },
      ],
    },
    series: seriesByBot,
  };
}

// --- By Leverage data ---
function buildLeverageChart(): EChartsOption {
  const { colorProfit, colorLoss } = colorStore;
  const trades = filteredTrades.value.filter(
    (t) => t.profit_ratio !== null && t.profit_ratio !== undefined,
  );
  if (trades.length === 0) return { series: [] };

  // Group by leverage bucket
  const leverageBuckets = new Map<string, { sum: number; count: number }>();
  for (const trade of trades) {
    const lev = trade.leverage ?? 1;
    const bucket = lev <= 1 ? '1x' : `${Math.round(lev)}x`;
    const entry = leverageBuckets.get(bucket) ?? { sum: 0, count: 0 };
    entry.sum += (trade.profit_ratio ?? 0) * 100;
    entry.count++;
    leverageBuckets.set(bucket, entry);
  }

  // Sort buckets by leverage value
  const sortedBuckets = Array.from(leverageBuckets.entries())
    .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
    .map(([bucket, { sum, count }]) => ({
      bucket,
      avgProfit: sum / count,
      tradeCount: count,
    }));

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20, 20, 30, 0.92)',
      borderColor: 'rgba(255,255,255,0.08)',
      textStyle: { color: '#e0e0e0', fontSize: 12 },
      formatter: (params: any) => {
        if (!Array.isArray(params) || params.length === 0) return '';
        const d = params[0];
        const idx = d.dataIndex;
        const item = sortedBuckets[idx];
        if (!item) return '';
        return `<div style="font-weight:600">${t('profitDist.leverage')}: ${item.bucket}</div>
                <div>${t('profitDist.avgProfit')}: <b>${item.avgProfit.toFixed(2)}%</b></div>
                <div>${t('profitDist.tradeCount')}: <b>${item.tradeCount}</b></div>`;
      },
    },
    xAxis: {
      type: 'category',
      data: sortedBuckets.map((d) => d.bucket),
      name: t('profitDist.leverage'),
      nameLocation: 'middle',
      nameGap: 30,
    },
    yAxis: {
      type: 'value',
      name: t('profitDist.avgProfitPct'),
      splitLine: { show: false },
      nameRotate: 90,
      nameLocation: 'middle',
      nameGap: 40,
      axisLabel: {
        formatter: (val: number) => `${val.toFixed(1)}%`,
      },
    },
    grid: { ...echartsGridDefault, bottom: 50 },
    series: [
      {
        type: 'bar',
        data: sortedBuckets.map((d) => ({
          value: d.avgProfit,
          itemStyle: {
            color: d.avgProfit >= 0 ? colorProfit : colorLoss,
            borderRadius: [3, 3, 0, 0],
          },
        })),
        barMaxWidth: 40,
        label: {
          show: true,
          position: 'top',
          formatter: (params: any) => {
            const item = sortedBuckets[params.dataIndex];
            return item ? `${item.tradeCount}` : '';
          },
          color: '#999',
          fontSize: 10,
        },
      },
    ],
  };
}

// --- Main chart options ---
const chartOptions: ComputedRefWithControl<EChartsOption> = computedWithControl(
  () => [props.trades, activeTab.value, activeFilter.value, histMinPct.value, histMaxPct.value, histBinCount.value],
  () => {
    let tabOpts: EChartsOption;
    switch (activeTab.value) {
      case 'perBot':
        tabOpts = buildPerBotChart();
        break;
      case 'perPair':
        tabOpts = buildPerPairChart();
        break;
      case 'byDuration':
        tabOpts = buildDurationChart();
        break;
      case 'byLeverage':
        tabOpts = buildLeverageChart();
        break;
      case 'histogram':
      default:
        tabOpts = buildHistogramChart();
        break;
    }

    const baseOpts: EChartsOption = {
      backgroundColor: 'rgba(0, 0, 0, 0)',
      ...tabOpts,
    };
    return baseOpts;
  },
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
  () => activeFilter.value,
  () => chartOptions.trigger(),
);
</script>

<template>
  <div class="profit-dist-enhanced flex flex-col h-full">
    <!-- Tab pills -->
    <div class="flex flex-wrap items-center gap-2 px-2 pt-1 pb-1">
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
    </div>

    <!-- Filter pills -->
    <div class="flex flex-wrap items-center gap-1 px-2 pb-1">
      <button
        v-for="f in filters"
        :key="f.key"
        class="rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-all duration-200 cursor-pointer"
        :class="
          activeFilter === f.key
            ? 'bg-primary text-white shadow-sm'
            : 'text-surface-400 hover:text-surface-200'
        "
        :style="{
          background: activeFilter === f.key
            ? 'rgba(99, 102, 241, 0.85)'
            : 'rgba(255, 255, 255, 0.04)',
          border: '1px solid ' + (activeFilter === f.key ? 'rgba(99, 102, 241, 0.5)' : 'rgba(255, 255, 255, 0.06)'),
        }"
        @click="activeFilter = f.key"
      >
        {{ t(f.labelKey) }}
      </button>
    </div>

    <!-- Histogram controls (only visible on histogram tab) -->
    <div v-if="activeTab === 'histogram'" class="px-2 pb-1 space-y-1">
      <div class="flex items-center gap-3">
        <!-- Min slider -->
        <div class="flex-1 flex items-center gap-1">
          <label class="text-[10px] text-surface-400 w-6">Min</label>
          <input
            type="range"
            :min="dataRangeMin"
            :max="dataRangeMax"
            :step="1"
            :value="sliderMin"
            class="flex-1 h-1 accent-blue-500"
            @input="onSliderMinChange(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="text-[10px] font-mono text-surface-300 w-10 text-right">{{ sliderMin }}%</span>
        </div>
        <!-- Max slider -->
        <div class="flex-1 flex items-center gap-1">
          <label class="text-[10px] text-surface-400 w-6">Max</label>
          <input
            type="range"
            :min="dataRangeMin"
            :max="dataRangeMax"
            :step="1"
            :value="sliderMax"
            class="flex-1 h-1 accent-blue-500"
            @input="onSliderMaxChange(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="text-[10px] font-mono text-surface-300 w-10 text-right">{{ sliderMax }}%</span>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <!-- Bins slider -->
        <div class="flex-1 flex items-center gap-1">
          <label class="text-[10px] text-surface-400 w-6">Bins</label>
          <input
            type="range"
            :min="5"
            :max="100"
            :step="5"
            :value="sliderBins"
            class="flex-1 h-1 accent-blue-500"
            @input="onSliderBinsChange(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="text-[10px] font-mono text-surface-300 w-10 text-right">{{ sliderBins }}</span>
        </div>
        <!-- Clear + count -->
        <div class="flex items-center gap-2">
          <button
            v-if="histMinPct !== null || histMaxPct !== null || histBinCount !== 20"
            class="text-[10px] text-blue-400 hover:text-blue-300 cursor-pointer"
            @click="clearHistogramFilter"
          >{{ t('profitDist.clearFilter') }}</button>
          <span v-if="histMinPct !== null || histMaxPct !== null" class="text-[9px] text-surface-500">
            {{ profitValues.length }}/{{ profitValuesRaw.length }}
          </span>
        </div>
      </div>
    </div>

    <!-- Chart -->
    <div class="flex-1 min-h-0">
      <ECharts
        v-if="trades && trades.length > 0"
        ref="chart"
        :option="chartOptions"
        :theme="settingsStore.chartTheme"
        autoresize
      />
      <div
        v-else
        class="flex items-center justify-center h-full text-surface-400 text-sm"
      >
        {{ t('profitDist.noData') }}
      </div>
    </div>

    <!-- Statistics panel -->
    <div
      class="grid grid-cols-4 gap-2 px-3 py-2 mt-1 text-xs rounded-lg md:grid-cols-8"
      style="
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        backdrop-filter: blur(12px);
      "
    >
      <div class="flex flex-col items-center">
        <span class="text-surface-400">{{ t('profitDist.statMean') }}</span>
        <span
          class="font-semibold"
          :class="stats.mean >= 0 ? 'text-green-400' : 'text-red-400'"
        >
          {{ formatPrice(stats.mean, 2) }}%
        </span>
      </div>
      <div class="flex flex-col items-center">
        <span class="text-surface-400">{{ t('profitDist.statMedian') }}</span>
        <span
          class="font-semibold"
          :class="stats.median >= 0 ? 'text-green-400' : 'text-red-400'"
        >
          {{ formatPrice(stats.median, 2) }}%
        </span>
      </div>
      <div class="flex flex-col items-center">
        <span class="text-surface-400">{{ t('profitDist.statStdDev') }}</span>
        <span class="font-semibold text-blue-400">
          {{ formatPrice(stats.stdDev, 2) }}%
        </span>
      </div>
      <div class="flex flex-col items-center">
        <span class="text-surface-400">{{ t('profitDist.statSkewness') }}</span>
        <span
          class="font-semibold"
          :class="stats.skewness >= 0 ? 'text-emerald-400' : 'text-orange-400'"
          :title="stats.skewness >= 0 ? t('profitDist.skewnessPositive') : t('profitDist.skewnessNegative')"
        >
          {{ formatPrice(stats.skewness, 2) }}
        </span>
      </div>
      <div class="flex flex-col items-center">
        <span class="text-surface-400">{{ t('profitDist.statBest') }}</span>
        <span class="font-semibold text-green-400">
          {{ formatPrice(stats.best, 2) }}%
        </span>
      </div>
      <div class="flex flex-col items-center">
        <span class="text-surface-400">{{ t('profitDist.statWorst') }}</span>
        <span class="font-semibold text-red-400">
          {{ formatPrice(stats.worst, 2) }}%
        </span>
      </div>
      <div class="flex flex-col items-center">
        <span class="text-surface-400">{{ t('profitDist.statWinRate') }}</span>
        <span
          class="font-semibold"
          :class="stats.winRate >= 50 ? 'text-green-400' : 'text-yellow-400'"
        >
          {{ formatPrice(stats.winRate, 1) }}%
        </span>
      </div>
      <div class="flex flex-col items-center">
        <span class="text-surface-400">{{ t('profitDist.statTrades') }}</span>
        <span class="font-semibold text-surface-200">
          {{ stats.count }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profit-dist-enhanced {
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
