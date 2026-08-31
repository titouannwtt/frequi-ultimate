<script setup lang="ts">
// Fleet-wide closed history is fetched on demand (see composables/useClosedTradesFeed):
// this widget reduces over every selected bot's trades, so it declares that need while
// it is mounted and releases it when it scrolls out of view.
useClosedTradesFeed();

import type { EChartsOption } from 'echarts';
import ECharts from 'vue-echarts';

import { BarChart, LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  MarkLineComponent,
} from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

import type { ClosedTrade, Trade } from '@/types';
import { useI18n } from 'vue-i18n';
import { useSummaryCurrency } from '@/composables/summaryCurrency';
import { useExchangeRates } from '@/composables/exchangeRates';
import {
  fetchBenchmarkHistory,
  normalizeToPercent,
  BENCHMARK_TICKERS,
  BENCHMARK_CATEGORIES,
  type PricePoint,
} from '@/utils/benchmarkData';

use([
  BarChart,
  LineChart,
  CanvasRenderer,
  DatasetComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  MarkLineComponent,
]);

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    trades: ClosedTrade[];
    openTrades?: Trade[];
    showTitle?: boolean;
  }>(),
  {
    openTrades: () => [],
    showTitle: false,
  },
);

import { useWidgetDefaults } from '@/composables/useWidgetDefaults';
import { DashboardLayout } from '@/stores/layout';
import { useTradingModeFilter } from '@/composables/useTradingModeFilter';

const botStore = useBotStore();
const settingsStore = useSettingsStore();
const colorStore = useColorStore();
const { summaryCurrency } = useSummaryCurrency();
const { convert } = useExchangeRates();
const { tradingMode, hasMultipleModes, filterTradesByMode, restorePersistedTradingMode } =
  useTradingModeFilter('profitBenchmark');

// Debounce the multi-bot trade inputs. With ~30 bots, /status responses arrive
// staggered on each refresh cycle and each one mutates openTrades, which would
// otherwise rebuild this whole ECharts option up to ~30x per cycle. Coalesce into
// a single rebuild — a sub-second chart lag is invisible, the CPU saving is large.
const debouncedTrades = refDebounced(
  computed(() => props.trades),
  500,
  { maxWait: 2000 },
);
const debouncedOpenTrades = refDebounced(
  computed(() => props.openTrades ?? []),
  500,
  { maxWait: 2000 },
);
const modeFilteredTrades = computed(() => filterTradesByMode(debouncedTrades.value));
const modeFilteredOpenTrades = computed(() => filterTradesByMode(debouncedOpenTrades.value));

const chart = ref<InstanceType<typeof ECharts>>();

// --- State ---
type TabKey = 'combined' | 'perBot';
type TimeframeKey = '1D' | '7D' | '30D' | '90D' | 'YTD' | 'ALL';
type ValueModeKey = 'pct' | 'abs';

const activeTab = ref<TabKey>('combined');
const selectedTimeframe = ref<TimeframeKey>('ALL');
const normMode = ref<'pctFromStart'>('pctFromStart');
const valueMode = ref<ValueModeKey>('pct');

const valueModeOptions = computed(() => [
  { key: 'pct' as ValueModeKey, label: '%' },
  { key: 'abs' as ValueModeKey, label: stakeCurrencyLabel.value },
]);

const stakeCurrencyLabel = computed(() => {
  const bots = botStore.selectedBots;
  if (bots.length > 0) {
    return bots[0]?.stakeCurrency || 'USDT';
  }
  return 'USDT';
});

const activeChartData = computed<CumPoint[]>(() => {
  return valueMode.value === 'abs' ? cumulativeData.value : normalizedData.value;
});

// --- Benchmark management ---
const BENCHMARKS_STORAGE_KEY = 'ft_benchmarks_enabled';
const enabledBenchmarks = ref<string[]>(loadBenchmarksFromStorage());
const showBenchmarkDropdown = ref(false);
const customBenchmarkInput = ref('');
const customBenchmarkError = ref('');
const benchmarkLoading = ref(false);

function loadBenchmarksFromStorage(): string[] {
  try {
    const stored = localStorage.getItem(BENCHMARKS_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    /* ignore */
  }
  return ['BTC']; // BTC on by default
}

function saveBenchmarksToStorage() {
  localStorage.setItem(BENCHMARKS_STORAGE_KEY, JSON.stringify(enabledBenchmarks.value));
}

const HARDCODED_DEFAULTS_BENCH = {
  showLatent: false as boolean,
  showRealized: true as boolean,
  showDrawdown: true as boolean,
  activeTab: 'combined' as string,
  selectedTimeframe: 'ALL' as string,
  enabledBenchmarks: ['BTC'] as string[],
  tradingMode: 'all' as string,
  valueMode: 'pct' as string,
};

const { filtersChanged, saveCurrentAsDefault, loadDefaults } = useWidgetDefaults(
  DashboardLayout.dailyChart,
  () => ({
    showLatent: showLatent.value,
    showRealized: showRealized.value,
    showDrawdown: showDrawdown.value,
    activeTab: activeTab.value,
    selectedTimeframe: selectedTimeframe.value,
    enabledBenchmarks: [...enabledBenchmarks.value],
    tradingMode: tradingMode.value,
    valueMode: valueMode.value,
  }),
  (d) => {
    if (d.showLatent !== undefined) showLatent.value = d.showLatent as boolean;
    if (d.showRealized !== undefined) showRealized.value = d.showRealized as boolean;
    if (d.showDrawdown !== undefined) showDrawdown.value = d.showDrawdown as boolean;
    if (d.activeTab !== undefined) activeTab.value = d.activeTab as TabKey;
    if (d.selectedTimeframe !== undefined)
      selectedTimeframe.value = d.selectedTimeframe as TimeframeKey;
    if (d.enabledBenchmarks) {
      enabledBenchmarks.value = [...(d.enabledBenchmarks as string[])];
      saveBenchmarksToStorage();
    }
    if (d.tradingMode !== undefined) tradingMode.value = d.tradingMode as typeof tradingMode.value;
    if (d.valueMode !== undefined) valueMode.value = d.valueMode as ValueModeKey;
  },
  HARDCODED_DEFAULTS_BENCH,
);

onMounted(() => {
  loadDefaults();
  restorePersistedTradingMode();
});

defineExpose({ filtersChanged, saveCurrentAsDefault });

function toggleBenchmark(ticker: string) {
  const idx = enabledBenchmarks.value.indexOf(ticker);
  if (idx >= 0) {
    enabledBenchmarks.value.splice(idx, 1);
  } else {
    enabledBenchmarks.value.push(ticker);
  }
  saveBenchmarksToStorage();
}

async function addCustomBenchmark() {
  const val = customBenchmarkInput.value.trim();
  if (!val) return;
  customBenchmarkError.value = '';
  const upper = val.toUpperCase();
  if (enabledBenchmarks.value.includes(upper)) {
    customBenchmarkInput.value = '';
    return;
  }
  // Validate by fetching a small amount of data
  benchmarkLoading.value = true;
  try {
    const result = await fetchBenchmarkHistory(val, 1);
    if (result.error === 'not_found' || result.data.length === 0) {
      customBenchmarkError.value = t('profitBenchmark.customNotFound');
      return;
    }
    enabledBenchmarks.value.push(upper);
    saveBenchmarksToStorage();
    customBenchmarkInput.value = '';
    customBenchmarkError.value = '';
  } catch {
    customBenchmarkError.value = t('profitBenchmark.customNotFound');
  } finally {
    benchmarkLoading.value = false;
  }
}

function removeBenchmark(ticker: string) {
  const idx = enabledBenchmarks.value.indexOf(ticker);
  if (idx >= 0) {
    enabledBenchmarks.value.splice(idx, 1);
    saveBenchmarksToStorage();
  }
}

const BENCHMARK_COLORS: Record<string, string> = {
  BTC: '#f7931a',
  ETH: '#627eea',
  SOL: '#9945ff',
  BNB: '#f0b90b',
  DOGE: '#c2a633',
  HYPE: '#00d4aa',
};

function getBenchmarkColor(ticker: string): string {
  return BENCHMARK_COLORS[ticker] ?? `hsl(${(ticker.charCodeAt(0) * 37) % 360}, 60%, 55%)`;
}

// --- Tabs, timeframes ---
const tabs: { key: TabKey; labelKey: string }[] = [
  { key: 'combined', labelKey: 'profitBenchmark.tabCombined' },
  { key: 'perBot', labelKey: 'profitBenchmark.tabPerBot' },
];

const timeframes: TimeframeKey[] = ['1D', '7D', '30D', '90D', 'YTD', 'ALL'];

// Bot color palette
const BOT_COLORS = [
  '#6366f1',
  '#f59e0b',
  '#10b981',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#f97316',
  '#ec4899',
  '#14b8a6',
  '#84cc16',
];

function getBotColor(index: number): string {
  return BOT_COLORS[index % BOT_COLORS.length] ?? '#6366f1';
}

// --- Timeframe filtering ---
function getTimeframeCutoff(tf: TimeframeKey): number {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  switch (tf) {
    case '1D':
      return now - 1 * day;
    case '7D':
      return now - 7 * day;
    case '30D':
      return now - 30 * day;
    case '90D':
      return now - 90 * day;
    case 'YTD': {
      const d = new Date();
      return new Date(d.getFullYear(), 0, 1).getTime();
    }
    case 'ALL':
    default:
      return 0;
  }
}

function timeframeToDays(tf: TimeframeKey): number {
  switch (tf) {
    case '1D':
      return 1;
    case '7D':
      return 7;
    case '30D':
      return 30;
    case '90D':
      return 90;
    case 'YTD':
      return Math.ceil(
        (Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000,
      );
    case 'ALL':
      return 365;
  }
}

// --- Compute unique bot IDs ---
/**
 * Les bots à interroger pour la courbe latente.
 *
 * ⚠️ Dérivé des trades CLOS **et OUVERTS**, jamais des seuls clos. L'historique
 * clos est désormais chargé à la demande : au montage il est vide, donc un
 * `botIds` construit sur lui seul rendait un tableau vide, `loadLatentHistories`
 * n'interrogeait aucun bot et la courbe de profit latent DISPARAISSAIT (régression
 * constatée en production le 2026-08-31, « le profit latent n'est plus affiché »).
 *
 * Les trades ouverts, eux, arrivent avec `/status` et ne sont jamais paresseux :
 * ils suffisent à découvrir immédiatement les bots qui portent effectivement du
 * latent. Les autres s'ajoutent dès que leur historique clos arrive, et le `watch`
 * sur `botIds` relance alors le chargement.
 *
 * On garde le passage par les trades plutôt que `botStore.selectedBots` pour ne pas
 * perdre le filtre par mode de trading, qui s'applique aux trades et non aux bots.
 */
const botIds = computed<string[]>(() => {
  const ids = new Set<string>();
  modeFilteredTrades.value.forEach((tr) => ids.add(tr.botId));
  modeFilteredOpenTrades.value.forEach((tr) => ids.add(tr.botId));
  return Array.from(ids);
});

const botNameMap = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  modeFilteredTrades.value.forEach((tr) => {
    if (!map[tr.botId]) {
      map[tr.botId] = tr.botName || tr.botId;
    }
  });
  return map;
});

