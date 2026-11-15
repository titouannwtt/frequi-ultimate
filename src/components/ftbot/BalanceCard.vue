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

const balance = computed(() => {
  return botStore.allBalance[props.botId];
});

const currency = computed(
  () => props.stakeCurrency || (botState.value?.stake_currency as string) || 'USDC',
);

const openTrades = computed(() => {
  return botStore.allOpenTrades[props.botId] ?? [];
});

// Current balance
const currentBalance = computed(() => balance.value?.total_bot ?? balance.value?.total ?? 0);

const hasBalanceData = computed(() => {
  return !!balance.value && currentBalance.value > 0;
});

// Starting capital estimate: current balance - total profit + withdrawals
const startingCapital = computed(() => {
  const totalProfit = profit.value?.profit_all_coin ?? 0;
  const withdrawal = profit.value?.capital_withdrawal ?? 0;
  return currentBalance.value - totalProfit + withdrawal;
});

// Growth percentage
const growthPct = computed(() => {
  if (startingCapital.value <= 0) return 0;
  return ((currentBalance.value - startingCapital.value) / startingCapital.value) * 100;
});

// Progress bar (starting cap -> current balance)
const growthBarPct = computed(() => {
  if (startingCapital.value <= 0) return 100;
  return Math.min((currentBalance.value / (startingCapital.value * 2)) * 100, 100);
});

// Capital allocation
const stakeInOpenTrades = computed(() => {
  return openTrades.value.reduce((sum, t) => sum + (t.stake_amount ?? 0), 0);
});

const freeCapital = computed(() => {
  return Math.max(currentBalance.value - stakeInOpenTrades.value, 0);
});

const allocatedPct = computed(() => {
  if (currentBalance.value <= 0) return 0;
  return Math.min((stakeInOpenTrades.value / currentBalance.value) * 100, 100);
});

// Withdrawals
const capitalWithdrawal = computed(() => profit.value?.capital_withdrawal ?? 0);

// ROI
const roiPercent = computed(() => profit.value?.profit_closed_ratio ?? 0);

function profitColor(val: number | undefined | null): string {
  if (val === undefined || val === null) return '';
  if (val > 0) return 'text-green-400';
  if (val < 0) return 'text-red-400';
  return 'text-gray-600 dark:text-gray-400';
}
</script>

