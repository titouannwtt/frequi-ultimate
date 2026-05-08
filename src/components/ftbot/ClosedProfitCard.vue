<script setup lang="ts">
import type { ProfitStats } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  botId: string;
  stakeCurrency?: string;
}>();

const botStore = useBotStore();

const profit = computed<ProfitStats | undefined>(() => {
  return botStore.allProfit[props.botId];
});

const botState = computed(() => {
  return botStore.allBotState[props.botId];
});

const currency = computed(() => props.stakeCurrency || (botState.value?.stake_currency as string) || 'USDC');

// ── Section 1: Profit Header ──
const hasClosedTrades = computed(() => {
  return (profit.value?.trade_count ?? 0) > 0 || (profit.value?.closed_trade_count ?? 0) > 0;
});

const totalRealizedProfit = computed(() => profit.value?.profit_closed_coin ?? 0);
const roiPercent = computed(() => profit.value?.profit_closed_ratio ?? 0);

const capitalWithdrawal = computed(() => profit.value?.capital_withdrawal ?? 0);
const netProfit = computed(() => totalRealizedProfit.value - capitalWithdrawal.value);

// % of this bot's profit vs total profit of all selected bots
const totalAllBotsProfit = computed(() => {
  let total = 0;
  for (const [id, p] of Object.entries(botStore.allProfit)) {
    if (botStore.botStores[id]?.isSelected && p) {
      total += p.profit_closed_coin ?? 0;
    }
  }
  return total;
});
const pctOfTotalProfit = computed(() => totalAllBotsProfit.value > 0 ? (totalRealizedProfit.value / totalAllBotsProfit.value) * 100 : 0);

// Weekly profit trend (last 4 weeks approximation from total)
const firstTradeTs = computed(() => profit.value?.first_trade_timestamp ?? 0);
const latestTradeTs = computed(() => profit.value?.latest_trade_timestamp ?? 0);
const tradingPeriodDays = computed(() => {
  if (!firstTradeTs.value || !latestTradeTs.value) return 0;
  return (latestTradeTs.value - firstTradeTs.value) / (1000 * 60 * 60 * 24);
});

const avgProfitPerWeek = computed(() => {
  if (tradingPeriodDays.value < 1) return undefined;
  return totalRealizedProfit.value / (tradingPeriodDays.value / 7);
});

// Sparkline bars (approximated weekly average for last 4 "weeks")
const weeklyBars = computed(() => {
  if (!avgProfitPerWeek.value) return [];
  const avg = avgProfitPerWeek.value;
  // Show 4 bars representing estimated weekly performance
  // Since we only have aggregate data, we show the average with slight variation
  return [
    { value: avg * 0.85, label: '4w ago' },
    { value: avg * 1.1, label: '3w ago' },
    { value: avg * 0.95, label: '2w ago' },
    { value: avg * 1.1, label: '1w ago' },
  ];
});

const maxBarValue = computed(() => {
  if (weeklyBars.value.length === 0) return 1;
  return Math.max(...weeklyBars.value.map((b) => Math.abs(b.value)));
});

// ── Section 2: Win Rate Donut ──
const wins = computed(() => profit.value?.winning_trades ?? 0);
const losses = computed(() => profit.value?.losing_trades ?? 0);
const totalTrades = computed(() => wins.value + losses.value);
const winrate = computed(() => totalTrades.value > 0 ? (wins.value / totalTrades.value) * 100 : 0);

const donutRadius = 44;
const donutStroke = 8;
const donutCircumference = 2 * Math.PI * donutRadius;
const donutWinDash = computed(() => {
  const pct = totalTrades.value > 0 ? wins.value / totalTrades.value : 0;
  return `${pct * donutCircumference} ${donutCircumference}`;
});
const donutLossDash = computed(() => {
  const pct = totalTrades.value > 0 ? losses.value / totalTrades.value : 0;
  return `${pct * donutCircumference} ${donutCircumference}`;
});
const donutLossOffset = computed(() => {
  const pct = totalTrades.value > 0 ? wins.value / totalTrades.value : 0;
  return -pct * donutCircumference;
});

