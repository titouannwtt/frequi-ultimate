<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

interface HoldoutData {
  test_range: string;
  test_metrics: Record<string, number>;
  baseline_metrics: Record<string, unknown>;
}

const props = defineProps<{ data: HoldoutData }>();

const { t } = useI18n();

const metrics = computed(() => {
  const m = props.data.test_metrics;
  return [
    { label: 'Period', value: props.data.test_range },
    {
      label: 'Profit',
      value: `${(m.profit_pct ?? 0).toFixed(2)}%`,
      color: (m.profit_pct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400',
    },
    { label: 'Trades', value: String(m.trades ?? 0) },
    { label: 'Win Rate', value: `${((m.win_rate ?? 0) * 100).toFixed(1)}%` },
    { label: 'Max DD', value: `${(m.max_dd_pct ?? 0).toFixed(2)}%`, color: 'text-red-400' },
    { label: 'Sharpe', value: (m.sharpe ?? 0).toFixed(3) },
    { label: 'Calmar', value: (m.calmar ?? 0).toFixed(2) },
  ].filter((x) => x.value !== '0' && x.value !== '0.00%' && x.value !== '0.000');
});
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-4">
    <div class="flex items-center gap-2 mb-3">
      <i-mdi-shield-check class="w-5 h-5 text-blue-400" />
      <h4 class="text-sm font-semibold">{{ t('strategyDev.wfaHoldoutTitle') }}</h4>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div v-for="m in metrics" :key="m.label" class="text-center">
        <div class="text-lg font-bold tabular-nums" :class="m.color || 'text-surface-300'">
          {{ m.value }}
        </div>
        <div class="text-sm text-surface-500">{{ m.label }}</div>
      </div>
    </div>
  </div>
</template>
