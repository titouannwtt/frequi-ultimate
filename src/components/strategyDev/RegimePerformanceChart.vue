<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from 'echarts/components';

use([BarChart, CanvasRenderer, GridComponent, TooltipComponent, LegendComponent]);

const { t } = useI18n();

interface DailyPerf {
  regime: string;
  days: number;
  pct_time: number;
  total_profit: number;
  avg_daily_profit: number;
  winrate: number;
}

interface TradePerf {
  regime: string;
  trades: number;
  avg_profit: number;
  total_profit: number;
  winrate: number;
}

interface MarketRegimeData {
  regime_labels: string[];
  daily_performance: DailyPerf[];
  trade_performance: TradePerf[];
  transition_matrix: number[][];
  timeline: { date: string; regime: string; volatility: number; trend: number }[];
  insights: string[];
  window: number;
}

const C = {
  surface0: '#1e1e2e',
  surface1: '#313244',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  overlay: '#45475a',
  blue: '#89b4fa',
  lavender: '#b4befe',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  peach: '#fab387',
  mauve: '#cba6f7',
  teal: '#94e2d5',
} as const;

const REGIME_COLORS: Record<string, string> = {
  bull_quiet: '#a6e3a1',
  bull_volatile: '#f9e2af',
  bear_quiet: '#89b4fa',
  bear_volatile: '#f38ba8',
};

const REGIME_LABEL_KEYS: Record<string, string> = {
  bull_quiet: 'strategyDev.regimeBullQuiet',
  bull_volatile: 'strategyDev.regimeBullVolatile',
  bear_quiet: 'strategyDev.regimeBearQuiet',
  bear_volatile: 'strategyDev.regimeBearVolatile',
};

const props = defineProps<{ data: MarketRegimeData }>();

const viewMode = ref<'daily' | 'trade'>('daily');

function regimeLabel(regime: string): string {
  const key = REGIME_LABEL_KEYS[regime];
  return key ? t(key) : regime;
}

const chartOptions = computed<EChartsOption>(() => {
  const isDaily = viewMode.value === 'daily';
  const perfData = isDaily ? props.data.daily_performance : props.data.trade_performance;

  const regimes = perfData.map((d) => regimeLabel(d.regime));
  const values = perfData.map((d) =>
    isDaily ? (d as DailyPerf).avg_daily_profit : (d as TradePerf).avg_profit,
  );
  const winrates = perfData.map((d) => d.winrate);
  const colors = perfData.map((d) => REGIME_COLORS[d.regime] ?? C.subtext);

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: C.surface0,
      borderColor: C.overlay,
      textStyle: { color: C.text, fontSize: 12 },
      formatter: (params: unknown) => {
        const p = (params as { dataIndex: number }[])[0];
        if (!p) return '';
        const d = perfData[p.dataIndex];
        if (isDaily) {
          const dd = d as DailyPerf;
          return [
            `<b>${regimeLabel(dd.regime)}</b>`,
            `${t('strategyDev.regimeAvgDailyProfit')}: <b>${dd.avg_daily_profit >= 0 ? '+' : ''}${dd.avg_daily_profit.toFixed(3)}%</b>`,
            `${t('strategyDev.regimeTotalProfit')}: <b>${dd.total_profit >= 0 ? '+' : ''}${dd.total_profit.toFixed(2)}%</b>`,
            `${t('strategyDev.regimeDays')}: <b>${dd.days}</b> (${dd.pct_time.toFixed(1)}%)`,
            `${t('strategyDev.regimeWinrate')}: <b>${(dd.winrate * 100).toFixed(1)}%</b>`,
          ].join('<br/>');
        }
        const td = d as TradePerf;
        return [
          `<b>${regimeLabel(td.regime)}</b>`,
          `${t('strategyDev.regimeAvgProfit')}: <b>${td.avg_profit >= 0 ? '+' : ''}${td.avg_profit.toFixed(3)}%</b>`,
          `${t('strategyDev.regimeTotalProfit')}: <b>${td.total_profit >= 0 ? '+' : ''}${td.total_profit.toFixed(2)}%</b>`,
          `${t('strategyDev.regimeTrades')}: <b>${td.trades}</b>`,
          `${t('strategyDev.regimeWinrate')}: <b>${(td.winrate * 100).toFixed(1)}%</b>`,
        ].join('<br/>');
      },
    },
    grid: { left: 60, right: 20, top: 40, bottom: 30 },
    xAxis: {
      type: 'category',
      data: regimes,
      axisLabel: { color: C.subtext, fontSize: 11 },
      axisLine: { lineStyle: { color: C.overlay } },
    },
    yAxis: {
      type: 'value',
      name: isDaily ? `${t('strategyDev.regimeAvgDailyProfit')} (%)` : `${t('strategyDev.regimeAvgProfit')} (%)`,
      nameTextStyle: { color: C.subtext, fontSize: 11 },
      axisLabel: { color: C.subtext, fontSize: 10 },
      splitLine: { lineStyle: { color: C.surface1 } },
    },
    series: [
      {
        type: 'bar',
        data: values.map((v, i) => ({
          value: v,
          itemStyle: { color: colors[i] },
          label: {
            show: true,
            position: 'top',
            formatter: `WR ${(winrates[i] * 100).toFixed(0)}%`,
            color: C.subtext,
            fontSize: 10,
          },
        })),
        barMaxWidth: 60,
      },
    ],
  };
});

