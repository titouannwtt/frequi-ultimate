<script setup lang="ts">
import type { ChartSliderPosition, PairHistory, PlotConfig, Trade } from '@/types';
import type { TradeSeriesOptions } from '@/utils/charts/tradeChartData';
import type { SeriesInfo, AxisPointerValues } from './CandleChart.vue';
import CandleChart from './CandleChart.vue';
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
  subplotClick: [name: string];
}>();

const settingsStore = useSettingsStore();
const colorStore = useColorStore();
const botStore = useBotStore();
const plotStore = usePlotConfigStore();

const chartRef = ref<InstanceType<typeof CandleChart> | null>(null);
const chartContainerRef = ref<HTMLElement | null>(null);

// ── Strategy indicators button ──
const strategyPlotConfig = ref<PlotConfig | undefined>(undefined);
const loadingStrategyIndicators = ref(false);
const strategyIndicatorsLoaded = ref(false);
let hideSuccessTimer: ReturnType<typeof setTimeout> | undefined;

function plotConfigFingerprint(cfg: PlotConfig | undefined): string {
  if (!cfg) return '';
  const mainKeys = Object.keys(cfg.main_plot ?? {}).sort();
  const subKeys = Object.keys(cfg.subplots ?? {}).sort();
  const subIndicators = subKeys
    .map((k) =>
      Object.keys(cfg.subplots[k] ?? {})
        .sort()
        .join(','),
    )
    .join('|');
  return `${mainKeys.join(',')}::${subIndicators}`;
}

const showStrategyButton = computed(() => {
  if (botStore.activeBot.isWebserverMode) return false;
  if (!strategyPlotConfig.value) return false;
  if (strategyIndicatorsLoaded.value) return true;
  const currentFp = plotConfigFingerprint(plotStore.plotConfig as PlotConfig);
  const stratFp = plotConfigFingerprint(strategyPlotConfig.value);
  return stratFp !== '' && currentFp !== stratFp;
});

async function fetchStrategyPlotConfig() {
  strategyIndicatorsLoaded.value = false;
  try {
    strategyPlotConfig.value = await botStore.activeBot.getStrategyPlotConfig();
  } catch {
    strategyPlotConfig.value = undefined;
  }
}

async function loadStrategyIndicators() {
  loadingStrategyIndicators.value = true;
  try {
    const config = strategyPlotConfig.value ?? (await botStore.activeBot.getStrategyPlotConfig());
    if (config) {
      plotStore.saveCustomPlotConfig(plotStore.plotConfigName, config);
      plotStore.plotConfigChanged();
      strategyPlotConfig.value = config;
      strategyIndicatorsLoaded.value = true;
      if (hideSuccessTimer) clearTimeout(hideSuccessTimer);
      hideSuccessTimer = setTimeout(() => {
        strategyIndicatorsLoaded.value = false;
      }, 5000);
    }
  } catch {
    // silently fail
  } finally {
    loadingStrategyIndicators.value = false;
  }
}

watch(
  () => botStore.activeBot.strategy?.strategy,
  () => {
    fetchStrategyPlotConfig();
  },
);

watch(
  () => plotStore.plotConfig,
  () => {
    if (strategyIndicatorsLoaded.value) return;
  },
  { deep: true },
);

onMounted(() => {
  if (!botStore.activeBot.isWebserverMode) {
    fetchStrategyPlotConfig();
  }
});

const seriesList = ref<SeriesInfo[]>([]);
const axisValues = ref<AxisPointerValues | undefined>(undefined);
const legendVisible = computed({
  get: () => settingsStore.chartLegendVisible,
  set: (v) => {
    settingsStore.chartLegendVisible = v;
  },
});
const volumeVisible = computed({
  get: () => settingsStore.chartVolumeVisible,
  set: (v) => {
    settingsStore.chartVolumeVisible = v;
  },
});

const tradeSeriesOptions = computed<TradeSeriesOptions>(() => ({
  showLiquidation: settingsStore.chartShowLiquidation,
  showInitialStoploss: settingsStore.chartShowInitialStoploss,
  showLeverage: settingsStore.chartShowLeverage,
}));

function onSeriesInfo(info: SeriesInfo[]) {
  seriesList.value = info;
}
function onAxisValues(vals: AxisPointerValues) {
  axisValues.value = vals;
}

function handleToggle(name: string) {
  if (name === 'Volume') {
    volumeVisible.value = !volumeVisible.value;
    return;
  }
  chartRef.value?.toggleSeries(name);
}

function handleIsolate(name: string) {
  chartRef.value?.isolateSeries(name);
}

function handleShowAll() {
  volumeVisible.value = true;
  chartRef.value?.showAllSeries();
}

