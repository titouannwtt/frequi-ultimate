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
const gridLayoutActivityTimeline = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.activityTimeline);
});

const gridLayoutMarketPulse = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.marketPulse);
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

const gridLayoutFleetOverview = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.fleetOverview);
});

const gridLayoutVolumeComparator = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.volumeComparator);
});

const gridLayoutPeriodBreakdown = computed((): GridItemData => {
  return findGridLayout(gridLayoutData.value, DashboardLayout.periodBreakdown);
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
  // Rate metrics are now fetched independently by each widget via useRateMetrics composable
});
</script>

<template>
  <div class="dashboard-bg">
    <GridLayout
      class="h-full w-full p-2"
      :row-height="12"
      :layout="gridLayoutData"
      :vertical-compact="false"
      :margin="[4, 4]"
      :responsive-layouts="responsiveGridLayouts"
      :is-resizable="!isLayoutLocked"
      :is-draggable="!isLayoutLocked"
      :responsive="true"
      :prevent-collision="false"
      :cols="{ lg: 48, md: 48, sm: 48, xs: 12, xxs: 6 }"
      :col-num="48"
      @layout-updated="layoutUpdatedEvent"
      @update:breakpoint="breakpointChanged"
    >
    <template #default="{ gridItemProps }">
      <GridItem
        v-show="layoutStore.editMode || layoutStore.isWidgetVisible(DashboardLayout.dailyChart)"
        v-bind="gridItemProps"
        :i="gridLayoutProfitBenchmark.i"
        :x="gridLayoutProfitBenchmark.x"
        :y="gridLayoutProfitBenchmark.y"
        :w="gridLayoutProfitBenchmark.w"
        :h="gridLayoutProfitBenchmark.h"
        :min-w="12"
        :min-h="16"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.profitBenchmark')" :widget-id="DashboardLayout.dailyChart">
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
        :min-w="12"
        :min-h="16"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :widget-id="DashboardLayout.botComparison" :can-hide="false">
          <template #header>
            <div class="flex justify-between items-center w-full">
              <span>{{ t('dashboard.botComparison') }}</span>
              <div class="flex items-center gap-1">
                <button
                  class="p-1 text-xs rounded hover:bg-white/10 cursor-pointer"
                  :title="t('botComparison.filtersTitle')"
                  @click="botComparisonRef?.showFilterPopover($event)"
                >
                  <i-mdi-filter-variant class="inline" />
                </button>
                <button
                  class="p-1 text-xs rounded hover:bg-white/10 cursor-pointer"
                  :title="t('botComparison.groupsTitle')"
                  @click="botComparisonRef?.showGroupsPopover($event)"
                >
                  <i-mdi-folder-multiple class="inline" />
                </button>
                <button
                  class="p-1 text-xs rounded hover:bg-white/10 cursor-pointer"
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
        v-show="layoutStore.editMode || layoutStore.isWidgetVisible(DashboardLayout.allOpenTrades)"
        v-bind="gridItemProps"
        :i="gridLayoutAllOpenTrades.i"
        :x="gridLayoutAllOpenTrades.x"
        :y="gridLayoutAllOpenTrades.y"
        :w="gridLayoutAllOpenTrades.w"
        :h="gridLayoutAllOpenTrades.h"
        :min-w="12"
        :min-h="16"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :widget-id="DashboardLayout.allOpenTrades">
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
      <GridItem
        v-show="layoutStore.editMode || layoutStore.isWidgetVisible(DashboardLayout.allClosedTrades)"
        v-bind="gridItemProps"
        :i="gridLayoutAllClosedTrades.i"
        :x="gridLayoutAllClosedTrades.x"
        :y="gridLayoutAllClosedTrades.y"
        :w="gridLayoutAllClosedTrades.w"
        :h="gridLayoutAllClosedTrades.h"
        :min-w="12"
        :min-h="16"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :widget-id="DashboardLayout.allClosedTrades">
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
        v-show="layoutStore.editMode || layoutStore.isWidgetVisible(DashboardLayout.profitDistributionChart)"
        v-bind="gridItemProps"
        :i="gridLayoutProfitDistribution.i"
        :x="gridLayoutProfitDistribution.x"
        :y="gridLayoutProfitDistribution.y"
        :w="gridLayoutProfitDistribution.w"
        :h="gridLayoutProfitDistribution.h"
        :min-w="12"
        :min-h="16"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.profitDistribution')" :widget-id="DashboardLayout.profitDistributionChart">
          <ProfitDistributionEnhanced :trades="botStore.allTradesSelectedBots" :show-title="false" />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-show="layoutStore.editMode || layoutStore.isWidgetVisible(DashboardLayout.activityTimeline)"
        v-bind="gridItemProps"
        :i="gridLayoutActivityTimeline.i"
        :x="gridLayoutActivityTimeline.x"
        :y="gridLayoutActivityTimeline.y"
        :w="gridLayoutActivityTimeline.w"
        :h="gridLayoutActivityTimeline.h"
        :min-w="16"
        :min-h="24"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.activityTimeline')" :widget-id="DashboardLayout.activityTimeline">
          <ActivityTimeline />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-show="layoutStore.editMode || layoutStore.isWidgetVisible(DashboardLayout.marketPulse)"
        v-bind="gridItemProps"
        :i="gridLayoutMarketPulse.i"
        :x="gridLayoutMarketPulse.x"
        :y="gridLayoutMarketPulse.y"
        :w="gridLayoutMarketPulse.w"
        :h="gridLayoutMarketPulse.h"
        :min-w="16"
        :min-h="24"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :widget-id="DashboardLayout.marketPulse">
          <template #header>
            <span>{{ t('dashboard.marketOverview') }}</span>
            <span class="ft-live-dot ml-1.5"></span>
          </template>
          <MarketPulse />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-show="layoutStore.editMode || layoutStore.isWidgetVisible(DashboardLayout.riskOverview)"
        v-bind="gridItemProps"
        :i="gridLayoutRiskOverview.i"
        :x="gridLayoutRiskOverview.x"
        :y="gridLayoutRiskOverview.y"
        :w="gridLayoutRiskOverview.w"
        :h="gridLayoutRiskOverview.h"
        :min-w="12"
        :min-h="16"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.riskOverview')" :widget-id="DashboardLayout.riskOverview">
          <RiskOverview />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-show="layoutStore.editMode || layoutStore.isWidgetVisible(DashboardLayout.stressTest)"
        v-bind="gridItemProps"
        :i="gridLayoutStressTest.i"
        :x="gridLayoutStressTest.x"
        :y="gridLayoutStressTest.y"
        :w="gridLayoutStressTest.w"
        :h="gridLayoutStressTest.h"
        :min-w="12"
        :min-h="16"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :widget-id="DashboardLayout.stressTest">
          <template #header>
            <span>{{ t('dashboard.stressTest') }}</span>
            <span class="ft-live-dot ml-1.5"></span>
          </template>
          <StressTestCard />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-show="layoutStore.editMode || layoutStore.isWidgetVisible(DashboardLayout.logConsole)"
        v-bind="gridItemProps"
        :i="gridLayoutLogConsole.i"
        :x="gridLayoutLogConsole.x"
        :y="gridLayoutLogConsole.y"
        :w="gridLayoutLogConsole.w"
        :h="gridLayoutLogConsole.h"
        :min-w="16"
        :min-h="16"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.logConsole')" :widget-id="DashboardLayout.logConsole">
          <LogConsoleWidget />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-show="layoutStore.editMode || layoutStore.isWidgetVisible(DashboardLayout.rateBudget)"
        v-bind="gridItemProps"
        :i="gridLayoutRateBudget.i"
        :x="gridLayoutRateBudget.x"
        :y="gridLayoutRateBudget.y"
        :w="gridLayoutRateBudget.w"
        :h="gridLayoutRateBudget.h"
        :min-w="12"
        :min-h="16"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :widget-id="DashboardLayout.rateBudget">
          <template #header>
            <span>{{ t('dashboard.rateMonitor') }}</span>
            <span class="ft-live-dot ml-1.5"></span>
          </template>
          <CacheRateMonitor multi-bot-view />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-show="layoutStore.editMode || layoutStore.isWidgetVisible(DashboardLayout.ratePulse)"
        v-bind="gridItemProps"
        :i="gridLayoutRatePulse.i"
        :x="gridLayoutRatePulse.x"
        :y="gridLayoutRatePulse.y"
        :w="gridLayoutRatePulse.w"
        :h="gridLayoutRatePulse.h"
        :min-w="16"
        :min-h="16"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :widget-id="DashboardLayout.ratePulse">
          <template #header>
            <span>{{ t('dashboard.requestTimeline') }}</span>
            <span class="ft-live-dot ml-1.5"></span>
          </template>
          <RequestTimeline multi-bot-view />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-show="layoutStore.editMode || layoutStore.isWidgetVisible(DashboardLayout.fleetOverview)"
        v-bind="gridItemProps"
        :i="gridLayoutFleetOverview.i"
        :x="gridLayoutFleetOverview.x"
        :y="gridLayoutFleetOverview.y"
        :w="gridLayoutFleetOverview.w"
        :h="gridLayoutFleetOverview.h"
        :min-w="16"
        :min-h="16"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :widget-id="DashboardLayout.fleetOverview">
          <template #header>
            <span>{{ t('dashboard.infraHealth') }}</span>
            <span class="ft-live-dot ml-1.5"></span>
          </template>
          <InfrastructureHealth />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-show="layoutStore.editMode || layoutStore.isWidgetVisible(DashboardLayout.volumeComparator)"
        v-bind="gridItemProps"
        :i="gridLayoutVolumeComparator.i"
        :x="gridLayoutVolumeComparator.x"
        :y="gridLayoutVolumeComparator.y"
        :w="gridLayoutVolumeComparator.w"
        :h="gridLayoutVolumeComparator.h"
        :min-w="16"
        :min-h="20"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.volumeComparator')" :widget-id="DashboardLayout.volumeComparator">
          <VolumeComparatorChart multi-bot-view />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-show="layoutStore.editMode || layoutStore.isWidgetVisible(DashboardLayout.periodBreakdown)"
        v-bind="gridItemProps"
        :i="gridLayoutPeriodBreakdown.i"
        :x="gridLayoutPeriodBreakdown.x"
        :y="gridLayoutPeriodBreakdown.y"
        :w="gridLayoutPeriodBreakdown.w"
        :h="gridLayoutPeriodBreakdown.h"
        :min-w="12"
        :min-h="16"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer :header="t('dashboard.periodBreakdown')" :widget-id="DashboardLayout.periodBreakdown">
          <PeriodBreakdown multi-bot-view />
        </DraggableContainer>
      </GridItem>
    </template>
    </GridLayout>
  </div>