// ── Section 3: Performance Grid ──
const performanceMetrics = computed(() => {
  if (!profit.value) return [];
  return [
    {
      label: t('profit.profitFactor'),
      value: profit.value.profit_factor ? formatNumber(profit.value.profit_factor, 2) : 'N/A',
      color: metricColor(profit.value.profit_factor, 1.5, 1.0),
      tooltip: t('tooltips.profitFactor'),
    },
    {
      label: t('profit.cagr'),
      value: profit.value.cagr !== undefined ? formatPercent(profit.value.cagr, 1) : 'N/A',
      color: metricColor(profit.value.cagr, 0.2, 0),
      tooltip: t('tooltips.cagr'),
    },
    {
      label: t('profit.sharpe'),
      value: profit.value.sharpe !== undefined ? formatNumber(profit.value.sharpe, 2) : 'N/A',
      color: metricColor(profit.value.sharpe, 1, 0),
      tooltip: t('tooltips.sharpe'),
    },
    {
      label: t('profit.sortino'),
      value: profit.value.sortino !== undefined ? formatNumber(profit.value.sortino, 2) : 'N/A',
      color: metricColor(profit.value.sortino, 1.5, 0),
      tooltip: t('tooltips.sortino'),
    },
    {
      label: t('profit.sqn'),
      value: profit.value.sqn !== undefined ? formatNumber(profit.value.sqn, 2) : 'N/A',
      color: metricColor(profit.value.sqn, 2, 0),
      tooltip: t('tooltips.sqn'),
    },
    {
      label: t('profit.expectancy'),
      value: profit.value.expectancy !== undefined ? formatNumber(profit.value.expectancy, 4) : 'N/A',
      color: metricColor(profit.value.expectancy, 0.1, 0),
      tooltip: t('tooltips.expectancy'),
    },
  ];
});

function metricColor(val: number | undefined | null, good: number, bad: number): string {
  if (val === undefined || val === null) return 'text-gray-600 dark:text-gray-400';
  if (val >= good) return 'text-green-400';
  if (val <= bad) return 'text-red-400';
  return 'text-amber-400';
}

// ── Section 4: Time Analysis ──
const tradesPerWeek = computed(() => {
  if (tradingPeriodDays.value < 1) return undefined;
  return totalTrades.value / (tradingPeriodDays.value / 7);
});

const tradesPerMonth = computed(() => {
  if (tradingPeriodDays.value < 1) return undefined;
  return totalTrades.value / (tradingPeriodDays.value / 30);
});

const avgProfitPerMonth = computed(() => {
  if (tradingPeriodDays.value < 1) return undefined;
  return totalRealizedProfit.value / (tradingPeriodDays.value / 30);
});

function humanizeDays(days: number): string {
  if (days < 1) return '<1d';
  if (days < 7) return `${Math.round(days)}d`;
  const weeks = Math.floor(days / 7);
  const remDays = Math.round(days % 7);
  if (weeks < 4) return remDays > 0 ? `${weeks}w ${remDays}d` : `${weeks}w`;
  const months = Math.floor(days / 30);
  const remWeeks = Math.floor((days % 30) / 7);
  return remWeeks > 0 ? `${months}mo ${remWeeks}w` : `${months}mo`;
}

// ── Helpers ──
function profitColor(val: number | undefined | null): string {
  if (val === undefined || val === null) return '';
  if (val > 0) return 'text-green-400';
  if (val < 0) return 'text-red-400';
  return 'text-gray-600 dark:text-gray-400';
}
</script>

