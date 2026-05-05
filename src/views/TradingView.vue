<script setup lang="ts">
import type { GridItemData } from '@/types';
import { useI18n } from 'vue-i18n';
import OpenTradesEnhanced from '@/components/ftbot/OpenTradesEnhanced.vue';
import ClosedTradesEnhanced from '@/components/ftbot/ClosedTradesEnhanced.vue';

const { t } = useI18n();
const botStore = useBotStore();
const layoutStore = useLayoutStore();
const currentBreakpoint = ref('');

const openTradesRef = ref<InstanceType<typeof OpenTradesEnhanced>>();
const closedTradesRef = ref<InstanceType<typeof ClosedTradesEnhanced>>();

const breakpointChanged = (newBreakpoint: string) => {
  currentBreakpoint.value = newBreakpoint;
};
const isResizableLayout = computed(() =>
  ['', 'sm', 'md', 'lg', 'xl'].includes(currentBreakpoint.value),
);
const isLayoutLocked = computed(() => layoutStore.layoutLocked || !isResizableLayout.value);

const gridLayoutData = computed((): GridItemData[] => {
  if (isResizableLayout.value) return layoutStore.tradingLayout;
  return [...layoutStore.getTradingLayoutSm];
});

const gridLayoutMultiPane = computed(() => findGridLayout(gridLayoutData.value, TradeLayout.multiPane));
const gridLayoutOpenTrades = computed(() => findGridLayout(gridLayoutData.value, TradeLayout.openTrades));
const gridLayoutTradeHistory = computed(() => findGridLayout(gridLayoutData.value, TradeLayout.tradeHistory));
const gridLayoutTradeDetail = computed(() => findGridLayout(gridLayoutData.value, TradeLayout.tradeDetail));
const gridLayoutChartView = computed(() => findGridLayout(gridLayoutData.value, TradeLayout.chartView));

const responsiveGridLayouts = computed(() => ({ sm: layoutStore.getTradingLayoutSm }));

// Bot selector
const botOptions = computed(() =>
  botStore.availableBotsSorted.map((bot) => ({ label: bot.botName, value: bot.botId })),
);
const selectedBotId = computed({
  get: () => botStore.selectedBot,
  set: (val: string) => botStore.selectBot(val),
});

// Multi-pane tabs
const activeTab = ref('status');

const paneTabs = computed(() => [
  { id: 'status', labelKey: 'trading.status' },
  { id: 'pairs', labelKey: 'trading.pairsCombined' },
  { id: 'performance', labelKey: 'trading.performance' },
  { id: 'balance', labelKey: 'trading.balance' },
  { id: 'periods', labelKey: 'trading.timeBreakdown' },
  { id: 'pairlist', labelKey: 'trading.pairlist' },
  { id: 'locks', labelKey: 'trading.pairLocks' },
  { id: 'cache', labelKey: 'trading.cache' },
]);

// Bot state
const botState = computed(() => botStore.activeBot.botState);
const isRunning = computed(() => botState.value?.state === 'running');
const botStateColor = computed(() => {
  if (!botState.value) return 'bg-surface-400';
  return isRunning.value ? 'bg-emerald-500' : 'bg-amber-500';
});

function refreshOHLCV(pair: string, columns: string[]) {
  botStore.activeBot.getPairCandles({
    pair, timeframe: botStore.activeBot.timeframe, columns,
  });
}
</script>

