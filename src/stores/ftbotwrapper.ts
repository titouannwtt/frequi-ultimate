import type {
  BotDescriptor,
  BotDescriptors,
  BotState,
  MultiCancelOpenOrderPayload,
  MultiDeletePayload,
  MultiForceExitPayload,
  MultiReloadTradePayload,
} from '@/types';
import { createBotSubStore } from './ftbot';
import { activeBotIdForTrades, closedTradesWanted } from './closedTradesPolicy';
import { forgetBotName } from './botNameRegistry';
import { fleetDigestCoversBot, publishFleetDigests } from './fleetDigestPolicy';
import { registerSlowRefreshRunner } from './slowRefreshScheduler';
const AUTH_SELECTED_BOT = 'ftSelectedBot';

/**
 * Decimation of the two refresh tiers for bots the fleet snapshot already covers.
 *
 * The startup burst and the standing load are both dominated by per-bot polling: /status
 * every 10 s and eight endpoints every 60 s, times the whole fleet. `/fleet/snapshot`
 * carries the scalars those tiers exist to keep current (state, open-trade counts, closed
 * and open profit, balance, strategy) for every bot in one 16 kB request that is already
 * being made every 10 s.
 *
 * So a covered bot keeps ONE real fetch in N and reads the snapshot in between. The
 * factors are deliberately unequal. The frequent tier is 6, taking /status from 10 s to
 * 60 s per bot, because everything it feeds beyond the trade rows is in the digest. The
 * slow tier is only 3, taking it from 60 s to 180 s, because /profit_all also carries
 * win/loss counts and ratios that the digest does NOT have, and those must not drift far.
 *
 * Nothing here applies to the bot on screen, to a forced refresh, or to a fleet with no
 * snapshot: in all three cases every bot polls exactly as it did before.
 */
