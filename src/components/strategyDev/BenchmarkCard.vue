<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

interface BenchmarkItem {
  value: number;
  benchmark: number;
  above: boolean;
}

interface BenchmarkData {
  sharpe: BenchmarkItem;
  dd: BenchmarkItem;
}

defineProps<{ data: BenchmarkData }>();
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-4">
    <h4 class="text-sm font-semibold mb-3">{{ t('strategyDev.bmTitle') }}</h4>
    <div class="grid grid-cols-2 gap-4">
      <div class="text-center">
        <div
          class="text-2xl font-bold tabular-nums"
          :class="data.sharpe.above ? 'text-green-400' : 'text-red-400'"
        >
          {{ data.sharpe.value.toFixed(3) }}
        </div>
        <div class="text-sm text-surface-500 mt-0.5">
          Sharpe (vs {{ data.sharpe.benchmark }})
        </div>
        <span
          class="text-sm px-1.5 py-0.5 rounded mt-1 inline-block"
          :class="
            data.sharpe.above
              ? 'bg-green-900/30 text-green-400'
              : 'bg-surface-700 text-surface-400'
          "
        >
          {{ data.sharpe.above ? t('strategyDev.bmAbove') : t('strategyDev.bmBelow') }}
        </span>
      </div>
      <div class="text-center">
        <div
          class="text-2xl font-bold tabular-nums"
          :class="!data.dd.above ? 'text-green-400' : 'text-red-400'"
        >
          {{ data.dd.value.toFixed(1) }}%
        </div>
        <div class="text-sm text-surface-500 mt-0.5">
          Max DD (vs {{ data.dd.benchmark }}%)
        </div>
        <span
          class="text-sm px-1.5 py-0.5 rounded mt-1 inline-block"
          :class="
            !data.dd.above
              ? 'bg-green-900/30 text-green-400'
              : 'bg-red-900/30 text-red-400'
          "
        >
          {{ !data.dd.above ? t('strategyDev.bmHealthy') : t('strategyDev.bmHigh') }}
        </span>
      </div>
    </div>
  </div>
</template>
