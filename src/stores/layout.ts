import type { GridItemData } from '@/types';

export enum TradeLayout {
  multiPane = 0,
  openTrades = 1,
  tradeHistory = 2,
  tradeDetail = 3,
  chartView = 4,
}

export enum DashboardLayout {
  dailyChart = 0,
  botComparison = 1,
  allOpenTrades = 2,
  cumChartChart = 3,
  allClosedTrades = 4,
  profitDistributionChart = 5,
  tradesLogChart = 6,
  activityTimeline = 7,
  marketPulse = 8,
  performanceHeatmap = 9,
  riskOverview = 10,
  stressTest = 11,
  logConsole = 12,
  rateBudget = 13,
  ratePulse = 14,
  requestFlow = 15,
  cacheHealth = 16,
  fleetOverview = 17,
  walletHistoryChart = 18,
  volumeComparator = 19,
  periodBreakdown = 20,
  botProfitComparison = 21,
  fleetReconciliation = 22,
  fleetExposure = 23,
  fleetPnl = 24,
  fleetBots = 25,
}

// Define default layouts
const DEFAULT_TRADING_LAYOUT: GridItemData[] = [
  { i: TradeLayout.multiPane, x: 0, y: 0, w: 3, h: 35 },
  { i: TradeLayout.chartView, x: 3, y: 0, w: 9, h: 14 },
  { i: TradeLayout.tradeDetail, x: 3, y: 19, w: 9, h: 6 },
  { i: TradeLayout.openTrades, x: 3, y: 14, w: 9, h: 5 },
  { i: TradeLayout.tradeHistory, x: 3, y: 25, w: 9, h: 10 },
];

// Currently only multiPane is visible
const DEFAULT_TRADING_LAYOUT_SM: GridItemData[] = [
  { i: TradeLayout.multiPane, x: 0, y: 0, w: 12, h: 10 },
  { i: TradeLayout.chartView, x: 0, y: 10, w: 12, h: 0 },
  { i: TradeLayout.tradeDetail, x: 0, y: 19, w: 12, h: 0 },
  { i: TradeLayout.openTrades, x: 0, y: 8, w: 12, h: 0 },
  { i: TradeLayout.tradeHistory, x: 0, y: 25, w: 12, h: 0 },
];

const DEFAULT_DASHBOARD_LAYOUT: GridItemData[] = [
  { i: DashboardLayout.logConsole, x: 0, y: 0, w: 32, h: 24 },
  { i: DashboardLayout.dailyChart, x: 32, y: 0, w: 16, h: 27 },
  { i: DashboardLayout.botComparison, x: 0, y: 24, w: 32, h: 47 },
  { i: DashboardLayout.allOpenTrades, x: 0, y: 71, w: 32, h: 35 },
  { i: DashboardLayout.periodBreakdown, x: 32, y: 27, w: 16, h: 24 },
  { i: DashboardLayout.activityTimeline, x: 32, y: 51, w: 16, h: 33 },
  { i: DashboardLayout.allClosedTrades, x: 0, y: 106, w: 32, h: 31 },
  { i: DashboardLayout.stressTest, x: 27, y: 257, w: 12, h: 31 },
  { i: DashboardLayout.botProfitComparison, x: 0, y: 137, w: 32, h: 27 },
  { i: DashboardLayout.marketPulse, x: 32, y: 137, w: 16, h: 27 },
  { i: DashboardLayout.ratePulse, x: 0, y: 164, w: 32, h: 27 },
  { i: DashboardLayout.profitDistributionChart, x: 32, y: 112, w: 16, h: 25 },
  { i: DashboardLayout.rateBudget, x: 32, y: 164, w: 16, h: 27 },
  { i: DashboardLayout.riskOverview, x: 32, y: 191, w: 16, h: 38 },
  { i: DashboardLayout.fleetOverview, x: 0, y: 191, w: 32, h: 38 },
  { i: DashboardLayout.volumeComparator, x: 32, y: 84, w: 16, h: 28 },
  { i: DashboardLayout.fleetReconciliation, x: 0, y: 312, w: 32, h: 26 },
  { i: DashboardLayout.fleetExposure, x: 32, y: 312, w: 16, h: 26 },
  { i: DashboardLayout.fleetPnl, x: 32, y: 338, w: 16, h: 30 },
  { i: DashboardLayout.fleetBots, x: 0, y: 338, w: 32, h: 30 },
];

