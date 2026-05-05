<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { ClosedTrade, Trade } from '@/types';

const { t } = useI18n();
const botStore = useBotStore();

// --- Types ---
type EventType = 'trade_opened' | 'trade_closed_profit' | 'trade_closed_loss' | 'bot_status' | 'alert' | 'dca';
type TimeGroup = 'today' | 'yesterday' | 'thisWeek' | 'earlier';

interface TimelineEvent {
  id: string;
  timestamp: number;
  botId: string;
  botName: string;
  type: EventType;
  pair?: string;
  direction?: 'long' | 'short';
  profitPct?: number;
  profitAbs?: number;
  durationMs?: number;
  dcaCount?: number;
  stakeAmount?: number;
  annotation?: string;
}

// --- State ---
const compactMode = ref(true);
const searchQuery = ref('');
const selectedBotFilter = ref<string>('all');
const enabledEventTypes = ref<Set<EventType>>(
  new Set(['trade_opened', 'trade_closed_profit', 'trade_closed_loss', 'bot_status', 'alert', 'dca']),
);
const maxEvents = ref(100);

// --- Event type config ---
const eventTypeConfig: Record<EventType, { icon: string; color: string; dotClass: string }> = {
  trade_opened: { icon: 'i-mdi-plus-circle', color: 'text-blue-400', dotClass: 'bg-blue-400 shadow-blue-400/40' },
  trade_closed_profit: { icon: 'i-mdi-check-circle', color: 'text-green-400', dotClass: 'bg-green-400 shadow-green-400/40' },
  trade_closed_loss: { icon: 'i-mdi-close-circle', color: 'text-red-400', dotClass: 'bg-red-400 shadow-red-400/40' },
  bot_status: { icon: 'i-mdi-power', color: 'text-gray-400', dotClass: 'bg-gray-400 shadow-gray-400/40' },
  alert: { icon: 'i-mdi-bell-alert', color: 'text-amber-400', dotClass: 'bg-amber-400 shadow-amber-400/40' },
  dca: { icon: 'i-mdi-layers', color: 'text-purple-400', dotClass: 'bg-purple-400 shadow-purple-400/40' },
};

const eventTypeLabels: { key: EventType; labelKey: string }[] = [
  { key: 'trade_opened', labelKey: 'activityTimeline.filterOpened' },
  { key: 'trade_closed_profit', labelKey: 'activityTimeline.filterClosedProfit' },
  { key: 'trade_closed_loss', labelKey: 'activityTimeline.filterClosedLoss' },
  { key: 'dca', labelKey: 'activityTimeline.filterDca' },
  { key: 'bot_status', labelKey: 'activityTimeline.filterBotStatus' },
  { key: 'alert', labelKey: 'activityTimeline.filterAlert' },
];

// --- Helpers ---
function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return t('activityTimeline.justNow');
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return t('activityTimeline.agoSeconds', { n: diffSec });
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t('activityTimeline.agoMinutes', { n: diffMin });
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return t('activityTimeline.agoHours', { n: diffHours });
  const diffDays = Math.floor(diffHours / 24);
  return t('activityTimeline.agoDays', { n: diffDays });
}

function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

function getTimeGroup(ts: number): TimeGroup {
  const now = new Date();
  const date = new Date(ts);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const weekStart = todayStart - (now.getDay() * 86400000);

  if (ts >= todayStart) return 'today';
  if (ts >= yesterdayStart) return 'yesterday';
  if (ts >= weekStart) return 'thisWeek';
  return 'earlier';
}

const timeGroupOrder: TimeGroup[] = ['today', 'yesterday', 'thisWeek', 'earlier'];

// --- Available bots ---
const availableBots = computed(() => {
  const bots: { id: string; name: string }[] = [];
  for (const [botId, store] of Object.entries(botStore.botStores)) {
    if (!store.isSelected) continue;
    bots.push({ id: botId, name: store.uiBotName || 'Bot' });
  }
  return bots;
});

