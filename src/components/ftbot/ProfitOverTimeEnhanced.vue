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
  ToolboxComponent,
  MarkAreaComponent,
  MarkLineComponent,
} from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

import type { ClosedTrade, Trade } from '@/types';
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
  TitleComponent,
  TooltipComponent,
  ToolboxComponent,
  MarkAreaComponent,
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

const currencyLabel = computed(() => {
  if (summaryCurrency.value && summaryCurrency.value !== 'auto') {
    return ` (${summaryCurrency.value})`;
  }
  return '';
});

const chart = ref<InstanceType<typeof ECharts>>();

// --- State ---
type TimeframeKey = '1D' | '7D' | '30D' | '90D' | 'YTD' | 'ALL';
type ViewMode = 'combined' | 'perBot' | 'stacked';
type ProfitType = 'absolute' | 'percentage';

const selectedTimeframe = ref<TimeframeKey>('ALL');
const selectedViewMode = ref<ViewMode>('combined');
const selectedProfitType = ref<ProfitType>('absolute');

const timeframeOptions: TimeframeKey[] = ['1D', '7D', '30D', '90D', 'YTD', 'ALL'];

// Bot color palette -- distinct colors for multi-bot view
const BOT_COLORS = [
  '#6366f1', // indigo
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
  '#14b8a6', // teal
  '#84cc16', // lime
];

function getBotColor(index: number): string {
  return BOT_COLORS[index % BOT_COLORS.length] ?? '#6366f1';
}

// --- Timeframe filter ---
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
      const d = new Date();
      return new Date(d.getFullYear(), 0, 1).getTime();
    }
    case 'ALL':
    default:
      return 0;
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
    const p = tr.total_profit_abs ?? tr.profit_abs ?? 0;
    result[tr.botId] = (result[tr.botId] ?? 0) + p;
  });
  return result;
});

