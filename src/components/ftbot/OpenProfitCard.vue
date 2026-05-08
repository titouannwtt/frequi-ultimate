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

// ── Section 1: Unrealized PnL Overview ──
const totalUnrealizedPnl = computed(() => {
  return openTrades.value.reduce((sum, t) => sum + (t.total_profit_abs ?? t.profit_abs ?? 0), 0);
});

const totalUnrealizedRatio = computed(() => {
  if (openTrades.value.length === 0) return 0;
  const totalStake = openTrades.value.reduce((sum, t) => sum + (t.stake_amount ?? 0), 0);
  if (totalStake === 0) return 0;
  return totalUnrealizedPnl.value / totalStake;
});

const totalStakeAllocated = computed(() => {
  return openTrades.value.reduce((sum, t) => sum + (t.stake_amount ?? 0), 0);
});

// % of this bot's balance allocated to open positions
const botBalance = computed(() => botStore.allBalance[props.botId]?.total_bot ?? botStore.allBalance[props.botId]?.total ?? 0);
const pctOfBotBalance = computed(() => botBalance.value > 0 ? (totalStakeAllocated.value / botBalance.value) * 100 : 0);

// % of ALL selected bots' total open stake
const totalAllBotsOpenStake = computed(() => {
  let total = 0;
  for (const [id, trades] of Object.entries(botStore.allOpenTrades)) {
    if (botStore.botStores[id]?.isSelected && trades) {
      total += trades.reduce((sum: number, t: Trade) => sum + (t.stake_amount ?? 0), 0);
    }
  }
  return total;
});
const pctOfAllBotsStake = computed(() => totalAllBotsOpenStake.value > 0 ? (totalStakeAllocated.value / totalAllBotsOpenStake.value) * 100 : 0);

// Donut: profit distribution across positions
const donutRadius = 44;
const donutStroke = 7;
const donutCircumference = 2 * Math.PI * donutRadius;

const positionSlices = computed(() => {
  if (openTrades.value.length === 0) return [];
  const total = openTrades.value.reduce((sum, t) => sum + Math.abs(t.stake_amount ?? 0), 0);
  if (total === 0) return [];
  let offset = -donutCircumference / 4;
  return openTrades.value.map((trade) => {
    const pct = Math.abs(trade.stake_amount ?? 0) / total;
    const dashLen = pct * donutCircumference;
    const slice = {
      pair: trade.pair.replace(/\/.*/, ''),
      dash: `${dashLen} ${donutCircumference}`,
      offset,
      color: (trade.profit_ratio ?? 0) >= 0 ? '#22c55e' : '#ef4444',
      profitRatio: trade.profit_ratio ?? 0,
    };
    offset -= dashLen;
    return slice;
  });
});

// ── Section 2: Position Details ──
const sortedTrades = computed(() => {
  return [...openTrades.value].sort((a, b) => (b.profit_ratio ?? 0) - (a.profit_ratio ?? 0));
});

const bestTrade = computed(() => {
  if (openTrades.value.length <= 1) return null;
  return sortedTrades.value[0];
});

const worstTrade = computed(() => {
  if (openTrades.value.length <= 1) return null;
  return sortedTrades.value[sortedTrades.value.length - 1];
});

// Parse avg_duration string "HH:MM:SS" to milliseconds
function parseAvgDurationMs(dur: string | undefined): number {
  if (!dur) return 0;
  const parts = dur.split(':').map(Number);
  if (parts.length !== 3) return 0;
  return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
}

const avgClosedDurationMs = computed(() => parseAvgDurationMs(profit.value?.avg_duration));

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

function tradeDurationStatus(trade: Trade): 'green' | 'yellow' | 'red' {
  if (avgClosedDurationMs.value === 0) return 'green';
  const ratio = tradeDurationMs(trade) / avgClosedDurationMs.value;
  if (ratio >= 2) return 'red';
  if (ratio >= 1.5) return 'yellow';
  return 'green';
}

// ── Section 3: Risk Analysis ──
const highestGain = computed(() => {
  if (openTrades.value.length === 0) return null;
  return openTrades.value.reduce((best, t) =>
    (t.profit_ratio ?? 0) > (best.profit_ratio ?? 0) ? t : best, openTrades.value[0]);
});

const highestLoss = computed(() => {
  if (openTrades.value.length === 0) return null;
  return openTrades.value.reduce((worst, t) =>
    (t.profit_ratio ?? 0) < (worst.profit_ratio ?? 0) ? t : worst, openTrades.value[0]);
});

