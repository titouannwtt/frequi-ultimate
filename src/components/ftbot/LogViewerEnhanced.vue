<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { useLogConsoleStore } from '@/stores/logConsole';
import { useLogFiltering, type LogLevel } from '@/composables/useLogFiltering';

const { t } = useI18n();
const route = useRoute();
const logStore = useLogConsoleStore();
const botStore = useBotStore();

// Start multi-bot polling
onMounted(() => logStore.startPolling());
onUnmounted(() => logStore.stopPolling());

const entriesRef = computed(() => logStore.entries);
const {
  filters, displayMode,
  filteredEntries, groupedByBot, summaryCounts, botsWithIssues,
  toggleLevel, toggleBotId, resetFilters, setTimeWindow,
} = useLogFiltering(entriesRef);

// Default: show ALL levels (full log view, not just errors)
onMounted(() => {
  filters.levels = new Set<LogLevel>(['CRITICAL', 'ERROR', 'WARNING', 'INFO']);
  filters.excludedModulePrefixes = [];
  // Journaux page always starts in timeline mode (not grouped)
  displayMode.value = 'timeline';

  // Read query params: ?bot=<botId>&highlight=<text>
  const botParam = route.query.bot as string | undefined;
  if (botParam) {
    filters.botIds.add(botParam);
  }
});

// Highlight matching text in entries (from query param navigation — NOT a filter)
const highlightText = computed(() => (route.query.highlight as string) || (route.query.q as string) || '');

// ── UI state ──
const scrollContainer = ref<HTMLElement | null>(null);
const autoScroll = ref(true);
const compactMode = ref(true);
const showAdvancedFilters = ref(false);
const searchInput = ref('');
const activeTimeWindow = ref(0);
const expandedGroupKey = ref<string | null>(null);
const collapsedBots = ref<Set<string>>(new Set());

// Hide noise toggles (legacy compat)
const hideHeartbeat = ref(true);
const hideWebSocket = ref(false);
const hideWalletSync = ref(true);

watch(searchInput, (val) => { filters.searchText = val; });

// Reactive tick for relative timestamps
const tick = ref(0);
let tickInterval: ReturnType<typeof setInterval>;
onMounted(() => { tickInterval = setInterval(() => tick.value++, 10_000); });
onUnmounted(() => clearInterval(tickInterval));

// ── Computed filtered with legacy noise filters ──
const displayEntries = computed(() => {
  let result = filteredEntries.value;
  if (hideHeartbeat.value) {
    result = result.filter((e) => !e.message.toLowerCase().includes('bot heartbeat'));
  }
  if (hideWebSocket.value) {
    result = result.filter(
      (e) => !e.module.toLowerCase().includes('uvicorn')
        && !e.message.toLowerCase().includes('websocket'),
    );
  }
  if (hideWalletSync.value) {
    result = result.filter((e) => !e.message.toLowerCase().includes('wallets synced'));
  }
  // Reverse: oldest first, newest at bottom (terminal-style)
  return [...result].reverse();
});

// ── Available bots for filter ──
const availableBots = computed(() => {
  return Object.entries(botStore.botStores).map(([id, store]) => ({
    id,
    name: store.uiBotName ?? id,
    online: store.isBotOnline,
  }));
});

const activeFilterCount = computed(() => {
  let n = 0;
  if (filters.botIds.size > 0) n++;
  if (filters.botMode !== 'all') n++;
  if (filters.marketType !== 'all') n++;
  return n;
});

const totalBotCount = computed(() => Object.keys(botStore.botStores).length);

// ── Scroll ──
function scrollToBottom() {
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
  }
}

function isNearBottom(): boolean {
  if (!scrollContainer.value) return true;
  const el = scrollContainer.value;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}

