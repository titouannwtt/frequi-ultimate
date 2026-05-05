<script setup lang="ts">
import type { EChartsOption } from 'echarts';
import ECharts from 'vue-echarts';

import { BarChart, LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  MarkLineComponent,
} from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

import type { ClosedTrade, Trade } from '@/types';
import { useI18n } from 'vue-i18n';
import { useSummaryCurrency } from '@/composables/summaryCurrency';
import { useExchangeRates } from '@/composables/exchangeRates';
import {
  fetchBenchmarkHistory,
  normalizeToPercent,
  BENCHMARK_TICKERS,
  BENCHMARK_CATEGORIES,
  type PricePoint,
} from '@/utils/benchmarkData';

use([
  BarChart,
  LineChart,
  CanvasRenderer,
  DatasetComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  MarkLineComponent,
]);

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    trades: ClosedTrade[];
    openTrades?: Trade[];
    showTitle?: boolean;
  }>(),
  {
    openTrades: () => [],
    showTitle: false,
  },
);

const botStore = useBotStore();
const settingsStore = useSettingsStore();
const colorStore = useColorStore();
const { summaryCurrency } = useSummaryCurrency();
const { convert } = useExchangeRates();

const chart = ref<InstanceType<typeof ECharts>>();

// --- State ---
type TabKey = 'combined' | 'perBot';
type TimeframeKey = '1D' | '7D' | '30D' | '90D' | 'YTD' | 'ALL';
type ValueModeKey = 'pct' | 'abs';

const activeTab = ref<TabKey>('combined');
const selectedTimeframe = ref<TimeframeKey>('ALL');
const normMode = ref<'pctFromStart'>('pctFromStart');
const valueMode = ref<ValueModeKey>('pct');

// --- Benchmark management ---
const BENCHMARKS_STORAGE_KEY = 'ft_benchmarks_enabled';
const enabledBenchmarks = ref<string[]>(loadBenchmarksFromStorage());
const showBenchmarkDropdown = ref(false);
const customBenchmarkInput = ref('');
const customBenchmarkError = ref('');
const benchmarkLoading = ref(false);

function loadBenchmarksFromStorage(): string[] {
  try {
    const stored = localStorage.getItem(BENCHMARKS_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return ['BTC']; // BTC on by default
}

function saveBenchmarksToStorage() {
  localStorage.setItem(BENCHMARKS_STORAGE_KEY, JSON.stringify(enabledBenchmarks.value));
}

function toggleBenchmark(ticker: string) {
  const idx = enabledBenchmarks.value.indexOf(ticker);
  if (idx >= 0) {
    enabledBenchmarks.value.splice(idx, 1);
  } else {
    enabledBenchmarks.value.push(ticker);
  }
  saveBenchmarksToStorage();
}

async function addCustomBenchmark() {
  const val = customBenchmarkInput.value.trim();
  if (!val) return;
  customBenchmarkError.value = '';
  const upper = val.toUpperCase();
  if (enabledBenchmarks.value.includes(upper)) {
    customBenchmarkInput.value = '';
    return;
  }
  // Validate by fetching a small amount of data
  benchmarkLoading.value = true;
  try {
    const result = await fetchBenchmarkHistory(val, 1);
    if (result.error === 'not_found' || result.data.length === 0) {
      customBenchmarkError.value = t('profitBenchmark.customNotFound');
      return;
    }
    enabledBenchmarks.value.push(upper);
    saveBenchmarksToStorage();
    customBenchmarkInput.value = '';
    customBenchmarkError.value = '';
  } catch {
    customBenchmarkError.value = t('profitBenchmark.customNotFound');
  } finally {
    benchmarkLoading.value = false;
  }
}

function removeBenchmark(ticker: string) {
  const idx = enabledBenchmarks.value.indexOf(ticker);
  if (idx >= 0) {
    enabledBenchmarks.value.splice(idx, 1);
    saveBenchmarksToStorage();
  }
}

const BENCHMARK_COLORS: Record<string, string> = {
  BTC: '#f7931a',
  ETH: '#627eea',
  SOL: '#9945ff',
  BNB: '#f0b90b',
  DOGE: '#c2a633',
  HYPE: '#00d4aa',
};

function getBenchmarkColor(ticker: string): string {
  return BENCHMARK_COLORS[ticker] ?? `hsl(${(ticker.charCodeAt(0) * 37) % 360}, 60%, 55%)`;
}

// --- Tabs, timeframes ---
const tabs: { key: TabKey; labelKey: string }[] = [
  { key: 'combined', labelKey: 'profitBenchmark.tabCombined' },
  { key: 'perBot', labelKey: 'profitBenchmark.tabPerBot' },
];

const timeframes: TimeframeKey[] = ['1D', '7D', '30D', '90D', 'YTD', 'ALL'];

// Bot color palette
const BOT_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#84cc16',
];

function getBotColor(index: number): string {
  return BOT_COLORS[index % BOT_COLORS.length] ?? '#6366f1';
}

// --- Timeframe filtering ---
function getTimeframeCutoff(tf: TimeframeKey): number {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  switch (tf) {
    case '1D': return now - 1 * day;
    case '7D': return now - 7 * day;
    case '30D': return now - 30 * day;
    case '90D': return now - 90 * day;
    case 'YTD': {
      const d = new Date();
      return new Date(d.getFullYear(), 0, 1).getTime();
    }
    case 'ALL':
    default: return 0;
  }
}

function timeframeToDays(tf: TimeframeKey): number {
  switch (tf) {
    case '1D': return 1;
    case '7D': return 7;
    case '30D': return 30;
    case '90D': return 90;
    case 'YTD': return Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000);
    case 'ALL': return 365;
  }
}

