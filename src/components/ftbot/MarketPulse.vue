<script setup lang="ts">
import type { ClosedTrade } from '@/types';
import { useI18n } from 'vue-i18n';
import { useSummaryCurrency } from '@/composables/summaryCurrency';
import { useExchangeRates } from '@/composables/exchangeRates';
import { fetchCoinHistory, KNOWN_BENCHMARKS, type PricePoint } from '@/utils/benchmarkData';

/** Backward-compatible wrappers — extract .data from FetchResult */
function fetchBTCHistory(days: number): Promise<PricePoint[]> {
  return fetchCoinHistory('bitcoin', days).then((r) => r.data ?? []);
}
function fetchETHHistory(days: number): Promise<PricePoint[]> {
  return fetchCoinHistory('ethereum', days).then((r) => r.data ?? []);
}
import { ref, computed, onMounted, watch, onUnmounted } from 'vue';
import Popover from 'primevue/popover';

const { t } = useI18n();
const botStore = useBotStore();
const { summaryCurrency } = useSummaryCurrency();
const { convert } = useExchangeRates();

// ── Settings (persisted in localStorage) ──
const SETTINGS_KEY = 'ft_market_overview_settings';

type SlotType = 'crypto' | 'feargreed' | 'btc_dominance';

interface SlotConfig {
  type: SlotType;
  /** CoinGecko coin ID (for type=crypto) */
  coinId?: string;
  /** Ticker label (e.g., "BTC", "SOL") */
  ticker?: string;
}

interface OverviewSettings {
  defaultTimeframe: string;
  showMarket: boolean;
  showPerformance: boolean;
  showVolume: boolean;
  showComparison: boolean;
  /** 3 configurable market indicator slots */
  slots: [SlotConfig, SlotConfig, SlotConfig];
}

const DEFAULT_SLOTS: [SlotConfig, SlotConfig, SlotConfig] = [
  { type: 'crypto', coinId: 'bitcoin', ticker: 'BTC' },
  { type: 'crypto', coinId: 'ethereum', ticker: 'ETH' },
  { type: 'feargreed', ticker: 'F&G' },
];

function loadSettings(): OverviewSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...defaultSettings(), ...parsed, slots: parsed.slots ?? [...DEFAULT_SLOTS] };
    }
  } catch { /* ignore */ }
  return defaultSettings();
}

function defaultSettings(): OverviewSettings {
  return {
    defaultTimeframe: '24h',
    showMarket: true,
    showPerformance: true,
    showVolume: true,
    showComparison: true,
    slots: [...DEFAULT_SLOTS],
  };
}

