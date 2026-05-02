<script setup lang="ts">
import { LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  MarkAreaComponent,
  TooltipComponent,
} from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import VChart from 'vue-echarts';
import { useRegimeOverlay, type RegimeTimelineEntry } from '@/composables/useRegimeOverlay';
import { useI18n } from 'vue-i18n';

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, DataZoomComponent, MarkAreaComponent]);

const { t } = useI18n();

const props = defineProps<{
  data: Array<{ date: string; utilization_pct: number; deployed: number }>;
  regimes?: RegimeTimelineEntry[];
}>();

const regimeTimeline = computed(() => props.regimes);
const { showRegimes, markAreaData } = useRegimeOverlay(regimeTimeline);

const chartOptions = computed(() => {
  const dates = props.data.map((d) => d.date);
  const utilization = props.data.map((d) => d.utilization_pct);

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(30, 30, 46, 0.95)',
      borderColor: 'rgba(69, 71, 90, 0.5)',
      textStyle: { color: '#cdd6f4', fontSize: 11 },
      formatter: (params: any[]) => {
        const p = params[0];
        const item = props.data[p.dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${p.name}</div>
          <div>${p.marker} Utilization: <b>${item.utilization_pct.toFixed(1)}%</b></div>
          <div>Deployed: <b>${item.deployed.toFixed(2)}</b></div>`;
      },
    },
    grid: { left: 50, right: 20, top: 20, bottom: 60 },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      {
        type: 'slider',
        height: 20,
        bottom: 8,
        borderColor: 'rgba(69,71,90,0.3)',
        fillerColor: 'rgba(137,180,250,0.08)',
        handleStyle: { color: '#89b4fa' },
        textStyle: { color: '#6c7086', fontSize: 10 },
      },
    ],
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { color: '#6c7086', fontSize: 10, rotate: 45 },
      axisLine: { lineStyle: { color: 'rgba(69,71,90,0.3)' } },
    },
    yAxis: {
      type: 'value',
      name: '%',
      min: 0,
      max: 100,
      axisLabel: {
        color: '#6c7086',
        fontSize: 10,
        formatter: '{value}%',
      },
      splitLine: { lineStyle: { color: 'rgba(69,71,90,0.2)' } },
    },
    series: [
      {
        type: 'line',
        data: utilization,
        step: 'end',
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(166,227,161,0.25)' },
              { offset: 1, color: 'rgba(166,227,161,0.02)' },
            ],
          },
        },
        lineStyle: { color: '#a6e3a1', width: 1.5 },
        itemStyle: { color: '#a6e3a1' },
        symbol: 'none',
        markArea: markAreaData.value.length ? { silent: true, data: markAreaData.value as any } : undefined,
      },
    ],
  };
});
</script>

<template>
  <div>
    <div v-if="regimes?.length" class="regime-toggle">
      <button
        class="regime-toggle-btn"
        :class="{ active: showRegimes }"
        @click="showRegimes = !showRegimes"
      >
        <span class="regime-dot" />
        {{ t('strategyDev.regimeShowOverlay') }}
      </button>
    </div>
    <VChart :option="chartOptions" autoresize style="height: 280px" />
  </div>
</template>

<style scoped>
.regime-toggle {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 4px;
}
.regime-toggle-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid rgba(69, 71, 90, 0.4);
  background: transparent;
  color: #a6adc8;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.regime-toggle-btn:hover {
  border-color: rgba(69, 71, 90, 0.7);
  color: #cdd6f4;
}
.regime-toggle-btn.active {
  background: rgba(137, 180, 250, 0.12);
  border-color: rgba(137, 180, 250, 0.4);
  color: #89b4fa;
}
.regime-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: linear-gradient(135deg, #a6e3a1, #f9e2af, #89b4fa, #f38ba8);
}
</style>