<template>
  <div class="trading-bg">
    <GridLayout
      class="h-full w-full"
      :row-height="50"
      :layout="gridLayoutData"
      :vertical-compact="false"
      :margin="[8, 8]"
      :responsive-layouts="responsiveGridLayouts"
      :is-resizable="!isLayoutLocked"
      :is-draggable="!isLayoutLocked"
      :responsive="true"
      :cols="{ lg: 12, md: 12, sm: 12, xs: 4, xxs: 2 }"
      :col-num="12"
      @update:breakpoint="breakpointChanged"
    >
      <template #default="{ gridItemProps }">
        <!-- ═══ Multi-panneaux ═══ -->
        <GridItem
          v-if="gridLayoutMultiPane.h !== 0"
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
              <div class="flex justify-between items-center w-full">
                <div class="flex items-center gap-2.5">
                  <i-mdi-view-grid class="w-4 h-4" />
                  <span class="font-medium">{{ t('trading.multiPane') }}</span>
                  <span class="flex items-center gap-1.5 text-surface-500 dark:text-surface-400" style="font-size: 0.8125rem">
                    <span class="w-2 h-2 rounded-full inline-block" :class="botStateColor" />
                    {{ botState?.state ?? 'offline' }}
                  </span>
                </div>
                <Select
                  v-model="selectedBotId"
                  :options="botOptions"
                  option-label="label"
                  option-value="value"
                  class="mp-bot-select"
                  size="small"
                />
              </div>
            </template>

            <div class="mp-body">
              <!-- Controls -->
              <div class="mp-controls">
                <BotControls />
              </div>

              <!-- Tab bar -->
              <div class="mp-tabs" role="tablist">
                <button
                  v-for="tab in paneTabs"
                  :key="tab.id"
                  role="tab"
                  class="mp-tab"
                  :class="{ active: activeTab === tab.id }"
                  @click="activeTab = tab.id"
                >
                  <i-mdi-information-outline v-if="tab.id === 'status'" class="mp-tab-icon" />
                  <i-mdi-currency-btc v-else-if="tab.id === 'pairs'" class="mp-tab-icon" />
                  <i-mdi-chart-bar v-else-if="tab.id === 'performance'" class="mp-tab-icon" />
                  <i-mdi-wallet-outline v-else-if="tab.id === 'balance'" class="mp-tab-icon" />
                  <i-mdi-calendar-clock v-else-if="tab.id === 'periods'" class="mp-tab-icon" />
                  <i-mdi-format-list-bulleted v-else-if="tab.id === 'pairlist'" class="mp-tab-icon" />
                  <i-mdi-lock-outline v-else-if="tab.id === 'locks'" class="mp-tab-icon" />
                  <i-mdi-database-sync-outline v-else-if="tab.id === 'cache'" class="mp-tab-icon" />
                  <span>{{ t(tab.labelKey) }}</span>
                </button>
              </div>

              <!-- Content -->
              <div class="mp-content">
                <KeepAlive>
                  <div v-if="activeTab === 'status'" key="status" class="mp-panel">
                    <BotStatus />
                  </div>
                </KeepAlive>
                <KeepAlive>
                  <div v-if="activeTab === 'pairs'" key="pairs" class="mp-panel">
                    <PairSummary
                      :pairlist="botStore.activeBot.whitelist"
                      :current-locks="botStore.activeBot.activeLocks"
                      :trades="botStore.activeBot.openTrades"
                    />
                  </div>
                </KeepAlive>
                <KeepAlive>
                  <div v-if="activeTab === 'performance'" key="performance" class="mp-panel">
                    <BotPerformance />
                  </div>
                </KeepAlive>
                <KeepAlive>
                  <div v-if="activeTab === 'balance'" key="balance" class="mp-panel">
                    <BotBalance />
                  </div>
                </KeepAlive>
                <KeepAlive>
                  <div v-if="activeTab === 'periods'" key="periods" class="mp-panel">
                    <PeriodBreakdown />
                  </div>
                </KeepAlive>
                <KeepAlive>
                  <div v-if="activeTab === 'pairlist'" key="pairlist" class="mp-panel">
                    <PairListLive />
                  </div>
                </KeepAlive>
                <KeepAlive>
                  <div v-if="activeTab === 'locks'" key="locks" class="mp-panel">
                    <PairLockList />
                  </div>
                </KeepAlive>
                <KeepAlive>
                  <div v-if="activeTab === 'cache'" key="cache" class="mp-panel">
                    <CacheStatusWidget />
                  </div>
                </KeepAlive>
              </div>
            </div>
          </DraggableContainer>
        </GridItem>

        <!-- ═══ Open Trades ═══ -->
        <GridItem
          v-if="gridLayoutOpenTrades.h !== 0"
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
              <div class="flex justify-between items-center w-full">
                <div class="flex items-center gap-1.5">
                  <i-mdi-swap-horizontal />
                  <span>{{ t('trading.openTrades') }}</span>
                </div>
                <button
                  class="p-1 rounded hover:bg-surface-300 dark:hover:bg-surface-600 cursor-pointer"
                  @click="openTradesRef?.showColumnPopover($event)"
                >
                  <i-mdi-cog class="w-4 h-4 inline" />
                </button>
              </div>
            </template>
            <OpenTradesEnhanced ref="openTradesRef" :trades="botStore.activeBot.openTrades" />
          </DraggableContainer>
        </GridItem>

        <!-- ═══ Closed Trades ═══ -->
        <GridItem
          v-if="gridLayoutTradeHistory.h !== 0"
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
              <div class="flex justify-between items-center w-full">
                <div class="flex items-center gap-1.5">
                  <i-mdi-history />
                  <span>{{ t('trading.closedTrades') }}</span>
                </div>
                <button
                  class="p-1 rounded hover:bg-surface-300 dark:hover:bg-surface-600 cursor-pointer"
                  @click="closedTradesRef?.showColumnPopover($event)"
                >
                  <i-mdi-cog class="w-4 h-4 inline" />
                </button>
              </div>
            </template>
            <ClosedTradesEnhanced ref="closedTradesRef" :trades="botStore.activeBot.closedTrades" />
          </DraggableContainer>
        </GridItem>

        <!-- ═══ Trade Detail ═══ -->
        <GridItem
          v-if="botStore.activeBot.detailTradeId && botStore.activeBot.tradeDetail && gridLayoutTradeDetail.h !== 0"
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
              <div class="flex items-center gap-1.5">
                <i-mdi-file-document />
                <span>{{ t('trading.tradeDetail') }}</span>
              </div>
            </template>
            <TradeDetail :trade="botStore.activeBot.tradeDetail" :stake-currency="botStore.activeBot.stakeCurrency" />
          </DraggableContainer>
        </GridItem>

        <!-- ═══ Chart ═══ -->
        <GridItem
          v-if="gridLayoutTradeDetail.h !== 0"
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
              <div class="flex items-center gap-1.5">
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
            />
          </DraggableContainer>
        </GridItem>
      </template>
    </GridLayout>
  </div>
