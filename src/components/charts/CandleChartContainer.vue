<script setup lang="ts">
import type { ChartSliderPosition, PairHistory, Trade } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    trades?: Trade[];
    availablePairs: string[];
    timeframe: string;
    historicView?: boolean;
    reloadDataOnSwitch?: boolean;
    strategy?: string;
    sliderPosition?: ChartSliderPosition;
  }>(),
  {
    trades: () => [],
    historicView: false,
    reloadDataOnSwitch: false,
    strategy: '',
    sliderPosition: undefined,
  },
);

const emit = defineEmits<{
  refreshData: [pair: string, columns: string[]];
}>();

const settingsStore = useSettingsStore();
const botStore = useBotStore();
const plotStore = usePlotConfigStore();

const dataset = computed((): PairHistory => {
  const firstpair = botStore.activeBot.plotMultiPairs[0];
  if (props.historicView) {
    return botStore.activeBot.history[`${firstpair}__${props.timeframe}`]?.data;
  }
  return botStore.activeBot.candleData[`${firstpair}__${props.timeframe}`]?.data;
});

const datasetColumns = computed(() =>
  dataset.value ? (dataset.value.all_columns ?? dataset.value.columns) : [],
);

const strategyName = computed(() => props.strategy || dataset.value?.strategy || '');

const showPlotConfigModal = ref(false);
const focusSubplot = ref('');

function showConfigurator() {
  focusSubplot.value = '';
  showPlotConfigModal.value = !showPlotConfigModal.value;
}

function openConfiguratorOnSubplot(name: string) {
  focusSubplot.value = name;
  showPlotConfigModal.value = true;
}

const showSettingsPanel = ref(false);

watch(
  () => botStore.activeBot.selectedPair,
  () => {
    botStore.activeBot.plotMultiPairs = [botStore.activeBot.selectedPair];
  },
);

onMounted(() => {
  if (botStore.activeBot.selectedPair) {
    botStore.activeBot.plotMultiPairs = [botStore.activeBot.selectedPair];
  } else if (props.availablePairs.length > 0) {
    assignFirstPair();
  }
  plotStore.plotConfigChanged();
});

function refresh() {
  for (const pair of botStore.activeBot.plotMultiPairs) {
    emit('refreshData', pair, plotStore.usedColumns);
  }
}

function refreshIfNecessary(newValue: string[], oldValue: string[] | undefined) {
  for (const pair of newValue) {
    if (oldValue?.includes(pair)) continue;
    emit('refreshData', pair, plotStore.usedColumns);
  }
}

function assignFirstPair() {
  const [firstPair] = props.availablePairs;
  if (firstPair) {
    botStore.activeBot.plotMultiPairs = [firstPair];
  }
}

watch(
  () => props.availablePairs,
  () => {
    if (
      botStore.activeBot.plotMultiPairs.length === 0 ||
      botStore.activeBot.plotMultiPairs.some((p) => !props.availablePairs.includes(p))
    ) {
      assignFirstPair();
      refresh();
    }
  },
);

watch(
  () => botStore.activeBot.plotMultiPairs,
  (newValue, oldValue) => {
    if (newValue.length === 0) return;
    if (!props.historicView || props.reloadDataOnSwitch) {
      refreshIfNecessary(newValue, oldValue);
    }
  },
  { immediate: true },
);

const filteredTrades = computed(() => {
  return props.trades;
});

const singlePairSelection = computed({
  get() {
    return botStore.activeBot.plotMultiPairs[0] || '';
  },
  set(value: string) {
    botStore.activeBot.plotMultiPairs = [value];
  },
});

const activeOptionsCount = computed(() => {
  let count = 0;
  if (settingsStore.useHeikinAshiCandles) count++;
  if (settingsStore.showMarkArea) count++;
  if (settingsStore.hideSimultaneousEntryExit) count++;
  if (!settingsStore.chartVolumeVisible) count++;
  if (settingsStore.chartShowLiquidation) count++;
  if (settingsStore.chartShowInitialStoploss) count++;
  return count;
});
</script>