const FREQUENT_DECIMATION = 6;
const SLOW_DECIMATION = 3;
let frequentTick = 0;
let slowTick = 0;

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
    allBotStores: (state) => Object.values(state.botStores),
    activeBot: (state) => state.botStores[state.selectedBot] as BotSubStore,
    canRunBacktest: (state) => state.botStores[state.selectedBot]?.canRunBacktest ?? false,
    isWebserverMode: (state) => state.botStores[state.selectedBot]?.isWebserverMode ?? false,
    allBotState: (state): Record<string, BotState> => {
      const result: Record<string, BotState> = {};
      Object.entries(state.botStores).forEach(([k, botStore]) => {
        result[k] = botStore.botState;
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
        // Drop the remembered bot_name too, so a botId reused later cannot inherit the
        // previous occupant's fleet digest. See stores/botNameRegistry.
        forgetBotName(botId);
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
    async allRefreshFrequent(forceUpdate = false) {
      frequentTick += 1;
      const tasks = this.allBotStores
        .filter(
          (e) => e.refreshNow && e.botStatusAvailable && (this.globalAutoRefresh || forceUpdate),
        )
        .filter((e) => !this.digestCoversTier(e.botId, frequentTick, FREQUENT_DECIMATION))
        .map((e) => () => e.refreshFrequent());
      await batchedAll(tasks);
    },
    async allRefreshSlow(forceUpdate = false) {
      slowTick += 1;
      const tasks = this.allBotStores
        .filter((e) => e.refreshNow && (this.globalAutoRefresh || forceUpdate))
        .filter((e) => !this.digestCoversTier(e.botId, slowTick, SLOW_DECIMATION))
        .map((e) => () => e.refreshSlow(forceUpdate));
      await batchedAll(tasks);
    },
    /**
     * Whether this tick's request for `botId` can be dropped because the fleet snapshot
     * already carries what the tier would have fetched.
     *
     * Three conditions, and all three must hold:
     *
     * - the bot is NOT the one on screen. The active bot is being read in detail, on
     *   endpoints the digest does not cover (trade rows, orders, locks). It always polls.
     * - a fresh digest exists for it, joined by API port or by remembered bot_name (see
     *   `fleetDigestKeyFor`). A missing or stale digest means the snapshot cannot answer
     *   for this bot, so the bot must answer for itself. The port join is what makes this
     *   fire on the FIRST tick of a cold load: the name is only learned from /show_config,
     *   which is itself one of the per-bot requests being decimated here.
     * - it is not this bot's turn. The decimation keeps one real fetch in N, so the
     *   per-bot state the digest does NOT cover (open-trade rows, win/loss counts) still
     *   refreshes, just at a slower cadence. Never skipping forever is the whole point:
     *   the digest is a stand-in between fetches, not a replacement for them.
     *
     * The turn is spread by bot NAME, not by array index, and that is what turns the
     * startup fan-out into a ramp instead of a burst. Every covered bot is still filled,
     * within one N-tick window, but in N groups rather than all at once: the queueing that
     * made 400 simultaneous requests take two minutes to drain is what actually hurt.
     * The digest holds the comparison table's figures up in the meantime, badged with
     * their age, so nothing on screen is blank while the ramp runs.
     *
     * Note this ignores `forceUpdate`. That flag exists to bypass the auto-refresh
     * setting, not to override the snapshot: a forced refresh of the whole fleet is the
     * burst. The paths that must be immediate for one bot (selecting it, it coming back
     * online, toggling auto-refresh) call that bot's own `refreshSlow` directly and never
     * pass through here.
     */
    digestCoversTier(botId: string, tick: number, decimation: number): boolean {
      if (botId === this.selectedBot) return false;
      if (!fleetDigestCoversBot(botId)) return false;
      let spread = 0;
      for (let i = 0; i < botId.length; i++) spread = (spread * 31 + botId.charCodeAt(i)) >>> 0;
      return (tick + spread) % decimation !== 0;
    },
    async allRefreshFull() {
      if (this.refreshing) {
        return;
      }
      this.refreshing = true;
      try {
        // Ensure all bots status is correct.
        await this.pingAll();
        // Before fanning out, ask one bot for the whole fleet. This has to happen FIRST:
        // the tiers below only stagger the bots the snapshot covers, and a snapshot that
        // arrives after them saves nothing on the load everyone actually feels.
        await this.primeFleetSnapshot();

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
    /**
     * Fetch the fleet snapshot once and publish it, so the refresh tiers can lean on it
     * from the very first cycle.
     *
     * `useFleetSnapshot` is the steady-state poller, but it lives in a component and
     * cannot be imported here (it imports this store). This is the startup shortcut, not
     * a second poller: one request, and every failure mode simply leaves the tiers with
     * no coverage, which is the full per-bot fan-out they did before.
     */
    async primeFleetSnapshot() {
      const candidate =
        this.activeBot?.isBotOnline === true
          ? this.activeBot
          : this.allBotStores.find((b) => b.isBotOnline);
      if (!candidate) return;
      try {
        const data = await candidate.getFleetSnapshot();
        publishFleetDigests(data?.bots ?? {}, Boolean(data?.bots) && !data?.error);
      } catch {
        // Older bot, or a fleet without the daemon: fall back to per-bot polling.
        publishFleetDigests({}, false);
      }
    },
    async pingAll() {
      const bots = Object.values(this.botStores);
      await batchedAll(
        bots.map((v) => async () => {
          // A bot that pushed a digest seconds ago is demonstrably alive, and the snapshot
          // that says so was fetched in one request for the whole fleet. Pinging it again
          // asks a question already answered, once per bot, every minute.
          //
          // Strictly one-way: a fresh digest can only mark a bot ONLINE. It is never used
          // to mark one offline, because a missing digest has several innocent causes (a
          // remote bot the host's daemon does not know, a push that has not landed yet)
          // and wrongly greying out a live bot is the costlier mistake. Those bots fall
          // through to a real ping below.
          if (v.isBotLoggedIn && fleetDigestCoversBot(v.botId)) {
            v.setIsBotOnline(true);
            return;
          }
          try {
            await v.fetchPing();
          } catch {
            // pass
          }
        }),
      );
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
  },
});

let _botsInitialized = false;

export function initBots() {
  const botStore = useBotStore();
  if (_botsInitialized && botStore.hasBots) {
    // A bot added since (Settings) must reach the legacy tools without a reload
    Object.values(loggedInBots.value).forEach((v) => {
      if (!(v.botId in botStore.availableBots)) botStore.addBot(v);
    });
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
