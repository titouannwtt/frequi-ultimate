<script setup lang="ts">
import type { Trade } from '@/types';
import { useI18n } from 'vue-i18n';
import { useSummaryCurrency } from '@/composables/summaryCurrency';
import Popover from 'primevue/popover';

const { t } = useI18n();
const botStore = useBotStore();
const { summaryCurrency } = useSummaryCurrency();

const currencyUnit = computed(() => {
  if (summaryCurrency.value && summaryCurrency.value !== 'auto') {
    return summaryCurrency.value;
  }
  return '';
});

const openTrades = computed<Trade[]>(() => botStore.allOpenTradesSelectedBots);

// ── Total balance deduplicated by exchange (same exchange = same wallet) ──
const totalBalance = computed(() => {
  const seen = new Map<string, number>();
  for (const bot of botStore.selectedBots) {
    const bal = bot.balance;
    const st = bot.botState;
    if (!bal || bal.total <= 0 || !st?.exchange) continue;
    const key = `${st.exchange}:${st.trading_mode ?? ''}`;
    const prev = seen.get(key) ?? 0;
    if (bal.total > prev) seen.set(key, bal.total);
  }
  let total = 0;
  for (const v of seen.values()) total += v;
  return total;
});

// Long exposure
const longExposure = computed(() =>
  openTrades.value
    .filter((tr) => !tr.is_short)
    .reduce((sum, tr) => sum + (tr.stake_amount ?? 0), 0),
);

// Short exposure
const shortExposure = computed(() =>
  openTrades.value
    .filter((tr) => tr.is_short)
    .reduce((sum, tr) => sum + (tr.stake_amount ?? 0), 0),
);

// Net exposure (longs - shorts: can be negative if more shorts)
const netExposure = computed(() => longExposure.value - shortExposure.value);

// Gross exposure (total capital deployed)
const grossExposure = computed(() => longExposure.value + shortExposure.value);

// ── Current Exposure % ──
const exposurePct = computed(() => {
  if (totalBalance.value === 0) return 0;
  return (grossExposure.value / totalBalance.value) * 100;
});

const exposureColor = computed(() => {
  const pct = exposurePct.value;
  if (pct < 30) return 'green';
  if (pct < 60) return 'amber';
  return 'red';
});

const exposureBarColor = computed(() => {
  const c = exposureColor.value;
  if (c === 'green') return 'bg-green-500';
  if (c === 'amber') return 'bg-amber-500';
  return 'bg-red-500';
});

const exposureTextColor = computed(() => {
  const c = exposureColor.value;
  if (c === 'green') return 'text-green-400';
  if (c === 'amber') return 'text-amber-400';
  return 'text-red-400';
});

// Average leverage
const avgLeverage = computed(() => {
  const leveraged = openTrades.value.filter((tr) => (tr.leverage ?? 1) > 1);
  if (leveraged.length === 0) return 1;
  return leveraged.reduce((sum, tr) => sum + (tr.leverage ?? 1), 0) / leveraged.length;
});

// Drawdown gauge: worst open position profit %
const worstDrawdown = computed(() => {
  if (openTrades.value.length === 0) return 0;
  let worst = 0;
  for (const tr of openTrades.value) {
    const pct = tr.profit_pct ?? (tr.profit_ratio ? tr.profit_ratio * 100 : 0);
    if (pct < worst) worst = pct;
  }
  return worst;
});

// ── Total PnL of open positions (absolute) ──
const totalOpenPnl = computed(() => {
  return openTrades.value.reduce((sum, tr) => sum + (tr.profit_abs ?? 0), 0);
});

// Overall PnL %
const overallPnlPct = computed(() => {
  if (openTrades.value.length === 0 || grossExposure.value === 0) return 0;
  return (totalOpenPnl.value / grossExposure.value) * 100;
});