/** Map botId -> stake_currency for currency conversion */
const botStakeCurrencyMap = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const bot of botStore.selectedBots) {
    map[bot.botId] = bot.stakeCurrency || 'USDT';
  }
  return map;
});

/** Convert a profit amount from a bot's stake currency to the selected summary currency */
function convertProfit(amount: number, botId: string): number {
  const targetCurrency = summaryCurrency.value;
  if (!targetCurrency || targetCurrency === 'auto') return amount;
  const fromCurrency = botStakeCurrencyMap.value[botId];
  if (!fromCurrency || fromCurrency.toUpperCase() === targetCurrency.toUpperCase()) return amount;
  const converted = convert(amount, fromCurrency, targetCurrency);
  return converted ?? amount;
}

// --- Starting balance per bot ---
const startingBalancePerBot = computed<Record<string, number>>(() => {
  const result: Record<string, number> = {};
  for (const bot of botStore.selectedBots) {
    // `balance.total` is the WHOLE exchange wallet. On a shared/netted account
    // (all our Hyperliquid bots trade one wallet) every bot reports the same
    // figure, so summing it across the selected bots multiplied the wallet by
    // the number of bots — the denominator exploded and every percentage
    // (normalized curves AND the drawdown %) came out absurdly small.
    // `starting_capital` is the bot's own allocation (config available_capital);
    // fall back to the bot-managed balance, then to the raw wallet.
    const bal = bot.balance;
    const profit = bot.profit;
    const alloc = bal?.starting_capital;
    if (alloc && alloc > 0) {
      result[bot.botId] = alloc;
      continue;
    }
    if (profit && profit.bot_start_timestamp) {
      const base = bal?.total_bot ?? bal?.total ?? 0;
      result[bot.botId] = Math.max(base - (profit.profit_all_coin ?? 0), 1);
    } else {
      result[bot.botId] = 1;
    }
  }
  return result;
});

const totalStartingBalance = computed<number>(() => {
  return Object.values(startingBalancePerBot.value).reduce((a, b) => a + b, 0) || 1;
});

// --- Latent (unrealized) profit curve -----------------------------------------
// Blue overlay on the combined tab: the bot's sampled current profit
// (closed + open unrealized) from the fork's profit_history series.
const SHOW_LATENT_STORAGE_KEY = 'ft_benchmark_show_latent';
const showLatent = ref<boolean>(localStorage.getItem(SHOW_LATENT_STORAGE_KEY) === 'true');
// Realized-profit curve and drawdown annotation are independently toggleable so the
// user can isolate exactly what they want to read.
const showRealized = ref<boolean>(localStorage.getItem('ft_benchmark_show_realized') !== 'false');
const showDrawdown = ref<boolean>(localStorage.getItem('ft_benchmark_show_dd') !== 'false');
watch(showRealized, (v) => {
  try {
    localStorage.setItem('ft_benchmark_show_realized', String(v));
  } catch {
    /* ignore */
  }
});
watch(showDrawdown, (v) => {
  try {
    localStorage.setItem('ft_benchmark_show_dd', String(v));
  } catch {
    /* ignore */
  }
});
watch(showLatent, (v) => {
  try {
    localStorage.setItem(SHOW_LATENT_STORAGE_KEY, String(v));
  } catch {
    /* ignore */
  }
  if (v) loadLatentHistories();
});

const latentHistories = ref<Record<string, [number, number, number, number][]>>({});
async function loadLatentHistories() {
  const res: Record<string, [number, number, number, number][]> = {};
  await Promise.all(
    botIds.value.map(async (id) => {
      const h = await botStore.botStores[id]?.getProfitHistory?.();
      if (h?.data?.length) res[id] = h.data;
    }),
  );
  latentHistories.value = res;
}
onMounted(() => {
  if (showLatent.value) loadLatentHistories();
});
watch(
  () => botIds.value.join(','),
  () => {
    if (showLatent.value) loadLatentHistories();
  },
);

