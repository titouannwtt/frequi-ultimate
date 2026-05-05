<script setup lang="ts">
import type { ChartSliderPosition, PairHistory, Trade } from '@/types';
import { LoadingStatus } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    trades?: Trade[];
    availablePairs: string[];
    timeframe: string;
    historicView?: boolean;
    pair?: string;
    sliderPosition?: ChartSliderPosition;
    isSinglePairView?: boolean;
  }>(),
  {
    trades: () => [],
    historicView: false,
    pair: '',
    sliderPosition: undefined,
    isSinglePairView: true,
  },
);

const emit = defineEmits<{
  refreshData: [pair: string, columns: string[]];
}>();

const settingsStore = useSettingsStore();
const colorStore = useColorStore();
const botStore = useBotStore();
const plotStore = usePlotConfigStore();

const dataset = computed((): PairHistory => {
  if (props.historicView) {
    return botStore.activeBot.history[`${props.pair}__${props.timeframe}`]?.data;
  }
  return botStore.activeBot.candleData[`${props.pair}__${props.timeframe}`]?.data;
});

const datasetColumns = computed(() =>
  dataset.value ? (dataset.value.all_columns ?? dataset.value.columns) : [],
);
const datasetLoadedColumns = computed(() =>
  dataset.value ? (dataset.value.columns ?? dataset.value.all_columns) : [],
);

const hasDataset = computed(() => dataset.value && dataset.value.data.length > 0);
const isLoadingDataset = computed((): boolean => {
  if (props.historicView) {
    return botStore.activeBot.historyStatus === LoadingStatus.loading;
  }
  return botStore.activeBot.candleDataStatus === LoadingStatus.loading;
});
const noDatasetText = computed((): string => {
  const status = props.historicView
    ? botStore.activeBot.historyStatus
    : botStore.activeBot.candleDataStatus;

  switch (status) {
    case LoadingStatus.not_loaded:
      return t('charts.notLoadedYet');
    case LoadingStatus.loading:
      return t('charts.loading');
    case LoadingStatus.success:
      return t('charts.noData');
    case LoadingStatus.error:
      return t('charts.loadError');
    default:
      return '';
  }
});

function refresh() {
  emit('refreshData', props.pair, plotStore.usedColumns);
}

function refreshIfNecessary() {
  if (!hasDataset.value) {
    refresh();
  }
}

function assignFirstPair() {
  const [firstPair] = props.availablePairs;
  if (firstPair) {
    //props.pair = firstPair;
  }
}

watch(
  () => props.availablePairs,
  () => {
    if (!props.availablePairs.find((p) => p === props.pair)) {
      assignFirstPair();
      refresh();
    }
  },
);

watch(
  () => plotStore.plotConfig,
  () => {
    const hasAllColumns = plotStore.usedColumns.some(
      (c) => datasetColumns.value.includes(c) && !datasetLoadedColumns.value.includes(c),
    );
    if (settingsStore.useReducedPairCalls && hasAllColumns) {
      refresh();
    }
  },
);

watch(
  () => props.timeframe,
  () => {
    refreshIfNecessary();
  },
);

// Signal counts
const longEntries = computed(() => dataset.value?.enter_long_signals ?? dataset.value?.buy_signals ?? 0);
const longExits = computed(() => dataset.value?.exit_long_signals ?? dataset.value?.sell_signals ?? 0);
const shortEntries = computed(() => dataset.value?.enter_short_signals ?? 0);
const shortExits = computed(() => dataset.value?.exit_short_signals ?? 0);
const hasShortSignals = computed(() => shortEntries.value > 0 || shortExits.value > 0);
</script>

<template>
  <div
    class="single-chart-container"
    :class="{
      'h-full': isSinglePairView,
      'multi-view': !isSinglePairView,
    }"
  >
    <!-- Signal stats bar -->
    <div v-if="dataset" class="signal-bar">
      <div class="signal-stats">
        <span class="signal-pill long-entry" :title="t('charts.longEntrySignals')">
          <i-mdi-triangle class="w-2.5 h-2.5" />
          {{ longEntries }}
        </span>
        <span class="signal-pill long-exit" :title="t('charts.longExitSignals')">
          <i-mdi-diamond class="w-2.5 h-2.5" />
          {{ longExits }}
        </span>
        <template v-if="hasShortSignals">
          <span class="signal-pill short-entry" :title="t('charts.shortEntries')">
            <i-mdi-triangle-down class="w-2.5 h-2.5" />
            {{ shortEntries }}
          </span>
          <span class="signal-pill short-exit">
            <i-mdi-diamond class="w-2.5 h-2.5" />
            {{ shortExits }}
          </span>
        </template>
      </div>
      <span class="pair-label">{{ pair || 'Pair' }}</span>
      <div class="signal-bar-right">
        <ProgressSpinner v-if="isLoadingDataset" class="w-3.5 h-3.5" stroke-width="4" />
      </div>
    </div>

    <!-- Chart -->
    <div class="chart-render">
      <CandleChart
        v-if="hasDataset"
        :dataset="dataset"
        :trades="trades"
        :plot-config="plotStore.plotConfig"
        :heikin-ashi="settingsStore.useHeikinAshiCandles"
        :show-mark-area="settingsStore.showMarkArea"
        :hide-simultaneous-entry-exit="settingsStore.hideSimultaneousEntryExit"
        :use-u-t-c="settingsStore.timezone === 'UTC'"
        :theme="settingsStore.chartTheme"
        :slider-position="sliderPosition"
        :color-up="colorStore.colorUp"
        :color-down="colorStore.colorDown"
        :start-candle-count="settingsStore.chartDefaultCandleCount"
        :label-side="settingsStore.chartLabelSide"
      />
      <div v-else class="chart-placeholder">
        <ProgressSpinner v-if="isLoadingDataset" class="w-6 h-6" />
        <template v-else>
          <i-mdi-chart-line class="w-8 h-8 text-surface-400 dark:text-surface-600 mb-2" />
          <span class="text-sm text-surface-500 dark:text-surface-400">{{ noDatasetText }}</span>
        </template>
        <p v-if="botStore.activeBot.historyTakesLonger" class="text-xs text-surface-400 mt-2">
          {{ t('charts.takingLonger') }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.single-chart-container {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.single-chart-container.multi-view {
  height: 37.5rem;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 0.375rem;
}
.ft-dark-theme .single-chart-container.multi-view {
  border-color: rgba(255, 255, 255, 0.06);
}

/* ── Signal bar ── */
.signal-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.25rem 0.625rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
}
.ft-dark-theme .signal-bar {
  border-bottom-color: rgba(255, 255, 255, 0.04);
}

.signal-stats {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.signal-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.1875rem;
  padding: 0.0625rem 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.6875rem;
  font-weight: 600;
  font-family: monospace;
}
.signal-pill.long-entry {
  color: #00cc20;
  background: rgba(0, 204, 32, 0.08);
}
.signal-pill.long-exit {
  color: #d4a017;
  background: rgba(212, 160, 23, 0.08);
}
.signal-pill.short-entry {
  color: #e04444;
  background: rgba(224, 68, 68, 0.08);
}
.signal-pill.short-exit {
  color: #d4a017;
  background: rgba(212, 160, 23, 0.08);
}

.pair-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #4a4540;
}
.ft-dark-theme .pair-label {
  color: rgba(255, 255, 255, 0.7);
}

.signal-bar-right {
  width: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── Chart render area ── */
.chart-render {
  flex: 1;
  min-height: 0;
  display: flex;
}
.chart-render > * {
  width: 100%;
  min-height: 0;
}

.chart-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
}
</style>
