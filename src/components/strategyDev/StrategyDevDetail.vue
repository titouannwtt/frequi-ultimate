<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { RunType } from '@/types';

const { t } = useI18n();
const store = useStrategyDevStore();

const activeTab = ref('overview');
const detailLoading = ref(false);

const isHyperopt = computed(() => store.selectedRun?.run_type === RunType.hyperopt);
const isWfa = computed(() => store.selectedRun?.run_type === RunType.wfa);
const isBacktest = computed(() => store.selectedRun?.run_type === RunType.backtest);

// ── Scroll container (.sd-main) ──
const scrollEl = ref<HTMLElement | null>(null);

onMounted(() => {
  const el = document.querySelector('.sd-main');
  if (el instanceof HTMLElement) scrollEl.value = el;
});

function validTabsForType(type: RunType | undefined): string[] {
  const common = ['overview', 'params', 'config', 'source', 'command', 'compare'];
  if (type === RunType.hyperopt) return [...common, 'analyse'];
  if (type === RunType.backtest) return [...common, 'analyse'];
  if (type === RunType.wfa) return [...common, 'wfa-charts'];
  return common;
}

function saveState(filename: string) {
  const saved = store.getRunViewState(filename);
  const scrollTop = saved?.scrollTop ? { ...saved.scrollTop } : {};
  if (scrollEl.value) scrollTop[activeTab.value] = scrollEl.value.scrollTop;
  store.saveRunViewState(filename, activeTab.value, scrollTop);
}

function restoreScroll(filename: string, tab: string) {
  const saved = store.getRunViewState(filename);
  const pos = saved?.scrollTop[tab];
  nextTick(() => {
    requestAnimationFrame(() => {
      if (scrollEl.value) scrollEl.value.scrollTop = pos ?? 0;
    });
  });
}

// Save/restore scroll on tab switch
watch(activeTab, (newTab, oldTab) => {
  if (!store.selectedRun || !scrollEl.value) return;
  const filename = store.selectedRun.filename;
  const saved = store.getRunViewState(filename);
  const scrollTop = saved?.scrollTop ? { ...saved.scrollTop } : {};
  scrollTop[oldTab] = scrollEl.value.scrollTop;
  store.saveRunViewState(filename, newTab, scrollTop);
  restoreScroll(filename, newTab);
});

// Save/restore on run switch
watch(
  () => store.selectedRun,
  async (run, oldRun) => {
    if (!run) return;

    if (oldRun) saveState(oldRun.filename);

    const saved = store.getRunViewState(run.filename);
    const validTabs = validTabsForType(run.run_type);
    const restoredTab = saved?.tab && validTabs.includes(saved.tab) ? saved.tab : 'overview';
    activeTab.value = restoredTab;

    const isCached = store.runCache.has(run.filename);
    if (!isCached) detailLoading.value = true;
    try {
      if (run.run_type === RunType.hyperopt) {
        await store.fetchHyperoptDetail(run.filename);
      } else if (run.run_type === RunType.wfa) {
        await store.fetchWfaDetail(run.filename);
      } else if (run.run_type === RunType.backtest) {
        await store.fetchBacktestSnapshot(run.filename, run.strategy);
      }
    } finally {
      detailLoading.value = false;
    }

    restoreScroll(run.filename, restoredTab);
  },
  { immediate: true },
);
</script>