// Merged current-profit series across the mode-filtered bots: forward-filled from zero
// over the full window, converted to the summary currency, clipped to the selected
// timeframe, and normalized in % mode.
//
// NOTE: this deliberately DIFFERS from BotMaxDrawdownCard, which still merges from the
// first common sample. A cumulative profit curve is correct starting at zero — a bot
// that did not exist contributed nothing. A drawdown curve is not: an artificially low
// start fabricates a trough and anchors the max-drawdown marker on the zero line. Same
// data, opposite trade-off; do not "harmonise" the two.
/** Latent (closed+open) curve in STAKE CURRENCY, rebased on the selected window. */
const latentAbs = computed<{ t: number; v: number }[]>(() => {
  if (!showLatent.value) return [];
  const entries = Object.entries(latentHistories.value).filter(([id]) => botIds.value.includes(id));
  if (!entries.length) return [];
  const cutoff = getTimeframeCutoff(selectedTimeframe.value);

  // Clip to the selected timeframe FIRST, then rebase each bot's realized
  // component on its first in-window sample. profit_closed_abs is the bot's
  // lifetime realized total, while the green curve restarts from 0 at the
  // window start — without this rebase the latent curve floats far above the
  // realized one on any timeframe shorter than the bot's history.
  const perBot = entries
    .map(([id, rows]) => {
      const inWin = rows.filter((r) => r[0] >= cutoff);
      if (!inWin.length) return null;
      const baseline = inWin[0]![1];
      return {
        id,
        rows: inWin.map((r) => [r[0], r[1] - baseline, r[2]] as [number, number, number]),
      };
    })
    .filter((e): e is { id: string; rows: [number, number, number][] } => e !== null);
  if (!perBot.length) return [];

  let merged: { t: number; v: number }[];
  if (perBot.length === 1) {
    const only = perBot[0]!;
    merged = only.rows.map((r) => ({ t: r[0], v: convertProfit(r[1] + r[2], only.id) }));
  } else {
    // Merge over the FULL window: a bot contributes 0 until its first sample, which is
    // what it really contributed — it did not exist yet. `last` starts at 0, so the
    // forward-fill below already gives that for free.
    //
    // This used to start at the newest first-sample across bots (max), to avoid a step
    // when a late bot joined the sum. But profit_history restarts at zero whenever a bot
    // is (re)deployed, so ONE young bot truncated the curve for ALL the others: on
    // 2026-08-27, seven bots redeployed on 08-22 capped a 33-day history at 4 days.
    // Hiding 29 days of history to avoid one honest step is the worse trade.
    const seriesList = perBot.map((e) => e.rows);
    const ids = perBot.map((e) => e.id);
    const allTs = [...new Set(seriesList.flatMap((sr) => sr.map((r) => r[0])))].sort(
      (a, b) => a - b,
    );
    const idx = seriesList.map(() => 0);
    const last = seriesList.map(() => 0);
    merged = allTs.map((t_) => {
      seriesList.forEach((sr, i) => {
        while (idx[i]! < sr.length && sr[idx[i]!]![0] <= t_) {
          last[i] = convertProfit(sr[idx[i]!]![1] + sr[idx[i]!]![2], ids[i]!);
          idx[i]!++;
        }
      });
      return { t: t_, v: last.reduce((a, b) => a + b, 0) };
    });
  }
  if (!merged.length) return [];

  // Anchor on the realized curve: its value when the latent series starts. Inside a
  // window that is ~0; on ALL it carries the profit made before profit_history
  // existed, so the blue curve continues the green one instead of dropping to 0.
  const firstT = merged[0]!.t;
  let offset = 0;
  for (const pt of cumulativeData.value) {
    if (pt.date <= firstT) offset = pt.combined;
    else break;
  }

  return merged.map((pt) => ({ t: pt.t, v: pt.v + offset }));
});

/** Same curve converted to the widget's display unit (% of starting balance or currency). */
const latentSeriesData = computed<[number, number][]>(() => {
  const bal = totalStartingBalance.value;
  return latentAbs.value.map((pt) =>
    valueMode.value === 'pct' ? [pt.t, (pt.v / bal) * 100] : [pt.t, pt.v],
  );
});

const BAND_UP = 'rgba(16, 185, 129, 0.22)';
const BAND_DOWN = 'rgba(239, 68, 68, 0.22)';

/**
 * Latent vs realized band: for each latent sample, the realized curve's value at
 * that instant (step function of closed trades). Rendered as two stacked
 * base+delta pairs so the filled zone is green when the open book is in profit
 * and red when it is underwater — far more readable than a bare extra line.
 */
const latentBand = computed(() => {
  const lat = latentSeriesData.value;
  const real = activeChartData.value;
  if (!showLatent.value || lat.length < 2 || real.length === 0) return null;
  const upBase: ([number, number] | [number, null])[] = [];
  const upDelta: ([number, number] | [number, null])[] = [];
  const dnBase: ([number, number] | [number, null])[] = [];
  const dnDelta: ([number, number] | [number, null])[] = [];
  let j = 0;
  let rv = real[0]!.combined;
  for (const [t_, lv] of lat) {
    while (j < real.length && real[j]!.date <= t_) {
      rv = real[j]!.combined;
      j++;
    }
    if (lv >= rv) {
      upBase.push([t_, rv]);
      upDelta.push([t_, lv - rv]);
      dnBase.push([t_, null]);
      dnDelta.push([t_, null]);
    } else {
      dnBase.push([t_, lv]);
      dnDelta.push([t_, rv - lv]);
      upBase.push([t_, null]);
      upDelta.push([t_, null]);
    }
  }
  return { upBase, upDelta, dnBase, dnDelta };
});

/** Max drawdown of a monotonic-in-time value series. */
function ddOf(src: { t: number; v: number }[]) {
  if (src.length < 2) return null;
  let peak = src[0]!.v;
  let peakT = src[0]!.t;
  let bestPeak = peak;
  let bestPeakT = peakT;
  let bestTrough = peak;
  let bestTroughT = peakT;
  let best = 0;
  for (const pt of src) {
    if (pt.v > peak) {
      peak = pt.v;
      peakT = pt.t;
    }
    if (peak - pt.v > best) {
      best = peak - pt.v;
      bestPeak = peak;
      bestPeakT = peakT;
      bestTrough = pt.v;
      bestTroughT = pt.t;
    }
  }
  if (best <= 0) return null;
  return {
    depthAbs: best,
    peakT: bestPeakT,
    troughT: bestTroughT,
    peakV: bestPeak,
    troughV: bestTrough,
  };
}

/**
 * Max drawdown WITHIN the selected period. Measured independently on EVERY
 * visible curve and the deepest one wins: the latent series only exists since
 * profit_history was deployed, so on longer windows the realized curve often
 * holds the real worst drawdown and must not be ignored.
 */
const periodDrawdown = computed(() => {
  const candidates: { dd: ReturnType<typeof ddOf>; onLatent: boolean }[] = [];
  if (showRealized.value) {
    candidates.push({
      dd: ddOf(cumulativeData.value.map((p) => ({ t: p.date, v: p.combined }))),
      onLatent: false,
    });
  }
  if (showLatent.value) {
    candidates.push({ dd: ddOf(latentAbs.value), onLatent: true });
  }
  const valid = candidates.filter((c) => c.dd !== null);
  if (!valid.length) return null;
  const best = valid.reduce((a, b) => (b.dd!.depthAbs > a.dd!.depthAbs ? b : a));
  const peakEquity = totalStartingBalance.value + best.dd!.peakV;
  return {
    ...best.dd!,
    depthPct: peakEquity > 0 ? (best.dd!.depthAbs / peakEquity) * 100 : 0,
    onLatent: best.onLatent,
  };
});

/** Running high-water mark of each curve, used by the tooltip. */
function runningPeaks(src: { t: number; v: number }[]) {
  let p = -Infinity;
  return src.map((pt) => {
    p = Math.max(p, pt.v);
    return { t: pt.t, peak: p };
  });
}
const realizedPeaks = computed(() =>
  runningPeaks(cumulativeData.value.map((p) => ({ t: p.date, v: p.combined }))),
);
const latentPeaks = computed(() => runningPeaks(latentAbs.value));
function peakAt(arr: { t: number; peak: number }[], t: number): number | null {
  if (!arr.length) return null;
  let lo = 0;
  let hi = arr.length - 1;
  let res: number | null = null;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (arr[m]!.t <= t) {
      res = arr[m]!.peak;
      lo = m + 1;
    } else hi = m - 1;
  }
  return res;
}

/** Drawdown endpoints converted to the chart's display unit. */
function toDisplay(v: number): number {
  return valueMode.value === 'pct' ? (v / totalStartingBalance.value) * 100 : v;
}
const LATENT_COLOR = '#3b82f6';

