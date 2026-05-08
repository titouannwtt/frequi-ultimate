<script setup lang="ts">
import type { Trade } from '@/types/trades';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const botStore = useBotStore();

// ── Gather data from all selected bots ──
interface BotTradeEntry {
  botId: string;
  name: string;
  openCount: number;
  maxOpen: number;
  pairs: string[];
  stakeInOpen: number;
  stakeCurrency: string;
  wins: number;
  losses: number;
  winrate: number;
}

const botEntries = computed<BotTradeEntry[]>(() => {
  const entries: BotTradeEntry[] = [];
  for (const bot of botStore.selectedBots) {
    const botId = bot.botId;
    const openTrades: Trade[] = botStore.allOpenTrades[botId] ?? [];
    const state = botStore.allBotState[botId];
    const profit = botStore.allProfit[botId];
    const currency = (state?.stake_currency as string) || 'USDC';
    const maxOpen = ((state?.max_open_trades as number) ?? 0) > 0 ? (state?.max_open_trades as number) : 0;
    const stakeInOpen = openTrades.reduce((sum, tr) => sum + (tr.stake_amount ?? 0), 0);
    const pairs = [...new Set(openTrades.map((tr) => tr.pair))];
    const wins = profit?.winning_trades ?? 0;
    const losses = profit?.losing_trades ?? 0;
    const total = wins + losses;

    entries.push({
      botId,
      name: bot.uiBotName || botId,
      openCount: openTrades.length,
      maxOpen,
      pairs,
      stakeInOpen,
      stakeCurrency: currency,
      wins,
      losses,
      winrate: total > 0 ? (wins / total) * 100 : 0,
    });
  }
  return entries;
});

const totalOpenCount = computed(() => botEntries.value.reduce((s, e) => s + e.openCount, 0));
const totalMaxOpen = computed(() => botEntries.value.reduce((s, e) => s + e.maxOpen, 0));
const totalStakeAtRisk = computed(() => botEntries.value.reduce((s, e) => s + e.stakeInOpen, 0));

const capacityPercent = computed(() => {
  if (totalMaxOpen.value <= 0) return 0;
  return Math.min((totalOpenCount.value / totalMaxOpen.value) * 100, 100);
});

// Per-currency stake at risk
const perCurrencyStake = computed(() => {
  const map: Record<string, number> = {};
  for (const e of botEntries.value) {
    map[e.stakeCurrency] = (map[e.stakeCurrency] ?? 0) + e.stakeInOpen;
  }
  return map;
});

const isMultiCurrency = computed(() => Object.keys(perCurrencyStake.value).length > 1);

const maxWinrate = computed(() => {
  if (botEntries.value.length === 0) return 1;
  return Math.max(...botEntries.value.map((e) => e.winrate), 1);
});

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
</script>

