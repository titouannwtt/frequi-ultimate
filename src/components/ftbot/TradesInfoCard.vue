<script setup lang="ts">
import type { Trade } from '@/types/trades';
import type { ProfitStats } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  botId: string;
  stakeCurrency?: string;
}>();

const botStore = useBotStore();

const openTrades = computed<Trade[]>(() => {
  return botStore.allOpenTrades[props.botId] ?? [];
});

const profit = computed<ProfitStats | undefined>(() => {
  return botStore.allProfit[props.botId];
});

const botState = computed(() => {
  return botStore.allBotState[props.botId];
});

const currency = computed(() => props.stakeCurrency || (botState.value?.stake_currency as string) || 'USDC');

const hasAnyTradingActivity = computed(() => {
  return openTrades.value.length > 0 || (profit.value?.trade_count ?? 0) > 0;
});

// ── Position Overview ──
const maxOpenTrades = computed(() => {
  const val = botState.value?.max_open_trades;
  if (!val || (val as number) <= 0) return Infinity;
  return val as number;
});

const capacityPercent = computed(() => {
  if (maxOpenTrades.value === Infinity) return 0;
  return Math.min((openTrades.value.length / maxOpenTrades.value) * 100, 100);
});

const totalStakeAllocated = computed(() => {
  return openTrades.value.reduce((sum, t) => sum + (t.stake_amount ?? 0), 0);
});

const winningStake = computed(() => {
  return openTrades.value
    .filter((t) => (t.profit_ratio ?? 0) >= 0)
    .reduce((sum, t) => sum + (t.stake_amount ?? 0), 0);
});

const losingStake = computed(() => {
  return openTrades.value
    .filter((t) => (t.profit_ratio ?? 0) < 0)
    .reduce((sum, t) => sum + (t.stake_amount ?? 0), 0);
});

// ── SVG Donut helpers ──
const donutRadius = 44;
const donutStroke = 7;
const donutCircumference = 2 * Math.PI * donutRadius;

// Capacity donut
const capacityDash = computed(() => {
  if (maxOpenTrades.value === Infinity) {
    // Show a small arc for open trades, max out at 75%
    const pct = Math.min(openTrades.value.length * 0.15, 0.75);
    return `${pct * donutCircumference} ${donutCircumference}`;
  }
  const pct = Math.min(openTrades.value.length / maxOpenTrades.value, 1);
  return `${pct * donutCircumference} ${donutCircumference}`;
});

const capacityLabel = computed(() => {
  const max = maxOpenTrades.value === Infinity ? '\u221E' : maxOpenTrades.value;
  return `${openTrades.value.length}/${max}`;
});

// ── Duration Analysis ──
function tradeDurationMs(trade: Trade): number {
  if (!trade.open_timestamp) return 0;
  return Date.now() - trade.open_timestamp;
}