// ── Largest single position ──
const largestPosition = computed(() => {
  if (openTrades.value.length === 0) return null;
  let largest = openTrades.value[0];
  for (const tr of openTrades.value) {
    if ((tr.stake_amount ?? 0) > (largest.stake_amount ?? 0)) {
      largest = tr;
    }
  }
  const pctOfTotal = totalBalance.value > 0
    ? ((largest.stake_amount ?? 0) / totalBalance.value) * 100
    : 0;
  return {
    pair: largest.pair,
    stake: largest.stake_amount ?? 0,
    pctOfTotal,
  };
});

// Correlation warning: pairs traded by multiple bots simultaneously
const correlationWarnings = computed(() => {
  const pairBots: Record<string, Set<string>> = {};
  for (const tr of openTrades.value) {
    if (!pairBots[tr.pair]) pairBots[tr.pair] = new Set();
    pairBots[tr.pair].add(tr.botId);
  }
  let count = 0;
  for (const bots of Object.values(pairBots)) {
    if (bots.size > 1) count++;
  }
  return count;
});

// Drawdown bar width (capped at 50% for display)
const drawdownBarWidth = computed(() => {
  return Math.min(Math.abs(worstDrawdown.value), 50);
});

// ── Popovers ──
const exposurePopover = ref<InstanceType<typeof Popover>>();
const exposurePopoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const drawdownPopover = ref<InstanceType<typeof Popover>>();
const drawdownPopoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const pnlPopover = ref<InstanceType<typeof Popover>>();
const pnlPopoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const leveragePopover = ref<InstanceType<typeof Popover>>();
const leveragePopoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const correlationPopover = ref<InstanceType<typeof Popover>>();
const correlationPopoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

function showPop(popRef: any, timeRef: any, event: MouseEvent) {
  if (timeRef.value) clearTimeout(timeRef.value);
  const target = event.currentTarget as HTMLElement;
  timeRef.value = setTimeout(() => {
    if (target) popRef.value?.show({ currentTarget: target } as unknown as Event);
  }, 300);
}

function hidePop(popRef: any, timeRef: any) {
  if (timeRef.value) clearTimeout(timeRef.value);
  popRef.value?.hide();
}

// Exposure per bot
const exposureByBot = computed(() => {
  const map: Record<string, { name: string; long: number; short: number; count: number }> = {};
  for (const tr of openTrades.value) {
    const name = tr.botName || tr.botId;
    if (!map[name]) map[name] = { name, long: 0, short: 0, count: 0 };
    map[name].count++;
    if (tr.is_short) {
      map[name].short += tr.stake_amount ?? 0;
    } else {
      map[name].long += tr.stake_amount ?? 0;
    }
  }
  return Object.values(map).sort((a, b) => (b.long + b.short) - (a.long + a.short));
});

// PnL per bot
const pnlByBot = computed(() => {
  const map: Record<string, { name: string; pnl: number; count: number }> = {};
  for (const tr of openTrades.value) {
    const name = tr.botName || tr.botId;
    if (!map[name]) map[name] = { name, pnl: 0, count: 0 };
    map[name].pnl += tr.profit_abs ?? 0;
    map[name].count++;
  }
  return Object.values(map).sort((a, b) => b.pnl - a.pnl);
});

// Leverage per bot
const leverageByBot = computed(() => {
  const map: Record<string, { name: string; totalLev: number; count: number }> = {};
  for (const tr of openTrades.value) {
    const name = tr.botName || tr.botId;
    if (!map[name]) map[name] = { name, totalLev: 0, count: 0 };
    map[name].totalLev += tr.leverage ?? 1;
    map[name].count++;
  }
  return Object.values(map)
    .map(b => ({ name: b.name, avgLev: b.count ? b.totalLev / b.count : 1, count: b.count }))
    .sort((a, b) => b.avgLev - a.avgLev);
});