// --- Build events ---
const allEvents = computed<TimelineEvent[]>(() => {
  const events: TimelineEvent[] = [];

  for (const [botId, store] of Object.entries(botStore.botStores)) {
    if (!store.isSelected) continue;
    const botName = store.uiBotName || 'Bot';

    // Open trades -> trade_opened events + DCA detection
    for (const trade of (store.openTrades as Trade[]) || []) {
      const isDca = (trade.nr_of_successful_entries ?? 1) > 1;

      events.push({
        id: `open-${botId}-${trade.trade_id}`,
        timestamp: trade.open_timestamp,
        botId,
        botName,
        type: 'trade_opened',
        pair: trade.pair,
        direction: trade.is_short ? 'short' : 'long',
      });

      // If DCA, add a DCA event
      if (isDca) {
        events.push({
          id: `dca-${botId}-${trade.trade_id}`,
          timestamp: trade.open_timestamp + 1, // slightly after open
          botId,
          botName,
          type: 'dca',
          pair: trade.pair,
          direction: trade.is_short ? 'short' : 'long',
          dcaCount: trade.nr_of_successful_entries,
          stakeAmount: trade.stake_amount,
        });
      }
    }

    // Closed trades
    const closed = [...((store.trades as ClosedTrade[]) || [])]
      .sort((a, b) => b.close_timestamp - a.close_timestamp)
      .slice(0, 100);

    for (const trade of closed) {
      const profitAbs = trade.profit_abs ?? 0;
      const profitPct = trade.profit_ratio != null ? trade.profit_ratio * 100 : 0;
      const isProfit = profitAbs >= 0;
      const durationMs =
        trade.close_timestamp && trade.open_timestamp
          ? trade.close_timestamp - trade.open_timestamp
          : 0;

      events.push({
        id: `close-${botId}-${trade.trade_id}`,
        timestamp: trade.close_timestamp,
        botId,
        botName,
        type: isProfit ? 'trade_closed_profit' : 'trade_closed_loss',
        pair: trade.pair,
        direction: trade.is_short ? 'short' : 'long',
        profitPct,
        profitAbs,
        durationMs,
        stakeAmount: trade.stake_amount,
      });

      // DCA detection on closed trades
      if ((trade.nr_of_successful_entries ?? 1) > 1) {
        events.push({
          id: `dca-closed-${botId}-${trade.trade_id}`,
          timestamp: trade.open_timestamp + 1,
          botId,
          botName,
          type: 'dca',
          pair: trade.pair,
          direction: trade.is_short ? 'short' : 'long',
          dcaCount: trade.nr_of_successful_entries,
          stakeAmount: trade.stake_amount,
        });
      }
    }
  }

  // Compute annotations for closed trades
  const closedEvents = events.filter(
    (e) => e.type === 'trade_closed_profit' || e.type === 'trade_closed_loss',
  );
  if (closedEvents.length > 0) {
    const avgProfit =
      closedEvents.reduce((s, e) => s + Math.abs(e.profitAbs ?? 0), 0) / closedEvents.length;
    const avgDuration =
      closedEvents.reduce((s, e) => s + (e.durationMs ?? 0), 0) / closedEvents.length;
    let maxStake = 0;
    let maxStakeId = '';
    for (const e of closedEvents) {
      if ((e.stakeAmount ?? 0) > maxStake) {
        maxStake = e.stakeAmount ?? 0;
        maxStakeId = e.id;
      }
    }

    for (const e of closedEvents) {
      const annotations: string[] = [];
      if (Math.abs(e.profitAbs ?? 0) > avgProfit * 2) {
        annotations.push(t('activityTimeline.annotationExceptional'));
      }
      if ((e.durationMs ?? 0) > avgDuration * 2 && avgDuration > 0) {
        annotations.push(t('activityTimeline.annotationLongDuration'));
      }
      if (e.id === maxStakeId && maxStake > 0) {
        annotations.push(t('activityTimeline.annotationLargestTrade'));
      }
      if (annotations.length > 0) {
        e.annotation = annotations.join(' ');
      }
    }
  }

  events.sort((a, b) => b.timestamp - a.timestamp);
  return events;
});

