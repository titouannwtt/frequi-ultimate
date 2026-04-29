<script setup lang="ts">
import type { GridItemData } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const botStore = useBotStore();
const layoutStore = useLayoutStore();
const settingsStore = useSettingsStore();
const currentBreakpoint = ref('');

const breakpointChanged = (newBreakpoint: string) => {
  // console.log('breakpoint:', newBreakpoint);
  currentBreakpoint.value = newBreakpoint;
};
const isResizableLayout = computed(() =>
  ['', 'sm', 'md', 'lg', 'xl'].includes(currentBreakpoint.value),
);
const isLayoutLocked = computed(() => {
  return layoutStore.layoutLocked || !isResizableLayout.value;
});
const gridLayoutData = computed((): GridItemData[] => {
  if (isResizableLayout.value) {
    return layoutStore.tradingLayout;
  }
  return [...layoutStore.getTradingLayoutSm];
});

const gridLayoutMultiPane = computed(() => {
  return findGridLayout(gridLayoutData.value, TradeLayout.multiPane);
});

const gridLayoutOpenTrades = computed(() => {
  return findGridLayout(gridLayoutData.value, TradeLayout.openTrades);
});

const gridLayoutTradeHistory = computed(() => {
  return findGridLayout(gridLayoutData.value, TradeLayout.tradeHistory);
});

const gridLayoutTradeDetail = computed(() => {
  return findGridLayout(gridLayoutData.value, TradeLayout.tradeDetail);
});

const gridLayoutChartView = computed(() => {
  return findGridLayout(gridLayoutData.value, TradeLayout.chartView);
});

const responsiveGridLayouts = computed(() => {
  return {
    sm: layoutStore.getTradingLayoutSm,
  };
});

function refreshOHLCV(pair: string, columns: string[]) {
  botStore.activeBot.getPairCandles({
    pair: pair,
    timeframe: botStore.activeBot.timeframe,
    columns: columns,
  });
}
</script>

