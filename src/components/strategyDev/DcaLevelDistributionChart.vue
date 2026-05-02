<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart, LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
} from 'echarts/components';
import { useI18n } from 'vue-i18n';

use([BarChart, LineChart, CanvasRenderer, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent]);

const { t } = useI18n();

const C = {
  surface0: '#1e1e2e',
  surface1: '#313244',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  overlay: '#45475a',
  blue: '#89b4fa',
  lavender: '#b4befe',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  peach: '#fab387',
  mauve: '#cba6f7',
} as const;

interface LevelStat {
  level: number;
  label: string;
  count: number;
  pct_of_total: number;
  avg_profit: number;
  total_profit: number;
  winrate: number;
  avg_duration: number;
  avg_stake: number;
}

interface DcaAnalysis {
  total_trades: number;
  max_entries: number;
  avg_entries: number;
  no_dca?: boolean;
  level_distribution: LevelStat[];
  recovery_rate: number;
  single_entry_avg: number;
  multi_entry_avg: number;
  single_count: number;
  multi_count: number;
  profit_contribution_single: number;
  profit_contribution_multi: number;
  pair_dca_stats: { pair: string; avg_entries: number; avg_profit: number; trades: number }[];
  insights: string[];
}

const props = defineProps<{
  data: DcaAnalysis;
}>();

function winrateColor(wr: number): string {
  if (wr > 0.6) return C.green;
  if (wr >= 0.4) return C.yellow;
  return C.red;
}

const chartOptions = computed<EChartsOption>(() => {
  const levels = props.data.level_distribution;
  const labels = levels.map((l) => l.label);
  const counts = levels.map((l) => l.count);
  const avgProfits = levels.map((l) => l.avg_profit);

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: C.surface0,
      borderColor: C.overlay,
      textStyle: { color: C.text, fontSize: 12 },
      formatter: (params: unknown) => {
        const ps = params as { dataIndex: number }[];
        if (!ps.length) return '';
        const d = levels[ps[0].dataIndex];
        return [
          `<b>${d.label}</b>`,
          `${t('strategyDev.dcaCount')}: <b>${d.count}</b> (${d.pct_of_total.toFixed(1)}%)`,
          `${t('strategyDev.dcaAvgProfit')}: <b>${d.avg_profit >= 0 ? '+' : ''}${d.avg_profit.toFixed(2)}%</b>`,
          `${t('strategyDev.dcaWinRate')}: <b>${(d.winrate * 100).toFixed(1)}%</b>`,
          `${t('strategyDev.dcaAvgDuration')}: <b>${d.avg_duration.toFixed(0)}m</b>`,
          `${t('strategyDev.dcaAvgStake')}: <b>${d.avg_stake.toFixed(2)}</b>`,
        ].join('<br/>');
      },
    },
    legend: {
      data: [t('strategyDev.dcaTradeCount'), t('strategyDev.dcaAvgProfit')],
      textStyle: { color: C.subtext, fontSize: 10 },
      top: 4,
      right: 10,
    },
    grid: { left: 50, right: 60, top: 40, bottom: 30 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: C.subtext, fontSize: 11 },
      axisLine: { lineStyle: { color: C.overlay } },
    },
    yAxis: [
      {
        type: 'value',
        name: t('strategyDev.dcaTradeCount'),
        nameTextStyle: { color: C.subtext, fontSize: 10 },
        axisLabel: { color: C.subtext, fontSize: 10 },
        splitLine: { lineStyle: { color: C.surface1 } },
      },
      {
        type: 'value',
        name: t('strategyDev.dcaAvgProfit'),
        nameTextStyle: { color: C.subtext, fontSize: 10 },
        axisLabel: {
          color: C.subtext,
          fontSize: 10,
          formatter: '{value}%',
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: t('strategyDev.dcaTradeCount'),
        type: 'bar',
        yAxisIndex: 0,
        data: counts.map((v, i) => ({
          value: v,
          itemStyle: { color: winrateColor(levels[i].winrate) },
        })),
        barMaxWidth: 40,
      },
      {
        name: t('strategyDev.dcaAvgProfit'),
        type: 'line',
        yAxisIndex: 1,
        data: avgProfits,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: C.mauve, width: 2 },
        itemStyle: { color: C.mauve },
        markLine: {
          silent: true,
          data: [{ yAxis: 0 }],
          lineStyle: { color: C.overlay, type: 'dashed', width: 1 },
          label: { show: false },
        },
      },
    ],
  };
});
</script>

<template>
  <div class="sd-chart-card">
    <div v-if="data.no_dca" class="dca-info-message">
      <span class="dca-info-icon">i</span>
      <span>{{ t('strategyDev.dcaNoDca') }}</span>
    </div>
    <template v-else>
      <ECharts :option="chartOptions" autoresize style="height: 280px" />
      <div class="dca-avg-entries">
        <span class="dca-avg-label">{{ t('strategyDev.dcaAvgEntries') }}</span>
        <span class="dca-avg-value">{{ data.avg_entries.toFixed(2) }}</span>
      </div>
    </template>
  </div>
</template>
