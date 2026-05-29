<script setup lang="ts">
import type { ClosedTrade, Trade } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const botStore = useBotStore();
const replayStore = useReplayStore();

const props = withDefaults(
  defineProps<{
    trades: ClosedTrade[];
    openTrades?: Trade[];
  }>(),
  {
    openTrades: () => [],
  },
);

// --- State ---
const selectedBotFilter = ref<string>('all');
const selectedEventType = ref<string>('all');
const maxEntries = 100;

// --- Types ---
type EventKind = 'open' | 'close_profit' | 'close_loss';

interface LogEntry {
  id: string;
  timestamp: number;
  botId: string;
  botName: string;
  eventKind: EventKind;
  pair: string;
  direction: string;
  profitPct: number | null;
  profitAbs: number | null;
  replay: boolean;
}

// --- Build log entries ---
const logEntries = computed<LogEntry[]>(() => {
  const entries: LogEntry[] = [];

  // Open trades as "open" events
  for (const trade of props.openTrades) {
    entries.push({
      id: `open-${trade.botTradeId}`,
      timestamp: trade.open_timestamp,
      botId: trade.botId,
      botName: trade.botName || trade.botId,
      eventKind: 'open',
      pair: trade.pair,
      direction: trade.is_short ? 'short' : 'long',
      profitPct: null,
      profitAbs: null,
      replay: replayStore.isReplayTrade(trade.enter_tag),
    });
  }

  // Closed trades as "close" events
  for (const trade of props.trades) {
    const profitAbs = trade.profit_abs ?? 0;
    const profitPct = trade.profit_pct ?? trade.profit_ratio ? (trade.profit_ratio ?? 0) * 100 : 0;
    const isProfit = profitAbs >= 0;

    entries.push({
      id: `close-${trade.botTradeId}`,
      timestamp: trade.close_timestamp,
      botId: trade.botId,
      botName: trade.botName || trade.botId,
      eventKind: isProfit ? 'close_profit' : 'close_loss',
      pair: trade.pair,
      direction: trade.is_short ? 'short' : 'long',
      profitPct,
      profitAbs,
      replay: replayStore.isReplayTrade(trade.enter_tag),
    });
  }

  // Sort newest first
  entries.sort((a, b) => b.timestamp - a.timestamp);

  return entries.slice(0, maxEntries);
});

// --- Bot IDs for filter ---
const botIds = computed(() => {
  const ids = new Set<string>();
  for (const e of logEntries.value) {
    ids.add(e.botId);
  }
  return Array.from(ids);
});

function getBotName(botId: string): string {
  const desc = botStore.availableBots[botId];
  return desc?.botName ?? botId;
}

// --- Filtered entries ---
const filteredEntries = computed(() => {
  return logEntries.value.filter((e) => {
    if (selectedBotFilter.value !== 'all' && e.botId !== selectedBotFilter.value) return false;
    if (selectedEventType.value === 'open' && e.eventKind !== 'open') return false;
    if (selectedEventType.value === 'close' && !e.eventKind.startsWith('close')) return false;
    return true;
  });
});