</template>

<style scoped>
/* ════════════════════════════════════════════════════
   Page background — mirrors dashboard
   ════════════════════════════════════════════════════ */
.trading-bg {
  min-height: 100vh;
  position: relative;
  background: #f0ece6;
}
.ft-dark-theme .trading-bg {
  background: #06060c;
}
.ft-dark-theme .trading-bg::before {
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
  z-index: 0;
}
.ft-dark-theme .trading-bg::after {
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
.trading-bg::before {
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
.trading-bg > :deep(.vue-grid-layout) {
  position: relative;
  z-index: 1;
}

/* ════════════════════════════════════════════════════
   Bot selector
   ════════════════════════════════════════════════════ */
.mp-bot-select {
  min-width: 150px;
}
.mp-bot-select :deep(.p-select) {
  font-size: 0.8125rem;
  height: 1.75rem;
  border-radius: 0.5rem;
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.08);
}
.ft-dark-theme .mp-bot-select :deep(.p-select) {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.08);
}

/* ════════════════════════════════════════════════════
   Multi-panneaux body structure
   ════════════════════════════════════════════════════ */
.mp-body {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ── Controls ── */
.mp-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.625rem 0.75rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.ft-dark-theme .mp-controls {
  border-bottom-color: rgba(255, 255, 255, 0.06);
}

/* ── Tabs ── */
.mp-tabs {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  padding: 0.375rem 0.625rem;
  overflow-x: auto;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  scrollbar-width: none;
}
.mp-tabs::-webkit-scrollbar { display: none; }
.ft-dark-theme .mp-tabs {
  border-bottom-color: rgba(255, 255, 255, 0.06);
}

.mp-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.625rem;
  border-radius: 0.375rem;
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.15s ease;
  background: transparent;
  border: 1px solid transparent;
  color: #7d7568;
}
.ft-dark-theme .mp-tab {
  color: rgba(255, 255, 255, 0.45);
}
.mp-tab:hover {
  background: rgba(0, 0, 0, 0.04);
  color: #4a4540;
}
.ft-dark-theme .mp-tab:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.75);
}
.mp-tab.active {
  background: rgba(99, 102, 241, 0.08);
  color: rgb(79, 70, 229);
  border-color: rgba(99, 102, 241, 0.18);
}
.ft-dark-theme .mp-tab.active {
  background: rgba(99, 102, 241, 0.12);
  color: rgb(165, 180, 252);
  border-color: rgba(129, 140, 248, 0.22);
}
.mp-tab-icon {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
}

/* ── Content area ── */
.mp-content {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

/* ── Glass panel ── */
.mp-panel {
  padding: 0.875rem;
  min-height: 100%;
}

/* ════════════════════════════════════════════════════
   Deep overrides for child components inside mp-panel
   Unified modern table + typography styling
   ════════════════════════════════════════════════════ */

/* ── Base typography ── */
.mp-panel :deep(p),
.mp-panel :deep(span),
.mp-panel :deep(label),
.mp-panel :deep(li),
.mp-panel :deep(strong) {
  font-size: 0.875rem;
  line-height: 1.65;
}
.mp-panel :deep(h3) {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

/* ── DataTable — header ── */
.mp-panel :deep(.p-datatable) {
  border-radius: 0.5rem;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.05);
}
.ft-dark-theme .mp-panel :deep(.p-datatable) {
  border-color: rgba(255, 255, 255, 0.05);
}

.mp-panel :deep(.p-datatable-thead > tr > th) {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.625rem 0.75rem;
  color: #7d7568;
  background: rgba(0, 0, 0, 0.02);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  white-space: nowrap;
}
.ft-dark-theme .mp-panel :deep(.p-datatable-thead > tr > th) {
  color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.02);
  border-bottom-color: rgba(255, 255, 255, 0.06);
}