// Widget ids with no rendered GridItem — stripped from stored layouts on hydration.
const PHANTOM_WIDGETS = new Set<number>([
  DashboardLayout.cumChartChart,
  DashboardLayout.tradesLogChart,
  DashboardLayout.performanceHeatmap,
  DashboardLayout.requestFlow,
  DashboardLayout.cacheHealth,
  DashboardLayout.walletHistoryChart,
]);

const DEFAULT_WIDGET_DEFAULTS: Record<number, Record<string, unknown>> = {
  [DashboardLayout.dailyChart]: {
    activeTab: 'combined',
    selectedTimeframe: '90D',
    enabledBenchmarks: [],
    tradingMode: 'live',
  },
  [DashboardLayout.profitDistributionChart]: {
    activeTab: 'histogram',
    activeFilter: 'all',
    histBinCount: 85,
    tradingMode: 'all',
  },
  [DashboardLayout.activityTimeline]: {
    compactMode: true,
    tradingModeFilter: 'live',
    enabledEventTypes: [
      'trade_opened', 'trade_closed_profit', 'trade_closed_loss',
      'bot_status', 'alert', 'dca',
    ],
  },
  [DashboardLayout.logConsole]: {
    displayMode: 'timeline',
    activeTimeWindow: 24,
    compactMode: false,
    hideHeartbeat: true,
    hideWebSocket: false,
    hideWalletSync: true,
    hideBtAnalysis: true,
    levels: ['CRITICAL', 'ERROR', 'WARNING'],
    tradingMode: 'live',
  },
  [DashboardLayout.volumeComparator]: {
    selectedDays: 180,
    selectedBucket: '1M',
    showTradeCount: true,
    showProfit: false,
    showAnomalies: false,
    showVolumeRatio: false,
    tradingMode: 'all',
  },
  [DashboardLayout.periodBreakdown]: {
    timeProfitPeriod: 'weekly',
    timeProfitPreference: 'abs_profit',
    tradingMode: 'all',
  },
  [DashboardLayout.botProfitComparison]: {
    selectedPeriod: '7d',
    valueMode: 'abs',
    sortMode: 'profit',
    tradingMode: 'all',
  },
};

const DEFAULT_DASHBOARD_LAYOUT_SM: GridItemData[] = [
  { i: DashboardLayout.botComparison, x: 0, y: 0, w: 48, h: 24 },
  { i: DashboardLayout.allOpenTrades, x: 0, y: 24, w: 48, h: 32 },
  { i: DashboardLayout.dailyChart, x: 0, y: 56, w: 48, h: 24 },
  { i: DashboardLayout.profitDistributionChart, x: 0, y: 104, w: 48, h: 24 },
  { i: DashboardLayout.allClosedTrades, x: 0, y: 148, w: 48, h: 32 },
  { i: DashboardLayout.activityTimeline, x: 0, y: 180, w: 48, h: 16 },
  { i: DashboardLayout.marketPulse, x: 0, y: 196, w: 48, h: 20 },
  { i: DashboardLayout.riskOverview, x: 0, y: 236, w: 48, h: 20 },
  { i: DashboardLayout.stressTest, x: 0, y: 256, w: 48, h: 24 },
  { i: DashboardLayout.logConsole, x: 0, y: 280, w: 48, h: 24 },
  { i: DashboardLayout.rateBudget, x: 0, y: 304, w: 48, h: 28 },
  { i: DashboardLayout.ratePulse, x: 0, y: 332, w: 48, h: 28 },
  { i: DashboardLayout.fleetOverview, x: 0, y: 360, w: 48, h: 28 },
  { i: DashboardLayout.volumeComparator, x: 0, y: 412, w: 48, h: 28 },
  { i: DashboardLayout.periodBreakdown, x: 0, y: 440, w: 48, h: 24 },
  { i: DashboardLayout.botProfitComparison, x: 0, y: 464, w: 48, h: 24 },
  { i: DashboardLayout.fleetReconciliation, x: 0, y: 488, w: 48, h: 26 },
  { i: DashboardLayout.fleetExposure, x: 0, y: 514, w: 48, h: 24 },
  { i: DashboardLayout.fleetPnl, x: 0, y: 538, w: 48, h: 28 },
  { i: DashboardLayout.fleetBots, x: 0, y: 566, w: 48, h: 30 },
];

const STORE_LAYOUTS = 'ftLayoutSettings';