</template>

<style scoped>
.dashboard-bg {
  min-height: 100vh;
  position: relative;
}

.ft-dark-theme .dashboard-bg {
  background: #06060c;
}

.ft-dark-theme .dashboard-bg::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 900px 600px at 10% 20%, rgba(35, 40, 70, 0.6), transparent 65%),
    radial-gradient(ellipse 700px 500px at 90% 80%, rgba(30, 25, 60, 0.5), transparent 65%),
    radial-gradient(ellipse 500px 400px at 50% 45%, rgba(25, 35, 55, 0.4), transparent 65%);
  background-size: 350% 350%;
  animation: ft-wave-drift 20s ease-in-out infinite alternate;
  pointer-events: none;
  will-change: background-position;
  z-index: 0;
}

.ft-dark-theme .dashboard-bg::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 600px 400px at 65% 15%, rgba(99, 102, 241, 0.08), transparent 65%),
    radial-gradient(ellipse 600px 400px at 35% 85%, rgba(6, 182, 212, 0.06), transparent 65%);
  background-size: 280% 280%;
  animation: ft-wave-drift 30s ease-in-out infinite alternate-reverse;
  pointer-events: none;
  z-index: 0;
}

.dashboard-bg {
  background: #f0ece6;
}

.dashboard-bg::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 800px 500px at 20% 30%, rgba(200, 180, 150, 0.15), transparent 65%),
    radial-gradient(ellipse 600px 400px at 80% 70%, rgba(180, 170, 155, 0.12), transparent 65%);
  background-size: 300% 300%;
  animation: ft-wave-drift 25s ease-in-out infinite alternate;
  pointer-events: none;
  z-index: 0;
}

.dashboard-bg > :deep(.vue-grid-layout) {
  position: relative;
  z-index: 1;
}
</style>