<template>
  <div v-if="store.selectedRun" class="sd-detail">
    <RunDetailHeader :run="store.selectedRun" />

    <!-- Loading skeleton while detail fetches -->
    <div v-if="detailLoading" class="sd-detail-loading">
      <SkeletonPanel variant="cards" :cols="4" />
      <SkeletonPanel variant="chart" class="mt-4" />
    </div>

    <!-- Content with tabs -->
    <Tabs v-else v-model:value="activeTab" lazy class="mt-2">
      <TabList>
        <Tab value="overview" class="sd-tab">
          <i-mdi-information-outline class="w-4 h-4" />
          {{ t('strategyDev.tabOverview') }}
        </Tab>
        <Tab v-if="isHyperopt || isBacktest" value="analyse" class="sd-tab">
          <i-mdi-chart-areaspline class="w-4 h-4" />
          {{ t('strategyDev.tabAnalyse') }}
        </Tab>
        <Tab v-if="isWfa" value="wfa-charts" class="sd-tab">
          <i-mdi-chart-line class="w-4 h-4" />
          {{ t('strategyDev.tabCharts') }}
        </Tab>
        <Tab value="params" class="sd-tab">
          <i-mdi-tune class="w-4 h-4" />
          {{ t('strategyDev.tabParameters') }}
        </Tab>
        <Tab value="config" class="sd-tab">
          <i-mdi-cog class="w-4 h-4" />
          {{ t('strategyDev.tabConfig') }}
        </Tab>
        <Tab value="source" class="sd-tab">
          <i-mdi-code-braces class="w-4 h-4" />
          {{ t('strategyDev.tabSourceCode') }}
        </Tab>
        <Tab value="command" class="sd-tab">
          <i-mdi-console class="w-4 h-4" />
          {{ t('strategyDev.tabCommand') }}
        </Tab>
        <Tab value="compare" class="sd-tab">
          <i-mdi-compare-horizontal class="w-4 h-4" />
          {{ t('strategyDev.tabCompare') }}
        </Tab>
      </TabList>

      <TabPanels>
        <TabPanel value="overview">
          <Transition name="sd-tab" mode="out-in">
            <div key="overview" class="sd-panel-enter">
              <HyperoptOverviewPanel v-if="isHyperopt" />
              <WfaOverviewPanel v-else-if="isWfa" />
              <OverviewPanel v-else />
            </div>
          </Transition>
        </TabPanel>
        <TabPanel v-if="isHyperopt || isBacktest" value="analyse">
          <Transition name="sd-tab" mode="out-in">
            <div key="analyse" class="sd-panel-enter">
              <HyperoptAnalysePanel v-if="isHyperopt" />
              <BacktestAnalysePanel v-else-if="isBacktest" />
            </div>
          </Transition>
        </TabPanel>
        <TabPanel v-if="isWfa" value="wfa-charts">
          <Transition name="sd-tab" mode="out-in">
            <div key="wfa-charts" class="sd-panel-enter">
              <WfaChartsPanel />
            </div>
          </Transition>
        </TabPanel>
        <TabPanel value="params">
          <Transition name="sd-tab" mode="out-in">
            <div key="params" class="sd-panel-enter">
              <ParamPanel />
            </div>
          </Transition>
        </TabPanel>
        <TabPanel value="config">
          <Transition name="sd-tab" mode="out-in">
            <div key="config" class="sd-panel-enter">
              <ConfigPanel />
            </div>
          </Transition>
        </TabPanel>
        <TabPanel value="source">
          <Transition name="sd-tab" mode="out-in">
            <div key="source" class="sd-panel-enter">
              <SourcePanel />
            </div>
          </Transition>
        </TabPanel>
        <TabPanel value="command">
          <Transition name="sd-tab" mode="out-in">
            <div key="command" class="sd-panel-enter">
              <CommandPanel />
            </div>
          </Transition>
        </TabPanel>
        <TabPanel value="compare">
          <Transition name="sd-tab" mode="out-in">
            <div key="compare" class="sd-panel-enter">
              <ComparePanel />
            </div>
          </Transition>
        </TabPanel>
      </TabPanels>
    </Tabs>
  </div>
</template>

<style scoped>
.sd-detail {
  display: flex;
  flex-direction: column;
  padding: 0 16px;
}

.sd-detail-loading {
  padding: 20px 0;
  animation: sd-fade-in 300ms ease;
}

.sd-tab {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Tab content transitions */
.sd-tab-enter-active {
  animation: sd-slide-up 200ms ease-out;
}
.sd-tab-leave-active {
  transition: opacity 100ms ease;
}
.sd-tab-leave-to {
  opacity: 0;
}
</style>