function migrateLayoutSettings() {
  const STORE_DASHBOARD_LAYOUT = 'ftDashboardLayout';
  const STORE_TRADING_LAYOUT = 'ftTradingLayout';
  const STORE_LAYOUT_LOCK = 'ftLayoutLocked';

  // If new does not exist
  if (localStorage.getItem(STORE_DASHBOARD_LAYOUT) !== null) {
    console.log('Migrating dashboard settings');
    const layoutLocked = localStorage.getItem(STORE_LAYOUT_LOCK);
    const tradingLayout = localStorage.getItem(STORE_TRADING_LAYOUT);
    const dashboardLayout = localStorage.getItem(STORE_DASHBOARD_LAYOUT);

    const res = {
      dashboardLayout,
      tradingLayout,
      layoutLocked,
    };
    localStorage.setItem(STORE_LAYOUTS, JSON.stringify(res));
  }
  localStorage.removeItem(STORE_LAYOUT_LOCK);
  localStorage.removeItem(STORE_TRADING_LAYOUT);
  localStorage.removeItem(STORE_DASHBOARD_LAYOUT);
}
migrateLayoutSettings();
/**
 * Helper function finding a layout entry
 * @param gridLayout Array of grid layouts used in this layout. Must be passed to GridLayout, too.
 * @param name Name within the dashboard layout to find
 */
export function findGridLayout(gridLayout: GridItemData[], name: number): GridItemData {
  let layout = gridLayout.find((value) => value.i === name);
  if (!layout) {
    layout = { i: name, x: 0, y: 0, w: 8, h: 12 };
  }
  return layout;
}

const PROTECTED_WIDGETS = new Set([DashboardLayout.botComparison]);