// --- Starting balance per bot (for percentage mode) ---
const startingBalancePerBot = computed<Record<string, number>>(() => {
  const result: Record<string, number> = {};
  for (const bot of botStore.selectedBots) {
    const profit = bot.profit;
    if (profit && profit.bot_start_timestamp) {
      // Use balance - total profit as rough starting balance
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

// --- Build cumulative data series ---
interface CumPoint {
  date: number;
  combined: number;
  [botId: string]: number;
}

const cumulativeData = computed<CumPoint[]>(() => {
  const trades = filteredTrades.value;
  if (trades.length === 0) return [];

  const cumPerBot: Record<string, number> = {};
  botIds.value.forEach((id) => {
    cumPerBot[id] = 0;
  });
  let cumTotal = 0;

  const points: CumPoint[] = [];

  // Insert a zero-point at the start
  const firstTrade = trades[0];
  if (firstTrade) {
    const zeroPoint: CumPoint = { date: firstTrade.open_timestamp, combined: 0 };
    botIds.value.forEach((id) => {
      zeroPoint[id] = 0;
    });
    points.push(zeroPoint);
  }

  for (const trade of trades) {
    const profitAbs = trade.profit_abs ?? 0;
    cumTotal += profitAbs;
    cumPerBot[trade.botId] = (cumPerBot[trade.botId] ?? 0) + profitAbs;

    const point: CumPoint = { date: trade.close_timestamp, combined: cumTotal };
    botIds.value.forEach((id) => {
      point[id] = cumPerBot[id] ?? 0;
    });
    points.push(point);
  }

  return points;
});

// Percentage-converted data
const cumulativeDataPct = computed<CumPoint[]>(() => {
  if (selectedProfitType.value !== 'percentage') return [];
  const startBal = totalStartingBalance.value;
  const perBotBal = startingBalancePerBot.value;

  return cumulativeData.value.map((p) => {
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

const chartData = computed(() => {
  return selectedProfitType.value === 'percentage' ? cumulativeDataPct.value : cumulativeData.value;
});

// --- Period statistics ---
interface PeriodStats {
  periodReturn: number;
  periodReturnPct: number;
  bestDay: number;
  worstDay: number;
  avgDaily: number;
  totalTrades: number;
}

const periodStats = computed<PeriodStats>(() => {
  const trades = filteredTrades.value;
  if (trades.length === 0) {
    return {
      periodReturn: 0,
      periodReturnPct: 0,
      bestDay: 0,
      worstDay: 0,
      avgDaily: 0,
      totalTrades: 0,
    };
  }

  const totalProfit = trades.reduce((s, tr) => s + (tr.profit_abs ?? 0), 0);

  // Group by day
  const dailyProfits: Record<string, number> = {};
  trades.forEach((tr) => {
    const day = new Date(tr.close_timestamp).toISOString().slice(0, 10);
    dailyProfits[day] = (dailyProfits[day] ?? 0) + (tr.profit_abs ?? 0);
  });

  const dailyValues = Object.values(dailyProfits);
  const bestDay = dailyValues.length > 0 ? Math.max(...dailyValues) : 0;
  const worstDay = dailyValues.length > 0 ? Math.min(...dailyValues) : 0;
  const avgDaily =
    dailyValues.length > 0 ? dailyValues.reduce((s, v) => s + v, 0) / dailyValues.length : 0;

  return {
    periodReturn: totalProfit,
    periodReturnPct: (totalProfit / totalStartingBalance.value) * 100,
    bestDay,
    worstDay,
    avgDaily,
    totalTrades: trades.length,
  };
});

// --- Key metrics from bot profit stats ---
interface KeyMetrics {
  sharpe: number | null;
  maxDrawdown: number | null;
  maxDrawdownPct: number | null;
  winRate: number | null;
  profitFactor: number | null;
}

const keyMetrics = computed<KeyMetrics>(() => {
  let totalWins = 0;
  let totalLosses = 0;
  let totalTrades = 0;
  let weightedSharpe = 0;
  let maxDD = 0;
  let maxDDPct = 0;
  let totalProfitFactor = 0;
  let botCount = 0;

  for (const bot of botStore.selectedBots) {
    const profit = bot.profit;
    if (!profit) continue;
    botCount++;
    totalWins += profit.winning_trades ?? 0;
    totalLosses += profit.losing_trades ?? 0;
    totalTrades += profit.trade_count ?? 0;
    weightedSharpe += profit.sharpe ?? 0;
    if ((profit.max_drawdown_abs ?? 0) > maxDD) {
      maxDD = profit.max_drawdown_abs ?? 0;
    }
    if ((profit.max_drawdown ?? 0) > maxDDPct) {
      maxDDPct = profit.max_drawdown ?? 0;
    }
    totalProfitFactor += profit.profit_factor ?? 0;
  }

  return {
    sharpe: botCount > 0 ? weightedSharpe / botCount : null,
    maxDrawdown: maxDD > 0 ? maxDD : null,
    maxDrawdownPct: maxDDPct > 0 ? maxDDPct : null,
    winRate: totalTrades > 0 ? (totalWins / totalTrades) * 100 : null,
    profitFactor: botCount > 0 ? totalProfitFactor / botCount : null,
  };
});

// --- ECharts options ---
function buildSeries(): EChartsOption['series'] {
  const series: any[] = [];
  const isPercentage = selectedProfitType.value === 'percentage';

  if (selectedViewMode.value === 'combined') {
    series.push({
      type: 'line',
      name: t('profitEnhanced.combined'),
      smooth: true,
      symbol: 'none',
      lineStyle: {
        width: 2.5,
        color: colorStore.colorProfit,
      },
      itemStyle: {
        color: colorStore.colorProfit,
      },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: colorStore.colorProfit + '40' },
            { offset: 1, color: colorStore.colorProfit + '05' },
          ],
        },
      },
      encode: { x: 'date', y: 'combined' },
    });
  } else if (selectedViewMode.value === 'perBot') {
    botIds.value.forEach((botId, idx) => {
      series.push({
        type: 'line',
        name: botNameMap.value[botId] ?? botId,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          width: 2,
          color: getBotColor(idx),
        },
        itemStyle: {
          color: getBotColor(idx),
        },
        encode: { x: 'date', y: botId },
      });
    });
  } else {
    // stacked area
    botIds.value.forEach((botId, idx) => {
      series.push({
        type: 'line',
        name: botNameMap.value[botId] ?? botId,
        smooth: true,
        symbol: 'none',
        stack: 'total',
        areaStyle: {
          opacity: 0.6,
        },
        lineStyle: {
          width: 1.5,
          color: getBotColor(idx),
        },
        itemStyle: {
          color: getBotColor(idx),
        },
        encode: { x: 'date', y: botId },
      });
    });
  }

  // Open profit projection (combined mode only)
  if (selectedViewMode.value === 'combined' && props.openTrades.length > 0) {
    const data = chartData.value;
    if (data.length > 0) {
      const lastPoint = data[data.length - 1]!;
      const totalOpen = Object.values(openProfitPerBot.value).reduce((s, v) => s + v, 0);
      let projectedValue: number;

      if (isPercentage) {
        projectedValue = lastPoint.combined + (totalOpen / totalStartingBalance.value) * 100;
      } else {
        projectedValue = lastPoint.combined + totalOpen;
      }

      series.push({
        type: 'line',
        name: t('profitEnhanced.projected'),
        symbol: 'none',
        lineStyle: {
          width: 2,
          type: 'dashed',
          color: totalOpen >= 0 ? colorStore.colorProfit : colorStore.colorLoss,
        },
        itemStyle: {
          color: totalOpen >= 0 ? colorStore.colorProfit : colorStore.colorLoss,
        },
        data: [
          [lastPoint.date, lastPoint.combined],
          [Date.now() + 12 * 60 * 60 * 1000, projectedValue],
        ],
      });
    }
  }

  return series;
}

function buildDimensions(): string[] {
  const dims = ['date', 'combined'];
  botIds.value.forEach((id) => dims.push(id));
  return dims;
}

const chartOptions = computed<EChartsOption>(() => {
  const isPercentage = selectedProfitType.value === 'percentage';
  const suffix = isPercentage ? '%' : '';

  const legendData: string[] = [];
  if (selectedViewMode.value === 'combined') {
    legendData.push(t('profitEnhanced.combined'));
  } else {
    botIds.value.forEach((id) => {
      legendData.push(botNameMap.value[id] ?? id);
    });
  }

  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    dataset: {
      dimensions: buildDimensions(),
      source: chartData.value,
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(15, 15, 25, 0.92)',
      borderColor: 'rgba(100, 100, 140, 0.3)',
      borderWidth: 1,
      textStyle: {
        color: '#e0e0e0',
        fontSize: 12,
      },
      formatter: (params: any) => {
        if (!params || params.length === 0) return '';
        const date = timestampToDateString(params[0].data?.date ?? params[0].data?.[0]);
        let html = `<div style="font-weight:600;margin-bottom:4px;color:#a0a0c0">${date}</div>`;

        for (const p of params) {
          let val: number;
          if (Array.isArray(p.value)) {
            // Projected line uses raw [x, y] arrays
            val = p.value?.[1] ?? 0;
          } else if (typeof p.value === 'object' && p.value !== null) {
            // Dataset-based series: use encode.y dimension name to get the correct value per series
            const yDimIndex = p.encode?.y?.[0];
            const dimName = yDimIndex !== undefined ? p.dimensionNames?.[yDimIndex] : undefined;
            val = dimName ? (p.value[dimName] ?? 0) : (p.value.combined ?? 0);
          } else {
            val = 0;
          }
          const formatted = isPercentage ? `${val.toFixed(2)}%` : formatPrice(val, 2);
          html +=
            `<div style="display:flex;justify-content:space-between;gap:12px">` +
            `<span>${p.marker} ${p.seriesName}</span>` +
            `<span style="font-weight:600">${formatted}</span></div>`;
        }
        return html;
      },
      axisPointer: {
        type: 'cross',
        label: {
          backgroundColor: 'rgba(30, 30, 50, 0.9)',
        },
        lineStyle: {
          color: 'rgba(100, 100, 150, 0.4)',
          type: 'dashed',
        },
        crossStyle: {
          color: 'rgba(100, 100, 150, 0.4)',
        },
      },
    },
    legend: {
      data: legendData,
      top: 4,
      right: '5%',
      textStyle: {
        color: settingsStore.isDarkTheme ? '#a0a0b0' : '#555',
        fontSize: 11,
      },
      icon: 'roundRect',
      itemWidth: 14,
      itemHeight: 8,
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: 'rgba(100, 100, 140, 0.2)' } },
      axisTick: { lineStyle: { color: 'rgba(100, 100, 140, 0.2)' } },
      axisLabel: {
        color: settingsStore.isDarkTheme ? '#808098' : '#555',
        fontSize: 10,
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: 'rgba(100, 100, 140, 0.08)',
          type: 'dashed',
        },
      },
    },
    yAxis: [
      {
        type: 'value',
        name: isPercentage
          ? t('profitEnhanced.profitPct')
          : t('profitEnhanced.profitAbs') + currencyLabel.value,
        nameTextStyle: {
          color: settingsStore.isDarkTheme ? '#808098' : '#555',
          fontSize: 10,
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: 'rgba(100, 100, 140, 0.08)',
            type: 'dashed',
          },
        },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: settingsStore.isDarkTheme ? '#808098' : '#555',
          fontSize: 10,
          formatter: (value: number) => {
            return isPercentage ? `${value.toFixed(1)}%` : formatPrice(value, 1);
          },
        },
        nameRotate: 90,
        nameLocation: 'middle',
        nameGap: 45,
      },
    ],
    grid: {
      left: '60',
      right: '20',
      top: '35',
      bottom: '45',
    },
    dataZoom: [
      {
        type: 'inside',
        start: 0,
        end: 100,
      },
    ],
    series: buildSeries(),
  };
});

