import type {
  BalanceInterface,
  BotDescriptor,
  BotDescriptors,
  BotState,
  ClosedTrade,
  TimeSummaryPayload,
  TimeSummaryRecord,
  TimeSummaryReturnValue,
  MultiCancelOpenOrderPayload,
  MultiDeletePayload,
  MultiForceExitPayload,
  MultiReloadTradePayload,
  ProfitStats,
  RateMetricsResponse,
  Trade,
  VolumeHistoryResponse,
  WalletHistoryPerBot,
} from '@/types';
import { TimeSummaryOptions } from '@/types';
import { createBotSubStore } from './ftbot';
import { activeBotIdForTrades, closedTradesDemand, closedTradesWanted } from './closedTradesPolicy';
import { registerSlowRefreshRunner } from './slowRefreshScheduler';
const AUTH_SELECTED_BOT = 'ftSelectedBot';

/**
 * Identity-keyed memo for the fleet-wide trade aggregates.
 *
 * These getters flatten (and, for the closed list, sort) every selected bot's history: on a
 * 45-bot fleet that is an O(T log T) pass over ~180 000 elements. Pinia caches a getter, but
 * the cache is dropped as soon as *any* reactive dep it touched moves, and iterating 45
 * sub-stores touches a lot. The result was a full re-sort on invalidations where the trade
 * arrays themselves were untouched.
 *
 * Keying on the array *identities* is exact rather than heuristic: `getTrades` already
 * preserves the identity of an unchanged history (`tradesSignature`), so same identities
 * provably means same contents, and a real change swaps the identity and misses the memo.
 */
function memoByParts<T>(compute: (parts: T[][]) => T[]) {
  let lastParts: T[][] = [];
  let lastResult: T[] = [];
  return (parts: T[][]): T[] => {
    if (parts.length === lastParts.length && parts.every((p, i) => p === lastParts[i])) {
      return lastResult;
    }
    lastParts = parts;
    lastResult = compute(parts);
    return lastResult;
  };
}

const memoOpenTrades = memoByParts<Trade>((parts) => parts.flat());
const memoAllTrades = memoByParts<ClosedTrade>((parts) => parts.flat());
const memoClosedTrades = memoByParts<Trade>((parts) =>
  parts.flat().sort((a, b) =>
    // Sort by close timestamp, then by tradeid
    b.close_timestamp && a.close_timestamp
      ? b.close_timestamp - a.close_timestamp
      : b.trade_id - a.trade_id,
  ),
);

// Import axios for type inference only
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import axios from 'axios';

export type BotSubStore = ReturnType<typeof createBotSubStore>;

const BATCH_SIZE = 6;
const BATCH_DELAY_MS = 150;

async function batchedAll<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map((fn) => fn()));
    results.push(...batchResults);
    if (i + BATCH_SIZE < tasks.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  return results;
}

export interface SubStores {
  [key: string]: BotSubStore;
}

