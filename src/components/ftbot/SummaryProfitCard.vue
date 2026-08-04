<script setup lang="ts">
import type { Trade } from '@/types/trades';
import type { ProfitStats } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  mode: 'open' | 'closed';
  botIds?: string[];
}>();

const botStore = useBotStore();

// ── Gather data from all selected bots ──
interface BotEntry {
  botId: string;
  name: string;
  profit: number;
  roi: number;
  stakeCurrency: string;
  stakeInOpenTrades: number;
  winrate: number;
  wins: number;
  losses: number;
  totalWithdrawals: number;
}

const botEntries = computed<BotEntry[]>(() => {
  const entries: BotEntry[] = [];
  const botsToUse =
    props.botIds && props.botIds.length > 0
      ? botStore.selectedBots.filter((b) => props.botIds!.includes(b.botId))
      : botStore.selectedBots;
  for (const bot of botsToUse) {
    const botId = bot.botId;
    const profitData = botStore.allProfit[botId];
    const openTrades: Trade[] = botStore.allOpenTrades[botId] ?? [];
    const state = botStore.allBotState[botId];
    const currency = (state?.stake_currency as string) || 'USDC';

    if (props.mode === 'open') {
      const profitOpen = openTrades.reduce(
        (sum, tr) => sum + (tr.total_profit_abs ?? tr.profit_abs ?? 0),
        0,
      );
      const stakeInOpen = openTrades.reduce((sum, tr) => sum + (tr.stake_amount ?? 0), 0);
      entries.push({
        botId,
        name: bot.uiBotName || botId,
        profit: profitOpen,
        roi: 0,
        stakeCurrency: currency,
        stakeInOpenTrades: stakeInOpen,
        winrate: 0,
        wins: 0,
        losses: 0,
        totalWithdrawals: 0,
      });
    } else {
      const profitClosed = profitData?.profit_closed_coin ?? 0;
      const roi = profitData?.profit_closed_ratio ?? 0;
      const wins = profitData?.winning_trades ?? 0;
      const losses = profitData?.losing_trades ?? 0;
      const total = wins + losses;
      entries.push({
        botId,
        name: bot.uiBotName || botId,
        profit: profitClosed,
        roi,
        stakeCurrency: currency,
        stakeInOpenTrades: 0,
        winrate: total > 0 ? (wins / total) * 100 : 0,
        wins,
        losses,
        totalWithdrawals: profitData?.capital_withdrawal ?? 0,
      });
    }
  }
  return entries;
});

// Sorted by profit descending
const sortedEntries = computed(() => {
  return [...botEntries.value].sort((a, b) => b.profit - a.profit);
});

const totalProfit = computed(() => botEntries.value.reduce((sum, e) => sum + e.profit, 0));

const totalStakeAtRisk = computed(() =>
  botEntries.value.reduce((sum, e) => sum + e.stakeInOpenTrades, 0),
);

const maxAbsProfit = computed(() => {
  if (sortedEntries.value.length === 0) return 1;
  return Math.max(...sortedEntries.value.map((e) => Math.abs(e.profit)), 0.01);
});

const currency = computed(() => {
  if (botEntries.value.length > 0) return botEntries.value[0].stakeCurrency;
  return 'USDC';
});

// ── Closed mode: performance stats ──
const bestBot = computed(() => {
  if (botEntries.value.length === 0) return null;
  return [...botEntries.value].sort((a, b) => b.roi - a.roi)[0];
});

const worstBot = computed(() => {
  if (botEntries.value.length === 0) return null;
  return [...botEntries.value].sort((a, b) => a.roi - b.roi)[0];
});

const avgRoi = computed(() => {
  if (botEntries.value.length === 0) return 0;
  return botEntries.value.reduce((sum, e) => sum + e.roi, 0) / botEntries.value.length;
});

const totalWithdrawals = computed(() =>
  botEntries.value.reduce((sum, e) => sum + e.totalWithdrawals, 0),
);

const maxWinrate = computed(() => {
  if (botEntries.value.length === 0) return 1;
  return Math.max(...botEntries.value.map((e) => e.winrate), 1);
});

// ── Capital at risk donut (open mode) ──
const donutRadius = 32;
const donutStroke = 6;
const donutCircumference = 2 * Math.PI * donutRadius;

function donutDash(value: number, total: number): string {
  const pct = total > 0 ? Math.min(value / total, 1) : 0;
  return `${pct * donutCircumference} ${donutCircumference}`;
}

