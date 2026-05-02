<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart } from 'echarts/charts';
import {
  GridComponent,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
} from 'echarts/components';

use([BarChart, CanvasRenderer, GridComponent, TitleComponent, TooltipComponent, LegendComponent]);

interface WinMC {
  index: number;
  market_context: {
    btc_change_pct: number;
    atr_pct: number;
    volatility_ann_pct: number;
    regime: string;
  };
}

const props = defineProps<{ windows: WinMC[]; title: string }>();

const { t } = useI18n();

const chartOptions = computed<EChartsOption>(() => {
  const labels = props.windows.map((w) => `W${w.index}`);
  const btc = props.windows.map((w) => w.market_context?.btc_change_pct ?? 0);
  const vol = props.windows.map((w) => w.market_context?.volatility_ann_pct ?? 0);

  return {
    title: { text: props.title, left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 50, right: 20, top: 40, bottom: 40 },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', name: '%' },
    series: [
      {
        name: t('strategyDev.seriesBTCChange'),
        type: 'bar',
        data: btc.map((v) => ({
          value: v,
          itemStyle: { color: v >= 0 ? '#a6e3a1' : '#f38ba8' },
        })),
      },
      {
        name: t('strategyDev.seriesVolatility'),
        type: 'bar',
        data: vol,
        itemStyle: { color: '#cba6f7' },
      },
    ],
  };
});

const regimeBadges = computed(() =>
  props.windows.map((w) => ({
    index: w.index,
    regime: w.market_context?.regime ?? 'unknown',
  })),
);
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
    <ECharts :option="chartOptions" autoresize style="height: 280px" />
    <div class="flex gap-2 justify-center mt-2 flex-wrap">
      <span
        v-for="b in regimeBadges"
        :key="b.index"
        class="text-sm px-2 py-0.5 rounded-full capitalize"
        :class="{
          'bg-green-900/30 text-green-400': b.regime === 'bull',
          'bg-red-900/30 text-red-400': b.regime === 'bear',
          'bg-amber-900/30 text-amber-400': b.regime === 'sideways',
          'bg-purple-900/30 text-purple-400': b.regime === 'volatile',
          'bg-surface-700 text-surface-400': !['bull', 'bear', 'sideways', 'volatile'].includes(
            b.regime,
          ),
        }"
      >
        W{{ b.index }}: {{ b.regime }}
      </span>
    </div>
  </div>
</template>
