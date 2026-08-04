import axios from 'axios';
import { TimeSummaryCols, TimeSummaryOptions } from '@/types';
import type { ThemeName, UiVersion } from '@/types';
import { FtWsMessageTypes } from '@/types/wsMessageTypes';

const FORK_REPO = 'titouannwtt/frequi-ultimate';
const UPDATE_CHECK_KEY = 'ftForkUpdateCheck';
const UPDATE_CHECK_TTL = 3600_000; // 1 hour

export enum OpenTradeVizOptions {
  showPill = 'showPill',
  asTitle = 'asTitle',
  noOpenTrades = 'noOpenTrades',
}

const notificationDefaults = {
  [FtWsMessageTypes.entryFill]: true,
  [FtWsMessageTypes.exitFill]: true,
  [FtWsMessageTypes.entryCancel]: true,
  [FtWsMessageTypes.exitCancel]: true,
};

export const useSettingsStore = defineStore('uiSettings', {
  // other options...
  state: () => {
    return {
      openTradesInTitle: OpenTradeVizOptions.showPill as string,
      timezone: 'UTC',
      backgroundSync: true,
      currentTheme: 'dark' as ThemeName,
      _uiVersion: 'dev',
      useHeikinAshiCandles: false,
      showMarkArea: true,
      useReducedPairCalls: true,
      notifications: notificationDefaults,
      profitDistributionBins: 20,
      confirmDialog: true,
      chartLabelSide: 'right' as 'left' | 'right',
      chartDefaultCandleCount: 250,
      timeProfitPeriod: TimeSummaryOptions.daily,
      timeProfitPreference: TimeSummaryCols.abs_profit,
      multiPaneButtonsShowText: false,
      multiPairSelection: false,
      hideSimultaneousEntryExit: false,
      backtestAdditionalMetrics: ['profit_factor', 'expectancy'] as string[],
      _latestForkVersion: null as string | null,
      chartLegendVisible: true,
      chartLegendPosition: 'top-left' as 'top-left' | 'top-right' | 'bottom-left',
      chartLegendRealtimeValues: true,
      chartVolumeVisible: true,
      chartShowLiquidation: true,
      chartShowInitialStoploss: false,
      chartShowLeverage: true,
      chartKeyboardShortcuts: true,
      chartAnimations: true,
      chartCrosshairStyle: 'cross' as 'cross' | 'vertical' | 'horizontal' | 'none',
    };
  },
  getters: {
    isDarkTheme(state) {
      return ['dark', 'bootstrap_dark'].includes(state.currentTheme);
    },
    chartTheme(): 'dark' | 'light' {
      return this.isDarkTheme ? 'dark' : 'light';
    },
    uiVersion(state) {
      return `${state._uiVersion}-${__COMMIT_HASH__}`;
    },
    forkVersion(): string {
      return __FORK_VERSION__;
    },
    commitHash(): string {
      return __COMMIT_HASH__.trim();
    },
    latestForkVersion(state): string | null {
      return state._latestForkVersion;
    },
    forkUpdateAvailable(state): boolean {
      if (!state._latestForkVersion) return false;
      const parse = (v: string) => v.split('.').map(Number);
      const [aMaj, aMin, aPat] = parse(state._latestForkVersion);
      const [bMaj, bMin, bPat] = parse(__FORK_VERSION__);
      return aMaj > bMaj || (aMaj === bMaj && (aMin > bMin || (aMin === bMin && aPat > bPat)));
    },
  },
  actions: {
    async loadUIVersion() {
      if (import.meta.env.PROD) {
        try {
          const result = await axios.get<UiVersion>('/ui_version', {
            withCredentials: true,
          });
          const { version } = result.data;
          this._uiVersion = version ?? 'dev';
        } catch (error) {
          //
        }
      }
    },
    async checkForkUpdate() {
      try {
        const cached = localStorage.getItem(UPDATE_CHECK_KEY);
        if (cached) {
          const { version, ts } = JSON.parse(cached);
          if (Date.now() - ts < UPDATE_CHECK_TTL) {
            this._latestForkVersion = version;
            return;
          }
        }
      } catch {
        // ignore corrupt cache
      }
      try {
        const { data } = await axios.get(
          `https://api.github.com/repos/${FORK_REPO}/releases/latest`,
          { timeout: 5000 },
        );
        const tag: string = data.tag_name ?? '';
        const version = tag.startsWith('v') ? tag.slice(1) : tag;
        this._latestForkVersion = version;
        localStorage.setItem(UPDATE_CHECK_KEY, JSON.stringify({ version, ts: Date.now() }));
      } catch {
        // network error or no releases — silent
      }
    },
  },
  persist: {
    key: 'ftUISettings',
    omit: ['_latestForkVersion'],
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSettingsStore, import.meta.hot));
}