// Keyboard shortcuts
const shortcutActions = {
  toggleVolume: () => {
    volumeVisible.value = !volumeVisible.value;
  },
  toggleTrades: () => {
    chartRef.value?.toggleSeries('Trades');
  },
  toggleSignals: () => {
    chartRef.value?.toggleSeries('Entry');
    chartRef.value?.toggleSeries('Exit');
  },
  toggleLegend: () => {
    legendVisible.value = !legendVisible.value;
  },
  resetZoom: () => {
    chartRef.value?.resetZoom();
  },
  scrollLeft: () => {
    chartRef.value?.scrollChart(-10);
  },
  scrollRight: () => {
    chartRef.value?.scrollChart(10);
  },
  zoomIn: () => {
    chartRef.value?.zoomChart(0.7);
  },
  zoomOut: () => {
    chartRef.value?.zoomChart(1.4);
  },
};

const { showHelp, shortcuts } = useChartShortcuts(
  shortcutActions,
  toRef(() => settingsStore.chartKeyboardShortcuts),
  chartContainerRef,
);

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
  if (!hasDataset.value) refresh();
}

function assignFirstPair() {
  const [firstPair] = props.availablePairs;
  if (firstPair) {
    /* noop — pair is a prop */
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
    if (settingsStore.useReducedPairCalls && hasAllColumns) refresh();
  },
);

watch(
  () => props.timeframe,
  () => refreshIfNecessary(),
);

const longEntries = computed(
  () => dataset.value?.enter_long_signals ?? dataset.value?.buy_signals ?? 0,
);
const longExits = computed(
  () => dataset.value?.exit_long_signals ?? dataset.value?.sell_signals ?? 0,
);
const shortEntries = computed(() => dataset.value?.enter_short_signals ?? 0);
const shortExits = computed(() => dataset.value?.exit_short_signals ?? 0);
const hasShortSignals = computed(() => shortEntries.value > 0 || shortExits.value > 0);
</script>

<template>
  <div
    ref="chartContainerRef"
    class="single-chart-container"
    :class="{ 'h-full': isSinglePairView, 'multi-view': !isSinglePairView }"
  >
    <!-- Signal stats bar -->
    <div v-if="dataset" class="signal-bar">
      <div class="signal-stats">
        <span class="signal-pill long-entry" :title="t('charts.longEntrySignals')">
          <i-mdi-circle class="w-2.5 h-2.5" />
          {{ longEntries }}
        </span>
        <span class="signal-pill long-exit" :title="t('charts.longExitSignals')">
          <i-mdi-circle-outline class="w-2.5 h-2.5" />
          {{ longExits }}
        </span>
        <template v-if="hasShortSignals">
          <span class="signal-pill short-entry" :title="t('charts.shortEntries')">
            <i-mdi-triangle-down class="w-2.5 h-2.5" />
            {{ shortEntries }}
          </span>
          <span class="signal-pill short-exit">
            <i-mdi-triangle-down-outline class="w-2.5 h-2.5" />
            {{ shortExits }}
          </span>
        </template>
      </div>
      <span class="pair-label">{{ pair || 'Pair' }}</span>
      <Transition name="strat-btn">
        <button
          v-if="showStrategyButton"
          class="load-strat-btn"
          :class="{ 'load-strat-btn--success': strategyIndicatorsLoaded }"
          :disabled="loadingStrategyIndicators"
          @click="loadStrategyIndicators"
        >
          <i-mdi-check v-if="strategyIndicatorsLoaded" class="w-3.5 h-3.5" />
          <i-mdi-chart-line-variant v-else class="w-3.5 h-3.5" />
          <span>{{
            strategyIndicatorsLoaded
              ? t('charts.strategyIndicatorsLoaded')
              : t('charts.loadStrategyIndicators')
          }}</span>
        </button>
      </Transition>
      <div class="signal-bar-right">
        <ProgressSpinner v-if="isLoadingDataset" class="w-3.5 h-3.5" stroke-width="4" />
      </div>
    </div>

    <!-- Legend bar (above chart, not overlapping) -->
    <ChartLegend
      v-if="hasDataset && legendVisible"
      :series="seriesList"
      :axis-values="axisValues"
      :show-realtime-values="settingsStore.chartLegendRealtimeValues"
      :theme="settingsStore.chartTheme"
      @toggle="handleToggle"
      @isolate="handleIsolate"
      @show-all="handleShowAll"
    />

    <!-- Chart -->
    <div class="chart-render">
      <CandleChart
        v-if="hasDataset"
        ref="chartRef"
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
        :volume-visible="volumeVisible"
        :crosshair-style="settingsStore.chartCrosshairStyle"
        :trade-series-options="tradeSeriesOptions"
        @series-info="onSeriesInfo"
        @axis-values="onAxisValues"
        @subplot-click="(name: string) => emit('subplotClick', name)"
      />

      <!-- Keyboard shortcuts help -->
      <Transition name="fade">
        <div
          v-if="showHelp"
          class="shortcuts-overlay"
          :class="{ 'shortcuts-dark': settingsStore.chartTheme === 'dark' }"
        >
          <div class="shortcuts-title">Raccourcis clavier</div>
          <div v-for="s in shortcuts" :key="s.key" class="shortcut-row">
            <kbd class="shortcut-key">{{
              s.key === 'ArrowLeft' ? '←' : s.key === 'ArrowRight' ? '→' : s.key
            }}</kbd>
            <span class="shortcut-desc">{{ s.label }}</span>
          </div>
          <div class="shortcut-row">
            <kbd class="shortcut-key">Esc</kbd>
            <span class="shortcut-desc">Fermer</span>
          </div>
        </div>
      </Transition>

      <!-- Help button -->
      <button
        v-if="hasDataset && settingsStore.chartKeyboardShortcuts"
        class="shortcuts-btn"
        :class="{ 'shortcuts-btn-dark': settingsStore.chartTheme === 'dark' }"
        :title="showHelp ? 'Fermer l\'aide' : 'Raccourcis clavier'"
        @click="showHelp = !showHelp"
      >
        ?
      </button>

      <div v-if="!hasDataset" class="chart-placeholder">
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
  color: #757575;
  background: rgba(158, 158, 158, 0.08);
}
.signal-pill.long-exit {
  color: #757575;
  background: rgba(158, 158, 158, 0.08);
}
.signal-pill.short-entry {
  color: #757575;
  background: rgba(158, 158, 158, 0.08);
}
.signal-pill.short-exit {
  color: #757575;
  background: rgba(158, 158, 158, 0.08);
}

