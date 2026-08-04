<script setup lang="ts">
import type { Trade } from '@/types';
import { humanizeTradeDuration, tradeDurationMs } from '@/composables/tradeColumns';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  trade: Trade;
  isOpen: boolean;
  closedTrades?: Trade[];
}>();

const botStore = useBotStore();

// DCA information
const entryOrders = computed(() => {
  if (!props.trade.orders) return [];
  return props.trade.orders.filter((o) => o.ft_is_entry && o.status === 'closed');
});

const isDca = computed(() => {
  return (props.trade.nr_of_successful_entries ?? entryOrders.value.length) > 1;
});

const dcaCount = computed(() => {
  return props.trade.nr_of_successful_entries ?? entryOrders.value.length;
});

// Stoploss info
const initialStoploss = computed(() => props.trade.initial_stop_loss_abs);
const currentStoploss = computed(() => props.trade.stop_loss_abs);

const stoplossDistancePct = computed(() => {
  const rate = props.isOpen ? props.trade.current_rate : props.trade.close_rate;
  if (!rate || !currentStoploss.value) return null;
  if (props.trade.is_short) {
    return ((currentStoploss.value - rate) / rate) * 100;
  }
  return ((rate - currentStoploss.value) / rate) * 100;
});

// Price bar visualization
const priceBarData = computed(() => {
  const entry = props.trade.open_rate;
  const current = props.isOpen
    ? (props.trade.current_rate ?? entry)
    : (props.trade.close_rate ?? entry);
  const sl = currentStoploss.value ?? 0;
  const liq = props.trade.liquidation_price ?? null;

  const prices = [entry, current, sl];
  if (liq !== null) prices.push(liq);

  const min = Math.min(...prices.filter((p) => p > 0));
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pad = range * 0.1;
  const lo = min - pad;
  const hi = max + pad;
  const span = hi - lo || 1;

  const pct = (v: number) => ((v - lo) / span) * 100;

  return {
    entryPct: pct(entry),
    currentPct: pct(current),
    slPct: pct(sl),
    liqPct: liq !== null ? pct(liq) : null,
    isProfit: props.trade.is_short ? current < entry : current > entry,
  };
});

// Duration health analysis
const durationStats = computed(() => {
  const trades = props.closedTrades ?? botStore.activeBot?.closedTrades ?? [];
  if (trades.length === 0) return null;

  const durations = trades
    .map((t) => {
      if (t.close_timestamp && t.open_timestamp) return t.close_timestamp - t.open_timestamp;
      return 0;
    })
    .filter((d) => d > 0);

  if (durations.length === 0) return null;

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

  return {
    avgAll: avg(durations),
    avgWin: winDurations.length ? avg(winDurations) : null,
    avgLose: loseDurations.length ? avg(loseDurations) : null,
    currentMs,
    percentile,
    totalTrades: durations.length,
  };
});

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
</script>

