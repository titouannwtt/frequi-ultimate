<script setup lang="ts">
import type { EChartsOption } from 'echarts';
import ECharts from 'vue-echarts';

import { BarChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

import type { ClosedTrade } from '@/types';
import { useI18n } from 'vue-i18n';
import { useSummaryCurrency } from '@/composables/summaryCurrency';
import { useExchangeRates } from '@/composables/exchangeRates';
import { useTradingModeFilter } from '@/composables/useTradingModeFilter';
import { useWidgetDefaults } from '@/composables/useWidgetDefaults';
import { DashboardLayout } from '@/stores/layout';
import {
  PROFIT_PERIODS,
  getProfitPeriodCutoff,
  aggregateProfitByBot,
  type ProfitPeriodKey,
} from '@/utils/botProfit';

use([
  BarChart,
  CanvasRenderer,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkLineComponent,
]);

const { t } = useI18n();

const props = defineProps<{
  trades: ClosedTrade[];
}>();

const botStore = useBotStore();
const settingsStore = useSettingsStore();
const colorStore = useColorStore();
const { summaryCurrency } = useSummaryCurrency();
const { convert } = useExchangeRates();
const { tradingMode, hasMultipleModes, filterTradesByMode, restorePersistedTradingMode } = useTradingModeFilter('botProfitComparison');

const chart = ref<InstanceType<typeof ECharts>>();

type ValueModeKey = 'abs' | 'pct';
type SortModeKey = 'profit' | 'abs' | 'name';

const selectedPeriod = ref<ProfitPeriodKey>('7d');
const valueMode = ref<ValueModeKey>('abs');
const sortMode = ref<SortModeKey>('profit');

// --- Currency handling (reuse the dashboard's summary currency + exchange rates) ---
const botStakeCurrencyMap = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const bot of botStore.selectedBots) {
    map[bot.botId] = bot.stakeCurrency || 'USDT';
  }
  return map;
});

function convertProfit(amount: number, botId: string): number {
  const target = summaryCurrency.value;
  if (!target || target === 'auto') return amount;
  const from = botStakeCurrencyMap.value[botId];
  if (!from || from.toUpperCase() === target.toUpperCase()) return amount;
  return convert(amount, from, target) ?? amount;
}

const displayCurrency = computed(() => {
  const c = summaryCurrency.value;
  if (c && c !== 'auto') return c;
  return botStore.selectedBots[0]?.stakeCurrency || 'USDT';
});

// --- Starting balance per bot (for % mode), in the bot's own stake currency ---
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

// --- Aggregation (raw profit per bot; convert only for display) ---
const modeFilteredTrades = computed(() => filterTradesByMode(props.trades));

const rawEntries = computed(() =>
  aggregateProfitByBot(modeFilteredTrades.value, getProfitPeriodCutoff(selectedPeriod.value)),
);

interface DisplayEntry {
  botId: string;
  botName: string;
  value: number; // in display currency (abs) or % (pct)
  abs: number; // always in display currency, for the fleet total
  tradeCount: number;
}

const displayEntries = computed<DisplayEntry[]>(() => {
  const entries = rawEntries.value.map((e): DisplayEntry => {
    const absValue = convertProfit(e.profit, e.botId);
    const value =
      valueMode.value === 'pct'
        ? (e.profit / (startingBalancePerBot.value[e.botId] ?? 1)) * 100
        : absValue;
    return { botId: e.botId, botName: e.botName, value, abs: absValue, tradeCount: e.tradeCount };
  });

  const sorted = [...entries];
  if (sortMode.value === 'name') {
    sorted.sort((a, b) => a.botName.localeCompare(b.botName));
  } else if (sortMode.value === 'abs') {
    sorted.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  } else {
    sorted.sort((a, b) => b.value - a.value);
  }
  return sorted;
});

const fleetTotal = computed(() => displayEntries.value.reduce((s, e) => s + e.abs, 0));
const fleetTradeCount = computed(() => displayEntries.value.reduce((s, e) => s + e.tradeCount, 0));

const hasData = computed(() => displayEntries.value.length > 0);
const manyBots = computed(() => displayEntries.value.length > 12);

function formatValue(v: number): string {
  return valueMode.value === 'pct'
    ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
    : `${v >= 0 ? '+' : ''}${formatPrice(v, 2)} ${displayCurrency.value}`;
}