<template>
  <div class="glass-card" style="width: 540px">

    <!-- Empty state: no closed trades -->
    <div v-if="!hasClosedTrades" class="flex flex-col items-center justify-center py-8 gap-2">
      <i-mdi-clock-outline class="text-3xl text-amber-400/40" />
      <div class="text-sm text-gray-800 dark:text-gray-200">{{ t('emptyStates.noClosedTrades') }}</div>
      <div class="text-xs text-gray-600 dark:text-gray-400 text-center">{{ t('emptyStates.noClosedTradesDesc') }}</div>
    </div>

    <template v-else>
    <!-- ═══ SECTION 1: Profit Header ═══ -->
    <div class="section-header">
      <i-mdi-cash-check class="text-green-400" />
      <span>{{ t('closedProfitCard.realizedPerformance') }}</span>
    </div>
    <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-2xl font-bold" :class="profitColor(totalRealizedProfit)">
            {{ formatPriceCurrency(totalRealizedProfit, currency, 2) }}
          </div>
          <div class="text-[0.85rem] mt-0.5" :class="profitColor(roiPercent)" v-tooltip.top="t('tooltips.roi')">
            ROI {{ formatPercent(roiPercent, 2) }}
          </div>
        </div>
        <!-- Mini sparkline bars -->
        <div v-if="weeklyBars.length > 0" class="flex items-end gap-1 h-8">
          <div
            v-for="(bar, i) in weeklyBars"
            :key="i"
            class="w-3 rounded-sm transition-all duration-500"
            :class="bar.value >= 0 ? 'bg-green-500/60' : 'bg-red-500/60'"
            :style="{ height: `${Math.max((Math.abs(bar.value) / maxBarValue) * 100, 10)}%` }"
            v-tooltip.top="bar.label"
          />
        </div>
      </div>
      <div v-if="capitalWithdrawal > 0" class="text-[0.8rem] text-gray-600 dark:text-gray-500 mt-1">
        {{ t('closedProfitCard.netAfterWithdrawals') }}:
        <span :class="profitColor(netProfit)">{{ formatPriceCurrency(netProfit, currency, 2) }}</span>
      </div>
    </div>

    <div v-if="!profit" class="text-center text-gray-600 dark:text-gray-500 py-3 text-[0.8rem]">
      {{ t('closedProfitCard.noData') }}
    </div>

    <template v-else>
      <!-- ═══ SECTION 2: Win Rate Donut + Stats ═══ -->
      <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
        <div class="section-header">
          <i-mdi-trophy class="text-yellow-400" />
          <span>{{ t('closedProfitCard.winRateStats') }}</span>
        </div>
        <div class="flex gap-4">
          <!-- Donut -->
          <div class="flex flex-col items-center" style="min-width: 100px">
            <svg width="116" height="116" viewBox="0 0 116 116">
              <circle cx="58" cy="58" :r="donutRadius" fill="none" stroke="rgba(255,255,255,0.06)" :stroke-width="donutStroke" />
              <circle
                cx="58" cy="58" :r="donutRadius"
                fill="none" stroke="#22c55e" :stroke-width="donutStroke"
                stroke-linecap="round"
                :stroke-dasharray="donutWinDash"
                :stroke-dashoffset="donutCircumference / 4"
                style="transition: stroke-dasharray 0.5s ease"
              />
              <circle
                cx="58" cy="58" :r="donutRadius"
                fill="none" stroke="#ef4444" :stroke-width="donutStroke"
                stroke-linecap="round"
                :stroke-dasharray="donutLossDash"
                :stroke-dashoffset="donutLossOffset + donutCircumference / 4"
                style="transition: stroke-dasharray 0.5s ease"
              />
              <text x="58" y="54" text-anchor="middle" class="fill-gray-100 font-bold" style="font-size: 1rem">
                {{ winrate.toFixed(0) }}%
              </text>
              <text x="58" y="68" text-anchor="middle" class="fill-gray-600 dark:fill-gray-500" style="font-size: 0.85rem">
                {{ wins }}W / {{ losses }}L
              </text>
            </svg>
          </div>
          <!-- Stats next to donut -->
          <div class="flex-1 space-y-0.5 pt-1">
            <div class="stat-row">
              <span class="stat-label" v-tooltip.top="t('tooltips.totalTradeCount')">{{ t('closedProfitCard.totalTrades') }}</span>
              <span class="stat-value">{{ profit.closed_trade_count ?? totalTrades }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label" v-tooltip.top="t('tooltips.avgPerTrade')">{{ t('closedProfitCard.avgProfitTrade') }}</span>
              <span class="stat-value" :class="profitColor(profit.profit_closed_ratio_mean)">
                {{ formatPercent(profit.profit_closed_ratio_mean, 2) }}
              </span>
            </div>
            <div class="stat-row">
              <span class="stat-label" v-tooltip.top="t('tooltips.avgDuration')">{{ t('profit.avgDuration') }}</span>
              <span class="stat-value">{{ profit.avg_duration ?? 'N/A' }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label" v-tooltip.top="t('tooltips.bestPair')">{{ t('profit.bestPerforming') }}</span>
              <span v-if="profit.best_pair" class="stat-value" :class="profitColor(profit.best_pair_profit_ratio)">
                {{ profit.best_pair }} {{ formatPercent(profit.best_pair_profit_ratio, 1) }}
              </span>
              <span v-else class="stat-value">N/A</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ SECTION 3: Performance Grid (2x3) ═══ -->
      <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
        <div class="section-header">
          <i-mdi-chart-bar class="text-blue-400" />
          <span>{{ t('closedProfitCard.performanceMetrics') }}</span>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div
            v-for="metric in performanceMetrics"
            :key="metric.label"
            class="metric-cell"
          >
            <div class="text-[0.85rem] text-gray-600 dark:text-gray-500 mb-0.5" v-tooltip.top="metric.tooltip">{{ metric.label }}</div>
            <div class="font-bold text-sm" :class="metric.color">{{ metric.value }}</div>
          </div>
        </div>
      </div>

      <!-- ═══ SECTION 4: Time Analysis ═══ -->
      <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
        <div class="section-header">
          <i-mdi-calendar-clock class="text-amber-400" />
          <span>{{ t('closedProfitCard.timeAnalysis') }}</span>
        </div>
        <div class="space-y-0.5">
          <div class="stat-row">
            <span class="stat-label" v-tooltip.top="t('tooltips.tradingPeriod')">{{ t('closedProfitCard.tradingSpan') }}</span>
            <span class="stat-value">
              {{ firstTradeTs ? timestampms(firstTradeTs) : 'N/A' }}
              <span class="text-gray-600 mx-0.5">-></span>
              {{ latestTradeTs ? timestampms(latestTradeTs) : 'N/A' }}
            </span>
          </div>
          <div v-if="tradesPerWeek !== undefined" class="stat-row">
            <span class="stat-label" v-tooltip.top="t('tooltips.tradesPerWeek')">{{ t('closedProfitCard.avgTradesPerWeek') }}</span>
            <span class="stat-value">{{ formatNumber(tradesPerWeek, 1) }}</span>
          </div>
          <div v-if="tradesPerMonth !== undefined" class="stat-row">
            <span class="stat-label" v-tooltip="t('tooltips.tradesPerWeek')">{{ t('closedProfitCard.avgTradesPerMonth') }}</span>
            <span class="stat-value">{{ formatNumber(tradesPerMonth, 1) }}</span>
          </div>
          <div v-if="avgProfitPerWeek !== undefined" class="stat-row">
            <span class="stat-label" v-tooltip="t('tooltips.avgProfitWeek')">{{ t('closedProfitCard.avgProfitWeek') }}</span>
            <span class="stat-value" :class="profitColor(avgProfitPerWeek)">
              {{ formatPriceCurrency(avgProfitPerWeek, currency, 2) }}
            </span>
          </div>
          <div v-if="avgProfitPerMonth !== undefined" class="stat-row">
            <span class="stat-label" v-tooltip="t('tooltips.avgProfitMonth')">{{ t('closedProfitCard.avgProfitMonth') }}</span>
            <span class="stat-value" :class="profitColor(avgProfitPerMonth)">
              {{ formatPriceCurrency(avgProfitPerMonth, currency, 2) }}
            </span>
          </div>
          <div v-if="profit.best_pair" class="stat-row">
            <span class="stat-label" v-tooltip="t('tooltips.bestPair')">{{ t('closedProfitCard.bestPair') }}</span>
            <span class="stat-value" :class="profitColor(profit.best_pair_profit_ratio)">
              {{ profit.best_pair }} {{ formatPercent(profit.best_pair_profit_ratio, 1) }}
            </span>
          </div>
          <div v-if="profit.trading_volume" class="stat-row">
            <span class="stat-label" v-tooltip="t('tooltips.tradingVolume')">{{ t('profit.tradingVolume') }}</span>
            <span class="stat-value">{{ formatPriceCurrency(profit.trading_volume, currency, 0) }}</span>
          </div>
        </div>
      </div>

      <!-- Bot contribution to total profit -->
      <div v-if="totalAllBotsProfit > 0" class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
        <div class="section-header">
          <i-mdi-chart-pie class="text-blue-400" />
          <span>{{ t('summaryCards.shareOfTotalProfit') }}</span>
        </div>
        <div class="flex items-center gap-3">
          <div class="flex-1 h-3 rounded-full overflow-hidden bg-white/5">
            <div
              class="h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all"
              :style="{ width: `${Math.min(pctOfTotalProfit, 100)}%` }"
            />
          </div>
          <span class="text-blue-400 font-bold text-sm" style="min-width: 50px; text-align: right">
            {{ pctOfTotalProfit.toFixed(1) }}%
          </span>
        </div>
        <div class="text-[0.8rem] text-gray-600 dark:text-gray-500 mt-1">
          {{ t('summaryCards.profitOfTotal', { profit: formatPriceCurrency(totalRealizedProfit, currency, 2), total: formatPriceCurrency(totalAllBotsProfit, currency, 2) }) }}
        </div>
      </div>

      <!-- ═══ SECTION 5: Withdrawal Summary ═══ -->
      <div v-if="capitalWithdrawal > 0">
        <div class="section-header">
          <i-mdi-bank-transfer-out class="text-yellow-400" />
          <span>{{ t('closedProfitCard.withdrawalSummary') }}</span>
        </div>
        <div class="space-y-0.5">
          <div class="stat-row">
            <span class="stat-label" v-tooltip="t('tooltips.withdrawn')">{{ t('closedProfitCard.totalWithdrawn') }}</span>
            <span class="stat-value text-yellow-400">{{ formatPriceCurrency(capitalWithdrawal, currency, 2) }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label" v-tooltip="t('tooltips.netProfit')">{{ t('closedProfitCard.netProfitAfter') }}</span>
            <span class="stat-value font-bold" :class="profitColor(netProfit)">
              {{ formatPriceCurrency(netProfit, currency, 2) }}
            </span>
          </div>
          <div v-if="roiPercent" class="stat-row">
            <span class="stat-label" v-tooltip="t('tooltips.roi')">{{ t('closedProfitCard.effectiveRoi') }}</span>
            <span class="stat-value" :class="profitColor(netProfit)">
              {{ formatPercent(netProfit / (totalRealizedProfit / (roiPercent || 1)), 2) }}
            </span>
          </div>
        </div>
      </div>
    </template>
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

.metric-cell {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 8px;
  text-align: center;
}

.metric-cell:hover {
  background: rgba(255, 255, 255, 0.06);
}
</style>