export const useBotStore = defineStore('ftbot-wrapper', {
  state: () => {
    return {
      selectedBot: '',
      availableBots: {} as BotDescriptors,
      globalAutoRefresh: true,
      refreshing: false,
      refreshInterval: null as number | null,
      refreshIntervalSlow: null as number | null,
      tradesRefreshInterval: null as number | null,
      visibilityHandler: null as (() => void) | null,
      botStores: {} as SubStores,
    };
  },
  getters: {
    hasBots: (state) => Object.keys(state.availableBots).length > 0,
    botCount: (state) => Object.keys(state.availableBots).length,
    availableBotsSorted: (state) => {
      return Object.values(state.availableBots).sort((a, b) => (a.sortId ?? 0) - (b.sortId ?? 0));
    },
    allBotStores: (state) => Object.values(state.botStores),
    allSelectedBotsSameStake() {
      const stakeCurrencies = Object.values(this.selectedBots).map((bot) => bot.stakeCurrency);
      return (
        stakeCurrencies.length > 0 &&
        stakeCurrencies.every((currency) => currency === stakeCurrencies[0])
      );
    },
    /** All selected bots have the same mode (dry or live) */
    allSelectedBotsSameState() {
      const modes = Object.values(this.selectedBots).map((bot) => bot.botState.dry_run);
      return modes.length > 0 && modes.every((mode) => mode === modes[0]);
    },
    /** Selected bots for dashboard view */
    selectedBots: (state) => {
      return Object.values(state.botStores).filter((store) => store.isSelected);
    },
    selectedBotCount: (state) =>
      Object.values(state.botStores).filter((store) => store.isSelected).length,
    activeBot: (state) => state.botStores[state.selectedBot] as BotSubStore,
    activeBotorUndefined: (state) => state.botStores[state.selectedBot] as BotSubStore | undefined,
    canRunBacktest: (state) => state.botStores[state.selectedBot]?.canRunBacktest ?? false,
    isWebserverMode: (state) => state.botStores[state.selectedBot]?.isWebserverMode ?? false,
    selectedBotObj: (state) => state.availableBots[state.selectedBot],
    nextBotId: (state) => {
      let botCount = Object.keys(state.availableBots).length;

      while (`ftbot.${botCount}` in state.availableBots) {
        botCount += 1;
      }
      return `ftbot.${botCount}`;
    },
    allProfit: (state): Record<string, ProfitStats | undefined> => {
      const result: Record<string, ProfitStats | undefined> = {};
      Object.entries(state.botStores).forEach(([k, botStore]) => {
        result[k] = botStore.profit;
      });
      return result;
    },
    allOpenTradeCount: (state): Record<string, number> => {
      const result: Record<string, number> = {};
      Object.entries(state.botStores).forEach(([k, botStore]) => {
        result[k] = botStore.openTradeCount;
      });
      return result;
    },
    allOpenTrades: (state): Record<string, Trade[]> => {
      const result: Record<string, Trade[]> = {};
      Object.entries(state.botStores).forEach(([k, botStore]) => {
        result[k] = botStore.openTrades;
      });
      return result;
    },
    allBalance: (state): Record<string, BalanceInterface> => {
      const result: Record<string, BalanceInterface> = {};
      Object.entries(state.botStores).forEach(([k, botStore]) => {
        result[k] = botStore.balance;
      });
      return result;
    },
    allBotState: (state): Record<string, BotState> => {
      const result: Record<string, BotState> = {};
      Object.entries(state.botStores).forEach(([k, botStore]) => {
        result[k] = botStore.botState;
      });
      return result;
    },

    allOpenTradesSelectedBots: (state): Trade[] =>
      memoOpenTrades(
        Object.values(state.botStores)
          .filter((b) => b.isSelected)
          .map((b) => b.openTrades),
      ),
    allClosedTradesSelectedBots: (state): Trade[] =>
      memoClosedTrades(
        Object.values(state.botStores)
          .filter((b) => b.isSelected)
          .map((b) => b.trades),
      ),
    allTradesSelectedBots: (state): ClosedTrade[] =>
      memoAllTrades(
        Object.values(state.botStores)
          .filter((b) => b.isSelected)
          .map((b) => b.trades),
      ),
    allBalanceHistory: (state): WalletHistoryPerBot => {
      const result: WalletHistoryPerBot = {};
      Object.entries(state.botStores).forEach(([k, botStore]) => {
        if (botStore.balanceHistory) {
          result[k] = botStore.balanceHistory;
        }
      });
      return result;
    },
    allDailyStatsSelectedBots: (state): TimeSummaryReturnValue => {
      // Return aggregated daily stats for all bots - sorted ascending.
      const resp: Record<string, TimeSummaryRecord> = {};
      Object.entries(state.botStores).forEach(([, botStore]) => {
        if (botStore.isSelected) {
          botStore.dailyStats?.data?.forEach((d) => {
            const existing = resp[d.date];
            if (!existing) {
              resp[d.date] = { ...d };
            } else {
              existing.abs_profit += d.abs_profit;
              existing.fiat_value += d.fiat_value;
              existing.trade_count += d.trade_count;
            }
          });
        }
      });

      const dailyReturn: TimeSummaryReturnValue = {
        stake_currency: 'USDT',
        fiat_display_currency: 'USD',
        data: Object.values(resp).sort((a, b) => (a.date > b.date ? 1 : -1)),
      };
      return dailyReturn;
    },
    allWeeklyStatsSelectedBots: (state): TimeSummaryReturnValue => {
      const resp: Record<string, TimeSummaryRecord> = {};
      Object.entries(state.botStores).forEach(([, botStore]) => {
        if (botStore.isSelected) {
          botStore.weeklyStats?.data?.forEach((d) => {
            const existing = resp[d.date];
            if (!existing) {
              resp[d.date] = { ...d };
            } else {
              existing.abs_profit += d.abs_profit;
              existing.fiat_value += d.fiat_value;
              existing.trade_count += d.trade_count;
            }
          });
        }
      });

      return {
        stake_currency: 'USDT',
        fiat_display_currency: 'USD',
        data: Object.values(resp).sort((a, b) => (a.date > b.date ? 1 : -1)),
      };
    },
    allMonthlyStatsSelectedBots: (state): TimeSummaryReturnValue => {
      const resp: Record<string, TimeSummaryRecord> = {};
      Object.entries(state.botStores).forEach(([, botStore]) => {
        if (botStore.isSelected) {
          botStore.monthlyStats?.data?.forEach((d) => {
            const existing = resp[d.date];
            if (!existing) {
              resp[d.date] = { ...d };
            } else {
              existing.abs_profit += d.abs_profit;
              existing.fiat_value += d.fiat_value;
              existing.starting_balance += d.starting_balance;
              existing.rel_profit += d.rel_profit;
              existing.trade_count += d.trade_count;
            }
          });
        }
      });

      return {
        stake_currency: 'USDT',
        fiat_display_currency: 'USD',
        data: Object.values(resp).sort((a, b) => (a.date > b.date ? 1 : -1)),
      };
    },
    allRateMetrics: (state): Record<string, RateMetricsResponse> => {
      const result: Record<string, RateMetricsResponse> = {};
      Object.entries(state.botStores).forEach(([k, botStore]) => {
        if (botStore.isSelected && botStore.rateMetrics?.exchange) {
          result[k] = botStore.rateMetrics;
        }
      });
      return result;
    },
  },
  actions: {
    selectBot(botId: string) {
      if (botId in this.availableBots) {
        localStorage.setItem(AUTH_SELECTED_BOT, botId);
        this.selectedBot = botId;
        // Single-bot views read `activeBot.trades` directly, so the bot on screen is
        // always allowed its own closed history — the gating below only removes the
        // fan-out to the other forty-odd bots.
        activeBotIdForTrades.value = botId;
        // The on-demand endpoints (locks, pairlists, closed history) are skipped for bots
        // nobody is looking at, so becoming the active bot has to fetch them now. Waiting
        // for the next tick would leave the pairlist panel empty for a minute, and the slow
        // refresh only runs when something else marked the bot dirty, so it might never
        // arrive at all.
        const store = this.botStores[botId];
        if (store?.isBotOnline && store.isBotLoggedIn) {
          void store.getLocks().catch(() => {});
          void store.getWhitelist().catch(() => {});
          void store.getBlacklist().catch(() => {});
          void store.getTrades().catch(() => {});
        }
      } else {
        console.warn(`Botid ${botId} not available, but selected.`);
      }
    },
    addBot(bot: BotDescriptor) {
      if (Object.keys(this.availableBots).includes(bot.botId)) {
        // throw 'Bot already present';
        // TODO: handle error!
        console.log('Bot already present');
        return;
      }
      console.log('add bot', bot);
      const botStore = createBotSubStore(bot.botId, bot.botName);
      botStore.botAdded();
      this.botStores[bot.botId] = botStore;
      this.availableBots[bot.botId] = bot;
      // No `{ ...this.botStores }` reclone here: Vue 3 tracks key addition on a reactive
      // object on its own, so the clone bought nothing and invalidated every fleet-wide
      // getter — including the O(T log T) trade aggregates — once per bot at startup.
    },
    updateBot(botId: string, bot: Partial<BotDescriptor>) {
      const botInstance = this.botStores[botId];
      if (!botInstance) {
        // TODO: handle error!
        console.error('Bot not found');
        return;
      }
      botInstance.updateBot(bot);
      const availableBots = this.availableBots[botId];
      if (!availableBots) return;
      Object.assign(availableBots, bot);
    },
    removeBot(botId: string) {
      if (Object.keys(this.availableBots).includes(botId)) {
        const bot = this.botStores[botId];
        if (!bot) return;
        bot.logout();
        bot.$dispose();

        delete this.botStores[botId];
        delete this.availableBots[botId];
        if (this.selectedBot === botId) {
          this.selectFirstBot();
        }
        // Key deletion is tracked too — see addBot.
      } else {
        console.warn(`bot ${botId} not found! could not remove`);
      }
    },
    selectFirstBot() {
      if (this.hasBots) {
        const selBotId = localStorage.getItem(AUTH_SELECTED_BOT);
        const firstBot = Object.keys(this.availableBots)[0];
        let selBot: string | undefined = firstBot;
        if (selBotId) {
          selBot = Object.keys(this.availableBots).find((x) => x === selBotId);
        }
        if (!selBot) return;
        const bot = this.availableBots[selBot];
        if (!bot) return;
        this.selectBot(bot.botId);
      }
    },
    setGlobalAutoRefresh(value: boolean) {
      // TODO: could be removed.
      this.globalAutoRefresh = value;
    },
    async allRefreshFrequent(forceUpdate = false) {
      const tasks = this.allBotStores
        .filter(
          (e) => e.refreshNow && e.botStatusAvailable && (this.globalAutoRefresh || forceUpdate),
        )
        .map((e) => () => e.refreshFrequent());
      await batchedAll(tasks);
    },
    async allRefreshSlow(forceUpdate = false) {
      const tasks = this.allBotStores
        .filter((e) => e.refreshNow && (this.globalAutoRefresh || forceUpdate))
        .map((e) => () => e.refreshSlow(forceUpdate));
      await batchedAll(tasks);
    },
    async allRefreshFull() {
      if (this.refreshing) {
        return;
      }
      this.refreshing = true;
      try {
        // Ensure all bots status is correct.
        await this.pingAll();

        const stateTasks = this.allBotStores
          .filter((bot) => bot.isBotLoggedIn && bot.isBotOnline && !bot.botStatusAvailable)
          .map((bot) => () => bot.getState());
        await batchedAll(stateTasks);

        const updates: Promise<void>[] = [];
        updates.push(this.allRefreshFrequent(false));
        updates.push(this.allRefreshSlow(true));
        // updates.push(this.getTimeSummary());
        // updates.push(this.getBalance());
        await Promise.all(updates);
        console.log('refreshing_end');
      } finally {
        this.refreshing = false;
      }
    },
    startRefresh() {
      console.log('Starting automatic refresh.');
      // A sub-store that sees its open trades move arms this instead of running its own
      // off-cadence slow refresh; see stores/slowRefreshScheduler.
      registerSlowRefreshRunner(() => void this.allRefreshSlow(false));
      this.allRefreshFull();
      this.startPollingIntervals();
      this.startTradesBackgroundFetch();
      // Pause the two heavy polling loops while the browser tab is hidden. With many
      // bots the standing request volume (per-bot /status every 10s + refreshSlow) is
      // the dominant cost, and there is no point refreshing a dashboard nobody is
      // looking at. On return we refresh immediately so the view is fresh the instant
      // the tab regains focus. The 10-min trades sweep is left running (negligible).
      if (!this.visibilityHandler) {
        const handler = () => {
          if (document.hidden) {
            this.stopPollingIntervals();
          } else if (!this.refreshInterval) {
            this.allRefreshFrequent();
            this.startPollingIntervals();
          }
        };
        this.visibilityHandler = handler;
        document.addEventListener('visibilitychange', handler);
      }
    },
    startPollingIntervals() {
      if (!this.refreshInterval) {
        // Set interval for refresh.
        // 10s (was 5s): with ~30 bots each /status hit calls exchange.get_rate per
        // open trade (expensive) and every response reassigns openTrades, triggering
        // the multi-bot dashboard's reactive recompute storm. 10s halves both the
        // request volume and the churn; imperceptible for 15m-candle strategies.
        this.refreshInterval = window.setInterval(() => {
          this.allRefreshFrequent();
        }, 10000);
      }
      if (!this.refreshIntervalSlow) {
        this.refreshIntervalSlow = window.setInterval(() => {
          this.allRefreshSlow(false);
        }, 60000);
      }
    },
    stopPollingIntervals() {
      if (this.refreshInterval) {
        window.clearInterval(this.refreshInterval);
        this.refreshInterval = null;
      }
      if (this.refreshIntervalSlow) {
        window.clearInterval(this.refreshIntervalSlow);
        this.refreshIntervalSlow = null;
      }
    },
    startTradesBackgroundFetch() {
      if (this.tradesRefreshInterval) {
        return;
      }
      // Fetch trades for all online bots immediately
      this.fetchAllBotsTrades();
      // Then every 10 minutes. This is a full-history re-download safety net; the
      // per-bot refreshSlow already re-fetches trades on change (open-trade id diff),
      // so this periodic sweep can be infrequent. 10min (was 5min) halves the
      // redundant full /trades downloads across all bots.
      this.tradesRefreshInterval = window.setInterval(
        () => {
          this.fetchAllBotsTrades();
        },
        10 * 60 * 1000,
      );
    },
    async fetchAllBotsTrades() {
      const tasks = Object.values(this.botStores)
        .filter((bot) => bot.isBotOnline && bot.isBotLoggedIn && closedTradesWanted(bot.botId))
        .map((bot) => () => bot.getTrades().catch(() => {}));
      await batchedAll(tasks);
    },
    /**
     * A component that needs every selected bot's closed history is mounting. Pairs with
     * `releaseClosedTrades`; use the `useClosedTradesFeed()` composable rather than calling
     * these by hand, so the release cannot be forgotten.
     */
    requestClosedTrades() {
      closedTradesDemand.value += 1;
      // Fetch straight away rather than waiting for the next slow tick: a widget that just
      // scrolled into view must not sit empty for a minute. The per-bot call is guarded by
      // a one-row count probe, so when the history is already loaded this costs 45 tiny
      // requests, not 11 MB.
      void this.fetchAllBotsTrades();
    },
    releaseClosedTrades() {
      closedTradesDemand.value = Math.max(0, closedTradesDemand.value - 1);
    },
    stopRefresh() {
      console.log('Stopping automatic refresh.');
      if (this.visibilityHandler) {
        document.removeEventListener('visibilitychange', this.visibilityHandler);
        this.visibilityHandler = null;
      }
      this.stopPollingIntervals();
      if (this.tradesRefreshInterval) {
        window.clearInterval(this.tradesRefreshInterval);
        this.tradesRefreshInterval = null;
      }
    },
    async pingAll() {
      const bots = Object.values(this.botStores);
      await batchedAll(
        bots.map((v) => async () => {
          try {
            await v.fetchPing();
          } catch {
            // pass
          }
        }),
      );
    },
    async allGetState() {
      const bots = Object.values(this.botStores);
      await batchedAll(
        bots.map((v) => async () => {
          try {
            await v.getState();
          } catch {
            // pass
          }
        }),
      );
    },
    async allGetDaily(payload: TimeSummaryPayload) {
      const updates: Promise<TimeSummaryReturnValue>[] = [];

      this.allBotStores.forEach((bot) => {
        if (bot.isBotOnline) {
          updates.push(bot.getTimeSummary(TimeSummaryOptions.daily, payload));
        }
      });
      await Promise.all(updates);
    },
    async allGetRateMetrics() {
      const updates: Promise<RateMetricsResponse>[] = [];
      this.allBotStores.forEach((bot) => {
        if (bot.isBotOnline) {
          updates.push(bot.getRateMetrics());
        }
      });
      await Promise.all(updates);
    },
    async allGetVolumeHistory(days = 90, bucket = '1d') {
      const updates: Promise<VolumeHistoryResponse>[] = [];
      this.allBotStores.forEach((bot) => {
        if (bot.isBotOnline) {
          updates.push(bot.getVolumeHistory(days, bucket));
        }
      });
      await Promise.all(updates);
    },
    async forceSellMulti(forcesellPayload: MultiForceExitPayload) {
      const bot = this.botStores[forcesellPayload.botId];
      if (!bot) return;
      return bot.forceexit(forcesellPayload);
    },
    async deleteTradeMulti(deletePayload: MultiDeletePayload) {
      const bot = this.botStores[deletePayload.botId];
      if (!bot) return;
      return bot.deleteTrade(deletePayload.tradeid);
    },
    async cancelOpenOrderMulti(deletePayload: MultiCancelOpenOrderPayload) {
      const bot = this.botStores[deletePayload.botId];
      if (!bot) return;
      return bot.cancelOpenOrder(deletePayload.tradeid);
    },
    async reloadTradeMulti(deletePayload: MultiReloadTradePayload) {
      const bot = this.botStores[deletePayload.botId];
      if (!bot) return;
      return bot.reloadTrade(deletePayload.tradeid);
    },
    async allGetTimeSummary(period: TimeSummaryOptions, payload?: TimeSummaryPayload) {
      const updates: Promise<TimeSummaryReturnValue>[] = [];

      this.allBotStores.forEach((bot) => {
        if (bot.isBotOnline && bot.isSelected) {
          updates.push(bot.getTimeSummary(period, payload));
        }
      });
      await Promise.all(updates);
    },
    toggleBotsByState(state: 'dry' | 'live' | 'all') {
      for (const bot of Object.values(this.botStores)) {
        if (state === 'all') {
          bot.isSelected = true;
        } else if (
          bot.isBotOnline &&
          ((bot.botState.dry_run && state === 'dry') || (!bot.botState.dry_run && state === 'live'))
        ) {
          bot.isSelected = true;
        } else {
          bot.isSelected = false;
        }
      }
    },
    toggleBotsByExchange(exchange: string) {
      for (const bot of Object.values(this.botStores)) {
        if (bot.botState.exchange?.toLowerCase() === exchange.toLowerCase()) {
          bot.isSelected = true;
        } else {
          bot.isSelected = false;
        }
      }
    },
    toggleBotsByStakeCurrency(currency: string) {
      for (const bot of Object.values(this.botStores)) {
        if (bot.botState.stake_currency?.toLowerCase() === currency.toLowerCase()) {
          bot.isSelected = true;
        } else {
          bot.isSelected = false;
        }
      }
    },
  },
});

let _botsInitialized = false;

export function initBots() {
  const botStore = useBotStore();
  if (_botsInitialized && botStore.hasBots) {
    return;
  }
  Object.entries(loggedInBots.value).forEach(([, v]) => {
    botStore.addBot(v);
  });
  botStore.selectFirstBot();
  botStore.startRefresh();
  botStore.allRefreshFull();
  _botsInitialized = true;
}

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useBotStore, import.meta.hot));
}