// --- Persisted filter defaults ---
const HARDCODED_DEFAULTS = {
  selectedPeriod: '7d' as string,
  valueMode: 'abs' as string,
  sortMode: 'profit' as string,
  tradingMode: 'all' as string,
};

const { filtersChanged, saveCurrentAsDefault, loadDefaults } = useWidgetDefaults(
  DashboardLayout.botProfitComparison,
  () => ({
    selectedPeriod: selectedPeriod.value,
    valueMode: valueMode.value,
    sortMode: sortMode.value,
    tradingMode: tradingMode.value,
  }),
  (d) => {
    if (d.selectedPeriod !== undefined) selectedPeriod.value = d.selectedPeriod as ProfitPeriodKey;
    if (d.valueMode !== undefined) valueMode.value = d.valueMode as ValueModeKey;
    if (d.sortMode !== undefined) sortMode.value = d.sortMode as SortModeKey;
    if (d.tradingMode !== undefined) tradingMode.value = d.tradingMode as typeof tradingMode.value;
  },
  HARDCODED_DEFAULTS,
);

onMounted(() => {
  loadDefaults();
  restorePersistedTradingMode();
});

defineExpose({ filtersChanged, saveCurrentAsDefault });

// --- Chart options ---
const chartOptions = computed<EChartsOption>(() => {
  const axisColor = settingsStore.isDarkTheme ? '#808098' : '#555';
  const entries = displayEntries.value;

  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    animationDuration: 600,
    animationEasing: 'cubicOut',
    grid: { left: 60, right: 20, top: 12, bottom: manyBots.value ? 70 : 50 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(15, 15, 25, 0.92)',
      borderColor: 'rgba(100, 100, 140, 0.3)',
      borderWidth: 1,
      textStyle: { color: '#e0e0e0', fontSize: 12 },
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params;
        if (!p) return '';
        const e = entries[p.dataIndex];
        if (!e) return '';
        const valColor = e.value >= 0 ? colorStore.colorProfit : colorStore.colorLoss;
        return (
          `<div style="font-size:11px">` +
          `<div style="color:#aaa;margin-bottom:2px">${e.botName}</div>` +
          `<div style="font-weight:600;color:${valColor}">${formatValue(e.value)}</div>` +
          `<div style="color:#888;margin-top:2px">${t('botProfitComparison.tradeCount', { n: e.tradeCount })}</div>` +
          `</div>`
        );
      },
    },
    xAxis: {
      type: 'category',
      data: entries.map((e) => e.botName),
      axisLine: { lineStyle: { color: 'rgba(100, 100, 140, 0.2)' } },
      axisTick: { show: false },
      axisLabel: {
        color: axisColor,
        fontSize: 10,
        interval: 0,
        rotate: entries.length > 6 ? 35 : 0,
        formatter: (name: string) => (name.length > 14 ? `${name.slice(0, 13)}…` : name),
      },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: axisColor,
        fontSize: 10,
        formatter: (v: number) =>
          valueMode.value === 'pct' ? `${v.toFixed(0)}%` : formatPrice(v, 0),
      },
      splitLine: { show: true, lineStyle: { color: 'rgba(100, 100, 140, 0.08)', type: 'dashed' } },
    },
    dataZoom: manyBots.value
      ? [
          { type: 'inside', start: 0, end: 100 },
          { type: 'slider', start: 0, end: 100, height: 16, bottom: 6 },
        ]
      : undefined,
    series: [
      {
        type: 'bar',
        barMaxWidth: 48,
        data: entries.map((e) => ({
          value: e.value,
          itemStyle: {
            color: e.value >= 0 ? colorStore.colorProfit : colorStore.colorLoss,
            borderRadius: e.value >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3],
          },
        })),
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: 'rgba(120,120,150,0.4)', width: 1 },
          data: [{ yAxis: 0 }],
        },
      },
    ],
  };
});

function exportChartImage() {
  const echart = (chart.value?.chart ?? chart.value) as { getDataURL?: (o: object) => string };
  if (echart && typeof echart.getDataURL === 'function') {
    const url = echart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#1a1a2e' });
    const a = document.createElement('a');
    a.href = url;
    a.download = `bot_profit_${selectedPeriod.value}.png`;
    a.click();
  }
}