function saveSettings(s: OverviewSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

const settings = ref<OverviewSettings>(loadSettings());
const showSettingsPanel = ref(false);

// ── Slot configuration UI ──
const editingSlotIdx = ref<number | null>(null);

/** Slot type options for the selector */
const SLOT_OPTIONS: { label: string; type: SlotType; coinId?: string; ticker: string; supportsTimefilter: boolean }[] = [
  // Crypto benchmarks
  ...Object.entries(KNOWN_BENCHMARKS).map(([ticker, coinId]) => ({
    label: ticker, type: 'crypto' as SlotType, coinId, ticker, supportsTimefilter: true,
  })),
  // Macro indicators
  { label: 'Fear & Greed Index', type: 'feargreed', ticker: 'F&G', supportsTimefilter: false },
  { label: 'BTC Dominance', type: 'btc_dominance', ticker: 'BTC.D', supportsTimefilter: false },
];

function setSlot(idx: number, option: typeof SLOT_OPTIONS[number]) {
  settings.value.slots[idx] = {
    type: option.type,
    coinId: option.coinId,
    ticker: option.ticker,
  };
  saveSettings(settings.value);
  editingSlotIdx.value = null;
  // Refresh data for the changed slot
  fetchSlotData(idx);
}

// ── Per-slot reactive data ──
interface SlotData {
  price: number | null;
  change24h: number | null;
  loading: boolean;
  value?: number; // For fear&greed or dominance
  classification?: string;
  supportsTimefilter: boolean;
}

const slotData = ref<SlotData[]>([
  { price: null, change24h: null, loading: true, supportsTimefilter: true },
  { price: null, change24h: null, loading: true, supportsTimefilter: true },
  { price: null, change24h: null, loading: true, supportsTimefilter: true },
]);

async function fetchSlotData(idx: number) {
  const slot = settings.value.slots[idx];
  const sd = slotData.value[idx];
  sd.loading = true;

  const opt = SLOT_OPTIONS.find((o) => o.type === slot.type && o.ticker === slot.ticker);
  sd.supportsTimefilter = opt?.supportsTimefilter ?? true;

  const { days } = getTimeframeRange(selectedTimeframe.value);

  try {
    if (slot.type === 'crypto' && slot.coinId) {
      // Fetch current price
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${slot.coinId}&vs_currencies=usd&include_24hr_change=true`,
        { signal: controller.signal },
      );
      if (resp.ok) {
        const data = await resp.json();
        sd.price = data[slot.coinId]?.usd ?? null;
        // For 24h timeframe, use built-in 24h change
        if (days <= 1) {
          sd.change24h = data[slot.coinId]?.usd_24h_change ?? null;
        }
      }
      // For longer timeframes, compute change from history
      if (days > 1 && slot.coinId) {
        const history = await fetchCoinHistory(slot.coinId, days);
        if (history.data.length >= 2) {
          const startPrice = history.data[0].price;
          const endPrice = history.data[history.data.length - 1].price;
          sd.change24h = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : null;
        }
      }
    } else if (slot.type === 'feargreed') {
      const resp = await fetch('https://api.alternative.me/fng/?limit=1');
      if (resp.ok) {
        const data = await resp.json();
        sd.value = parseInt(data.data?.[0]?.value ?? '0');
        sd.classification = data.data?.[0]?.value_classification ?? '';
      }
    } else if (slot.type === 'btc_dominance') {
      const resp = await fetch('https://api.coingecko.com/api/v3/global');
      if (resp.ok) {
        const data = await resp.json();
        sd.value = data.data?.market_cap_percentage?.btc ?? null;
        sd.classification = 'dominance';
      }
    }
  } catch (err) {
    console.warn(`Failed to fetch slot ${idx} data:`, err);
  } finally {
    sd.loading = false;
  }
}

/** Position the slot dropdown near the slot card (Teleported to body) */
function slotDropdownStyle(idx: number): Record<string, string> {
  // Find the slot card element by index
  const cards = document.querySelectorAll('.glass-card');
  const card = cards[idx] as HTMLElement | undefined;
  if (!card) return { top: '100px', left: '100px' };
  const rect = card.getBoundingClientRect();
  const top = rect.bottom + 4;
  const left = rect.left;
  return {
    top: `${Math.min(top, window.innerHeight - 260)}px`,
    left: `${Math.min(left, window.innerWidth - 170)}px`,
  };
}

// Fetch all slots on mount
async function fetchAllSlots() {
  await Promise.allSettled([0, 1, 2].map(fetchSlotData));
}

function toggleSection(key: keyof Omit<OverviewSettings, 'defaultTimeframe'>) {
  settings.value[key] = !settings.value[key];
  saveSettings(settings.value);
}

function setDefaultTimeframe(tf: string) {
  settings.value.defaultTimeframe = tf;
  saveSettings(settings.value);
}

// ── Timeframe selector ──
type TimeframeKey = 'today' | '24h' | '7d' | 'thisWeek' | '30d' | 'thisMonth' | 'thisYear' | '1y';

const timeframes: TimeframeKey[] = ['today', '24h', '7d', 'thisWeek', '30d', 'thisMonth', 'thisYear', '1y'];

const selectedTimeframe = ref<TimeframeKey>(settings.value.defaultTimeframe as TimeframeKey || '24h');

function timeframeLabel(tf: TimeframeKey): string {
  return t(`marketPulse.tf_${tf}`);
}

function getTimeframeRange(tf: TimeframeKey): { start: number; days: number } {
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  switch (tf) {
    case 'today':
      return { start: todayStart.getTime(), days: 1 };
    case '24h':
      return { start: now - 24 * 60 * 60 * 1000, days: 1 };
    case '7d':
      return { start: now - 7 * 24 * 60 * 60 * 1000, days: 7 };
    case 'thisWeek': {
      const d = new Date();
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(d.setDate(diff));
      weekStart.setHours(0, 0, 0, 0);
      return { start: weekStart.getTime(), days: 7 };
    }
    case '30d':
      return { start: now - 30 * 24 * 60 * 60 * 1000, days: 30 };
    case 'thisMonth': {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      return { start: monthStart.getTime(), days: 30 };
    }
    case 'thisYear': {
      const yearStart = new Date(new Date().getFullYear(), 0, 1);
      return { start: yearStart.getTime(), days: 365 };
    }
    case '1y':
      return { start: now - 365 * 24 * 60 * 60 * 1000, days: 365 };
    default:
      return { start: now - 24 * 60 * 60 * 1000, days: 1 };
  }
}

// ── Currency unit ──
const currencyUnit = computed(() => {
  if (summaryCurrency.value && summaryCurrency.value !== 'auto') {
    return summaryCurrency.value;
  }
  return 'USD';
});

// ── Market data ──
const btcPrice = ref<number | null>(null);
const btcChange24h = ref<number | null>(null);
const ethPrice = ref<number | null>(null);
const ethChange24h = ref<number | null>(null);
const fearGreed = ref<{ value: number; classification: string } | null>(null);

// BTC/ETH history for selected timeframe comparison
const btcHistory = ref<PricePoint[]>([]);
const ethHistory = ref<PricePoint[]>([]);

// Independent loading states
const marketLoading = ref(true);
const fearGreedLoading = ref(true);
const benchmarksLoading = ref(true);

async function fetchMarketData() {
  marketLoading.value = true;
  try {
    const resp = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true',
    );
    if (resp.ok) {
      const data = await resp.json();
      btcPrice.value = data.bitcoin?.usd ?? null;
      btcChange24h.value = data.bitcoin?.usd_24h_change ?? null;
      ethPrice.value = data.ethereum?.usd ?? null;
      ethChange24h.value = data.ethereum?.usd_24h_change ?? null;
    }
  } catch (err) {
    console.warn('Failed to fetch market prices:', err);
  } finally {
    marketLoading.value = false;
  }
}

async function fetchFearGreed() {
  fearGreedLoading.value = true;
  try {
    const resp = await fetch('https://api.alternative.me/fng/?limit=1');
    if (resp.ok) {
      const data = await resp.json();
      fearGreed.value = {
        value: parseInt(data.data[0].value),
        classification: data.data[0].value_classification,
      };
    }
  } catch (err) {
    console.warn('Failed to fetch Fear & Greed:', err);
  } finally {
    fearGreedLoading.value = false;
  }
}

async function fetchBenchmarks() {
  benchmarksLoading.value = true;
  try {
    const { days } = getTimeframeRange(selectedTimeframe.value);
    const fetchDays = Math.max(days, 1);
    const [btcData, ethData] = await Promise.all([
      fetchBTCHistory(fetchDays),
      fetchETHHistory(fetchDays),
    ]);
    btcHistory.value = btcData;
    ethHistory.value = ethData;
  } finally {
    benchmarksLoading.value = false;
  }
}

// Fear & Greed gauge helpers
function fgColor(val: number): string {
  if (val <= 25) return '#ef4444'; // red - extreme fear
  if (val <= 50) return '#f97316'; // orange - fear
  if (val <= 75) return '#22c55e'; // green - greed
  return '#16a34a'; // dark green - extreme greed
}

function fgLabel(val: number): string {
  if (val <= 25) return t('marketPulse.extremeFear');
  if (val <= 50) return t('marketPulse.fear');
  if (val <= 75) return t('marketPulse.greed');
  return t('marketPulse.extremeGreed');
}

// ── Bot performance in selected period ──
const closedTrades = computed<ClosedTrade[]>(() => botStore.allTradesSelectedBots);

const filteredTrades = computed(() => {
  const { start } = getTimeframeRange(selectedTimeframe.value);
  return closedTrades.value.filter((tr) => (tr.close_timestamp ?? 0) >= start);
});

function tradeProfit(tr: ClosedTrade): number {
  const abs = tr.profit_abs ?? 0;
  const currency = tr.quote_currency || 'USDT';
  if (currencyUnit.value === currency) return abs;
  const converted = convert(abs, currency, currencyUnit.value);
  return converted ?? abs;
}

const totalProfit = computed(() => filteredTrades.value.reduce((sum, tr) => sum + tradeProfit(tr), 0));
const tradeCount = computed(() => filteredTrades.value.length);
const winCount = computed(() => filteredTrades.value.filter((tr) => (tr.profit_abs ?? 0) > 0).length);
const winRate = computed(() => (tradeCount.value > 0 ? (winCount.value / tradeCount.value) * 100 : 0));

const bestTrade = computed(() => {
  if (filteredTrades.value.length === 0) return null;
  let best = filteredTrades.value[0];
  for (const tr of filteredTrades.value) {
    if ((tr.profit_ratio ?? 0) > (best.profit_ratio ?? 0)) best = tr;
  }
  return { pair: best.pair, pct: ((best.profit_ratio ?? 0) * 100).toFixed(2) };
});

const worstTrade = computed(() => {
  if (filteredTrades.value.length === 0) return null;
  let worst = filteredTrades.value[0];
  for (const tr of filteredTrades.value) {
    if ((tr.profit_ratio ?? 0) < (worst.profit_ratio ?? 0)) worst = tr;
  }
  return { pair: worst.pair, pct: ((worst.profit_ratio ?? 0) * 100).toFixed(2) };
});

// Best/worst bot
const botProfits = computed(() => {
  const map: Record<string, { name: string; profit: number }> = {};
  for (const tr of filteredTrades.value) {
    const name = tr.botName || tr.botId;
    if (!map[name]) map[name] = { name, profit: 0 };
    map[name].profit += tradeProfit(tr);
  }
  return Object.values(map);
});

const bestBot = computed(() => {
  if (botProfits.value.length === 0) return null;
  return botProfits.value.reduce((a, b) => (a.profit > b.profit ? a : b));
});

const worstBot = computed(() => {
  if (botProfits.value.length === 0) return null;
  return botProfits.value.reduce((a, b) => (a.profit < b.profit ? a : b));
});

// ── Volume ──
const showVolumeDetail = ref(false);

const totalVolume = computed(() => {
  return filteredTrades.value.reduce((sum, tr) => {
    const vol = tr.stake_amount ?? 0;
    const currency = tr.quote_currency || 'USDT';
    const converted = convert(vol, currency, currencyUnit.value);
    return sum + (converted ?? vol);
  }, 0);
});

const volumeByExchange = computed(() => {
  const map: Record<string, number> = {};
  for (const tr of filteredTrades.value) {
    const ex = tr.exchange || 'unknown';
    const vol = tr.stake_amount ?? 0;
    const currency = tr.quote_currency || 'USDT';
    const converted = convert(vol, currency, currencyUnit.value);
    map[ex] = (map[ex] ?? 0) + (converted ?? vol);
  }
  return map;
});

const volumeByCurrency = computed(() => {
  const map: Record<string, number> = {};
  for (const tr of filteredTrades.value) {
    const currency = tr.quote_currency || 'USDT';
    map[currency] = (map[currency] ?? 0) + (tr.stake_amount ?? 0);
  }
  return map;
});

// ── Comparison strip ──
function benchmarkChange(history: PricePoint[]): number | null {
  if (history.length < 2) return null;
  const { start } = getTimeframeRange(selectedTimeframe.value);
  // Find the first point >= start
  let first = history[0];
  for (const p of history) {
    if (p.timestamp >= start) {
      first = p;
      break;
    }
  }
  const last = history[history.length - 1];
  if (first.price === 0) return null;
  return ((last.price - first.price) / first.price) * 100;
}

const btcChangeInPeriod = computed(() => benchmarkChange(btcHistory.value));
const ethChangeInPeriod = computed(() => benchmarkChange(ethHistory.value));

// Bot % change: we need a baseline (total balance at start of period). Approximate from profit.
// We'll estimate it as total profit / average stake * 100, or simpler: sum of profit_ratio
const botChangeInPeriod = computed(() => {
  if (filteredTrades.value.length === 0) return null;
  // Weighted average of profit ratios by stake
  let totalStake = 0;
  let weightedProfit = 0;
  for (const tr of filteredTrades.value) {
    const stake = tr.stake_amount ?? 0;
    const ratio = tr.profit_ratio ?? 0;
    weightedProfit += stake * ratio;
    totalStake += stake;
  }
  if (totalStake === 0) return null;
  return (weightedProfit / totalStake) * 100;
});

const beatsBtc = computed(() => {
  if (botChangeInPeriod.value === null || btcChangeInPeriod.value === null) return null;
  return botChangeInPeriod.value > btcChangeInPeriod.value;
});

// ── Formatting ──
function fmtNum(val: number, decimals = 2): string {
  return val.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtChange(val: number | null): string {
  if (val === null) return '-';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${fmtNum(val)}%`;
}

function changeColor(val: number | null): string {
  if (val === null) return 'text-surface-400';
  return val >= 0 ? 'text-green-400' : 'text-red-400';
}

// ── Popovers (with delayed hide for interactive content) ──
const btcPopover = ref<InstanceType<typeof Popover>>();
const btcPopoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const ethPopover = ref<InstanceType<typeof Popover>>();
const ethPopoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const fgPopover = ref<InstanceType<typeof Popover>>();
const fgPopoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const perfPopover = ref<InstanceType<typeof Popover>>();
const perfPopoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const perfPopoverMetric = ref('');

let hideDelayId: ReturnType<typeof setTimeout> | null = null;

function cancelHideDelay() {
  if (hideDelayId) { clearTimeout(hideDelayId); hideDelayId = null; }
}

function showMpPopover(popoverRef: typeof btcPopover, timeoutRef: typeof btcPopoverTimeout, event: MouseEvent) {
  cancelHideDelay();
  if (timeoutRef.value) clearTimeout(timeoutRef.value);
  const target = event.currentTarget as HTMLElement;
  timeoutRef.value = setTimeout(() => {
    if (target) popoverRef.value?.show({ currentTarget: target } as unknown as Event);
  }, 300);
}

function hideMpPopover(popoverRef: typeof btcPopover, timeoutRef: typeof btcPopoverTimeout) {
  if (timeoutRef.value) clearTimeout(timeoutRef.value);
  // Delayed hide: 200ms grace period so mouse can reach popover content
  hideDelayId = setTimeout(() => {
    popoverRef.value?.hide();
  }, 200);
}

// Keep popover alive when mouse enters popover content
function keepMpPopover() {
  cancelHideDelay();
}

function onBtcMouseEnter(event: MouseEvent) { showMpPopover(btcPopover, btcPopoverTimeout, event); }
function onBtcMouseLeave() { hideMpPopover(btcPopover, btcPopoverTimeout); }
function onEthMouseEnter(event: MouseEvent) { showMpPopover(ethPopover, ethPopoverTimeout, event); }
function onEthMouseLeave() { hideMpPopover(ethPopover, ethPopoverTimeout); }
function onFgMouseEnter(event: MouseEvent) { showMpPopover(fgPopover, fgPopoverTimeout, event); }
function onFgMouseLeave() { hideMpPopover(fgPopover, fgPopoverTimeout); }
function onPerfMouseEnter(event: MouseEvent, metric: string) {
  perfPopoverMetric.value = metric;
  showMpPopover(perfPopover, perfPopoverTimeout, event);
}
function onPerfMouseLeave() { hideMpPopover(perfPopover, perfPopoverTimeout); }

// ── Lifecycle ──
let refreshInterval: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  // Fire all fetches independently — each section renders as soon as its data arrives
  fetchAllSlots();
  fetchBenchmarks();
  refreshInterval = setInterval(() => {
    fetchAllSlots();
    fetchBenchmarks();
  }, 30 * 1000); // refresh every 30s
});

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval);
});