<template>
  <div class="glass-card" style="width: 540px">
    <!-- Empty state: no balance data -->
    <div v-if="!hasBalanceData" class="flex flex-col items-center justify-center py-8 gap-2">
      <i-mdi-cloud-off class="text-3xl text-gray-600 dark:text-gray-500/40" />
      <div class="text-sm text-gray-800 dark:text-gray-200">
        {{ t('emptyStates.balanceUnavailable') }}
      </div>
      <div class="text-xs text-gray-600 dark:text-gray-400 text-center">
        {{ t('emptyStates.balanceUnavailableDesc') }}
      </div>
    </div>

    <template v-else>
      <!-- ═══ SECTION 1: Current Balance ═══ -->
      <div class="section-header">
        <i-mdi-wallet class="text-green-400" />
        <span>{{ t('balanceCard.title') }}</span>
      </div>
      <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
        <div class="text-2xl font-bold text-gray-100 mb-1">
          {{ formatPriceCurrency(currentBalance, currency, 2) }}
        </div>
        <div v-if="botState?.dry_run" class="text-[0.85rem] text-amber-400/70 mb-2">(dry run)</div>

        <!-- Starting capital → Current balance progress -->
        <div class="mb-2">
          <div class="flex justify-between text-[0.85rem] mb-1">
            <span
              class="text-gray-600 dark:text-gray-500"
              v-tooltip.top="t('tooltips.startingCapital')"
              >{{ t('balanceCard.startingCapital') }}:
              {{ formatPriceCurrency(startingCapital, currency, 0) }}</span
            >
            <span :class="profitColor(growthPct)" v-tooltip.top="t('tooltips.balanceGrowth')"
              >{{ growthPct >= 0 ? '+' : '' }}{{ formatNumber(growthPct, 1) }}%</span
            >
          </div>
          <div class="h-2.5 rounded-full bg-white/5 overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="
                growthPct >= 0
                  ? 'bg-gradient-to-r from-green-600 to-green-400'
                  : 'bg-gradient-to-r from-red-600 to-red-400'
              "
              :style="{ width: `${growthBarPct}%` }"
            />
          </div>
          <div class="flex justify-between mt-0.5 text-[0.85rem] text-gray-600">
            <span>{{ t('balanceCard.start') }}</span>
            <span>{{ t('balanceCard.current') }}</span>
            <span>2x</span>
          </div>
        </div>

        <!-- ROI -->
        <div v-if="roiPercent" class="stat-row">
          <span class="stat-label" v-tooltip.top="t('tooltips.roi')">ROI</span>
          <span class="stat-value" :class="profitColor(roiPercent)">{{
            formatPercent(roiPercent, 2)
          }}</span>
        </div>
      </div>

      <!-- ═══ SECTION 2: Capital Allocation ═══ -->
      <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
        <div class="section-header">
          <i-mdi-chart-donut class="text-blue-400" />
          <span>{{ t('balanceCard.capitalAllocation') }}</span>
        </div>
        <!-- Allocation bar -->
        <div class="h-3 rounded-full bg-white/5 overflow-hidden flex mb-2">
          <div
            v-if="stakeInOpenTrades > 0"
            class="h-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-500"
            :style="{ width: `${allocatedPct}%` }"
            v-tooltip.top="t('tooltips.capitalInTrades')"
          />
          <div
            class="h-full bg-gradient-to-r from-gray-600 to-gray-500 transition-all duration-500"
            :style="{ width: `${100 - allocatedPct}%` }"
            v-tooltip.top="t('tooltips.freeCapital')"
          />
        </div>
        <div class="flex gap-3 text-[0.85rem]">
          <div class="flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-blue-500" />
            <span class="text-gray-600 dark:text-gray-400">{{ t('balanceCard.inTrades') }}</span>
            <span class="text-gray-800 dark:text-gray-200">{{
              formatPriceCurrency(stakeInOpenTrades, currency, 2)
            }}</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="w-2 h-2 rounded-full bg-gray-200 dark:bg-gray-500" />
            <span class="text-gray-600 dark:text-gray-400">{{ t('balanceCard.free') }}</span>
            <span class="text-gray-800 dark:text-gray-200">{{
              formatPriceCurrency(freeCapital, currency, 2)
            }}</span>
          </div>
        </div>
        <div class="stat-row mt-1">
          <span class="stat-label" v-tooltip="t('tooltips.capacity')">{{
            t('balanceCard.openPositions')
          }}</span>
          <span class="stat-value">{{ openTrades.length }}</span>
        </div>
      </div>

      <!-- ═══ SECTION 3: Withdrawal Info ═══ -->
      <div v-if="capitalWithdrawal > 0">
        <div class="section-header">
          <i-mdi-bank-transfer-out class="text-yellow-400" />
          <span>{{ t('balanceCard.withdrawals') }}</span>
        </div>
        <div class="space-y-0.5">
          <div class="stat-row">
            <span class="stat-label" v-tooltip="t('tooltips.withdrawn')">{{
              t('balanceCard.totalWithdrawn')
            }}</span>
            <span class="stat-value text-yellow-400">{{
              formatPriceCurrency(capitalWithdrawal, currency, 2)
            }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label" v-tooltip="t('tooltips.startingCapital')">{{
              t('balanceCard.totalDeposited')
            }}</span>
            <span class="stat-value">{{
              formatPriceCurrency(startingCapital + capitalWithdrawal, currency, 2)
            }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label" v-tooltip="t('tooltips.currentBalance')">{{
              t('balanceCard.currentBalance')
            }}</span>
            <span class="stat-value font-bold text-gray-100">{{
              formatPriceCurrency(currentBalance, currency, 2)
            }}</span>
          </div>
        </div>
      </div>

      <!-- No withdrawal section: just show simple stats -->
      <div v-else>
        <div class="section-header">
          <i-mdi-information-outline class="text-gray-600 dark:text-gray-500" />
          <span>{{ t('balanceCard.summary') }}</span>
        </div>
        <div class="space-y-0.5">
          <div class="stat-row">
            <span class="stat-label" v-tooltip="t('tooltips.realizedProfit')">{{
              t('balanceCard.totalProfit')
            }}</span>
            <span class="stat-value" :class="profitColor(profit?.profit_all_coin)">
              {{ formatPriceCurrency(profit?.profit_all_coin ?? 0, currency, 2) }}
            </span>
          </div>
          <div class="stat-row">
            <span class="stat-label">{{ t('balanceCard.noWithdrawals') }}</span>
            <span class="stat-value text-gray-600 dark:text-gray-500">-</span>
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