<template>
  <GridLayout
    class="h-full w-full"
    style="padding: 1px"
    :row-height="50"
    :layout="gridLayoutData"
    :vertical-compact="false"
    :margin="[1, 1]"
    :responsive-layouts="responsiveGridLayouts"
    :is-resizable="!isLayoutLocked"
    :is-draggable="!isLayoutLocked"
    :responsive="true"
    :cols="{ lg: 12, md: 12, sm: 12, xs: 4, xxs: 2 }"
    :col-num="12"
    @update:breakpoint="breakpointChanged"
  >
    <template #default="{ gridItemProps }">
      <GridItem
        v-if="gridLayoutMultiPane.h != 0"
        v-bind="gridItemProps"
        :i="gridLayoutMultiPane.i"
        :x="gridLayoutMultiPane.x"
        :y="gridLayoutMultiPane.y"
        :w="gridLayoutMultiPane.w"
        :h="gridLayoutMultiPane.h"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer>
          <template #header>
            <div class="flex items-center gap-1">
              <i-mdi-view-grid />
              <span>{{ t('trading.multiPane') }}</span>
            </div>
          </template>
          <div class="mt-1 flex justify-center">
            <BotControls class="mt-1 mb-2" />
          </div>
          <Tabs value="0" scrollable lazy>
            <TabList>
              <Tab value="0" severity="secondary">
                <div class="flex items-center gap-1" :title="t('trading.pairsCombined')">
                  <i-mdi-currency-btc />
                  <span v-if="settingsStore.multiPaneButtonsShowText"
                    >{{ t('trading.pairsCombined') }}</span
                  >
                </div>
              </Tab>
              <Tab value="1" severity="secondary">
                <div class="flex items-center gap-1" :title="t('trading.general')">
                  <i-mdi-information />
                  <span v-if="settingsStore.multiPaneButtonsShowText">{{ t('trading.general') }}</span>
                </div>
              </Tab>
              <Tab value="2" severity="secondary">
                <div class="flex items-center gap-1" :title="t('trading.performance')">
                  <i-mdi-chart-bar />
                  <span v-if="settingsStore.multiPaneButtonsShowText"
                    >{{ t('trading.performance') }}</span
                  >
                </div>
              </Tab>
              <Tab value="3" severity="secondary">
                <div class="flex items-center gap-1" :title="t('trading.balance')">
                  <i-mdi-wallet />
                  <span v-if="settingsStore.multiPaneButtonsShowText">{{ t('trading.balance') }}</span>
                </div>
              </Tab>
              <Tab value="4" severity="secondary">
                <div class="flex items-center gap-1" :title="t('trading.timeBreakdown')">
                  <i-mdi-calendar-clock />
                  <span v-if="settingsStore.multiPaneButtonsShowText"
                    >{{ t('trading.timeBreakdown') }}</span
                  >
                </div>
              </Tab>
              <Tab value="5" severity="secondary">
                <div class="flex items-center gap-1" :title="t('trading.pairlist')">
                  <i-mdi-format-list-bulleted />
                  <span v-if="settingsStore.multiPaneButtonsShowText">{{ t('trading.pairlist') }}</span>
                </div>
              </Tab>
              <Tab value="6" severity="secondary">
                <div class="flex items-center gap-1" :title="t('trading.pairLocks')">
                  <i-mdi-lock />
                  <span v-if="settingsStore.multiPaneButtonsShowText">{{ t('trading.pairLocks') }}</span>
                </div>
              </Tab>
              <Tab value="7" severity="secondary">
                <div class="flex items-center gap-1" title="Cache Daemons">
                  <i-mdi-database-sync />
                  <span v-if="settingsStore.multiPaneButtonsShowText">Cache</span>
                </div>
              </Tab>
            </TabList>
            <TabPanels>
              <TabPanel value="0">
                <PairSummary
                  :pairlist="botStore.activeBot.whitelist"
                  :current-locks="botStore.activeBot.activeLocks"
                  :trades="botStore.activeBot.openTrades"
                />
              </TabPanel>
              <TabPanel value="1">
                <BotStatus />
              </TabPanel>
              <TabPanel value="2" lazy>
                <BotPerformance />
              </TabPanel>
              <TabPanel value="3" lazy>
                <BotBalance />
              </TabPanel>
              <TabPanel value="4" lazy>
                <PeriodBreakdown />
              </TabPanel>

              <TabPanel value="5" lazy>
                <PairListLive />
              </TabPanel>
              <TabPanel value="6" lazy>
                <PairLockList />
              </TabPanel>
              <TabPanel value="7" lazy>
                <CacheStatusWidget />
              </TabPanel>
            </TabPanels>
          </Tabs>
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-if="gridLayoutOpenTrades.h != 0"
        v-bind="gridItemProps"
        :i="gridLayoutOpenTrades.i"
        :x="gridLayoutOpenTrades.x"
        :y="gridLayoutOpenTrades.y"
        :w="gridLayoutOpenTrades.w"
        :h="gridLayoutOpenTrades.h"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer>
          <template #header>
            <div class="flex items-center gap-1">
              <i-mdi-swap-horizontal />
              <span>{{ t('trading.openTrades') }}</span>
            </div>
          </template>
          <TradeList
            class="open-trades"
            :trades="botStore.activeBot.openTrades"
            :title="t('trading.openTradesTitle')"
            :active-trades="true"
            :empty-text="t('tradeList.currentlyNoOpen')"
          />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-if="gridLayoutTradeHistory.h != 0"
        v-bind="gridItemProps"
        :i="gridLayoutTradeHistory.i"
        :x="gridLayoutTradeHistory.x"
        :y="gridLayoutTradeHistory.y"
        :w="gridLayoutTradeHistory.w"
        :h="gridLayoutTradeHistory.h"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer>
          <template #header>
            <div class="flex items-center gap-1">
              <i-mdi-history />
              <span>{{ t('trading.closedTrades') }}</span>
            </div>
          </template>
          <TradeList
            class="trade-history"
            :trades="botStore.activeBot.closedTrades"
            :title="t('trading.tradeHistory')"
            :show-filter="true"
            :empty-text="t('tradeList.noClosedTrades')"
          />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-if="
          botStore.activeBot.detailTradeId &&
          botStore.activeBot.tradeDetail &&
          gridLayoutTradeDetail.h != 0
        "
        v-bind="gridItemProps"
        :i="gridLayoutTradeDetail.i"
        :x="gridLayoutTradeDetail.x"
        :y="gridLayoutTradeDetail.y"
        :w="gridLayoutTradeDetail.w"
        :h="gridLayoutTradeDetail.h"
        :min-h="4"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer>
          <template #header>
            <div class="flex items-center gap-1">
              <i-mdi-file-document />
              <span>{{ t('trading.tradeDetail') }}</span>
            </div>
          </template>
          <TradeDetail
            :trade="botStore.activeBot.tradeDetail"
            :stake-currency="botStore.activeBot.stakeCurrency"
          />
        </DraggableContainer>
      </GridItem>
      <GridItem
        v-if="gridLayoutTradeDetail.h != 0"
        v-bind="gridItemProps"
        :i="gridLayoutChartView.i"
        :x="gridLayoutChartView.x"
        :y="gridLayoutChartView.y"
        :w="gridLayoutChartView.w"
        :h="gridLayoutChartView.h"
        :min-h="6"
        drag-allow-from=".drag-header"
      >
        <DraggableContainer>
          <template #header>
            <div class="flex items-center gap-1">
              <i-mdi-chart-line />
              <span>{{ t('trading.chart') }}</span>
            </div>
          </template>
          <CandleChartContainer
            :available-pairs="botStore.activeBot.whitelist"
            :historic-view="!!false"
            :timeframe="botStore.activeBot.timeframe"
            :trades="botStore.activeBot.allTrades"
            @refresh-data="refreshOHLCV"
          >
          </CandleChartContainer>
        </DraggableContainer>
      </GridItem>
    </template>
  </GridLayout>
</template>