// --- Filtered events ---
const filteredEvents = computed<TimelineEvent[]>(() => {
  let events = allEvents.value;

  // Filter by event type
  events = events.filter((e) => enabledEventTypes.value.has(e.type));

  // Filter by bot
  if (selectedBotFilter.value !== 'all') {
    events = events.filter((e) => e.botId === selectedBotFilter.value);
  }

  // Search filter
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase().trim();
    events = events.filter(
      (e) =>
        (e.pair && e.pair.toLowerCase().includes(q)) ||
        e.botName.toLowerCase().includes(q) ||
        t(`activityTimeline.eventType.${e.type}`).toLowerCase().includes(q),
    );
  }

  return events.slice(0, maxEvents.value);
});

// --- Grouped events ---
const groupedEvents = computed(() => {
  const groups: Map<TimeGroup, TimelineEvent[]> = new Map();
  for (const group of timeGroupOrder) {
    groups.set(group, []);
  }

  for (const event of filteredEvents.value) {
    const group = getTimeGroup(event.timestamp);
    groups.get(group)!.push(event);
  }

  // Return only non-empty groups
  return timeGroupOrder
    .filter((g) => groups.get(g)!.length > 0)
    .map((g) => ({ group: g, events: groups.get(g)! }));
});

// --- Toggle event type filter ---
function toggleEventType(type: EventType) {
  const newSet = new Set(enabledEventTypes.value);
  if (newSet.has(type)) {
    newSet.delete(type);
  } else {
    newSet.add(type);
  }
  enabledEventTypes.value = newSet;
}

// --- Event description ---
function eventDescription(event: TimelineEvent): string {
  switch (event.type) {
    case 'trade_opened': {
      const dir = event.direction === 'short' ? t('activityTimeline.short') : t('activityTimeline.long');
      return `${t('activityTimeline.opened')} ${dir} ${event.pair}`;
    }
    case 'trade_closed_profit':
    case 'trade_closed_loss': {
      const dir = event.direction === 'short' ? t('activityTimeline.short') : t('activityTimeline.long');
      const pct = event.profitPct !== undefined ? `${event.profitPct >= 0 ? '+' : ''}${event.profitPct.toFixed(2)}%` : '';
      return `${t('activityTimeline.closed')} ${dir} ${event.pair} ${pct}`;
    }
    case 'dca': {
      const dir = event.direction === 'short' ? t('activityTimeline.short') : t('activityTimeline.long');
      const stakeStr = event.stakeAmount ? ` +${formatPrice(event.stakeAmount, 2)}` : '';
      return `${t('activityTimeline.dcaAdjustment')} ${dir} ${event.pair} (${event.dcaCount ?? 0} ${t('activityTimeline.entries')}${stakeStr})`;
    }
    case 'bot_status':
      return t('activityTimeline.botStatusChange');
    case 'alert':
      return t('activityTimeline.alertTriggered');
    default:
      return '';
  }
}
</script>

