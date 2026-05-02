<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkLineComponent,
} from 'echarts/components';

use([ScatterChart, CanvasRenderer, GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent]);

interface DurationPoint {
  duration: number;
  profit: number;
  pair: string;
}

const props = defineProps<{
  points: DurationPoint[];
}>();

const { t } = useI18n();

const chartOptions = computed<EChartsOption>(() => {
  const green = props.points
    .filter((p) => p.profit > 0)
    .map((p) => [p.duration, p.profit]);
  const red = props.points
    .filter((p) => p.profit <= 0)
    .map((p) => [p.duration, p.profit]);

  const greenMeta = props.points.filter((p) => p.profit > 0);
  const redMeta = props.points.filter((p) => p.profit <= 0);

  const makeFmt = (meta: DurationPoint[]) => (p: unknown) => {
    const params = p as { dataIndex: number; value: number[] };
    const d = meta[params.dataIndex];
    return [
      `<b>${d.pair}</b>`,
      `Duration: <b>${params.value[0]} min</b>`,
      `Profit: <b>${params.value[1].toFixed(2)}%</b>`,
    ].join('<br/>');
  };

  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
    },
    grid: { left: 60, right: 20, top: 20, bottom: 80 },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
      {
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'none',
        height: 18,
        bottom: 4,
        borderColor: '#45475a',
        backgroundColor: '#181825',
        fillerColor: 'rgba(137,180,250,0.15)',
        handleStyle: { color: '#89b4fa', borderColor: '#89b4fa' },
        textStyle: { color: '#a6adc8', fontSize: 10 },
        dataBackground: { lineStyle: { color: '#45475a' }, areaStyle: { color: '#313244' } },
      },
    ],
    xAxis: {
      type: 'value',
      name: t('strategyDev.axisDuration'),
      nameLocation: 'center',
      nameGap: 45,
      axisLabel: { color: '#a6adc8' },
      splitLine: { lineStyle: { color: '#313244' } },
    },
    yAxis: {
      type: 'value',
      name: t('strategyDev.axisProfit'),
      nameLocation: 'center',
      nameGap: 40,
      axisLabel: { color: '#a6adc8' },
      splitLine: { lineStyle: { color: '#313244' } },
    },
    series: [
      {
        type: 'scatter',
        data: green,
        symbolSize: 6,
        itemStyle: { color: '#a6e3a1', opacity: 0.6 },
        tooltip: { formatter: makeFmt(greenMeta) },
      },
      {
        type: 'scatter',
        data: red,
        symbolSize: 6,
        itemStyle: { color: '#f38ba8', opacity: 0.6 },
        tooltip: { formatter: makeFmt(redMeta) },
      },
      {
        type: 'scatter',
        data: [],
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: '#6c7086', width: 1 },
          label: { show: false },
          data: [{ yAxis: 0 }],
        },
      },
    ],
  };
});
</script>

<template>
  <div class="sd-chart-card">
    <ECharts :option="chartOptions" autoresize style="height: 320px" />
  </div>
</template>
