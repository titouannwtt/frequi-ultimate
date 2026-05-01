<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { FleetStatusResponse, FleetEvent } from '@/types';

const botStore = useBotStore();

const fleetStatus = ref<FleetStatusResponse | null>(null);
const fleetEvents = ref<FleetEvent[]>([]);
const loading = ref(false);
const error = ref('');

const refreshInterval = ref<ReturnType<typeof setInterval> | null>(null);

const bots = computed(() => fleetStatus.value?.bots ?? []);
const daemon = computed(() => fleetStatus.value?.daemon);
const rateLimiters = computed(() => fleetStatus.value?.rate_limiters ?? {});
const recentCounts = computed(() => fleetStatus.value?.recent_events_count ?? {});

const sortedBots = computed(() =>
  [...bots.value].sort((a, b) => {
    const stateOrder: Record<string, number> = {
      crashed: 0,
      initializing: 1,
      running: 2,
      paused: 3,
      stopped: 4,
    };
    return (stateOrder[a.state] ?? 5) - (stateOrder[b.state] ?? 5);
  }),
);

function stateClass(state: string): string {
  switch (state) {
    case 'running':
      return 'text-success';
    case 'initializing':
      return 'text-warning';
    case 'paused':
      return 'text-warning';
    case 'crashed':
      return 'text-danger';
    case 'stopped':
      return 'text-secondary';
    default:
      return '';
  }
}

function stateBadge(state: string): string {
  switch (state) {
    case 'running':
      return 'success';
    case 'initializing':
      return 'warning';
    case 'paused':
      return 'warning';
    case 'crashed':
      return 'danger';
    case 'stopped':
      return 'secondary';
    default:
      return 'info';
  }
}

function eventIcon(type: string): string {
  switch (type) {
    case 'bot_connect':
      return '+';
    case 'bot_disconnect':
      return '-';
    case 'bot_crash':
      return '!';
    case 'rate_limit_429':
      return '429';
    case 'backoff_start':
      return 'BO';
    case 'backoff_end':
      return 'OK';
    case 'stagger_applied':
      return 'ST';
    default:
      return '?';
  }
}

function eventClass(type: string): string {
  if (type === 'bot_crash' || type === 'rate_limit_429') return 'text-danger';
  if (type === 'backoff_start') return 'text-warning';
  if (type === 'bot_connect' || type === 'backoff_end') return 'text-success';
  return '';
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString();
}

function formatUptime(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
}

function heartbeatClass(s: number): string {
  if (s > 120) return 'text-danger';
  if (s > 60) return 'text-warning';
  return 'text-success';
}

function exchangeShort(exchange: string, tradingMode: string): string {
  const map: Record<string, string> = {
    hyperliquid: 'HL',
    binance: 'BN',
    gateio: 'GI',
    gate: 'GI',
    kucoin: 'KU',
  };
  const ex = map[exchange.toLowerCase()] ?? exchange.substring(0, 2).toUpperCase();
  const tm = tradingMode === 'futures' ? '/fut' : '/spot';
  return ex + tm;
}

async function fetchData() {
  loading.value = true;
  error.value = '';
  try {
    const activeBot = botStore.activeBot;
    if (!activeBot?.isBotOnline) {
      error.value = 'No bot online';
      return;
    }
    const statusResp = await activeBot.getFleetStatus();
    if (statusResp && !statusResp.error) {
      fleetStatus.value = statusResp;
    } else {
      error.value = statusResp?.error ?? 'Fleet data unavailable';
    }

    // Fetch recent events (last hour)
    try {
      const since = Date.now() / 1000 - 3600;
      const evtData = await activeBot.getFleetEvents(since, 50);
      if (evtData?.events) {
        fleetEvents.value = evtData.events;
      }
    } catch {
      // Events are optional
    }
  } catch {
    error.value = 'Failed to fetch fleet status';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  fetchData();
  refreshInterval.value = setInterval(fetchData, 10000);
});

onUnmounted(() => {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value);
  }
});
</script>