// --- Compute unique bot IDs ---
const botIds = computed<string[]>(() => {
  const ids = new Set<string>();
  props.trades.forEach((tr) => ids.add(tr.botId));
  return Array.from(ids);
});

const botNameMap = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  props.trades.forEach((tr) => {
    if (!map[tr.botId]) {
      map[tr.botId] = tr.botName || tr.botId;
    }
  });
  return map;
});

/** Map botId -> stake_currency for currency conversion */
const botStakeCurrencyMap = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const bot of botStore.selectedBots) {
    map[bot.botId] = bot.stakeCurrency || 'USDT';
  }
  return map;
});

/** Convert a profit amount from a bot's stake currency to the selected summary currency */
function convertProfit(amount: number, botId: string): number {
  const targetCurrency = summaryCurrency.value;
  if (!targetCurrency || targetCurrency === 'auto') return amount;
  const fromCurrency = botStakeCurrencyMap.value[botId];
  if (!fromCurrency || fromCurrency.toUpperCase() === targetCurrency.toUpperCase()) return amount;
  const converted = convert(amount, fromCurrency, targetCurrency);
  return converted ?? amount;
}

// --- Starting balance per bot ---
const startingBalancePerBot = computed<Record<string, number>>(() => {
  const result: Record<string, number> = {};
  for (const bot of botStore.selectedBots) {
    const profit = bot.profit;
    if (profit && profit.bot_start_timestamp) {
      const bal = bot.balance?.total ?? 0;
      const totalProfit = profit.profit_all_coin ?? 0;
      result[bot.botId] = Math.max(bal - totalProfit, 1);
    } else {
      result[bot.botId] = 1;
    }
  }
  return result;
});

const totalStartingBalance = computed<number>(() => {
  return Object.values(startingBalancePerBot.value).reduce((a, b) => a + b, 0) || 1;
});

// --- Filtered + sorted trades ---
const filteredTrades = computed(() => {
  const cutoff = getTimeframeCutoff(selectedTimeframe.value);
  return props.trades
    .filter((tr) => tr.close_timestamp && tr.close_timestamp >= cutoff)
    .slice()
    .sort((a, b) => a.close_timestamp - b.close_timestamp);
});

// --- Open profit per bot ---
const openProfitPerBot = computed<Record<string, number>>(() => {
  const result: Record<string, number> = {};
  props.openTrades.forEach((tr) => {
    const rawP = tr.total_profit_abs ?? tr.profit_abs ?? 0;
    const p = convertProfit(rawP, tr.botId);
    result[tr.botId] = (result[tr.botId] ?? 0) + p;
  });
  return result;
});

// --- Build cumulative data ---
interface CumPoint {
  date: number;
  combined: number;
  [botId: string]: number;
}

