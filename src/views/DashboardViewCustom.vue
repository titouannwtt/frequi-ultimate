<script setup lang="ts">
import type { GridItemData } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const botStore = useBotStore();
const botComparisonRef = ref<InstanceType<typeof BotComparisonList>>();
const openTradesRef = ref<InstanceType<typeof OpenTradesEnhanced>>();
const closedTradesRef = ref<InstanceType<typeof ClosedTradesEnhanced>>();

const layoutStore = useLayoutStore();
const currentBreakpoint = ref('');

function breakpointChanged(newBreakpoint: string) {
  // console.log('breakpoint:', newBreakpoint);
  currentBreakpoint.value = newBreakpoint;
}
const isResizableLayout = computed(() =>
  ['', 'sm', 'md', 'lg', 'xl'].includes(currentBreakpoint.value),
);
const isLayoutLocked = computed(() => {
  return layoutStore.layoutLocked || !isResizableLayout.value;
});

const gridLayoutData = computed((): GridItemData[] => {
  if (isResizableLayout.value) {
    return layoutStore.dashboardLayout;
  }
  return [...layoutStore.getDashboardLayoutSm];
});

function layoutUpdatedEvent(newLayout) {
  if (isResizableLayout.value) {
    console.log('newlayout', newLayout);
    console.log('saving dashboard');
    layoutStore.dashboardLayout = newLayout;
  }
}

const gridLayoutProfitBenchmark = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.dailyChart);
});

const gridLayoutBotComparison = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.botComparison);
});

const gridLayoutAllOpenTrades = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.allOpenTrades);
});
const gridLayoutAllClosedTrades = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.allClosedTrades);
});

// CumulativeProfitEnhanced has been merged into ProfitBenchmarkChart
const gridLayoutProfitDistribution = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.profitDistributionChart);
});
const gridLayoutTradesLogChart = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.tradesLogChart);
});

const gridLayoutActivityTimeline = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.activityTimeline);
});

const gridLayoutMarketPulse = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.marketPulse);
});

const gridLayoutPerformanceHeatmap = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.performanceHeatmap);
});

const gridLayoutRiskOverview = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.riskOverview);
});

const gridLayoutStressTest = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.stressTest);
});

const gridLayoutLogConsole = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.logConsole);
});

const gridLayoutRateBudget = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.rateBudget);
});

const gridLayoutRatePulse = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.ratePulse);
});

const gridLayoutRequestFlow = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.requestFlow);
});

const gridLayoutCacheHealth = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.cacheHealth);
});

const responsiveGridLayouts = computed(() => {
  return {
    sm: layoutStore.getDashboardLayoutSm,
  };
});

onMounted(async () => {
  botStore.allGetDaily({ timescale: 30 });
  // botStore.activeBot.getTrades();
  botStore.activeBot?.getOpenTrades();
  botStore.activeBot?.getProfit();
  botStore.allGetRateMetrics();
});
</script>

