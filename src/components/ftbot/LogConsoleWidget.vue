<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useLogConsoleStore } from '@/stores/logConsole';
import { useLogFiltering, type LogLevel } from '@/composables/useLogFiltering';
import { useBotComparisonStore } from '@/stores/botComparison';
import BotNameTruncated from './BotNameTruncated.vue';

const { t } = useI18n();
const router = useRouter();
const logStore = useLogConsoleStore();
const botStore = useBotStore();
const compStore = useBotComparisonStore();

onMounted(() => {
  logStore.startPolling();
  displayMode.value = 'timeline';
});
onUnmounted(() => logStore.stopPolling());

const entriesRef = computed(() => logStore.entries);
const {
  filters, displayMode,
  filteredEntries, groupedByBot, summaryCounts, botsWithIssues,
  toggleLevel, toggleBotId, toggleExchange, toggleModule,
  resetFilters, setTimeWindow,
} = useLogFiltering(entriesRef);

// ── UI state ──
const logScrollEl = ref<HTMLElement>();
const collapsedBots = ref<Set<string>>(new Set());
const expandedGroupKey = ref<string | null>(null);
const searchInput = ref('');
const showAdvancedFilters = ref(false);
const activeTimeWindow = ref(0);
const compactMode = ref(true);
const showAllBotSections = ref(false);
const hideHeartbeat = ref(true);
const hideWebSocket = ref(false);
const hideWalletSync = ref(true);
const hideBtAnalysis = ref(true);

// Reactive tick for relative timestamps (updates every 10s)
const tick = ref(0);
let tickInterval: ReturnType<typeof setInterval>;
onMounted(() => { tickInterval = setInterval(() => tick.value++, 10_000); });
onUnmounted(() => clearInterval(tickInterval));

watch(searchInput, (val) => { filters.searchText = val; });

// Apply legacy noise filters on top of useLogFiltering output.
// Cache the result and only produce a new array when entries actually change.
let _lastDisplayIds = '';
let _cachedDisplay: typeof filteredEntries.value = [];

const displayEntries = computed(() => {
  let result = filteredEntries.value;
  if (hideHeartbeat.value) {
    result = result.filter((e) => !e.message.toLowerCase().includes('bot heartbeat'));
  }
  if (hideWebSocket.value) {
    result = result.filter((e) => !e.module.toLowerCase().includes('uvicorn') && !e.message.toLowerCase().includes('websocket'));
  }
  if (hideWalletSync.value) {
    result = result.filter((e) => !e.message.toLowerCase().includes('wallets synced'));
  }
  if (hideBtAnalysis.value) {
    result = result.filter((e) => !e.module.includes('bt_fileutils'));
  }
  const reversed = [...result].reverse();
  const idKey = reversed.map((e) => e.id).join(',');
  if (idKey !== _lastDisplayIds) {
    _lastDisplayIds = idKey;
    _cachedDisplay = reversed;
  }
  return _cachedDisplay;
});

// Scroll management
const userScrolledUp = ref(false);
const pendingNewCount = ref(0);

function onScroll() {
  if (!logScrollEl.value) return;
  const el = logScrollEl.value;
  userScrolledUp.value = el.scrollHeight - el.scrollTop - el.clientHeight > 40;
}

function resumeScroll() {
  pendingNewCount.value = 0;
  userScrolledUp.value = false;
  nextTick(() => {
    if (logScrollEl.value) {
      logScrollEl.value.scrollTop = logScrollEl.value.scrollHeight;
    }
  });
}

watch(displayEntries, (newVal, oldVal) => {
  if (newVal === oldVal) return;
  const added = (newVal?.length ?? 0) - (oldVal?.length ?? 0);
  if (!userScrolledUp.value) {
    pendingNewCount.value = 0;
    nextTick(() => {
      if (logScrollEl.value) {
        logScrollEl.value.scrollTop = logScrollEl.value.scrollHeight;
      }
    });
  } else if (added > 0) {
    pendingNewCount.value += added;
  }
});

onMounted(() => {
  setTimeout(() => {
    if (logScrollEl.value) {
      logScrollEl.value.scrollTop = logScrollEl.value.scrollHeight;
    }
  }, 500);
});

