<script setup lang="ts">
import type { GridItemData } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const botStore = useBotStore();
const botComparisonRef = ref<InstanceType<typeof BotComparisonList>>();
const openTradesRef = ref<InstanceType<typeof OpenTradesEnhanced>>();
const closedTradesRef = ref<InstanceType<typeof ClosedTradesEnhanced>>();
const profitBenchmarkRef = ref<any>();
const logConsoleRef = ref<any>();
const profitDistRef = ref<any>();
const activityTimelineRef = ref<any>();
const requestTimelineRef = ref<any>();
const volumeComparatorRef = ref<any>();
const periodBreakdownRef = ref<any>();

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
  <div class="dashboard-bg" :class="{ 'dashboard-bg-static': !layoutStore.backgroundAnimation }">
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
        drag-ignore-from=".ft-no-drag"
      >
        <DraggableContainer
          :header="t('dashboard.profitBenchmark')"
          :widget-id="DashboardLayout.dailyChart"
          has-filter-defaults
          :filters-changed="profitBenchmarkRef?.filtersChanged ?? false"
          @save-filter-defaults="profitBenchmarkRef?.saveCurrentAsDefault()"
        >
          <ProfitBenchmarkChart
            ref="profitBenchmarkRef"
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
        drag-ignore-from=".ft-no-drag"
      >
        <DraggableContainer
          :widget-id="DashboardLayout.botComparison"
          :can-hide="false"
          has-column-settings
          @column-settings-click="botComparisonRef?.showColumnPopover($event)"
        >
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
        drag-ignore-from=".ft-no-drag"
      >
        <DraggableContainer
          :widget-id="DashboardLayout.allOpenTrades"
          has-column-settings
          @column-settings-click="openTradesRef?.showColumnPopover($event)"
        >
          <template #header>
            <div class="flex items-center">
              <span>{{ t('dashboard.openTrades') }}</span>
              <InfoBox
                class="ms-2"
                :hint="t('dashboard.openTradesDesc')"
              />
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
        drag-ignore-from=".ft-no-drag"
      >
        <DraggableContainer
          :widget-id="DashboardLayout.allClosedTrades"
          has-column-settings
          @column-settings-click="closedTradesRef?.showColumnPopover($event)"
        >
          <template #header>
            <div class="flex items-center">
              <span>{{ t('dashboard.closedTrades') }}</span>
              <InfoBox
                class="ms-2"
                :hint="t('dashboard.closedTradesDesc')"
              />
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
        drag-ignore-from=".ft-no-drag"
      >
        <DraggableContainer
          :header="t('dashboard.profitDistribution')"
          :widget-id="DashboardLayout.profitDistributionChart"
          has-filter-defaults
          :filters-changed="profitDistRef?.filtersChanged ?? false"
          @save-filter-defaults="profitDistRef?.saveCurrentAsDefault()"
        >
          <ProfitDistributionEnhanced ref="profitDistRef" :trades="botStore.allTradesSelectedBots" :show-title="false" />
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
        :min-w="8"
        :min-h="12"
        drag-allow-from=".drag-header"
        drag-ignore-from=".ft-no-drag"
      >
        <DraggableContainer
          :header="t('dashboard.activityTimeline')"
          :widget-id="DashboardLayout.activityTimeline"
          has-filter-defaults
          :filters-changed="activityTimelineRef?.filtersChanged ?? false"
          @save-filter-defaults="activityTimelineRef?.saveCurrentAsDefault()"
        >
          <ActivityTimeline ref="activityTimelineRef" />
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
        drag-ignore-from=".ft-no-drag"
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
        drag-ignore-from=".ft-no-drag"
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
        drag-ignore-from=".ft-no-drag"
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
        drag-ignore-from=".ft-no-drag"
      >
        <DraggableContainer
          :header="t('dashboard.logConsole')"
          :widget-id="DashboardLayout.logConsole"
          has-filter-defaults
          :filters-changed="logConsoleRef?.filtersChanged ?? false"
          @save-filter-defaults="logConsoleRef?.saveCurrentAsDefault()"
        >
          <LogConsoleWidget ref="logConsoleRef" />
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
        drag-ignore-from=".ft-no-drag"
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
        drag-ignore-from=".ft-no-drag"
      >
        <DraggableContainer
          :widget-id="DashboardLayout.ratePulse"
          has-filter-defaults
          :filters-changed="requestTimelineRef?.filtersChanged ?? false"
          @save-filter-defaults="requestTimelineRef?.saveCurrentAsDefault()"
        >
          <template #header>
            <span>{{ t('dashboard.requestTimeline') }}</span>
            <span class="ft-live-dot ml-1.5"></span>
          </template>
          <RequestTimeline ref="requestTimelineRef" multi-bot-view />
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
        drag-ignore-from=".ft-no-drag"
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
        drag-ignore-from=".ft-no-drag"
      >
        <DraggableContainer
          :header="t('dashboard.volumeComparator')"
          :widget-id="DashboardLayout.volumeComparator"
          has-filter-defaults
          :filters-changed="volumeComparatorRef?.filtersChanged ?? false"
          @save-filter-defaults="volumeComparatorRef?.saveCurrentAsDefault()"
        >
          <VolumeComparatorChart ref="volumeComparatorRef" multi-bot-view />
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
        drag-ignore-from=".ft-no-drag"
      >
        <DraggableContainer
          :header="t('dashboard.periodBreakdown')"
          :widget-id="DashboardLayout.periodBreakdown"
          has-filter-defaults
          :filters-changed="periodBreakdownRef?.filtersChanged ?? false"
          @save-filter-defaults="periodBreakdownRef?.saveCurrentAsDefault()"
        >
          <PeriodBreakdown ref="periodBreakdownRef" multi-bot-view />
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
  overflow: hidden;
}

