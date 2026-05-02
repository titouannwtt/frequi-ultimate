<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { BarChart, LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import VChart from 'vue-echarts';

const { t } = useI18n();

use([CanvasRenderer, BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent]);

const props = defineProps<{
  data: {
    hours: Array<number | { hour: number; avg_profit: number; winrate: number; trades: number }>;
    avg_profit?: number[];
    winrate?: number[];
    trade_count?: number[];
  };
}>();

const chartOptions = computed(() => {
  const raw = props.data.hours ?? [];
  const isObjArray = raw.length > 0 && typeof raw[0] === 'object';
  const hours = isObjArray ? (raw as any[]).map((h) => h.hour) : (raw as number[]);
  const avgProfit = isObjArray ? (raw as any[]).map((h) => h.avg_profit) : (props.data.avg_profit ?? []);
  const winrate = isObjArray ? (raw as any[]).map((h) => h.winrate) : (props.data.winrate ?? []);
  const tradeCount = isObjArray ? (raw as any[]).map((h) => h.trades) : (props.data.trade_count ?? []);

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(30, 30, 46, 0.95)',
      borderColor: 'rgba(69, 71, 90, 0.5)',
      textStyle: { color: '#cdd6f4', fontSize: 11 },
      formatter: (params: any[]) => {
        const winRateLabel = t('strategyDev.metricWinRate');
        const tradesLabel = t('strategyDev.metricTrades');
        const h = params[0]?.name ?? '';
        let html = `<div style="font-weight:600;margin-bottom:4px">${h}:00</div>`;
        for (const p of params) {
          const val = p.seriesName === winRateLabel
            ? `${(p.value * 100).toFixed(1)}%`
            : p.seriesName === tradesLabel
              ? p.value
              : `${p.value >= 0 ? '+' : ''}${(p.value * 100).toFixed(2)}%`;
          html += `<div>${p.marker} ${p.seriesName}: <b>${val}</b></div>`;
        }
        return html;
      },
    },
    legend: {
      data: [t('strategyDev.metricAvgProfit'), t('strategyDev.metricWinRate'), t('strategyDev.metricTrades')],
      textStyle: { color: '#6c7086', fontSize: 10 },
      top: 0,
    },
    grid: { left: 50, right: 50, top: 40, bottom: 30 },
    xAxis: {
      type: 'category',
      data: hours.map(String),
      axisLabel: { color: '#6c7086', fontSize: 10 },
      axisLine: { lineStyle: { color: 'rgba(69,71,90,0.3)' } },
    },
    yAxis: [
      {
        type: 'value',
        name: t('strategyDev.metricProfit'),
        position: 'left',
        axisLabel: {
          color: '#6c7086',
          fontSize: 10,
          formatter: (v: number) => `${(v * 100).toFixed(1)}%`,
        },
        splitLine: { lineStyle: { color: 'rgba(69,71,90,0.2)' } },
      },
      {
        type: 'value',
        name: t('strategyDev.metricWinRate'),
        position: 'right',
        min: 0,
        max: 1,
        axisLabel: {
          color: '#6c7086',
          fontSize: 10,
          formatter: (v: number) => `${(v * 100).toFixed(0)}%`,
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: t('strategyDev.metricAvgProfit'),
        type: 'bar',
        data: avgProfit,
        yAxisIndex: 0,
        itemStyle: {
          color: (params: any) => params.value >= 0
            ? 'rgba(166, 227, 161, 0.7)'
            : 'rgba(243, 139, 168, 0.7)',
          borderRadius: [2, 2, 0, 0],
        },
      },
      {
        name: t('strategyDev.metricWinRate'),
        type: 'line',
        data: winrate,
        yAxisIndex: 1,
        smooth: true,
        lineStyle: { color: '#89b4fa', width: 2 },
        itemStyle: { color: '#89b4fa' },
        symbol: 'circle',
        symbolSize: 4,
      },
      {
        name: t('strategyDev.metricTrades'),
        type: 'bar',
        data: tradeCount,
        yAxisIndex: 0,
        itemStyle: {
          color: 'rgba(137, 180, 250, 0.15)',
          borderRadius: [2, 2, 0, 0],
        },
        barMaxWidth: 8,
        show: false,
      },
    ],
  };
});
</script>

<template>
  <VChart :option="chartOptions" autoresize style="height: 300px" />
</template>
