<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useDaemonHealth } from '@/composables/useDaemonHealth';
import type { FleetBotStatus, FleetEvent } from '@/types';
import { usePopoverHover, trackMouse } from '@/composables/usePopoverHover';
import Popover from 'primevue/popover';

const { t } = useI18n();
const { state, healthLevel, healthScore, secondsSinceRefresh, fetchAll } = useDaemonHealth();

const {
  popoverRef: botPopoverRef,
  hoveredValue: hoveredBot,
  startHover: startBotHover,
  cancelHover: cancelBotHover,
  keepPopover: keepBotPopover,
  hide: hideBotPopover,
} = usePopoverHover<FleetBotStatus>(300);

const {
  popoverRef: eventPopoverRef,
  hoveredValue: hoveredEvent,
  startHover: startEventHover,
  cancelHover: cancelEventHover,
  keepPopover: keepEventPopover,
  hide: hideEventPopover,
} = usePopoverHover<FleetEvent>(300);

const showEvents = ref(true);

const bots = computed(() => {
  const list = state.fleet?.bots ?? [];
  const order: Record<string, number> = {
    crashed: 0, initializing: 1, running: 2, paused: 3, stopped: 4,
  };
  return [...list].sort((a, b) => (order[a.state] ?? 5) - (order[b.state] ?? 5));
});

const daemon = computed(() => state.fleet?.daemon);
const rateLimiters = computed(() => state.fleet?.rate_limiters ?? {});
const ftcache = computed(() => state.cache?.ftcache);
const pairlistCache = computed(() => state.cache?.pairlist_cache);

const botsRunning = computed(() => bots.value.filter((b) => b.state === 'running').length);
const botsCrashed = computed(() => bots.value.filter((b) => b.state === 'crashed').length);
const botsTotal = computed(() => bots.value.length);