function toggleBotCollapse(botId: string) {
  const s = new Set(collapsedBots.value);
  s.has(botId) ? s.delete(botId) : s.add(botId);
  collapsedBots.value = s;
}

function toggleGroupExpand(key: string) {
  expandedGroupKey.value = expandedGroupKey.value === key ? null : key;
}

/** Navigate to Journaux page filtered on a specific bot + highlighted search text */
function goToLogs(botId: string, highlightText?: string) {
  router.push({
    name: 'Freqtrade Logs',
    query: {
      bot: botId,
      highlight: highlightText ?? '',
    },
  });
}

function selectTimeWindow(hours: number) {
  activeTimeWindow.value = hours;
  setTimeWindow(hours);
}

// ── Available filter options (dynamic) ──
const availableBots = computed(() => {
  return Object.entries(botStore.botStores).map(([id, store]) => ({
    id,
    name: store.uiBotName ?? id,
    online: store.isBotOnline,
  }));
});

const availableExchanges = computed(() => logStore.allExchanges);
const availableModules = computed(() => logStore.allModules);

// Custom tag & currency filters (additional on top of useLogFiltering)
const selectedCustomTags = ref<Set<string>>(new Set());
const selectedCurrencies = ref<Set<string>>(new Set());

const availableCustomTags = computed(() => compStore.customTags);
const availableCurrencies = computed(() => {
  const currencies = new Set<string>();
  for (const state of Object.values(botStore.allBotState)) {
    const cur = (state as any)?.stake_currency;
    if (cur) currencies.add(cur);
  }
  return Array.from(currencies).sort();
});

function toggleCustomTag(tagId: string) {
  const s = new Set(selectedCustomTags.value);
  s.has(tagId) ? s.delete(tagId) : s.add(tagId);
  selectedCustomTags.value = s;
}

function toggleCurrency(cur: string) {
  const s = new Set(selectedCurrencies.value);
  s.has(cur) ? s.delete(cur) : s.add(cur);
  selectedCurrencies.value = s;
}

// Apply custom tag + currency filters to bot selection
watch([selectedCustomTags, selectedCurrencies], () => {
  // If custom tag or currency filter active, restrict bot filter
  const tagBots = selectedCustomTags.value.size > 0
    ? new Set(Object.entries(compStore.botCustomTags)
        .filter(([, tags]) => tags.some((t) => selectedCustomTags.value.has(t)))
        .map(([id]) => id))
    : null;

  const curBots = selectedCurrencies.value.size > 0
    ? new Set(Object.entries(botStore.allBotState)
        .filter(([, s]) => selectedCurrencies.value.has((s as any)?.stake_currency))
        .map(([id]) => id))
    : null;

  // Intersect the two sets with any existing botIds filter
  if (tagBots || curBots) {
    const allBotIds = Object.keys(botStore.botStores);
    const result = new Set<string>();
    for (const id of allBotIds) {
      if (tagBots && !tagBots.has(id)) continue;
      if (curBots && !curBots.has(id)) continue;
      result.add(id);
    }
    filters.botIds = result;
  } else {
    filters.botIds.clear();
  }
}, { deep: true });

// Active filter counts
const activeFilterCount = computed(() => {
  let n = 0;
  if (filters.botIds.size > 0) n++;
  if (filters.exchanges.size > 0) n++;
  if (filters.modules.size > 0) n++;
  if (filters.botMode !== 'all') n++;
  if (filters.marketType !== 'all') n++;
  if (selectedCustomTags.value.size > 0) n++;
  if (selectedCurrencies.value.size > 0) n++;
  return n;
});

// ── Computed display data ──
const totalBotCount = computed(() => Object.keys(botStore.botStores).length);
const botsWithoutIssues = computed(() => totalBotCount.value - botsWithIssues.value.size);

