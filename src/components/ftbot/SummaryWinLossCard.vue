<script setup lang="ts">
import type { ProfitStats } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const botStore = useBotStore();

// ── Gather data from all selected bots ──
interface BotWinLossEntry {
  botId: string;
  name: string;
  wins: number;
  losses: number;
  totalTrades: number;
  winrate: number;
  profitFactor: number | undefined;
}

const botEntries = computed<BotWinLossEntry[]>(() => {
  const entries: BotWinLossEntry[] = [];
  for (const bot of botStore.selectedBots) {
    const botId = bot.botId;
    const profitData: ProfitStats | undefined = botStore.allProfit[botId];
    const wins = profitData?.winning_trades ?? 0;
    const losses = profitData?.losing_trades ?? 0;
    const total = wins + losses;
    entries.push({
      botId,
      name: bot.uiBotName || botId,
      wins,
      losses,
      totalTrades: total,
      winrate: total > 0 ? (wins / total) * 100 : 0,
      profitFactor: profitData?.profit_factor,
    });
  }
  return entries;
});

// Sorted by winrate descending
const sortedByWinrate = computed(() => {
  return [...botEntries.value].sort((a, b) => b.winrate - a.winrate);
});

const totalWins = computed(() => botEntries.value.reduce((sum, e) => sum + e.wins, 0));
const totalLosses = computed(() => botEntries.value.reduce((sum, e) => sum + e.losses, 0));
const totalTrades = computed(() => totalWins.value + totalLosses.value);
const overallWinrate = computed(() => totalTrades.value > 0 ? (totalWins.value / totalTrades.value) * 100 : 0);

const avgWinrate = computed(() => {
  const entries = botEntries.value.filter((e) => e.totalTrades > 0);
  if (entries.length === 0) return 0;
  return entries.reduce((sum, e) => sum + e.winrate, 0) / entries.length;
});

const avgProfitFactor = computed(() => {
  const entries = botEntries.value.filter((e) => e.profitFactor !== undefined && e.profitFactor !== null && e.totalTrades > 0);
  if (entries.length === 0) return undefined;
  const totalWeight = entries.reduce((sum, e) => sum + e.totalTrades, 0);
  if (totalWeight <= 0) return undefined;
  return entries.reduce((sum, e) => sum + (e.profitFactor ?? 0) * e.totalTrades, 0) / totalWeight;
});

const bestBot = computed(() => {
  const entries = botEntries.value.filter((e) => e.totalTrades > 0);
  if (entries.length === 0) return null;
  return [...entries].sort((a, b) => b.winrate - a.winrate)[0];
});

const worstBot = computed(() => {
  const entries = botEntries.value.filter((e) => e.totalTrades > 0);
  if (entries.length === 0) return null;
  return [...entries].sort((a, b) => a.winrate - b.winrate)[0];
});

// SVG donut
const donutRadius = 42;
const donutStroke = 10;
const donutCircumference = 2 * Math.PI * donutRadius;
const donutWinDash = computed(() => {
  const pct = totalTrades.value > 0 ? totalWins.value / totalTrades.value : 0;
  return `${pct * donutCircumference} ${donutCircumference}`;
});
const donutLossDash = computed(() => {
  const pct = totalTrades.value > 0 ? totalLosses.value / totalTrades.value : 0;
  return `${pct * donutCircumference} ${donutCircumference}`;
});
const donutLossOffset = computed(() => {
  const pct = totalTrades.value > 0 ? totalWins.value / totalTrades.value : 0;
  return -pct * donutCircumference;
});

function winrateColor(val: number): string {
  if (val >= 60) return 'text-green-400';
  if (val >= 45) return 'text-amber-400';
  return 'text-red-400';
}
</script>