export const useLayoutStore = defineStore('layoutStore', {
  state: () => {
    return {
      dashboardLayout: JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_LAYOUT)),
      dashboardLayoutSm: JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_LAYOUT_SM)),
      tradingLayout: JSON.parse(JSON.stringify(DEFAULT_TRADING_LAYOUT)),
      layoutLocked: true,
      editMode: false,
      hiddenWidgets: [] as number[],
      widgetOpacity: 1,
      widgetDefaults: {} as Record<number, Record<string, unknown>>,
      backgroundAnimation: true,
    };
  },
  getters: {
    getDashboardLayoutSm: (state) => state.dashboardLayoutSm as GridItemData[],
    getTradingLayoutSm: () => [...DEFAULT_TRADING_LAYOUT_SM],
  },
  actions: {
    resetTradingLayout() {
      this.tradingLayout = JSON.parse(JSON.stringify(DEFAULT_TRADING_LAYOUT));
    },
    resetDashboardLayout() {
      this.dashboardLayout = JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_LAYOUT));
      this.dashboardLayoutSm = JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_LAYOUT_SM));
      this.hiddenWidgets = [];
      this.widgetDefaults = JSON.parse(JSON.stringify(DEFAULT_WIDGET_DEFAULTS));
      this.widgetOpacity = 1;
      this.backgroundAnimation = true;
      localStorage.removeItem('enhancedOpenTradeColumns');
      localStorage.removeItem('enhancedClosedTradeColumns');
      localStorage.removeItem('enhancedOpenTradeColumnOrder');
      localStorage.removeItem('enhancedClosedTradeColumnOrder');
    },
    toggleEditMode() {
      this.editMode = !this.editMode;
      this.layoutLocked = !this.editMode;
    },
    toggleWidgetVisibility(id: number) {
      if (PROTECTED_WIDGETS.has(id)) return;
      const idx = this.hiddenWidgets.indexOf(id);
      if (idx >= 0) {
        this.hiddenWidgets.splice(idx, 1);
      } else {
        this.hiddenWidgets.push(id);
      }
    },
    isWidgetVisible(id: number): boolean {
      return !this.hiddenWidgets.includes(id);
    },
    setWidgetOpacity(v: number) {
      this.widgetOpacity = Math.max(0.3, Math.min(1, v));
    },
    getWidgetDefaults(id: number): Record<string, unknown> | undefined {
      return this.widgetDefaults[id] ?? DEFAULT_WIDGET_DEFAULTS[id];
    },
    setWidgetDefaults(id: number, defaults: Record<string, unknown>) {
      this.widgetDefaults[id] = defaults;
    },
    compactLayout(layout: GridItemData[], cols: number): GridItemData[] {
      const visible = layout.filter(
        (item: GridItemData) => item.w > 0 && item.h > 0,
      );
      const hidden = layout.filter(
        (item: GridItemData) => item.w === 0 || item.h === 0,
      );
      visible.sort((a: GridItemData, b: GridItemData) => a.y - b.y || a.x - b.x);

      const placed: GridItemData[] = [];

      function collides(a: GridItemData, b: GridItemData): boolean {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      }

      for (const item of visible) {
        let bestX = 0;
        let bestY = Infinity;

        for (let y = 0; y < 10000; y++) {
          for (let x = 0; x <= cols - item.w; x++) {
            const candidate = { ...item, x, y };
            if (!placed.some((p) => collides(candidate, p))) {
              if (y < bestY || (y === bestY && x < bestX)) {
                bestX = x;
                bestY = y;
              }
              break;
            }
          }
          if (bestY <= y) break;
        }

        item.x = bestX;
        item.y = bestY;
        placed.push(item);
      }

      return [...placed, ...hidden];
    },
    compactDashboardLayout() {
      this.dashboardLayout = this.compactLayout(this.dashboardLayout, 48);
    },
    compactTradingLayout() {
      this.tradingLayout = this.compactLayout(this.tradingLayout, 12);
    },
  },
  persist: {
    key: STORE_LAYOUTS,
    afterHydrate: (context) => {
      const expectedIds = new Set(DEFAULT_DASHBOARD_LAYOUT.map((item) => item.i));
      const storedIds = new Set(
        Array.isArray(context.store.dashboardLayout)
          ? context.store.dashboardLayout.map((item: GridItemData) => item.i)
          : [],
      );
      const isCorrupt =
        context.store.dashboardLayout === null ||
        typeof context.store.dashboardLayout === 'string' ||
        !Array.isArray(context.store.dashboardLayout) ||
        context.store.dashboardLayout.length === 0 ||
        typeof context.store.dashboardLayout[0]['i'] === 'string';

      if (isCorrupt) {
        console.log('loading dashboard Layout from default.');
        context.store.dashboardLayout = JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_LAYOUT));
      } else {
        context.store.dashboardLayout = context.store.dashboardLayout.filter(
          (item: GridItemData) => !PHANTOM_WIDGETS.has(item.i),
        );
        const missingIds = [...expectedIds].filter((id) => !storedIds.has(id));
        if (missingIds.length > 0) {
          const defaults = DEFAULT_DASHBOARD_LAYOUT.filter((item) => missingIds.includes(item.i));
          context.store.dashboardLayout.push(...JSON.parse(JSON.stringify(defaults)));
        }
        // Migrate from old grid to 48-col grid
        const maxRight = Math.max(...context.store.dashboardLayout.map((item: GridItemData) => item.w + item.x));
        if (maxRight > 0 && maxRight <= 12) {
          // Old 12-col layout → ×4
          console.log('Migrating dashboard layout from 12-col to 48-col grid.');
          context.store.dashboardLayout = context.store.dashboardLayout.map((item: GridItemData) => ({
            ...item,
            x: item.x * 4,
            y: item.y * 4,
            w: item.w * 4,
            h: item.h * 4,
          }));
        } else if (maxRight > 12 && maxRight <= 24) {
          // Intermediate 24-col layout → ×2
          console.log('Migrating dashboard layout from 24-col to 48-col grid.');
          context.store.dashboardLayout = context.store.dashboardLayout.map((item: GridItemData) => ({
            ...item,
            x: item.x * 2,
            y: item.y * 2,
            w: item.w * 2,
            h: item.h * 2,
          }));
        }
      }
      const smCorrupt =
        !Array.isArray(context.store.dashboardLayoutSm) ||
        context.store.dashboardLayoutSm.length === 0 ||
        typeof context.store.dashboardLayoutSm[0]['i'] === 'string';
      if (smCorrupt) {
        context.store.dashboardLayoutSm = JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_LAYOUT_SM));
      } else {
        context.store.dashboardLayoutSm = context.store.dashboardLayoutSm.filter(
          (item: GridItemData) => !PHANTOM_WIDGETS.has(item.i),
        );
        const smIds = new Set(
          context.store.dashboardLayoutSm.map((item: GridItemData) => item.i),
        );
        const smMissing = DEFAULT_DASHBOARD_LAYOUT_SM.filter((item) => !smIds.has(item.i));
        if (smMissing.length > 0) {
          context.store.dashboardLayoutSm.push(...JSON.parse(JSON.stringify(smMissing)));
        }
      }
      if (
        context.store.tradingLayout === null ||
        typeof context.store.tradingLayout === 'string' ||
        context.store.tradingLayout.length === 0 ||
        typeof context.store.tradingLayout[0]['i'] === 'string' ||
        context.store.tradingLayout.length < DEFAULT_TRADING_LAYOUT.length
      ) {
        console.log('loading trading Layout from default.');
        context.store.tradingLayout = JSON.parse(JSON.stringify(DEFAULT_TRADING_LAYOUT));
      }
      context.store.editMode = false;
      context.store.layoutLocked = true;
    },
  },
});
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useLayoutStore, import.meta.hot));
}
