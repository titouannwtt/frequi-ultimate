<script setup lang="ts">
import type { Trade } from '@/types';
import { tradeDurationMs } from '@/composables/tradeColumns';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  trade: Trade;
  closedTrades?: Trade[];
  isOpen?: boolean;
}>();

const botStore = useBotStore();

function formatDurationMs(ms: number): string {
  if (ms < 60000) return '< 1m';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return `${d}d ${rh}h`;
  }
  return `${h}h ${m}m`;
}

const stats = computed(() => {
  const trades = props.closedTrades ?? botStore.activeBot?.closedTrades ?? [];
  if (trades.length === 0) return null;

  const durationEntries = trades
    .map((t) => {
      const d = t.close_timestamp && t.open_timestamp ? t.close_timestamp - t.open_timestamp : 0;
      return { duration: d, trade: t };
    })
    .filter((e) => e.duration > 0);

  if (durationEntries.length === 0) return null;

  const durations = durationEntries.map((e) => e.duration);

  const winDurations = trades
    .filter((t) => (t.profit_pct ?? 0) > 0)
    .map((t) => (t.close_timestamp ?? 0) - t.open_timestamp)
    .filter((d) => d > 0);
  const loseDurations = trades
    .filter((t) => (t.profit_pct ?? 0) <= 0)
    .map((t) => (t.close_timestamp ?? 0) - t.open_timestamp)
    .filter((d) => d > 0);

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const sorted = [...durations].sort((a, b) => a - b);

  const currentMs = tradeDurationMs(props.trade);
  const belowCount = sorted.filter((d) => d <= currentMs).length;
  const percentile = Math.round((belowCount / sorted.length) * 100);

  const level = percentile > 90 ? 'danger' : percentile > 70 ? 'warn' : 'ok';

  // Min/max trades
  const sortedEntries = [...durationEntries].sort((a, b) => a.duration - b.duration);
  const shortest = sortedEntries[0];
  const longest = sortedEntries[sortedEntries.length - 1];

  // Box plot quartiles (safe for arrays of length 1+)
  const q = (arr: number[], p: number) => {
    if (arr.length === 0) return 0;
    if (arr.length === 1) return arr[0];
    const idx = (arr.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.min(Math.ceil(idx), arr.length - 1);
    return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
  };

  return {
    avgAll: avg(durations),
    avgWin: winDurations.length ? avg(winDurations) : null,
    avgLose: loseDurations.length ? avg(loseDurations) : null,
    currentMs,
    percentile,
    totalTrades: durations.length,
    level,
    // New: min/max trades
    shortestDuration: shortest.duration,
    shortestPair: shortest.trade.pair,
    longestDuration: longest.duration,
    longestPair: longest.trade.pair,
    // Box plot
    boxMin: sorted[0],
    boxQ1: q(sorted, 0.25),
    boxMedian: q(sorted, 0.5),
    boxQ3: q(sorted, 0.75),
    boxMax: sorted[sorted.length - 1],
  };
});
</script>

<template>
  <div class="p-4 text-xs min-w-[280px] max-w-[380px]">
    <div class="font-bold text-[13px] mb-2">{{ t('durationHealth.title') }}</div>

    <template v-if="stats">
      <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 mb-2">
        <span class="text-surface-400">{{ t('durationHealth.current') }}</span>
        <span class="font-mono font-semibold">{{ formatDurationMs(stats.currentMs) }}</span>

        <span class="text-surface-400">{{ t('durationHealth.avgAll') }}</span>
        <span class="font-mono">{{ formatDurationMs(stats.avgAll) }}</span>

        <template v-if="stats.avgWin !== null">
          <span class="text-surface-400">{{ t('durationHealth.avgWin') }}</span>
          <span class="font-mono text-green-400">{{ formatDurationMs(stats.avgWin) }}</span>
        </template>

        <template v-if="stats.avgLose !== null">
          <span class="text-surface-400">{{ t('durationHealth.avgLose') }}</span>
          <span class="font-mono text-red-400">{{ formatDurationMs(stats.avgLose) }}</span>
        </template>

        <span class="text-surface-400">{{ t('durationHealth.percentile') }}</span>
        <span
          class="font-mono font-semibold"
          :class="
            stats.level === 'danger'
              ? 'text-red-400'
              : stats.level === 'warn'
                ? 'text-orange-400'
                : 'text-green-400'
          "
        >
          {{ stats.percentile }}%
        </span>

        <span class="text-surface-400">{{ t('durationHealth.sampleSize') }}</span>
        <span class="text-surface-500"
          >{{ stats.totalTrades }} {{ t('durationHealth.trades') }}</span
        >
      </div>

      <!-- Min / Max trades -->
      <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 mb-2 border-t border-surface-700 pt-2">
        <span class="text-surface-400">{{ t('durationHealth.shortest') }}</span>
        <span class="font-mono"
          ><span class="text-cyan-400">{{ formatDurationMs(stats.shortestDuration) }}</span>
          <span class="text-surface-500 text-[11px]">({{ stats.shortestPair }})</span></span
        >

        <span class="text-surface-400">{{ t('durationHealth.longest') }}</span>
        <span class="font-mono"
          ><span class="text-amber-400">{{ formatDurationMs(stats.longestDuration) }}</span>
          <span class="text-surface-500 text-[11px]">({{ stats.longestPair }})</span></span
        >
      </div>

      <!-- Box plot SVG -->
      <div class="mb-2">
        <svg width="300" height="54" class="w-full">
          <!-- Whisker line -->
          <line
            :x1="(stats.boxMin / stats.boxMax) * 220 + 10"
            y1="22"
            x2="230"
            y2="22"
            stroke="#6b7280"
            stroke-width="1"
          />
          <!-- IQR box -->
          <rect
            :x="(stats.boxQ1 / stats.boxMax) * 220 + 10"
            y="10"
            :width="Math.max(((stats.boxQ3 - stats.boxQ1) / stats.boxMax) * 220, 2)"
            height="24"
            fill="rgba(59,130,246,0.2)"
            stroke="#3b82f6"
            stroke-width="1"
            rx="2"
          />
          <!-- Median line -->
          <line
            :x1="(stats.boxMedian / stats.boxMax) * 220 + 10"
            y1="8"
            :x2="(stats.boxMedian / stats.boxMax) * 220 + 10"
            y2="36"
            stroke="#f59e0b"
            stroke-width="2"
          />
          <!-- Min whisker cap -->
          <line
            :x1="(stats.boxMin / stats.boxMax) * 220 + 10"
            y1="15"
            :x2="(stats.boxMin / stats.boxMax) * 220 + 10"
            y2="29"
            stroke="#6b7280"
            stroke-width="1.5"
          />
          <!-- Max whisker cap -->
          <line x1="230" y1="15" x2="230" y2="29" stroke="#6b7280" stroke-width="1.5" />
          <!-- Current trade marker -->
          <circle
            :cx="Math.min(stats.currentMs / stats.boxMax, 1) * 220 + 10"
            cy="22"
            r="4"
            :fill="
              stats.level === 'danger' ? '#ef4444' : stats.level === 'warn' ? '#f59e0b' : '#22c55e'
            "
            stroke="#fff"
            stroke-width="1"
          />
        </svg>
      </div>

      <!-- Distribution bar (percentile) -->
      <div
        class="relative h-3 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden mb-1"
      >
        <div
          class="absolute top-0 left-0 h-full rounded-full transition-all"
          :class="
            stats.level === 'danger'
              ? 'bg-red-500'
              : stats.level === 'warn'
                ? 'bg-orange-400'
                : 'bg-green-500'
          "
          :style="{ width: stats.percentile + '%' }"
        />
      </div>
      <div class="flex justify-between text-[11px] text-surface-400">
        <span>{{ t('durationHealth.fast') }}</span>
        <span>p{{ stats.percentile }}</span>
        <span>{{ t('durationHealth.slow') }}</span>
      </div>

      <!-- Explanation -->
      <div class="mt-2 text-[12px] text-surface-400 italic">
        <template v-if="!isOpen">
          {{ t('durationHealth.explainClosed') }}
        </template>
        <template v-else-if="stats.level === 'ok'">
          {{ t('durationHealth.explainOk') }}
        </template>
        <template v-else-if="stats.level === 'warn'">
          {{ t('durationHealth.explainWarn') }}
        </template>
        <template v-else>
          {{ t('durationHealth.explainDanger') }}
        </template>
      </div>
    </template>

    <template v-else>
      <div class="text-surface-400 text-center py-2">{{ t('durationHealth.noData') }}</div>
    </template>
  </div>
</template>