// --- Filtered + sorted trades ---
const filteredTrades = computed(() => {
  const cutoff = getTimeframeCutoff(selectedTimeframe.value);
  return modeFilteredTrades.value
    .filter((tr) => tr.close_timestamp && tr.close_timestamp >= cutoff)
    .slice()
    .sort((a, b) => a.close_timestamp - b.close_timestamp);
});

// --- Open profit per bot ---
const openProfitPerBot = computed<Record<string, number>>(() => {
  const result: Record<string, number> = {};
  modeFilteredOpenTrades.value.forEach((tr) => {
    const rawP = tr.total_profit_abs ?? tr.profit_abs ?? 0;
    const p = convertProfit(rawP, tr.botId);
    result[tr.botId] = (result[tr.botId] ?? 0) + p;
  });
  return result;
});

// --- Build cumulative data ---
interface CumPoint {
  date: number;
  combined: number;
  [botId: string]: number;
}

const cumulativeData = computed<CumPoint[]>(() => {
  const trades = filteredTrades.value;
  if (trades.length === 0) return [];

  const cumPerBot: Record<string, number> = {};
  botIds.value.forEach((id) => {
    cumPerBot[id] = 0;
  });
  let cumTotal = 0;

  const points: CumPoint[] = [];

  const firstTrade = trades[0];
  if (firstTrade) {
    const zeroPoint: CumPoint = { date: firstTrade.open_timestamp, combined: 0 };
    botIds.value.forEach((id) => {
      zeroPoint[id] = 0;
    });
    points.push(zeroPoint);
  }

  for (const trade of trades) {
    const rawProfit = trade.profit_abs ?? 0;
    const profitAbs = convertProfit(rawProfit, trade.botId);
    cumTotal += profitAbs;
    cumPerBot[trade.botId] = (cumPerBot[trade.botId] ?? 0) + profitAbs;

    const point: CumPoint = { date: trade.close_timestamp, combined: cumTotal };
    botIds.value.forEach((id) => {
      point[id] = cumPerBot[id] ?? 0;
    });
    points.push(point);
  }

  return points;
});

// --- Normalized data (always % from start) ---
const normalizedData = computed<CumPoint[]>(() => {
  const raw = cumulativeData.value;
  if (raw.length === 0) return [];

  const startBal = totalStartingBalance.value;
  const perBotBal = startingBalancePerBot.value;

  return raw.map((p) => {
    const pct: CumPoint = {
      date: p.date,
      combined: (p.combined / startBal) * 100,
    };
    botIds.value.forEach((id) => {
      const bal = perBotBal[id] ?? 1;
      pct[id] = ((p[id] ?? 0) / bal) * 100;
    });
    return pct;
  });
});

// --- Benchmark data ---
const benchmarkRawData = ref<Record<string, PricePoint[]>>({});

async function loadBenchmarks() {
  const days = timeframeToDays(selectedTimeframe.value);
  const toFetch = enabledBenchmarks.value.filter((t) => t.length > 0);
  if (toFetch.length === 0) {
    benchmarkRawData.value = {};
    return;
  }

  benchmarkLoading.value = true;
  try {
    const results = await Promise.all(toFetch.map((ticker) => fetchBenchmarkHistory(ticker, days)));
    const newData: Record<string, PricePoint[]> = {};
    const cutoff = getTimeframeCutoff(selectedTimeframe.value);
    toFetch.forEach((ticker, i) => {
      const fetchResult = results[i];
      let data = fetchResult?.data ?? [];
      // Filter benchmark data to match the selected timeframe cutoff
      // This ensures proper alignment even when CoinGecko returns extra data points
      if (cutoff > 0 && data.length > 0) {
        data = data.filter((p) => p.timestamp >= cutoff);
      }
      newData[ticker] = data;
    });
    benchmarkRawData.value = newData;
  } finally {
    benchmarkLoading.value = false;
  }
}

watch(
  [enabledBenchmarks, selectedTimeframe],
  () => {
    loadBenchmarks();
  },
  { immediate: true, deep: true },
);

/**
 * Benchmark data normalized based on current normMode:
 * - pctFromStart / pctFromCapital: % change from start (for direct comparison)
 * - absolute: USD price change from start (rebased to 0, on 2nd y-axis)
 */
const benchmarkNormalized = computed<Record<string, PricePoint[]>>(() => {
  const result: Record<string, PricePoint[]> = {};
  for (const [ticker, data] of Object.entries(benchmarkRawData.value)) {
    if (data.length === 0) continue;
    result[ticker] = normalizeToPercent(data);
  }
  return result;
});

// --- Statistics ---
interface PeriodStats {
  periodReturn: number;
  periodReturnPct: number;
  vsBTC: number | null;
  sharpe: number | null;
  maxDrawdown: number | null;
  maxDrawdownPct: number | null;
  winRate: number | null;
}

const periodStats = computed<PeriodStats>(() => {
  const trades = filteredTrades.value;
  const totalProfit = trades.reduce((s, tr) => s + convertProfit(tr.profit_abs ?? 0, tr.botId), 0);
  const pctReturn = (totalProfit / totalStartingBalance.value) * 100;

  // vs BTC
  let vsBTC: number | null = null;
  const btcNorm = benchmarkNormalized.value['BTC'];
  if (btcNorm && btcNorm.length >= 2) {
    const btcReturn = btcNorm[btcNorm.length - 1]!.price;
    vsBTC = pctReturn - btcReturn;
  }

  // Aggregate metrics from bots
  let totalWins = 0;
  let totalTrades = 0;
  let weightedSharpe = 0;
  let maxDD = 0;
  let maxDDPct = 0;
  let botCount = 0;

  for (const bot of botStore.selectedBots) {
    const profit = bot.profit;
    if (!profit) continue;
    botCount++;
    totalWins += profit.winning_trades ?? 0;
    totalTrades += profit.trade_count ?? 0;
    weightedSharpe += profit.sharpe ?? 0;
    if ((profit.max_drawdown_abs ?? 0) > maxDD) maxDD = profit.max_drawdown_abs ?? 0;
    if ((profit.max_drawdown ?? 0) > maxDDPct) maxDDPct = profit.max_drawdown ?? 0;
  }

  return {
    periodReturn: totalProfit,
    periodReturnPct: pctReturn,
    vsBTC,
    sharpe: botCount > 0 ? weightedSharpe / botCount : null,
    maxDrawdown: maxDD > 0 ? maxDD : null,
    maxDrawdownPct: maxDDPct > 0 ? maxDDPct : null,
    winRate: totalTrades > 0 ? (totalWins / totalTrades) * 100 : null,
  };
});