// Correlated pairs detail
const correlatedPairs = computed(() => {
  const pairBots: Record<string, Set<string>> = {};
  for (const tr of openTrades.value) {
    if (!pairBots[tr.pair]) pairBots[tr.pair] = new Set();
    pairBots[tr.pair].add(tr.botName || tr.botId);
  }
  return Object.entries(pairBots)
    .filter(([, bots]) => bots.size > 1)
    .map(([pair, bots]) => ({ pair, bots: Array.from(bots) }));
});

// Worst drawdown trade
const worstDrawdownTrade = computed(() => {
  if (openTrades.value.length === 0) return null;
  let worst: Trade = openTrades.value[0];
  for (const tr of openTrades.value) {
    const pct = tr.profit_pct ?? 0;
    if (pct < (worst.profit_pct ?? 0)) worst = tr;
  }
  return worst;
});
</script>

<template>
  <div class="risk-overview flex flex-col h-full p-3 gap-3" style="animation: ft-fade-in 300ms ease-out">
    <!-- Risk Level Badge -->
    <div class="flex items-center justify-center gap-2 py-1">
      <span
        class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
        :class="exposurePct > 70 ? 'bg-red-500/15 text-red-400 border border-red-500/20' : exposurePct > 40 ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20' : 'bg-green-500/15 text-green-400 border border-green-500/20'"
      >
        <span class="w-2 h-2 rounded-full" :class="exposurePct > 70 ? 'bg-red-500' : exposurePct > 40 ? 'bg-amber-500' : 'bg-green-500'"></span>
        {{ exposurePct > 70 ? t('riskOverview.riskHigh') : exposurePct > 40 ? t('riskOverview.riskModerate') : t('riskOverview.riskLow') }}
      </span>
    </div>

    <!-- Current Exposure Gauge -->
    <div
      class="flex flex-col gap-2 rounded-lg px-3 py-2 cursor-help"
      style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06)"
      @mouseenter="showPop(exposurePopover, exposurePopoverTimeout, $event)"
      @mouseleave="hidePop(exposurePopover, exposurePopoverTimeout)"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <i-mdi-gauge class="w-5 h-5" :class="exposureTextColor" />
          <span class="text-surface-400 text-xs">{{ t('riskOverview.currentExposure') }}</span>
        </div>
        <span class="text-lg font-bold" :class="exposureTextColor">
          {{ formatPrice(exposurePct, 1) }}%
        </span>
      </div>
      <!-- Gauge bar -->
      <div class="relative w-full h-3 rounded-full bg-surface-700 overflow-hidden">
        <div
          class="h-full rounded-full transition-all duration-500"
          :class="exposureBarColor"
          :style="{ width: Math.min(exposurePct, 100) + '%' }"
        />
        <!-- Tick marks at 30% and 60% -->
        <div class="absolute top-0 bottom-0 w-px bg-surface-500/50" style="left: 30%" />
        <div class="absolute top-0 bottom-0 w-px bg-surface-500/50" style="left: 60%" />
      </div>
      <div class="flex justify-between text-[9px] text-surface-500 -mt-1">
        <span>0%</span>
        <span>30%</span>
        <span>60%</span>
        <span>100%</span>
      </div>
      <div class="flex justify-between text-[10px] text-surface-400">
        <span>{{ formatPrice(grossExposure, 2) }} <span v-if="currencyUnit" class="opacity-50">{{ currencyUnit }}</span> {{ t('riskOverview.deployed') }}</span>
        <span :title="t('riskOverview.totalBalanceTooltip')">{{ t('riskOverview.of') }} {{ formatPrice(totalBalance, 2) }} <span v-if="currencyUnit" class="opacity-50">{{ currencyUnit }}</span></span>
      </div>
    </div>

    <!-- Net Exposure -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <i-mdi-cash-multiple class="text-amber-400 w-5 h-5" />
        <span class="text-surface-400 text-xs">{{ t('riskOverview.netExposure') }}</span>
      </div>
      <span
        class="text-lg font-bold"
        :class="netExposure >= 0 ? 'text-surface-200' : 'text-orange-400'"
      >
        {{ formatPrice(netExposure, 2) }}
        <span v-if="currencyUnit" class="text-xs font-normal opacity-50">{{ currencyUnit }}</span>
      </span>
    </div>

    <!-- Gross Exposure -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <i-mdi-sigma class="text-amber-400 w-5 h-5" />
        <span class="text-surface-400 text-xs">{{ t('riskOverview.grossExposure') }}</span>
      </div>
      <span class="text-lg font-bold text-surface-200">
        {{ formatPrice(grossExposure, 2) }}
        <span v-if="currencyUnit" class="text-xs font-normal opacity-50">{{ currencyUnit }}</span>
      </span>
    </div>

    <!-- Long / Short breakdown -->
    <div
      class="flex items-center justify-between rounded-lg px-3 py-1.5"
      style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06)"
    >
      <div class="flex items-center gap-1.5">
        <i-mdi-arrow-up class="text-green-400 w-4 h-4" />
        <span class="text-surface-400 text-[10px] uppercase tracking-wider">{{ t('riskOverview.longLabel') }}</span>
        <span class="text-green-400 text-xs font-semibold">{{ formatPrice(longExposure, 2) }}<span v-if="currencyUnit" class="font-normal opacity-50"> {{ currencyUnit }}</span></span>
      </div>
      <div class="w-px h-4 bg-surface-600" />
      <div class="flex items-center gap-1.5">
        <i-mdi-arrow-down class="text-red-400 w-4 h-4" />
        <span class="text-surface-400 text-[10px] uppercase tracking-wider">{{ t('riskOverview.shortLabel') }}</span>
        <span class="text-red-400 text-xs font-semibold">{{ formatPrice(shortExposure, 2) }}<span v-if="currencyUnit" class="font-normal opacity-50"> {{ currencyUnit }}</span></span>
      </div>
    </div>

    <!-- Average Leverage -->
    <div
      class="flex items-center justify-between cursor-help"
      @mouseenter="showPop(leveragePopover, leveragePopoverTimeout, $event)"
      @mouseleave="hidePop(leveragePopover, leveragePopoverTimeout)"
    >
      <div class="flex items-center gap-2">
        <i-mdi-trending-up class="text-blue-400 w-5 h-5" />
        <span class="text-surface-400 text-xs">{{ t('riskOverview.avgLeverage') }}</span>
      </div>
      <span
        class="text-lg font-bold"
        :class="avgLeverage > 3 ? 'text-red-400' : avgLeverage > 1.5 ? 'text-amber-400' : 'text-surface-200'"
      >
        {{ formatPrice(avgLeverage, 1) }}x
      </span>
    </div>

    <!-- Largest Position -->
    <div
      v-if="largestPosition"
      class="flex items-center justify-between rounded-lg px-3 py-1.5"
      style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06)"
    >
      <div class="flex items-center gap-2">
        <i-mdi-crown class="text-amber-400 w-4 h-4" />
        <span class="text-surface-400 text-[10px] uppercase tracking-wider">{{ t('riskOverview.largestPosition') }}</span>
      </div>
      <div class="flex flex-col items-end">
        <span class="text-surface-200 text-xs font-semibold">
          {{ largestPosition.pair }}
        </span>
        <span class="text-surface-400 text-[10px]">
          {{ formatPrice(largestPosition.stake, 2) }}
          <span v-if="currencyUnit" class="opacity-50">{{ currencyUnit }}</span>
          ({{ formatPrice(largestPosition.pctOfTotal, 1) }}%)
        </span>
      </div>
    </div>

    <!-- Drawdown gauge -->
    <div
      class="flex flex-col gap-1.5 rounded-lg px-3 py-2 cursor-help"
      style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06)"
      @mouseenter="showPop(drawdownPopover, drawdownPopoverTimeout, $event)"
      @mouseleave="hidePop(drawdownPopover, drawdownPopoverTimeout)"
    >
      <div class="flex items-center justify-between">
        <span class="text-surface-500 text-[10px] uppercase tracking-wider">{{ t('riskOverview.worstDrawdown') }}</span>
        <span
          class="font-semibold text-sm"
          :class="worstDrawdown < -10 ? 'text-red-400' : worstDrawdown < -5 ? 'text-amber-400' : 'text-green-400'"
        >
          {{ formatPrice(worstDrawdown, 1) }}%
        </span>
      </div>
      <div class="w-full h-2 rounded-full bg-surface-700 overflow-hidden">
        <div
          class="h-full rounded-full transition-all duration-500"
          :class="
            worstDrawdown < -10
              ? 'bg-red-500'
              : worstDrawdown < -5
                ? 'bg-amber-500'
                : 'bg-green-500'
          "
          :style="{ width: drawdownBarWidth * 2 + '%' }"
        />
      </div>
    </div>

    <!-- Overall PnL -->
    <div
      class="flex flex-col gap-1 rounded-lg px-3 py-2 cursor-help"
      style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06)"
      @mouseenter="showPop(pnlPopover, pnlPopoverTimeout, $event)"
      @mouseleave="hidePop(pnlPopover, pnlPopoverTimeout)"
    >
      <span class="text-surface-500 text-[10px] uppercase tracking-wider">{{ t('riskOverview.overallPnl') }}</span>
      <div class="flex items-baseline justify-between">
        <span
          class="font-bold text-lg"
          :class="overallPnlPct >= 0 ? 'text-green-400' : 'text-red-400'"
        >
          {{ formatPrice(overallPnlPct, 2) }}%
        </span>
        <span
          class="text-xs font-semibold"
          :class="totalOpenPnl >= 0 ? 'text-green-400' : 'text-red-400'"
        >
          {{ totalOpenPnl >= 0 ? '+' : '' }}{{ formatPrice(totalOpenPnl, 2) }}
          <span v-if="currencyUnit" class="font-normal opacity-50">{{ currencyUnit }}</span>
        </span>
      </div>
    </div>

    <!-- Correlation warnings -->
    <div
      class="flex items-center justify-between cursor-help"
      @mouseenter="showPop(correlationPopover, correlationPopoverTimeout, $event)"
      @mouseleave="hidePop(correlationPopover, correlationPopoverTimeout)"
    >
      <div class="flex items-center gap-2">
        <i-mdi-alert-circle class="w-5 h-5" :class="correlationWarnings > 0 ? 'text-amber-400' : 'text-surface-500'" />
        <span class="text-surface-400 text-xs">{{ t('riskOverview.correlationWarnings') }}</span>
      </div>
      <span
        class="font-bold text-lg"
        :class="correlationWarnings > 0 ? 'text-amber-400' : 'text-green-400'"
      >
        {{ correlationWarnings }}
      </span>
    </div>

    <!-- Exposure Popover -->
    <Popover ref="exposurePopover" class="p-0">
      <div class="p-3 text-xs min-w-[240px] max-w-[320px]">
        <div class="font-bold text-[11px] mb-2">{{ t('riskOverview.popoverExposureTitle') }}</div>
        <p class="text-surface-400 mb-2">{{ t('riskOverview.popoverExposureDesc') }}</p>
        <div v-for="bot in exposureByBot" :key="bot.name" class="flex justify-between py-0.5">
          <span class="font-semibold text-surface-300">{{ bot.name }}</span>
          <span class="font-mono">
            <span class="text-green-400">L {{ formatPrice(bot.long, 2) }}</span>
            <span class="text-surface-500 mx-1">/</span>
            <span class="text-red-400">S {{ formatPrice(bot.short, 2) }}</span>
            <span v-if="currencyUnit" class="opacity-50 ml-1">{{ currencyUnit }}</span>
          </span>
        </div>
      </div>
    </Popover>

    <!-- Drawdown Popover -->
    <Popover ref="drawdownPopover" class="p-0">
      <div class="p-3 text-xs min-w-[240px] max-w-[320px]">
        <div class="font-bold text-[11px] mb-2">{{ t('riskOverview.popoverDrawdownTitle') }}</div>
        <p class="text-surface-400 mb-2">{{ t('riskOverview.popoverDrawdownDesc') }}</p>
        <div v-if="worstDrawdownTrade" class="grid grid-cols-2 gap-x-3 gap-y-0.5">
          <span class="text-surface-400">{{ t('riskOverview.popoverDrawdownPair') }}</span>
          <span class="font-semibold text-red-400">{{ worstDrawdownTrade.pair }}</span>
          <span class="text-surface-400">{{ t('riskOverview.popoverDrawdownPct') }}</span>
          <span class="font-mono text-red-400">{{ formatPrice(worstDrawdownTrade.profit_pct ?? 0, 2) }}%</span>
          <span class="text-surface-400">{{ t('riskOverview.popoverDrawdownBot') }}</span>
          <span class="font-semibold text-surface-300">{{ worstDrawdownTrade.botName || worstDrawdownTrade.botId }}</span>
        </div>
      </div>
    </Popover>

    <!-- PnL Popover -->
    <Popover ref="pnlPopover" class="p-0">
      <div class="p-3 text-xs min-w-[220px] max-w-[300px]">
        <div class="font-bold text-[11px] mb-2">{{ t('riskOverview.popoverPnlTitle') }}</div>
        <p class="text-surface-400 mb-2">{{ t('riskOverview.popoverPnlDesc') }}</p>
        <div v-for="bot in pnlByBot" :key="bot.name" class="flex justify-between py-0.5">
          <span class="font-semibold text-surface-300">{{ bot.name }}</span>
          <span class="font-mono" :class="bot.pnl >= 0 ? 'text-green-400' : 'text-red-400'">
            {{ bot.pnl >= 0 ? '+' : '' }}{{ formatPrice(bot.pnl, 2) }}
            <span v-if="currencyUnit" class="opacity-50">{{ currencyUnit }}</span>
          </span>
        </div>
      </div>
    </Popover>

    <!-- Leverage Popover -->
    <Popover ref="leveragePopover" class="p-0">
      <div class="p-3 text-xs min-w-[220px] max-w-[300px]">
        <div class="font-bold text-[11px] mb-2">{{ t('riskOverview.popoverLeverageTitle') }}</div>
        <p class="text-surface-400 mb-2">{{ t('riskOverview.popoverLeverageDesc') }}</p>
        <div v-for="bot in leverageByBot" :key="bot.name" class="flex justify-between py-0.5">
          <span class="font-semibold text-surface-300">{{ bot.name }}</span>
          <span class="font-mono text-yellow-400">{{ formatPrice(bot.avgLev, 1) }}x</span>
          <span class="text-surface-500">({{ bot.count }} trades)</span>
        </div>
      </div>
    </Popover>

    <!-- Correlation Popover -->
    <Popover ref="correlationPopover" class="p-0">
      <div class="p-3 text-xs min-w-[240px] max-w-[320px]">
        <div class="font-bold text-[11px] mb-2">{{ t('riskOverview.popoverCorrelationTitle') }}</div>
        <p class="text-surface-400 mb-2">{{ t('riskOverview.popoverCorrelationDesc') }}</p>
        <template v-if="correlatedPairs.length > 0">
          <div v-for="cp in correlatedPairs" :key="cp.pair" class="py-0.5">
            <span class="font-semibold text-amber-400">{{ cp.pair }}</span>
            <span class="text-surface-400 ml-1">{{ cp.bots.join(', ') }}</span>
          </div>
        </template>
        <div v-else class="text-surface-500">{{ t('riskOverview.popoverCorrelationNone') }}</div>
      </div>
    </Popover>
  </div>
</template>

<style scoped>
.risk-overview {
  width: 100%;
  height: 100%;
}
</style>