<template>
  <div class="fleet-overview">
    <!-- Header -->
    <div class="d-flex justify-content-between align-items-center mb-2">
      <div>
        <span v-if="daemon" class="text-muted small">
          {{ bots.length }} bots &middot; {{ formatUptime(daemon.uptime_s) }} uptime
          &middot; {{ daemon.total_series }} series
        </span>
      </div>
      <div>
        <span
          v-for="(count, type) in recentCounts"
          :key="type"
          class="badge me-1"
          :class="{
            'bg-danger': type === 'bot_crash' || type === 'rate_limit_429',
            'bg-warning': type === 'backoff_start',
            'bg-success': type === 'bot_connect',
            'bg-secondary':
              type !== 'bot_crash' &&
              type !== 'rate_limit_429' &&
              type !== 'backoff_start' &&
              type !== 'bot_connect',
          }"
        >
          {{ type }}: {{ count }}
        </span>
      </div>
    </div>

    <!-- Error state -->
    <div v-if="error" class="alert alert-warning py-1 small">
      {{ error }}
    </div>

    <!-- Bot table -->
    <div v-if="bots.length > 0" class="table-responsive">
      <table class="table table-sm table-hover mb-2">
        <thead>
          <tr class="small text-muted">
            <th>Bot</th>
            <th>Exchange</th>
            <th>Strategy</th>
            <th>Pairs</th>
            <th>State</th>
            <th>Uptime</th>
            <th>HB</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="bot in sortedBots" :key="bot.bot_id">
            <td class="text-nowrap">
              <span class="fw-semibold">{{ bot.bot_id }}</span>
              <span v-if="bot.dry_run" class="badge bg-info ms-1 small">DRY</span>
            </td>
            <td>
              <code class="small">{{ exchangeShort(bot.exchange, bot.trading_mode) }}</code>
            </td>
            <td class="small text-truncate" style="max-width: 150px">
              {{ bot.strategy }}
            </td>
            <td class="text-center">{{ bot.pairs_count }}</td>
            <td>
              <span class="badge" :class="`bg-${stateBadge(bot.state)}`">
                {{ bot.state.toUpperCase() }}
              </span>
            </td>
            <td class="small">{{ formatUptime(bot.uptime_s) }}</td>
            <td :class="heartbeatClass(bot.last_heartbeat_ago_s)" class="small">
              {{ Math.round(bot.last_heartbeat_ago_s) }}s
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Rate limiters -->
    <div v-if="Object.keys(rateLimiters).length > 0" class="mb-2">
      <div v-for="(rl, exchange) in rateLimiters" :key="exchange" class="d-inline-flex me-3">
        <span class="small text-muted">{{ exchange }}:</span>
        <span class="small ms-1" :class="rl.backoff_active ? 'text-danger fw-bold' : 'text-success'">
          {{ rl.tokens_available.toFixed(1) }}/{{ rl.tokens_max }}
          <span v-if="rl.backoff_active" class="text-danger"> BACKOFF</span>
        </span>
      </div>
    </div>

    <!-- Event log -->
    <div v-if="fleetEvents.length > 0">
      <div class="small text-muted mb-1">Recent Events (1h)</div>
      <div class="fleet-events-scroll">
        <div
          v-for="(evt, idx) in fleetEvents"
          :key="idx"
          class="d-flex small py-1 border-bottom border-secondary"
          :class="eventClass(evt.event_type)"
        >
          <span class="text-muted me-2" style="min-width: 70px">
            {{ formatTime(evt.ts) }}
          </span>
          <span class="badge bg-dark me-2" style="min-width: 32px">
            {{ eventIcon(evt.event_type) }}
          </span>
          <span class="me-2 fw-semibold" style="min-width: 120px">
            {{ evt.event_type }}
          </span>
          <span class="text-truncate">
            {{ evt.bot_id || '' }}
            <span v-if="evt.details && Object.keys(evt.details).length" class="text-muted">
              {{ JSON.stringify(evt.details) }}
            </span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fleet-overview {
  font-size: 0.85rem;
}

.fleet-events-scroll {
  max-height: 200px;
  overflow-y: auto;
}
</style>