<template>
  <div class="p-4 text-xs min-w-[350px] max-w-[460px]">
    <!-- Header -->
    <div class="text-[11px] text-surface-500 uppercase tracking-wider mb-0.5">Trade overview</div>
    <div class="flex items-center gap-2 mb-2">
      <span class="font-bold text-sm">{{ trade.pair }}</span>
      <span
        v-if="trade.trading_mode !== 'spot'"
        class="inline-block px-1.5 py-0.5 rounded text-[12px] font-bold"
        :class="trade.is_short ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'"
      >
        {{ trade.is_short ? 'SHORT' : 'LONG' }}
      </span>
      <span
        v-if="trade.leverage && trade.leverage > 1"
        class="inline-block px-1.5 py-0.5 rounded text-[12px] font-bold bg-yellow-500/20 text-yellow-400"
      >
        {{ trade.leverage }}x
      </span>
    </div>

    <!-- Trade Summary -->
    <div class="grid grid-cols-2 gap-x-4 gap-y-1 mb-3">
      <span class="text-surface-400">{{ t('tradePopover.entryPrice') }}</span>
      <span class="font-mono">{{ formatPrice(trade.open_rate) }}</span>

      <template v-if="isOpen">
        <span class="text-surface-400">{{ t('tradePopover.currentPrice') }}</span>
        <span class="font-mono">{{ formatPrice(trade.current_rate) }}</span>
      </template>
      <template v-else>
        <span class="text-surface-400">{{ t('tradePopover.exitPrice') }}</span>
        <span class="font-mono">{{ formatPrice(trade.close_rate) }}</span>
      </template>

      <span class="text-surface-400">{{ t('tradePopover.profit') }}</span>
      <span
        class="font-mono"
        :class="(trade.profit_pct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'"
      >
        {{
          trade.profit_pct !== null && trade.profit_pct !== undefined
            ? (trade.profit_pct >= 0 ? '+' : '') + trade.profit_pct.toFixed(2) + '%'
            : 'N/A'
        }}
        <span class="text-surface-500">({{ formatPrice(trade.profit_abs, 3) }})</span>
      </span>

      <span class="text-surface-400">{{ t('tradePopover.duration') }}</span>
      <span>{{ humanizeTradeDuration(trade) }}</span>

      <span class="text-surface-400">{{ t('tradePopover.stake') }}</span>
      <span class="font-mono">{{
        formatPrice(
          trade.max_stake_amount ?? trade.stake_amount,
          botStore.activeBot?.stakeCurrencyDecimals,
        )
      }}</span>

      <template v-if="trade.enter_tag">
        <span class="text-surface-400">{{ t('tradePopover.entryTag') }}</span>
        <span>{{ trade.enter_tag }}</span>
      </template>
    </div>

    <!-- DCA History -->
    <template v-if="isDca">
      <div class="border-t border-surface-300 dark:border-surface-600 pt-2 mb-2">
        <div class="font-semibold text-[13px] mb-1">
          {{ t('tradePopover.dcaHistory') }} ({{ dcaCount }} {{ t('tradePopover.entries') }})
        </div>
        <div v-if="entryOrders.length > 0" class="space-y-0.5">
          <div
            v-for="(order, idx) in entryOrders"
            :key="idx"
            class="flex items-center gap-2 text-[12px] font-mono bg-surface-100 dark:bg-surface-800 rounded px-1.5 py-0.5"
          >
            <span class="text-surface-400 w-4">#{{ idx + 1 }}</span>
            <span>{{ formatPrice(order.safe_price) }}</span>
            <span class="text-surface-400">{{ order.filled ?? order.amount }}</span>
            <span v-if="order.order_filled_timestamp" class="text-surface-500 ml-auto text-[11px]">
              {{
                new Date(order.order_filled_timestamp).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              }}
            </span>
          </div>
        </div>
        <div v-else class="text-[12px] text-surface-400">
          {{ dcaCount }} {{ t('tradePopover.entriesNoDetail') }}
        </div>
      </div>
    </template>

    <!-- Price Level Bar -->
    <div class="border-t border-surface-300 dark:border-surface-600 pt-2 mb-2">
      <div class="font-semibold text-[13px] mb-1.5">{{ t('tradePopover.priceLevels') }}</div>
      <div
        class="relative h-3 bg-surface-200 dark:bg-surface-700 rounded-full overflow-visible mb-4"
      >
        <!-- Entry marker -->
        <div
          class="absolute top-0 w-0.5 h-3 bg-blue-400"
          :style="{ left: priceBarData.entryPct + '%' }"
          :title="t('tradePopover.entryPrice') + ': ' + formatPrice(trade.open_rate)"
        />
        <!-- Current / Exit marker -->
        <div
          class="absolute top-0 w-0.5 h-3"
          :class="priceBarData.isProfit ? 'bg-green-400' : 'bg-red-400'"
          :style="{ left: priceBarData.currentPct + '%' }"
          :title="
            (isOpen ? t('tradePopover.currentPrice') : t('tradePopover.exitPrice')) +
            ': ' +
            formatPrice(isOpen ? trade.current_rate : trade.close_rate)
          "
        />
        <!-- Stoploss marker -->
        <div
          class="absolute top-0 w-0.5 h-3 bg-orange-500"
          :style="{ left: priceBarData.slPct + '%' }"
          :title="t('tradePopover.stoploss') + ': ' + formatPrice(trade.stop_loss_abs)"
        />
        <!-- Liquidation marker -->
        <div
          v-if="priceBarData.liqPct !== null"
          class="absolute top-0 w-0.5 h-3 bg-red-600"
          :style="{ left: priceBarData.liqPct + '%' }"
          :title="t('tradePopover.liquidation') + ': ' + formatPrice(trade.liquidation_price)"
        />
      </div>
      <!-- Legend -->
      <div class="flex flex-wrap gap-3 text-[12px]">
        <span class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-blue-400 inline-block" />
          {{ t('tradePopover.entry') }}
        </span>
        <span class="flex items-center gap-1">
          <span
            class="w-2 h-2 rounded-full inline-block"
            :class="priceBarData.isProfit ? 'bg-green-400' : 'bg-red-400'"
          />
          {{ isOpen ? t('tradePopover.current') : t('tradePopover.exit') }}
        </span>
        <span class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-orange-500 inline-block" />
          {{ t('tradePopover.sl') }}
        </span>
        <span v-if="trade.liquidation_price" class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-red-600 inline-block" /> {{ t('tradePopover.liq') }}
        </span>
      </div>
    </div>

    <!-- Stoploss Detail -->
    <div class="border-t border-surface-300 dark:border-surface-600 pt-2 mb-2">
      <div class="font-semibold text-[13px] mb-1">{{ t('tradePopover.stoplossInfo') }}</div>
      <div class="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <template v-if="initialStoploss">
          <span class="text-surface-400">{{ t('tradePopover.initialSl') }}</span>
          <span class="font-mono">{{ formatPrice(initialStoploss) }}</span>
        </template>
        <span class="text-surface-400">{{ t('tradePopover.currentSl') }}</span>
        <span class="font-mono">{{ formatPrice(currentStoploss) }}</span>
        <span class="text-surface-400">{{ t('tradePopover.distancePct') }}</span>
        <span
          class="font-mono"
          :class="(stoplossDistancePct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'"
        >
          {{ stoplossDistancePct !== null ? stoplossDistancePct.toFixed(2) + '%' : '-' }}
        </span>
        <template v-if="trade.liquidation_price">
          <span class="text-surface-400">{{ t('tradePopover.liquidation') }}</span>
          <span class="font-mono text-red-400">{{ formatPrice(trade.liquidation_price) }}</span>
        </template>
      </div>
    </div>

    <!-- Closed trade extras -->
    <template v-if="!isOpen">
      <div class="border-t border-surface-300 dark:border-surface-600 pt-2 mb-2">
        <div class="font-semibold text-[13px] mb-1">{{ t('tradePopover.exitInfo') }}</div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-0.5">
          <span class="text-surface-400">{{ t('tradePopover.exitReason') }}</span>
          <span class="font-semibold">{{ trade.exit_reason ?? '-' }}</span>
          <span class="text-surface-400">{{ t('tradePopover.totalDuration') }}</span>
          <span>{{ humanizeTradeDuration(trade) }}</span>
        </div>
      </div>
    </template>

    <!-- Duration Health -->
    <template v-if="durationStats">
      <div class="border-t border-surface-300 dark:border-surface-600 pt-2">
        <div class="font-semibold text-[13px] mb-1">{{ t('tradePopover.durationHealth') }}</div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-0.5 mb-2">
          <span class="text-surface-400">{{ t('tradePopover.currentDuration') }}</span>
          <span class="font-mono">{{ formatDurationMs(durationStats.currentMs) }}</span>
          <span class="text-surface-400">{{ t('tradePopover.avgAllDuration') }}</span>
          <span class="font-mono">{{ formatDurationMs(durationStats.avgAll) }}</span>
          <template v-if="durationStats.avgWin !== null">
            <span class="text-surface-400">{{ t('tradePopover.avgWinDuration') }}</span>
            <span class="font-mono text-green-400">{{
              formatDurationMs(durationStats.avgWin)
            }}</span>
          </template>
          <template v-if="durationStats.avgLose !== null">
            <span class="text-surface-400">{{ t('tradePopover.avgLoseDuration') }}</span>
            <span class="font-mono text-red-400">{{
              formatDurationMs(durationStats.avgLose)
            }}</span>
          </template>
          <span class="text-surface-400">{{ t('tradePopover.percentile') }}</span>
          <span class="font-mono">{{ durationStats.percentile }}%</span>
        </div>
        <!-- Duration distribution bar -->
        <div class="relative h-2.5 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
          <div
            class="absolute top-0 left-0 h-full rounded-full transition-all"
            :class="
              durationStats.percentile > 90
                ? 'bg-red-500'
                : durationStats.percentile > 70
                  ? 'bg-orange-400'
                  : 'bg-green-500'
            "
            :style="{ width: durationStats.percentile + '%' }"
          />
        </div>
        <div class="flex justify-between text-[11px] text-surface-400 mt-0.5">
          <span>{{ t('tradePopover.fast') }}</span>
          <span>p{{ durationStats.percentile }}</span>
          <span>{{ t('tradePopover.slow') }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
