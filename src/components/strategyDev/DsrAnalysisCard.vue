<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

interface DsrData {
  observed_sharpe: number;
  expected_max_sharpe: number;
  n_trials: number;
  genuine: boolean;
}

defineProps<{ data: DsrData }>();
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-4">
    <div class="flex items-center justify-between mb-3">
      <h4 class="text-sm font-semibold flex items-center gap-1.5">{{ t('strategyDev.dsrTitle') }} <InfoTip :text="t('strategyDev.hintDsr')" /></h4>
      <span
        class="text-sm px-2 py-0.5 rounded-full"
        :class="
          data.genuine
            ? 'bg-green-900/30 text-green-400 border border-green-700/40'
            : 'bg-red-900/30 text-red-400 border border-red-700/40'
        "
      >
        {{ data.genuine ? t('strategyDev.dsrGenuine') : t('strategyDev.dsrOverfitted') }}
      </span>
    </div>
    <div class="grid grid-cols-3 gap-4 text-center">
      <div>
        <div
          class="text-xl font-bold tabular-nums"
          :class="data.genuine ? 'text-green-400' : 'text-red-400'"
        >
          {{ data.observed_sharpe.toFixed(3) }}
        </div>
        <div class="text-sm text-surface-500 mt-0.5">{{ t('strategyDev.dsrObservedSharpe') }}</div>
      </div>
      <div>
        <div class="text-xl font-bold tabular-nums text-surface-400">
          {{ data.expected_max_sharpe.toFixed(3) }}
        </div>
        <div class="text-sm text-surface-500 mt-0.5">{{ t('strategyDev.dsrExpectedMaxSR') }}</div>
      </div>
      <div>
        <div class="text-xl font-bold tabular-nums text-surface-400">
          {{ data.n_trials }}
        </div>
        <div class="text-sm text-surface-500 mt-0.5">{{ t('strategyDev.dsrNTrials') }}</div>
      </div>
    </div>
  </div>
</template>