const lastUpdateAgo = computed(() => {
  tick.value; // dependency for reactivity
  if (!logStore.lastFetchTimestamp) return '';
  const sec = Math.round((Date.now() - logStore.lastFetchTimestamp) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
});

// ── Helpers ──
function sevColor(level: string): string {
  switch (level) {
    case 'CRITICAL': return '#ef4444';
    case 'ERROR': return '#f97316';
    case 'WARNING': return '#eab308';
    case 'INFO': return '#3b82f6';
    default: return '#6b7280';
  }
}

function sevBg(level: string): string {
  switch (level) {
    case 'CRITICAL': return 'rgba(239,68,68,0.15)';
    case 'ERROR': return 'rgba(249,115,22,0.10)';
    case 'WARNING': return 'rgba(234,179,8,0.08)';
    case 'INFO': return 'rgba(59,130,246,0.10)';
    default: return 'transparent';
  }
}

function shortModule(mod: string): string {
  return mod.replace(/^freqtrade\./, '');
}

function copyMessage(msg: string) {
  navigator.clipboard?.writeText(msg);
}

function relativeTime(ts: number): string {
  tick.value; // dependency
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

const timeWindows = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: 'All', hours: 0 },
];

// ── Widget size detection for responsive ──
const widgetEl = ref<HTMLElement>();
const isSmallWidget = ref(false);
const isCompact = computed(() => compactMode.value || isSmallWidget.value);
const resizeObserver = ref<ResizeObserver>();

onMounted(() => {
  if (widgetEl.value) {
    resizeObserver.value = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) isSmallWidget.value = entry.contentRect.height < 300;
    });
    resizeObserver.value.observe(widgetEl.value);
  }
});
onUnmounted(() => resizeObserver.value?.disconnect());
</script>

