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

interface ExitReason {
  reason: string;
  count: number;
  avg_profit: number;
  total_profit: number;
  wins: number;
  losses: number;
  winrate: number;
}

const props = defineProps<{
  reasons: ExitReason[];
}>();

const chartHeight = computed(() => `${Math.max(200, props.reasons.length * 40)}px`);

const chartOptions = computed<EChartsOption>(() => {
  const sorted = [...props.reasons].sort((a, b) => b.count - a.count);
  const labels = sorted.map((r) => r.reason);
  const counts = sorted.map((r) => r.count);
  const avgProfits = sorted.map((r) => r.avg_profit);

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
      formatter: (params: unknown) => {
        const ps = params as { dataIndex: number }[];
        if (!ps.length) return '';
        const d = sorted[ps[0].dataIndex];
        return [
          `<b>${d.reason}</b>`,
          `${t('strategyDev.erCount')}: <b>${d.count}</b>`,
          `${t('strategyDev.erAvgProfit')}: <b>${d.avg_profit >= 0 ? '+' : ''}${d.avg_profit.toFixed(2)}%</b>`,
          `${t('strategyDev.erWinRate')}: <b>${(d.winrate * 100).toFixed(1)}%</b>`,
          `${t('strategyDev.erTotalProfit')}: <b>${d.total_profit >= 0 ? '+' : ''}${d.total_profit.toFixed(2)}</b>`,
        ].join('<br/>');
      },
    },
    legend: {
      data: [t('strategyDev.erCount'), t('strategyDev.erAvgProfit')],
      textStyle: { color: '#6c7086', fontSize: 10 },
      top: 4,
      right: 10,
    },
    grid: { left: 140, right: 60, top: 40, bottom: 30 },
    yAxis: {
      type: 'category',
      data: labels,
      inverse: true,
      axisLabel: { fontSize: 11, color: '#bac2de' },
    },
    xAxis: [
      {
        type: 'value',
        name: t('strategyDev.erCount'),
        nameTextStyle: { color: '#a6adc8' },
        axisLabel: { color: '#a6adc8' },
        splitLine: { lineStyle: { color: '#313244' } },
      },
      {
        type: 'value',
        name: t('strategyDev.erAvgProfit'),
        nameTextStyle: { color: '#a6adc8' },
        axisLabel: { color: '#a6adc8' },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: t('strategyDev.erCount'),
        type: 'bar',
        xAxisIndex: 0,
        data: counts.map((v, i) => ({
          value: v,
          itemStyle: { color: avgProfits[i] >= 0 ? '#a6e3a1' : '#f38ba8' },
        })),
      },
      {
        name: t('strategyDev.erAvgProfit'),
        type: 'line',
        xAxisIndex: 1,
        data: avgProfits,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: '#cba6f7', width: 2 },
        itemStyle: { color: '#cba6f7' },
      },
    ],
  };
});
</script>

<template>
  <div class="sd-chart-card" style="overflow: hidden">
    <ECharts :option="chartOptions" autoresize :style="{ height: chartHeight }" />
  </div>
</template>