// --- CSV export ---
function exportCSV() {
  const data = chartData.value;
  if (data.length === 0) return;

  const isPercentage = selectedProfitType.value === 'percentage';
  const headers = ['Date', 'Combined'];
  botIds.value.forEach((id) => headers.push(botNameMap.value[id] ?? id));

  const rows = data.map((p) => {
    const row = [new Date(p.date).toISOString(), p.combined.toFixed(4)];
    botIds.value.forEach((id) => row.push((p[id] ?? 0).toFixed(4)));
    return row.join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `profit_${selectedTimeframe.value}_${isPercentage ? 'pct' : 'abs'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Watch for theme changes
watch(
  () => settingsStore.chartTheme,
  () => {
    // Force re-render
  },
);
</script>

<template>
  <div class="flex flex-col h-full w-full profit-enhanced">
    <!-- Controls bar -->
    <div class="flex flex-wrap items-center gap-2 px-1 pb-1 controls-bar">
      <!-- Timeframe pills -->
      <div class="flex gap-0.5 tf-pills">
        <button
          v-for="tf in timeframeOptions"
          :key="tf"
          class="px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all duration-150 cursor-pointer"
          :class="
            selectedTimeframe === tf
              ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5'
          "
          @click="selectedTimeframe = tf"
        >
          {{ tf }}
        </button>
      </div>

      <div class="w-px h-4 bg-gray-300 dark:bg-gray-600/30"></div>

      <!-- View mode pills -->
      <div class="flex gap-0.5">
        <button
          class="px-2 py-0.5 text-[10px] font-medium rounded-md transition-all duration-150 cursor-pointer"
          :class="
            selectedViewMode === 'combined'
              ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5'
          "
          :title="t('profitEnhanced.combinedMode')"
          @click="selectedViewMode = 'combined'"
        >
          <i-mdi-chart-line class="inline w-3 h-3" />
        </button>
        <button
          class="px-2 py-0.5 text-[10px] font-medium rounded-md transition-all duration-150 cursor-pointer"
          :class="
            selectedViewMode === 'perBot'
              ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5'
          "
          :title="t('profitEnhanced.perBotMode')"
          @click="selectedViewMode = 'perBot'"
        >
          <i-mdi-chart-multiple class="inline w-3 h-3" />
        </button>
        <button
          class="px-2 py-0.5 text-[10px] font-medium rounded-md transition-all duration-150 cursor-pointer"
          :class="
            selectedViewMode === 'stacked'
              ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5'
          "
          :title="t('profitEnhanced.stackedMode')"
          @click="selectedViewMode = 'stacked'"
        >
          <i-mdi-chart-areaspline class="inline w-3 h-3" />
        </button>
      </div>

      <div class="w-px h-4 bg-gray-300 dark:bg-gray-600/30"></div>

      <!-- Profit type toggle -->
      <div class="flex gap-0.5">
        <button
          class="px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all duration-150 cursor-pointer"
          :class="
            selectedProfitType === 'absolute'
              ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5'
          "
          @click="selectedProfitType = 'absolute'"
        >
          {{ t('profitEnhanced.absLabel') }}
        </button>
        <button
          class="px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all duration-150 cursor-pointer"
          :class="
            selectedProfitType === 'percentage'
              ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5'
          "
          @click="selectedProfitType = 'percentage'"
        >
          %
        </button>
      </div>

      <!-- Spacer + export -->
      <div class="flex-1"></div>
      <button
        class="px-1.5 py-0.5 text-[10px] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 rounded transition-all cursor-pointer"
        :title="t('profitEnhanced.exportCSV')"
        @click="exportCSV"
      >
        <i-mdi-download class="inline w-3.5 h-3.5" />
      </button>
    </div>

    <!-- Period stats strip -->
    <div class="flex flex-wrap gap-3 px-2 py-1 text-[10px] period-stats">
      <div class="flex items-center gap-1">
        <span class="text-gray-600 dark:text-gray-500">{{ t('profitEnhanced.periodReturn') }}</span>
        <span
          :class="periodStats.periodReturn >= 0 ? 'text-emerald-400' : 'text-red-400'"
          class="font-semibold"
        >
          {{ formatPrice(periodStats.periodReturn, 2) }}
          <span
            v-if="currencyLabel"
            class="text-gray-600 dark:text-gray-500 font-normal text-[0.6rem]"
            >{{ currencyLabel.trim() }}</span
          >
          <span class="text-gray-600 dark:text-gray-500 font-normal"
            >({{ periodStats.periodReturnPct.toFixed(2) }}%)</span
          >
        </span>
      </div>
      <div class="flex items-center gap-1">
        <span class="text-gray-600 dark:text-gray-500">{{ t('profitEnhanced.bestDay') }}</span>
        <span class="text-emerald-400 font-semibold">{{
          formatPrice(periodStats.bestDay, 2)
        }}</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="text-gray-600 dark:text-gray-500">{{ t('profitEnhanced.worstDay') }}</span>
        <span class="text-red-400 font-semibold">{{ formatPrice(periodStats.worstDay, 2) }}</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="text-gray-600 dark:text-gray-500">{{ t('profitEnhanced.avgDaily') }}</span>
        <span
          :class="periodStats.avgDaily >= 0 ? 'text-emerald-400' : 'text-red-400'"
          class="font-semibold"
        >
          {{ formatPrice(periodStats.avgDaily, 2) }}
        </span>
      </div>
      <div class="flex items-center gap-1">
        <span class="text-gray-600 dark:text-gray-500">{{ t('profitEnhanced.trades') }}</span>
        <span class="text-gray-700 dark:text-gray-300 font-semibold">{{
          periodStats.totalTrades
        }}</span>
      </div>
    </div>

    <!-- Chart -->
    <div class="flex-1 min-h-0">
      <ECharts
        v-if="chartData.length > 0"
        ref="chart"
        :option="chartOptions"
        :theme="settingsStore.chartTheme"
        autoresize
        class="w-full h-full"
      />
      <div
        v-else
        class="flex items-center justify-center h-full text-gray-600 dark:text-gray-500 text-sm"
      >
        {{ t('profitEnhanced.noData') }}
      </div>
    </div>

    <!-- Key metrics bar -->
    <div
      class="flex flex-wrap justify-center gap-4 px-2 py-1.5 metrics-bar border-t border-gray-300 dark:border-gray-700/30"
    >
      <div v-if="keyMetrics.sharpe !== null" class="flex items-center gap-1 text-[10px]">
        <span class="text-gray-600 dark:text-gray-500 uppercase tracking-wide">{{
          t('profitEnhanced.sharpe')
        }}</span>
        <span
          class="font-bold"
          :class="
            (keyMetrics.sharpe ?? 0) >= 1
              ? 'text-emerald-400'
              : (keyMetrics.sharpe ?? 0) >= 0
                ? 'text-amber-400'
                : 'text-red-400'
          "
        >
          {{ (keyMetrics.sharpe ?? 0).toFixed(2) }}
        </span>
      </div>
      <div v-if="keyMetrics.maxDrawdownPct !== null" class="flex items-center gap-1 text-[10px]">
        <span class="text-gray-600 dark:text-gray-500 uppercase tracking-wide">{{
          t('profitEnhanced.maxDD')
        }}</span>
        <span class="font-bold text-red-400">
          {{ ((keyMetrics.maxDrawdownPct ?? 0) * 100).toFixed(1) }}%
        </span>
        <span v-if="keyMetrics.maxDrawdown" class="text-gray-600 dark:text-gray-500">
          ({{ formatPrice(keyMetrics.maxDrawdown, 2) }})
        </span>
      </div>
      <div v-if="keyMetrics.winRate !== null" class="flex items-center gap-1 text-[10px]">
        <span class="text-gray-600 dark:text-gray-500 uppercase tracking-wide">{{
          t('profitEnhanced.winRate')
        }}</span>
        <span
          class="font-bold"
          :class="
            (keyMetrics.winRate ?? 0) >= 60
              ? 'text-emerald-400'
              : (keyMetrics.winRate ?? 0) >= 50
                ? 'text-amber-400'
                : 'text-red-400'
          "
        >
          {{ (keyMetrics.winRate ?? 0).toFixed(1) }}%
        </span>
      </div>
      <div v-if="keyMetrics.profitFactor !== null" class="flex items-center gap-1 text-[10px]">
        <span class="text-gray-600 dark:text-gray-500 uppercase tracking-wide">{{
          t('profitEnhanced.profitFactor')
        }}</span>
        <span
          class="font-bold"
          :class="
            (keyMetrics.profitFactor ?? 0) >= 1.5
              ? 'text-emerald-400'
              : (keyMetrics.profitFactor ?? 0) >= 1
                ? 'text-amber-400'
                : 'text-red-400'
          "
        >
          {{ (keyMetrics.profitFactor ?? 0).toFixed(2) }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profit-enhanced {
  --glass-bg: rgba(15, 15, 25, 0.6);
  --glass-border: rgba(100, 100, 140, 0.15);
}

.controls-bar {
  border-bottom: 1px solid var(--glass-border);
}

.period-stats {
  background: rgba(100, 100, 160, 0.04);
}

.metrics-bar {
  background: rgba(100, 100, 160, 0.04);
}

.echarts {
  width: 100%;
  height: 100%;
  min-height: 150px;
}
</style>
