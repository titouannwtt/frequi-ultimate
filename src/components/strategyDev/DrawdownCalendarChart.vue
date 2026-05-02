<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { HeatmapChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  CalendarComponent,
} from 'echarts/components';

use([HeatmapChart, CanvasRenderer, GridComponent, TooltipComponent, VisualMapComponent, CalendarComponent]);

interface CalEntry {
  date: string;
  dd_pct: number;
  pnl: number;
}

const props = defineProps<{
  data: CalEntry[];
}>();

const chartOptions = computed<EChartsOption>(() => {
  if (!props.data.length) return {};

  const dates = props.data.map((d) => d.date);
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  const firstYear = parseInt(firstDate.split('-')[0]);
  const lastYear = parseInt(lastDate.split('-')[0]);
  const years = [];
  for (let y = firstYear; y <= lastYear; y++) years.push(y);

  const maxDd = Math.max(...props.data.map((d) => d.dd_pct), 1);

  const calendars = years.map((y, i) => ({
    top: 40 + i * 160,
    left: 50,
    right: 30,
    cellSize: ['auto', 14],
    range: String(y),
    itemStyle: { borderWidth: 2, borderColor: '#1e1e2e' },
    splitLine: { lineStyle: { color: '#313244' } },
    yearLabel: { color: '#a6adc8', fontSize: 12, margin: 30 },
    dayLabel: { color: '#6c7086', fontSize: 9, nameMap: 'en' },
    monthLabel: { color: '#a6adc8', fontSize: 10 },
  }));

  const series = years.map((y, i) => ({
    type: 'heatmap' as const,
    coordinateSystem: 'calendar' as const,
    calendarIndex: i,
    data: props.data
      .filter((d) => d.date.startsWith(String(y)))
      .map((d) => [d.date, d.dd_pct]),
  }));

  return {
    tooltip: {
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
      formatter: (p: unknown) => {
        const params = p as { value: [string, number] };
        const entry = props.data.find((d) => d.date === params.value[0]);
        const pnl = entry ? `PnL: ${entry.pnl >= 0 ? '+' : ''}${entry.pnl.toFixed(2)}` : '';
        return `<b>${params.value[0]}</b><br/>DD: ${params.value[1].toFixed(2)}%<br/>${pnl}`;
      },
    },
    visualMap: {
      min: 0,
      max: Math.ceil(maxDd),
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      top: 4,
      textStyle: { color: '#a6adc8', fontSize: 10 },
      inRange: {
        color: ['#1e1e2e', '#fab38744', '#fab387', '#f38ba8', '#e64553'],
      },
      itemWidth: 12,
      itemHeight: 120,
    },
    calendar: calendars,
    series,
  };
});

const chartHeight = computed(() => {
  if (!props.data.length) return '100px';
  const firstYear = parseInt(props.data[0].date.split('-')[0]);
  const lastYear = parseInt(props.data[props.data.length - 1].date.split('-')[0]);
  const years = lastYear - firstYear + 1;
  return `${40 + years * 160}px`;
});
</script>

<template>
  <ECharts :option="chartOptions" autoresize :style="{ height: chartHeight }" />
</template>