/* ── Light mode ── */
.dashboard-bg {
  background: #f0ece6;
}
.dashboard-bg::before {
  content: '';
  position: absolute;
  inset: -40% -20%;
  background:
    repeating-linear-gradient(
      115deg,
      transparent,
      transparent 40%,
      rgba(180, 170, 150, 0.07) 42%,
      transparent 44%
    ),
    repeating-linear-gradient(
      155deg,
      transparent,
      transparent 45%,
      rgba(160, 150, 135, 0.05) 47%,
      transparent 49%
    );
  background-size: 200% 100%;
  animation: ft-wave-drift 45s linear infinite;
  pointer-events: none;
  z-index: 0;
}

/* ── Dark mode ── */
.ft-dark-theme .dashboard-bg {
  background: #06060c;
}

.ft-dark-theme .dashboard-bg::before {
  content: '';
  position: absolute;
  inset: -40% -20%;
  background:
    repeating-linear-gradient(
      115deg,
      transparent,
      transparent 38%,
      rgba(45, 50, 80, 0.35) 40%,
      rgba(35, 40, 70, 0.18) 42%,
      transparent 44%
    ),
    repeating-linear-gradient(
      155deg,
      transparent,
      transparent 42%,
      rgba(30, 35, 65, 0.25) 44%,
      rgba(25, 30, 55, 0.12) 46%,
      transparent 48%
    );
  background-size: 200% 100%;
  animation: ft-wave-drift 45s linear infinite;
  pointer-events: none;
  will-change: background-position;
  z-index: 0;
}

.ft-dark-theme .dashboard-bg::after {
  content: '';
  position: absolute;
  inset: -40% -20%;
  background:
    repeating-linear-gradient(
      135deg,
      transparent,
      transparent 44%,
      rgba(99, 102, 241, 0.04) 46%,
      transparent 48%
    ),
    repeating-linear-gradient(
      170deg,
      transparent,
      transparent 46%,
      rgba(6, 182, 212, 0.03) 48%,
      transparent 50%
    );
  background-size: 200% 100%;
  animation: ft-wave-drift-reverse 60s linear infinite;
  pointer-events: none;
  z-index: 0;
}

.dashboard-bg-static::before,
.dashboard-bg-static::after {
  animation: none !important;
  opacity: 0.5;
}

.dashboard-bg > :deep(.vue-grid-layout) {
  position: relative;
  z-index: 1;
}
</style>