watch(displayEntries, () => {
  if (autoScroll.value && isNearBottom()) nextTick(() => scrollToBottom());
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

function levelBorderClass(level: string): string {
  switch (level) {
    case 'CRITICAL': return 'border-l-4 border-l-red-800 bg-red-900/30';
    case 'ERROR': return 'border-l-4 border-l-red-500 bg-red-500/10';
    case 'WARNING': return 'border-l-4 border-l-orange-500';
    case 'INFO': return 'border-l-4 border-l-green-500';
    default: return 'border-l-4 border-l-surface-400';
  }
}

function levelTextClass(level: string): string {
  switch (level) {
    case 'CRITICAL': return 'text-red-300 font-bold';
    case 'ERROR': return 'text-red-400 font-semibold';
    case 'WARNING': return 'text-orange-400 font-semibold';
    case 'INFO': return 'text-green-400';
    default: return 'text-surface-400';
  }
}

function shortModule(mod: string): string {
  return mod.replace(/^freqtrade\./, '');
}

function relativeTime(ts: number): string {
  tick.value;
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function copyMessage(msg: string) {
  navigator.clipboard?.writeText(msg);
}

function selectTimeWindow(hours: number) {
  activeTimeWindow.value = hours;
  setTimeWindow(hours);
}

function toggleBotCollapse(botId: string) {
  const s = new Set(collapsedBots.value);
  s.has(botId) ? s.delete(botId) : s.add(botId);
  collapsedBots.value = s;
}

function toggleGroupExpand(key: string) {
  expandedGroupKey.value = expandedGroupKey.value === key ? null : key;
}

const lastUpdateAgo = computed(() => {
  tick.value;
  if (!logStore.lastFetchTimestamp) return '';
  const sec = Math.round((Date.now() - logStore.lastFetchTimestamp) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
});

const timeWindows = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: 'All', hours: 0 },
];
</script>

<template>
  <div class="flex flex-col h-full w-full">
    <!-- ═══ TOOLBAR ═══ -->
    <div class="flex flex-wrap items-center gap-2 px-2 py-1.5 border-b border-surface-300 dark:border-surface-600">
      <!-- Severity toggles -->
      <div class="flex gap-0.5">
        <button
          v-for="level in (['CRITICAL', 'ERROR', 'WARNING', 'INFO'] as LogLevel[])"
          :key="level"
          class="px-2 py-0.5 rounded-full text-[11px] font-semibold cursor-pointer transition-colors"
          :style="{
            color: filters.levels.has(level) ? '#fff' : undefined,
            background: filters.levels.has(level) ? sevColor(level) : undefined,
          }"
          :class="!filters.levels.has(level) ? 'bg-surface-200/50 dark:bg-surface-700/50 text-surface-500 dark:text-surface-400' : ''"
          @click="toggleLevel(level)"
        >{{ level }}</button>
      </div>

      <div class="h-4 w-px bg-surface-300 dark:bg-surface-600" />

      <!-- Noise filters -->
      <button
        v-tooltip.bottom="t('logViewer.hideHeartbeatTooltip')"
        class="px-2 py-0.5 rounded-full text-[11px] font-semibold cursor-pointer transition-colors"
        :class="hideHeartbeat ? 'bg-indigo-500/80 text-white' : 'bg-surface-200/50 dark:bg-surface-700/50 text-surface-500'"
        @click="hideHeartbeat = !hideHeartbeat"
      >
        <i-mdi-heart-pulse class="inline w-3 h-3 mr-0.5 align-text-bottom" />
        {{ t('logViewer.hideHeartbeat') }}
      </button>
      <button
        v-tooltip.bottom="t('logViewer.hideWebSocketTooltip')"
        class="px-2 py-0.5 rounded-full text-[11px] font-semibold cursor-pointer transition-colors"
        :class="hideWebSocket ? 'bg-indigo-500/80 text-white' : 'bg-surface-200/50 dark:bg-surface-700/50 text-surface-500'"
        @click="hideWebSocket = !hideWebSocket"
      >
        <i-mdi-lan-connect class="inline w-3 h-3 mr-0.5 align-text-bottom" />
        {{ t('logViewer.hideWebSocket') }}
      </button>
      <button
        v-tooltip.bottom="'Hide wallet sync messages'"
        class="px-2 py-0.5 rounded-full text-[11px] font-semibold cursor-pointer transition-colors"
        :class="hideWalletSync ? 'bg-indigo-500/80 text-white' : 'bg-surface-200/50 dark:bg-surface-700/50 text-surface-500'"
        @click="hideWalletSync = !hideWalletSync"
      >
        <i-mdi-wallet class="inline w-3 h-3 mr-0.5 align-text-bottom" />
        Hide Wallet
      </button>

      <div class="h-4 w-px bg-surface-300 dark:bg-surface-600" />

      <!-- Time window -->
      <div class="flex gap-0.5">
        <button
          v-for="tw in timeWindows" :key="tw.hours"
          class="px-1.5 py-0.5 rounded text-[10px] cursor-pointer"
          :class="activeTimeWindow === tw.hours ? 'bg-blue-500/20 text-blue-400 font-bold' : 'text-surface-400'"
          @click="selectTimeWindow(tw.hours)"
        >{{ tw.label }}</button>
      </div>

      <div class="h-4 w-px bg-surface-300 dark:bg-surface-600" />

      <!-- Display mode -->
      <button
        class="px-2 py-0.5 rounded-full text-[11px] cursor-pointer"
        :class="displayMode === 'grouped' ? 'bg-purple-500/80 text-white font-semibold' : 'bg-surface-200/50 dark:bg-surface-700/50 text-surface-500'"
        @click="displayMode = displayMode === 'grouped' ? 'timeline' : 'grouped'"
      >
        {{ displayMode === 'grouped' ? 'Grouped' : 'Timeline' }}
      </button>

      <!-- Advanced filters toggle -->
      <button
        class="px-2 py-0.5 rounded-full text-[11px] cursor-pointer"
        :class="showAdvancedFilters ? 'bg-purple-500/80 text-white font-semibold' : 'bg-surface-200/50 dark:bg-surface-700/50 text-surface-500'"
        @click="showAdvancedFilters = !showAdvancedFilters"
      >
        Bots
        <span v-if="activeFilterCount > 0" class="text-[9px] font-bold ml-0.5">({{ activeFilterCount }})</span>
      </button>

      <div class="h-4 w-px bg-surface-300 dark:bg-surface-600" />

      <!-- Search -->
      <InputText
        v-model="searchInput"
        :placeholder="t('logViewer.search')"
        class="w-40"
        size="small"
      />

      <div class="flex-1" />

      <!-- Right controls -->
      <label class="flex items-center gap-1 text-[11px] text-surface-500 cursor-pointer">
        <input v-model="compactMode" type="checkbox" class="w-3 h-3" />
        {{ t('logViewer.compact') }}
      </label>
      <label class="flex items-center gap-1 text-[11px] text-surface-500 cursor-pointer">
        <input v-model="autoScroll" type="checkbox" class="w-3 h-3" />
        {{ t('logViewer.autoScroll') }}
      </label>

      <i-mdi-loading v-if="logStore.fetching" class="w-4 h-4 animate-spin text-indigo-400" />
      <span class="text-[10px] text-surface-500">{{ lastUpdateAgo }}</span>

      <Button
        size="small"
        :title="t('logViewer.scrollToBottom')"
        severity="secondary"
        @click="scrollToBottom"
      >
        <template #icon>
          <i-mdi-arrow-down-thick />
        </template>
      </Button>
    </div>

    <!-- ═══ BOT FILTER PANEL ═══ -->
    <div v-if="showAdvancedFilters" class="px-3 py-1.5 border-b border-surface-300 dark:border-surface-600 flex flex-wrap gap-3" style="background: rgba(255,255,255,0.015)">
      <!-- Bot select -->
      <div>
        <div class="text-[9px] text-surface-500 uppercase tracking-wider mb-0.5">Bots ({{ totalBotCount }})</div>
        <div class="flex flex-wrap gap-0.5">
          <button
            v-for="bot in availableBots" :key="bot.id"
            class="px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-all"
            :class="filters.botIds.size === 0 || filters.botIds.has(bot.id)
              ? 'text-surface-200 bg-surface-700/50'
              : 'text-surface-500 bg-surface-800/30 opacity-50'"
            @click="toggleBotId(bot.id)"
          >
            <span class="inline-block w-1.5 h-1.5 rounded-full mr-0.5" :class="bot.online ? 'bg-green-500' : 'bg-gray-500'" />
            {{ bot.name }}
          </button>
        </div>
      </div>

      <!-- Mode / Market -->
      <div>
        <div class="text-[9px] text-surface-500 uppercase tracking-wider mb-0.5">Mode</div>
        <div class="flex gap-0.5">
          <button
            v-for="mode in (['all', 'live', 'dry'] as const)" :key="mode"
            class="px-1.5 py-0.5 rounded text-[9px] cursor-pointer capitalize"
            :class="filters.botMode === mode ? 'text-blue-400 bg-blue-500/15' : 'text-surface-400'"
            @click="filters.botMode = mode"
          >{{ mode }}</button>
        </div>
      </div>
      <div>
        <div class="text-[9px] text-surface-500 uppercase tracking-wider mb-0.5">Market</div>
        <div class="flex gap-0.5">
          <button
            v-for="mt in (['all', 'spot', 'futures'] as const)" :key="mt"
            class="px-1.5 py-0.5 rounded text-[9px] cursor-pointer capitalize"
            :class="filters.marketType === mt ? 'text-blue-400 bg-blue-500/15' : 'text-surface-400'"
            @click="filters.marketType = mt"
          >{{ mt }}</button>
        </div>
      </div>

      <button v-if="activeFilterCount > 0" class="text-[9px] text-red-400 hover:text-red-300 cursor-pointer self-end" @click="resetFilters(); filters.levels = new Set(['CRITICAL', 'ERROR', 'WARNING', 'INFO']); filters.excludedModulePrefixes = []">
        Reset
      </button>
    </div>

    <!-- ═══ COUNTER BAR ═══ -->
    <div class="flex items-center gap-2 px-2 py-0.5 text-[10px] text-surface-400">
      <span>{{ displayEntries.length }} entries</span>
      <span v-if="summaryCounts.critical > 0" style="color: #ef4444" class="font-bold">{{ summaryCounts.critical }} critical</span>
      <span v-if="summaryCounts.error > 0" style="color: #f97316" class="font-bold">{{ summaryCounts.error }} error</span>
      <span v-if="summaryCounts.warning > 0" style="color: #eab308">{{ summaryCounts.warning }} warning</span>
      <span class="ml-auto text-surface-500">{{ totalBotCount }} bots</span>
      <span v-if="logStore.unreachableBotCount > 0" class="text-red-400">{{ logStore.unreachableBotCount }} offline</span>
    </div>

    <!-- ═══ LOG ENTRIES ═══ -->
    <div ref="scrollContainer" class="flex-1 overflow-auto px-1 pb-4">

      <!-- Loading -->
      <div v-if="!logStore.initialLoadDone" class="flex flex-col items-center justify-center h-full gap-2 text-surface-400">
        <span class="animate-spin inline-block w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full" />
        <span class="text-sm">Fetching logs from {{ totalBotCount }} bots...</span>
      </div>

      <!-- ═══ GROUPED MODE ═══ -->
      <template v-else-if="displayMode === 'grouped'">
        <div v-for="botSection in groupedByBot" :key="botSection.botId" class="mb-1 text-left">
          <div
            class="flex items-center gap-2 px-2 py-1 cursor-pointer rounded hover:bg-surface-800/50 transition-colors"
            @click="toggleBotCollapse(botSection.botId)"
          >
            <span class="text-[11px] text-surface-500">{{ collapsedBots.has(botSection.botId) ? '▸' : '▾' }}</span>
            <span class="font-semibold text-xs text-surface-200">{{ botSection.botName }}</span>
            <span
              class="ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold"
              :style="{ color: sevColor(botSection.maxSeverity), background: sevBg(botSection.maxSeverity) }"
            >{{ botSection.groups.reduce((s, g) => s + g.count, 0) }}</span>
          </div>

          <template v-if="!collapsedBots.has(botSection.botId)">
            <div
              v-for="group in botSection.groups" :key="group.key"
              class="ml-4 px-2 py-0.5 border-l-2"
              :style="{ borderColor: sevColor(group.level) + '60' }"
            >
              <div class="flex items-start gap-2 cursor-pointer" @click="toggleGroupExpand(group.key)">
                <span class="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" :style="{ background: sevColor(group.level) }" />
                <span class="font-mono text-[11px] text-surface-200 flex-1 break-all" @click.stop="copyMessage(group.last.message)">
                  {{ group.last.message }}
                </span>
                <span v-if="group.count > 1" class="text-[10px] font-bold flex-shrink-0" :style="{ color: sevColor(group.level) }">×{{ group.count }}</span>
              </div>
              <div class="flex items-center gap-2 ml-3.5 text-[9px] text-surface-500 mt-0.5">
                <span v-if="group.count > 1">{{ relativeTime(group.last.timestamp) }} → {{ relativeTime(group.first.timestamp) }}</span>
                <span v-else>{{ relativeTime(group.last.timestamp) }}</span>
                <span class="text-surface-600">{{ shortModule(group.module) }}</span>
              </div>

              <!-- Expanded -->
              <div v-if="expandedGroupKey === group.key" class="ml-3.5 mt-1 mb-1 space-y-0.5">
                <div
                  v-for="entry in group.entries.slice(0, 10)" :key="entry.id"
                  class="flex items-start gap-2 text-[10px] rounded px-1.5 py-0.5"
                  :style="{ background: sevBg(entry.level) }"
                >
                  <span class="text-surface-500 flex-shrink-0 font-mono">{{ entry.timestampFormatted }}</span>
                  <span class="text-surface-300 font-mono break-all">{{ entry.message }}</span>
                </div>
                <div v-if="group.entries.length > 10" class="text-[9px] text-surface-500 px-1.5">... +{{ group.entries.length - 10 }}</div>
                <div
                  v-if="group.last.exception"
                  class="mt-1 px-2 py-1 rounded text-[9px] font-mono text-red-300 whitespace-pre-wrap break-all"
                  style="background: rgba(239,68,68,0.08); max-height: 200px; overflow-y: auto"
                >{{ group.last.exception }}</div>
              </div>
            </div>
          </template>
        </div>

        <div v-if="groupedByBot.length === 0 && logStore.initialLoadDone" class="text-center text-surface-400 text-sm py-8">
          {{ t('logViewer.noEntries') }}
        </div>
      </template>

      <!-- ═══ TIMELINE MODE ═══ -->
      <template v-else>
        <template v-if="compactMode">
          <div
            v-for="entry in displayEntries" :key="entry.id"
            class="flex items-baseline gap-2 px-2 py-0.5 font-mono text-[11px] leading-tight"
            :class="[levelBorderClass(entry.level), highlightText && entry.message.toLowerCase().includes(highlightText.toLowerCase()) ? 'ring-1 ring-yellow-500/50 bg-yellow-500/10' : '', logStore.newEntryIds[entry.id] ? 'log-entry-new' : '']"
          >
            <span class="text-surface-500 shrink-0 whitespace-nowrap">{{ entry.timestampFormatted }}</span>
            <span class="shrink-0 w-16 text-center" :class="levelTextClass(entry.level)">{{ entry.level }}</span>
            <span class="shrink-0 px-1 rounded text-[10px] bg-surface-700 text-blue-300 whitespace-nowrap">{{ entry.botName }}</span>
            <span class="shrink-0 px-1 rounded text-[10px] bg-surface-200 dark:bg-surface-700 text-surface-400 whitespace-nowrap">{{ shortModule(entry.module) }}</span>
            <span class="dark:text-surface-200 break-all" @click="copyMessage(entry.message)">{{ entry.message }}</span>
          </div>
        </template>

        <template v-else>
          <div
            v-for="entry in displayEntries" :key="entry.id"
            class="rounded mb-1 p-2"
            :class="[levelBorderClass(entry.level), highlightText && entry.message.toLowerCase().includes(highlightText.toLowerCase()) ? 'ring-1 ring-yellow-500/50 bg-yellow-500/10' : '', logStore.newEntryIds[entry.id] ? 'log-entry-new' : '']"
          >
            <div class="flex items-center gap-2 mb-0.5">
              <span class="text-[10px] text-surface-500">{{ entry.timestampFormatted }}</span>
              <span class="inline-block px-1.5 rounded text-[10px] font-bold" :class="levelTextClass(entry.level)">{{ entry.level }}</span>
              <span class="inline-block px-1.5 rounded text-[10px] bg-surface-700 text-blue-300">{{ entry.botName }}</span>
              <span class="inline-block px-1.5 rounded text-[10px] bg-surface-200 dark:bg-surface-700 text-surface-400">{{ shortModule(entry.module) }}</span>
            </div>
            <div class="text-xs dark:text-surface-200 font-mono whitespace-pre-wrap break-all" @click="copyMessage(entry.message)">{{ entry.message }}</div>
            <div v-if="entry.exception" class="mt-1 px-2 py-1 rounded text-[9px] font-mono text-red-300 whitespace-pre-wrap break-all" style="background: rgba(239,68,68,0.08); max-height: 150px; overflow-y: auto">
              {{ entry.exception }}
            </div>
          </div>
        </template>

        <div v-if="displayEntries.length === 0 && logStore.initialLoadDone" class="text-center text-surface-400 text-sm py-8">
          {{ t('logViewer.noEntries') }}
        </div>
      </template>
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
</style>