.pair-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #4a4540;
}
.ft-dark-theme .pair-label {
  color: rgba(255, 255, 255, 0.7);
}

.load-strat-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  border: 1px solid rgba(99, 102, 241, 0.3);
  background: rgba(99, 102, 241, 0.08);
  color: rgba(99, 102, 241, 0.9);
  font-size: 0.6875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
  white-space: nowrap;
}
.load-strat-btn:hover {
  background: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.5);
}
.load-strat-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.load-strat-btn--success {
  border-color: rgba(34, 197, 94, 0.4);
  background: rgba(34, 197, 94, 0.1);
  color: rgba(34, 197, 94, 0.9);
  cursor: default;
}
.strat-btn-enter-active,
.strat-btn-leave-active {
  transition:
    opacity 0.3s,
    transform 0.3s;
}
.strat-btn-enter-from,
.strat-btn-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

.signal-bar-right {
  width: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chart-render {
  flex: 1;
  min-height: 0;
  display: flex;
  position: relative;
}
.chart-render > :first-child {
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

/* Shortcuts button */
.shortcuts-btn {
  position: absolute;
  bottom: 2.5rem;
  right: 0.5rem;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: rgba(255, 255, 255, 0.8);
  color: rgba(0, 0, 0, 0.4);
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  z-index: 10;
  backdrop-filter: blur(4px);
}
.shortcuts-btn:hover {
  background: rgba(99, 102, 241, 0.1);
  color: rgb(99, 102, 241);
  border-color: rgba(99, 102, 241, 0.3);
}
.shortcuts-btn-dark {
  background: rgba(15, 15, 25, 0.7);
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.35);
}
.shortcuts-btn-dark:hover {
  background: rgba(99, 102, 241, 0.15);
  color: rgb(165, 180, 252);
}

/* Shortcuts overlay */
.shortcuts-overlay {
  position: absolute;
  bottom: 4.5rem;
  right: 0.5rem;
  z-index: 15;
  padding: 0.625rem 0.75rem;
  border-radius: 0.5rem;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(12px);
  min-width: 160px;
}
.shortcuts-dark {
  background: rgba(15, 15, 25, 0.95);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.shortcuts-title {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(0, 0, 0, 0.4);
  margin-bottom: 0.375rem;
}
.shortcuts-dark .shortcuts-title {
  color: rgba(255, 255, 255, 0.35);
}

.shortcut-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.125rem 0;
}

.shortcut-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.375rem;
  height: 1.25rem;
  padding: 0 0.25rem;
  border-radius: 0.25rem;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: rgba(0, 0, 0, 0.03);
  font-size: 0.625rem;
  font-weight: 600;
  font-family: monospace;
  color: rgba(0, 0, 0, 0.6);
}
.shortcuts-dark .shortcut-key {
  border-color: rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.7);
}

.shortcut-desc {
  font-size: 0.6875rem;
  color: rgba(0, 0, 0, 0.6);
}
.shortcuts-dark .shortcut-desc {
  color: rgba(255, 255, 255, 0.55);
}

/* Fade transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
