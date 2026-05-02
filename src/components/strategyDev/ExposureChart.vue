<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
} from 'echarts/components';

use([LineChart, CanvasRenderer, GridComponent, TooltipComponent, DataZoomComponent]);

const { t } = useI18n();

const props = defineProps<{
  timeline: { date: string; open_positions: number }[];
}>();

function fmtDate(raw: string): string {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const option = computed<EChartsOption>(() => {
  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
      formatter: (params: unknown) => {
        const p = (params as { data: [string, number]; axisValue: string }[])[0];
        const val = Array.isArray(p.data) ? p.data[1] : p.data;
        return `<b>${fmtDate(p.axisValue)}</b><br/>${t('strategyDev.exposureYAxis')}: ${val}`;
      },
    },
    grid: { left: 60, right: 20, top: 30, bottom: 60 },
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
      type: 'time',
      axisLabel: { color: '#a6adc8', fontSize: 11 },
      axisLine: { lineStyle: { color: '#45475a' } },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      name: t('strategyDev.exposureYAxis'),
      nameTextStyle: { color: '#a6adc8', fontSize: 11 },
      axisLabel: { color: '#a6adc8', fontSize: 11 },
      splitLine: { lineStyle: { color: '#313244' } },
    },
    series: [
      {
        type: 'line',
        step: 'end',
        data: props.timeline.map((d) => [d.date, d.open_positions]),
        symbol: 'none',
        lineStyle: { width: 2, color: '#94e2d5' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(148,226,213,0.3)' },
              { offset: 1, color: 'rgba(148,226,213,0)' },
            ],
          },
        },
      },
    ],
  };
});
</script>

<template>
  <div class="sd-chart-card">
    <ECharts :option="option" autoresize style="height: 250px" />
  </div>
</template>
