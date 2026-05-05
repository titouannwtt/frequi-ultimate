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
  { i: DashboardLayout.botComparison, x: 0, y: 0, w: 32, h: 24 },
  { i: DashboardLayout.dailyChart, x: 32, y: 0, w: 16, h: 24 },
  { i: DashboardLayout.allOpenTrades, x: 0, y: 24, w: 32, h: 24 },
  { i: DashboardLayout.cumChartChart, x: 32, y: 24, w: 16, h: 24 },
  { i: DashboardLayout.allClosedTrades, x: 0, y: 48, w: 32, h: 24 },
  { i: DashboardLayout.profitDistributionChart, x: 32, y: 48, w: 16, h: 24 },
  { i: DashboardLayout.tradesLogChart, x: 0, y: 400, w: 0, h: 0 },
  { i: DashboardLayout.activityTimeline, x: 32, y: 72, w: 16, h: 20 },
  { i: DashboardLayout.marketPulse, x: 0, y: 92, w: 16, h: 20 },
  { i: DashboardLayout.performanceHeatmap, x: 0, y: 400, w: 0, h: 0 },
  { i: DashboardLayout.riskOverview, x: 32, y: 92, w: 16, h: 20 },
  { i: DashboardLayout.stressTest, x: 0, y: 112, w: 16, h: 24 },
  { i: DashboardLayout.logConsole, x: 16, y: 112, w: 16, h: 24 },
  { i: DashboardLayout.rateBudget, x: 0, y: 136, w: 16, h: 28 },
  { i: DashboardLayout.ratePulse, x: 16, y: 136, w: 32, h: 28 },
  { i: DashboardLayout.requestFlow, x: 0, y: 400, w: 0, h: 0 },
  { i: DashboardLayout.cacheHealth, x: 0, y: 400, w: 0, h: 0 },
  { i: DashboardLayout.fleetOverview, x: 0, y: 164, w: 48, h: 28 },
  { i: DashboardLayout.walletHistoryChart, x: 0, y: 192, w: 16, h: 24 },
  { i: DashboardLayout.volumeComparator, x: 16, y: 192, w: 32, h: 28 },
  { i: DashboardLayout.periodBreakdown, x: 0, y: 220, w: 24, h: 24 },
];

const DEFAULT_DASHBOARD_LAYOUT_SM: GridItemData[] = [
  { i: DashboardLayout.botComparison, x: 0, y: 0, w: 48, h: 24 },
  { i: DashboardLayout.allOpenTrades, x: 0, y: 24, w: 48, h: 32 },
  { i: DashboardLayout.dailyChart, x: 0, y: 56, w: 48, h: 24 },
  { i: DashboardLayout.cumChartChart, x: 0, y: 80, w: 48, h: 24 },
  { i: DashboardLayout.profitDistributionChart, x: 0, y: 104, w: 48, h: 24 },
  { i: DashboardLayout.tradesLogChart, x: 0, y: 128, w: 48, h: 20 },
  { i: DashboardLayout.allClosedTrades, x: 0, y: 148, w: 48, h: 32 },
  { i: DashboardLayout.activityTimeline, x: 0, y: 180, w: 48, h: 16 },
  { i: DashboardLayout.marketPulse, x: 0, y: 196, w: 48, h: 20 },
  { i: DashboardLayout.performanceHeatmap, x: 0, y: 216, w: 48, h: 20 },
  { i: DashboardLayout.riskOverview, x: 0, y: 236, w: 48, h: 20 },
  { i: DashboardLayout.stressTest, x: 0, y: 256, w: 48, h: 24 },
  { i: DashboardLayout.logConsole, x: 0, y: 280, w: 48, h: 24 },
  { i: DashboardLayout.rateBudget, x: 0, y: 304, w: 48, h: 28 },
  { i: DashboardLayout.ratePulse, x: 0, y: 332, w: 48, h: 28 },
  { i: DashboardLayout.requestFlow, x: 0, y: 800, w: 0, h: 0 },
  { i: DashboardLayout.cacheHealth, x: 0, y: 800, w: 0, h: 0 },
  { i: DashboardLayout.fleetOverview, x: 0, y: 360, w: 48, h: 28 },
  { i: DashboardLayout.walletHistoryChart, x: 0, y: 388, w: 48, h: 24 },
  { i: DashboardLayout.volumeComparator, x: 0, y: 412, w: 48, h: 28 },
  { i: DashboardLayout.periodBreakdown, x: 0, y: 440, w: 48, h: 24 },
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
      tradingLayout: JSON.parse(JSON.stringify(DEFAULT_TRADING_LAYOUT)),
      layoutLocked: true,
      editMode: false,
      hiddenWidgets: [] as number[],
      widgetOpacity: 1,
    };
  },
  getters: {
    getDashboardLayoutSm: () => [...DEFAULT_DASHBOARD_LAYOUT_SM],
    getTradingLayoutSm: () => [...DEFAULT_TRADING_LAYOUT_SM],
  },
  actions: {
    resetTradingLayout() {
      this.tradingLayout = JSON.parse(JSON.stringify(DEFAULT_TRADING_LAYOUT));
    },
    resetDashboardLayout() {
      this.dashboardLayout = JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_LAYOUT));
    },
    toggleEditMode() {
      this.editMode = !this.editMode;
      if (this.editMode) {
        this.layoutLocked = false;
      }
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
      const needsReset =
        context.store.dashboardLayout === null ||
        typeof context.store.dashboardLayout === 'string' ||
        !Array.isArray(context.store.dashboardLayout) ||
        context.store.dashboardLayout.length === 0 ||
        typeof context.store.dashboardLayout[0]['i'] === 'string' ||
        [...expectedIds].some((id) => !storedIds.has(id));

      if (needsReset) {
        console.log('loading dashboard Layout from default.');
        context.store.dashboardLayout = JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_LAYOUT));
      } else {
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
    },
  },
});
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useLayoutStore, import.meta.hot));
}