// --- Helpers ---
function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return 'now';
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d`;
}

function rowClass(entry: LogEntry): string {
  switch (entry.eventKind) {
    case 'close_profit':
      return 'border-l-2 border-green-500/50 bg-green-500/5';
    case 'close_loss':
      return 'border-l-2 border-red-500/50 bg-red-500/5';
    default:
      return 'border-l-2 border-blue-500/30 bg-blue-500/5';
  }
}

function eventIcon(kind: EventKind): string {
  switch (kind) {
    case 'open':
      return 'i-mdi-plus-circle';
    case 'close_profit':
      return 'i-mdi-check-circle';
    case 'close_loss':
      return 'i-mdi-close-circle';
  }
}

function eventColor(kind: EventKind): string {
  switch (kind) {
    case 'open':
      return 'text-blue-400';
    case 'close_profit':
      return 'text-green-400';
    case 'close_loss':
      return 'text-red-400';
  }
}

// BOT_COLORS palette matching CumulativeProfitEnhanced
const BOT_COLORS = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#4dc9f6',
];

function botBadgeColor(botId: string): string {
  const idx = botIds.value.indexOf(botId);
  return BOT_COLORS[idx % BOT_COLORS.length] ?? BOT_COLORS[0];
}
</script>

<template>
  <div class="trades-log-enhanced flex flex-col h-full">
    <!-- Filters bar -->
    <div class="flex flex-wrap items-center gap-2 px-2 pt-1 pb-1">
      <!-- Bot filter -->
      <div
        class="flex rounded-lg overflow-hidden"
        style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.06)"
      >
        <button
          class="px-2 py-1 text-xs font-medium transition-all duration-200 cursor-pointer"
          :class="
            selectedBotFilter === 'all'
              ? 'bg-primary text-white shadow-sm'
              : 'text-surface-400 hover:text-surface-200 hover:bg-surface-700/50'
          "
          style="border: none; outline: none"
          @click="selectedBotFilter = 'all'"
        >
          {{ t('tradesLog.allBots') }}
        </button>
        <button
          v-for="bid in botIds"
          :key="bid"
          class="px-2 py-1 text-xs font-medium transition-all duration-200 cursor-pointer"
          :class="
            selectedBotFilter === bid
              ? 'bg-primary text-white shadow-sm'
              : 'text-surface-400 hover:text-surface-200 hover:bg-surface-700/50'
          "
          style="border: none; outline: none"
          @click="selectedBotFilter = bid"
        >
          {{ getBotName(bid) }}
        </button>
      </div>

      <!-- Event type filter -->
      <div
        class="flex rounded-lg overflow-hidden ml-auto"
        style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.06)"
      >
        <button
          v-for="et in [
            { key: 'all', label: t('tradesLog.filterAll') },
            { key: 'open', label: t('tradesLog.filterOpens') },
            { key: 'close', label: t('tradesLog.filterCloses') },
          ]"
          :key="et.key"
          class="px-2 py-1 text-xs font-medium transition-all duration-200 cursor-pointer"
          :class="
            selectedEventType === et.key
              ? 'bg-primary text-white shadow-sm'
              : 'text-surface-400 hover:text-surface-200 hover:bg-surface-700/50'
          "
          style="border: none; outline: none"
          @click="selectedEventType = et.key"
        >
          {{ et.label }}
        </button>
      </div>
    </div>

    <!-- Log entries -->
    <div class="flex-1 min-h-0 overflow-y-auto px-1">
      <div
        v-if="filteredEntries.length === 0"
        class="flex items-center justify-center h-full text-surface-400 text-sm"
      >
        {{ t('tradesLog.noEntries') }}
      </div>
      <div
        v-for="entry in filteredEntries"
        :key="entry.id"
        class="flex items-center gap-2 px-2 py-1.5 mb-0.5 rounded text-xs transition-colors"
        :class="rowClass(entry)"
      >
        <!-- Timestamp -->
        <span class="text-surface-500 w-8 text-right shrink-0" :title="timestampToDateString(entry.timestamp)">
          {{ timeAgo(entry.timestamp) }}
        </span>

        <!-- Bot badge -->
        <span
          class="px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 text-white"
          :style="{ backgroundColor: botBadgeColor(entry.botId) + 'CC' }"
          :title="entry.botName"
        >
          {{ entry.botName.length > 8 ? entry.botName.slice(0, 8) + '..' : entry.botName }}
        </span>

        <!-- Event icon -->
        <component
          :is="eventIcon(entry.eventKind)"
          class="w-4 h-4 shrink-0"
          :class="eventColor(entry.eventKind)"
        />

        <!-- Pair + direction -->
        <span class="font-medium text-surface-200 truncate">
          {{ entry.pair }}
          <span
            v-if="entry.replay"
            class="inline-block px-1 py-0.5 rounded text-[8px] font-bold bg-amber-500/20 text-amber-500 align-middle"
            :title="t('botComparison.replay.tradeBadgeHint')"
            >{{ t('botComparison.replay.tradeBadge') }}</span
          >
          <span
            class="text-[10px] ml-0.5"
            :class="entry.direction === 'short' ? 'text-red-300' : 'text-green-300'"
          >
            {{ entry.direction === 'short' ? 'S' : 'L' }}
          </span>
        </span>

        <!-- Profit (for closes) -->
        <span
          v-if="entry.eventKind !== 'open'"
          class="ml-auto font-semibold shrink-0"
          :class="(entry.profitAbs ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'"
        >
          {{ formatPrice(entry.profitAbs ?? 0, 2) }}
          <span class="text-surface-500 text-[10px]">
            ({{ formatPrice(entry.profitPct ?? 0, 1) }}%)
          </span>
        </span>
        <span v-else class="ml-auto text-surface-500 text-[10px] italic">
          {{ t('tradesLog.opened') }}
        </span>
      </div>
    </div>

    <!-- Stats footer -->
    <div
      class="grid grid-cols-4 gap-2 px-3 py-2 mt-1 text-xs rounded-lg"
      style="
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        backdrop-filter: blur(12px);
      "
    >
      <div class="flex flex-col items-center">
        <span class="text-surface-400">{{ t('tradesLog.statTotal') }}</span>
        <span class="font-semibold text-surface-200">{{ filteredEntries.length }}</span>
      </div>
      <div class="flex flex-col items-center">
        <span class="text-surface-400">{{ t('tradesLog.statOpens') }}</span>
        <span class="font-semibold text-blue-400">
          {{ filteredEntries.filter((e) => e.eventKind === 'open').length }}
        </span>
      </div>
      <div class="flex flex-col items-center">
        <span class="text-surface-400">{{ t('tradesLog.statWins') }}</span>
        <span class="font-semibold text-green-400">
          {{ filteredEntries.filter((e) => e.eventKind === 'close_profit').length }}
        </span>
      </div>
      <div class="flex flex-col items-center">
        <span class="text-surface-400">{{ t('tradesLog.statLosses') }}</span>
        <span class="font-semibold text-red-400">
          {{ filteredEntries.filter((e) => e.eventKind === 'close_loss').length }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trades-log-enhanced {
  width: 100%;
  height: 100%;
}

.bg-primary {
  background-color: rgba(99, 102, 241, 0.85);
}
</style>
