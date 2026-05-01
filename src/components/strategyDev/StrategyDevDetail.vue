<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { RunType } from '@/types';

const { t } = useI18n();
const store = useStrategyDevStore();

const activeTab = ref('overview');

watch(
  () => store.selectedRun,
  async (run) => {
    if (!run) return;
    activeTab.value = 'overview';
    if (run.run_type === RunType.hyperopt) {
      await store.fetchHyperoptDetail(run.filename);
    } else if (run.run_type === RunType.wfa) {
      await store.fetchWfaDetail(run.filename);
    } else if (run.run_type === RunType.backtest) {
      await store.fetchBacktestSnapshot(run.filename, run.strategy);
    }
  },
  { immediate: true },
);

const isHyperopt = computed(() => store.selectedRun?.run_type === RunType.hyperopt);
const isWfa = computed(() => store.selectedRun?.run_type === RunType.wfa);
</script>

<template>
  <div v-if="store.selectedRun" class="flex flex-col px-4">
    <RunDetailHeader :run="store.selectedRun" />

    <Tabs v-model:value="activeTab" lazy class="mt-2">
      <TabList>
        <Tab value="overview" class="flex items-center gap-1">
          <i-mdi-information-outline class="w-4 h-4" />
          {{ t('strategyDev.tabOverview') }}
        </Tab>
        <Tab v-if="isHyperopt" value="charts" class="flex items-center gap-1">
          <i-mdi-chart-line class="w-4 h-4" />
          {{ t('strategyDev.tabCharts') }}
        </Tab>
        <Tab v-if="isWfa" value="wfa-charts" class="flex items-center gap-1">
          <i-mdi-chart-line class="w-4 h-4" />
          {{ t('strategyDev.tabCharts') }}
        </Tab>
        <Tab value="params" class="flex items-center gap-1">
          <i-mdi-tune class="w-4 h-4" />
          {{ t('strategyDev.tabParameters') }}
        </Tab>
        <Tab value="config" class="flex items-center gap-1">
          <i-mdi-cog class="w-4 h-4" />
          {{ t('strategyDev.tabConfig') }}
        </Tab>
        <Tab value="source" class="flex items-center gap-1">
          <i-mdi-code-braces class="w-4 h-4" />
          {{ t('strategyDev.tabSourceCode') }}
        </Tab>
        <Tab value="command" class="flex items-center gap-1">
          <i-mdi-console class="w-4 h-4" />
          {{ t('strategyDev.tabCommand') }}
        </Tab>
      </TabList>

      <TabPanels>
        <TabPanel value="overview">
          <HyperoptOverviewPanel v-if="isHyperopt" />
          <WfaOverviewPanel v-else-if="isWfa" />
          <OverviewPanel v-else />
        </TabPanel>
        <TabPanel v-if="isHyperopt" value="charts">
          <HyperoptChartsPanel />
        </TabPanel>
        <TabPanel v-if="isWfa" value="wfa-charts">
          <WfaChartsPanel />
        </TabPanel>
        <TabPanel value="params">
          <ParamPanel />
        </TabPanel>
        <TabPanel value="config">
          <ConfigPanel />
        </TabPanel>
        <TabPanel value="source">
          <SourcePanel />
        </TabPanel>
        <TabPanel value="command">
          <CommandPanel />
        </TabPanel>
      </TabPanels>
    </Tabs>
  </div>
</template>