<template>
  <GridLayout
    class="h-full w-full"
    style="padding: 1px"
    :row-height="50"
    :layout="gridLayoutData"
    :vertical-compact="true"
    :margin="[2, 2]"
    :responsive-layouts="responsiveGridLayouts"
    :is-resizable="!isLayoutLocked"
    :is-draggable="!isLayoutLocked"
    :responsive="true"
    :prevent-collision="false"
    :cols="{ lg: 12, md: 12, sm: 12, xs: 4, xxs: 2 }"
    :col-num="12"
    @layout-updated="layoutUpdatedEvent"
    @update:breakpoint="breakpointChanged"
  >
    <template #default="{ gridItemProps }">
      <GridItem
        v-bind="gridItemProps"
        :i="gridLayoutProfitBenchmark.i"
        :x="gridLayoutProfitBenchmark.x"
        :y="gridLayoutProfitBenchmark.y"
        :w="gridLayoutProfitBenchmark.w"
        :h="gridLayoutProfitBenchmark.h"
        :min-w="3"
        :min-h="4"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.profitBenchmark')">
          <ProfitBenchmarkChart
            :trades="botStore.allTradesSelectedBots"
            :open-trades="botStore.allOpenTradesSelectedBots"
          />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-bind="gridItemProps"
        :i="gridLayoutBotComparison.i"
        :x="gridLayoutBotComparison.x"
        :y="gridLayoutBotComparison.y"
        :w="gridLayoutBotComparison.w"
        :h="gridLayoutBotComparison.h"
        :min-w="3"
        :min-h="4"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer>
          <template #header>
            <div class="flex justify-between items-center w-full">
              <span>{{ t('dashboard.botComparison') }}</span>
              <div class="flex items-center gap-1">
                <button
                  class="p-1 text-xs rounded hover:bg-surface-300 dark:hover:bg-surface-600 cursor-pointer"
                  :title="t('botComparison.filtersTitle')"
                  @click="botComparisonRef?.showFilterPopover($event)"
                >
                  <i-mdi-filter-variant class="inline" />
                </button>
                <button
                  class="p-1 text-xs rounded hover:bg-surface-300 dark:hover:bg-surface-600 cursor-pointer"
                  :title="t('botComparison.sort')"
                  @click="botComparisonRef?.showSortPopover($event)"
                >
                  <i-mdi-sort-variant class="inline" />
                </button>
                <button
                  class="p-1 text-xs rounded hover:bg-surface-300 dark:hover:bg-surface-600 cursor-pointer"
                  :title="t('botComparison.alertsTitle')"
                  @click="botComparisonRef?.showAlertsPopover($event)"
                >
                  <i-mdi-bell-alert class="inline" />
                </button>
                <button
                  class="p-1 text-xs rounded hover:bg-surface-300 dark:hover:bg-surface-600 cursor-pointer"
                  :title="t('botComparison.groupsTitle')"
                  @click="botComparisonRef?.showGroupsPopover($event)"
                >
                  <i-mdi-folder-multiple class="inline" />
                </button>
                <button
                  class="p-1 text-xs rounded hover:bg-surface-300 dark:hover:bg-surface-600 cursor-pointer"
                  :title="t('botComparison.exportCSV')"
                  @click="botComparisonRef?.exportCSV()"
                >
                  <i-mdi-download class="inline" />
                </button>
                <button
                  class="p-1 text-xs rounded hover:bg-surface-300 dark:hover:bg-surface-600 cursor-pointer"
                  :title="t('botComparison.columnSettings')"
                  @click="botComparisonRef?.showColumnPopover($event)"
                >
                  <i-mdi-cog class="inline" />
                </button>
              </div>
            </div>
          </template>
          <BotComparisonList ref="botComparisonRef" />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-bind="gridItemProps"
        :i="gridLayoutAllOpenTrades.i"
        :x="gridLayoutAllOpenTrades.x"
        :y="gridLayoutAllOpenTrades.y"
        :w="gridLayoutAllOpenTrades.w"
        :h="gridLayoutAllOpenTrades.h"
        :min-w="3"
        :min-h="4"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer>
          <template #header>
            <div class="flex justify-between items-center w-full">
              <div class="flex items-center">
                <span>{{ t('dashboard.openTrades') }}</span>
                <InfoBox
                  class="ms-2"
                  :hint="t('dashboard.openTradesDesc')"
                />
              </div>
              <div class="flex items-center gap-1">
                <button
                  class="p-1 text-xs rounded hover:bg-surface-300 dark:hover:bg-surface-600 cursor-pointer"
                  :title="t('enhancedTrades.columnSettings')"
                  @click="openTradesRef?.showColumnPopover($event)"
                >
                  <i-mdi-cog class="inline" />
                </button>
              </div>
            </div>
          </template>
          <OpenTradesEnhanced ref="openTradesRef" :trades="botStore.allOpenTradesSelectedBots" multi-bot-view />
        </DraggableContainer>
      </GridItem>
      <!-- CumulativeProfitEnhanced merged into ProfitBenchmarkChart above -->
      <GridItem
        v-bind="gridItemProps"
        :i="gridLayoutAllClosedTrades.i"
        :x="gridLayoutAllClosedTrades.x"
        :y="gridLayoutAllClosedTrades.y"
        :w="gridLayoutAllClosedTrades.w"
        :h="gridLayoutAllClosedTrades.h"
        :min-w="3"
        :min-h="4"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer>
          <template #header>
            <div class="flex justify-between items-center w-full">
              <div class="flex items-center">
                <span>{{ t('dashboard.closedTrades') }}</span>
                <InfoBox
                  class="ms-2"
                  :hint="t('dashboard.closedTradesDesc')"
                />
              </div>
              <div class="flex items-center gap-1">
                <button
                  class="p-1 text-xs rounded hover:bg-surface-300 dark:hover:bg-surface-600 cursor-pointer"
                  :title="t('enhancedTrades.columnSettings')"
                  @click="closedTradesRef?.showColumnPopover($event)"
                >
                  <i-mdi-cog class="inline" />
                </button>
              </div>
            </div>
          </template>
          <ClosedTradesEnhanced ref="closedTradesRef" :trades="botStore.allClosedTradesSelectedBots" multi-bot-view />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-bind="gridItemProps"
        :i="gridLayoutProfitDistribution.i"
        :x="gridLayoutProfitDistribution.x"
        :y="gridLayoutProfitDistribution.y"
        :w="gridLayoutProfitDistribution.w"
        :h="gridLayoutProfitDistribution.h"
        :min-w="3"
        :min-h="4"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.profitDistribution')">
          <ProfitDistributionEnhanced :trades="botStore.allTradesSelectedBots" :show-title="false" />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-bind="gridItemProps"
        :i="gridLayoutTradesLogChart.i"
        :x="gridLayoutTradesLogChart.x"
        :y="gridLayoutTradesLogChart.y"
        :w="gridLayoutTradesLogChart.w"
        :h="gridLayoutTradesLogChart.h"
        :min-w="3"
        :min-h="4"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.tradesLog')">
          <TradesLogEnhanced
            :trades="botStore.allTradesSelectedBots"
            :open-trades="botStore.allOpenTradesSelectedBots"
          />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-bind="gridItemProps"
        :i="gridLayoutActivityTimeline.i"
        :x="gridLayoutActivityTimeline.x"
        :y="gridLayoutActivityTimeline.y"
        :w="gridLayoutActivityTimeline.w"
        :h="gridLayoutActivityTimeline.h"
        :min-w="2"
        :min-h="3"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.activityTimeline')">
          <ActivityTimeline />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-bind="gridItemProps"
        :i="gridLayoutMarketPulse.i"
        :x="gridLayoutMarketPulse.x"
        :y="gridLayoutMarketPulse.y"
        :w="gridLayoutMarketPulse.w"
        :h="gridLayoutMarketPulse.h"
        :min-w="4"
        :min-h="6"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.marketOverview')">
          <MarketPulse />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-bind="gridItemProps"
        :i="gridLayoutPerformanceHeatmap.i"
        :x="gridLayoutPerformanceHeatmap.x"
        :y="gridLayoutPerformanceHeatmap.y"
        :w="gridLayoutPerformanceHeatmap.w"
        :h="gridLayoutPerformanceHeatmap.h"
        :min-w="3"
        :min-h="4"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.performanceHeatmap')">
          <PerformanceHeatmap :trades="botStore.allTradesSelectedBots" />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-bind="gridItemProps"
        :i="gridLayoutRiskOverview.i"
        :x="gridLayoutRiskOverview.x"
        :y="gridLayoutRiskOverview.y"
        :w="gridLayoutRiskOverview.w"
        :h="gridLayoutRiskOverview.h"
        :min-w="3"
        :min-h="4"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.riskOverview')">
          <RiskOverview />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-bind="gridItemProps"
        :i="gridLayoutStressTest.i"
        :x="gridLayoutStressTest.x"
        :y="gridLayoutStressTest.y"
        :w="gridLayoutStressTest.w"
        :h="gridLayoutStressTest.h"
        :min-w="3"
        :min-h="4"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.stressTest')">
          <StressTestCard />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-bind="gridItemProps"
        :i="gridLayoutLogConsole.i"
        :x="gridLayoutLogConsole.x"
        :y="gridLayoutLogConsole.y"
        :w="gridLayoutLogConsole.w"
        :h="gridLayoutLogConsole.h"
        :min-w="4"
        :min-h="4"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.logConsole')">
          <LogConsoleWidget />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-bind="gridItemProps"
        :i="gridLayoutRateBudget.i"
        :x="gridLayoutRateBudget.x"
        :y="gridLayoutRateBudget.y"
        :w="gridLayoutRateBudget.w"
        :h="gridLayoutRateBudget.h"
        :min-w="3"
        :min-h="4"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.rateBudget')">
          <RateBudget multi-bot-view />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-bind="gridItemProps"
        :i="gridLayoutRatePulse.i"
        :x="gridLayoutRatePulse.x"
        :y="gridLayoutRatePulse.y"
        :w="gridLayoutRatePulse.w"
        :h="gridLayoutRatePulse.h"
        :min-w="4"
        :min-h="4"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.ratePulse')">
          <RatePulse multi-bot-view />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-bind="gridItemProps"
        :i="gridLayoutRequestFlow.i"
        :x="gridLayoutRequestFlow.x"
        :y="gridLayoutRequestFlow.y"
        :w="gridLayoutRequestFlow.w"
        :h="gridLayoutRequestFlow.h"
        :min-w="3"
        :min-h="4"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.requestFlow')">
          <RequestFlow multi-bot-view />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-bind="gridItemProps"
        :i="gridLayoutCacheHealth.i"
        :x="gridLayoutCacheHealth.x"
        :y="gridLayoutCacheHealth.y"
        :w="gridLayoutCacheHealth.w"
        :h="gridLayoutCacheHealth.h"
        :min-w="3"
        :min-h="4"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.cacheHealth')">
          <CacheHealth multi-bot-view />
        </DraggableContainer>
      </GridItem>
    </template>
  </GridLayout>
</template>
