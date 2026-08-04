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

const currency = computed(
  () =>
    props.stakeCurrency || (botStore.allBotState[props.botId]?.stake_currency as string) || 'USDC',
);

const hasTradeData = computed(() => {
  return (profit.value?.trade_count ?? 0) > 0;
});

const wins = computed(() => profit.value?.winning_trades ?? 0);
const losses = computed(() => profit.value?.losing_trades ?? 0);
const totalTrades = computed(() => wins.value + losses.value);
const winrate = computed(() =>
  totalTrades.value > 0 ? (wins.value / totalTrades.value) * 100 : 0,
);

// SVG donut
const donutRadius = 48;
const donutStroke = 10;
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

// Profit factor visual bar
const profitFactor = computed(() => profit.value?.profit_factor);
const profitFactorBarPct = computed(() => {
  if (!profitFactor.value) return 50;
  // Map 0-3+ to 0-100%
  return Math.min((profitFactor.value / 3) * 100, 100);
});

// Avg winning vs avg losing (estimated from profit factor + winrate)
const avgWinEstimate = computed(() => {
  if (!profitFactor.value || wins.value === 0 || losses.value === 0) return undefined;
  // profit_factor = (avg_win * wins) / (avg_loss * losses)
  // avg_win / avg_loss = profit_factor * losses / wins
  return (profitFactor.value * losses.value) / wins.value;
});

function profitColor(val: number | undefined | null): string {
  if (val === undefined || val === null) return '';
  if (val > 0) return 'text-green-400';
  if (val < 0) return 'text-red-400';
  return 'text-gray-600 dark:text-gray-400';
}
</script>