const timeDistribution = computed(() => {
  return props.data.daily_performance.map((d) => ({
    regime: d.regime,
    label: regimeLabel(d.regime),
    pct: d.pct_time,
    color: REGIME_COLORS[d.regime] ?? C.subtext,
  }));
});
</script>

<template>
  <div class="sd-chart-card">
    <div class="flex items-center justify-between mb-3">
      <h4 class="text-sm font-semibold" :style="{ color: C.text }">
        {{ t('strategyDev.regimePerformance', 'Regime Performance') }}
      </h4>
      <div class="flex gap-1">
        <button
          class="px-2 py-0.5 text-xs rounded transition-colors"
          :style="{
            backgroundColor: viewMode === 'daily' ? C.overlay : 'transparent',
            color: viewMode === 'daily' ? C.text : C.subtext,
          }"
          @click="viewMode = 'daily'"
        >
          {{ t('strategyDev.regimeDailyView') }}
        </button>
        <button
          class="px-2 py-0.5 text-xs rounded transition-colors"
          :style="{
            backgroundColor: viewMode === 'trade' ? C.overlay : 'transparent',
            color: viewMode === 'trade' ? C.text : C.subtext,
          }"
          @click="viewMode = 'trade'"
        >
          {{ t('strategyDev.regimeTradeView') }}
        </button>
      </div>
    </div>

    <ECharts :option="chartOptions" autoresize style="height: 300px" />

    <!-- Time distribution bar -->
    <div class="mt-3">
      <div class="text-xs mb-1" :style="{ color: C.subtext }">{{ t('strategyDev.regimeTimeInEach') }}</div>
      <div class="flex w-full h-5 rounded overflow-hidden">
        <div
          v-for="seg in timeDistribution"
          :key="seg.regime"
          :style="{
            width: seg.pct + '%',
            backgroundColor: seg.color,
            minWidth: seg.pct > 0 ? '2px' : '0',
          }"
          class="relative group"
          :title="`${seg.label}: ${seg.pct.toFixed(1)}%`"
        >
          <span
            v-if="seg.pct >= 10"
            class="absolute inset-0 flex items-center justify-center text-xs font-medium"
            :style="{ color: C.surface0 }"
          >
            {{ seg.pct.toFixed(0) }}%
          </span>
        </div>
      </div>
      <div class="flex flex-wrap gap-3 mt-1.5">
        <div
          v-for="seg in timeDistribution"
          :key="seg.regime"
          class="flex items-center gap-1 text-xs"
          :style="{ color: C.subtext }"
        >
          <span
            class="inline-block w-2.5 h-2.5 rounded-full"
            :style="{ backgroundColor: seg.color }"
          />
          {{ seg.label }}
        </div>
      </div>
    </div>
  </div>
</template>
