<script setup lang="ts">
import { computed } from 'vue';
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
  MarkLineComponent,
  MarkAreaComponent,
} from 'echarts/components';
import { useRegimeOverlay, type RegimeTimelineEntry } from '@/composables/useRegimeOverlay';

use([LineChart, CanvasRenderer, GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent]);

const { t } = useI18n();

const props = defineProps<{
  series: { date: string; dd_pct: number }[];
  regimes?: RegimeTimelineEntry[];
}>();

const regimeTimeline = computed(() => props.regimes);
const { showRegimes, markAreaData } = useRegimeOverlay(regimeTimeline);

const option = computed<EChartsOption>(() => {
  const dates = props.series.map((s) => s.date);
  const values = props.series.map((s) => -Math.abs(s.dd_pct));

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
      formatter: (params: unknown) => {
        const p = (params as { data: number; axisValue: string }[])[0];
        return [`<b>${p.axisValue}</b>`, `Drawdown: ${p.data.toFixed(2)}%`].join('<br/>');
      },
    },
    grid: { left: 60, right: 20, top: 20, bottom: 60 },
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
      type: 'category',
      data: dates,
      axisLabel: {
        color: '#a6adc8',
        fontSize: 11,
        interval: Math.max(Math.floor(dates.length / 8), 1),
      },
      axisLine: { lineStyle: { color: '#45475a' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: '#a6adc8',
        fontSize: 11,
        formatter: (v: number) => `${v}%`,
      },
      splitLine: { lineStyle: { color: '#313244' } },
    },
    series: [
      {
        type: 'line',
        data: values,
        symbol: 'none',
        smooth: false,
        lineStyle: { width: 1.5, color: '#f38ba8' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(243,139,168,0.1)' },
              { offset: 1, color: 'rgba(243,139,168,0.5)' },
            ],
          },
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'solid', color: '#6c7086', width: 1 },
          label: { show: false },
          data: [{ yAxis: 0 }],
        },
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
    <ECharts :option="option" autoresize style="height: 300px" />
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
