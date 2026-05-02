<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart, LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from 'echarts/components';
import { useI18n } from 'vue-i18n';

use([BarChart, LineChart, CanvasRenderer, GridComponent, TooltipComponent, LegendComponent]);

const { t } = useI18n();

interface DayPattern {
  day: string;
  day_index: number;
  trades: number;
  avg_profit: number;
  total_profit: number;
  winrate: number;
}

const props = defineProps<{
  pattern: {
    days: DayPattern[];
  };
}>();

const dayNames = computed(() => [
  t('strategyDev.dayMon'),
  t('strategyDev.dayTue'),
  t('strategyDev.dayWed'),
  t('strategyDev.dayThu'),
  t('strategyDev.dayFri'),
  t('strategyDev.daySat'),
  t('strategyDev.daySun'),
]);

const sortedDays = computed(() =>
  [...props.pattern.days].sort((a, b) => a.day_index - b.day_index),
);

const chartOptions = computed<EChartsOption>(() => {
  const days = sortedDays.value;
  const labels = days.map((d) => dayNames.value[d.day_index] ?? d.day);
  const profits = days.map((d) => d.total_profit);
  const winrates = days.map((d) => d.winrate * 100);

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
      formatter: (params: unknown) => {
        const ps = params as { dataIndex: number }[];
        if (!ps.length) return '';
        const d = days[ps[0].dataIndex];
        return [
          `<b>${dayNames.value[d.day_index] ?? d.day}</b>`,
          `${t('strategyDev.wdTotalProfit')}: <b>${d.total_profit >= 0 ? '+' : ''}${d.total_profit.toFixed(2)}</b>`,
          `${t('strategyDev.wdWinRate')}: <b>${(d.winrate * 100).toFixed(1)}%</b>`,
          `${t('strategyDev.wdTrades')}: <b>${d.trades}</b>`,
          `${t('strategyDev.wdAvgProfit')}: <b>${d.avg_profit >= 0 ? '+' : ''}${d.avg_profit.toFixed(2)}%</b>`,
        ].join('<br/>');
      },
    },
    grid: { left: 60, right: 60, top: 20, bottom: 30 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#a6adc8', fontSize: 11 },
      axisLine: { lineStyle: { color: '#45475a' } },
    },
    yAxis: [
      {
        type: 'value',
        name: t('strategyDev.wdTotalProfit'),
        nameTextStyle: { color: '#a6adc8' },
        axisLabel: { color: '#a6adc8' },
        splitLine: { lineStyle: { color: '#313244' } },
      },
      {
        type: 'value',
        name: t('strategyDev.wdWinRate'),
        nameTextStyle: { color: '#f9e2af' },
        axisLabel: { color: '#f9e2af' },
        splitLine: { show: false },
        min: 0,
        max: 100,
      },
    ],
    series: [
      {
        type: 'bar',
        yAxisIndex: 0,
        data: profits.map((v) => ({
          value: v,
          itemStyle: { color: v >= 0 ? '#a6e3a1' : '#f38ba8' },
        })),
      },
      {
        type: 'line',
        yAxisIndex: 1,
        data: winrates,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: '#f9e2af', width: 2 },
        itemStyle: { color: '#f9e2af' },
      },
    ],
  };
});
</script>

<template>
  <div class="sd-chart-card">
    <ECharts :option="chartOptions" autoresize style="height: 280px" />

    <div class="grid grid-cols-7 gap-1 mt-2 px-1">
      <div
        v-for="d in sortedDays"
        :key="d.day_index"
        class="text-center rounded px-1 py-1.5"
        style="background-color: #313244"
      >
        <div class="text-xs font-medium" style="color: #cdd6f4">{{ dayNames[d.day_index] ?? d.day }}</div>
        <div class="text-xs" style="color: #a6adc8">{{ d.trades }} trades</div>
        <div
          class="text-xs font-medium"
          :style="{ color: d.avg_profit >= 0 ? '#a6e3a1' : '#f38ba8' }"
        >
          {{ d.avg_profit >= 0 ? '+' : '' }}{{ d.avg_profit.toFixed(2) }}%
        </div>
      </div>
    </div>
  </div>
</template>