const avgProfit = computed(() => {
  if (openTrades.value.length === 0) return 0;
  return openTrades.value.reduce((sum, t) => sum + (t.profit_ratio ?? 0), 0) / openTrades.value.length;
});

const weightedAvgProfit = computed(() => {
  if (totalStakeAllocated.value === 0) return 0;
  return openTrades.value.reduce((sum, t) =>
    sum + (t.profit_ratio ?? 0) * (t.stake_amount ?? 0), 0) / totalStakeAllocated.value;
});

// Gradient bar for profit distribution
const profitDistribution = computed(() => {
  if (openTrades.value.length === 0) return [];
  const sorted = [...openTrades.value].sort((a, b) => (a.profit_ratio ?? 0) - (b.profit_ratio ?? 0));
  const totalStake = sorted.reduce((sum, t) => sum + Math.abs(t.stake_amount ?? 0), 0);
  if (totalStake === 0) return [];
  return sorted.map((t) => ({
    widthPct: (Math.abs(t.stake_amount ?? 0) / totalStake) * 100,
    color: (t.profit_ratio ?? 0) >= 0 ? '#22c55e' : '#ef4444',
    pair: t.pair.replace(/\/.*/, ''),
    profitRatio: t.profit_ratio ?? 0,
  }));
});

// ── Section 4: Duration Context ──
const avgOpenDurationMs = computed(() => {
  if (openTrades.value.length === 0) return 0;
  const total = openTrades.value.reduce((sum, t) => sum + tradeDurationMs(t), 0);
  return total / openTrades.value.length;
});

const durationWarningTrades = computed(() => {
  if (avgClosedDurationMs.value === 0) return [];
  return openTrades.value.filter((t) => tradeDurationMs(t) > 2 * avgClosedDurationMs.value);
});

// ── Historical duration stats ──
const historicalDurations = computed(() => {
  if (!props.botId) return null;
  const closedTrades = botStore.botStores[props.botId]?.trades || [];
  if (closedTrades.length < 3) return null;
  const durations = closedTrades
    .filter(t => t.open_date && t.close_date)
    .map(t => new Date(t.close_date!).getTime() - new Date(t.open_date).getTime());
  if (durations.length === 0) return null;
  durations.sort((a, b) => a - b);
  return {
    min: durations[0],
    max: durations[durations.length - 1],
    avg: durations.reduce((a, b) => a + b, 0) / durations.length,
    median: durations[Math.floor(durations.length / 2)],
    count: durations.length,
  };
});

function durationBarPercent(trade: Trade): number {
  if (!historicalDurations.value) return 0;
  const dur = tradeDurationMs(trade);
  const range = historicalDurations.value.max - historicalDurations.value.min;
  if (range <= 0) return 50;
  return Math.min(Math.max(((dur - historicalDurations.value.min) / range) * 100, 0), 100);
}

// ── Helpers ──
function profitColor(val: number | null | undefined): string {
  if (val === undefined || val === null) return '';
  if (val > 0) return 'text-green-400';
  if (val < 0) return 'text-red-400';
  return 'text-gray-600 dark:text-gray-400';
}
</script>