<template>
  <div class="glass-card" style="width: 540px">
    <!-- ═══ HEADER ═══ -->
    <div class="flex items-center justify-between mb-3 pb-2 border-b border-black/5 dark:border-white/5">
      <div class="flex items-center gap-2">
        <i-mdi-trophy class="text-yellow-400 text-base" />
        <span class="font-semibold text-gray-100 text-sm">
          {{ t('summaryWinLoss.title') }}
        </span>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-green-400 font-bold">{{ totalWins }}W</span>
        <span class="text-gray-600">/</span>
        <span class="text-red-400 font-bold">{{ totalLosses }}L</span>
      </div>
    </div>

    <!-- ═══ SECTION 1: Overall Winrate Donut ═══ -->
    <div class="flex items-center justify-around mb-3 pb-3 border-b border-black/5 dark:border-white/5">
      <div class="flex flex-col items-center">
        <svg width="110" height="110" viewBox="0 0 110 110">
          <circle cx="55" cy="55" :r="donutRadius" fill="none" stroke="rgba(255,255,255,0.06)" :stroke-width="donutStroke" />
          <circle
            cx="55" cy="55" :r="donutRadius"
            fill="none" stroke="#22c55e" :stroke-width="donutStroke"
            stroke-linecap="round"
            :stroke-dasharray="donutWinDash"
            :stroke-dashoffset="donutCircumference / 4"
            style="transition: stroke-dasharray 0.5s ease"
          />
          <circle
            cx="55" cy="55" :r="donutRadius"
            fill="none" stroke="#ef4444" :stroke-width="donutStroke"
            stroke-linecap="round"
            :stroke-dasharray="donutLossDash"
            :stroke-dashoffset="donutLossOffset + donutCircumference / 4"
            style="transition: stroke-dasharray 0.5s ease"
          />
          <text x="55" y="50" text-anchor="middle" class="fill-gray-100 font-bold" style="font-size: 1.4rem">
            {{ overallWinrate.toFixed(1) }}%
          </text>
          <text x="55" y="66" text-anchor="middle" class="fill-gray-600 dark:fill-gray-500" style="font-size: 0.9rem">
            {{ t('summaryWinLoss.overallWinrate') }}
          </text>
        </svg>
      </div>
      <div class="space-y-2">
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-green-500" />
          <span class="text-green-400 font-bold text-lg">{{ totalWins }}</span>
          <span class="text-gray-600 dark:text-gray-500 text-[0.85rem]">wins</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-red-500" />
          <span class="text-red-400 font-bold text-lg">{{ totalLosses }}</span>
          <span class="text-gray-600 dark:text-gray-500 text-[0.85rem]">losses</span>
        </div>
        <div class="text-gray-600 dark:text-gray-500 text-[0.8rem] pt-1 border-t border-black/5 dark:border-white/5">
          {{ t('summaryWinLoss.outOfTrades', { count: totalTrades }) }}
        </div>
      </div>
    </div>

    <!-- ═══ SECTION 2: Per-bot Breakdown (horizontal bars sorted by winrate) ═══ -->
    <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
      <div class="section-header">
        <i-mdi-sort-descending class="text-blue-400" />
        <span>{{ t('summaryWinLoss.overallWinrate') }}</span>
      </div>
      <div class="space-y-1.5">
        <div
          v-for="entry in sortedByWinrate"
          :key="entry.botId"
          class="bot-bar-row"
        >
          <div class="flex items-center justify-between mb-0.5">
            <span class="text-gray-700 dark:text-gray-300 text-[0.85rem] font-medium truncate" style="max-width: 140px">
              {{ entry.name }}
            </span>
            <div class="flex items-center gap-2">
              <span class="text-gray-600 dark:text-gray-500 text-[0.85rem]">
                {{ entry.wins }}W / {{ entry.losses }}L
              </span>
              <span
                class="font-bold text-[0.85rem]"
                :class="winrateColor(entry.winrate)"
              >
                {{ entry.winrate.toFixed(1) }}%
              </span>
            </div>
          </div>
          <div
            v-if="entry.totalTrades > 0"
            class="h-1.5 rounded-full bg-white/5 overflow-hidden flex"
            :title="`${entry.winrate.toFixed(1)}% winrate`"
          >
            <div
              class="h-full rounded-l-full bg-gradient-to-r from-green-600 to-green-400 transition-all duration-500"
              :style="{ width: `${entry.winrate}%` }"
            />
            <div
              class="h-full rounded-r-full bg-gradient-to-r from-red-600 to-red-400 transition-all duration-500"
              :style="{ width: `${100 - entry.winrate}%` }"
            />
          </div>
          <div v-else class="h-1.5 rounded-full bg-white/5" />
        </div>
      </div>
    </div>

    <!-- ═══ SECTION 3: Best / Worst Performers ═══ -->
    <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
      <div class="section-header">
        <i-mdi-podium class="text-green-400" />
        <span>{{ t('summaryWinLoss.bestPerformer') }} / {{ t('summaryWinLoss.worstPerformer') }}</span>
      </div>
      <div class="space-y-0.5">
        <div v-if="bestBot" class="stat-row">
          <span class="stat-label">{{ t('summaryWinLoss.bestPerformer') }}</span>
          <span class="stat-value">
            <span class="text-green-400 font-bold">{{ bestBot.name }}</span>
            <span class="text-gray-600 dark:text-gray-500 ml-1">{{ bestBot.winrate.toFixed(1) }}%</span>
          </span>
        </div>
        <div v-if="worstBot" class="stat-row">
          <span class="stat-label">{{ t('summaryWinLoss.worstPerformer') }}</span>
          <span class="stat-value">
            <span :class="worstBot.winrate < 45 ? 'text-red-400' : 'text-amber-400'" class="font-bold">{{ worstBot.name }}</span>
            <span class="text-gray-600 dark:text-gray-500 ml-1">{{ worstBot.winrate.toFixed(1) }}%</span>
          </span>
        </div>
      </div>
    </div>

    <!-- ═══ SECTION 4: Aggregate Stats ═══ -->
    <div>
      <div class="section-header">
        <i-mdi-chart-timeline-variant class="text-blue-400" />
        <span>Stats</span>
      </div>
      <div class="space-y-0.5">
        <div class="stat-row">
          <span class="stat-label">{{ t('summaryWinLoss.totalTrades') }}</span>
          <span class="stat-value">{{ totalTrades }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">{{ t('summaryWinLoss.avgWinrate') }}</span>
          <span class="stat-value" :class="winrateColor(avgWinrate)">
            {{ avgWinrate.toFixed(1) }}%
          </span>
        </div>
        <div v-if="avgProfitFactor !== undefined" class="stat-row">
          <span class="stat-label">Avg Profit Factor</span>
          <span
            class="stat-value"
            :class="avgProfitFactor >= 1.5 ? 'text-green-400' : avgProfitFactor >= 1 ? 'text-amber-400' : 'text-red-400'"
          >
            {{ avgProfitFactor.toFixed(2) }}
          </span>
        </div>
      </div>
    </div>
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
</style>
