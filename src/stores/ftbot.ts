import type {
  AllProfitStats,
  BackgroundTaskStatus,
  BacktestHistoryEntry,
  BacktestMarketChange,
  BacktestMetadataPatch,
  BacktestMetadataWithStrategyName,
  BacktestPayload,
  BacktestResult,
  BacktestResultInMemory,
  BacktestResultUpdate,
  BacktestStatus,
  BalanceInterface,
  BgTaskStarted,
  BlacklistResponse,
  BotDescriptor,
  BotFeatures,
  BotState,
  ClosedTrade,
  DeleteTradeResponse,
  DownloadDataPayload,
  EntryStats,
  Exchange,
  ExchangeListResult,
  ExitStats,
  ForceEnterPayload,
  ForceExitPayload,
  FreqAIModelListResult,
  HyperoptLossObj,
  LockResponse,
  LogLine,
  MixTagStats,
  PairCandlePayload,
  PairHistory,
  PairHistoryPayload,
  PairIntervalTuple,
  PairlistEvalResponse,
  PairlistsPayload,
  PairlistsResponse,
  PerformanceEntry,
  PlotConfig,
  ProfitStats,
  StatusResponse,
  StrategyListResult,
  StrategyResult,
  SysInfoResponse,
  CacheStatusResponse,
  FleetStatusResponse,
  RateMetricsResponse,
  VolumeHistoryResponse,
  TimeSummaryReturnValue,
  Trade,
  TradeResponse,
  WalletHistory,
  ProfitHistoryResponse,
  WalletHistoryPerBot,
  WhitelistResponse,
} from '@/types';
import { BacktestSteps, LoadingStatus, RunModes } from '@/types';
import type { PipelineStep } from '@/types/blacklist';
import type { FleetSnapshotResponse } from '@/types/fleetSnapshot';
import type { FTWsMessage } from '@/types/wsMessageTypes';
import { FtWsMessageTypes } from '@/types/wsMessageTypes';
import { markRaw } from 'vue';
import { useWebSocket } from '@vueuse/core';
import type { AxiosResponse } from 'axios';
import axios from 'axios';

import { evaluateFeatures } from '@/utils/features';
import { closedTradesWanted } from '@/stores/closedTradesPolicy';
import { blacklistWanted, locksWanted, whitelistWanted } from '@/stores/perBotFetchPolicy';
import { rememberBotName } from '@/stores/botNameRegistry';
import { scheduleSlowRefresh } from '@/stores/slowRefreshScheduler';
import { legacyPollingAllowed } from '@/stores/legacyPollingGate';

/**
 * Runaway guard on the closed-trade pagination, per bot.
 *
 * NOT a retention policy: cumulative-profit and drawdown curves are only correct over the
 * full history, so silently dropping the oldest trades would produce a wrong money figure —
 * worse than a slow one. This ceiling exists so a bot reporting an absurd `total_trades`
 * cannot page the browser to death. It is an order of magnitude above any real fleet bot.
 */
const MAX_RETAINED_TRADES = 50_000;

// Shared across every consumer of getRateMetrics: /rate_metrics is polled by four
// separate widgets, and without this each one fans out across the whole fleet.
const RATE_METRICS_COALESCE_MS = 10_000;
const rateMetricsCache = new Map<string, { ts: number; promise: Promise<RateMetricsResponse> }>();