const cumulativeData = computed<CumPoint[]>(() => {
  const trades = filteredTrades.value;
  if (trades.length === 0) return [];

  const cumPerBot: Record<string, number> = {};
  botIds.value.forEach((id) => { cumPerBot[id] = 0; });
  let cumTotal = 0;

  const points: CumPoint[] = [];

  const firstTrade = trades[0];
  if (firstTrade) {
    const zeroPoint: CumPoint = { date: firstTrade.open_timestamp, combined: 0 };
    botIds.value.forEach((id) => { zeroPoint[id] = 0; });
    points.push(zeroPoint);
  }

  for (const trade of trades) {
    const rawProfit = trade.profit_abs ?? 0;
    const profitAbs = convertProfit(rawProfit, trade.botId);
    cumTotal += profitAbs;
    cumPerBot[trade.botId] = (cumPerBot[trade.botId] ?? 0) + profitAbs;

    const point: CumPoint = { date: trade.close_timestamp, combined: cumTotal };
    botIds.value.forEach((id) => { point[id] = cumPerBot[id] ?? 0; });
    points.push(point);
  }

  return points;
});

// --- Normalized data (always % from start) ---
const normalizedData = computed<CumPoint[]>(() => {
  const raw = cumulativeData.value;
  if (raw.length === 0) return [];

  const startBal = totalStartingBalance.value;
  const perBotBal = startingBalancePerBot.value;

  return raw.map((p) => {
    const pct: CumPoint = {
      date: p.date,
      combined: (p.combined / startBal) * 100,
    };
    botIds.value.forEach((id) => {
      const bal = perBotBal[id] ?? 1;
      pct[id] = ((p[id] ?? 0) / bal) * 100;
    });
    return pct;
  });
});

// --- Benchmark data ---
const benchmarkRawData = ref<Record<string, PricePoint[]>>({});

async function loadBenchmarks() {
  const days = timeframeToDays(selectedTimeframe.value);
  const toFetch = enabledBenchmarks.value.filter((t) => t.length > 0);
  if (toFetch.length === 0) {
    benchmarkRawData.value = {};
    return;
  }

  benchmarkLoading.value = true;
  try {
    const results = await Promise.all(
      toFetch.map((ticker) => fetchBenchmarkHistory(ticker, days)),
    );
    const newData: Record<string, PricePoint[]> = {};
    const cutoff = getTimeframeCutoff(selectedTimeframe.value);
    toFetch.forEach((ticker, i) => {
      const fetchResult = results[i];
      let data = fetchResult?.data ?? [];
      // Filter benchmark data to match the selected timeframe cutoff
      // This ensures proper alignment even when CoinGecko returns extra data points
      if (cutoff > 0 && data.length > 0) {
        data = data.filter((p) => p.timestamp >= cutoff);
      }
      newData[ticker] = data;
    });
    benchmarkRawData.value = newData;
  } finally {
    benchmarkLoading.value = false;
  }
}

watch([enabledBenchmarks, selectedTimeframe], () => {
  loadBenchmarks();
}, { immediate: true, deep: true });

/**
 * Benchmark data normalized based on current normMode:
 * - pctFromStart / pctFromCapital: % change from start (for direct comparison)
 * - absolute: USD price change from start (rebased to 0, on 2nd y-axis)
 */
const benchmarkNormalized = computed<Record<string, PricePoint[]>>(() => {
  const result: Record<string, PricePoint[]> = {};
  for (const [ticker, data] of Object.entries(benchmarkRawData.value)) {
    if (data.length === 0) continue;
    result[ticker] = normalizeToPercent(data);
  }
  return result;
});

// --- Statistics ---
interface PeriodStats {
  periodReturn: number;
  periodReturnPct: number;
  vsBTC: number | null;
  sharpe: number | null;
  maxDrawdown: number | null;
  maxDrawdownPct: number | null;
  winRate: number | null;
}