<template>
  <div class="glass-card" style="width: 540px">
    <!-- Empty state: no trades -->
    <div v-if="!hasTradeData" class="flex flex-col items-center justify-center py-8 gap-2">
      <i-mdi-chart-line class="text-3xl text-blue-400/40" />
      <div class="text-sm text-gray-800 dark:text-gray-200">
        {{ t('emptyStates.noWinLossData') }}
      </div>
      <div class="text-xs text-gray-600 dark:text-gray-400 text-center">
        {{ t('emptyStates.noWinLossDataDesc') }}
      </div>
    </div>

    <template v-else>
      <!-- ═══ SECTION 1: Large Winrate Donut ═══ -->
      <div class="section-header">
        <i-mdi-trophy class="text-yellow-400" />
        <span>{{ t('winLossCard.title') }}</span>
      </div>
      <div
        class="flex items-center justify-around mb-3 pb-3 border-b border-black/5 dark:border-white/5"
      >
        <div class="flex flex-col items-center">
          <svg width="130" height="130" viewBox="0 0 130 130">
            <circle
              cx="65"
              cy="65"
              :r="donutRadius"
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              :stroke-width="donutStroke"
            />
            <circle
              cx="65"
              cy="65"
              :r="donutRadius"
              fill="none"
              stroke="#22c55e"
              :stroke-width="donutStroke"
              stroke-linecap="round"
              :stroke-dasharray="donutWinDash"
              :stroke-dashoffset="donutCircumference / 4"
              style="transition: stroke-dasharray 0.5s ease"
            />
            <circle
              cx="65"
              cy="65"
              :r="donutRadius"
              fill="none"
              stroke="#ef4444"
              :stroke-width="donutStroke"
              stroke-linecap="round"
              :stroke-dasharray="donutLossDash"
              :stroke-dashoffset="donutLossOffset + donutCircumference / 4"
              style="transition: stroke-dasharray 0.5s ease"
            />
            <text
              x="65"
              y="60"
              text-anchor="middle"
              class="fill-gray-100 font-bold"
              style="font-size: 1.3rem"
            >
              {{ winrate.toFixed(0) }}%
            </text>
            <text
              x="65"
              y="76"
              text-anchor="middle"
              class="fill-gray-600 dark:fill-gray-500"
              style="font-size: 0.75rem"
            >
              {{ t('winLossCard.winrate') }}
            </text>
          </svg>
        </div>
        <div class="space-y-2">
          <div class="flex items-center gap-2">
            <span class="w-3 h-3 rounded-full bg-green-500" />
            <span class="text-green-400 font-bold text-lg">{{ wins }}</span>
            <span class="text-gray-600 dark:text-gray-500 text-[0.85rem]">{{
              t('winLossCard.wins')
            }}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="w-3 h-3 rounded-full bg-red-500" />
            <span class="text-red-400 font-bold text-lg">{{ losses }}</span>
            <span class="text-gray-600 dark:text-gray-500 text-[0.85rem]">{{
              t('winLossCard.losses')
            }}</span>
          </div>
          <div
            class="text-gray-600 dark:text-gray-500 text-[0.8rem] pt-1 border-t border-black/5 dark:border-white/5"
          >
            {{ totalTrades }} {{ t('winLossCard.totalTrades') }}
          </div>
        </div>
      </div>

      <!-- ═══ SECTION 2: Streak & Averages ═══ -->
      <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
        <div class="section-header">
          <i-mdi-chart-timeline-variant class="text-blue-400" />
          <span>{{ t('winLossCard.analysis') }}</span>
        </div>
        <div class="space-y-0.5">
          <div class="stat-row">
            <span class="stat-label" v-tooltip.top="t('tooltips.currentStreak')">{{
              t('winLossCard.currentStreak')
            }}</span>
            <span class="stat-value text-gray-600 dark:text-gray-500">N/A</span>
          </div>
          <div v-if="avgWinEstimate !== undefined" class="stat-row">
            <span class="stat-label" v-tooltip.top="t('tooltips.avgWinLossRatio')">{{
              t('winLossCard.avgWinLossRatio')
            }}</span>
            <span
              class="stat-value"
              :class="avgWinEstimate > 1 ? 'text-green-400' : 'text-red-400'"
            >
              {{ formatNumber(avgWinEstimate, 2) }}x
            </span>
          </div>
          <div v-if="profit?.profit_closed_ratio_mean !== undefined" class="stat-row">
            <span class="stat-label" v-tooltip.top="t('tooltips.avgProfitPerTrade')">{{
              t('winLossCard.avgProfitPerTrade')
            }}</span>
            <span class="stat-value" :class="profitColor(profit?.profit_closed_ratio_mean)">
              {{ formatPercent(profit?.profit_closed_ratio_mean ?? 0, 2) }}
            </span>
          </div>
        </div>
      </div>

      <!-- ═══ SECTION 3: Profit Factor ═══ -->
      <div>
        <div class="section-header">
          <i-mdi-scale-balance class="text-green-400" />
          <span v-tooltip.top="t('tooltips.profitFactor')">{{
            t('winLossCard.profitFactor')
          }}</span>
        </div>
        <div class="flex items-center gap-3">
          <div class="flex-1">
            <div class="h-3 rounded-full bg-white/5 overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-500"
                :class="
                  (profitFactor ?? 0) >= 1.5
                    ? 'bg-gradient-to-r from-green-600 to-green-400'
                    : (profitFactor ?? 0) >= 1
                      ? 'bg-gradient-to-r from-amber-600 to-amber-400'
                      : 'bg-gradient-to-r from-red-600 to-red-400'
                "
                :style="{ width: `${profitFactorBarPct}%` }"
              />
            </div>
            <div class="flex justify-between mt-0.5 text-[0.8rem] text-gray-600">
              <span>0</span>
              <span>1.0</span>
              <span>2.0</span>
              <span>3.0+</span>
            </div>
          </div>
          <div class="text-right" style="min-width: 50px">
            <div
              class="text-lg font-bold"
              :class="
                (profitFactor ?? 0) >= 1.5
                  ? 'text-green-400'
                  : (profitFactor ?? 0) >= 1
                    ? 'text-amber-400'
                    : 'text-red-400'
              "
            >
              {{ profitFactor ? formatNumber(profitFactor, 2) : 'N/A' }}
            </div>
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
</style>
