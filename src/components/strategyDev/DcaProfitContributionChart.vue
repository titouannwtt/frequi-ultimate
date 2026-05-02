<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from 'echarts/components';
import { useI18n } from 'vue-i18n';

use([BarChart, CanvasRenderer, GridComponent, TooltipComponent, LegendComponent]);

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

interface DcaAnalysis {
  total_trades: number;
  max_entries: number;
  avg_entries: number;
  no_dca?: boolean;
  level_distribution: {
    level: number;
    label: string;
    count: number;
    pct_of_total: number;
    avg_profit: number;
    total_profit: number;
    winrate: number;
    avg_duration: number;
    avg_stake: number;
  }[];
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

const topPairs = computed(() => {
  return [...props.data.pair_dca_stats]
    .sort((a, b) => b.avg_entries - a.avg_entries)
    .slice(0, 5);
});

function profitColor(val: number): string {
  return val >= 0 ? C.green : C.red;
}

const chartOptions = computed<EChartsOption>(() => {
  const labels = [
    t('strategyDev.dcaSingleEntry'),
    t('strategyDev.dcaMultiEntry'),
  ];
  const contributions = [
    props.data.profit_contribution_single,
    props.data.profit_contribution_multi,
  ];

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: C.surface0,
      borderColor: C.overlay,
      textStyle: { color: C.text, fontSize: 12 },
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const ps = params as { dataIndex: number; value: number; name: string }[];
        if (!ps.length) return '';
        const p = ps[0];
        const isSingle = p.dataIndex === 0;
        const count = isSingle ? props.data.single_count : props.data.multi_count;
        const avg = isSingle ? props.data.single_entry_avg : props.data.multi_entry_avg;
        return [
          `<b>${p.name}</b>`,
          `${t('strategyDev.dcaProfitContrib')}: <b>${p.value.toFixed(1)}%</b>`,
          `${t('strategyDev.dcaCount')}: <b>${count}</b>`,
          `${t('strategyDev.dcaAvgProfit')}: <b>${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%</b>`,
        ].join('<br/>');
      },
    },
    grid: { left: 130, right: 30, top: 10, bottom: 20 },
    yAxis: {
      type: 'category',
      data: labels,
      inverse: true,
      axisLabel: { color: C.text, fontSize: 11 },
      axisLine: { lineStyle: { color: C.overlay } },
    },
    xAxis: {
      type: 'value',
      axisLabel: {
        color: C.subtext,
        fontSize: 10,
        formatter: '{value}%',
      },
      splitLine: { lineStyle: { color: C.surface1 } },
    },
    series: [
      {
        type: 'bar',
        data: contributions.map((v, i) => ({
          value: v,
          itemStyle: { color: i === 0 ? C.blue : C.mauve },
        })),
        barMaxWidth: 28,
        label: {
          show: true,
          position: 'right',
          color: C.subtext,
          fontSize: 11,
          formatter: (p: { value: number }) => `${p.value.toFixed(1)}%`,
        },
      },
    ],
  };
});
</script>

<template>
  <div v-if="!data.no_dca" class="sd-chart-card">
    <ECharts :option="chartOptions" autoresize style="height: 200px" />

    <!-- Comparison row -->
    <div class="dca-comparison">
      <div class="dca-cmp-item">
        <span class="dca-cmp-label">{{ t('strategyDev.dcaSingleEntryAvg') }}</span>
        <span class="dca-cmp-value" :style="{ color: profitColor(data.single_entry_avg) }">
          {{ data.single_entry_avg >= 0 ? '+' : '' }}{{ data.single_entry_avg.toFixed(2) }}%
        </span>
      </div>
      <div class="dca-cmp-item">
        <span class="dca-cmp-label">{{ t('strategyDev.dcaMultiEntryAvg') }}</span>
        <span class="dca-cmp-value" :style="{ color: profitColor(data.multi_entry_avg) }">
          {{ data.multi_entry_avg >= 0 ? '+' : '' }}{{ data.multi_entry_avg.toFixed(2) }}%
        </span>
      </div>
    </div>

    <!-- Top pairs table -->
    <div v-if="topPairs.length" class="dca-pair-table-wrap">
      <table class="dca-pair-table">
        <thead>
          <tr>
            <th>{{ t('strategyDev.dcaPair') }}</th>
            <th>{{ t('strategyDev.dcaAvgEntries') }}</th>
            <th>{{ t('strategyDev.dcaAvgProfit') }}</th>
            <th>{{ t('strategyDev.dcaTrades') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in topPairs" :key="p.pair">
            <td class="dca-pair-name">{{ p.pair }}</td>
            <td class="dca-pair-val">{{ p.avg_entries.toFixed(1) }}</td>
            <td class="dca-pair-val" :style="{ color: profitColor(p.avg_profit) }">
              {{ p.avg_profit >= 0 ? '+' : '' }}{{ p.avg_profit.toFixed(2) }}%
            </td>
            <td class="dca-pair-val">{{ p.trades }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
