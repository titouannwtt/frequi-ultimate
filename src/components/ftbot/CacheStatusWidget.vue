<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref } from 'vue';

const botStore = useBotStore();
const refreshInterval = ref<ReturnType<typeof setInterval> | null>(null);

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

const ftcache = computed(() => botStore.activeBot.cacheStatus?.ftcache ?? {});
const pairlistCache = computed(() => botStore.activeBot.cacheStatus?.pairlist_cache ?? {});

function refresh() {
  botStore.activeBot.getCacheStatus();
}

onMounted(() => {
  refresh();
  refreshInterval.value = setInterval(refresh, 30000);
});

onUnmounted(() => {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value);
  }
});
</script>

<template>
  <div class="cache-status-widget p-3">
    <div class="text-sm font-semibold mb-3 opacity-80">Cache Daemons</div>

    <!-- ftcache -->
    <div class="mb-3">
      <div class="flex items-center gap-2 mb-1">
        <span
          class="inline-block w-2 h-2 rounded-full"
          :class="ftcache.online ? 'bg-green-500' : 'bg-red-500'"
        />
        <span class="text-sm font-medium">ftcache (OHLCV)</span>
        <span v-if="ftcache.online" class="text-xs opacity-60 ml-auto">
          {{ formatUptime(ftcache.uptime_s || 0) }}
        </span>
      </div>
      <div v-if="ftcache.online" class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs ml-4">
        <div>
          <span class="opacity-60">Clients:</span>
          {{ ftcache.active_clients ?? 0 }}
        </div>
        <div>
          <span class="opacity-60">Series:</span>
          {{ ftcache.series_count ?? 0 }}
        </div>
        <div>
          <span class="opacity-60">Hit rate:</span>
          <span :class="(ftcache.hit_rate_pct ?? 0) > 50 ? 'text-green-500' : 'text-yellow-500'">
            {{ (ftcache.hit_rate_pct ?? 0).toFixed(1) }}%
          </span>
        </div>
        <div>
          <span class="opacity-60">Requests:</span>
          {{ ftcache.requests_total ?? 0 }}
        </div>
        <div>
          <span class="opacity-60">Pending:</span>
          <span :class="(ftcache.pending_fetches ?? 0) > 10 ? 'text-yellow-500' : ''">
            {{ ftcache.pending_fetches ?? 0 }}
          </span>
        </div>
        <div>
          <span class="opacity-60">Errors:</span>
          <span :class="(ftcache.fetch_errors ?? 0) > 0 ? 'text-red-400' : ''">
            {{ ftcache.fetch_errors ?? 0 }}
          </span>
        </div>
      </div>
      <div v-if="ftcache.online && (ftcache.acquire_total ?? 0) > 0" class="mt-2 ml-4">
        <div class="text-xs font-medium opacity-70 mb-1">Rate Limiter</div>
        <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div>
            <span class="opacity-60">Tokens:</span>
            {{ ftcache.acquire_total ?? 0 }}
          </div>
          <div>
            <span class="opacity-60">Tickers:</span>
            <span :class="(ftcache.tickers_hit_rate_pct ?? 0) > 50 ? 'text-green-500' : ''">
              {{ (ftcache.tickers_hit_rate_pct ?? 0).toFixed(0) }}%
            </span>
            <span class="opacity-40">({{ ftcache.tickers_fetches ?? 0 }} fetches)</span>
          </div>
          <div>
            <span class="opacity-60">Positions:</span>
            <span :class="(ftcache.positions_hit_rate_pct ?? 0) > 50 ? 'text-green-500' : ''">
              {{ (ftcache.positions_hit_rate_pct ?? 0).toFixed(0) }}%
            </span>
            <span class="opacity-40">({{ ftcache.positions_puts ?? 0 }} puts)</span>
          </div>
        </div>
      </div>
      <!-- Circuit Breaker -->
      <div v-if="ftcache.online && (ftcache.backoff_count ?? 0) > 0" class="mt-2 ml-4">
        <div class="text-xs font-medium opacity-70 mb-1">Circuit Breaker</div>
        <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div>
            <span class="opacity-60">429 backoffs:</span>
            <span class="text-yellow-500">{{ ftcache.backoff_count ?? 0 }}</span>
          </div>
          <div>
            <span class="opacity-60">Shed:</span>
            <span :class="(ftcache.shed_count ?? 0) > 0 ? 'text-orange-400' : ''">
              {{ ftcache.shed_count ?? 0 }}
            </span>
          </div>
          <div v-if="ftcache.backoff_active" class="col-span-2">
            <span
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
                     bg-red-500/20 text-red-400 border border-red-500/30"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              BACKOFF ACTIVE — {{ Math.ceil(ftcache.backoff_remaining_s ?? 0) }}s
              (level {{ ftcache.consecutive_backoffs ?? 0 }}/4)
            </span>
          </div>
        </div>
      </div>
      <!-- Connection Stats -->
      <div v-if="ftcache.online && (ftcache.total_connects ?? 0) > 0" class="mt-2 ml-4">
        <div class="text-xs font-medium opacity-70 mb-1">Connections</div>
        <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div>
            <span class="opacity-60">Total:</span>
            {{ ftcache.total_connects ?? 0 }}
          </div>
          <div>
            <span class="opacity-60">Peak:</span>
            {{ ftcache.peak_clients ?? 0 }}
          </div>
        </div>
      </div>
      <div v-else class="text-xs ml-4 opacity-50">Offline</div>
    </div>

    <!-- pairlist cache -->
    <div>
      <div class="flex items-center gap-2 mb-1">
        <span
          class="inline-block w-2 h-2 rounded-full"
          :class="pairlistCache.online ? 'bg-green-500' : 'bg-red-500'"
        />
        <span class="text-sm font-medium">Pairlist Cache</span>
        <span v-if="pairlistCache.online" class="text-xs opacity-60 ml-auto">
          {{ formatUptime(pairlistCache.uptime_s || 0) }}
        </span>
      </div>
      <div v-if="pairlistCache.online" class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs ml-4">
        <div>
          <span class="opacity-60">Clients:</span>
          {{ pairlistCache.active_clients ?? 0 }}
        </div>
        <div>
          <span class="opacity-60">Entries:</span>
          {{ pairlistCache.entries ?? 0 }}
        </div>
        <div>
          <span class="opacity-60">Hit rate:</span>
          <span
            :class="
              (pairlistCache.hit_rate_pct ?? 0) > 50 ? 'text-green-500' : 'text-yellow-500'
            "
          >
            {{ (pairlistCache.hit_rate_pct ?? 0).toFixed(1) }}%
          </span>
        </div>
        <div>
          <span class="opacity-60">Gets:</span>
          {{ pairlistCache.gets ?? 0 }}
        </div>
      </div>
      <div v-else class="text-xs ml-4 opacity-50">Offline</div>
    </div>

    <button
      class="mt-3 text-xs opacity-50 hover:opacity-100 transition-opacity"
      @click="refresh"
    >
      Refresh
    </button>
  </div>
</template>