<template>
  <div class="chart-container">
    <!-- ── Toolbar ── -->
    <div class="chart-toolbar">
      <!-- Left: Strategy + Pair selector -->
      <div class="toolbar-left">
        <span class="strategy-badge">
          <i-mdi-strategy class="w-3.5 h-3.5" />
          {{ strategyName }}
        </span>
        <span class="tf-badge">{{ timeframe || '' }}</span>

        <PairSelectorAdvanced
          v-model="singlePairSelection"
          :available-pairs="availablePairs"
        />

        <button
          class="toolbar-btn"
          :title="t('charts.refreshChart')"
          :disabled="botStore.activeBot.plotMultiPairs.length === 0"
          @click="refresh"
        >
          <i-mdi-refresh class="w-4 h-4" />
        </button>
      </div>

      <!-- Right: Options + Config -->
      <div class="toolbar-right">
        <!-- Settings toggle -->
        <button
          class="toolbar-btn"
          :class="{ active: showSettingsPanel }"
          :title="t('charts.chartOptions')"
          @click="showSettingsPanel = !showSettingsPanel"
        >
          <i-mdi-tune-variant class="w-4 h-4" />
          <span v-if="activeOptionsCount > 0" class="option-badge">{{ activeOptionsCount }}</span>
        </button>

        <!-- Plot config selector -->
        <PlotConfigSelect />

        <!-- Plot configurator -->
        <button
          class="toolbar-btn"
          :title="t('charts.plotConfigurator')"
          @click="showConfigurator"
        >
          <i-mdi-chart-timeline-variant-shimmer class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- ── Settings panel (collapsible) ── -->
    <Transition name="settings-slide">
      <div v-if="showSettingsPanel" class="settings-panel-wrap">
        <div class="settings-panel">
          <label class="toggle-option">
            <span class="toggle-track" :class="{ on: settingsStore.hideSimultaneousEntryExit }" @click="settingsStore.hideSimultaneousEntryExit = !settingsStore.hideSimultaneousEntryExit">
              <span class="toggle-thumb" />
            </span>
            <span>{{ t('charts.hideSimultaneous') }}</span>
          </label>
          <label class="toggle-option">
            <span class="toggle-track" :class="{ on: settingsStore.showMarkArea }" @click="settingsStore.showMarkArea = !settingsStore.showMarkArea">
              <span class="toggle-thumb" />
            </span>
            <span>{{ t('charts.showChartAreas') }}</span>
          </label>
          <label class="toggle-option">
            <span class="toggle-track" :class="{ on: settingsStore.useHeikinAshiCandles }" @click="settingsStore.useHeikinAshiCandles = !settingsStore.useHeikinAshiCandles">
              <span class="toggle-thumb" />
            </span>
            <span>{{ t('charts.heikinAshi') }}</span>
          </label>
        </div>
        <div class="settings-panel">
          <label class="toggle-option">
            <span class="toggle-track" :class="{ on: settingsStore.chartLegendVisible }" @click="settingsStore.chartLegendVisible = !settingsStore.chartLegendVisible">
              <span class="toggle-thumb" />
            </span>
            <span>Légende</span>
          </label>
          <label class="toggle-option">
            <span class="toggle-track" :class="{ on: settingsStore.chartLegendRealtimeValues }" @click="settingsStore.chartLegendRealtimeValues = !settingsStore.chartLegendRealtimeValues">
              <span class="toggle-thumb" />
            </span>
            <span>Valeurs temps réel</span>
          </label>
          <label class="toggle-option">
            <span class="toggle-track" :class="{ on: settingsStore.chartVolumeVisible }" @click="settingsStore.chartVolumeVisible = !settingsStore.chartVolumeVisible">
              <span class="toggle-thumb" />
            </span>
            <span>Volume</span>
          </label>
          <label class="toggle-option">
            <span class="toggle-track" :class="{ on: settingsStore.chartShowLiquidation }" @click="settingsStore.chartShowLiquidation = !settingsStore.chartShowLiquidation">
              <span class="toggle-thumb" />
            </span>
            <span>Zone liquidation</span>
          </label>
          <label class="toggle-option">
            <span class="toggle-track" :class="{ on: settingsStore.chartShowLeverage }" @click="settingsStore.chartShowLeverage = !settingsStore.chartShowLeverage">
              <span class="toggle-thumb" />
            </span>
            <span>Levier</span>
          </label>
          <label class="toggle-option">
            <span class="toggle-track" :class="{ on: settingsStore.chartShowInitialStoploss }" @click="settingsStore.chartShowInitialStoploss = !settingsStore.chartShowInitialStoploss">
              <span class="toggle-thumb" />
            </span>
            <span>SL initial</span>
          </label>
          <label class="toggle-option">
            <span class="toggle-track" :class="{ on: settingsStore.chartKeyboardShortcuts }" @click="settingsStore.chartKeyboardShortcuts = !settingsStore.chartKeyboardShortcuts">
              <span class="toggle-thumb" />
            </span>
            <span>Raccourcis clavier</span>
          </label>
        </div>
        <div class="settings-panel">
          <div class="settings-inline-select">
            <span class="settings-select-label">Crosshair</span>
            <Select
              v-model="settingsStore.chartCrosshairStyle"
              :options="['cross', 'vertical', 'horizontal', 'none']"
              size="small"
              class="settings-select"
            />
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Chart area ── -->
    <div
      v-if="botStore.activeBot.plotMultiPairs?.length > 0"
      class="chart-area-single"
    >
      <SingleCandleChartContainer
        v-for="pair in botStore.activeBot.plotMultiPairs"
        :key="pair"
        :available-pairs="availablePairs"
        :pair="pair"
        :historic-view="botStore.activeBot.isWebserverMode"
        :timeframe="timeframe"
        :trades="filteredTrades"
        :slider-position="props.sliderPosition"
        :is-single-pair-view="true"
        @refresh-data="refresh()"
        @subplot-click="openConfiguratorOnSubplot"
      />
    </div>
    <div v-else class="chart-empty">
      <i-mdi-chart-line class="w-12 h-12 text-surface-400 dark:text-surface-600 mb-3" />
      <span>{{ t('charts.noPairSelected') }}</span>
    </div>

    <!-- ── Plot configurator dialog ── -->
    <Dialog
      id="plotConfiguratorModal"
      v-model:visible="showPlotConfigModal"
      :header="t('charts.plotConfigurator')"
      ok-only
      hide-backdrop
    >
      <PlotConfigurator :is-visible="showPlotConfigModal" :columns="datasetColumns" :focus-subplot="focusSubplot" />
    </Dialog>
  </div>
