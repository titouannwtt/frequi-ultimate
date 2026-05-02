<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart } from 'echarts/charts';
import { GridComponent, TitleComponent, TooltipComponent } from 'echarts/components';

use([BarChart, CanvasRenderer, GridComponent, TitleComponent, TooltipComponent]);

interface CpcvData {
  n_groups: number;
  n_test_groups: number;
  n_combinations: number;
  n_paths: number;
  avg_return: number;
  sharpe_of_paths: number;
  prob_of_loss: number;
  path_returns: number[];
}

const props = defineProps<{ data: CpcvData }>();

const { t } = useI18n();

const chartOptions = computed<EChartsOption>(() => {
  const returns = [...props.data.path_returns].sort((a, b) => a - b);
  return {
    title: { text: t('strategyDev.chartCPCVPathReturns'), left: 'center', textStyle: { fontSize: 13 } },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const p = Array.isArray(params) ? params[0] : params;
        const item = p as { dataIndex: number; value: number };
        return `Path ${item.dataIndex + 1}: ${item.value.toFixed(2)}%`;
      },
    },
    grid: { left: 60, right: 20, top: 40, bottom: 30 },
    xAxis: {
      type: 'category',
      data: returns.map((_, i) => i + 1),
      name: t('strategyDev.axisPath'),
    },
    yAxis: {
      type: 'value',
      name: t('strategyDev.axisReturnPct'),
      axisLabel: { formatter: '{value}%' },
    },
    series: [
      {
        type: 'bar',
        data: returns.map((v) => ({
          value: v,
          itemStyle: { color: v >= 0 ? '#a6e3a1' : '#f38ba8' },
        })),
      },
    ],
  };
});
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-4">
    <div class="flex items-center justify-between mb-3">
      <h4 class="text-sm font-semibold">{{ t('strategyDev.wfaCpcvTitle') }}</h4>
      <span
        class="text-sm px-2 py-0.5 rounded-full"
        :class="
          data.prob_of_loss < 0.5
            ? 'bg-green-900/30 text-green-400 border border-green-700/40'
            : 'bg-red-900/30 text-red-400 border border-red-700/40'
        "
      >
        P(loss) = {{ (data.prob_of_loss * 100).toFixed(0) }}%
      </span>
    </div>
    <div class="grid grid-cols-4 gap-4 text-center mb-4">
      <div>
        <div
          class="text-lg font-bold tabular-nums"
          :class="data.avg_return >= 0 ? 'text-green-400' : 'text-red-400'"
        >
          {{ data.avg_return.toFixed(2) }}%
        </div>
        <div class="text-sm text-surface-500">{{ t('strategyDev.wfaAvgReturn') }}</div>
      </div>
      <div>
        <div class="text-lg font-bold tabular-nums text-blue-400">
          {{ data.sharpe_of_paths.toFixed(3) }}
        </div>
        <div class="text-sm text-surface-500">{{ t('strategyDev.wfaSharpePaths') }}</div>
      </div>
      <div>
        <div class="text-lg font-bold tabular-nums">{{ data.n_combinations }}</div>
        <div class="text-sm text-surface-500">{{ t('strategyDev.wfaCombinations') }}</div>
      </div>
      <div>
        <div class="text-lg font-bold tabular-nums">{{ data.n_paths }}</div>
        <div class="text-sm text-surface-500">{{ t('strategyDev.wfaPaths') }}</div>
      </div>
    </div>
    <ECharts
      v-if="data.path_returns && data.path_returns.length"
      :option="chartOptions"
      autoresize
      style="height: 250px"
    />
  </div>
</template>
