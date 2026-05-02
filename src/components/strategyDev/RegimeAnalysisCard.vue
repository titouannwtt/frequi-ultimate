<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

interface HalfStats {
  trades: number;
  profit_pct: number;
  profit_abs: number;
  win_rate: number;
  avg_profit: number;
}

interface RegimeData {
  first_half: HalfStats;
  second_half: HalfStats;
  first_label: string;
  second_label: string;
  consistent: boolean;
}

defineProps<{ data: RegimeData }>();

const labelMap: Record<string, string> = {
  first_half: 'strategyDev.raFirstHalf',
  second_half: 'strategyDev.raSecondHalf',
};
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-4">
    <div class="flex items-center justify-between mb-3">
      <h4 class="text-sm font-semibold">{{ t('strategyDev.raTitle') }}</h4>
      <span
        class="text-sm px-2 py-0.5 rounded-full"
        :class="
          data.consistent
            ? 'bg-green-900/30 text-green-400 border border-green-700/40'
            : 'bg-red-900/30 text-red-400 border border-red-700/40'
        "
      >
        {{ data.consistent ? t('strategyDev.raConsistent') : t('strategyDev.raInconsistent') }}
      </span>
    </div>
    <div class="grid grid-cols-2 gap-4">
      <div
        v-for="(half, label) in {
          [data.first_label]: data.first_half,
          [data.second_label]: data.second_half,
        }"
        :key="label"
        class="space-y-2"
      >
        <h5 class="text-sm font-medium text-surface-400 uppercase">{{ labelMap[label] ? t(labelMap[label]) : label }}</h5>
        <div class="space-y-1 text-sm">
          <div class="flex justify-between">
            <span class="text-surface-500">{{ t('strategyDev.raTrades') }}</span>
            <span>{{ half.trades }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-surface-500">{{ t('strategyDev.raProfit') }}</span>
            <span :class="half.profit_pct >= 0 ? 'text-green-400' : 'text-red-400'">
              {{ half.profit_pct.toFixed(1) }}%
            </span>
          </div>
          <div class="flex justify-between">
            <span class="text-surface-500">{{ t('strategyDev.raWinRate') }}</span>
            <span>{{ half.win_rate.toFixed(1) }}%</span>
          </div>
          <div class="flex justify-between">
            <span class="text-surface-500">{{ t('strategyDev.raAvgProfit') }}</span>
            <span :class="half.avg_profit >= 0 ? 'text-green-400' : 'text-red-400'">
              {{ half.avg_profit.toFixed(2) }}%
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
