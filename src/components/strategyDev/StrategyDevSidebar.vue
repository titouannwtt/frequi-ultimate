<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { RunType } from '@/types';

const { t } = useI18n();
const store = useStrategyDevStore();

const typeOptions = [
  { label: t('strategyDev.allTypes'), value: null },
  { label: t('strategyDev.backtest'), value: RunType.backtest },
  { label: t('strategyDev.hyperopt'), value: RunType.hyperopt },
  { label: t('strategyDev.wfa'), value: RunType.wfa },
];

const strategyOptions = computed(() => [
  { label: t('strategyDev.allStrategies'), value: null },
  ...store.strategies.map((s) => ({ label: s, value: s })),
]);
</script>

<template>
  <div class="flex flex-col gap-2 w-72 p-2 overflow-y-auto" style="max-height: calc(100vh - 120px)">
    <InputText
      v-model="store.filterText"
      :placeholder="t('strategyDev.search')"
      size="small"
      class="w-full"
    />

    <SelectButton
      v-model="store.filterType"
      :options="typeOptions"
      option-label="label"
      option-value="value"
      size="small"
      class="w-full flex-wrap"
    />

    <Select
      v-model="store.filterStrategy"
      :options="strategyOptions"
      option-label="label"
      option-value="value"
      size="small"
      class="w-full"
      :placeholder="t('strategyDev.filterByStrategy')"
    />

    <Divider class="my-1" />

    <div v-if="store.loading" class="text-center text-surface-400 py-4">
      <ProgressSpinner style="width: 30px; height: 30px" />
      <p class="text-sm mt-2">{{ t('strategyDev.loading') }}</p>
    </div>

    <div v-else-if="store.filteredRuns.length === 0" class="text-center text-surface-400 py-4">
      <p class="text-sm">{{ t('strategyDev.noRuns') }}</p>
    </div>

    <RunTreeList v-else :runs="store.filteredRuns" />
  </div>
</template>