<template>
  <div ref="widgetEl" class="flex flex-col h-full overflow-hidden text-xs text-left">

    <!-- ═══ SUMMARY BAR ═══ -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-surface-700/50 flex-shrink-0">
      <span v-if="summaryCounts.critical > 0" class="flex items-center gap-1 font-bold" style="color: #ef4444">
        <span class="w-2 h-2 rounded-full inline-block" style="background: #ef4444" />
        {{ summaryCounts.critical }}
      </span>
      <span v-if="summaryCounts.error > 0" class="flex items-center gap-1 font-bold" style="color: #f97316">
        <span class="w-2 h-2 rounded-full inline-block" style="background: #f97316" />
        {{ summaryCounts.error }}
      </span>
      <span v-if="summaryCounts.warning > 0" class="flex items-center gap-1 font-bold" style="color: #eab308">
        <span class="w-2 h-2 rounded-full inline-block" style="background: #eab308" />
        {{ summaryCounts.warning }}
      </span>
      <span v-if="summaryCounts.total === 0 && logStore.initialLoadDone" class="flex items-center gap-1 text-green-400">
        <span class="w-2 h-2 rounded-full inline-block bg-green-500" />
        All clear
      </span>

      <span class="ml-auto flex items-center gap-2 text-[10px] text-surface-500">
        <span
          v-if="userScrolledUp"
          class="flex items-center gap-1 px-1.5 py-0.5 rounded text-amber-400 font-semibold"
          style="background: rgba(245,158,11,0.10); border: 1px solid rgba(245,158,11,0.25)"
        >
          <i-mdi-lock-outline style="font-size: 0.8rem" />
          Paused
        </span>
        <template v-else>
          <span v-if="logStore.fetching" class="animate-spin inline-block w-3 h-3 border border-blue-400 border-t-transparent rounded-full" />
          <span v-else>{{ lastUpdateAgo }}</span>
        </template>
        <span v-if="logStore.unreachableBotCount > 0" class="text-red-400 font-bold">
          {{ logStore.unreachableBotCount }} offline
        </span>
      </span>
    </div>

    <!-- ═══ FILTER BAR ═══ -->
    <div class="flex flex-wrap items-center gap-1.5 px-3 py-1 border-b border-surface-700/30 flex-shrink-0">
      <!-- Severity toggles -->
      <button
        v-for="level in (['CRITICAL', 'ERROR', 'WARNING', 'INFO'] as LogLevel[])"
        :key="level"
        class="px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all"
        :style="{
          color: filters.levels.has(level) ? sevColor(level) : '#6b7280',
          background: filters.levels.has(level) ? sevBg(level) : 'transparent',
          border: `1px solid ${filters.levels.has(level) ? sevColor(level) + '40' : 'rgba(255,255,255,0.06)'}`,
        }"
        @click="toggleLevel(level)"
      >{{ level }}</button>

      <span class="text-surface-600 mx-0.5">|</span>

      <!-- Time window -->
      <button
        v-for="tw in timeWindows" :key="tw.hours"
        class="px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-all"
        :class="activeTimeWindow === tw.hours ? 'bg-blue-500/20 text-blue-400 font-bold' : 'text-surface-400 hover:text-surface-200'"
        :style="{ border: `1px solid ${activeTimeWindow === tw.hours ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.04)'}` }"
        @click="selectTimeWindow(tw.hours)"
      >{{ tw.label }}</button>

      <span class="text-surface-600 mx-0.5">|</span>

      <!-- Display mode -->
      <button
        class="px-1.5 py-0.5 rounded text-[10px] cursor-pointer"
        :class="displayMode === 'grouped' ? 'text-blue-400 bg-blue-500/10' : 'text-surface-400'"
        @click="displayMode = 'grouped'"
      >Grouped</button>
      <button
        class="px-1.5 py-0.5 rounded text-[10px] cursor-pointer"
        :class="displayMode === 'timeline' ? 'text-blue-400 bg-blue-500/10' : 'text-surface-400'"
        @click="displayMode = 'timeline'"
      >Timeline</button>

      <!-- Compact toggle -->
      <button
        class="px-1.5 py-0.5 rounded text-[10px] cursor-pointer"
        :class="compactMode ? 'text-blue-400 bg-blue-500/10' : 'text-surface-400'"
        @click="compactMode = !compactMode"
      >Compact</button>

      <!-- Noise filters (only visible when INFO is enabled) -->
      <template v-if="filters.levels.has('INFO')">
        <span class="text-surface-600 mx-0.5">|</span>
        <button
          class="px-1.5 py-0.5 rounded text-[10px] cursor-pointer"
          :class="hideHeartbeat ? 'text-indigo-400 bg-indigo-500/10' : 'text-surface-500'"
          @click="hideHeartbeat = !hideHeartbeat"
        >Hide HB</button>
        <button
          class="px-1.5 py-0.5 rounded text-[10px] cursor-pointer"
          :class="hideWebSocket ? 'text-indigo-400 bg-indigo-500/10' : 'text-surface-500'"
          @click="hideWebSocket = !hideWebSocket"
        >Hide WS</button>
        <button
          class="px-1.5 py-0.5 rounded text-[10px] cursor-pointer"
          :class="hideWalletSync ? 'text-indigo-400 bg-indigo-500/10' : 'text-surface-500'"
          @click="hideWalletSync = !hideWalletSync"
        >Hide Wallet</button>
        <button
          class="px-1.5 py-0.5 rounded text-[10px] cursor-pointer"
          :class="hideBtAnalysis ? 'text-indigo-400 bg-indigo-500/10' : 'text-surface-500'"
          @click="hideBtAnalysis = !hideBtAnalysis"
        >Hide BT</button>
      </template>

      <!-- Advanced filters toggle -->
      <button
        class="px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-all"
        :class="showAdvancedFilters ? 'text-purple-400 bg-purple-500/10' : 'text-surface-400'"
        @click="showAdvancedFilters = !showAdvancedFilters"
      >
        Filters
        <span v-if="activeFilterCount > 0" class="text-[8px] font-bold text-purple-400 ml-0.5">({{ activeFilterCount }})</span>
      </button>

      <!-- Search -->
      <input
        v-model="searchInput"
        type="text"
        placeholder="Search..."
        class="ml-auto w-28 px-1.5 py-0.5 text-[10px] bg-surface-800 border border-surface-600/50 rounded text-surface-200 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
      />
    </div>

    <!-- ═══ ADVANCED FILTERS PANEL ═══ -->
    <div v-if="showAdvancedFilters" class="px-3 py-1.5 border-b border-surface-700/30 flex-shrink-0 space-y-1.5" style="background: rgba(255,255,255,0.015)">
      <div class="flex flex-wrap gap-3">
        <!-- Bot filter -->
        <div class="space-y-0.5">
          <div class="text-[9px] text-surface-500 uppercase tracking-wider">Bots</div>
          <div class="flex flex-wrap gap-0.5">
            <button
              v-for="bot in availableBots" :key="bot.id"
              class="px-1.5 py-0.5 rounded text-[9px] cursor-pointer transition-all"
              :class="filters.botIds.size === 0 || filters.botIds.has(bot.id)
                ? 'text-surface-200 bg-surface-700/50'
                : 'text-surface-500 bg-surface-800/30 opacity-50'"
              @click="toggleBotId(bot.id)"
            >
              <span
                class="inline-block w-1.5 h-1.5 rounded-full mr-0.5"
                :class="bot.online ? 'bg-green-500' : 'bg-gray-500'"
              />
              {{ bot.name }}
            </button>
          </div>
        </div>

        <!-- Exchange filter -->
        <div v-if="availableExchanges.length > 1" class="space-y-0.5">
          <div class="text-[9px] text-surface-500 uppercase tracking-wider">Exchange</div>
          <div class="flex flex-wrap gap-0.5">
            <button
              v-for="ex in availableExchanges" :key="ex"
              class="px-1.5 py-0.5 rounded text-[9px] cursor-pointer transition-all capitalize"
              :class="filters.exchanges.size === 0 || filters.exchanges.has(ex)
                ? 'text-surface-200 bg-surface-700/50'
                : 'text-surface-500 bg-surface-800/30 opacity-50'"
              @click="toggleExchange(ex)"
            >{{ ex }}</button>
          </div>
        </div>

        <!-- Bot mode & Market type -->
        <div class="space-y-0.5">
          <div class="text-[9px] text-surface-500 uppercase tracking-wider">Mode</div>
          <div class="flex gap-0.5">
            <button
              v-for="mode in (['all', 'live', 'dry'] as const)" :key="mode"
              class="px-1.5 py-0.5 rounded text-[9px] cursor-pointer capitalize"
              :class="filters.botMode === mode ? 'text-blue-400 bg-blue-500/15' : 'text-surface-400'"
              @click="filters.botMode = mode"
            >{{ mode }}</button>
          </div>
        </div>

        <div class="space-y-0.5">
          <div class="text-[9px] text-surface-500 uppercase tracking-wider">Market</div>
          <div class="flex gap-0.5">
            <button
              v-for="mt in (['all', 'spot', 'futures'] as const)" :key="mt"
              class="px-1.5 py-0.5 rounded text-[9px] cursor-pointer capitalize"
              :class="filters.marketType === mt ? 'text-blue-400 bg-blue-500/15' : 'text-surface-400'"
              @click="filters.marketType = mt"
            >{{ mt }}</button>
          </div>
        </div>
      </div>

      <!-- Currency filter -->
      <div v-if="availableCurrencies.length > 1" class="flex flex-wrap gap-3">
        <div>
          <div class="text-[9px] text-surface-500 uppercase tracking-wider mb-0.5">Currency</div>
          <div class="flex flex-wrap gap-0.5">
            <button
              v-for="cur in availableCurrencies" :key="cur"
              class="px-1.5 py-0.5 rounded text-[9px] cursor-pointer transition-all font-bold"
              :class="selectedCurrencies.size === 0 || selectedCurrencies.has(cur)
                ? 'text-surface-200 bg-surface-700/50'
                : 'text-surface-500 bg-surface-800/30 opacity-50'"
              @click="toggleCurrency(cur)"
            >{{ cur }}</button>
          </div>
        </div>
      </div>

      <!-- Custom Tags filter -->
      <div v-if="availableCustomTags.length > 0">
        <div class="text-[9px] text-surface-500 uppercase tracking-wider mb-0.5">Tags ({{ availableCustomTags.length }})</div>
        <div class="flex flex-wrap gap-0.5" :class="availableCustomTags.length > 10 ? 'max-h-[50px] overflow-y-auto' : ''">
          <button
            v-for="tag in availableCustomTags" :key="tag.id"
            class="px-1.5 py-0.5 rounded text-[9px] cursor-pointer transition-all"
            :style="{
              color: selectedCustomTags.size === 0 || selectedCustomTags.has(tag.id) ? tag.color : '#6b7280',
              background: selectedCustomTags.has(tag.id) ? tag.color + '20' : 'transparent',
              border: `1px solid ${selectedCustomTags.has(tag.id) ? tag.color + '40' : 'rgba(255,255,255,0.06)'}`,
            }"
            @click="toggleCustomTag(tag.id)"
          >{{ tag.name }}</button>
        </div>
      </div>

      <!-- Source modules -->
      <div v-if="availableModules.length > 0">
        <div class="text-[9px] text-surface-500 uppercase tracking-wider mb-0.5">Source ({{ availableModules.length }})</div>
        <div class="flex flex-wrap gap-0.5 max-h-[40px] overflow-y-auto">
          <button
            v-for="mod in availableModules.slice(0, 20)" :key="mod"
            class="px-1 py-0.5 rounded text-[8px] font-mono cursor-pointer transition-all"
            :class="filters.modules.size === 0 || filters.modules.has(mod)
              ? 'text-surface-300 bg-surface-700/40'
              : 'text-surface-600 bg-surface-800/20 opacity-40'"
            @click="toggleModule(mod)"
          >{{ shortModule(mod) }}</button>
        </div>
      </div>

      <!-- Reset -->
      <div class="flex justify-end">
        <button
          v-if="activeFilterCount > 0"
          class="text-[9px] text-red-400 hover:text-red-300 cursor-pointer"
          @click="resetFilters()"
        >Reset filters</button>
      </div>
    </div>

    <!-- ═══ CONTENT AREA ═══ -->
    <div class="flex-1 min-h-0 relative">

    <!-- Resume button (floating) -->
    <Transition name="resume-btn">
      <button
        v-if="userScrolledUp"
        class="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-semibold cursor-pointer transition-all hover:brightness-125"
        style="background: rgba(59,130,246,0.85); color: #fff; backdrop-filter: blur(8px); box-shadow: 0 4px 16px rgba(0,0,0,0.4)"
        @click="resumeScroll()"
      >
        <i-mdi-arrow-down style="font-size: 0.85rem" />
        Resume
        <span
          v-if="pendingNewCount > 0"
          class="ml-0.5 px-1.5 py-0 rounded-full text-[9px] font-bold"
          style="background: rgba(255,255,255,0.2)"
        >+{{ pendingNewCount }}</span>
      </button>
    </Transition>

    <div ref="logScrollEl" class="h-full overflow-y-auto" @scroll="onScroll">

      <!-- Loading state -->
      <div v-if="!logStore.initialLoadDone" class="flex flex-col items-center justify-center h-full gap-2 text-surface-400">
        <span class="animate-spin inline-block w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full" />
        <span class="text-[11px]">Fetching logs from {{ totalBotCount }} bots...</span>
      </div>

      <!-- Empty state: all clear -->
      <div v-else-if="summaryCounts.total === 0 && !logStore.fetching" class="flex flex-col items-center justify-center h-full gap-2">
        <span class="text-2xl">&#x2705;</span>
        <span class="text-sm text-green-400 font-semibold">All {{ totalBotCount }} bots running without issues</span>
        <span class="text-[10px] text-surface-500">Last check: {{ lastUpdateAgo }}</span>
      </div>

      <!-- ═══ GROUPED MODE ═══ -->
      <template v-else-if="displayMode === 'grouped'">
        <!-- Summary counts at top -->
        <div v-if="groupedByBot.length > 1" class="px-3 py-1 text-[10px] text-surface-400 border-b border-surface-700/30">
          {{ groupedByBot.length }} bots with issues ·
          <span v-if="summaryCounts.critical" style="color:#ef4444">{{ summaryCounts.critical }} critical</span>
          <span v-if="summaryCounts.error" style="color:#f97316">{{ ' ' }}{{ summaryCounts.error }} error</span>
          <span v-if="summaryCounts.warning" style="color:#eab308">{{ ' ' }}{{ summaryCounts.warning }} warning</span>
        </div>

        <div v-for="(botSection, secIdx) in groupedByBot" :key="botSection.botId" class="border-b border-surface-700/30"
          :class="groupedByBot.length > 5 && secIdx >= 5 && !showAllBotSections ? 'hidden' : ''"
        >
          <!-- Bot header -->
          <div
            class="group flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-surface-800/50 transition-colors"
            @click="toggleBotCollapse(botSection.botId)"
          >
            <span class="text-[10px] text-surface-500">{{ collapsedBots.has(botSection.botId) ? '▸' : '▾' }}</span>
            <BotNameTruncated :name="botSection.botName" max-width="140px" class="font-semibold text-[11px] text-surface-200" />
            <button
              class="text-[9px] text-blue-400 hover:text-blue-300 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              title="Open in Logs"
              @click.stop="goToLogs(botSection.botId)"
            >→ Logs</button>
            <span
              class="ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold"
              :style="{ color: sevColor(botSection.maxSeverity), background: sevBg(botSection.maxSeverity) }"
            >
              {{ botSection.groups.reduce((s, g) => s + g.count, 0) }} issue{{ botSection.groups.reduce((s, g) => s + g.count, 0) > 1 ? 's' : '' }}
            </span>
          </div>

          <!-- Group entries (collapsible) -->
          <template v-if="!collapsedBots.has(botSection.botId)">
            <div
              v-for="group in botSection.groups"
              :key="group.key"
              class="px-3 py-1 border-t border-surface-800/50"
            >
              <!-- Group header line -->
              <div class="flex items-start gap-2 cursor-pointer" @click="toggleGroupExpand(group.key)">
                <span class="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" :style="{ background: sevColor(group.level) }" />
                <span
                  class="font-mono text-[11px] text-surface-200 flex-1 break-all leading-relaxed"
                  :class="isCompact ? 'truncate' : ''"
                  @click.stop="copyMessage(group.last.message)"
                >{{ group.last.message }}</span>
                <span v-if="group.count > 1" class="text-[10px] font-bold flex-shrink-0 px-1" :style="{ color: sevColor(group.level) }">
                  ×{{ group.count }}
                </span>
                <button
                  class="text-[9px] text-blue-400/50 hover:text-blue-300 flex-shrink-0 cursor-pointer"
                  title="Open in Logs"
                  @click.stop="goToLogs(group.botId, group.last.message.slice(0, 50))"
                >→</button>
              </div>

              <!-- Metadata (hidden in compact mode) -->
              <div v-if="!isCompact" class="flex items-center gap-3 mt-0.5 ml-3.5 text-[9px] text-surface-500">
                <span v-if="group.count > 1">{{ relativeTime(group.last.timestamp) }} → {{ relativeTime(group.first.timestamp) }}</span>
                <span v-else>{{ relativeTime(group.last.timestamp) }}</span>
                <span class="text-surface-600">{{ shortModule(group.module) }}</span>
              </div>

              <!-- Expanded detail -->
              <div v-if="expandedGroupKey === group.key && !isCompact" class="ml-3.5 mt-1 mb-1 space-y-0.5">
                <div
                  v-for="entry in group.entries.slice(0, 8)"
                  :key="entry.id"
                  class="flex items-start gap-2 text-[10px] rounded px-1.5 py-0.5"
                  :style="{ background: sevBg(entry.level) }"
                >
                  <span class="text-surface-500 flex-shrink-0 font-mono">{{ entry.timestampFormatted.slice(11) }}</span>
                  <span class="text-surface-300 font-mono break-all">{{ entry.message }}</span>
                </div>
                <div v-if="group.entries.length > 8" class="text-[9px] text-surface-500 px-1.5">
                  ... and {{ group.entries.length - 8 }} more
                </div>
                <div
                  v-if="group.last.exception"
                  class="mt-1 px-2 py-1 rounded text-[9px] font-mono text-red-300 whitespace-pre-wrap break-all"
                  style="background: rgba(239,68,68,0.08); max-height: 120px; overflow-y: auto"
                >{{ group.last.exception }}</div>
              </div>
            </div>
          </template>
        </div>

        <!-- Show more bots toggle -->
        <button
          v-if="groupedByBot.length > 5 && !showAllBotSections"
          class="w-full text-center text-[10px] py-1.5 text-surface-500 hover:text-surface-300 cursor-pointer transition-colors border-b border-surface-700/30"
          @click="showAllBotSections = true"
        >+{{ groupedByBot.length - 5 }} more bots...</button>
        <button
          v-else-if="groupedByBot.length > 5 && showAllBotSections"
          class="w-full text-center text-[10px] py-1 text-blue-400 hover:text-blue-300 cursor-pointer border-b border-surface-700/30"
          @click="showAllBotSections = false"
        >Show less</button>

        <!-- Bots without issues -->
        <div v-if="botsWithoutIssues > 0" class="px-3 py-2 text-center text-[11px] text-surface-500">
          <span class="text-green-500">&#x2713;</span> {{ botsWithoutIssues }} bot{{ botsWithoutIssues > 1 ? 's' : '' }} without issues
        </div>

        <!-- No results after filtering -->
        <div v-if="groupedByBot.length === 0 && summaryCounts.total === 0 && logStore.initialLoadDone" class="px-3 py-4 text-center text-[11px] text-surface-500">
          No log entries match the current filters
        </div>
      </template>

      <!-- ═══ TIMELINE MODE ═══ -->
      <template v-else>
        <div
          v-for="entry in displayEntries.slice(0, 500)"
          :key="entry.id"
          class="flex items-start gap-2 px-3 py-0.5 border-b border-surface-800/30 hover:bg-surface-800/30"
          :class="{ 'log-entry-new': logStore.newEntryIds[entry.id] }"
        >
          <span class="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" :style="{ background: sevColor(entry.level) }" />
          <span class="text-[10px] text-surface-500 font-mono flex-shrink-0 w-[50px]">{{ entry.timestampFormatted.slice(11, 19) }}</span>
          <BotNameTruncated :name="entry.botName" max-width="80px" class="text-[10px] text-surface-400 flex-shrink-0" />
          <span class="text-[10px] text-surface-300 font-mono flex-1 break-all" :class="isCompact ? 'truncate' : ''">{{ entry.message }}</span>
          <span v-if="!isCompact" class="text-[9px] text-surface-600 flex-shrink-0">{{ shortModule(entry.module) }}</span>
        </div>
        <div v-if="displayEntries.length > 500" class="px-3 py-2 text-center text-[10px] text-surface-500">
          Showing 500 of {{ displayEntries.length }} entries
        </div>
        <div v-if="displayEntries.length === 0" class="px-3 py-4 text-center text-[11px] text-surface-500">
          No log entries match the current filters
        </div>
      </template>

      <!-- ═══ UNREACHABLE BOTS ═══ -->
      <div v-if="logStore.unreachableBotCount > 0" class="border-t border-surface-700/50 px-3 py-1.5">
        <div class="text-[10px] text-red-400/80 font-semibold mb-1">Unreachable bots</div>
        <div
          v-for="status in logStore.botStatusList.filter(s => !s.isOnline && s.lastError)"
          :key="status.botId"
          class="flex items-center gap-2 py-0.5 text-[10px]"
        >
          <span class="w-2 h-2 rounded-full bg-gray-500 animate-pulse flex-shrink-0" />
          <span class="text-surface-300">{{ status.botName }}</span>
          <span class="text-surface-600 text-[9px] ml-auto truncate max-w-[200px]" :title="status.lastError ?? undefined">{{ status.lastError }}</span>
        </div>
      </div>
    </div>
    </div>
  </div>
</template>

<style scoped>
.log-entry-new {
  animation: logFadeIn 0.8s ease-out;
}

@keyframes logFadeIn {
  from {
    opacity: 0;
    background-color: rgba(59, 130, 246, 0.12);
  }
  to {
    opacity: 1;
    background-color: transparent;
  }
}

.resume-btn-enter-active,
.resume-btn-leave-active {
  transition: all 0.2s ease;
}
.resume-btn-enter-from,
.resume-btn-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