const periodStats = computed<PeriodStats>(() => {
  const trades = filteredTrades.value;
  const totalProfit = trades.reduce((s, tr) => s + convertProfit(tr.profit_abs ?? 0, tr.botId), 0);
  const pctReturn = (totalProfit / totalStartingBalance.value) * 100;

  // vs BTC
  let vsBTC: number | null = null;
  const btcNorm = benchmarkNormalized.value['BTC'];
  if (btcNorm && btcNorm.length >= 2) {
    const btcReturn = btcNorm[btcNorm.length - 1]!.price;
    vsBTC = pctReturn - btcReturn;
  }

  // Aggregate metrics from bots
  let totalWins = 0;
  let totalTrades = 0;
  let weightedSharpe = 0;
  let maxDD = 0;
  let maxDDPct = 0;
  let botCount = 0;

  for (const bot of botStore.selectedBots) {
    const profit = bot.profit;
    if (!profit) continue;
    botCount++;
    totalWins += profit.winning_trades ?? 0;
    totalTrades += profit.trade_count ?? 0;
    weightedSharpe += profit.sharpe ?? 0;
    if ((profit.max_drawdown_abs ?? 0) > maxDD) maxDD = profit.max_drawdown_abs ?? 0;
    if ((profit.max_drawdown ?? 0) > maxDDPct) maxDDPct = profit.max_drawdown ?? 0;
  }

  return {
    periodReturn: totalProfit,
    periodReturnPct: pctReturn,
    vsBTC,
    sharpe: botCount > 0 ? weightedSharpe / botCount : null,
    maxDrawdown: maxDD > 0 ? maxDD : null,
    maxDrawdownPct: maxDDPct > 0 ? maxDDPct : null,
    winRate: totalTrades > 0 ? (totalWins / totalTrades) * 100 : null,
  };
});

// --- Chart series builders ---
function buildCombinedSeries(): any[] {
  const series: any[] = [];

  series.push({
    type: 'line',
    name: t('profitBenchmark.combined'),
    smooth: true,
    symbol: 'none',
    lineStyle: { width: 2.5, color: colorStore.colorProfit },
    itemStyle: { color: colorStore.colorProfit },
    areaStyle: {
      color: {
        type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
        colorStops: [
          { offset: 0, color: colorStore.colorProfit + '40' },
          { offset: 1, color: colorStore.colorProfit + '05' },
        ],
      },
    },
    encode: { x: 'date', y: 'combined' },
    animationDuration: 1500,
    animationEasing: 'cubicOut',
  });

  // Open trades projection
  const data = normalizedData.value;
  if (props.openTrades.length > 0 && data.length > 0) {
    const lastPoint = data[data.length - 1]!;
    const totalOpen = Object.values(openProfitPerBot.value).reduce((s, v) => s + v, 0);
    const projectedValue = lastPoint.combined + (totalOpen / totalStartingBalance.value) * 100;

    series.push({
      type: 'line',
      name: t('profitBenchmark.projected'),
      symbol: 'none',
      lineStyle: { width: 2, type: 'dashed', color: totalOpen >= 0 ? colorStore.colorProfit : colorStore.colorLoss },
      itemStyle: { color: totalOpen >= 0 ? colorStore.colorProfit : colorStore.colorLoss },
      data: [
        [lastPoint.date, lastPoint.combined],
        [Date.now() + 12 * 60 * 60 * 1000, projectedValue],
      ],
    });
  }

  return series;
}

function buildPerBotSeries(): any[] {
  return botIds.value.map((botId, idx) => ({
    type: 'line',
    name: botNameMap.value[botId] ?? botId,
    smooth: true,
    symbol: 'none',
    lineStyle: { width: 2, color: getBotColor(idx) },
    itemStyle: { color: getBotColor(idx) },
    encode: { x: 'date', y: botId },
  }));
}

/**
 * Build benchmark series.
 *
 * CRITICAL LOGIC:
 * - In "% from start" and "% from capital" modes:
 *   Benchmarks are on the SAME y-axis as profit (both in %).
 *   My profit = cumulative_profit / starting_capital * 100 (starts at 0%)
 *   BTC = (btc_price_now / btc_price_start - 1) * 100 (starts at 0%)
 *   => Direct comparison on same axis.
 *
 * - In "absolute" mode:
 *   Benchmarks use a SECOND y-axis showing % price change.
 *   This lets you see the shape but scales are different.
 */
function buildBenchmarkSeries(): any[] {
  const series: any[] = [];

  for (const ticker of enabledBenchmarks.value) {
    const data = benchmarkNormalized.value[ticker];
    if (!data || data.length === 0) continue;

    const color = getBenchmarkColor(ticker);
    series.push({
      type: 'line',
      name: ticker,
      smooth: true,
      symbol: 'none',
      animationDuration: 1500,
      animationEasing: 'cubicOut',
      animationDurationUpdate: 500,
      lineStyle: { width: 1.8, color, type: 'dotted' },
      itemStyle: { color },
      data: data.map((p) => [p.timestamp, p.price]),
    });
  }

  return series;
}