<template>
  <div class="activity-timeline flex flex-col h-full">
    <!-- Filters bar -->
    <div class="filters-bar flex flex-col gap-2 px-3 pt-2 pb-2">
      <!-- Top row: Search + Bot filter + Compact toggle -->
      <div class="flex items-center gap-2">
        <!-- Search -->
        <div
          class="flex items-center flex-1 rounded-lg px-2 py-1"
          style="
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.08);
          "
        >
          <i class="i-mdi-magnify text-surface-400 text-sm mr-1.5" />
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="t('activityTimeline.searchPlaceholder')"
            class="bg-transparent border-none outline-none text-xs text-surface-200 w-full placeholder-surface-500"
          />
        </div>

        <!-- Bot filter -->
        <select
          v-model="selectedBotFilter"
          class="rounded-lg px-2 py-1 text-xs text-surface-200 cursor-pointer"
          style="
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.08);
            outline: none;
          "
        >
          <option value="all">{{ t('activityTimeline.allBots') }}</option>
          <option v-for="bot in availableBots" :key="bot.id" :value="bot.id">
            {{ bot.name }}
          </option>
        </select>

        <!-- Compact toggle -->
        <button
          class="rounded-lg px-2 py-1 text-xs font-medium transition-all duration-200 cursor-pointer"
          :class="
            compactMode
              ? 'bg-primary text-white shadow-sm'
              : 'text-surface-400 hover:text-surface-200 hover:bg-surface-700/50'
          "
          style="
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.06);
          "
          :style="compactMode ? 'background: rgba(99, 102, 241, 0.85)' : ''"
          :title="t('activityTimeline.compactMode')"
          @click="compactMode = !compactMode"
        >
          <i :class="compactMode ? 'i-mdi-view-list' : 'i-mdi-view-agenda'" class="text-sm" />
        </button>
      </div>

      <!-- Event type filter pills -->
      <div class="flex flex-wrap gap-1">
        <button
          v-for="et in eventTypeLabels"
          :key="et.key"
          class="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-all duration-200 cursor-pointer"
          :class="
            enabledEventTypes.has(et.key)
              ? 'opacity-100'
              : 'opacity-40 hover:opacity-60'
          "
          :style="{
            background: enabledEventTypes.has(et.key)
              ? 'rgba(255, 255, 255, 0.08)'
              : 'rgba(255, 255, 255, 0.02)',
            border: '1px solid ' + (enabledEventTypes.has(et.key) ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.04)'),
          }"
          @click="toggleEventType(et.key)"
        >
          <i :class="[eventTypeConfig[et.key].icon, eventTypeConfig[et.key].color]" style="font-size: 0.7rem" />
          <span :class="eventTypeConfig[et.key].color">{{ t(et.labelKey) }}</span>
        </button>
      </div>
    </div>

    <!-- Timeline content -->
    <div class="flex-1 overflow-y-auto px-3 pb-2" style="min-height: 0">
      <!-- Empty state -->
      <div
        v-if="filteredEvents.length === 0"
        class="flex flex-col items-center justify-center py-8 text-surface-500"
      >
        <i class="i-mdi-timeline-clock-outline text-3xl mb-2 opacity-40" />
        <span class="text-xs">{{ t('activityTimeline.noEvents') }}</span>
      </div>

      <!-- Grouped timeline -->
      <div v-for="section in groupedEvents" :key="section.group" class="mb-3">
        <!-- Group header -->
        <div class="flex items-center gap-2 mb-1.5 mt-1">
          <span class="text-xs font-semibold text-surface-400 uppercase tracking-wider">
            {{ t(`activityTimeline.group.${section.group}`) }}
          </span>
          <div class="flex-1 h-px bg-surface-700/50" />
          <span class="text-xs text-surface-500">{{ section.events.length }}</span>
        </div>

        <!-- Events -->
        <div class="relative">
          <!-- Vertical timeline line -->
          <div
            class="absolute left-[9px] top-2 bottom-2 w-px"
            style="background: linear-gradient(to bottom, rgba(255,255,255,0.1), rgba(255,255,255,0.03))"
          />

          <!-- Event cards -->
          <div
            v-for="(event, idx) in section.events"
            :key="event.id"
            class="relative flex items-start gap-3 group rounded-sm"
            :class="[
              compactMode ? 'py-0.5 pl-1 border-l-2' : 'py-1.5',
              compactMode ? (event.type === 'trade_closed_profit' ? 'border-green-500/40' : event.type === 'trade_closed_loss' ? 'border-red-500/40' : event.type === 'trade_opened' ? 'border-blue-500/40' : 'border-surface-500/20') : '',
            ]"
          >
            <!-- Timeline dot -->
            <div class="relative z-10 flex-shrink-0 mt-1">
              <div
                class="w-[18px] h-[18px] rounded-full flex items-center justify-center"
                :class="compactMode ? 'w-[14px] h-[14px]' : ''"
                style="background: rgba(15, 15, 25, 0.9)"
              >
                <div
                  class="rounded-full shadow-md"
                  :class="[
                    eventTypeConfig[event.type].dotClass,
                    compactMode ? 'w-[8px] h-[8px]' : 'w-[10px] h-[10px]',
                  ]"
                />
              </div>
            </div>

            <!-- Compact mode: single line -->
            <div
              v-if="compactMode"
              class="flex-1 flex items-center gap-2 min-w-0 text-xs"
            >
              <span class="text-surface-500 flex-shrink-0" style="font-size: 0.65rem; min-width: 40px">
                {{ timeAgo(event.timestamp) }}
              </span>
              <span
                class="inline-flex items-center rounded px-1 py-px flex-shrink-0"
                style="
                  font-size: 0.6rem;
                  background: rgba(255, 255, 255, 0.06);
                  border: 1px solid rgba(255, 255, 255, 0.06);
                "
              >
                {{ event.botName }}
              </span>
              <span class="truncate" :class="eventTypeConfig[event.type].color">
                {{ eventDescription(event) }}
              </span>
              <span
                v-if="event.profitAbs !== undefined && (event.type === 'trade_closed_profit' || event.type === 'trade_closed_loss')"
                class="flex-shrink-0 font-mono font-semibold"
                :class="(event.profitAbs ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'"
                style="font-size: 0.65rem"
              >
                {{ (event.profitAbs ?? 0) >= 0 ? '+' : '' }}{{ (event.profitAbs ?? 0).toFixed(2) }}
              </span>
            </div>

            <!-- Rich mode: card -->
            <div
              v-else
              class="flex-1 min-w-0 rounded-lg p-2.5 transition-all duration-200 group-hover:border-surface-600/50"
              style="
                background: rgba(255, 255, 255, 0.025);
                border: 1px solid rgba(255, 255, 255, 0.05);
                backdrop-filter: blur(12px);
              "
            >
              <!-- Card header: icon + timestamp + bot badge -->
              <div class="flex items-center gap-2 mb-1">
                <i
                  :class="[eventTypeConfig[event.type].icon, eventTypeConfig[event.type].color]"
                  class="text-sm"
                />
                <span class="text-surface-500" style="font-size: 0.65rem">
                  {{ timeAgo(event.timestamp) }}
                </span>
                <span
                  class="inline-flex items-center rounded-full px-1.5 py-px ml-auto cursor-default"
                  style="
                    font-size: 0.6rem;
                    background: rgba(255, 255, 255, 0.06);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    color: rgba(255, 255, 255, 0.6);
                  "
                  :title="t('activityTimeline.goToTradeView')"
                >
                  {{ event.botName }}
                </span>
              </div>

              <!-- Event description -->
              <div class="text-xs font-medium mb-1" :class="eventTypeConfig[event.type].color">
                {{ eventDescription(event) }}
              </div>

              <!-- Trade details row (for close events) -->
              <div
                v-if="event.type === 'trade_closed_profit' || event.type === 'trade_closed_loss'"
                class="flex items-center gap-3 mt-1.5"
              >
                <!-- Pair -->
                <div class="flex items-center gap-1">
                  <i class="i-mdi-swap-horizontal text-surface-500" style="font-size: 0.7rem" />
                  <span class="text-xs text-surface-300">{{ event.pair }}</span>
                </div>
                <!-- Direction -->
                <div class="flex items-center gap-1">
                  <i
                    :class="event.direction === 'short' ? 'i-mdi-arrow-down text-red-400' : 'i-mdi-arrow-up text-green-400'"
                    style="font-size: 0.7rem"
                  />
                  <span class="text-xs text-surface-400">
                    {{ event.direction === 'short' ? t('activityTimeline.short') : t('activityTimeline.long') }}
                  </span>
                </div>
                <!-- Profit -->
                <div class="flex items-center gap-1">
                  <span
                    class="text-xs font-mono font-semibold"
                    :class="(event.profitAbs ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'"
                  >
                    {{ (event.profitPct ?? 0) >= 0 ? '+' : '' }}{{ (event.profitPct ?? 0).toFixed(2) }}%
                  </span>
                </div>
                <!-- Duration -->
                <div v-if="event.durationMs && event.durationMs > 0" class="flex items-center gap-1">
                  <i class="i-mdi-clock-outline text-surface-500" style="font-size: 0.7rem" />
                  <span class="text-xs text-surface-400">{{ formatDuration(event.durationMs) }}</span>
                </div>
              </div>

              <!-- Trade details for open events -->
              <div
                v-if="event.type === 'trade_opened'"
                class="flex items-center gap-3 mt-1.5"
              >
                <div class="flex items-center gap-1">
                  <i class="i-mdi-swap-horizontal text-surface-500" style="font-size: 0.7rem" />
                  <span class="text-xs text-surface-300">{{ event.pair }}</span>
                </div>
                <div class="flex items-center gap-1">
                  <i
                    :class="event.direction === 'short' ? 'i-mdi-arrow-down text-red-400' : 'i-mdi-arrow-up text-green-400'"
                    style="font-size: 0.7rem"
                  />
                  <span class="text-xs text-surface-400">
                    {{ event.direction === 'short' ? t('activityTimeline.short') : t('activityTimeline.long') }}
                  </span>
                </div>
              </div>

              <!-- DCA details -->
              <div
                v-if="event.type === 'dca'"
                class="flex items-center gap-3 mt-1.5"
              >
                <div class="flex items-center gap-1">
                  <i class="i-mdi-swap-horizontal text-surface-500" style="font-size: 0.7rem" />
                  <span class="text-xs text-surface-300">{{ event.pair }}</span>
                </div>
                <div class="flex items-center gap-1">
                  <i
                    :class="event.direction === 'short' ? 'i-mdi-arrow-down text-red-400' : 'i-mdi-arrow-up text-green-400'"
                    style="font-size: 0.7rem"
                  />
                  <span
                    class="text-xs font-medium rounded px-1 py-px"
                    :class="event.direction === 'short' ? 'text-red-400 bg-red-400/10' : 'text-green-400 bg-green-400/10'"
                    style="font-size: 0.6rem"
                  >
                    {{ event.direction === 'short' ? 'S' : 'L' }}
                  </span>
                </div>
                <div class="flex items-center gap-1">
                  <i class="i-mdi-layers text-purple-400" style="font-size: 0.7rem" />
                  <span class="text-xs text-surface-400">
                    {{ event.dcaCount }} {{ t('activityTimeline.entries') }}
                  </span>
                </div>
                <div v-if="event.stakeAmount" class="flex items-center gap-1">
                  <i class="i-mdi-cash-plus text-surface-500" style="font-size: 0.7rem" />
                  <span class="text-xs text-surface-400">
                    +{{ formatPrice(event.stakeAmount, 2) }}
                  </span>
                </div>
              </div>

              <!-- Annotation for notable trades -->
              <div
                v-if="event.annotation"
                class="mt-1.5 text-xs font-medium text-amber-300/90 bg-amber-400/5 rounded px-2 py-0.5 inline-block"
                style="border: 1px solid rgba(251, 191, 36, 0.1)"
              >
                {{ event.annotation }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.activity-timeline {
  width: 100%;
  height: 100%;
  scrollbar-width: thin;
  scrollbar-color: #374151 transparent;
}

.activity-timeline ::-webkit-scrollbar {
  width: 4px;
}

.activity-timeline ::-webkit-scrollbar-track {
  background: transparent;
}

.activity-timeline ::-webkit-scrollbar-thumb {
  background: #374151;
  border-radius: 4px;
}

.bg-primary {
  background-color: rgba(99, 102, 241, 0.85);
}

select option {
  background: #1a1a2e;
  color: #e0e0e0;
}

/* Subtle entrance animation for new events */
.group {
  animation: fadeSlideIn 0.3s ease-out;
}

@keyframes fadeSlideIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