// --- Chart series builders ---
function buildCombinedSeries(): any[] {
  const series: any[] = [];

  if (showRealized.value)
    series.push({
      type: 'line',
      name: t('profitBenchmark.combined'),
      smooth: true,
      symbol: 'none',
      // Above the latent curve (z: 6): realized profit is the headline series, and the
      // latent band would otherwise hide it wherever the two run close together.
      // Drawdown markers stay on top regardless — same z, but pushed later in the array.
      z: 7,
      lineStyle: { width: 2.5, color: colorStore.colorProfit },
      itemStyle: { color: colorStore.colorProfit },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: colorStore.colorProfit + '40' },
            { offset: 1, color: colorStore.colorProfit + '05' },
          ],
        },
      },
      encode: { x: 'date', y: 'combined' },
      animationDuration: 1500,
      animationEasing: 'cubicOut',
    });

  // Latent (closed + open unrealized) sampled curve — blue overlay + signed band
  if (showLatent.value && latentSeriesData.value.length >= 2) {
    const band = showRealized.value ? latentBand.value : null;
    if (band) {
      const mkBase = (name: string, data: unknown[], stack: string) => ({
        type: 'line',
        name,
        stack,
        symbol: 'none',
        silent: true,
        z: 1,
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        emphasis: { disabled: true },
        data,
        animation: false,
      });
      const mkFill = (name: string, data: unknown[], stack: string, color: string) => ({
        type: 'line',
        name,
        stack,
        symbol: 'none',
        silent: true,
        z: 1,
        lineStyle: { opacity: 0 },
        areaStyle: { color },
        emphasis: { disabled: true },
        data,
        animation: false,
      });
      series.push(mkBase('__bandUpBase', band.upBase, '__bandUp'));
      series.push(mkFill('__bandUpFill', band.upDelta, '__bandUp', BAND_UP));
      series.push(mkBase('__bandDownBase', band.dnBase, '__bandDown'));
      series.push(mkFill('__bandDownFill', band.dnDelta, '__bandDown', BAND_DOWN));
    }
    series.push({
      type: 'line',
      name: t('profitBenchmark.latentCurve'),
      smooth: true,
      symbol: 'none',
      z: 6,
      lineStyle: {
        width: 1.4,
        color: LATENT_COLOR,
        shadowBlur: 6,
        shadowColor: 'rgba(59,130,246,0.55)',
      },
      itemStyle: { color: LATENT_COLOR },
      data: latentSeriesData.value,
      animationDuration: 1200,
      animationEasing: 'cubicOut',
    });
  }

  // Max drawdown of the selected period, annotated on the curve it was measured on
  const ddp = showDrawdown.value ? periodDrawdown.value : null;
  if (ddp) {
    const label = `▼ ${ddp.depthPct.toFixed(1)}%  ·  -${formatPrice(ddp.depthAbs, 2)} ${stakeCurrencyLabel.value}`;
    // Keep the label inside the plot and off the curves: anchor it on the side
    // with the most free space (below a trough sitting high, above a trough
    // sitting low, and flipped inward near the horizontal edges).
    const vals: number[] = [];
    if (showRealized.value) for (const pnt of activeChartData.value) vals.push(pnt.combined);
    if (showLatent.value) for (const pr of latentSeriesData.value) vals.push(pr[1]);
    const vMin = vals.length ? Math.min(...vals) : 0;
    const vMax = vals.length ? Math.max(...vals) : 1;
    const troughDisp = toDisplay(ddp.troughV);
    const vRatio = vMax > vMin ? (troughDisp - vMin) / (vMax - vMin) : 0.5;
    const xs = activeChartData.value.length
      ? [
          activeChartData.value[0]!.date,
          activeChartData.value[activeChartData.value.length - 1]!.date,
        ]
      : [ddp.troughT, ddp.troughT];
    const xSpan = xs[1]! - xs[0]! || 1;
    const xRatio = (ddp.troughT - xs[0]!) / xSpan;
    let labelPos: string;
    if (xRatio > 0.82) labelPos = 'left';
    else if (xRatio < 0.12) labelPos = 'right';
    else labelPos = vRatio < 0.4 ? 'top' : 'bottom';
    series.push({
      type: 'line',
      name: '__ddMarks',
      data: [],
      silent: true,
      z: 7,
      markArea: {
        silent: true,
        itemStyle: { color: 'rgba(239, 68, 68, 0.10)' },
        data: [[{ xAxis: ddp.peakT }, { xAxis: ddp.troughT }]],
      },
      markPoint: {
        silent: true,
        symbol: 'circle',
        symbolSize: 7,
        itemStyle: { color: '#ef4444', borderColor: '#fff', borderWidth: 1 },
        label: {
          show: true,
          position: labelPos,
          distance: 10,
          formatter: label,
          color: '#f87171',
          fontSize: 10,
          fontWeight: 'bold',
          backgroundColor: 'rgba(15,15,25,0.85)',
          padding: [3, 6],
          borderRadius: 4,
        },
        data: [{ coord: [ddp.troughT, toDisplay(ddp.troughV)] }],
      },
    });
  }

  // Open trades projection
  const data = activeChartData.value;
  if (modeFilteredOpenTrades.value.length > 0 && data.length > 0) {
    const lastPoint = data[data.length - 1]!;
    const totalOpen = Object.values(openProfitPerBot.value).reduce((s, v) => s + v, 0);
    const projectedValue =
      valueMode.value === 'abs'
        ? lastPoint.combined + totalOpen
        : lastPoint.combined + (totalOpen / totalStartingBalance.value) * 100;

    // When the latent curve is shown it already carries the open book, so the
    // projection continues IT (same colour) instead of jumping off the realized
    // curve — otherwise two segments claim the same endpoint from two origins.
    const lat = latentSeriesData.value;
    const useLatentOrigin = showLatent.value && lat.length >= 2;
    const origin = useLatentOrigin
      ? (lat[lat.length - 1] as [number, number])
      : ([lastPoint.date, lastPoint.combined] as [number, number]);
    const projColor = useLatentOrigin
      ? LATENT_COLOR
      : totalOpen >= 0
        ? colorStore.colorProfit
        : colorStore.colorLoss;
    series.push({
      type: 'line',
      name: t('profitBenchmark.projected'),
      symbol: 'none',
      z: 6,
      lineStyle: { width: 1.6, type: 'dashed', color: projColor },
      itemStyle: { color: projColor },
      data: [origin, [Date.now() + 12 * 60 * 60 * 1000, projectedValue]],
    });
  }

  return series;
}

function buildPerBotSeries(): any[] {
  return botIds.value.map((botId, idx) => ({
    type: 'line',
    name: botNameMap.value[botId] ?? botId,
    smooth: true,
    symbol: 'none',
    lineStyle: { width: 2, color: getBotColor(idx) },
    itemStyle: { color: getBotColor(idx) },
    encode: { x: 'date', y: botId },
  }));
}

/**
 * Build benchmark series.
 *
 * CRITICAL LOGIC:
 * - In "% from start" and "% from capital" modes:
 *   Benchmarks are on the SAME y-axis as profit (both in %).
 *   My profit = cumulative_profit / starting_capital * 100 (starts at 0%)
 *   BTC = (btc_price_now / btc_price_start - 1) * 100 (starts at 0%)
 *   => Direct comparison on same axis.
 *
 * - In "absolute" mode:
 *   Benchmarks use a SECOND y-axis showing % price change.
 *   This lets you see the shape but scales are different.
 */
function buildBenchmarkSeries(): any[] {
  const series: any[] = [];

  for (const ticker of enabledBenchmarks.value) {
    const data = benchmarkNormalized.value[ticker];
    if (!data || data.length === 0) continue;

    const color = getBenchmarkColor(ticker);
    series.push({
      type: 'line',
      name: ticker,
      smooth: true,
      symbol: 'none',
      animationDuration: 1500,
      animationEasing: 'cubicOut',
      animationDurationUpdate: 500,
      lineStyle: { width: 1.8, color, type: 'dotted' },
      itemStyle: { color },
      data: data.map((p) => [p.timestamp, p.price]),
    });
  }

  return series;
}

// --- Chart options ---
// Preserve the user's dataZoom window across option rebuilds: chartOptions is a
// computed that re-emits on every data tick, and hardcoded start/end values were
// snapping the slider back to the full range each time the user resized it.
const zoomStart = ref(0);
const zoomEnd = ref(100);
function onDataZoom(evt: unknown) {
  const e = evt as { start?: number; end?: number; batch?: { start?: number; end?: number }[] };
  const d = e?.batch?.[0] ?? e;
  if (typeof d?.start === 'number') zoomStart.value = d.start;
  if (typeof d?.end === 'number') zoomEnd.value = d.end;
}
// A new timeframe/tab changes the x-domain entirely — showing the full range again
// is the expected behaviour there.
watch([selectedTimeframe, activeTab], () => {
  zoomStart.value = 0;
  zoomEnd.value = 100;
});