const valueModeOptions = computed(() => [
  { key: 'abs' as ValueModeKey, label: displayCurrency.value },
  { key: 'pct' as ValueModeKey, label: '%' },
]);

const sortOptions: { key: SortModeKey; labelKey: string }[] = [
  { key: 'profit', labelKey: 'botProfitComparison.sortProfit' },
  { key: 'abs', labelKey: 'botProfitComparison.sortMagnitude' },
  { key: 'name', labelKey: 'botProfitComparison.sortName' },
];
</script>

<template>
  <div class="flex flex-col h-full w-full bot-profit-comparison">
    <!-- Controls bar -->
    <div class="flex flex-wrap items-center gap-2 px-1 pb-1 controls-bar">
      <!-- Period pills -->
      <div class="flex flex-wrap gap-0.5">
        <button
          v-for="p in PROFIT_PERIODS"
          :key="p.key"
          class="px-1.5 py-0.5 text-[10px] font-semibold rounded-md transition-all duration-150 cursor-pointer"
          :class="
            selectedPeriod === p.key
              ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5'
          "
          @click="selectedPeriod = p.key"
        >
          {{ p.label }}
        </button>
      </div>

      <div class="w-px h-4 bg-gray-300 dark:bg-gray-600/30"></div>

      <!-- Value mode (currency / %) -->
      <div class="flex gap-0.5">
        <button
          v-for="vm in valueModeOptions"
          :key="vm.key"
          class="px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all duration-150 cursor-pointer"
          :class="
            valueMode === vm.key
              ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5'
          "
          @click="valueMode = vm.key"
        >
          {{ vm.label }}
        </button>
      </div>

      <!-- Sort -->
      <select
        v-model="sortMode"
        class="text-[10px] py-0.5 px-1 rounded bg-transparent text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600/30 cursor-pointer focus:outline-none"
        :title="t('botProfitComparison.sortBy')"
      >
        <option v-for="o in sortOptions" :key="o.key" :value="o.key">{{ t(o.labelKey) }}</option>
      </select>

      <TradingModeSelect v-model="tradingMode" :show="hasMultipleModes" />

      <div class="flex-1"></div>

      <!-- Export PNG -->
      <button
        class="px-1.5 py-0.5 text-[10px] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 rounded transition-all cursor-pointer"
        :title="t('botProfitComparison.exportPNG')"
        @click="exportChartImage"
      >
        <i-mdi-image class="inline w-3.5 h-3.5" />
      </button>
    </div>

    <!-- Fleet total strip -->
    <div class="flex flex-wrap gap-3 px-2 py-1 text-[10px] total-strip">
      <div class="flex items-center gap-1">
        <span class="text-gray-600 dark:text-gray-500">{{
          t('botProfitComparison.fleetTotal')
        }}</span>
        <span :class="fleetTotal >= 0 ? 'text-emerald-400' : 'text-red-400'" class="font-semibold">
          {{ fleetTotal >= 0 ? '+' : '' }}{{ formatPrice(fleetTotal, 2) }} {{ displayCurrency }}
        </span>
      </div>
      <div class="flex items-center gap-1">
        <span class="text-gray-600 dark:text-gray-500">{{ t('botProfitComparison.bots') }}</span>
        <span class="font-semibold text-gray-700 dark:text-gray-300">{{
          displayEntries.length
        }}</span>
      </div>
      <div class="flex items-center gap-1">
        <span class="text-gray-600 dark:text-gray-500">{{ t('botProfitComparison.trades') }}</span>
        <span class="font-semibold text-gray-700 dark:text-gray-300">{{ fleetTradeCount }}</span>
      </div>
    </div>

    <!-- Chart -->
    <div class="flex-1 min-h-0">
      <ECharts
        v-if="hasData"
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
        {{ t('botProfitComparison.noData') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.bot-profit-comparison {
  --glass-border: rgba(100, 100, 140, 0.15);
}
.controls-bar {
  border-bottom: 1px solid var(--glass-border);
}
.total-strip {
  background: rgba(100, 100, 160, 0.04);
}
.echarts {
  width: 100%;
  height: 100%;
  min-height: 150px;
}
</style>