// Gradient colors for bars
const barColors = [
  { from: '#3b82f6', to: '#60a5fa' },
  { from: '#8b5cf6', to: '#a78bfa' },
  { from: '#06b6d4', to: '#22d3ee' },
  { from: '#f59e0b', to: '#fbbf24' },
  { from: '#ec4899', to: '#f472b6' },
  { from: '#10b981', to: '#34d399' },
];

function barColor(index: number): { from: string; to: string } {
  return barColors[index % barColors.length];
}

function profitColor(val: number): string {
  if (val > 0) return 'text-green-400';
  if (val < 0) return 'text-red-400';
  return 'text-gray-600 dark:text-gray-400';
}

function barGradientClass(val: number): string {
  if (val > 0) return 'bar-positive';
  return 'bar-negative';
}

function barWidthPercent(val: number): number {
  return Math.max((Math.abs(val) / maxAbsProfit.value) * 100, 2);
}
</script>

<template>
  <div class="glass-card" style="width: 560px">
    <!-- ═══ HEADER ═══ -->
    <div
      class="flex items-center justify-between mb-3 pb-2 border-b border-black/5 dark:border-white/5"
    >
      <div class="flex items-center gap-2">
        <i-mdi-chart-box v-if="mode === 'open'" class="text-blue-400 text-base" />
        <i-mdi-chart-line v-else class="text-green-400 text-base" />
        <span class="font-semibold text-gray-100 text-sm">
          {{ mode === 'open' ? t('summaryCard.openTitle') : t('summaryCard.closedTitle') }}
        </span>
      </div>
      <span class="font-bold text-sm" :class="profitColor(totalProfit)">
        {{ formatPriceCurrency(totalProfit, currency, 2) }}
      </span>
    </div>

    <!-- ═══ BOT RANKING (horizontal bars) ═══ -->
    <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
      <div class="section-header">
        <i-mdi-sort-descending class="text-blue-400" />
        <span>{{ t('summaryCard.botRanking') }}</span>
      </div>
      <div class="space-y-1.5">
        <div v-for="(entry, idx) in sortedEntries" :key="entry.botId" class="bot-bar-row">
          <div class="flex items-center justify-between mb-0.5">
            <span
              class="text-gray-700 dark:text-gray-300 text-[0.85rem] font-medium truncate"
              style="max-width: 140px"
            >
              {{ entry.name }}
            </span>
            <div class="flex items-center gap-2">
              <span
                v-if="mode === 'closed' && totalProfit !== 0"
                class="text-gray-600 dark:text-gray-500 text-[0.85rem]"
              >
                {{ formatPercent(Math.abs(entry.profit) / Math.abs(totalProfit), 0) }}
                {{ t('summaryCard.ofTotal') }}
              </span>
              <span
                v-if="mode === 'closed'"
                class="text-gray-600 dark:text-gray-400 text-[0.85rem]"
              >
                ROI {{ formatPercent(entry.roi, 1) }}
              </span>
              <span class="font-bold text-[0.85rem]" :class="profitColor(entry.profit)">
                {{ formatPriceCurrency(entry.profit, entry.stakeCurrency, 2) }}
              </span>
            </div>
          </div>
          <div class="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="barGradientClass(entry.profit)"
              :style="{ width: `${barWidthPercent(entry.profit)}%` }"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ OPEN MODE: Capital at Risk ═══ -->
    <template v-if="mode === 'open'">
      <div>
        <div class="section-header">
          <i-mdi-shield-alert class="text-amber-400" />
          <span>{{ t('summaryCard.capitalAtRisk') }}</span>
          <span class="ml-auto text-gray-800 dark:text-gray-200 font-bold text-[0.8rem]">
            {{ formatPriceCurrency(totalStakeAtRisk, currency, 0) }}
          </span>
        </div>
        <div class="flex items-center gap-4">
          <!-- Donut chart -->
          <svg width="80" height="80" viewBox="0 0 80 80" class="flex-shrink-0">
            <circle
              cx="40"
              cy="40"
              :r="donutRadius"
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              :stroke-width="donutStroke"
            />
            <circle
              v-for="(entry, idx) in sortedEntries"
              :key="'donut-' + entry.botId"
              cx="40"
              cy="40"
              :r="donutRadius"
              fill="none"
              :stroke="barColor(idx).from"
              :stroke-width="donutStroke"
              stroke-linecap="round"
              :stroke-dasharray="donutDash(entry.stakeInOpenTrades, totalStakeAtRisk)"
              :stroke-dashoffset="
                -(
                  sortedEntries
                    .slice(0, idx)
                    .reduce(
                      (sum, e) =>
                        sum + (totalStakeAtRisk > 0 ? e.stakeInOpenTrades / totalStakeAtRisk : 0),
                      0,
                    ) * donutCircumference
                ) +
                donutCircumference / 4
              "
              style="transition: stroke-dasharray 0.6s ease"
            />
            <text
              x="40"
              y="38"
              text-anchor="middle"
              class="fill-gray-100 font-bold"
              style="font-size: 0.95rem"
            >
              {{ sortedEntries.length }}
            </text>
            <text
              x="40"
              y="48"
              text-anchor="middle"
              class="fill-gray-600 dark:fill-gray-500"
              style="font-size: 0.4rem"
            >
              {{ t('summaryCards.bots') }}
            </text>
          </svg>
          <!-- Legend -->
          <div class="flex-1 space-y-0.5">
            <div
              v-for="(entry, idx) in sortedEntries"
              :key="'legend-' + entry.botId"
              class="flex items-center gap-1.5 text-[0.8rem]"
            >
              <span
                class="w-2 h-2 rounded-full flex-shrink-0"
                :style="{ background: barColor(idx).from }"
              />
              <span class="text-gray-600 dark:text-gray-400 truncate" style="max-width: 100px">{{
                entry.name
              }}</span>
              <span class="ml-auto text-gray-800 dark:text-gray-200">
                {{ formatPriceCurrency(entry.stakeInOpenTrades, entry.stakeCurrency, 0) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ═══ CLOSED MODE: Performance Comparison ═══ -->
    <template v-if="mode === 'closed'">
      <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
        <div class="section-header">
          <i-mdi-podium class="text-green-400" />
          <span>{{ t('summaryCard.performanceComparison') }}</span>
        </div>
        <div class="space-y-0.5">
          <div v-if="bestBot" class="stat-row">
            <span class="stat-label" v-tooltip.top="t('tooltips.bestBot')">{{
              t('summaryCard.bestBot')
            }}</span>
            <span class="stat-value">
              <span class="text-green-400 font-bold">{{ bestBot.name }}</span>
              <span class="text-gray-600 dark:text-gray-500 ml-1">{{
                formatPercent(bestBot.roi, 1)
              }}</span>
            </span>
          </div>
          <div v-if="worstBot" class="stat-row">
            <span class="stat-label" v-tooltip.top="t('tooltips.worstBot')">{{
              t('summaryCard.worstBot')
            }}</span>
            <span class="stat-value">
              <span class="text-red-400 font-bold">{{ worstBot.name }}</span>
              <span class="text-gray-600 dark:text-gray-500 ml-1">{{
                formatPercent(worstBot.roi, 1)
              }}</span>
            </span>
          </div>
          <div class="stat-row">
            <span class="stat-label" v-tooltip.top="t('tooltips.avgRoiAllBots')">{{
              t('summaryCard.avgRoi')
            }}</span>
            <span class="stat-value" :class="profitColor(avgRoi)">
              {{ formatPercent(avgRoi, 2) }}
            </span>
          </div>
          <div v-if="totalWithdrawals > 0" class="stat-row">
            <span class="stat-label" v-tooltip.top="t('tooltips.totalWithdrawalsAllBots')">{{
              t('summaryCard.totalWithdrawals')
            }}</span>
            <span class="stat-value text-amber-400">
              {{ formatPriceCurrency(totalWithdrawals, currency, 2) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Win rate comparison -->
      <div>
        <div class="section-header">
          <i-mdi-trophy class="text-yellow-400" />
          <span>{{ t('summaryCard.winrateComparison') }}</span>
        </div>
        <div class="space-y-1.5">
          <div
            v-for="entry in sortedEntries"
            :key="'wr-' + entry.botId"
            class="flex items-center gap-2"
          >
            <span
              class="text-[0.8rem] text-gray-600 dark:text-gray-400 truncate"
              style="min-width: 70px; max-width: 100px"
            >
              {{ entry.name }}
            </span>
            <div class="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                class="h-full rounded-full bg-gradient-to-r from-green-600 to-green-400 transition-all duration-500"
                :style="{ width: `${entry.winrate}%` }"
              />
            </div>
            <span
              class="text-[0.8rem] text-gray-800 dark:text-gray-200 font-bold"
              style="min-width: 32px; text-align: right"
            >
              {{ entry.winrate.toFixed(0) }}%
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

.bot-bar-row {
  padding: 2px 0;
}

.bar-positive {
  background: linear-gradient(to right, #16a34a, #4ade80);
}

.bar-negative {
  background: linear-gradient(to right, #dc2626, #f87171);
}
</style>
