<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';

use([BarChart, CanvasRenderer, GridComponent, LegendComponent, TitleComponent, TooltipComponent]);

const props = defineProps<{
  data: { index: number; train: number; test: number }[];
  title: string;
}>();

const { t } = useI18n();

const chartOptions = computed<EChartsOption>(() => ({
  title: { text: props.title, left: 'center', textStyle: { fontSize: 14 } },
  tooltip: { trigger: 'axis' },
  legend: { bottom: 0, data: [t('strategyDev.seriesTrain'), t('strategyDev.seriesTest')] },
  grid: { left: 50, right: 20, top: 40, bottom: 40 },
  xAxis: { type: 'category', data: props.data.map((d) => `W${d.index}`) },
  yAxis: { type: 'value', name: t('strategyDev.axisProfit') },
  series: [
    {
      name: t('strategyDev.seriesTrain'),
      type: 'bar',
      data: props.data.map((d) => d.train),
      itemStyle: { color: '#6366f1' },
    },
    {
      name: t('strategyDev.seriesTest'),
      type: 'bar',
      data: props.data.map((d) => d.test),
      itemStyle: { color: '#10b981' },
    },
  ],
}));
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
    <ECharts :option="chartOptions" autoresize style="height: 300px" />
  </div>
</template>