const chartOptions = computed<EChartsOption>(() => {
  const activeBenchmarks = enabledBenchmarks.value.filter(
    (t) => benchmarkNormalized.value[t] && benchmarkNormalized.value[t].length > 0,
  );

  const tabSeries = activeTab.value === 'perBot' ? buildPerBotSeries() : buildCombinedSeries();

  const benchmarkSeries = buildBenchmarkSeries();
  const allSeries = [...tabSeries, ...benchmarkSeries];

  // Legend data
  const legendData: string[] = [];
  if (activeTab.value === 'perBot') {
    botIds.value.forEach((id) => legendData.push(botNameMap.value[id] ?? id));
  } else {
    if (showRealized.value) legendData.push(t('profitBenchmark.combined'));
    if (showLatent.value && latentSeriesData.value.length >= 2) {
      legendData.push(t('profitBenchmark.latentCurve'));
    }

    if (modeFilteredOpenTrades.value.length > 0 && activeTab.value === 'combined') {
      legendData.push(t('profitBenchmark.projected'));
    }
  }
  for (const ticker of activeBenchmarks) {
    legendData.push(ticker);
  }

  const isAbsMode = valueMode.value === 'abs';
  const yAxes: any[] = [
    {
      type: 'value',
      name: isAbsMode ? stakeCurrencyLabel.value : t('profitBenchmark.profitPct'),
      nameTextStyle: { color: settingsStore.isDarkTheme ? '#808098' : '#555', fontSize: 10 },
      splitLine: { show: true, lineStyle: { color: 'rgba(100, 100, 140, 0.08)', type: 'dashed' } },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: settingsStore.isDarkTheme ? '#808098' : '#555',
        fontSize: 10,
        formatter: isAbsMode
          ? (value: number) => formatPrice(value, 2)
          : (value: number) => `${value.toFixed(1)}%`,
      },
      nameRotate: 90,
      nameLocation: 'middle',
      nameGap: isAbsMode ? 55 : 45,
    },
  ];

  const dims = ['date', 'combined', ...botIds.value];

  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    dataset: {
      dimensions: dims,
      source: activeChartData.value,
    },
    animationDuration: 1500,
    animationEasing: 'cubicOut',
    animationDurationUpdate: 500,
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
        snap: true,
        crossStyle: { color: '#555' },
        lineStyle: { color: 'rgba(148,163,184,0.55)', width: 1, type: 'dashed' },
        label: { backgroundColor: 'rgba(30,41,59,0.95)', fontSize: 10 },
      },
      backgroundColor: 'rgba(15, 15, 25, 0.92)',
      borderColor: 'rgba(100, 100, 140, 0.3)',
      borderWidth: 1,
      textStyle: { color: '#e0e0e0', fontSize: 12 },
      formatter: (params: any) => {
        if (!params || params.length === 0) return '';
        const date = timestampToDateString(
          params[0].data?.date ?? params[0].data?.[0] ?? params[0].axisValue,
        );
        let html = `<div style="font-size:11px">`;
        html += `<div style="color:#aaa;margin-bottom:4px">${date}</div>`;

        let profitValue: number | null = null;
        let realizedVal: number | null = null;
        let latentVal: number | null = null;
        const benchmarkValues: Record<string, number> = {};
        const hoverTs: number = params[0].data?.date ?? params[0].data?.[0] ?? params[0].axisValue;

        for (const p of params) {
          if (typeof p.seriesName === 'string' && p.seriesName.startsWith('__')) continue;
          let val: number;
          if (Array.isArray(p.value)) {
            val = p.value?.[1] ?? 0;
          } else if (typeof p.value === 'object' && p.value !== null) {
            const yDimIndex = p.encode?.y?.[0];
            const dimName = yDimIndex !== undefined ? p.dimensionNames?.[yDimIndex] : undefined;
            val = dimName ? (p.value[dimName] ?? 0) : (p.value.combined ?? 0);
          } else {
            val = 0;
          }
          const isBenchmark = enabledBenchmarks.value.includes(p.seriesName);
          if (isBenchmark) {
            benchmarkValues[p.seriesName] = val;
          } else if (
            p.seriesName === t('profitBenchmark.combined') ||
            activeTab.value === 'perBot'
          ) {
            if (profitValue === null) profitValue = val;
          }
          if (p.seriesName === t('profitBenchmark.combined')) realizedVal = val;
          if (p.seriesName === t('profitBenchmark.latentCurve')) latentVal = val;
          const formatted =
            isBenchmark || !isAbsMode
              ? `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`
              : `${val >= 0 ? '+' : ''}${formatPrice(val, 2)} ${stakeCurrencyLabel.value}`;
          html +=
            `<div style="display:flex;justify-content:space-between;gap:12px">` +
            `<span>${p.marker} ${p.seriesName}</span>` +
            `<span style="font-weight:600">${formatted}</span></div>`;
        }

        // --- Derived insight rows: open book, distance from high, drawdown ---
        const fmt = (v: number) =>
          isAbsMode
            ? `${v >= 0 ? '+' : ''}${formatPrice(v, 2)} ${stakeCurrencyLabel.value}`
            : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
        const row = (lbl: string, txt: string, color: string) =>
          `<div style="display:flex;justify-content:space-between;gap:12px">` +
          `<span style="color:#9ca3af">${lbl}</span>` +
          `<span style="font-weight:600;color:${color}">${txt}</span></div>`;

        const extras: string[] = [];
        if (realizedVal !== null && latentVal !== null) {
          const openBook = latentVal - realizedVal;
          extras.push(
            row(
              t('profitBenchmark.hoverOpenBook'),
              fmt(openBook),
              openBook >= 0 ? '#34d399' : '#f87171',
            ),
          );
        }
        // Distance from the running high of the curve being read (latent first).
        const peakAbs =
          latentVal !== null
            ? peakAt(latentPeaks.value, hoverTs)
            : peakAt(realizedPeaks.value, hoverTs);
        const curVal = latentVal ?? realizedVal;
        if (peakAbs !== null && curVal !== null) {
          const peakDisp = toDisplay(peakAbs);
          const gap = curVal - peakDisp;
          const startBal = totalStartingBalance.value;
          const peakEquity = startBal + peakAbs;
          const gapAbs = isAbsMode ? gap : (gap / 100) * startBal;
          const gapPct = peakEquity > 0 ? (gapAbs / peakEquity) * 100 : 0;
          extras.push(
            row(
              t('profitBenchmark.hoverFromHigh'),
              gap >= -1e-9
                ? t('profitBenchmark.hoverAtHigh')
                : `${fmt(gap)} (${gapPct.toFixed(2)}%)`,
              gap >= -1e-9 ? '#34d399' : '#fbbf24',
            ),
          );
        }
        if (extras.length) {
          html += `<div style="border-top:1px solid rgba(255,255,255,0.12);margin:5px 0 4px"></div>`;
          html += extras.join('');
        }

        // Show outperformance comparison for each benchmark
        if (profitValue !== null) {
          for (const [ticker, bVal] of Object.entries(benchmarkValues)) {
            const diff = profitValue - bVal;
            const color = diff >= 0 ? '#22c55e' : '#ef4444';
            const word =
              diff >= 0 ? t('profitBenchmark.outperforming') : t('profitBenchmark.underperforming');
            html +=
              `<div style="color:${color};font-weight:bold;margin-top:4px">` +
              `${word} ${ticker} ${t('profitBenchmark.by')} ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%</div>`;
          }
        }

        html += `</div>`;
        return html;
      },
      axisPointer: {
        type: 'cross',
        label: { backgroundColor: 'rgba(30, 30, 50, 0.9)' },
        lineStyle: { color: 'rgba(100, 100, 150, 0.4)', type: 'dashed' },
        crossStyle: { color: 'rgba(100, 100, 150, 0.4)' },
      },
    },
    legend: {
      data: legendData,
      top: 4,
      right: '5%',
      textStyle: { color: settingsStore.isDarkTheme ? '#a0a0b0' : '#555', fontSize: 11 },
      icon: 'roundRect',
      itemWidth: 14,
      itemHeight: 8,
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: 'rgba(100, 100, 140, 0.2)' } },
      axisTick: { lineStyle: { color: 'rgba(100, 100, 140, 0.2)' } },
      axisLabel: { color: settingsStore.isDarkTheme ? '#808098' : '#555', fontSize: 10 },
      splitLine: { show: true, lineStyle: { color: 'rgba(100, 100, 140, 0.08)', type: 'dashed' } },
    },
    yAxis: yAxes,
    grid: { left: '60', right: '20', top: '35', bottom: '65' },
    dataZoom: [
      { type: 'inside', start: zoomStart.value, end: zoomEnd.value },
      { type: 'slider', start: zoomStart.value, end: zoomEnd.value, height: 20, bottom: 5 },
    ],
    series: allSeries,
  };
});