watch(selectedTimeframe, () => {
  fetchBenchmarks();
  fetchAllSlots(); // Re-fetch slots with new timeframe
});
</script>

<template>
  <div class="market-overview relative flex flex-col h-full p-3 gap-3 overflow-y-auto">
    <!-- Settings gear (absolute top-right, at widget header level) -->
    <div class="absolute top-1 right-1 z-20">
      <button
        class="text-surface-400 hover:text-surface-200 transition-colors p-1 rounded"
        :title="t('marketPulse.settings')"
        @click.stop="showSettingsPanel = !showSettingsPanel"
      >
        <i-mdi-cog class="w-4 h-4" />
      </button>
      <!-- Settings dropdown -->
      <div
        v-if="showSettingsPanel"
        class="absolute right-0 top-8 rounded-lg p-3 min-w-[220px] flex flex-col gap-2 glass-panel shadow-xl"
        style="z-index: 200"
      >
          <span class="text-xs font-semibold text-surface-300 uppercase tracking-wider mb-1">{{ t('marketPulse.settings') }}</span>
          <label class="flex items-center gap-2 text-xs text-surface-300 cursor-pointer">
            <input type="checkbox" :checked="settings.showMarket" @change="toggleSection('showMarket')" class="accent-blue-500" />
            {{ t('marketPulse.sectionMarket') }}
          </label>
          <label class="flex items-center gap-2 text-xs text-surface-300 cursor-pointer">
            <input type="checkbox" :checked="settings.showPerformance" @change="toggleSection('showPerformance')" class="accent-blue-500" />
            {{ t('marketPulse.sectionPerformance') }}
          </label>
          <label class="flex items-center gap-2 text-xs text-surface-300 cursor-pointer">
            <input type="checkbox" :checked="settings.showVolume" @change="toggleSection('showVolume')" class="accent-blue-500" />
            {{ t('marketPulse.sectionVolume') }}
          </label>
          <label class="flex items-center gap-2 text-xs text-surface-300 cursor-pointer">
            <input type="checkbox" :checked="settings.showComparison" @change="toggleSection('showComparison')" class="accent-blue-500" />
            {{ t('marketPulse.sectionComparison') }}
          </label>
          <hr class="border-surface-600 my-1" />
          <span class="text-xs text-surface-400">{{ t('marketPulse.defaultTimeframe') }}</span>
          <select
            :value="settings.defaultTimeframe"
            class="text-xs bg-surface-700 text-surface-200 rounded px-2 py-1 border border-surface-600"
            @change="setDefaultTimeframe(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="tf in timeframes" :key="tf" :value="tf">{{ timeframeLabel(tf) }}</option>
          </select>
      </div>
    </div>

    <!-- Click-away for settings panel -->
    <div v-if="showSettingsPanel" class="fixed inset-0 z-10" @click="showSettingsPanel = false" />

    <!-- Timeframe pills -->
    <div class="flex flex-wrap gap-1">
      <button
        v-for="tf in timeframes"
        :key="tf"
        class="px-2 py-0.5 rounded-full text-[11px] font-medium transition-all"
        :class="
          selectedTimeframe === tf
            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
            : 'text-surface-400 hover:text-surface-200 border border-transparent hover:border-surface-600'
        "
        @click="selectedTimeframe = tf"
      >
        {{ timeframeLabel(tf) }}
      </button>
    </div>

    <!-- 1. Market indicators -->
    <div v-if="settings.showMarket" class="grid grid-cols-3 gap-2">
      <div
        v-for="(slot, idx) in settings.slots" :key="idx"
        class="glass-card relative flex flex-col items-center gap-1 p-2 rounded-lg group"
      >
        <!-- Edit button (top-right, on hover) -->
        <button
          class="absolute top-1 right-1 p-0.5 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer z-10"
          @click.stop="editingSlotIdx = editingSlotIdx === idx ? null : idx"
        >
          <i-mdi-pencil class="w-3 h-3 text-surface-400" />
        </button>

        <!-- Slot selector dropdown (Teleported to body to avoid z-index issues) -->
        <Teleport to="body">
          <div
            v-if="editingSlotIdx === idx"
            class="fixed bg-gray-800 border border-gray-600/50 rounded-lg shadow-2xl p-1.5 min-w-[160px] max-h-[250px] overflow-y-auto"
            :style="slotDropdownStyle(idx)"
            style="z-index: 9999"
          >
          <button
            v-for="opt in SLOT_OPTIONS" :key="opt.ticker"
            class="flex items-center gap-1.5 w-full px-2 py-0.5 text-[10px] rounded cursor-pointer transition-colors"
            :class="slot.ticker === opt.ticker ? 'text-blue-400 bg-blue-500/15' : 'text-surface-300 hover:bg-surface-700/50'"
            @click.stop="setSlot(idx, opt)"
          >
            <span class="font-bold w-10">{{ opt.ticker }}</span>
            <span v-if="opt.type !== 'crypto'" class="text-surface-500 text-[9px]">{{ opt.label }}</span>
          </button>
        </div>
        </Teleport>

        <!-- Slot label -->
        <span class="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">{{ slot.ticker }}</span>

        <!-- Loading state -->
        <template v-if="slotData[idx].loading">
          <div class="animate-pulse bg-surface-700/30 rounded h-5 w-16 mt-0.5" />
          <div class="animate-pulse bg-surface-700/30 rounded h-3 w-12 mt-0.5" />
        </template>

        <!-- Crypto slot -->
        <template v-else-if="slot.type === 'crypto'">
          <span class="text-sm font-bold text-surface-200">
            {{ slotData[idx].price !== null ? `$${fmtNum(slotData[idx].price!, 0)}` : '-' }}
          </span>
          <span class="text-[11px] font-medium" :class="changeColor(slotData[idx].change24h)">
            {{ fmtChange(slotData[idx].change24h) }}
          </span>
        </template>

        <!-- Fear & Greed slot -->
        <template v-else-if="slot.type === 'feargreed'">
          <div v-if="slotData[idx].value != null" class="flex flex-col items-center gap-0.5 w-full">
            <div class="w-full h-2 rounded-full bg-surface-700 overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-500"
                :style="{ width: slotData[idx].value + '%', backgroundColor: fgColor(slotData[idx].value!) }"
              />
            </div>
            <span class="text-lg font-bold" :style="{ color: fgColor(slotData[idx].value!) }">{{ slotData[idx].value }}</span>
            <span class="text-[10px]" :style="{ color: fgColor(slotData[idx].value!) }">{{ fgLabel(slotData[idx].value!) }}</span>
          </div>
          <span v-else class="text-surface-500 text-xs">-</span>
        </template>

        <!-- BTC Dominance slot -->
        <template v-else-if="slot.type === 'btc_dominance'">
          <span v-if="slotData[idx].value != null" class="text-sm font-bold text-amber-400">
            {{ slotData[idx].value!.toFixed(1) }}%
          </span>
          <span v-else class="text-surface-500 text-xs">-</span>
        </template>

        <!-- Time filter warning -->
        <div v-if="!slotData[idx].supportsTimefilter" class="text-[8px] text-surface-600 mt-0.5">
          Not filterable by date
        </div>
      </div>
    </div>

    <!-- Click-away for slot editor -->
    <div v-if="editingSlotIdx !== null" class="fixed inset-0 z-40" @click="editingSlotIdx = null" />

    <!-- 2. Bot performance in selected period -->
    <div v-if="settings.showPerformance" class="glass-card rounded-lg p-3 flex flex-col gap-2">
      <span class="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">
        {{ t('marketPulse.botPerformance') }}
      </span>
      <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div
          class="flex justify-between cursor-help"
          @mouseenter="onPerfMouseEnter($event, 'totalProfit')"
          @mouseleave="onPerfMouseLeave()"
        >
          <span class="text-surface-400">{{ t('marketPulse.totalProfit') }}</span>
          <span class="font-semibold" :class="totalProfit >= 0 ? 'text-green-400' : 'text-red-400'">
            {{ fmtNum(totalProfit) }} {{ currencyUnit }}
          </span>
        </div>
        <div
          class="flex justify-between cursor-help"
          @mouseenter="onPerfMouseEnter($event, 'trades')"
          @mouseleave="onPerfMouseLeave()"
        >
          <span class="text-surface-400">{{ t('marketPulse.trades') }}</span>
          <span class="text-surface-200 font-semibold">{{ tradeCount }}</span>
        </div>
        <div
          class="flex justify-between cursor-help"
          @mouseenter="onPerfMouseEnter($event, 'winRate')"
          @mouseleave="onPerfMouseLeave()"
        >
          <span class="text-surface-400">{{ t('marketPulse.winRate') }}</span>
          <span class="text-surface-200 font-semibold">{{ fmtNum(winRate, 1) }}%</span>
        </div>
        <div
          class="flex justify-between cursor-help"
          @mouseenter="onPerfMouseEnter($event, 'bestTrade')"
          @mouseleave="onPerfMouseLeave()"
        >
          <span class="text-surface-400">{{ t('marketPulse.bestTrade') }}</span>
          <span v-if="bestTrade" class="text-green-400 font-semibold">{{ bestTrade.pair }} {{ bestTrade.pct }}%</span>
          <span v-else class="text-surface-500">-</span>
        </div>
        <div
          class="flex justify-between cursor-help"
          @mouseenter="onPerfMouseEnter($event, 'worstTrade')"
          @mouseleave="onPerfMouseLeave()"
        >
          <span class="text-surface-400">{{ t('marketPulse.worstTrade') }}</span>
          <span v-if="worstTrade" class="font-semibold" :class="Number(worstTrade.pct) >= 0 ? 'text-green-400' : 'text-red-400'">{{ worstTrade.pair }} {{ Number(worstTrade.pct) >= 0 ? '+' : '' }}{{ worstTrade.pct }}%</span>
          <span v-else class="text-surface-500">-</span>
        </div>
        <div
          class="flex justify-between cursor-help"
          @mouseenter="onPerfMouseEnter($event, 'bestBot')"
          @mouseleave="onPerfMouseLeave()"
        >
          <span class="text-surface-400">{{ t('marketPulse.bestBot') }}</span>
          <span v-if="bestBot" class="text-green-400 font-semibold">{{ bestBot.name }} {{ fmtNum(bestBot.profit) }} {{ currencyUnit }}</span>
          <span v-else class="text-surface-500">-</span>
        </div>
        <div
          class="flex justify-between cursor-help"
          @mouseenter="onPerfMouseEnter($event, 'worstBot')"
          @mouseleave="onPerfMouseLeave()"
        >
          <span class="text-surface-400">{{ t('marketPulse.worstBot') }}</span>
          <span v-if="worstBot" class="text-red-400 font-semibold">{{ worstBot.name }} {{ fmtNum(worstBot.profit) }} {{ currencyUnit }}</span>
          <span v-else class="text-surface-500">-</span>
        </div>
      </div>
    </div>

    <!-- 3. Volume -->
    <div v-if="settings.showVolume" class="glass-card rounded-lg p-3 flex flex-col gap-2 relative">
      <div class="flex items-center justify-between">
        <span class="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">
          {{ t('marketPulse.volume') }}
        </span>
        <button
          class="text-surface-400 hover:text-surface-200 text-[10px]"
          @mouseenter="showVolumeDetail = true"
          @mouseleave="showVolumeDetail = false"
          @click="showVolumeDetail = !showVolumeDetail"
        >
          <i-mdi-information-outline class="w-3.5 h-3.5" />
        </button>
      </div>
      <span class="text-lg font-bold text-surface-200">
        {{ fmtNum(totalVolume, 2) }}
        <span class="text-xs font-normal text-surface-400">{{ currencyUnit }}</span>
      </span>
      <!-- Volume detail popover -->
      <div
        v-if="showVolumeDetail"
        class="absolute right-0 top-10 glass-panel rounded-lg p-3 min-w-[200px] shadow-xl"
        style="z-index: 100"
      >
        <div class="flex flex-col gap-2 text-xs">
          <span class="font-semibold text-surface-300">{{ t('marketPulse.volumeByExchange') }}</span>
          <div v-for="(vol, ex) in volumeByExchange" :key="ex" class="flex justify-between">
            <span class="text-surface-400">{{ ex }}</span>
            <span class="text-surface-200">{{ fmtNum(vol, 2) }} {{ currencyUnit }}</span>
          </div>
          <hr class="border-surface-600" />
          <span class="font-semibold text-surface-300">{{ t('marketPulse.volumeByCurrency') }}</span>
          <div v-for="(vol, cur) in volumeByCurrency" :key="cur" class="flex justify-between">
            <span class="text-surface-400">{{ cur }}</span>
            <span class="text-surface-200">{{ fmtNum(vol, 2) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 4. Comparison strip -->
    <div v-if="settings.showComparison" class="glass-card rounded-lg p-3 flex flex-col gap-2">
      <span class="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">
        {{ t('marketPulse.comparison') }}
      </span>
      <template v-if="benchmarksLoading">
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="flex flex-col items-center gap-1">
            <span class="text-[10px] text-surface-400">{{ t('marketPulse.yourBots') }}</span>
            <div class="animate-pulse bg-surface-700/30 rounded h-5 w-12" />
          </div>
          <div class="flex flex-col items-center gap-1">
            <span class="text-[10px] text-surface-400">BTC</span>
            <div class="animate-pulse bg-surface-700/30 rounded h-5 w-12" />
          </div>
          <div class="flex flex-col items-center gap-1">
            <span class="text-[10px] text-surface-400">ETH</span>
            <div class="animate-pulse bg-surface-700/30 rounded h-5 w-12" />
          </div>
        </div>
      </template>
      <template v-else>
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="flex flex-col items-center gap-0.5">
            <span class="text-[10px] text-surface-400">{{ t('marketPulse.yourBots') }}</span>
            <span
              class="text-sm font-bold"
              :class="beatsBtc === true ? 'text-green-400' : beatsBtc === false ? 'text-red-400' : 'text-surface-300'"
            >
              {{ fmtChange(botChangeInPeriod) }}
            </span>
          </div>
          <div class="flex flex-col items-center gap-0.5">
            <span class="text-[10px] text-surface-400">BTC</span>
            <span class="text-sm font-bold" :class="changeColor(btcChangeInPeriod)">
              {{ fmtChange(btcChangeInPeriod) }}
            </span>
          </div>
          <div class="flex flex-col items-center gap-0.5">
            <span class="text-[10px] text-surface-400">ETH</span>
            <span class="text-sm font-bold" :class="changeColor(ethChangeInPeriod)">
              {{ fmtChange(ethChangeInPeriod) }}
            </span>
          </div>
        </div>
        <div v-if="beatsBtc !== null" class="text-center text-[10px] font-medium mt-1">
          <span v-if="beatsBtc" class="text-green-400">{{ t('marketPulse.beatingBtc') }}</span>
          <span v-else class="text-red-400">{{ t('marketPulse.underperformingBtc') }}</span>
        </div>
      </template>
    </div>
    <!-- BTC Price Popover -->
    <Popover ref="btcPopover" class="p-0">
      <div class="p-3 text-xs min-w-[220px] max-w-[300px]" @mouseenter="keepMpPopover" @mouseleave="onBtcMouseLeave()">
        <div class="font-bold text-[11px] mb-2">{{ t('marketPulse.popoverBtcTitle') }}</div>
        <div class="grid grid-cols-2 gap-x-3 gap-y-1">
          <span class="text-surface-400">{{ t('marketPulse.popoverPrice') }}</span>
          <span class="font-mono font-semibold text-surface-200">{{ btcPrice !== null ? `$${fmtNum(btcPrice, 0)}` : '-' }}</span>
          <span class="text-surface-400">{{ t('marketPulse.popover24hChange') }}</span>
          <span class="font-mono font-semibold" :class="changeColor(btcChange24h)">{{ fmtChange(btcChange24h) }}</span>
          <span class="text-surface-400">{{ t('marketPulse.popover7dChange') }}</span>
          <span class="font-mono font-semibold" :class="changeColor(btcChangeInPeriod)">{{ fmtChange(btcChangeInPeriod) }}</span>
        </div>
        <hr class="border-surface-600 my-2" />
        <div class="text-[10px] text-surface-500">
          {{ t('marketPulse.popoverSource') }}:
          <a href="https://www.coingecko.com/en/coins/bitcoin" target="_blank" rel="noopener" class="text-blue-400 hover:underline">CoinGecko</a>
        </div>
      </div>
    </Popover>

    <!-- ETH Popover -->
    <Popover ref="ethPopover" class="p-0">
      <div class="p-3 text-xs min-w-[220px] max-w-[300px]" @mouseenter="keepMpPopover" @mouseleave="onEthMouseLeave()">
        <div class="font-bold text-[11px] mb-2">Ethereum (ETH)</div>
        <div class="grid grid-cols-2 gap-x-3 gap-y-1">
          <span class="text-surface-400">{{ t('marketPulse.popoverPrice') }}</span>
          <span class="font-mono font-semibold text-surface-200">{{ ethPrice !== null ? `$${fmtNum(ethPrice, 0)}` : '-' }}</span>
          <span class="text-surface-400">{{ t('marketPulse.popover24hChange') }}</span>
          <span class="font-mono font-semibold" :class="changeColor(ethChange24h)">{{ fmtChange(ethChange24h) }}</span>
        </div>
        <hr class="border-surface-600 my-2" />
        <div class="text-[10px] text-surface-500">
          {{ t('marketPulse.popoverSource') }}:
          <a href="https://www.coingecko.com/en/coins/ethereum" target="_blank" rel="noopener" class="text-blue-400 hover:underline">CoinGecko</a>
        </div>
      </div>
    </Popover>

    <!-- Fear & Greed Popover -->
    <Popover ref="fgPopover" class="p-0">
      <div class="p-3 text-xs min-w-[240px] max-w-[320px]" @mouseenter="keepMpPopover" @mouseleave="onFgMouseLeave()">
        <div class="font-bold text-[11px] mb-2">{{ t('marketPulse.popoverFgTitle') }}</div>
        <p class="text-surface-400 mb-2">{{ t('marketPulse.popoverFgDescription') }}</p>
        <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 mb-2">
          <span class="text-red-400">0-25</span><span>{{ t('marketPulse.extremeFear') }}</span>
          <span class="text-orange-400">26-50</span><span>{{ t('marketPulse.fear') }}</span>
          <span class="text-green-400">51-75</span><span>{{ t('marketPulse.greed') }}</span>
          <span class="text-green-500">76-100</span><span>{{ t('marketPulse.extremeGreed') }}</span>
        </div>
        <hr class="border-surface-600 my-2" />
        <div class="text-[10px] text-surface-500">
          {{ t('marketPulse.popoverSource') }}:
          <a href="https://alternative.me/crypto/fear-and-greed-index/" target="_blank" rel="noopener" class="text-blue-400 hover:underline">Alternative.me</a>
        </div>
      </div>
    </Popover>

    <!-- Performance Metric Popover -->
    <Popover ref="perfPopover" class="p-0">
      <div class="p-3 text-xs min-w-[200px] max-w-[300px]">
        <div class="font-bold text-[11px] mb-1">{{ t(`marketPulse.popoverPerf_${perfPopoverMetric}`) }}</div>
        <p class="text-surface-400">{{ t(`marketPulse.popoverPerfDesc_${perfPopoverMetric}`) }}</p>
      </div>
    </Popover>
  </div>
</template>

<style scoped>
.market-overview {
  width: 100%;
  height: 100%;
}

.glass-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(8px);
}

.glass-panel {
  background: rgba(30, 30, 40, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(12px);
}

/* Light mode support */
:root:not(.dark) .glass-card,
html:not(.dark) .glass-card {
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid rgba(0, 0, 0, 0.08);
}

:root:not(.dark) .glass-panel,
html:not(.dark) .glass-panel {
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(0, 0, 0, 0.1);
}
</style>