export function createBotSubStore(botId: string, botName: string) {
  const loginInfo = useLoginInfo(botId);
  const { api } = useApi(loginInfo, botId);

  const { showAlert } = useAlertForBot(botName);

  function getApiErrorDetail(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data;
      return data?.error || data?.detail || error.message || '';
    }
    return '';
  }

  // Handle of the bot socket, kept outside the state so it can be closed on demand
  let wsClose: (() => void) | null = null;

  const useBotStore = defineStore(botId, {
    state: () => {
      return {
        websocketStarted: false,
        isSelected: true,
        ping: '',
        botStatusAvailable: false,
        isBotOnline: false,
        isBotStarting: false,
        lastSeenOnline: 0 as number,
        isBotLoggedIn: true,
        autoRefresh: false,
        refreshing: false,
        versionState: '',
        lastLogs: [] as LogLine[],
        refreshRequired: true,
        trades: [] as ClosedTrade[],
        openTrades: [] as Trade[],
        tradeCount: 0,
        tradesSignature: '',
        openTradesSignature: '',
        closedTradesLoaded: false,
        closedTradesLoading: false,
        performanceStats: [] as PerformanceEntry[],
        entryStats: [] as EntryStats[],
        exitStats: [] as ExitStats[],
        mixTagStats: [] as MixTagStats[],
        whitelist: [] as string[],
        blacklist: [] as string[],
        profitAll: undefined as AllProfitStats | undefined,
        botState: {} as BotState,
        balance: {} as BalanceInterface,
        dailyStats: {} as TimeSummaryReturnValue,
        weeklyStats: {} as TimeSummaryReturnValue,
        monthlyStats: {} as TimeSummaryReturnValue,
        balanceHistory: undefined as WalletHistory | undefined,
        profitHistory: undefined as ProfitHistoryResponse | undefined,
        profitHistoryFetchedAt: 0,
        /**
         * Wall-clock ms of the last successful slow refresh, 0 when never.
         *
         * The slow tier is decimated for bots nobody is looking at, so a figure on screen
         * can now be several minutes old. Widgets compare this against the fleet digest's
         * age to show whichever is fresher, and to say so. Without it, "old" and "current"
         * would be indistinguishable on a money dashboard.
         */
        slowRefreshedAt: 0,
        pairlistMethods: [] as string[],
        pairlistPipeline: [] as PipelineStep[],
        handlerConfigs: [] as Record<string, any>[],
        totalMarketPairs: 0,
        addedPairs: [] as string[],
        detailTradeId: null as number | null,
        selectedPair: '',
        plotMultiPairs: [] as string[],
        // TODO: type me
        candleData: {},
        candleDataStatus: LoadingStatus.not_loaded,
        // TODO: type me
        history: {},
        historyStatus: LoadingStatus.not_loaded,
        historyTakesLonger: false,
        strategyList: [] as string[],
        freqaiModelList: [] as string[],
        hyperoptLossList: [] as HyperoptLossObj[],
        exchangeList: [] as Exchange[],
        strategy: {} as StrategyResult | undefined,
        pairlist: [] as string[],
        pairlistWithTimeframe: [] as PairIntervalTuple[],
        currentLocks: undefined as LockResponse | undefined,
        // backtesting
        backtestRunning: false,
        backtestProgress: 0.0,
        backtestStep: BacktestSteps.none,
        backtestTradeCount: 0,
        selectedBacktestResultKey: '',
        backtestHistory: {} as Record<string, BacktestResultInMemory>,
        backtestHistoryList: [] as BacktestHistoryEntry[],
        sysInfo: {} as SysInfoResponse,
        cacheStatus: {} as CacheStatusResponse,
        rateMetrics: {} as RateMetricsResponse,
        volumeHistory: undefined as VolumeHistoryResponse | undefined,
        fleetStatus: null as FleetStatusResponse | null,
        signalSummary: {} as Record<
          string,
          { enter_long: number; exit_long: number; enter_short: number; exit_short: number }
        >,
        signalSummaryLoading: false,
        signalSummaryLastFetched: 0,
      };
    },
    getters: {
      version: (state) => state.botState?.version || state.versionState,
      botApiVersion: (state) => state.botState?.api_version || 1.0,
      botFeatures(): BotFeatures {
        return evaluateFeatures(this.botState, this.botApiVersion);
      },
      stakeCurrency: (state) => state.botState?.stake_currency || '',
      stakeCurrencyDecimals: (state) => state.botState?.stake_currency_decimals || 3,
      canRunBacktest: (state) => state.botState?.runmode === RunModes.WEBSERVER,
      isWebserverMode: (state) => state.botState?.runmode === RunModes.WEBSERVER,
      selectedBacktestResult: (state) =>
        state.backtestHistory[state.selectedBacktestResultKey]?.strategy,
      selectedBacktestMetadata: (state) =>
        state.backtestHistory[state.selectedBacktestResultKey]?.metadata,
      shortAllowed: (state) => state.botState?.short_allowed || false,
      isTrading: (state) =>
        state.botState?.runmode === RunModes.LIVE || state.botState?.runmode === RunModes.DRY_RUN,
      timeframe: (state) => state.botState?.timeframe || '',
      closedTrades: (state) => {
        return state.trades
          .filter((item) => !item.is_open)
          .sort((a, b) =>
            // Sort by close timestamp, then by tradeid
            b.close_timestamp && a.close_timestamp
              ? b.close_timestamp - a.close_timestamp
              : b.trade_id - a.trade_id,
          );
      },
      tradeDetail: (state): Trade | undefined => {
        // console.log('tradeDetail', state.openTrades.length, state.openTrades);
        let dTrade = state.openTrades.find((item) => item.trade_id === state.detailTradeId);
        if (!dTrade) {
          dTrade = state.trades.find((item) => item.trade_id === state.detailTradeId);
        }
        return dTrade;
      },
      refreshNow: (state) => {
        if (
          state.autoRefresh &&
          state.isBotOnline &&
          state.botState?.runmode !== RunModes.WEBSERVER
        ) {
          return true;
        }
        return false;
      },
      botName: (state) => state.botState?.bot_name || 'freqtrade',
      botId: () => botId,
      allTrades: (state) => [...state.openTrades, ...state.trades] as Trade[],
      profit: (state): ProfitStats | undefined => state.profitAll?.all,
    },
    actions: {
      botAdded() {
        this.autoRefresh = loginInfo.autoRefresh.value;
      },
      async fetchPing() {
        try {
          const result = await api.get('/ping');
          const now = Date.now();
          this.ping = `${result.data.status} ${now.toString()}`;
          this.isBotStarting = result.data.status === 'starting';
          this.setIsBotOnline(true);
          return Promise.resolve();
        } catch (error) {
          if (!this.isBotStarting) {
            this.setIsBotOnline(false);
          }
          return Promise.reject();
        }
      },
      logout() {
        loginInfo.logout();
      },
      getLoginInfo() {
        return loginInfo.getLoginInfo();
      },
      updateBot(updatedBotInfo: Partial<BotDescriptor>) {
        loginInfo.updateBot(updatedBotInfo);
      },
      setIsBotOnline(isBotOnline: boolean) {
        if (!this.isBotOnline && isBotOnline && this.isBotLoggedIn) {
          // Bot just came online.
          // Refresh everything
          this.refreshRequired = true;
          this.refreshSlow(true);
        }
        if (isBotOnline) {
          this.lastSeenOnline = Date.now();
        }
        this.isBotOnline = isBotOnline;
      },
      async refreshSlow(forceUpdate = false) {
        // A ping answered after the user left the legacy pages ends here (`setIsBotOnline`)
        if (!legacyPollingAllowed()) return;
        if (this.isBotStarting) {
          await this.fetchPing();
          return;
        }
        if (this.refreshing && !forceUpdate) {
          return;
        }
        // Refresh data only when needed
        if (forceUpdate || this.refreshRequired) {
          try {
            this.refreshing = true;
            // TODO: Should be AxiosInstance
            const updates: Promise<unknown>[] = [];
            updates.push(this.getState());
            updates.push(this.getProfit());
            // Closed history is pulled only for the bot on screen or when a multi-bot
            // widget asked for it (see stores/closedTradesPolicy). It used to be pulled
            // for every bot on every slow tick, which is most of the dashboard's bytes.
            if (closedTradesWanted(botId)) {
              updates.push(this.getTrades());
            }
            updates.push(this.getBalance());
            updates.push(this.updateWalletChange());
            // Pairlists are read by single-bot views only (PairListLive on the active bot,
            // PairlistInfoCard which fetches its own on hover), so they follow the same
            // on-demand rule as closed trades. See stores/perBotFetchPolicy.
            if (whitelistWanted(botId)) {
              updates.push(this.getWhitelist());
            }
            if (blacklistWanted(botId)) {
              updates.push(this.getBlacklist());
            }
            updates.push(this.getCurrentStrategy());
            await Promise.all(updates);
            this.refreshRequired = false;
            this.slowRefreshedAt = Date.now();
          } finally {
            this.refreshing = false;
          }
        }
        return Promise.resolve();
      },
      async refreshFrequent() {
        if (!legacyPollingAllowed()) return;
        if (this.isBotStarting) {
          return;
        }
        // Refresh data that's needed in near realtime
        await this.getOpenTrades();
        // Lock state is read by TradingView and PairLockList only, both through
        // `activeBot`. Polling it for the whole fleet was a quarter of the dashboard's API
        // calls for pixels that never existed. See stores/perBotFetchPolicy.
        if (locksWanted(botId)) {
          await this.getLocks();
        }
      },

      setDetailTrade(trade: Trade | null) {
        this.detailTradeId = trade?.trade_id || null;
        this.selectedPair = trade ? trade.pair : this.selectedPair;
      },
      async getTrades() {
        try {
          this.closedTradesLoading = true;
          let totalTrades = 0;
          const pageLength = 500;
          const fetchTrades = async (limit: number, offset: number) => {
            return api.get<TradeResponse>('/trades', {
              params: { limit, offset },
            });
          };
          // Probe the count before pulling history. Closed trades only change when a
          // trade closes, yet this swept every page on a timer: ~8 MB across a 50-bot
          // fleet, re-fetched to rebuild an identical list. One tiny request now tells
          // us whether anything moved, and the early return also preserves the array
          // identity that downstream memoisation depends on.
          if (this.closedTradesLoaded && this.trades.length > 0) {
            const probe = await fetchTrades(1, 0);
            if (probe.data.total_trades === this.tradeCount) {
              return Promise.resolve();
            }
          }
          const res = await fetchTrades(pageLength, 0);
          const result: TradeResponse = res.data;
          let { trades } = result;
          if (Array.isArray(trades)) {
            if (trades.length !== result.total_trades) {
              // Pagination necessary
              // Don't use Promise.all - this would fire all requests at once, which can
              // cause problems for big sqlite databases
              do {
                const before = trades.length;
                const res = await fetchTrades(pageLength, trades.length);

                const result: TradeResponse = res.data;
                trades = trades.concat(result.trades);
                totalTrades = res.data.total_trades;
                // Three independent exit guards, because `!==` alone could not terminate:
                // a trade closing mid-pagination moves `total_trades` and the equality is
                // then never met, so the loop kept paging forever against a live bot.
                // `>=` handles the count moving up, an empty page handles it moving down,
                // and the hard cap is a runaway guard that must never fire in practice.
                if (trades.length === before) break;
                if (trades.length >= MAX_RETAINED_TRADES) break;
              } while (trades.length < totalTrades);
            }
            const tradesCount = trades.length;
            // markRaw: a closed trade is immutable once fetched — we replace the whole
            // array, never mutate a field. Without it Vue proxies every trade *and*
            // every nested order: ~36 000 proxies on a 50-bot fleet, rebuilt on each
            // refresh, for reactivity nothing ever uses.
            trades = trades.map((t) =>
              markRaw({
                ...t,
                botId,
                botName,
                botTradeId: `${botId}__${t.trade_id}`,
              }),
            );
            // Keep the array identity when nothing changed. Downstream memoisation
            // (drawdown caches, the fleet-wide aggregates) is keyed on identity, so
            // reassigning an identical array silently invalidates all of it — which is
            // why those caches never hit today.
            const lastClosed = trades.length ? trades[trades.length - 1] : undefined;
            const signature = `${tradesCount}:${lastClosed?.trade_id ?? ''}:${
              lastClosed?.close_timestamp ?? ''
            }`;
            if (signature !== this.tradesSignature) {
              this.trades = trades;
              this.tradesSignature = signature;
            }
            this.tradeCount = tradesCount;
            this.closedTradesLoaded = true;
          }
          return Promise.resolve();
        } catch (error) {
          if (axios.isAxiosError(error)) {
            console.error(error.response);
          }
          return Promise.reject(error);
        } finally {
          this.closedTradesLoading = false;
        }
      },
      async getOpenTrades() {
        try {
          const { data } = await api.get<never, AxiosResponse<Trade[]>>('/status');
          // Check if trade-id's are different in this call, then flag a full refresh.
          //
          // It used to *run* that full refresh here, off-cadence and per bot. Across 45
          // bots there is almost always one whose open-trade list just moved, so the
          // eight-endpoint "every 60 s" tier ran essentially continuously — the single
          // largest amplifier of the request fan-out. The flag plus a coalesced sweep
          // keeps the responsiveness (a few seconds, not a minute) without the storm.
          if (
            Array.isArray(this.openTrades) &&
            Array.isArray(data) &&
            (this.openTrades.length !== data.length ||
              !this.openTrades.every((val, index) => val.trade_id === data[index]?.trade_id))
          ) {
            this.refreshRequired = true;
            scheduleSlowRefresh();
          }
          if (Array.isArray(data)) {
            // markRaw for the same reason as closed trades; open trades legitimately
            // change every tick, so their array identity cannot be stabilised — but
            // their contents still need not be proxied.
            const openTrades = data.map((t) =>
              markRaw({
                ...t,
                botId,
                botName,
                botTradeId: `${botId}__${t.trade_id}`,
              }),
            );
            // Keep the array identity when nothing a viewer could see has moved.
            // `openTrades` was reassigned on every 10 s tick for every bot, i.e. ~270
            // invalidations a minute on a 45-bot fleet, each one cascading through
            // `allOpenTradesSelectedBots` into every chart that reads it — including the
            // ticks where a bot holds no position at all and the payload is literally `[]`.
            // The signature covers the fields the UI renders, so a genuine price move
            // still propagates immediately: this trades no liveness away.
            const signature = openTrades
              .map(
                (t) =>
                  `${t.trade_id}:${t.amount}:${t.stake_amount}:${t.current_rate ?? ''}:` +
                  `${t.total_profit_abs ?? ''}:${t.profit_abs ?? ''}:` +
                  `${t.has_open_orders ?? ''}:${t.nr_of_successful_entries ?? ''}:${t.is_open}`,
              )
              .join('|');
            if (signature !== this.openTradesSignature) {
              this.openTrades = openTrades;
              this.openTradesSignature = signature;
            }
            if (this.selectedPair === '') {
              this.selectedPair = openTrades[0]?.pair || '';
            }
          }
        } catch (data) {
          return console.error(data);
        }
      },
      getLocks() {
        return api
          .get('/locks')
          .then((result) => (this.currentLocks = result.data))
          .catch(console.error);
      },
      async deleteLock(lockid: string) {
        showAlert(`Deleting lock ${lockid}...`, 'info');
        try {
          const res = await api.delete<LockResponse>(`/locks/${lockid}`);
          showAlert(`Deleted Lock ${lockid}.`, 'success');
          this.currentLocks = res.data;
          return Promise.resolve(res);
        } catch (error) {
          const detail = getApiErrorDetail(error);
          showAlert(`Failed to delete lock ${lockid}: ${detail}`, 'error');
          return Promise.reject(error);
        }
      },
      async getPairCandles(payload: PairCandlePayload) {
        if (payload.pair && payload.timeframe) {
          this.candleDataStatus = LoadingStatus.loading;
          try {
            let result: PairHistory | null = null;
            const settingsStore = useSettingsStore();
            if (this.botFeatures.reducedPairCalls && settingsStore.useReducedPairCalls) {
              // Modern approach, allowing filtering of columns
              const { data } = await api.post<PairCandlePayload, AxiosResponse<PairHistory>>(
                '/pair_candles',
                payload,
              );
              result = data;
            } else {
              const { data } = await api.get<PairHistory>('/pair_candles', {
                params: { ...payload },
              });
              result = data;
            }
            if (result) {
              this.candleData = {
                ...this.candleData,
                [`${payload.pair}__${payload.timeframe}`]: {
                  pair: payload.pair,
                  timeframe: payload.timeframe,
                  data: result,
                },
              };
            }
            this.candleDataStatus = LoadingStatus.success;
          } catch (err) {
            console.error(err);
            this.candleDataStatus = LoadingStatus.error;
          }
        } else {
          // Error branchs
          const error = 'pair or timeframe not specified';
          console.error(error);
          return new Promise((resolve, reject) => {
            reject(error);
          });
        }
      },
      async getSignalSummary(force = false) {
        const CACHE_TTL = 30_000;
        if (!force && Date.now() - this.signalSummaryLastFetched < CACHE_TTL) return;
        if (this.signalSummaryLoading) return;
        this.signalSummaryLoading = true;
        try {
          const { data } = await api.get<{
            pairs: Record<
              string,
              { enter_long: number; exit_long: number; enter_short: number; exit_short: number }
            >;
            timeframe: string;
            last_analyzed_ts: number;
          }>('/signal_summary');
          this.signalSummary = data.pairs;
          this.signalSummaryLastFetched = Date.now();
        } catch (e) {
          console.warn('Signal summary unavailable', e);
        } finally {
          this.signalSummaryLoading = false;
        }
      },
      async getPairHistory(payload: PairHistoryPayload) {
        if (payload.pair && payload.timeframe) {
          this.historyStatus = LoadingStatus.loading;
          this.historyTakesLonger = false;
          let loadingTimer: ReturnType<typeof setTimeout> | null = null;
          try {
            const settingsStore = useSettingsStore();
            let result: PairHistory | null = null;
            loadingTimer = setTimeout(() => (this.historyTakesLonger = true), 10000);
            const timeout = 2 * 60 * 1000; // in MS
            if (this.botFeatures.reducedPairCalls && settingsStore.useReducedPairCalls) {
              // Modern approach, allowing filtering of columns
              const { data } = await api.post<PairHistoryPayload, AxiosResponse<PairHistory>>(
                '/pair_history',
                payload,
                { timeout },
              );
              result = data;
            } else {
              const { data } = await api.get<PairHistory>('/pair_history', {
                params: { ...payload },
                timeout,
              });
              result = data;
            }
            this.history[`${payload.pair}__${payload.timeframe}`] = {
              pair: payload.pair,
              timeframe: payload.timeframe,
              timerange: payload.timerange,
              data: result,
            };
            this.historyStatus = LoadingStatus.success;
            return;
          } catch (err) {
            console.error('axios', err);
            this.historyStatus = LoadingStatus.error;
            if (axios.isAxiosError(err)) {
              console.error(err.response);
              const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout');
              const errMsg = isTimeout
                ? 'Timeout exceeded'
                : (err.response?.data?.detail ?? 'Error fetching history');
              showAlert(errMsg, 'error');
            }

            return new Promise((resolve, reject) => {
              reject(err);
            });
          } finally {
            if (loadingTimer) {
              clearTimeout(loadingTimer);
            }
            this.historyTakesLonger = false;
          }
        }
        // Error branchs
        const error = 'pair or timeframe or timerange not specified';
        console.error(error);
        return new Promise((resolve, reject) => {
          reject(error);
        });
      },
      async getStrategyPlotConfig(): Promise<PlotConfig | undefined> {
        try {
          const payload = {};
          if (this.isWebserverMode) {
            if (!this.strategy?.strategy) {
              return Promise.reject({ data: 'No strategy selected' });
            }
            payload['strategy'] = this.strategy.strategy;
          }

          const { data: plotConfig } = await api.get<Partial<PlotConfig>>('/plot_config', {
            params: { ...payload },
          });
          const finalPlotConfig: PlotConfig = {
            subplots: {},
            main_plot: {},
            ...plotConfig,
          };
          return Promise.resolve(finalPlotConfig);
        } catch (data) {
          console.error(data);
          return Promise.reject(data);
        }
      },
      async getStrategyList() {
        try {
          const { data } = await api.get<StrategyListResult>('/strategies');
          this.strategyList = data.strategies;
          return Promise.resolve(data);
        } catch (error) {
          console.error(error);
          return Promise.reject(error);
        }
      },
      async getStrategy(strategy: string) {
        try {
          const { data } = await api.get<StrategyResult>(`/strategy/${strategy}`, {});
          this.strategy = data;
          return Promise.resolve(data);
        } catch (error) {
          console.error(error);
          const detail = getApiErrorDetail(error);
          showAlert(detail || 'Error fetching strategy', 'warn');
          return Promise.reject(error);
        }
      },
      async getCurrentStrategy() {
        if (this.botFeatures.strategyParameters && this.isTrading && this.botState?.strategy) {
          return this.getStrategy(this.botState.strategy);
        }
      },
      async getFreqAIModelList() {
        try {
          const { data } = await api.get<FreqAIModelListResult>('/freqaimodels');
          this.freqaiModelList = data.freqaimodels;
          return Promise.resolve(data);
        } catch (error) {
          console.error(error);
          return Promise.reject(error);
        }
      },
      async getExchangeList() {
        try {
          const { data } = await api.get<ExchangeListResult>('/exchanges');
          // A bot that answers without the list (or a proxy answering something else) gives none
          const exchanges = Array.isArray(data?.exchanges) ? data.exchanges : [];
          this.exchangeList = exchanges;
          return Promise.resolve(exchanges);
        } catch (error) {
          console.error(error);
          return Promise.reject(error);
        }
      },
      async getWhitelist() {
        try {
          const { data } = await api.get<WhitelistResponse>('/whitelist');
          this.whitelist = data.whitelist;
          this.pairlistMethods = data.method;
          this.pairlistPipeline = data.pipeline ?? [];
          this.handlerConfigs = data.handler_configs ?? [];
          this.totalMarketPairs = data.total_market_pairs ?? 0;
          this.addedPairs = data.added_pairs ?? [];
          return Promise.resolve(data);
        } catch (error) {
          return Promise.reject(error);
        }
      },
      async getBlacklist() {
        try {
          const { data } = await api.get<BlacklistResponse>('/blacklist');
          this.blacklist = data.blacklist;
          return Promise.resolve(data);
        } catch (error) {
          return Promise.reject(error);
        }
      },
      async getProfit() {
        try {
          if (this.botFeatures.hasProfitAll) {
            const { data } = await api.get<AllProfitStats>('/profit_all');
            this.profitAll = data;
            return Promise.resolve(data);
          }
          // Fallback to old profit endpoint
          const { data } = await api.get<ProfitStats>('/profit');
          if (!this.profitAll) {
            this.profitAll = {} as AllProfitStats;
          }
          this.profitAll['all'] = data;
          return Promise.resolve(data);
        } catch (error) {
          return Promise.reject(error);
        }
      },
      async getBalance() {
        try {
          const { data } = await api.get('/balance');
          this.balance = data;
          return Promise.resolve(data);
        } catch (error) {
          return Promise.reject(error);
        }
      },
      async updateWalletChange() {
        if (!this.botFeatures.walletChange) {
          return;
        }
        try {
          const { data } = await api.get<WalletHistory>('/historic_balance');
          this.balanceHistory = data;
          this.balanceHistory['botName'] = this.botName;
        } catch (err) {
          console.error(err);
        }
      },
      async getState() {
        try {
          const { data } = await api.get<BotState>('/show_config');
          this.botState = data;
          this.botStatusAvailable = true;
          // The only moment the local botId and the bot's own bot_name meet. Remembered so
          // the fleet snapshot can be joined on a later page load, before this request has
          // answered. See stores/botNameRegistry.
          rememberBotName(botId, data.bot_name as string | undefined);
          this.startWebSocket();
          if (this.isWebserverMode) {
            const { recoverBgJobs } = useBackgroundJob();
            recoverBgJobs(api, showAlert).then();
          }
          return Promise.resolve(data);
        } catch (error) {
          return Promise.reject(error);
        }
      },
      async getPairlists() {
        try {
          const { data } = await api.get<PairlistsResponse>('/pairlists/available');
          return Promise.resolve(data);
        } catch (error) {
          console.error(error);
          return Promise.reject(error);
        }
      },
      async evaluatePairlist(payload: PairlistsPayload) {
        try {
          const { data } = await api.post<PairlistsPayload, AxiosResponse<BgTaskStarted>>(
            '/pairlists/evaluate',
            payload,
          );
          return Promise.resolve(data);
        } catch (error) {
          console.error(error);
          return Promise.reject(error);
        }
      },
      async getPairlistEvalResult(jobId: string) {
        try {
          const { data } = await api.get<PairlistEvalResponse>(`/pairlists/evaluate/${jobId}`);
          return Promise.resolve(data);
        } catch (error) {
          console.error(error);
          return Promise.reject(error);
        }
      },
      async getBackgroundJobStatus(jobId: string) {
        try {
          const { data } = await api.get<BackgroundTaskStatus>(`/background/${jobId}`);
          return Promise.resolve(data);
        } catch (error) {
          console.error(error);
          return Promise.reject(error);
        }
      },
      async startDataDownload(payload: DownloadDataPayload) {
        try {
          const { data } = await api.post<DownloadDataPayload, AxiosResponse<BgTaskStarted>>(
            '/download_data',
            payload,
          );
          const { startBgJob } = useBackgroundJob();
          startBgJob(api, showAlert, data.job_id, 'download_data');
          return Promise.resolve(data);
        } catch (error) {
          console.error(error);
          return Promise.reject(error);
        }
      },
      async stopBot() {
        showAlert('Stopping bot...', 'info');
        try {
          const res = await api.post<Record<string, never>, AxiosResponse<StatusResponse>>(
            '/stop',
            {},
          );
          showAlert(res.data.status, 'success');
          return Promise.resolve(res);
        } catch (error) {
          const detail = getApiErrorDetail(error);
          showAlert(`Error stopping bot: ${detail}`, 'error');
          return Promise.reject(error);
        }
      },
      async reloadConfig() {
        showAlert('Reloading configuration...', 'info');
        this.isBotStarting = true;
        try {
          const res = await api.post<Record<string, never>, AxiosResponse<StatusResponse>>(
            '/reload_config',
            {},
          );
          showAlert(res.data.status, 'success');
          return Promise.resolve(res);
        } catch (error) {
          this.isBotStarting = false;
          const detail = getApiErrorDetail(error);
          showAlert(`Error reloading config: ${detail}`, 'error');
          return Promise.reject(error);
        }
      },
      async deleteTrade(tradeid: string) {
        showAlert(`Deleting trade ${tradeid}...`, 'info');
        try {
          const res = await api.delete<DeleteTradeResponse>(`/trades/${tradeid}`);
          showAlert(
            res.data.result_msg ? res.data.result_msg : `Deleted Trade ${tradeid}`,
            'success',
          );
          return Promise.resolve(res);
        } catch (error) {
          const detail = getApiErrorDetail(error);
          showAlert(`Failed to delete trade ${tradeid}: ${detail}`, 'error');
          return Promise.reject(error);
        }
      },
      async cancelOpenOrder(tradeid: string) {
        showAlert(`Canceling open order for trade ${tradeid}...`, 'info');
        try {
          const res = await api.delete<DeleteTradeResponse>(`/trades/${tradeid}/open-order`);
          showAlert(
            res.data.result_msg ? res.data.result_msg : `Canceled open order for ${tradeid}`,
            'success',
          );
          return Promise.resolve(res);
        } catch (error) {
          const detail = getApiErrorDetail(error);
          showAlert(`Failed to cancel open order ${tradeid}: ${detail}`, 'error');
          return Promise.reject(error);
        }
      },
      async reloadTrade(tradeid: string) {
        showAlert(`Reloading trade ${tradeid}...`, 'info');
        try {
          const res = await api.post<never, AxiosResponse<Trade>>(`/trades/${tradeid}/reload`);
          showAlert(`Trade ${tradeid} reloaded`, 'success');
          return Promise.resolve(res);
        } catch (error) {
          const detail = getApiErrorDetail(error);
          showAlert(`Failed to reload trade ${tradeid}: ${detail}`, 'error');
          return Promise.reject(error);
        }
      },
      async forceexit(payload: ForceExitPayload) {
        showAlert(`Creating exit order for trade ${payload.tradeid}...`, 'info');
        try {
          const res = await api.post<ForceExitPayload, AxiosResponse<StatusResponse>>(
            '/forcesell',
            payload,
          );
          showAlert(`Exit order for ${payload.tradeid} created`, 'success');
          return Promise.resolve(res);
        } catch (error) {
          const detail = getApiErrorDetail(error);
          showAlert(`Failed to create exit order for ${payload.tradeid}: ${detail}`, 'error');
          return Promise.reject(error);
        }
      },
      async forceentry(payload: ForceEnterPayload) {
        if (payload && payload.pair) {
          showAlert(`Creating entry order for ${payload.pair}...`, 'info');
          try {
            // TODO: Update forcebuy to forceenter ...
            const res = await api.post<
              ForceEnterPayload,
              AxiosResponse<StatusResponse | TradeResponse>
            >('/forcebuy', payload);
            showAlert(`Order for ${payload.pair} created.`, 'success');

            return Promise.resolve(res);
          } catch (error) {
            const detail = getApiErrorDetail(error);
            showAlert(`Error entering ${payload.pair}: ${detail}`, 'error');
            return Promise.reject(error);
          }
        }
        // Error branchs
        const error = 'Pair is empty';
        console.error(error);
        return Promise.reject(error);
      },
      async startBacktest(payload: BacktestPayload) {
        try {
          const result = await api.post<BacktestPayload, AxiosResponse<BacktestStatus>>(
            '/backtest',
            payload,
          );
          this.updateBacktestRunning(result.data);
        } catch (err) {
          console.log(err);
        }
      },
      async pollBacktest() {
        const { data } = await api.get<BacktestStatus>('/backtest');

        this.updateBacktestRunning(data);
        if (data.running === false && data.backtest_result) {
          this.updateBacktestResult(data.backtest_result);
        }
        if (data.status === 'error') {
          showAlert(`Backtest failed: ${data.status_msg}.`, 'error');
        }
      },
      async removeBacktest() {
        this.backtestHistory = {};
        try {
          const { data } = await api.delete<BacktestStatus>('/backtest');
          this.updateBacktestRunning(data);
          return Promise.resolve(data);
        } catch (err) {
          return Promise.reject(err);
        }
      },
      updateBacktestRunning(backtestStatus: BacktestStatus) {
        this.backtestRunning = backtestStatus.running;
        this.backtestProgress = backtestStatus.progress;
        this.backtestStep = backtestStatus.step;
        this.backtestTradeCount = backtestStatus.trade_count || 0;
      },
      async stopBacktest() {
        try {
          const { data } = await api.get<BacktestStatus>('/backtest/abort');
          this.updateBacktestRunning(data);
          return Promise.resolve(data);
        } catch (err) {
          return Promise.reject(err);
        }
      },
      async getBacktestHistory() {
        const { data } = await api.get<BacktestHistoryEntry[]>('/backtest/history');
        this.backtestHistoryList = data;
      },
      updateBacktestResult(backtestResult: BacktestResult) {
        Object.entries(backtestResult.strategy).forEach(([key, strat]) => {
          const existingMetadata = backtestResult.metadata[key];
          if (!existingMetadata) {
            console.warn(`No metadata found for strategy ${key}`);
            return;
          }
          const metadata: BacktestMetadataWithStrategyName = {
            ...existingMetadata,
            strategyName: key,
            notes: backtestResult.metadata[key]?.notes ?? ``,
            editing: false,
          };
          // console.log(key, strat, metadata);

          // Never versions will always have run_id
          const stratKey =
            existingMetadata.run_id ??
            `${key}_${strat.total_trades}_${strat.profit_total.toFixed(3)}`;
          const btResult: BacktestResultInMemory = {
            metadata,
            strategy: strat,
          };
          // this.backtestHistory[stratKey] = strat;
          this.backtestHistory = { ...this.backtestHistory, ...{ [stratKey]: btResult } };
          this.selectedBacktestResultKey = stratKey;
        });
      },
      async getBacktestHistoryResult(payload: BacktestHistoryEntry) {
        const result = await api.get<BacktestStatus>('/backtest/history/result', {
          params: { filename: payload.filename, strategy: payload.strategy },
        });
        if (result.data.backtest_result) {
          this.updateBacktestResult(result.data.backtest_result);
        }
      },
      async deleteBacktestHistoryResult(btHistoryEntry: BacktestHistoryEntry) {
        try {
          const { data } = await api.delete<BacktestHistoryEntry[]>(
            `/backtest/history/${btHistoryEntry.filename}`,
          );
          this.backtestHistoryList = data;
        } catch (err) {
          console.error(err);
          return Promise.reject(err);
        }
      },
      async getBacktestMarketChange() {
        if (!this.selectedBacktestMetadata?.filename) {
          return Promise.reject('No backtest selected');
        }
        try {
          const { data } = await api.get<BacktestMarketChange>(
            `/backtest/history/${this.selectedBacktestMetadata.filename}/market_change`,
          );
          return data;
        } catch (err) {
          console.error(err);
          return Promise.reject(err);
        }
      },
      async getBacktestWalletChange(): Promise<WalletHistoryPerBot> {
        if (!this.botFeatures.walletChange) {
          return Promise.reject('Backtest wallet change not available');
        }
        if (!this.selectedBacktestMetadata?.filename) {
          return Promise.reject('No backtest selected');
        }
        try {
          const { data } = await api.get<WalletHistory>(
            `/backtest/history/${this.selectedBacktestMetadata.filename}/${this.selectedBacktestMetadata.strategyName}/wallet`,
          );
          data['botName'] = `${this.selectedBacktestMetadata.strategyName} (Backtest)`;
          return {
            [data['botName']]: data,
          };
        } catch (err) {
          console.error(err);
          return Promise.reject(err);
        }
      },
      async saveBacktestResultMetadata(payload: BacktestResultUpdate) {
        try {
          const { data } = await api.patch<
            BacktestMetadataPatch,
            AxiosResponse<BacktestHistoryEntry[]>
          >(`/backtest/history/${payload.filename}`, payload);
          console.log(data);
          data.forEach((entry) => {
            const existingEntry = this.backtestHistory[entry.run_id];
            if (existingEntry) {
              existingEntry.metadata.notes = entry.notes;
              console.log('updating ...');
            }
          });
          // Update metadata in backtestHistoryList
        } catch (err) {
          console.error(err);
          return Promise.reject(err);
        }
      },
      setBacktestResultKey(key: string) {
        this.selectedBacktestResultKey = key;
      },
      removeBacktestResultFromMemory(key: string) {
        if (this.selectedBacktestResultKey === key) {
          // Get first key from backtestHistory that is not the key to be deleted
          const keys = Object.keys(this.backtestHistory);
          const index = keys.findIndex((k) => k !== key);
          if (index !== -1) {
            this.selectedBacktestResultKey = keys[index]!;
          }
        }
        delete this.backtestHistory[key];
      },
      async getFleetSnapshot(maxAgeS = 0) {
        // One request describing every bot in the fleet, served from the shared daemon
        // (see docs/fleet-snapshot.md). Any bot can answer it, so a client needs only one
        // reachable bot instead of one request per bot per datum.
        const { data } = await api.get<FleetSnapshotResponse>('/fleet/snapshot', {
          params: maxAgeS ? { max_age_s: maxAgeS } : {},
        });
        return data;
      },
      async getRateMetrics(window = 3600, bucket_s = 10) {
        // Four independent dashboard widgets poll this, each on its own timer, each
        // fanning out across every bot — the same figures fetched four times over.
        // Coalescing here rather than forcing a shared cadence keeps each widget's
        // own refresh rate intact: a caller still gets data no older than the most
        // demanding consumer asked for, it just stops being fetched more than once.
        const key = `${botId}:${window}:${bucket_s}`;
        const cached = rateMetricsCache.get(key);
        if (cached && Date.now() - cached.ts < RATE_METRICS_COALESCE_MS) {
          return cached.promise;
        }
        const promise = api
          .get<RateMetricsResponse>('/rate_metrics', { params: { window, bucket_s } })
          .then((r) => r.data)
          .catch((err) => {
            // A failure must not be cached: the next widget should retry, not inherit
            // the error for the whole window.
            rateMetricsCache.delete(key);
            throw err;
          });
        rateMetricsCache.set(key, { ts: Date.now(), promise });
        return promise;
      },
      async getVolumeHistory(days = 90, bucket = '1d') {
        try {
          const { data } = await api.get<VolumeHistoryResponse>('/volume_history', {
            params: { days, bucket },
          });
          this.volumeHistory = data;
          return Promise.resolve(data);
        } catch (err) {
          return Promise.reject(err);
        }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _handleWebsocketMessage(ws, event: MessageEvent<any>) {
        const msg: FTWsMessage = JSON.parse(event.data);
        switch (msg.type) {
          case FtWsMessageTypes.exception:
            if (typeof msg.data === 'string' && msg.data.includes('not in the correct state')) {
              this.isBotStarting = true;
            } else {
              showAlert(`WSException: ${msg.data}`, 'error');
            }
            break;
          case FtWsMessageTypes.whitelist:
            this.whitelist = msg.data;
            break;
          case FtWsMessageTypes.entryFill:
          case FtWsMessageTypes.exitFill:
          case FtWsMessageTypes.exitCancel:
          case FtWsMessageTypes.entryCancel:
            // Stay quiet while a dry-run replay is seeding this bot: the dashboard is
            // in "replay" mode (greyed metrics + indicator) and these events would be
            // confusing replay/live churn, not live activity to notify about.
            if (!useReplayStore().statusByBot[botId]?.running) {
              showNotification(msg, botName);
            }
            break;
          case FtWsMessageTypes.newCandle: {
            const [pair, timeframe] = msg.data;
            // TODO: check for active bot ...
            if (this.plotMultiPairs.length > 0 && this.plotMultiPairs.includes(pair)) {
              // Reload pair candles
              const plotStore = usePlotConfigStore();
              this.getPairCandles({ pair, timeframe, columns: plotStore.usedColumns });
            }
            break;
          }
          default:
            // Unhandled events ...
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            console.log(`Received event ${(msg as any).type}`);
            break;
        }
      },
      startWebSocket() {
        if (
          // Not on a gateway page: a `/show_config` answered after the user left a legacy tool
          // must not open the bot's own socket
          !legacyPollingAllowed() ||
          this.websocketStarted === true ||
          wsClose !== null ||
          this.botStatusAvailable === false ||
          !this.botFeatures.websocketConnection ||
          this.isWebserverMode === true
        ) {
          return;
        }
        const { send, close } = useWebSocket(
          // 'ws://localhost:8080/api/v1/message/ws?token=testtoken',
          `${loginInfo.baseWsUrl.value}/message/ws?token=${loginInfo.accessToken.value}`,
          {
            autoReconnect: {
              delay: 10000,
              // retries: 10
            },
            // heartbeat: {
            //   message: JSON.stringify({ type: 'ping' }),
            //   interval: 10000,
            // },
            onError: (ws, event) => {
              console.log('onError', event, ws);
              this.websocketStarted = false;
              wsClose = null;
              close();
            },
            onMessage: this._handleWebsocketMessage,
            onConnected: () => {
              console.log('subscribing');
              if (this.isWebserverMode !== true) {
                //
                this.websocketStarted = true;
                const subscriptions = [
                  FtWsMessageTypes.whitelist,
                  FtWsMessageTypes.entryFill,
                  FtWsMessageTypes.exitFill,
                  FtWsMessageTypes.entryCancel,
                  FtWsMessageTypes.exitCancel,
                  /*'new_candle' /*'analyzed_df'*/
                ];
                if (this.botFeatures.websocketNewCandle) {
                  subscriptions.push(FtWsMessageTypes.newCandle);
                }

                send(
                  JSON.stringify({
                    type: 'subscribe',
                    data: subscriptions,
                  }),
                );
                send(
                  JSON.stringify({
                    type: FtWsMessageTypes.whitelist,
                    data: '',
                  }),
                );
              }
            },
          },
        );
        wsClose = close;
      },
      /** Close the bot socket for good (no reconnect); `startWebSocket` opens a fresh one. */
      stopWebSocket() {
        if (wsClose === null) return;
        wsClose();
        wsClose = null;
        this.websocketStarted = false;
      },
    },
  });

  if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useBotStore, import.meta.hot));
  }

  return useBotStore();
}