<template>
  <div class="glass-card" style="width: 540px">

    <!-- Empty state: no open positions -->
    <div v-if="openTrades.length === 0" class="flex flex-col items-center justify-center py-8 gap-2">
      <i-mdi-check-circle class="text-3xl text-green-400/50" />
      <div class="text-sm text-gray-800 dark:text-gray-200">{{ t('emptyStates.noOpenPositions') }}</div>
      <div class="text-xs text-gray-600 dark:text-gray-400 text-center">{{ t('emptyStates.noOpenPositionsDesc') }}</div>
    </div>

    <template v-else>
    <!-- ═══ SECTION 1: Unrealized PnL Overview ═══ -->
    <div class="section-header">
      <i-mdi-chart-line class="text-blue-400" />
      <span>{{ t('openProfitCard.unrealizedPnl') }}</span>
    </div>
    <div class="flex items-center justify-around mb-3 pb-3 border-b border-black/5 dark:border-white/5">
      <!-- Large PnL number -->
      <div class="flex flex-col items-center">
        <div class="text-2xl font-bold" :class="profitColor(totalUnrealizedPnl)">
          {{ formatPriceCurrency(totalUnrealizedPnl, currency, 2) }}
        </div>
        <div class="text-[0.8rem] mt-0.5" :class="profitColor(totalUnrealizedRatio)">
          {{ formatPercent(totalUnrealizedRatio, 2) }} {{ t('openProfitCard.onCapitalAtRisk') }}
        </div>
      </div>

      <!-- SVG Donut: profit distribution -->
      <div v-if="openTrades.length > 0" class="flex flex-col items-center">
        <svg width="116" height="116" viewBox="0 0 116 116">
          <circle cx="58" cy="58" :r="donutRadius" fill="none" stroke="rgba(255,255,255,0.06)" :stroke-width="donutStroke" />
          <circle
            v-for="(slice, i) in positionSlices"
            :key="i"
            cx="58" cy="58" :r="donutRadius"
            fill="none" :stroke="slice.color" :stroke-width="donutStroke"
            stroke-linecap="round"
            :stroke-dasharray="slice.dash"
            :stroke-dashoffset="slice.offset"
            style="transition: stroke-dasharray 0.6s ease"
          />
          <text x="58" y="54" text-anchor="middle" class="fill-gray-100 font-bold" style="font-size: 0.95rem">
            {{ openTrades.length }}
          </text>
          <text x="58" y="68" text-anchor="middle" class="fill-gray-600 dark:fill-gray-500" style="font-size: 0.8rem">
            {{ t('openProfitCard.positions') }}
          </text>
        </svg>
      </div>
    </div>

    <!-- ═══ SECTION 2: Position Details ═══ -->
    <div v-if="openTrades.length > 0" class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
      <div class="section-header">
        <i-mdi-format-list-bulleted class="text-blue-400" />
        <span>{{ t('openProfitCard.positionDetails') }}</span>
      </div>
      <div class="max-h-none space-y-0.5 custom-scrollbar">
        <div
          v-for="trade in sortedTrades"
          :key="trade.trade_id"
          class="trade-row"
          :class="(trade.profit_ratio ?? 0) < 0 ? 'trade-row--loss' : 'trade-row--win'"
        >
          <!-- Pair name -->
          <span class="font-semibold text-gray-800 dark:text-gray-200 truncate" style="min-width: 55px; max-width: 70px">
            {{ trade.pair.replace(/\/.*/, '') }}
          </span>
          <!-- Direction badge -->
          <span class="direction-badge" :class="trade.is_short ? 'direction-badge--short' : 'direction-badge--long'">
            {{ trade.is_short ? 'S' : 'L' }}
          </span>
          <!-- Leverage -->
          <span v-if="trade.leverage && trade.leverage > 1" class="text-[0.8rem] text-yellow-400 font-bold">
            {{ trade.leverage }}x
          </span>
          <!-- Entry → Current -->
          <span class="text-[0.8rem] text-gray-600 dark:text-gray-500">
            {{ formatNumber(trade.open_rate, 2) }}
            <span class="text-gray-600">-></span>
            {{ formatNumber(trade.current_rate ?? trade.open_rate, 2) }}
          </span>
          <span class="flex-1" />
          <!-- Profit % -->
          <span class="font-bold text-sm" :class="profitColor(trade.profit_ratio)">
            {{ formatPercent(trade.profit_ratio ?? 0, 1) }}
          </span>
          <!-- Profit abs -->
          <span class="text-gray-600 dark:text-gray-500 text-[0.85rem]" style="min-width: 48px; text-align: right">
            {{ formatPriceCurrency(trade.total_profit_abs ?? trade.profit_abs ?? 0, currency, 2) }}
          </span>
          <!-- Exit value -->
          <span class="ml-1 text-[0.8rem]" :class="(trade.profit_abs ?? 0) >= 0 ? 'text-green-400 animate-pulse-subtle' : 'text-red-400'">
            &rarr; {{ formatPriceCurrency(trade.stake_amount + (trade.profit_abs ?? 0), currency, 2) }}
          </span>
          <!-- Duration + status dot -->
          <span class="flex items-center gap-0.5">
            <span
              class="duration-dot"
              :class="{
                'duration-dot--green': tradeDurationStatus(trade) === 'green',
                'duration-dot--yellow': tradeDurationStatus(trade) === 'yellow',
                'duration-dot--red': tradeDurationStatus(trade) === 'red',
              }"
            />
            <span class="text-gray-600 dark:text-gray-500 text-[0.85rem]" style="min-width: 36px; text-align: right">
              {{ humanDuration(tradeDurationMs(trade)) }}
            </span>
          </span>
          <!-- Stake -->
          <span class="text-gray-600 text-[0.8rem]" style="min-width: 32px; text-align: right">
            {{ formatNumber(trade.stake_amount, 0) }}
          </span>
          <!-- Best/Worst badge -->
          <span v-if="bestTrade && trade.trade_id === bestTrade.trade_id" class="badge-best" v-tooltip.top="t('openProfitCard.bestPosition')">
            B
          </span>
          <span v-else-if="worstTrade && trade.trade_id === worstTrade.trade_id && (worstTrade.profit_ratio ?? 0) < 0" class="badge-worst" v-tooltip.top="t('openProfitCard.worstPosition')">
            W
          </span>
        </div>
      </div>
    </div>
    <div v-else class="mb-3 pb-3 border-b border-black/5 dark:border-white/5 text-center text-gray-600 dark:text-gray-500 py-3 text-[0.8rem]">
      {{ t('openProfitCard.noOpenTrades') }}
    </div>

    <!-- ═══ SECTION 3: Risk Analysis ═══ -->
    <div v-if="openTrades.length > 0" class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
      <div class="section-header">
        <i-mdi-shield-alert class="text-amber-400" />
        <span>{{ t('openProfitCard.riskAnalysis') }}</span>
      </div>
      <div class="space-y-0.5">
        <div v-if="highestLoss" class="stat-row">
          <span class="stat-label" v-tooltip.top="t('tooltips.highestLoss')">{{ t('openProfitCard.highestLoss') }}</span>
          <span class="stat-value text-red-400">
            {{ highestLoss.pair.replace(/\/.*/, '') }} {{ formatPercent(highestLoss.profit_ratio ?? 0, 1) }}
          </span>
        </div>
        <div v-if="highestGain" class="stat-row">
          <span class="stat-label" v-tooltip.top="t('tooltips.highestGain')">{{ t('openProfitCard.highestGain') }}</span>
          <span class="stat-value text-green-400">
            {{ highestGain.pair.replace(/\/.*/, '') }} {{ formatPercent(highestGain.profit_ratio ?? 0, 1) }}
          </span>
        </div>
        <div class="stat-row">
          <span class="stat-label" v-tooltip.top="t('tooltips.avgPositionProfit')">{{ t('openProfitCard.avgPositionProfit') }}</span>
          <span class="stat-value" :class="profitColor(avgProfit)">
            {{ formatPercent(avgProfit, 2) }}
          </span>
        </div>
        <div class="stat-row">
          <span class="stat-label" v-tooltip.top="t('tooltips.weightedAvgProfit')">{{ t('openProfitCard.weightedAvgProfit') }}</span>
          <span class="stat-value" :class="profitColor(weightedAvgProfit)">
            {{ formatPercent(weightedAvgProfit, 2) }}
          </span>
        </div>
        <div class="stat-row">
          <span class="stat-label" v-tooltip.top="t('tooltips.totalStakeLocked')">{{ t('openProfitCard.totalStakeLocked') }}</span>
          <span class="stat-value">{{ formatPriceCurrency(totalStakeAllocated, currency, 2) }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label" v-tooltip.top="t('tooltips.pctOfBotBalance')">{{ t('summaryCards.pctOfBotBalance') }}</span>
          <span class="stat-value text-blue-400">{{ formatPercent(pctOfBotBalance / 100, 1) }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label" v-tooltip.top="t('tooltips.pctOfAllBots')">{{ t('summaryCards.pctOfAllBotsOpenPositions') }}</span>
          <span class="stat-value text-blue-300">{{ formatPercent(pctOfAllBotsStake / 100, 1) }}</span>
        </div>
      </div>
      <!-- Gradient bar: distribution of profits -->
      <div v-if="profitDistribution.length > 0" class="mt-2">
        <div class="h-2.5 rounded-full overflow-hidden flex bg-white/5">
          <div
            v-for="(seg, i) in profitDistribution"
            :key="i"
            class="h-full transition-all duration-500"
            :style="{ width: `${seg.widthPct}%`, background: seg.color }"
            v-tooltip.top="`${seg.pair}: ${formatPercent(seg.profitRatio, 1)}`"
          />
        </div>
        <div class="flex justify-between mt-0.5 text-[0.8rem] text-gray-600 dark:text-gray-500">
          <span>{{ t('openProfitCard.mostLoss') }}</span>
          <span>{{ t('openProfitCard.mostGain') }}</span>
        </div>
      </div>
    </div>

    <!-- ═══ SECTION 4: Duration Context ═══ -->
    <div v-if="openTrades.length > 0">
      <div class="section-header">
        <i-mdi-timer-sand class="text-purple-400" />
        <span>{{ t('openProfitCard.durationContext') }}</span>
        <span v-if="durationWarningTrades.length > 0" class="ml-auto anomaly-warning">
          {{ durationWarningTrades.length }} {{ t('openProfitCard.exceedAvg') }}
        </span>
      </div>
      <div class="space-y-0.5">
        <div class="stat-row">
          <span class="stat-label" v-tooltip="t('tooltips.durationAnomaly')">{{ t('openProfitCard.avgOpenDuration') }}</span>
          <span class="stat-value">{{ humanDuration(avgOpenDurationMs) }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label" v-tooltip="t('tooltips.avgClosedDuration')">{{ t('openProfitCard.avgClosedDuration') }}</span>
          <span class="stat-value">{{ profit?.avg_duration ?? 'N/A' }}</span>
        </div>
        <!-- Historical duration range -->
        <template v-if="historicalDurations">
          <div class="stat-row">
            <span class="stat-label" v-tooltip.top="t('tooltips.historicalRange')">{{ t('openProfitCard.historicalRange') }}</span>
            <span class="stat-value">{{ humanDuration(historicalDurations.min) }} — {{ humanDuration(historicalDurations.max) }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label" v-tooltip.top="t('tooltips.medianDuration')">{{ t('openProfitCard.median') }}</span>
            <span class="stat-value">{{ humanDuration(historicalDurations.median) }}</span>
          </div>
          <!-- Mini bar chart for each open trade -->
          <div v-for="trade in sortedTrades" :key="'hist-' + trade.trade_id" class="flex items-center gap-1.5 mt-1">
            <span class="text-[0.85rem] text-gray-600 dark:text-gray-400 truncate" style="min-width: 50px; max-width: 60px">
              {{ trade.pair.replace(/\/.*/, '') }}
            </span>
            <div class="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden relative">
              <div
                class="absolute top-0 left-0 h-full rounded-full transition-all duration-500"
                :class="durationBarPercent(trade) > 100 ? 'bg-red-500' : durationBarPercent(trade) > 75 ? 'bg-amber-500' : 'bg-blue-500'"
                :style="{ width: `${Math.min(durationBarPercent(trade), 100)}%` }"
              />
              <!-- Median marker -->
              <div
                v-if="historicalDurations.max > historicalDurations.min"
                class="absolute top-0 h-full w-px bg-gray-400/50"
                :style="{ left: `${((historicalDurations.median - historicalDurations.min) / (historicalDurations.max - historicalDurations.min)) * 100}%` }"
              />
            </div>
            <span class="text-[0.8rem] text-gray-600 dark:text-gray-500" style="min-width: 32px; text-align: right">
              {{ humanDuration(tradeDurationMs(trade)) }}
            </span>
          </div>
        </template>
        <div v-for="wt in durationWarningTrades" :key="'warn-' + wt.trade_id" class="stat-row">
          <span class="stat-label text-amber-400/80">
            {{ wt.pair.replace(/\/.*/, '') }}
          </span>
          <span class="stat-value text-amber-400">
            {{ humanDuration(tradeDurationMs(wt)) }}
            ({{ (tradeDurationMs(wt) / avgClosedDurationMs).toFixed(1) }}x avg)
          </span>
        </div>
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
  gap: 5px;
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

.badge-best {
  font-size: 0.95rem;
  font-weight: 700;
  padding: 1px 3px;
  border-radius: 3px;
  background: rgba(34, 197, 94, 0.2);
  color: #86efac;
  letter-spacing: 0.05em;
}

.badge-worst {
  font-size: 0.95rem;
  font-weight: 700;
  padding: 1px 3px;
  border-radius: 3px;
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
  letter-spacing: 0.05em;
}

.anomaly-warning {
  font-size: 0.95rem;
  color: #f59e0b;
  font-weight: 600;
  animation: pulse-amber 2s ease-in-out infinite;
}

@keyframes pulse-red {
  0%, 100% { box-shadow: 0 0 4px rgba(239, 68, 68, 0.4); }
  50% { box-shadow: 0 0 10px rgba(239, 68, 68, 0.7); }
}

.animate-pulse-subtle {
  animation: pulse-subtle 2s ease-in-out infinite;
}

@keyframes pulse-subtle {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

@keyframes pulse-amber {
  0%, 100% { box-shadow: 0 0 4px rgba(245, 158, 11, 0.3); }
  50% { box-shadow: 0 0 8px rgba(245, 158, 11, 0.6); }
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