function humanDuration(ms: number): string {
  if (ms <= 0) return '-';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return '<1m';
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

// Parse avg_duration string "HH:MM:SS" to milliseconds
function parseAvgDurationMs(dur: string | undefined): number {
  if (!dur) return 0;
  const parts = dur.split(':').map(Number);
  if (parts.length !== 3) return 0;
  return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
}

const avgClosedDurationMs = computed(() => parseAvgDurationMs(profit.value?.avg_duration));

const longestOpenMs = computed(() => {
  if (openTrades.value.length === 0) return 0;
  return Math.max(...openTrades.value.map(tradeDurationMs));
});

const durationAnomalyScore = computed(() => {
  if (avgClosedDurationMs.value === 0) return 0;
  return longestOpenMs.value / avgClosedDurationMs.value;
});

function tradeDurationStatus(trade: Trade): 'green' | 'yellow' | 'red' {
  if (avgClosedDurationMs.value === 0) return 'green';
  const ratio = tradeDurationMs(trade) / avgClosedDurationMs.value;
  if (ratio >= 2) return 'red';
  if (ratio >= 1.5) return 'yellow';
  return 'green';
}

function tradeDurationTooltip(trade: Trade): string {
  if (avgClosedDurationMs.value === 0) return '';
  const ratio = (tradeDurationMs(trade) / avgClosedDurationMs.value).toFixed(1);
  return t('tradesInfoCard.durationTooltip', { ratio });
}

// Max bar width for duration chart
const maxDurationForBar = computed(() => {
  if (openTrades.value.length === 0) return 1;
  const maxOpen = Math.max(...openTrades.value.map(tradeDurationMs));
  return Math.max(maxOpen, avgClosedDurationMs.value * 2);
});

function durationBarPercent(trade: Trade): number {
  return Math.min((tradeDurationMs(trade) / maxDurationForBar.value) * 100, 100);
}

const avgDurationLinePercent = computed(() => {
  if (avgClosedDurationMs.value === 0) return 0;
  return Math.min((avgClosedDurationMs.value / maxDurationForBar.value) * 100, 100);
});

// ── Capital Exposure ──
const avgStakePerPosition = computed(() => {
  if (openTrades.value.length === 0) return 0;
  return totalStakeAllocated.value / openTrades.value.length;
});

const largestPosition = computed(() => {
  if (openTrades.value.length === 0) return null;
  return openTrades.value.reduce((max, t) => (t.stake_amount > (max?.stake_amount ?? 0) ? t : max), openTrades.value[0]);
});

// Capital bar percentages (use total stake * 3 as visual reference if no effective capital)
const capitalBarTotal = computed(() => Math.max(totalStakeAllocated.value * 3, 1));
const winningBarPct = computed(() => (winningStake.value / capitalBarTotal.value) * 100);
const losingBarPct = computed(() => (losingStake.value / capitalBarTotal.value) * 100);

// ── Trading Rhythm ──
const totalTradeCount = computed(() => profit.value?.trade_count ?? 0);
const firstTradeTs = computed(() => profit.value?.first_trade_timestamp ?? 0);
const latestTradeTs = computed(() => profit.value?.latest_trade_timestamp ?? 0);
const tradingPeriodDays = computed(() => {
  if (!firstTradeTs.value || !latestTradeTs.value) return 0;
  return (latestTradeTs.value - firstTradeTs.value) / (1000 * 60 * 60 * 24);
});

const tradesPerDay = computed(() => {
  if (tradingPeriodDays.value < 1) return undefined;
  return totalTradeCount.value / tradingPeriodDays.value;
});

const tradesPerWeek = computed(() => {
  if (tradingPeriodDays.value < 1) return undefined;
  return totalTradeCount.value / (tradingPeriodDays.value / 7);
});

const avgTimeBetweenTradesMs = computed(() => {
  if (totalTradeCount.value <= 1) return 0;
  return (tradingPeriodDays.value * 24 * 60 * 60 * 1000) / totalTradeCount.value;
});

const timeSinceLastTradeMs = computed(() => {
  if (!latestTradeTs.value) return 0;
  return Date.now() - latestTradeTs.value;
});

const isUnusuallyQuiet = computed(() => {
  if (avgTimeBetweenTradesMs.value === 0) return false;
  return timeSinceLastTradeMs.value > 2 * avgTimeBetweenTradesMs.value;
});

// ── Win Rate ──
const wins = computed(() => profit.value?.winning_trades ?? 0);
const losses = computed(() => profit.value?.losing_trades ?? 0);
const totalClosed = computed(() => wins.value + losses.value);
const winrate = computed(() => totalClosed.value > 0 ? (wins.value / totalClosed.value) * 100 : 0);

// ── Helpers ──
function profitColor(val: number | null | undefined): string {
  if (val === undefined || val === null) return '';
  if (val > 0) return 'text-green-400';
  if (val < 0) return 'text-red-400';
  return 'text-gray-600 dark:text-gray-400';
}

const tradesInDrawdown = computed(() => {
  return openTrades.value.filter((t) => (t.profit_ratio ?? 0) < 0);
});

// Sort trades by profit for position list
const sortedTrades = computed(() => {
  return [...openTrades.value].sort((a, b) => (b.profit_ratio ?? 0) - (a.profit_ratio ?? 0));
});
</script>

<template>
  <div class="glass-card" style="width: 540px">

    <!-- Empty state: no trading activity at all -->
    <div v-if="!hasAnyTradingActivity" class="flex flex-col items-center justify-center py-8 gap-2">
      <i-mdi-chart-line class="text-3xl text-blue-400/40" />
      <div class="text-sm text-gray-800 dark:text-gray-200">{{ t('emptyStates.noTradingActivity') }}</div>
      <div class="text-xs text-gray-600 dark:text-gray-400 text-center">{{ t('emptyStates.noTradingActivityDesc') }}</div>
    </div>

    <template v-else>
    <!-- ═══ SECTION 1: Position Overview (Dual Donuts) ═══ -->
    <div class="section-header">
      <i-mdi-view-dashboard class="text-blue-400" />
      <span>{{ t('tradesInfoCard.positionOverview') }}</span>
    </div>
    <div class="flex items-center justify-around mb-3 pb-3 border-b border-black/5 dark:border-white/5">
      <!-- Capacity Ring -->
      <div class="flex flex-col items-center">
        <svg width="116" height="116" viewBox="0 0 116 116">
          <defs>
            <linearGradient id="capacityGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#3b82f6" />
              <stop offset="100%" stop-color="#60a5fa" />
            </linearGradient>
          </defs>
          <circle cx="58" cy="58" :r="donutRadius" fill="none" stroke="rgba(255,255,255,0.06)" :stroke-width="donutStroke" />
          <circle
            cx="58" cy="58" :r="donutRadius"
            fill="none" stroke="url(#capacityGrad)" :stroke-width="donutStroke"
            stroke-linecap="round"
            :stroke-dasharray="capacityDash"
            :stroke-dashoffset="donutCircumference / 4"
            style="transition: stroke-dasharray 0.6s ease"
          />
          <text x="58" y="54" text-anchor="middle" class="fill-gray-100 font-bold" style="font-size: 0.85rem">
            {{ capacityLabel }}
          </text>
          <text x="58" y="66" text-anchor="middle" class="fill-gray-600 dark:fill-gray-500" style="font-size: 0.7rem">
            {{ t('tradesInfoCard.slots') }}
          </text>
        </svg>
      </div>

      <!-- Capital Allocation Ring -->
      <div class="flex flex-col items-center">
        <svg width="116" height="116" viewBox="0 0 116 116">
          <defs>
            <linearGradient id="capitalGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#22c55e" />
              <stop offset="100%" stop-color="#4ade80" />
            </linearGradient>
          </defs>
          <circle cx="58" cy="58" :r="donutRadius" fill="none" stroke="rgba(255,255,255,0.06)" :stroke-width="donutStroke" />
          <circle
            cx="58" cy="58" :r="donutRadius"
            fill="none" stroke="url(#capitalGrad)" :stroke-width="donutStroke"
            stroke-linecap="round"
            :stroke-dasharray="`${Math.min(totalStakeAllocated / Math.max(totalStakeAllocated * 3, 1), 1) * donutCircumference} ${donutCircumference}`"
            :stroke-dashoffset="donutCircumference / 4"
            style="transition: stroke-dasharray 0.6s ease"
          />
          <text x="58" y="54" text-anchor="middle" class="fill-gray-100 font-bold" style="font-size: 0.8rem">
            {{ formatNumber(totalStakeAllocated, 0) }}
          </text>
          <text x="58" y="66" text-anchor="middle" class="fill-gray-600 dark:fill-gray-500" style="font-size: 0.6rem">
            {{ currency }}
          </text>
        </svg>
      </div>
    </div>

    <!-- ═══ SECTION 2: Current Positions ═══ -->
    <div v-if="openTrades.length > 0" class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
      <div class="section-header">
        <i-mdi-format-list-bulleted class="text-blue-400" />
        <span>{{ t('tradesInfoCard.currentPositions') }}</span>
        <span v-if="tradesInDrawdown.length > 0" class="ml-auto text-[0.8rem] text-red-400/80">
          {{ tradesInDrawdown.length }} {{ t('tradesInfoCard.inDrawdown') }}
        </span>
      </div>
      <div class="max-h-none space-y-0.5 custom-scrollbar">
        <div
          v-for="trade in sortedTrades"
          :key="trade.trade_id"
          class="trade-row"
          :class="(trade.profit_ratio ?? 0) < 0 ? 'trade-row--loss' : 'trade-row--win'"
        >
          <!-- Duration status dot -->
          <span
            class="duration-dot"
            :class="{
              'duration-dot--green': tradeDurationStatus(trade) === 'green',
              'duration-dot--yellow': tradeDurationStatus(trade) === 'yellow',
              'duration-dot--red': tradeDurationStatus(trade) === 'red',
            }"
            v-tooltip.top="tradeDurationTooltip(trade)"
          />
          <!-- Pair -->
          <span class="font-semibold text-gray-800 dark:text-gray-200 truncate" style="min-width: 60px; max-width: 75px">
            {{ trade.pair.replace(/\/.*/, '') }}
          </span>
          <!-- Direction badge -->
          <span class="direction-badge" :class="trade.is_short ? 'direction-badge--short' : 'direction-badge--long'">
            {{ trade.is_short ? 'S' : 'L' }}
          </span>
          <span class="flex-1" />
          <!-- Profit % -->
          <span class="font-bold" :class="profitColor(trade.profit_ratio)">
            {{ formatPercent(trade.profit_ratio ?? 0, 1) }}
          </span>
          <!-- Profit abs -->
          <span class="text-gray-600 dark:text-gray-500 text-[0.85rem]" style="min-width: 50px; text-align: right">
            {{ formatPriceCurrency(trade.total_profit_abs ?? trade.profit_abs ?? 0, currency, 2) }}
          </span>
          <!-- Duration -->
          <span class="text-gray-600 dark:text-gray-500 text-[0.85rem]" style="min-width: 42px; text-align: right">
            {{ humanDuration(tradeDurationMs(trade)) }}
          </span>
          <!-- Stake -->
          <span class="text-gray-600 text-[0.8rem]" style="min-width: 38px; text-align: right">
            {{ formatNumber(trade.stake_amount, 0) }}
          </span>
        </div>
      </div>
    </div>
    <div v-else class="mb-3 pb-3 border-b border-black/5 dark:border-white/5 text-center text-gray-600 dark:text-gray-500 py-3 text-[0.8rem]">
      {{ t('tradesInfoCard.noOpenPositions') }}
    </div>

    <!-- ═══ SECTION 3: Duration Analysis ═══ -->
    <div v-if="openTrades.length > 0" class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
      <div class="section-header">
        <i-mdi-timer-sand class="text-amber-400" />
        <span>{{ t('tradesInfoCard.durationAnalysis') }}</span>
        <span v-if="durationAnomalyScore > 2" class="ml-auto anomaly-warning">
          {{ t('tradesInfoCard.stuck') }}
        </span>
      </div>
      <div class="space-y-1 mb-2">
        <div class="stat-row">
          <span class="stat-label" v-tooltip.top="t('tooltips.avgClosedDuration')">{{ t('tradesInfoCard.avgClosedDuration') }}</span>
          <span class="stat-value">{{ profit?.avg_duration ?? 'N/A' }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label" v-tooltip.top="t('tooltips.durationAnomaly')">{{ t('tradesInfoCard.longestOpen') }}</span>
          <span class="stat-value" :class="durationAnomalyScore > 2 ? 'text-red-400' : ''">
            {{ humanDuration(longestOpenMs) }}
          </span>
        </div>
        <div v-if="avgClosedDurationMs > 0" class="stat-row">
          <span class="stat-label" v-tooltip.top="t('tooltips.anomalyScore')">{{ t('tradesInfoCard.anomalyScore') }}</span>
          <span
            class="stat-value font-bold"
            :class="durationAnomalyScore > 2 ? 'text-red-400' : durationAnomalyScore > 1.5 ? 'text-amber-400' : 'text-green-400'"
          >
            {{ durationAnomalyScore.toFixed(1) }}x
          </span>
        </div>
      </div>
      <!-- Mini bar chart -->
      <div class="relative space-y-0.5">
        <div
          v-for="trade in sortedTrades"
          :key="'bar-' + trade.trade_id"
          class="flex items-center gap-1.5"
        >
          <span class="text-[0.8rem] text-gray-600 dark:text-gray-500 truncate" style="min-width: 42px; max-width: 50px">
            {{ trade.pair.replace(/\/.*/, '') }}
          </span>
          <div class="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden relative">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="tradeDurationStatus(trade) === 'red' ? 'bg-gradient-to-r from-red-600 to-red-400' : tradeDurationStatus(trade) === 'yellow' ? 'bg-gradient-to-r from-amber-600 to-amber-400' : 'bg-gradient-to-r from-blue-600 to-blue-400'"
              :style="{ width: `${durationBarPercent(trade)}%` }"
            />
          </div>
        </div>
        <!-- Average duration vertical line -->
        <div
          v-if="avgClosedDurationMs > 0 && avgDurationLinePercent > 0"
          class="avg-duration-line"
          :style="{ left: `calc(50px + ${avgDurationLinePercent}% * (100% - 50px) / 100%)` }"
          v-tooltip.top="t('tradesInfoCard.avgDurationLine')"
        >
          <div class="avg-duration-line-inner" />
          <span class="avg-duration-line-label">avg</span>
        </div>
      </div>
    </div>

    <!-- ═══ SECTION 4: Capital Exposure ═══ -->
    <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
      <div class="section-header">
        <i-mdi-wallet class="text-green-400" />
        <span>{{ t('tradesInfoCard.capitalExposure') }}</span>
      </div>
      <!-- Stacked capital bar -->
      <div class="h-3 rounded-full bg-white/5 overflow-hidden flex mb-2">
        <div
          v-if="winningStake > 0"
          class="h-full bg-gradient-to-r from-green-600 to-green-400 transition-all duration-500"
          :style="{ width: `${winningBarPct}%` }"
          v-tooltip.top="t('tradesInfoCard.winningPositions')"
        />
        <div
          v-if="losingStake > 0"
          class="h-full bg-gradient-to-r from-red-600 to-red-400 transition-all duration-500"
          :style="{ width: `${losingBarPct}%` }"
          v-tooltip.top="t('tradesInfoCard.losingPositions')"
        />
      </div>
      <div class="flex gap-3 mb-2 text-[0.85rem]">
        <div class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-green-500" />
          <span class="text-gray-600 dark:text-gray-400">{{ t('tradesInfoCard.winning') }}</span>
          <span class="text-gray-800 dark:text-gray-200">{{ formatPriceCurrency(winningStake, currency, 0) }}</span>
        </div>
        <div class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-red-500" />
          <span class="text-gray-600 dark:text-gray-400">{{ t('tradesInfoCard.losing') }}</span>
          <span class="text-gray-800 dark:text-gray-200">{{ formatPriceCurrency(losingStake, currency, 0) }}</span>
        </div>
        <div class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-gray-600" />
          <span class="text-gray-600 dark:text-gray-400">{{ t('tradesInfoCard.free') }}</span>
        </div>
      </div>
      <div class="space-y-0.5">
        <div class="stat-row">
          <span class="stat-label" v-tooltip="t('tooltips.capitalAllocation')">{{ t('tradesInfoCard.totalAllocated') }}</span>
          <span class="stat-value">{{ formatPriceCurrency(totalStakeAllocated, currency, 2) }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label" v-tooltip="t('tooltips.capitalInTrades')">{{ t('tradesInfoCard.avgStake') }}</span>
          <span class="stat-value">{{ formatPriceCurrency(avgStakePerPosition, currency, 2) }}</span>
        </div>
        <div v-if="largestPosition" class="stat-row">
          <span class="stat-label" v-tooltip="t('tooltips.totalStakeLocked')">{{ t('tradesInfoCard.largestPosition') }}</span>
          <span class="stat-value">
            {{ largestPosition.pair.replace(/\/.*/, '') }}
            <span class="text-gray-600 dark:text-gray-500 ml-1">{{ formatPriceCurrency(largestPosition.stake_amount, currency, 0) }}</span>
          </span>
        </div>
      </div>
    </div>

    <!-- ═══ SECTION 5: Trading Rhythm ═══ -->
    <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
      <div class="section-header">
        <i-mdi-metronome class="text-purple-400" />
        <span>{{ t('tradesInfoCard.tradingRhythm') }}</span>
        <span v-if="isUnusuallyQuiet" class="ml-auto anomaly-warning">
          {{ t('tradesInfoCard.unusuallyQuiet') }}
        </span>
      </div>
      <div class="space-y-0.5">
        <div v-if="tradesPerDay !== undefined" class="stat-row">
          <span class="stat-label" v-tooltip="t('tooltips.tradesPerDay')">{{ t('tradesInfoCard.perDay') }}</span>
          <span class="stat-value">{{ formatNumber(tradesPerDay, 1) }}</span>
        </div>
        <div v-if="tradesPerWeek !== undefined" class="stat-row">
          <span class="stat-label" v-tooltip="t('tooltips.tradesPerWeek')">{{ t('tradesInfoCard.perWeek') }}</span>
          <span class="stat-value">{{ formatNumber(tradesPerWeek, 1) }}</span>
        </div>
        <div v-if="avgTimeBetweenTradesMs > 0" class="stat-row">
          <span class="stat-label" v-tooltip="t('tooltips.timeBetweenTrades')">{{ t('tradesInfoCard.avgTimeBetween') }}</span>
          <span class="stat-value">{{ humanDuration(avgTimeBetweenTradesMs) }}</span>
        </div>
        <div v-if="latestTradeTs > 0" class="stat-row">
          <span class="stat-label" v-tooltip="t('tooltips.timeSinceLastTrade')">{{ t('tradesInfoCard.sinceLastTrade') }}</span>
          <span class="stat-value" :class="isUnusuallyQuiet ? 'text-amber-400' : ''">
            {{ humanDuration(timeSinceLastTradeMs) }}
          </span>
        </div>
      </div>
    </div>

    <!-- ═══ SECTION 6: Win Rate Bar ═══ -->
    <div>
      <div class="section-header">
        <i-mdi-trophy class="text-yellow-400" />
        <span>{{ t('tradesInfoCard.winRate') }}</span>
      </div>
      <div class="flex items-center gap-2 mb-1.5">
        <div class="flex-1 h-3 rounded-full overflow-hidden bg-white/5">
          <div v-if="totalClosed > 0" class="h-full flex">
            <div
              class="bg-gradient-to-r from-green-600 to-green-400 transition-all duration-500"
              :style="{ width: `${winrate}%` }"
            />
            <div
              class="bg-gradient-to-r from-red-600 to-red-400 transition-all duration-500"
              :style="{ width: `${100 - winrate}%` }"
            />
          </div>
        </div>
        <span class="text-sm font-bold text-gray-100" style="min-width: 40px; text-align: right">
          {{ winrate.toFixed(0) }}%
        </span>
      </div>
      <div class="flex justify-between">
        <span class="text-[0.85rem]">
          <span class="text-green-400 font-bold">{{ wins }}</span>
          <span class="text-gray-600 dark:text-gray-500 ml-0.5">{{ t('tradesInfoCard.wins') }}</span>
        </span>
        <span class="text-[0.85rem]">
          <span class="text-red-400 font-bold">{{ losses }}</span>
          <span class="text-gray-600 dark:text-gray-500 ml-0.5">{{ t('tradesInfoCard.losses') }}</span>
        </span>
        <span class="text-[0.85rem] text-gray-600 dark:text-gray-500">
          {{ totalClosed }} {{ t('tradesInfoCard.total') }}
        </span>
      </div>
    </div>
    </template>
  </div>
</template>

<style scoped>
.glass-card {
  font-size: 0.9rem;
  line-height: 1.4;
  background: rgba(15, 17, 23, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 16px;
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  letter-spacing: 0.02em;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1px 0;
}

.stat-label {
  color: rgba(255, 255, 255, 0.35);
  font-size: 0.95rem;
}

.stat-value {
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.95rem;
}

.trade-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 6px;
  font-size: 0.95rem;
  transition: background 0.2s ease;
}

.trade-row--win {
  background: rgba(34, 197, 94, 0.04);
}

.trade-row--win:hover {
  background: rgba(34, 197, 94, 0.1);
}

.trade-row--loss {
  background: rgba(239, 68, 68, 0.06);
}

.trade-row--loss:hover {
  background: rgba(239, 68, 68, 0.12);
}

.direction-badge {
  font-size: 0.9rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  letter-spacing: 0.05em;
}

.direction-badge--long {
  background: rgba(34, 197, 94, 0.15);
  color: #86efac;
}

.direction-badge--short {
  background: rgba(239, 68, 68, 0.15);
  color: #fca5a5;
}

.duration-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.duration-dot--green {
  background: #22c55e;
  box-shadow: 0 0 4px rgba(34, 197, 94, 0.4);
}

.duration-dot--yellow {
  background: #f59e0b;
  box-shadow: 0 0 4px rgba(245, 158, 11, 0.4);
  animation: pulse-amber 2s ease-in-out infinite;
}

.duration-dot--red {
  background: #ef4444;
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.5);
  animation: pulse-red 1.5s ease-in-out infinite;
}

@keyframes pulse-red {
  0%, 100% { box-shadow: 0 0 4px rgba(239, 68, 68, 0.4); }
  50% { box-shadow: 0 0 10px rgba(239, 68, 68, 0.7); }
}

@keyframes pulse-amber {
  0%, 100% { box-shadow: 0 0 4px rgba(245, 158, 11, 0.3); }
  50% { box-shadow: 0 0 8px rgba(245, 158, 11, 0.6); }
}

.anomaly-warning {
  font-size: 0.95rem;
  color: #f59e0b;
  font-weight: 600;
  animation: pulse-amber 2s ease-in-out infinite;
}

.avg-duration-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}

.avg-duration-line-inner {
  flex: 1;
  width: 1px;
  background: rgba(239, 68, 68, 0.5);
  border-left: 1px dashed rgba(239, 68, 68, 0.5);
}

.avg-duration-line-label {
  font-size: 0.4rem;
  color: rgba(239, 68, 68, 0.6);
  margin-top: 1px;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 3px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>
