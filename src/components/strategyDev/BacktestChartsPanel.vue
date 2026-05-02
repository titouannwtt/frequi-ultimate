<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useStrategyDevStore();

const activeSection = ref<'plot-profit' | 'plot-dataframe'>('plot-profit');
const profitLoading = ref(false);
const dataframeLoading = ref(false);
const selectedPair = ref<string | null>(null);

const run = computed(() => store.selectedRun);
const filename = computed(() => run.value?.filename ?? '');
const strategy = computed(() => run.value?.strategy ?? '');

onMounted(async () => {
  if (!filename.value || !strategy.value) return;
  profitLoading.value = true;
  await Promise.all([
    store.fetchPlotProfit(filename.value, strategy.value),
    store.fetchBacktestPairs(filename.value, strategy.value),
  ]);
  profitLoading.value = false;
});

async function onPairSelected(pair: string) {
  if (!pair || !filename.value || !strategy.value) return;
  dataframeLoading.value = true;
  await store.fetchPlotDataframe(filename.value, strategy.value, pair);
  dataframeLoading.value = false;
}

watch(selectedPair, (pair) => {
  if (pair) onPairSelected(pair);
});
</script>

<template>
  <div class="flex flex-col gap-4 py-3" style="max-width: 1600px; margin: 0 auto">
    <!-- Section toggle -->
    <div class="flex gap-2">
      <button
        class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        :class="activeSection === 'plot-profit'
          ? 'bg-primary text-primary-contrast'
          : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700'"
        @click="activeSection = 'plot-profit'"
      >
        <i-mdi-chart-line class="w-4 h-4 inline mr-1" />
        {{ t('strategyDev.plotProfitTitle') }}
      </button>
      <button
        class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        :class="activeSection === 'plot-dataframe'
          ? 'bg-primary text-primary-contrast'
          : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700'"
        @click="activeSection = 'plot-dataframe'"
      >
        <i-mdi-chart-timeline-variant class="w-4 h-4 inline mr-1" />
        {{ t('strategyDev.plotDataframeTitle') }}
      </button>
    </div>

    <!-- Plot Profit Section -->
    <div v-if="activeSection === 'plot-profit'">
      <div v-if="profitLoading" class="flex items-center justify-center py-16 text-surface-400">
        <i-mdi-loading class="w-6 h-6 animate-spin mr-2" />
        {{ t('strategyDev.plotLoadingProfit') }}
      </div>
      <div v-else-if="store.plotProfitData && !store.plotProfitData.error">
        <PlotProfitView :data="store.plotProfitData as Record<string, unknown>" />
      </div>
      <div v-else class="text-center py-16 text-surface-400">
        {{ t('strategyDev.plotNoData') }}
      </div>
    </div>

    <!-- Plot Dataframe Section -->
    <div v-if="activeSection === 'plot-dataframe'">
      <div class="mb-4">
        <Select
          v-model="selectedPair"
          :options="store.backtestPairs"
          :placeholder="t('strategyDev.plotSelectPair')"
          class="w-64"
        />
      </div>

      <div v-if="!selectedPair" class="text-center py-16 text-surface-400">
        {{ t('strategyDev.plotSelectPair') }}
      </div>
      <div v-else-if="dataframeLoading" class="flex items-center justify-center py-16 text-surface-400">
        <i-mdi-loading class="w-6 h-6 animate-spin mr-2" />
        {{ t('strategyDev.plotLoadingDataframe') }}
      </div>
      <div v-else-if="store.plotDataframeData && !store.plotDataframeData.error">
        <PlotDataframeView :data="store.plotDataframeData as Record<string, unknown>" />
      </div>
      <div v-else-if="store.plotDataframeData?.error === 'ohlcv_not_found'" class="text-center py-16 text-surface-400">
        <i-mdi-alert-circle class="w-8 h-8 mx-auto mb-2 text-yellow-500" />
        {{ t('strategyDev.plotNoOhlcv') }}
      </div>
    </div>
  </div>
</template>