// --- Chart description ---
const chartDescription = computed(() => {
  const tab = activeTab.value;
  const tf = selectedTimeframe.value;
  const benchmarks = enabledBenchmarks.value;

  let desc =
    tab === 'combined' ? t('profitBenchmark.descCombined') : t('profitBenchmark.descPerBot');
  desc += ` ${t('profitBenchmark.descOverPeriod', { period: tf })}`;
  desc += `, ${t('profitBenchmark.descNormPctStart')}`;

  if (benchmarks.length > 0) {
    desc += `. ${t('profitBenchmark.descBenchmarks', { list: benchmarks.join(', ') })}`;
    desc += ` ${t('profitBenchmark.descBenchmarkHint')}`;
  }

  return desc;
});

// --- CSV export ---
function exportCSV() {
  const data = normalizedData.value;
  if (data.length === 0) return;

  const headers = ['Date', 'Combined'];
  botIds.value.forEach((id) => headers.push(botNameMap.value[id] ?? id));

  const rows = data.map((p) => {
    const row = [new Date(p.date).toISOString(), p.combined.toFixed(4)];
    botIds.value.forEach((id) => row.push((p[id] ?? 0).toFixed(4)));
    return row.join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `profit_benchmark_${selectedTimeframe.value}_${normMode.value}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// --- PNG export via ECharts getDataURL ---
function exportChartImage() {
  const echart = chart.value?.chart ?? chart.value;
  if (echart && typeof echart.getDataURL === 'function') {
    const url = echart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#1a1a2e' });
    const a = document.createElement('a');
    a.href = url;
    a.download = `profit_benchmark_${selectedTimeframe.value}_${normMode.value}.png`;
    a.click();
  }
}

// Watch for theme changes
watch(
  () => settingsStore.chartTheme,
  () => {
    /* force re-render via computed */
  },
);
</script>

<template>
  <div class="flex flex-col h-full w-full profit-benchmark">
    <!-- Controls bar -->
    <div class="flex flex-wrap items-center gap-2 px-1 pb-1 controls-bar">
      <!-- Tab pills -->
      <div class="flex gap-0.5">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all duration-150 cursor-pointer"
          :class="
            activeTab === tab.key
              ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5'
          "
          @click="activeTab = tab.key"
        >
          {{ t(tab.labelKey) }}
        </button>
      </div>

      <div class="w-px h-4 bg-gray-300 dark:bg-gray-600/30"></div>

      <!-- Timeframe pills -->
      <div class="flex gap-0.5 tf-pills">
        <button
          v-for="tf in timeframes"
          :key="tf"
          class="px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all duration-150 cursor-pointer"
          :class="
            selectedTimeframe === tf
              ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5'
          "
          @click="selectedTimeframe = tf"
        >
          {{ tf }}
        </button>
      </div>

      <div class="w-px h-4 bg-gray-300 dark:bg-gray-600/30"></div>

      <!-- Value mode toggle (% / abs) -->
      <div class="flex gap-0.5">
        <button
          v-for="vm in valueModeOptions"
          :key="vm.key"
          class="px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all duration-150 cursor-pointer"
          :class="
            valueMode === vm.key
              ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5'
          "
          @click="valueMode = vm.key"
        >
          {{ vm.label }}
        </button>
      </div>

      <TradingModeSelect v-model="tradingMode" :show="hasMultipleModes" />

      <!-- Curve toggles (combined tab): realized / latent / drawdown -->
      <div
        v-if="activeTab === 'combined'"
        class="flex items-center gap-2.5 pl-1 border-l border-gray-300 dark:border-gray-600/30"
      >
        <label
          class="flex items-center gap-1 text-[10px] font-semibold cursor-pointer select-none text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
          :title="t('profitBenchmark.toggleRealizedHint')"
        >
          <input v-model="showRealized" type="checkbox" class="accent-emerald-500 cursor-pointer" />
          <span
            class="inline-block w-2.5 h-0.5 rounded"
            :style="{ background: colorStore.colorProfit }"
          ></span>
          {{ t('profitBenchmark.combined') }}
        </label>
        <label
          class="flex items-center gap-1 text-[10px] font-semibold cursor-pointer select-none text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
          :title="t('profitBenchmark.latentCurveHint')"
        >
          <input v-model="showLatent" type="checkbox" class="accent-blue-500 cursor-pointer" />
          <span class="inline-block w-2.5 h-0.5 rounded" style="background: #3b82f6"></span>
          {{ t('profitBenchmark.latentToggle') }}
        </label>
        <label
          class="flex items-center gap-1 text-[10px] font-semibold cursor-pointer select-none text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
          :title="t('profitBenchmark.periodDDHint')"
        >
          <input v-model="showDrawdown" type="checkbox" class="accent-red-500 cursor-pointer" />
          <span
            class="inline-block w-2.5 h-2 rounded-sm"
            style="background: rgba(239, 68, 68, 0.45)"
          ></span>
          {{ t('profitBenchmark.periodDD') }}
        </label>
      </div>

      <div class="flex-1"></div>

      <!-- Benchmark toggles -->
      <div class="flex gap-1 items-center relative">
        <template v-for="ticker in enabledBenchmarks" :key="ticker">
          <button
            class="px-1.5 py-0.5 text-[10px] font-semibold rounded-md transition-all duration-150 cursor-pointer ring-1"
            :style="{
              backgroundColor: getBenchmarkColor(ticker) + '20',
              color: getBenchmarkColor(ticker),
              borderColor: getBenchmarkColor(ticker) + '40',
              '--tw-ring-color': getBenchmarkColor(ticker) + '40',
            }"
            :title="t('profitBenchmark.removeBenchmark', { coin: ticker })"
            @click="removeBenchmark(ticker)"
          >
            {{ ticker }}
            <span class="ml-0.5 opacity-60">x</span>
          </button>
        </template>

        <!-- Add benchmark button -->
        <div class="relative">
          <button
            class="px-1.5 py-0.5 text-[10px] font-semibold rounded-md transition-all duration-150 cursor-pointer text-gray-600 dark:text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 border border-dashed border-gray-300 dark:border-gray-600/30"
            :title="t('profitBenchmark.addBenchmark')"
            @click="showBenchmarkDropdown = !showBenchmarkDropdown"
          >
            +
          </button>

          <!-- Dropdown -->
          <div
            v-if="showBenchmarkDropdown"
            class="absolute right-0 top-full mt-1 z-50 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600/50 rounded-lg shadow-xl p-2 min-w-[160px]"
          >
            <div class="max-h-[300px] overflow-y-auto">
              <template v-for="cat in BENCHMARK_CATEGORIES" :key="cat.label">
                <div
                  class="text-[9px] text-gray-600 dark:text-gray-500 uppercase tracking-wide font-semibold mt-1.5 mb-0.5 px-1"
                >
                  {{ cat.label }}
                </div>
                <template v-for="ticker in cat.tickers" :key="ticker">
                  <button
                    class="flex items-center gap-2 w-full px-2 py-0.5 text-[10px] rounded cursor-pointer transition-colors"
                    :class="
                      enabledBenchmarks.includes(ticker)
                        ? 'text-gray-900 dark:text-white bg-black/10 dark:bg-white/10'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-gray-200'
                    "
                    @click="toggleBenchmark(ticker)"
                  >
                    <span
                      class="w-2 h-2 rounded-full flex-shrink-0"
                      :style="{
                        backgroundColor: enabledBenchmarks.includes(ticker)
                          ? getBenchmarkColor(ticker)
                          : '#6b7280',
                      }"
                    ></span>
                    {{ ticker }}
                    <span
                      v-if="enabledBenchmarks.includes(ticker)"
                      class="ml-auto text-[8px] text-green-400"
                      >ON</span
                    >
                  </button>
                </template>
              </template>
            </div>
            <div class="border-t border-gray-300 dark:border-gray-600/30 mt-1.5 pt-1.5">
              <div class="text-[9px] text-gray-600 dark:text-gray-500 px-1 mb-1">
                {{ t('profitBenchmark.customCoinGecko') }}
              </div>
              <form class="flex gap-1" @submit.prevent="addCustomBenchmark">
                <input
                  v-model="customBenchmarkInput"
                  type="text"
                  class="flex-1 px-1.5 py-0.5 text-[10px] bg-gray-200 dark:bg-gray-700 border border-gray-300 dark:border-gray-600/50 rounded text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
                  :class="{ 'border-red-500/60': customBenchmarkError }"
                  :placeholder="t('profitBenchmark.customPlaceholder')"
                  @input="customBenchmarkError = ''"
                />
                <button
                  type="submit"
                  class="px-1.5 py-0.5 text-[10px] bg-indigo-500/20 text-indigo-300 rounded hover:bg-indigo-500/30 cursor-pointer"
                  :disabled="benchmarkLoading"
                >
                  {{ benchmarkLoading ? '...' : t('profitBenchmark.add') }}
                </button>
              </form>
              <div v-if="customBenchmarkError" class="text-[9px] text-red-400 px-1 mt-1">
                {{ customBenchmarkError }}
              </div>
            </div>
          </div>
        </div>

        <span
          v-if="benchmarkLoading"
          class="text-[9px] text-gray-600 dark:text-gray-500 ml-1 animate-pulse"
          >...</span
        >
      </div>

      <div class="w-px h-4 bg-gray-300 dark:bg-gray-600/30"></div>

      <!-- Export PNG -->
      <button
        class="px-1.5 py-0.5 text-[10px] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 rounded transition-all cursor-pointer"
        :title="t('profitBenchmark.exportPNG')"
        @click="exportChartImage"
      >
        <i-mdi-image class="inline w-3.5 h-3.5" />
      </button>
    </div>

    <!-- Stats strip -->
    <div class="flex flex-wrap gap-3 px-2 py-1 text-[10px] period-stats">
      <div class="flex items-center gap-1">
        <span class="text-gray-600 dark:text-gray-500" v-tooltip.top="t('tooltips.periodReturn')">{{
          t('profitBenchmark.periodReturn')
        }}</span>
        <span
          :class="periodStats.periodReturn >= 0 ? 'text-emerald-400' : 'text-red-400'"
          class="font-semibold"
        >
          {{ formatPrice(periodStats.periodReturn, 2) }}
          <span class="text-gray-600 dark:text-gray-500 font-normal"
            >({{ periodStats.periodReturnPct >= 0 ? '+' : ''
            }}{{ periodStats.periodReturnPct.toFixed(2) }}%)</span
          >
        </span>
      </div>
      <div v-if="periodStats.vsBTC !== null" class="flex items-center gap-1">
        <span class="text-gray-600 dark:text-gray-500">{{ t('profitBenchmark.vsBTC') }}</span>
        <span
          :class="(periodStats.vsBTC ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'"
          class="font-semibold"
        >
          {{ (periodStats.vsBTC ?? 0) >= 0 ? '+' : '' }}{{ (periodStats.vsBTC ?? 0).toFixed(2) }}%
        </span>
      </div>
      <div v-if="periodStats.sharpe !== null" class="flex items-center gap-1">
        <span
          class="text-gray-600 dark:text-gray-500 uppercase tracking-wide"
          v-tooltip.top="t('tooltips.sharpe')"
          >{{ t('profitBenchmark.sharpe') }}</span
        >
        <span
          class="font-bold"
          :class="
            (periodStats.sharpe ?? 0) >= 1
              ? 'text-emerald-400'
              : (periodStats.sharpe ?? 0) >= 0
                ? 'text-amber-400'
                : 'text-red-400'
          "
        >
          {{ (periodStats.sharpe ?? 0).toFixed(2) }}
        </span>
      </div>
      <div v-if="periodStats.maxDrawdownPct !== null" class="flex items-center gap-1">
        <span class="text-gray-600 dark:text-gray-500 uppercase tracking-wide">{{
          t('profitBenchmark.maxDD')
        }}</span>
        <span class="font-bold text-red-400">
          {{ ((periodStats.maxDrawdownPct ?? 0) * 100).toFixed(1) }}%
        </span>
      </div>
      <div v-if="periodDrawdown" class="flex items-center gap-1">
        <span
          class="text-gray-600 dark:text-gray-500 uppercase tracking-wide"
          :title="t('profitBenchmark.periodDDHint')"
          >{{ t('profitBenchmark.periodDD') }}</span
        >
        <span class="font-bold text-red-400">
          -{{ (periodDrawdown?.depthPct ?? 0).toFixed(1) }}%
        </span>
        <span class="text-gray-500 dark:text-gray-400">
          (-{{ formatPrice(periodDrawdown?.depthAbs ?? 0, 2) }} {{ stakeCurrencyLabel }})
        </span>
        <span v-if="periodDrawdown?.onLatent" class="text-[9px] text-blue-400 font-semibold"
          >· {{ t('profitBenchmark.latentToggle') }}</span
        >
      </div>
      <div v-if="periodStats.winRate !== null" class="flex items-center gap-1">
        <span
          class="text-gray-600 dark:text-gray-500 uppercase tracking-wide"
          v-tooltip.top="t('tooltips.winrate')"
          >{{ t('profitBenchmark.winRate') }}</span
        >
        <span
          class="font-bold"
          :class="
            (periodStats.winRate ?? 0) >= 60
              ? 'text-emerald-400'
              : (periodStats.winRate ?? 0) >= 50
                ? 'text-amber-400'
                : 'text-red-400'
          "
        >
          {{ (periodStats.winRate ?? 0).toFixed(1) }}%
        </span>
      </div>
    </div>

    <!-- Chart -->
    <div class="flex-1 min-h-0">
      <ECharts
        v-if="activeChartData.length > 0"
        ref="chart"
        :option="chartOptions"
        @datazoom="onDataZoom"
        :theme="settingsStore.chartTheme"
        autoresize
        class="w-full h-full"
      />
      <div
        v-else
        class="flex items-center justify-center h-full text-gray-600 dark:text-gray-500 text-sm"
      >
        {{ t('profitBenchmark.noData') }}
      </div>
    </div>

    <!-- Benchmark loading indicator -->
    <div
      v-if="benchmarkLoading && enabledBenchmarks.length > 0"
      class="flex items-center justify-center gap-2 py-1"
    >
      <i-mdi-loading class="animate-spin text-blue-400" style="font-size: 0.8rem" />
      <span class="text-xs text-gray-600 dark:text-gray-400">{{
        t('profitBenchmark.loadingBenchmarks')
      }}</span>
    </div>

    <!-- Description: icon-only with tooltip (no visible text to avoid overlap) -->
    <div class="flex justify-end px-2 flex-shrink-0">
      <span
        v-tooltip.left="{ value: chartDescription, class: 'max-w-sm text-xs' }"
        class="cursor-help opacity-30 hover:opacity-70 transition-opacity"
      >
        <i-mdi-information-outline class="w-3.5 h-3.5 text-blue-400" />
      </span>
    </div>

    <!-- Click-away overlay for dropdown -->
    <div
      v-if="showBenchmarkDropdown"
      class="fixed inset-0 z-40"
      @click="showBenchmarkDropdown = false"
    ></div>
  </div>
</template>

<style scoped>
.profit-benchmark {
  --glass-bg: rgba(15, 15, 25, 0.6);
  --glass-border: rgba(100, 100, 140, 0.15);
}

.controls-bar {
  border-bottom: 1px solid var(--glass-border);
}

.period-stats {
  background: rgba(100, 100, 160, 0.04);
}

.echarts {
  width: 100%;
  height: 100%;
  min-height: 150px;
}
</style>