</template>

<style scoped>
/* ═══════════ Container ═══════════ */
.chart-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ═══════════ Toolbar ═══════════ */
.chart-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.375rem 0.625rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}
.ft-dark-theme .chart-toolbar {
  border-bottom-color: rgba(255, 255, 255, 0.06);
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

/* ── Badges ── */
.strategy-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1875rem 0.5rem;
  border-radius: 0.375rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #6b6560;
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.06);
  white-space: nowrap;
}
.ft-dark-theme .strategy-badge {
  color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.06);
}

.tf-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.1875rem 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.6875rem;
  font-weight: 700;
  font-family: monospace;
  color: rgb(99, 102, 241);
  background: rgba(99, 102, 241, 0.08);
}
.ft-dark-theme .tf-badge {
  color: rgb(165, 180, 252);
  background: rgba(99, 102, 241, 0.12);
}

/* ── Toolbar buttons ── */
.toolbar-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  background: transparent;
  color: #7d7568;
  cursor: pointer;
  transition: all 0.15s ease;
}
.ft-dark-theme .toolbar-btn {
  color: rgba(255, 255, 255, 0.45);
}
.toolbar-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #4a4540;
}
.ft-dark-theme .toolbar-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
}
.toolbar-btn.active {
  background: rgba(99, 102, 241, 0.1);
  color: rgb(79, 70, 229);
  border-color: rgba(99, 102, 241, 0.2);
}
.ft-dark-theme .toolbar-btn.active {
  background: rgba(99, 102, 241, 0.15);
  color: rgb(165, 180, 252);
  border-color: rgba(129, 140, 248, 0.25);
}
.toolbar-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.option-badge {
  position: absolute;
  top: -0.125rem;
  right: -0.125rem;
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 50%;
  font-size: 0.5625rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(99, 102, 241);
  color: white;
}

/* ═══════════ Settings panel ═══════════ */
.settings-panel {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  background: rgba(0, 0, 0, 0.015);
}
.ft-dark-theme .settings-panel {
  border-bottom-color: rgba(255, 255, 255, 0.04);
  background: rgba(255, 255, 255, 0.015);
}

.settings-panel-wrap {
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  background: rgba(0, 0, 0, 0.015);
}
.ft-dark-theme .settings-panel-wrap {
  border-bottom-color: rgba(255, 255, 255, 0.04);
  background: rgba(255, 255, 255, 0.015);
}

.settings-inline-select {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  white-space: nowrap;
  color: #6b6560;
}
.ft-dark-theme .settings-inline-select {
  color: rgba(255, 255, 255, 0.55);
}
.settings-select-label {
  font-weight: 500;
}
.settings-select {
  max-width: 120px;
}

.settings-slide-enter-active,
.settings-slide-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.settings-slide-enter-from,
.settings-slide-leave-to {
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  opacity: 0;
}
.settings-slide-enter-to,
.settings-slide-leave-from {
  max-height: 10rem;
  opacity: 1;
}

/* ── Toggle options ── */
.toggle-option {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  cursor: pointer;
  font-size: 0.75rem;
  color: #6b6560;
  white-space: nowrap;
  user-select: none;
}
.ft-dark-theme .toggle-option {
  color: rgba(255, 255, 255, 0.55);
}

.toggle-track {
  position: relative;
  display: inline-block;
  width: 1.75rem;
  height: 1rem;
  border-radius: 0.5rem;
  background: rgba(0, 0, 0, 0.12);
  transition: background 0.2s ease;
  cursor: pointer;
  flex-shrink: 0;
}
.ft-dark-theme .toggle-track {
  background: rgba(255, 255, 255, 0.12);
}
.toggle-track.on {
  background: rgb(99, 102, 241);
}
.ft-dark-theme .toggle-track.on {
  background: rgb(129, 140, 248);
}

.toggle-thumb {
  position: absolute;
  top: 0.125rem;
  left: 0.125rem;
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}
.toggle-track.on .toggle-thumb {
  transform: translateX(0.75rem);
}

/* ═══════════ Chart area ═══════════ */
.chart-area-single {
  flex: 1;
  min-height: 0;
  width: 100%;
}
.chart-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #9d9589;
  font-size: 1rem;
}
.ft-dark-theme .chart-empty {
  color: rgba(255, 255, 255, 0.3);
}
</style>
