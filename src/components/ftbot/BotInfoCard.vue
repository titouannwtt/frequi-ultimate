<script setup lang="ts">
import type { ProfitStats } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const botStore = useBotStore();

const props = defineProps<{
  profit: ProfitStats | undefined;
  botState: Record<string, unknown> | undefined;
  port?: number;
  stakeCurrency?: string;
  isOnline?: boolean;
  lastSeenOnline?: number;
  botId?: string;
}>();

// Equity curve from closed trades
const closedTrades = computed(() => {
  if (!props.botId) return [];
  return botStore.botStores[props.botId]?.trades || [];
});

const equityCurve = computed(() => {
  const trades = [...closedTrades.value].sort(
    (a, b) => new Date(a.close_date).getTime() - new Date(b.close_date).getTime(),
  );
  let cumulative = 0;
  return trades.map((t) => {
    cumulative += t.profit_abs ?? 0;
    return cumulative;
  });
});

const equityPath = computed(() => {
  if (equityCurve.value.length < 2) return '';
  const values = equityCurve.value;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 328;
  const h = 36;
  const step = w / (values.length - 1);
  return values.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`).join(' ');
});

const equityPolygon = computed(() => {
  if (!equityPath.value) return '';
  const values = equityCurve.value;
  const w = 328;
  const h = 36;
  const step = w / (values.length - 1);
  const lastX = (values.length - 1) * step;
  return `0,${h} ${equityPath.value} ${lastX},${h}`;
});

const equityCurveColor = computed(() => {
  if (equityCurve.value.length < 2) return '#22c55e';
  return equityCurve.value[equityCurve.value.length - 1] >= 0 ? '#22c55e' : '#ef4444';
});

function humanizeLastSeen(ts: number): string {
  if (!ts) return '';
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t('time.lessThanMinute');
  if (diffMin < 60) return t('time.minutes', diffMin);
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return t('time.hours', diffHours);
  const diffDays = Math.floor(diffHours / 24);
  return t('time.days', diffDays);
}

const hasTradeData = computed(() => {
  return (props.profit?.trade_count ?? 0) > 0;
});

const winrate = computed(() => {
  if (!props.profit?.winrate) return 0;
  return props.profit.winrate * 100;
});

const wins = computed(() => props.profit?.winning_trades ?? 0);
const losses = computed(() => props.profit?.losing_trades ?? 0);
const totalTrades = computed(() => wins.value + losses.value);

// SVG donut for winrate
const donutRadius = 38;
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

// ROI bar width (capped at 100% visually)
const roiPercent = computed(() => props.profit?.profit_closed_ratio ?? 0);
const roiBarWidth = computed(() => Math.min(Math.abs(roiPercent.value) * 10, 100)); // scale: 10% ROI = full bar

// Drawdown bar
const maxDrawdown = computed(() => props.profit?.max_drawdown ?? 0);
const drawdownBarWidth = computed(() => Math.min(Math.abs(maxDrawdown.value) * 100, 100));

const currency = computed(() => props.stakeCurrency || (props.botState?.stake_currency as string) || 'USDC');

function metricColor(val: number | undefined): string {
  if (val === undefined || val === null) return '';
  if (val > 0) return 'text-green-400';
  if (val < 0) return 'text-red-400';
  return 'text-gray-600 dark:text-gray-400';
}
</script>

<template>
  <div class="glass-card text-xs" style="width: 560px">
    <!-- Offline state -->
    <div v-if="isOnline === false" class="flex flex-col items-center gap-3 py-4">
      <div class="w-16 h-16 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
        <i-mdi-power-plug-off class="text-3xl text-red-400" />
      </div>
      <div class="text-center">
        <div class="text-sm font-bold text-gray-800 dark:text-gray-200 mb-1">{{ t('botComparison.offline') }}</div>
        <div class="text-xs text-gray-600 dark:text-gray-400 mb-2">{{ t('botComparison.botOfflineDesc') }}</div>
        <div v-if="lastSeenOnline" class="text-xs text-gray-600 dark:text-gray-500">
          <i-mdi-clock-outline class="inline" style="font-size: 0.9rem" />
          {{ t('botComparison.lastSeenOnline', { duration: humanizeLastSeen(lastSeenOnline) }) }}
        </div>
      </div>
      <div v-if="botState" class="w-full pt-2 mt-1 border-t border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-500 space-y-0.5" style="font-size: 0.9rem">
        <div v-if="botState.strategy" class="flex justify-between">
          <span>{{ t('botInfoCard.strategy') }}</span>
          <span class="text-gray-700 dark:text-gray-300">{{ botState.strategy }}</span>
        </div>
        <div v-if="botState.exchange" class="flex justify-between">
          <span>{{ t('botInfoCard.exchange') }}</span>
          <span class="text-gray-700 dark:text-gray-300">{{ botState.exchange }}</span>
        </div>
        <div v-if="port" class="flex justify-between">
          <span>{{ t('botInfoCard.port') }}</span>
          <span class="text-gray-700 dark:text-gray-300">:{{ port }}</span>
        </div>
      </div>
    </div>

    <!-- Online state -->
    <template v-else>
    <!-- Header -->
    <div class="flex items-center justify-between mb-3 pb-2 border-b border-gray-600">
      <div>
        <div class="text-sm font-bold text-gray-100">
          {{ (botState?.bot_name as string) || 'Bot' }}
        </div>
        <div class="text-[0.85rem] text-gray-600 dark:text-gray-400">
          {{ (botState?.strategy as string) || '' }} • {{ (botState?.exchange as string) || '' }}
        </div>
      </div>
      <div class="text-right text-[0.85rem] text-gray-600 dark:text-gray-400">
        <div v-tooltip.top="t('tooltips.totalTradeCount')">{{ profit?.trade_count ?? 0 }} trades</div>
        <div v-if="profit?.avg_duration">⏱ {{ profit.avg_duration }}</div>
      </div>
    </div>

    <!-- Mini equity curve -->
    <div v-if="equityCurve.length > 2" class="mb-2">
      <svg :width="328" :height="36" class="w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient :id="`eqGrad-${botId}`" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" :stop-color="equityCurveColor" stop-opacity="0.3"/>
            <stop offset="100%" :stop-color="equityCurveColor" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <polygon :points="equityPolygon" :fill="`url(#eqGrad-${botId})`"/>
        <polyline :points="equityPath" fill="none" :stroke="equityCurveColor" stroke-width="1.5"/>
      </svg>
    </div>
    <div v-else-if="botId && closedTrades.length === 0 && hasTradeData" class="mb-2 text-center text-gray-600 dark:text-gray-500" style="font-size: 0.9rem">
      {{ t('botInfoCard.loadingEquity') }}
    </div>

    <!-- Empty state: no trades yet -->
    <div v-if="!hasTradeData" class="flex flex-col items-center justify-center py-6 gap-2">
      <i-mdi-chart-line class="text-2xl text-blue-400/40" />
      <div class="text-sm text-gray-800 dark:text-gray-200">{{ t('emptyStates.noTradesYet') }}</div>
      <div class="text-xs text-gray-600 dark:text-gray-400 text-center">{{ t('emptyStates.noTradesDesc') }}</div>
    </div>

    <template v-else>
    <!-- Main metrics: Winrate donut + ROI -->
    <div class="flex gap-4 mb-3">
      <!-- Winrate donut -->
      <div class="flex flex-col items-center" style="min-width: 90px">
        <svg width="96" height="96" viewBox="0 0 96 96">
          <circle
            cx="48" cy="48" :r="donutRadius"
            fill="none" stroke="#374151" :stroke-width="donutStroke"
          />
          <circle
            cx="48" cy="48" :r="donutRadius"
            fill="none" stroke="#22c55e" :stroke-width="donutStroke"
            stroke-linecap="round"
            :stroke-dasharray="donutWinDash"
            :stroke-dashoffset="donutCircumference / 4"
            style="transition: stroke-dasharray 0.5s ease"
          />
          <circle
            cx="48" cy="48" :r="donutRadius"
            fill="none" stroke="#ef4444" :stroke-width="donutStroke"
            stroke-linecap="round"
            :stroke-dasharray="donutLossDash"
            :stroke-dashoffset="donutLossOffset + donutCircumference / 4"
            style="transition: stroke-dasharray 0.5s ease"
          />
          <text x="48" y="44" text-anchor="middle" class="fill-gray-100 font-bold" style="font-size: 0.8rem">
            {{ winrate.toFixed(0) }}%
          </text>
          <text x="48" y="55" text-anchor="middle" class="fill-gray-600 dark:fill-gray-400" style="font-size: 0.6rem">
            {{ wins }}W/{{ losses }}L
          </text>
        </svg>
      </div>

      <!-- ROI + Profit -->
      <div class="flex-1">
        <div class="mb-1.5">
          <div class="flex justify-between items-baseline">
            <span class="text-gray-600 dark:text-gray-400" v-tooltip.top="t('tooltips.roi')">ROI</span>
            <span class="text-lg font-bold" :class="metricColor(roiPercent)">
              {{ formatPercent(roiPercent, 1) }}
            </span>
          </div>
          <div class="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden mt-0.5">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="roiPercent >= 0 ? 'bg-gradient-to-r from-green-600 to-green-400' : 'bg-gradient-to-r from-red-600 to-red-400'"
              :style="{ width: `${roiBarWidth}%` }"
            />
          </div>
        </div>
        <div class="space-y-0.5">
          <div class="flex justify-between">
            <span class="text-gray-600 dark:text-gray-400" v-tooltip.top="t('tooltips.profitFactor')">{{ t('profit.profitFactor') }}</span>
            <span>{{ profit?.profit_factor ? formatNumber(profit.profit_factor, 2) : 'N/A' }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600 dark:text-gray-400" v-tooltip.top="t('tooltips.roiAll')">{{ t('profit.roiClosed') }}</span>
            <span :class="metricColor(profit?.profit_closed_coin)">
              {{ formatPriceCurrency(profit?.profit_closed_coin ?? 0, currency, 2) }}
            </span>
          </div>
          <div v-if="(profit?.capital_withdrawal ?? 0) > 0" class="flex justify-between">
            <span class="text-gray-600 dark:text-gray-400" v-tooltip.top="t('tooltips.withdrawn')">{{ t('profit.withdrawn') }}</span>
            <span class="text-yellow-400">-{{ formatPriceCurrency(profit?.capital_withdrawal ?? 0, currency, 2) }}</span>
          </div>
          <div v-if="(profit?.capital_withdrawal ?? 0) > 0" class="flex justify-between font-bold">
            <span class="text-gray-600 dark:text-gray-400" v-tooltip.top="t('tooltips.netProfit')">{{ t('profit.netProfit') }}</span>
            <span :class="metricColor((profit?.profit_closed_coin ?? 0) - (profit?.capital_withdrawal ?? 0))">
              {{ formatPriceCurrency((profit?.profit_closed_coin ?? 0) - (profit?.capital_withdrawal ?? 0), currency, 2) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Performance metrics -->
    <div class="mb-2 pb-2 border-b border-gray-300 dark:border-gray-700">
      <div class="flex items-center gap-1 mb-1 text-gray-700 dark:text-gray-300 font-semibold">
        <i-mdi-chart-line class="text-blue-400" style="font-size: 0.9rem" />
        {{ t('botInfoCard.performance') }}
      </div>
      <div class="grid grid-cols-3 gap-x-3 gap-y-0.5">
        <div class="flex flex-col items-center">
          <span class="text-gray-600 dark:text-gray-500" style="font-size: 0.95rem" v-tooltip.top="t('tooltips.cagr')">{{ t('profit.cagr') }}</span>
          <span class="font-bold" :class="metricColor(profit?.cagr)">{{ profit?.cagr ? formatPercent(profit.cagr, 1) : 'N/A' }}</span>
        </div>
        <div class="flex flex-col items-center">
          <span class="text-gray-600 dark:text-gray-500" style="font-size: 0.95rem" v-tooltip.top="t('tooltips.sharpe')">{{ t('profit.sharpe') }}</span>
          <span class="font-bold" :class="metricColor(profit?.sharpe)">{{ formatNumber(profit?.sharpe, 2) }}</span>
        </div>
        <div class="flex flex-col items-center">
          <span class="text-gray-600 dark:text-gray-500" style="font-size: 0.95rem" v-tooltip.top="t('tooltips.sortino')">{{ t('profit.sortino') }}</span>
          <span class="font-bold" :class="metricColor(profit?.sortino)">{{ formatNumber(profit?.sortino, 2) }}</span>
        </div>
        <div class="flex flex-col items-center">
          <span class="text-gray-600 dark:text-gray-500" style="font-size: 0.95rem" v-tooltip.top="t('tooltips.sqn')">{{ t('profit.sqn') }}</span>
          <span class="font-bold" :class="metricColor(profit?.sqn)">{{ formatNumber(profit?.sqn, 2) }}</span>
        </div>
        <div class="flex flex-col items-center">
          <span class="text-gray-600 dark:text-gray-500" style="font-size: 0.95rem" v-tooltip.top="t('tooltips.expectancy')">{{ t('profit.expectancy') }}</span>
          <span class="font-bold">{{ formatNumber(profit?.expectancy, 2) }}</span>
        </div>
        <div class="flex flex-col items-center">
          <span class="text-gray-600 dark:text-gray-500" style="font-size: 0.95rem" v-tooltip.top="t('tooltips.calmar')">{{ t('profit.calmar') }}</span>
          <span class="font-bold" :class="metricColor(profit?.calmar)">{{ formatNumber(profit?.calmar, 2) }}</span>
        </div>
      </div>
    </div>

    <!-- Timing + Best pair -->
    <div class="mb-2 pb-2 border-b border-gray-300 dark:border-gray-700">
      <div class="flex items-center gap-1 mb-1 text-gray-700 dark:text-gray-300 font-semibold">
        <i-mdi-clock-outline class="text-amber-400" style="font-size: 0.9rem" />
        {{ t('botInfoCard.timing') }}
      </div>
      <div class="space-y-0.5">
        <div class="flex justify-between">
          <span class="text-gray-600 dark:text-gray-400" v-tooltip.top="t('tooltips.avgDuration')">{{ t('profit.avgDuration') }}</span>
          <span>{{ profit?.avg_duration ?? 'N/A' }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-600 dark:text-gray-400" v-tooltip.top="t('tooltips.bestPair')">{{ t('profit.bestPerforming') }}</span>
          <span v-if="profit?.best_pair" :class="metricColor(profit?.best_pair_profit_ratio)">
            {{ profit.best_pair }} {{ formatPercent(profit.best_pair_profit_ratio, 1) }}
          </span>
          <span v-else>N/A</span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-600 dark:text-gray-400" v-tooltip.top="t('tooltips.tradingVolume')">{{ t('profit.tradingVolume') }}</span>
          <span>{{ formatPriceCurrency(profit?.trading_volume ?? 0, currency, 0) }}</span>
        </div>
      </div>
    </div>

    <!-- Drawdown -->
    <div class="mb-2 pb-2 border-b border-gray-300 dark:border-gray-700">
      <div class="flex items-center gap-1 mb-1 text-gray-700 dark:text-gray-300 font-semibold">
        <i-mdi-trending-down class="text-red-400" style="font-size: 0.9rem" />
        {{ t('botInfoCard.drawdown') }}
      </div>
      <div class="flex items-center gap-2 mb-1">
        <div class="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div
            class="h-full rounded-full bg-gradient-to-r from-red-700 to-red-400"
            :style="{ width: `${drawdownBarWidth}%` }"
          />
        </div>
        <span class="text-red-400 font-bold" style="min-width: 40px; text-align: right">
          {{ profit?.max_drawdown ? formatPercent(profit.max_drawdown, 1) : '0%' }}
        </span>
      </div>
      <div class="space-y-0.5 text-gray-600 dark:text-gray-400">
        <div class="flex justify-between">
          <span v-tooltip="t('tooltips.maxDrawdown')">{{ t('profit.maxDrawdown') }}</span>
          <span>{{ profit?.max_drawdown_abs ? formatPriceCurrency(profit.max_drawdown_abs, currency, 2) : 'N/A' }}</span>
        </div>
        <div class="flex justify-between">
          <span v-tooltip="t('tooltips.currentDrawdown')">{{ t('profit.currentDrawdown') }}</span>
          <span>{{ profit?.current_drawdown_abs ? formatPriceCurrency(profit.current_drawdown_abs, currency, 2) : 'N/A' }}</span>
        </div>
      </div>
    </div>

    <!-- Config footer -->
    <div class="text-gray-600 dark:text-gray-500 space-y-0.5" style="font-size: 0.9rem">
      <div class="flex justify-between">
        <span>{{ t('botInfoCard.strategy') }}</span>
        <span class="text-gray-700 dark:text-gray-300">{{ (botState?.strategy as string) || 'N/A' }}</span>
      </div>
      <div class="flex justify-between">
        <span>{{ t('botInfoCard.exchange') }}</span>
        <span class="text-gray-700 dark:text-gray-300">{{ (botState?.exchange as string) || 'N/A' }}</span>
      </div>
      <div v-if="port" class="flex justify-between">
        <span>{{ t('botInfoCard.port') }}</span>
        <span class="text-gray-700 dark:text-gray-300">:{{ port }}</span>
      </div>
      <div v-if="profit?.bot_start_timestamp" class="flex justify-between">
        <span v-tooltip="t('tooltips.botStarted')">{{ t('botInfoCard.started') }}</span>
        <span class="text-gray-700 dark:text-gray-300">{{ timestampms(profit.bot_start_timestamp) }}</span>
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
</style>