<template>
  <div class="glass-card" style="width: 540px">
    <!-- ═══ HEADER ═══ -->
    <div class="flex items-center justify-between mb-3 pb-2 border-b border-black/5 dark:border-white/5">
      <div class="flex items-center gap-2">
        <i-mdi-chart-box class="text-blue-400 text-base" />
        <span class="font-semibold text-gray-100 text-sm">
          {{ t('summaryTrades.title') }}
        </span>
      </div>
      <span class="font-bold text-sm text-blue-400">
        {{ totalOpenCount }} {{ t('summaryTrades.positions') }}
      </span>
    </div>

    <!-- ═══ CAPACITY BAR ═══ -->
    <div v-if="totalMaxOpen > 0" class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
      <div class="section-header">
        <i-mdi-gauge class="text-blue-400" />
        <span>{{ t('summaryTrades.capacity') }}</span>
        <span class="ml-auto text-gray-800 dark:text-gray-200 font-bold text-[0.8rem]">
          {{ totalOpenCount }} / {{ totalMaxOpen }}
        </span>
      </div>
      <div class="h-2 rounded-full bg-white/5 overflow-hidden">
        <div
          class="h-full rounded-full transition-all duration-500"
          :class="capacityPercent > 90 ? 'bg-red-500' : capacityPercent > 70 ? 'bg-amber-500' : 'bg-blue-500'"
          :style="{ width: `${capacityPercent}%` }"
        />
      </div>
    </div>

    <!-- ═══ PER-BOT POSITIONS ═══ -->
    <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
      <div class="section-header">
        <i-mdi-robot class="text-blue-400" />
        <span>{{ t('summaryTrades.perBot') }}</span>
      </div>
      <div class="space-y-1.5">
        <div
          v-for="(entry, idx) in botEntries"
          :key="entry.botId"
          class="flex items-center gap-2"
        >
          <span
            class="w-2 h-2 rounded-full flex-shrink-0"
            :style="{ background: barColor(idx).from }"
          />
          <span class="text-gray-700 dark:text-gray-300 text-[0.85rem] truncate" style="max-width: 120px">
            {{ entry.name }}
          </span>
          <span class="ml-auto text-gray-800 dark:text-gray-200 text-[0.85rem] font-bold">
            {{ entry.openCount }}{{ entry.maxOpen > 0 ? ` / ${entry.maxOpen}` : '' }}
          </span>
          <span v-if="entry.pairs.length > 0" class="text-gray-600 dark:text-gray-500 text-[0.85rem] truncate" style="max-width: 140px">
            {{ entry.pairs.join(', ') }}
          </span>
        </div>
      </div>
    </div>

    <!-- ═══ CAPITAL EXPOSURE ═══ -->
    <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
      <div class="section-header">
        <i-mdi-shield-alert class="text-amber-400" />
        <span>{{ t('summaryTrades.capitalExposure') }}</span>
        <span v-if="!isMultiCurrency" class="ml-auto text-gray-800 dark:text-gray-200 font-bold text-[0.8rem]">
          {{ formatPriceCurrency(totalStakeAtRisk, botEntries[0]?.stakeCurrency ?? 'USDC', 2) }}
        </span>
      </div>
      <template v-if="isMultiCurrency">
        <div class="section-header text-[0.8rem] opacity-60">
          <span>({{ t('summaryTrades.multiCurrency') }})</span>
        </div>
        <div v-for="(amt, cur) in perCurrencyStake" :key="cur" class="stat-row">
          <span class="stat-label">{{ cur }}</span>
          <span class="stat-value text-amber-400">{{ formatPriceCurrency(amt, cur as string, 2) }}</span>
        </div>
      </template>
      <div class="space-y-0.5 mt-1">
        <div
          v-for="(entry, idx) in botEntries"
          :key="'cap-' + entry.botId"
          class="stat-row"
        >
          <div class="flex items-center gap-1.5">
            <span
              class="w-2 h-2 rounded-full flex-shrink-0"
              :style="{ background: barColor(idx).from }"
            />
            <span class="stat-label">{{ entry.name }}</span>
          </div>
          <span class="stat-value">
            {{ formatPriceCurrency(entry.stakeInOpen, entry.stakeCurrency, 2) }}
          </span>
        </div>
      </div>
    </div>

    <!-- ═══ WIN RATE COMPARISON ═══ -->
    <div>
      <div class="section-header">
        <i-mdi-trophy class="text-yellow-400" />
        <span>{{ t('summaryTrades.winrateComparison') }}</span>
      </div>
      <div class="space-y-1.5">
        <div
          v-for="entry in botEntries"
          :key="'wr-' + entry.botId"
          class="flex items-center gap-2"
        >
          <span class="text-[0.8rem] text-gray-600 dark:text-gray-400 truncate" style="min-width: 70px; max-width: 100px">
            {{ entry.name }}
          </span>
          <div class="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              class="h-full rounded-full bg-gradient-to-r from-green-600 to-green-400 transition-all duration-500"
              :style="{ width: `${entry.winrate}%` }"
            />
          </div>
          <span class="text-[0.8rem] text-gray-800 dark:text-gray-200 font-bold" style="min-width: 32px; text-align: right">
            {{ entry.winrate.toFixed(0) }}%
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
</style>