/* ── DataTable — body cells ── */
.mp-panel :deep(.p-datatable-tbody > tr > td) {
  padding: 0.5rem 0.75rem;
  font-size: 0.8125rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.03);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ft-dark-theme .mp-panel :deep(.p-datatable-tbody > tr > td) {
  border-bottom-color: rgba(255, 255, 255, 0.03);
}

/* ── DataTable — row hover ── */
.mp-panel :deep(.p-datatable-tbody > tr:hover > td) {
  background: rgba(99, 102, 241, 0.04);
}
.ft-dark-theme .mp-panel :deep(.p-datatable-tbody > tr:hover > td) {
  background: rgba(99, 102, 241, 0.06);
}

/* ── DataTable — row stripes ── */
.mp-panel :deep(.p-datatable-tbody > tr:nth-child(even) > td) {
  background: rgba(0, 0, 0, 0.012);
}
.ft-dark-theme .mp-panel :deep(.p-datatable-tbody > tr:nth-child(even) > td) {
  background: rgba(255, 255, 255, 0.015);
}

/* ── DataTable — footer ── */
.mp-panel :deep(.p-datatable-tfoot > tr > td),
.mp-panel :deep(.p-columngroup-footer > tr > td) {
  padding: 0.625rem 0.75rem;
  font-size: 0.8125rem;
  font-weight: 600;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(0, 0, 0, 0.02);
}
.ft-dark-theme .mp-panel :deep(.p-datatable-tfoot > tr > td),
.ft-dark-theme .mp-panel :deep(.p-columngroup-footer > tr > td) {
  border-top-color: rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
}

/* ── DataTable — no min-width clipping, allow all columns ── */
.mp-panel :deep(.p-datatable table) {
  table-layout: auto;
  width: 100%;
}

/* ── SelectButton ── */
.mp-panel :deep(.p-selectbutton) {
  border-radius: 0.5rem;
  overflow: hidden;
  margin-bottom: 0.75rem;
}
.mp-panel :deep(.p-selectbutton .p-togglebutton) {
  font-size: 0.8125rem;
  padding: 0.375rem 0.75rem;
  font-weight: 500;
}

/* ── Button (action buttons like refresh) ── */
.mp-panel :deep(.p-button.p-button-secondary) {
  border-radius: 0.375rem;
}

/* ── Divider ── */
.mp-panel :deep(.p-divider) {
  margin: 0.75rem 0;
}

/* ── ECharts (pie, bar, etc.) ── */
.mp-panel :deep(.echarts) {
  border-radius: 0.5rem;
  overflow: hidden;
}

/* ── Panel (collapsible, e.g. Strategy Params) ── */
.mp-panel :deep(.p-panel) {
  border-radius: 0.5rem;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.06);
}
.ft-dark-theme .mp-panel :deep(.p-panel) {
  border-color: rgba(255, 255, 255, 0.06);
}
.mp-panel :deep(.p-panel-header) {
  font-size: 0.875rem;
  font-weight: 600;
  padding: 0.625rem 0.75rem;
}

/* ── InputText (filter fields) ── */
.mp-panel :deep(.p-inputtext) {
  font-size: 0.8125rem;
  border-radius: 0.375rem;
}

/* ── PairSummary list items ── */
.mp-panel :deep(ul) {
  margin: 0;
  padding: 0;
}
.mp-panel :deep(ul li) {
  padding: 0.375rem 0.625rem;
  font-size: 0.8125rem;
  transition: background 0.1s ease;
}
.mp-panel :deep(ul li:hover) {
  background: rgba(99, 102, 241, 0.04);
}
.ft-dark-theme .mp-panel :deep(ul li:hover) {
  background: rgba(99, 102, 241, 0.06);
}

/* ── CacheStatusWidget grid ── */
.mp-panel :deep(.cache-status-widget) {
  font-size: 0.8125rem;
}
.mp-panel :deep(.cache-status-widget .grid) {
  gap: 0.25rem 0.75rem;
  font-size: 0.8125rem;
}

/* ── PairListLive pair chips ── */
.mp-panel :deep(.pair) {
  font-size: 0.8125rem;
  padding: 0.375rem 0.5rem;
  border-radius: 0.375rem;
}
</style>
