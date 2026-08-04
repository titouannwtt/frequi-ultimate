<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FleetviewBot, FleetviewCoin } from '@/types';

const { t } = useI18n();

const {
  overview,
  recon,
  overviewError,
  reconError,
  overviewLoading,
  reconLoading,
  loadOverview,
  loadRecon,
  subscribe,
} = useFleetView();
subscribe();

const bots = computed((): FleetviewBot[] => overview.value?.bots ?? []);
const coins = computed((): FleetviewCoin[] => recon.value?.coins ?? []);

// Dry/live mode filter — persisted per widget, defaults to 'live' (historic
// behaviour: the long/short split only counted live bots).
const { tradingMode } = useTradingModeFilter('fleetExposure', 'live');
function botInMode(b: FleetviewBot): boolean {
  if (tradingMode.value === 'all') return true;
  return (tradingMode.value === 'dry') === !!b.dry_run;
}
const fleetHasBothModes = computed(() => {
  let dry = false;
  let live = false;
  for (const b of bots.value) {
    if (b.dry_run) dry = true;
    else live = true;
    if (dry && live) return true;
  }
  return false;
});

const initialLoading = computed(
  () => (overviewLoading.value || reconLoading.value) && !overview.value && !recon.value,
);
const fetchError = computed(() => overviewError.value || reconError.value);

function retryFetch() {
  loadOverview();
  loadRecon(true);
}

const split = computed(() => {
  let long = 0;
  let short = 0;
  for (const b of bots.value) {
    if (!botInMode(b)) continue;
    for (const t of b.open_trades) {
      if (t.is_short) short += t.stake_amount;
      else long += t.stake_amount;
    }
  }
  const total = long + short;
  return {
    long,
    short,
    total,
    longPct: total > 0 ? (long / total) * 100 : 50,
  };
});

const netExposures = computed(() => {
  return coins.value
    .filter((c) => c.mark_price && Math.abs(c.on_chain) > 1e-9)
    .map((c) => ({
      coin: c.coin,
      notional: c.on_chain * (c.mark_price as number),
      upnl: c.unrealized_pnl,
    }))
    .sort((a, b) => Math.abs(b.notional) - Math.abs(a.notional))
    .slice(0, 12);
});

const maxNotional = computed(() =>
  netExposures.value.length ? Math.abs(netExposures.value[0].notional) : 1,
);

const netTotal = computed(() =>
  coins.value.reduce(
    (acc, c) => acc + (c.mark_price ? c.on_chain * c.mark_price : 0),
    0,
  ),
);
</script>

<template>
  <div class="flex flex-col h-full p-3 gap-3">
    <!-- Fetch error banner with retry -->
    <div
      v-if="fetchError"
      class="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs bg-red-500/10 border border-red-500/25 text-red-400"
    >
      <span class="flex items-center gap-1.5 min-w-0">
        <i-mdi-alert-circle-outline class="w-4 h-4 shrink-0" />
        <span class="truncate">{{ t('widgetState.fetchError') }}</span>
      </span>
      <button
        class="shrink-0 px-2 py-0.5 rounded bg-red-500/15 hover:bg-red-500/25 transition-colors cursor-pointer"
        @click="retryFetch"
      >
        {{ t('widgetState.retry') }}
      </button>
    </div>

    <!-- Initial loading: bar-shaped skeleton -->
    <template v-if="initialLoading">
      <div class="flex flex-col gap-2">
        <Skeleton height="0.9rem" width="60%" />
        <Skeleton height="0.9rem" />
        <Skeleton height="0.9rem" width="80%" />
      </div>
      <div class="flex flex-col gap-2">
        <Skeleton v-for="i in 5" :key="i" height="0.8rem" :width="`${95 - i * 12}%`" />
      </div>
    </template>

    <template v-else>
    <div class="flex justify-end">
      <TradingModeSelect v-model="tradingMode" :show="fleetHasBothModes" />
    </div>
    <div class="flex flex-col gap-1">
      <div class="flex justify-between text-xs font-mono tabular-nums">
        <span class="text-emerald-500">{{ t('fleet.exposure.long') }} {{ split.long.toFixed(0) }} USDC</span>
        <span class="text-red-400">{{ t('fleet.exposure.short') }} {{ split.short.toFixed(0) }} USDC</span>
      </div>
      <div class="h-3 rounded overflow-hidden flex bg-surface-200 dark:bg-surface-700">
        <div
          class="bg-emerald-500/80 h-full transition-[width] duration-500"
          :style="{ width: `${split.longPct}%` }"
        ></div>
        <div
          class="bg-red-400/80 h-full transition-[width] duration-500"
          :style="{ width: `${100 - split.longPct}%` }"
        ></div>
      </div>
      <div class="text-xs text-surface-500 dark:text-surface-400">
        <span class="font-mono tabular-nums">{{ split.longPct.toFixed(0) }}%</span>
        {{ t('fleet.exposure.longWord') }} /
        <span class="font-mono tabular-nums">{{ (100 - split.longPct).toFixed(0) }}%</span>
        {{ t('fleet.exposure.shortWord') }}
        {{ t('fleet.exposure.allocatedStake', { total: split.total.toFixed(0) }) }}
      </div>
    </div>

    <div class="flex flex-col gap-1">
      <div class="flex justify-between text-xs text-surface-500 dark:text-surface-400">
        <span>{{ t('fleet.exposure.topNet') }}</span>
        <span>
          {{ t('fleet.exposure.walletNet') }}
          <span
            class="font-mono tabular-nums"
            :class="netTotal >= 0 ? 'text-emerald-500' : 'text-red-400'"
          >
            {{ netTotal.toFixed(0) }} USDC
          </span>
        </span>
      </div>
      <div
        v-for="e in netExposures"
        :key="e.coin"
        class="flex items-center gap-2 text-xs"
        :title="t('fleet.exposure.upnlTitle', { upnl: e.upnl.toFixed(2) })"
      >
        <span class="w-14 shrink-0 font-semibold">{{ e.coin }}</span>
        <div class="grow h-2.5 rounded bg-surface-200 dark:bg-surface-700 overflow-hidden relative">
          <div
            class="h-full absolute transition-[width] duration-500"
            :class="e.notional >= 0 ? 'bg-emerald-500/80' : 'bg-red-400/80'"
            :style="{
              width: `${Math.max(2, (Math.abs(e.notional) / maxNotional) * 100)}%`,
            }"
          ></div>
        </div>
        <span
          class="w-20 shrink-0 text-right font-mono tabular-nums"
          :class="e.notional >= 0 ? 'text-emerald-500' : 'text-red-400'"
        >
          {{ e.notional.toFixed(0) }}
        </span>
      </div>
      <div
        v-if="!netExposures.length"
        class="flex items-center gap-1.5 text-sm text-surface-500 dark:text-surface-400"
      >
        <i-mdi-scale-balance class="w-4 h-4" />
        {{ t('fleet.exposure.noPosition') }}
      </div>
    </div>
    </template>
  </div>
</template>
