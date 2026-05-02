<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  TitleComponent,
  TooltipComponent,
  MarkAreaComponent,
  MarkPointComponent,
  DataZoomComponent,
} from 'echarts/components';

use([
  ScatterChart,
  CanvasRenderer,
  GridComponent,
  TitleComponent,
  TooltipComponent,
  MarkAreaComponent,
  MarkPointComponent,
  DataZoomComponent,
]);

interface RvDDPoint {
  profit_pct?: number;
  dd_pct?: number;
  dd?: number;
  profit?: number;
  trades?: number;
  loss?: number;
}

const props = defineProps<{
  data: RvDDPoint[];
  title: string;
}>();

const { t } = useI18n();

const chartOptions = computed<EChartsOption>(() => {
  const points = props.data.map((d) => [
    (d.dd_pct ?? d.dd ?? 0),
    (d.profit_pct ?? d.profit ?? 0),
  ]);

  // Find best epoch (lowest loss)
  let bestIdx = 0;
  for (let i = 1; i < props.data.length; i++) {
    if ((props.data[i].loss ?? Infinity) < (props.data[bestIdx].loss ?? Infinity)) {
      bestIdx = i;
    }
  }

  const maxDD = Math.max(...points.map(p => p[0]), 50);
  const maxProfit = Math.max(...points.map(p => p[1]), 10);

  return {
    title: { text: props.title, left: 'center', textStyle: { fontSize: 14, color: '#cdd6f4' } },
    tooltip: {
      trigger: 'item',
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
      formatter: (p: unknown) => {
        const params = p as { value: number[]; dataIndex: number };
        const d = props.data[params.dataIndex];
        return [
          `<b>Epoch #${params.dataIndex + 1}</b>`,
          `DD: <b>${params.value[0].toFixed(1)}%</b>`,
          `Profit: <b>${params.value[1].toFixed(1)}%</b>`,
          d?.trades ? `Trades: <b>${d.trades}</b>` : '',
          d?.loss != null ? `Loss: <b>${d.loss.toFixed(4)}</b>` : '',
        ].filter(Boolean).join('<br/>');
      },
    },
    grid: { left: 60, right: 20, top: 40, bottom: 50 },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
      { type: 'inside', yAxisIndex: 0, filterMode: 'none' },
    ],
    xAxis: {
      type: 'value',
      name: 'Max Drawdown %',
      nameLocation: 'center',
      nameGap: 30,
      axisLabel: { color: '#a6adc8' },
      splitLine: { lineStyle: { color: '#313244' } },
    },
    yAxis: {
      type: 'value',
      name: 'Profit %',
      axisLabel: { color: '#a6adc8' },
      splitLine: { lineStyle: { color: '#313244' } },
    },
    series: [
      {
        type: 'scatter',
        data: points.map((p, i) => ({
          value: p,
          symbolSize: i === bestIdx ? 14 : 6,
          itemStyle: {
            color: i === bestIdx ? '#94e2d5' : (p[1] > 0 && p[0] < 25 ? '#a6e3a1' : '#6c7086'),
            opacity: i === bestIdx ? 1 : 0.6,
            borderColor: i === bestIdx ? '#1e1e2e' : undefined,
            borderWidth: i === bestIdx ? 2 : 0,
          },
          label: {
            show: i < 5,
            formatter: `#${i + 1}`,
            fontSize: 9,
            color: i === bestIdx ? '#94e2d5' : '#a6adc8',
            position: 'top',
            distance: 4,
          },
        })),
        markArea: {
          silent: true,
          data: [
            [
              {
                xAxis: 0,
                yAxis: 0,
                itemStyle: { color: 'rgba(166, 227, 161, 0.06)' },
              },
              {
                xAxis: Math.min(25, maxDD),
                yAxis: maxProfit * 1.1,
              },
            ],
          ],
        },
      },
    ],
  };
});

const bestEpoch = computed(() => {
  if (!props.data.length) return null;
  return props.data.reduce((a, b) => ((a.loss ?? Infinity) < (b.loss ?? Infinity) ? a : b));
});

const greenCount = computed(() =>
  props.data.filter(d => (d.profit_pct ?? d.profit ?? 0) > 0 && (d.dd_pct ?? d.dd ?? 0) < 25).length
);
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
    <ECharts :option="chartOptions" autoresize style="height: 340px" />

    <div class="flex items-center justify-between mt-2 px-2 text-sm text-surface-500">
      <span>{{ t('strategyDev.rvddIdealZone', { count: greenCount, total: data.length }) }}</span>
      <span v-if="bestEpoch" class="text-teal-400">
        {{ t('strategyDev.rvddBest', { profit: (bestEpoch.profit_pct ?? bestEpoch.profit ?? 0).toFixed(1), dd: (bestEpoch.dd_pct ?? bestEpoch.dd ?? 0).toFixed(1) }) }}
      </span>
    </div>
  </div>
</template>