function formatUptime(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return `${h}h${m > 0 ? ` ${m}m` : ''}`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function healthColor(level: string): string {
  switch (level) {
    case 'healthy': return '#22c55e';
    case 'degraded': return '#f59e0b';
    case 'critical': return '#ef4444';
    default: return '#64748b';
  }
}

function stateColor(s: string): string {
  switch (s) {
    case 'running': return 'bg-green-500/15 text-green-400 border-green-500/30';
    case 'initializing': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'paused': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'crashed': return 'bg-red-500/15 text-red-400 border-red-500/30';
    case 'stopped': return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
    default: return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
  }
}

function exchangeShort(exchange: string, mode: string): string {
  const map: Record<string, string> = {
    hyperliquid: 'HL', binance: 'BN', gateio: 'GI', gate: 'GI', kucoin: 'KU',
  };
  const ex = map[exchange.toLowerCase()] ?? exchange.substring(0, 2).toUpperCase();
  return ex + (mode === 'futures' ? '/F' : '/S');
}

function heartbeatColor(s: number): string {
  if (s > 120) return 'text-red-400';
  if (s > 60) return 'text-amber-400';
  return 'text-green-400';
}

function eventTypeIcon(type: string): string {
  switch (type) {
    case 'bot_connect': return '↗';
    case 'bot_disconnect': return '↘';
    case 'bot_crash': return '✕';
    case 'rate_limit_429': return '⚡';
    case 'backoff_start': return '⏸';
    case 'backoff_end': return '▶';
    case 'stagger_applied': return '⧖';
    default: return '●';
  }
}

function eventTypeColor(type: string): string {
  if (type === 'bot_crash' || type === 'rate_limit_429') return 'text-red-400';
  if (type === 'backoff_start') return 'text-amber-400';
  if (type === 'bot_connect' || type === 'backoff_end') return 'text-green-400';
  return 'text-slate-400';
}

function formatEventDetails(evt: FleetEvent): string {
  const d = evt.details;
  if (!d || Object.keys(d).length === 0) return '';
  if (evt.event_type === 'rate_limit_429') {
    return [d.exchange, d.pair, d.timeframe].filter(Boolean).join(' · ');
  }
  if (evt.event_type === 'backoff_start') {
    return `${d.label ?? ''} ${d.duration_s ?? ''}s L${d.level ?? '?'}/${d.level !== undefined ? 3 : '?'}`;
  }
  if (evt.event_type === 'bot_connect' || evt.event_type === 'bot_disconnect') {
    return (d.exchange as string) ?? '';
  }
  return Object.entries(d).map(([k, v]) => `${k}=${v}`).join(' ');
}

async function copyToClipboard(text: string) {
  try { await navigator.clipboard.writeText(text); } catch { /* noop */ }
}

const refreshProgress = computed(() => {
  const maxS = 10;
  return Math.min(100, (secondsSinceRefresh.value / maxS) * 100);
});
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden" @mousemove="trackMouse">
    <!-- Refresh progress bar -->
    <div class="h-0.5 w-full bg-surface-800 shrink-0">
      <div
        class="h-full transition-all duration-1000 ease-linear"
        :style="{ width: `${refreshProgress}%`, backgroundColor: healthColor(healthLevel) }"
      />
    </div>

    <div class="flex flex-col gap-2 p-2 overflow-auto grow">
      <!-- Skeleton loading -->
      <template v-if="state.loading && !state.fleet">
        <div class="flex items-center gap-2 mb-1">
          <div class="w-3 h-3 rounded-full bg-surface-700 animate-pulse" />
          <div class="h-3 w-24 bg-surface-700 rounded animate-pulse" />
        </div>
        <div v-for="i in 4" :key="i" class="h-6 bg-surface-800 rounded animate-pulse" />
      </template>

      <template v-else>
        <!-- Health header -->
        <div class="flex items-center gap-2">
          <div
            class="w-3 h-3 rounded-full shrink-0 transition-colors duration-500"
            :class="{ 'animate-pulse': healthLevel === 'critical' }"
            :style="{ backgroundColor: healthColor(healthLevel) }"
          />
          <span class="text-sm font-semibold">
            {{ t('infraHealth.title') }}
          </span>
          <span
            class="ml-auto text-xs font-mono px-1.5 py-0.5 rounded transition-colors duration-500"
            :style="{
              color: healthColor(healthLevel),
              backgroundColor: healthColor(healthLevel) + '15',
            }"
          >
            {{ healthScore }}
          </span>
        </div>

        <!-- Quick stats row -->
        <div class="flex items-center gap-3 text-xs flex-wrap">
          <span v-if="daemon" class="text-surface-400">
            <i-mdi-clock-outline class="w-3.5 h-3.5 inline align-text-bottom" />
            {{ formatUptime(daemon.uptime_s) }}
          </span>
          <span :class="botsCrashed > 0 ? 'text-red-400 font-semibold' : 'text-surface-400'">
            <i-mdi-robot class="w-3.5 h-3.5 inline align-text-bottom" />
            {{ botsRunning }}/{{ botsTotal }}
            <span v-if="botsCrashed > 0"> · {{ botsCrashed }} crashed</span>
          </span>
          <span v-if="ftcache?.online" class="text-surface-400">
            <i-mdi-database class="w-3.5 h-3.5 inline align-text-bottom" />
            {{ (ftcache.hit_rate_pct ?? 0).toFixed(0) }}% hit
          </span>
          <span class="ml-auto text-surface-500 text-[10px]">
            {{ secondsSinceRefresh }}s ago
          </span>
        </div>

        <!-- Rate limiters compact -->
        <div v-if="Object.keys(rateLimiters).length > 0" class="flex gap-2 flex-wrap">
          <div
            v-for="(rl, exchange) in rateLimiters"
            :key="exchange as string"
            class="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors duration-300"
            :class="rl.backoff_active
              ? 'bg-red-500/10 border-red-500/30 text-red-400'
              : 'bg-surface-800 border-surface-700 text-surface-300'"
          >
            <span class="font-semibold">{{ (exchange as string).substring(0, 2).toUpperCase() }}</span>
            <span class="font-mono">{{ rl.tokens_available.toFixed(0) }}/{{ rl.tokens_max }}</span>
            <span
              v-if="rl.backoff_active"
              class="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"
            />
          </div>
        </div>

        <!-- Bot table -->
        <div v-if="bots.length > 0" class="text-xs">
          <div class="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 gap-y-0.5">
            <!-- Header -->
            <span class="text-surface-500 font-semibold pb-0.5 border-b border-surface-800">{{ t('infraHealth.bot') }}</span>
            <span class="text-surface-500 font-semibold pb-0.5 border-b border-surface-800 text-center">{{ t('infraHealth.state') }}</span>
            <span class="text-surface-500 font-semibold pb-0.5 border-b border-surface-800 text-right">{{ t('infraHealth.pairs') }}</span>
            <span class="text-surface-500 font-semibold pb-0.5 border-b border-surface-800 text-right">{{ t('infraHealth.uptime') }}</span>
            <span class="text-surface-500 font-semibold pb-0.5 border-b border-surface-800 text-right">{{ t('infraHealth.hb') }}</span>

            <!-- Rows -->
            <template v-for="bot in bots" :key="bot.bot_id">
              <span
                class="truncate py-0.5 cursor-default max-w-[140px]"
                @mouseenter="startBotHover($event, bot)"
                @mouseleave="cancelBotHover()"
              >
                <code class="text-[10px] text-surface-400 mr-1">{{ exchangeShort(bot.exchange, bot.trading_mode) }}</code>
                <span class="font-medium">{{ bot.bot_id }}</span>
                <span v-if="bot.dry_run" class="text-[9px] ml-0.5 text-blue-400">DRY</span>
              </span>
              <span class="text-center py-0.5">
                <span
                  class="inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-semibold border transition-all duration-300"
                  :class="stateColor(bot.state)"
                >
                  {{ bot.state }}
                </span>
              </span>
              <span class="text-right py-0.5 font-mono text-surface-300">{{ bot.pairs_count }}</span>
              <span class="text-right py-0.5 font-mono text-surface-400">{{ formatUptime(bot.uptime_s) }}</span>
              <span class="text-right py-0.5 font-mono" :class="heartbeatColor(bot.last_heartbeat_ago_s)">
                {{ Math.round(bot.last_heartbeat_ago_s) }}s
              </span>
            </template>
          </div>
        </div>

        <!-- Cache daemons compact -->
        <div class="flex gap-3 text-xs">
          <div class="flex items-center gap-1">
            <span
              class="w-1.5 h-1.5 rounded-full transition-colors duration-300"
              :class="ftcache?.online ? 'bg-green-500' : 'bg-red-500'"
            />
            <span class="text-surface-400">ftcache</span>
            <span v-if="ftcache?.online" class="font-mono text-surface-300">
              {{ ftcache.series_count ?? 0 }}s · {{ ftcache.active_clients ?? 0 }}c
            </span>
            <span v-else class="text-surface-500">offline</span>
          </div>
          <div class="flex items-center gap-1">
            <span
              class="w-1.5 h-1.5 rounded-full transition-colors duration-300"
              :class="pairlistCache?.online ? 'bg-green-500' : 'bg-red-500'"
            />
            <span class="text-surface-400">ftpairlist</span>
            <span v-if="pairlistCache?.online" class="font-mono text-surface-300">
              {{ (pairlistCache.hit_rate_pct ?? 0).toFixed(0) }}% · {{ pairlistCache.entries ?? 0 }}e
            </span>
            <span v-else class="text-surface-500">offline</span>
          </div>
        </div>

        <!-- Event log toggle -->
        <div class="flex items-center gap-1">
          <button
            class="text-xs text-surface-400 hover:text-surface-200 transition-colors flex items-center gap-1"
            @click="showEvents = !showEvents"
          >
            <i-mdi-chevron-right
              class="w-3.5 h-3.5 transition-transform duration-200"
              :class="{ 'rotate-90': showEvents }"
            />
            {{ t('infraHealth.events') }}
            <span v-if="state.events.length" class="font-mono text-surface-500">({{ state.events.length }})</span>
          </button>
        </div>

        <!-- Event log -->
        <Transition name="slide-down">
          <div v-if="showEvents && state.events.length > 0" class="max-h-[180px] overflow-auto text-xs space-y-px">
            <div
              v-for="(evt, idx) in state.events.slice(0, 100)"
              :key="idx"
              class="flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-surface-800/60 cursor-default transition-colors"
              @mouseenter="startEventHover($event, evt)"
              @mouseleave="cancelEventHover()"
            >
              <span class="text-surface-500 font-mono text-[10px] shrink-0 w-[55px]">
                {{ formatTimestamp(evt.ts) }}
              </span>
              <span class="shrink-0 w-4 text-center" :class="eventTypeColor(evt.event_type)">
                {{ eventTypeIcon(evt.event_type) }}
              </span>
              <span class="truncate text-surface-300">
                <span v-if="evt.bot_id" class="font-medium mr-1">{{ evt.bot_id }}</span>
                <span class="text-surface-500">{{ formatEventDetails(evt) }}</span>
              </span>
            </div>
          </div>
        </Transition>
      </template>
    </div>

    <!-- Bot popover -->
    <Popover ref="botPopoverRef" :dismiss-able="false" class="!p-0" @mouseenter="keepBotPopover" @mouseleave="hideBotPopover">
      <div v-if="hoveredBot" class="p-3 text-xs space-y-2 min-w-[220px] max-w-[300px]">
        <div class="flex items-center gap-2">
          <span class="font-semibold text-sm">{{ hoveredBot.bot_id }}</span>
          <span
            class="px-1.5 py-0 rounded-full text-[10px] font-semibold border"
            :class="stateColor(hoveredBot.state)"
          >
            {{ hoveredBot.state }}
          </span>
        </div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1">
          <div><span class="text-surface-500">Strategy</span></div>
          <div class="font-mono truncate">{{ hoveredBot.strategy }}</div>
          <div><span class="text-surface-500">Exchange</span></div>
          <div class="font-mono">{{ hoveredBot.exchange }} ({{ hoveredBot.trading_mode }})</div>
          <div><span class="text-surface-500">Timeframe</span></div>
          <div class="font-mono">{{ hoveredBot.timeframe }}</div>
          <div><span class="text-surface-500">Pairs</span></div>
          <div class="font-mono">{{ hoveredBot.pairs_count }}</div>
          <div><span class="text-surface-500">Uptime</span></div>
          <div class="font-mono">{{ formatUptime(hoveredBot.uptime_s) }}</div>
          <div><span class="text-surface-500">Heartbeat</span></div>
          <div class="font-mono" :class="heartbeatColor(hoveredBot.last_heartbeat_ago_s)">
            {{ Math.round(hoveredBot.last_heartbeat_ago_s) }}s ago
          </div>
          <div><span class="text-surface-500">PID</span></div>
          <div class="font-mono">{{ hoveredBot.pid }}</div>
          <div><span class="text-surface-500">API Port</span></div>
          <div class="font-mono">{{ hoveredBot.api_port }}</div>
        </div>
        <div class="flex gap-1 pt-1 border-t border-surface-700">
          <button
            class="text-[10px] text-surface-400 hover:text-surface-200 px-1.5 py-0.5 rounded bg-surface-800 hover:bg-surface-700 transition-colors"
            @click="copyToClipboard(String(hoveredBot.pid))"
          >
            Copy PID
          </button>
          <button
            class="text-[10px] text-surface-400 hover:text-surface-200 px-1.5 py-0.5 rounded bg-surface-800 hover:bg-surface-700 transition-colors"
            @click="copyToClipboard(hoveredBot.config_file ?? '')"
          >
            Copy Config
          </button>
          <button
            class="text-[10px] text-surface-400 hover:text-surface-200 px-1.5 py-0.5 rounded bg-surface-800 hover:bg-surface-700 transition-colors"
            @click="copyToClipboard(`http://localhost:${hoveredBot.api_port}`)"
          >
            Copy URL
          </button>
        </div>
      </div>
    </Popover>

    <!-- Event popover -->
    <Popover ref="eventPopoverRef" :dismiss-able="false" class="!p-0" @mouseenter="keepEventPopover" @mouseleave="hideEventPopover">
      <div v-if="hoveredEvent" class="p-3 text-xs space-y-1.5 min-w-[200px] max-w-[320px]">
        <div class="flex items-center gap-2">
          <span :class="eventTypeColor(hoveredEvent.event_type)" class="font-semibold">
            {{ hoveredEvent.event_type }}
          </span>
          <span class="text-surface-500 font-mono text-[10px] ml-auto">
            {{ new Date(hoveredEvent.ts * 1000).toLocaleString() }}
          </span>
        </div>
        <div v-if="hoveredEvent.bot_id">
          <span class="text-surface-500">Bot:</span>
          <span class="font-mono ml-1">{{ hoveredEvent.bot_id }}</span>
        </div>
        <div v-if="hoveredEvent.details && Object.keys(hoveredEvent.details).length > 0" class="space-y-0.5">
          <div v-for="(v, k) in hoveredEvent.details" :key="k as string" class="flex gap-2">
            <span class="text-surface-500 shrink-0">{{ k }}:</span>
            <span class="font-mono text-surface-300 truncate">{{ v }}</span>
          </div>
        </div>
      </div>
    </Popover>
  </div>
</template>

<style scoped>
.slide-down-enter-active,
.slide-down-leave-active {
  transition: max-height 200ms ease, opacity 200ms ease;
  overflow: hidden;
}
.slide-down-enter-from,
.slide-down-leave-to {
  max-height: 0;
  opacity: 0;
}
.slide-down-enter-to,
.slide-down-leave-from {
  max-height: 200px;
  opacity: 1;
}
</style>