// --- Chart options ---
const chartOptions = computed<EChartsOption>(() => {
  const activeBenchmarks = enabledBenchmarks.value.filter(
    (t) => benchmarkNormalized.value[t] && benchmarkNormalized.value[t].length > 0,
  );

  const tabSeries = activeTab.value === 'perBot' ? buildPerBotSeries() : buildCombinedSeries();

  const benchmarkSeries = buildBenchmarkSeries();
  const allSeries = [...tabSeries, ...benchmarkSeries];

  // Legend data
  const legendData: string[] = [];
  if (activeTab.value === 'perBot') {
    botIds.value.forEach((id) => legendData.push(botNameMap.value[id] ?? id));
  } else {
    legendData.push(t('profitBenchmark.combined'));

    if (props.openTrades.length > 0 && activeTab.value === 'combined') {
      legendData.push(t('profitBenchmark.projected'));
    }
  }
  for (const ticker of activeBenchmarks) {
    legendData.push(ticker);
  }

  const yAxes: any[] = [
    {
      type: 'value',
      name: t('profitBenchmark.profitPct'),
      nameTextStyle: { color: '#808098', fontSize: 10 },
      splitLine: { show: true, lineStyle: { color: 'rgba(100, 100, 140, 0.08)', type: 'dashed' } },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: '#808098', fontSize: 10,
        formatter: (value: number) => `${value.toFixed(1)}%`,
      },
      nameRotate: 90, nameLocation: 'middle', nameGap: 45,
    },
  ];

  const dims = ['date', 'combined', ...botIds.value];

  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    dataset: {
      dimensions: dims,
      source: normalizedData.value,
    },
    animationDuration: 1500,
    animationEasing: 'cubicOut',
    animationDurationUpdate: 500,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', crossStyle: { color: '#555' } },
      backgroundColor: 'rgba(15, 15, 25, 0.92)',
      borderColor: 'rgba(100, 100, 140, 0.3)',
      borderWidth: 1,
      textStyle: { color: '#e0e0e0', fontSize: 12 },
      formatter: (params: any) => {
        if (!params || params.length === 0) return '';
        const date = timestampToDateString(params[0].data?.date ?? params[0].data?.[0] ?? params[0].axisValue);
        let html = `<div style="font-size:11px">`;
        html += `<div style="color:#aaa;margin-bottom:4px">${date}</div>`;

        let profitValue: number | null = null;
        const benchmarkValues: Record<string, number> = {};

        for (const p of params) {
          let val: number;
          if (Array.isArray(p.value)) {
            val = p.value?.[1] ?? 0;
          } else if (typeof p.value === 'object' && p.value !== null) {
            const yDimIndex = p.encode?.y?.[0];
            const dimName = yDimIndex !== undefined ? p.dimensionNames?.[yDimIndex] : undefined;
            val = dimName ? (p.value[dimName] ?? 0) : (p.value.combined ?? 0);
          } else {
            val = 0;
          }
          const isBenchmark = enabledBenchmarks.value.includes(p.seriesName);
          if (isBenchmark) {
            benchmarkValues[p.seriesName] = val;
          } else if (p.seriesName === t('profitBenchmark.combined') || activeTab.value === 'perBot') {
            if (profitValue === null) profitValue = val;
          }
          const formatted = `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
          html += `<div style="display:flex;justify-content:space-between;gap:12px">`
            + `<span>${p.marker} ${p.seriesName}</span>`
            + `<span style="font-weight:600">${formatted}</span></div>`;
        }

        // Show outperformance comparison for each benchmark
        if (profitValue !== null) {
          for (const [ticker, bVal] of Object.entries(benchmarkValues)) {
            const diff = profitValue - bVal;
            const color = diff >= 0 ? '#22c55e' : '#ef4444';
            const word = diff >= 0
              ? t('profitBenchmark.outperforming')
              : t('profitBenchmark.underperforming');
            html += `<div style="color:${color};font-weight:bold;margin-top:4px">`
              + `${word} ${ticker} ${t('profitBenchmark.by')} ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%</div>`;
          }
        }

        html += `</div>`;
        return html;
      },
      axisPointer: {
        type: 'cross',
        label: { backgroundColor: 'rgba(30, 30, 50, 0.9)' },
        lineStyle: { color: 'rgba(100, 100, 150, 0.4)', type: 'dashed' },
        crossStyle: { color: 'rgba(100, 100, 150, 0.4)' },
      },
    },
    legend: {
      data: legendData,
      top: 4,
      right: '5%',
      textStyle: { color: '#a0a0b0', fontSize: 11 },
      icon: 'roundRect',
      itemWidth: 14,
      itemHeight: 8,
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: 'rgba(100, 100, 140, 0.2)' } },
      axisTick: { lineStyle: { color: 'rgba(100, 100, 140, 0.2)' } },
      axisLabel: { color: '#808098', fontSize: 10 },
      splitLine: { show: true, lineStyle: { color: 'rgba(100, 100, 140, 0.08)', type: 'dashed' } },
    },
    yAxis: yAxes,
    grid: { left: '60', right: '20', top: '35', bottom: '65' },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100, height: 20, bottom: 5 },
    ],
    series: allSeries,
  };
});

// --- Chart description ---
const chartDescription = computed(() => {
  const tab = activeTab.value;
  const tf = selectedTimeframe.value;
  const benchmarks = enabledBenchmarks.value;

  let desc = tab === 'combined' ? t('profitBenchmark.descCombined') : t('profitBenchmark.descPerBot');
  desc += ` ${t('profitBenchmark.descOverPeriod', { period: tf })}`;
  desc += `, ${t('profitBenchmark.descNormPctStart')}`;

  if (benchmarks.length > 0) {
    desc += `. ${t('profitBenchmark.descBenchmarks', { list: benchmarks.join(', ') })}`;
    desc += ` ${t('profitBenchmark.descBenchmarkHint')}`;
  }

  return desc;
});

// --- CSV export ---
function exportCSV() {
  const data = normalizedData.value;
  if (data.length === 0) return;

  const headers = ['Date', 'Combined'];
  botIds.value.forEach((id) => headers.push(botNameMap.value[id] ?? id));

  const rows = data.map((p) => {
    const row = [
      new Date(p.date).toISOString(),
      p.combined.toFixed(4),
    ];
    botIds.value.forEach((id) => row.push((p[id] ?? 0).toFixed(4)));
    return row.join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `profit_benchmark_${selectedTimeframe.value}_${normMode.value}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// --- PNG export via ECharts getDataURL ---
function exportChartImage() {
  const echart = chart.value?.chart ?? chart.value;
  if (echart && typeof echart.getDataURL === 'function') {
    const url = echart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#1a1a2e' });
    const a = document.createElement('a');
    a.href = url;
    a.download = `profit_benchmark_${selectedTimeframe.value}_${normMode.value}.png`;
    a.click();
  }
}

// Watch for theme changes
watch(() => settingsStore.chartTheme, () => { /* force re-render via computed */ });
</script>

<template>
  <div class="flex flex-col h-full w-full profit-benchmark">
    <!-- Controls bar -->
    <div class="flex flex-wrap items-center gap-2 px-1 pb-1 controls-bar">
      <!-- Tab pills -->
      <div class="flex gap-0.5">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all duration-150 cursor-pointer"
          :class="
            activeTab === tab.key
              ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
              : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
          "
          @click="activeTab = tab.key"
        >
          {{ t(tab.labelKey) }}
        </button>
      </div>

      <div class="w-px h-4 bg-gray-600/30"></div>

      <!-- Timeframe pills -->
      <div class="flex gap-0.5 tf-pills">
        <button
          v-for="tf in timeframes"
          :key="tf"
          class="px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all duration-150 cursor-pointer"
          :class="
            selectedTimeframe === tf
              ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
              : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
          "
          @click="selectedTimeframe = tf"
        >
          {{ tf }}
        </button>
      </div>

      <div class="flex-1"></div>

      <!-- Benchmark toggles -->
      <div class="flex gap-1 items-center relative">
        <template v-for="ticker in enabledBenchmarks" :key="ticker">
          <button
            class="px-1.5 py-0.5 text-[10px] font-semibold rounded-md transition-all duration-150 cursor-pointer ring-1"
            :style="{
              backgroundColor: getBenchmarkColor(ticker) + '20',
              color: getBenchmarkColor(ticker),
              borderColor: getBenchmarkColor(ticker) + '40',
              '--tw-ring-color': getBenchmarkColor(ticker) + '40',
            }"
            :title="t('profitBenchmark.removeBenchmark', { coin: ticker })"
            @click="removeBenchmark(ticker)"
          >
            {{ ticker }}
            <span class="ml-0.5 opacity-60">x</span>
          </button>
        </template>

        <!-- Add benchmark button -->
        <div class="relative">
          <button
            class="px-1.5 py-0.5 text-[10px] font-semibold rounded-md transition-all duration-150 cursor-pointer text-gray-500 hover:text-gray-300 hover:bg-white/5 border border-dashed border-gray-600/30"
            :title="t('profitBenchmark.addBenchmark')"
            @click="showBenchmarkDropdown = !showBenchmarkDropdown"
          >
            +
          </button>

          <!-- Dropdown -->
          <div
            v-if="showBenchmarkDropdown"
            class="absolute right-0 top-full mt-1 z-50 bg-gray-800 border border-gray-600/50 rounded-lg shadow-xl p-2 min-w-[160px]"
          >
            <div class="max-h-[300px] overflow-y-auto">
              <template v-for="cat in BENCHMARK_CATEGORIES" :key="cat.label">
                <div class="text-[9px] text-gray-500 uppercase tracking-wide font-semibold mt-1.5 mb-0.5 px-1">
                  {{ cat.label }}
                </div>
                <template v-for="ticker in cat.tickers" :key="ticker">
                  <button
                    class="flex items-center gap-2 w-full px-2 py-0.5 text-[10px] rounded cursor-pointer transition-colors"
                    :class="enabledBenchmarks.includes(ticker) ? 'text-white bg-white/10' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'"
                    @click="toggleBenchmark(ticker)"
                  >
                    <span
                      class="w-2 h-2 rounded-full flex-shrink-0"
                      :style="{ backgroundColor: enabledBenchmarks.includes(ticker) ? getBenchmarkColor(ticker) : '#6b7280' }"
                    ></span>
                    {{ ticker }}
                    <span v-if="enabledBenchmarks.includes(ticker)" class="ml-auto text-[8px] text-green-400">ON</span>
                  </button>
                </template>
              </template>
            </div>
            <div class="border-t border-gray-600/30 mt-1.5 pt-1.5">
              <div class="text-[9px] text-gray-500 px-1 mb-1">{{ t('profitBenchmark.customCoinGecko') }}</div>
              <form class="flex gap-1" @submit.prevent="addCustomBenchmark">
                <input
                  v-model="customBenchmarkInput"
                  type="text"
                  class="flex-1 px-1.5 py-0.5 text-[10px] bg-gray-700 border border-gray-600/50 rounded text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
                  :class="{ 'border-red-500/60': customBenchmarkError }"
                  :placeholder="t('profitBenchmark.customPlaceholder')"
                  @input="customBenchmarkError = ''"
                />
                <button
                  type="submit"
                  class="px-1.5 py-0.5 text-[10px] bg-indigo-500/20 text-indigo-300 rounded hover:bg-indigo-500/30 cursor-pointer"
                  :disabled="benchmarkLoading"
                >
                  {{ benchmarkLoading ? '...' : t('profitBenchmark.add') }}
                </button>
              </form>
              <div
                v-if="customBenchmarkError"
                class="text-[9px] text-red-400 px-1 mt-1"
              >
                {{ customBenchmarkError }}
              </div>
            </div>
          </div>
        </div>

        <span v-if="benchmarkLoading" class="text-[9px] text-gray-500 ml-1 animate-pulse">...</span>
      </div>

      <div class="w-px h-4 bg-gray-600/30"></div>

      <!-- Export PNG -->
      <button
        class="px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-gray-200 hover:bg-white/5 rounded transition-all cursor-pointer"
        :title="t('profitBenchmark.exportPNG')"
        @click="exportChartImage"
      >
        <i-mdi-image class="inline w-3.5 h-3.5" />
      </button>
    </div>

    <!-- Stats strip -->
    <div class="flex flex-wrap gap-3 px-2 py-1 text-[10px] period-stats">
      <div class="flex items-center gap-1">
        <span class="text-gray-500" v-tooltip.top="t('tooltips.periodReturn')">{{ t('profitBenchmark.periodReturn') }}</span>
        <span
          :class="periodStats.periodReturn >= 0 ? 'text-emerald-400' : 'text-red-400'"
          class="font-semibold"
        >
          {{ formatPrice(periodStats.periodReturn, 2) }}
          <span class="text-gray-500 font-normal">({{ periodStats.periodReturnPct >= 0 ? '+' : '' }}{{ periodStats.periodReturnPct.toFixed(2) }}%)</span>
        </span>
      </div>
      <div v-if="periodStats.vsBTC !== null" class="flex items-center gap-1">
        <span class="text-gray-500">{{ t('profitBenchmark.vsBTC') }}</span>
        <span
          :class="(periodStats.vsBTC ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'"
          class="font-semibold"
        >
          {{ (periodStats.vsBTC ?? 0) >= 0 ? '+' : '' }}{{ (periodStats.vsBTC ?? 0).toFixed(2) }}%
        </span>
      </div>
      <div v-if="periodStats.sharpe !== null" class="flex items-center gap-1">
        <span class="text-gray-500 uppercase tracking-wide" v-tooltip.top="t('tooltips.sharpe')">{{ t('profitBenchmark.sharpe') }}</span>
        <span
          class="font-bold"
          :class="(periodStats.sharpe ?? 0) >= 1 ? 'text-emerald-400' : (periodStats.sharpe ?? 0) >= 0 ? 'text-amber-400' : 'text-red-400'"
        >
          {{ (periodStats.sharpe ?? 0).toFixed(2) }}
        </span>
      </div>
      <div v-if="periodStats.maxDrawdownPct !== null" class="flex items-center gap-1">
        <span class="text-gray-500 uppercase tracking-wide">{{ t('profitBenchmark.maxDD') }}</span>
        <span class="font-bold text-red-400">
          {{ ((periodStats.maxDrawdownPct ?? 0) * 100).toFixed(1) }}%
        </span>
      </div>
      <div v-if="periodStats.winRate !== null" class="flex items-center gap-1">
        <span class="text-gray-500 uppercase tracking-wide" v-tooltip.top="t('tooltips.winrate')">{{ t('profitBenchmark.winRate') }}</span>
        <span
          class="font-bold"
          :class="(periodStats.winRate ?? 0) >= 60 ? 'text-emerald-400' : (periodStats.winRate ?? 0) >= 50 ? 'text-amber-400' : 'text-red-400'"
        >
          {{ (periodStats.winRate ?? 0).toFixed(1) }}%
        </span>
      </div>
    </div>

    <!-- Chart -->
    <div class="flex-1 min-h-0">
      <ECharts
        v-if="normalizedData.length > 0"
        ref="chart"
        :option="chartOptions"
        :theme="settingsStore.chartTheme"
        autoresize
        class="w-full h-full"
      />
      <div
        v-else
        class="flex items-center justify-center h-full text-gray-500 text-sm"
      >
        {{ t('profitBenchmark.noData') }}
      </div>
    </div>

    <!-- Benchmark loading indicator -->
    <div v-if="benchmarkLoading && enabledBenchmarks.length > 0" class="flex items-center justify-center gap-2 py-1">
      <i-mdi-loading class="animate-spin text-blue-400" style="font-size: 0.8rem" />
      <span class="text-xs text-gray-400">{{ t('profitBenchmark.loadingBenchmarks') }}</span>
    </div>

    <!-- Description: icon-only with tooltip (no visible text to avoid overlap) -->
    <div class="flex justify-end px-2 flex-shrink-0">
      <span
        v-tooltip.left="{ value: chartDescription, class: 'max-w-sm text-xs' }"
        class="cursor-help opacity-30 hover:opacity-70 transition-opacity"
      >
        <i-mdi-information-outline class="w-3.5 h-3.5 text-blue-400" />
      </span>
    </div>

    <!-- Click-away overlay for dropdown -->
    <div
      v-if="showBenchmarkDropdown"
      class="fixed inset-0 z-40"
      @click="showBenchmarkDropdown = false"
    ></div>
  </div>
</template>

<style scoped>
.profit-benchmark {
  --glass-bg: rgba(15, 15, 25, 0.6);
  --glass-border: rgba(100, 100, 140, 0.15);
}

.controls-bar {
  border-bottom: 1px solid var(--glass-border);
}

.period-stats {
  background: rgba(100, 100, 160, 0.04);
}

.echarts {
  width: 100%;
  height: 100%;
  min-height: 150px;
}
</style>
