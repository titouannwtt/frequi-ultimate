<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

interface StuckTrade {
  pair: string;
  duration_min: number;
  duration_h: number;
  profit: number;
  stake_amount: number;
  is_short: boolean;
  exit_reason: string;
  orders: number;
}

interface StuckData {
  threshold_minutes: number;
  threshold_hours: number;
  median_duration_min: number;
  stuck_count: number;
  stuck_pct: number;
  stuck_avg_profit: number;
  stuck_total_profit: number;
  capital_blocked_pct: number;
  opportunity_cost: number;
  funding_cost_estimate: number;
  worst_stuck: StuckTrade[];
}

const props = defineProps<{ data: StuckData }>();
const { t } = useI18n();

const severity = computed(() => {
  if (props.data.stuck_pct > 20) return 'danger';
  if (props.data.stuck_pct > 10) return 'warn';
  return 'ok';
});

const severityColor = computed(() => {
  if (severity.value === 'danger') return '#f38ba8';
  if (severity.value === 'warn') return '#f9e2af';
  return '#a6e3a1';
});

function fmtDur(min: number): string {
  if (min < 60) return `${min.toFixed(0)}m`;
  if (min < 1440) return `${(min / 60).toFixed(1)}h`;
  return `${(min / 1440).toFixed(1)}d`;
}
</script>

<template>
  <div
    class="sd-chart-card"
    :style="severity !== 'ok' ? { borderColor: severityColor + '40' } : {}"
  >
    <!-- KPI row -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      <div class="text-center">
        <div class="text-lg font-bold tabular-nums" :style="{ color: severityColor }">
          {{ data.stuck_count }}
        </div>
        <div class="text-xs text-surface-400">{{ t('strategyDev.stuckCount') }}</div>
      </div>
      <div class="text-center">
        <div class="text-lg font-bold tabular-nums" :style="{ color: severityColor }">
          {{ data.stuck_pct.toFixed(1) }}%
        </div>
        <div class="text-xs text-surface-400">{{ t('strategyDev.stuckPctTrades') }}</div>
      </div>
      <div class="text-center">
        <div
          class="text-lg font-bold tabular-nums"
          :class="data.stuck_avg_profit >= 0 ? 'text-green-400' : 'text-red-400'"
        >
          {{ (data.stuck_avg_profit * 100).toFixed(2) }}%
        </div>
        <div class="text-xs text-surface-400">{{ t('strategyDev.stuckAvgProfit') }}</div>
      </div>
      <div class="text-center">
        <div class="text-lg font-bold tabular-nums text-amber-400">
          {{ data.capital_blocked_pct.toFixed(1) }}%
        </div>
        <div class="text-xs text-surface-400">{{ t('strategyDev.stuckCapitalBlocked') }}</div>
      </div>
    </div>

    <!-- Details row -->
    <div class="flex flex-wrap gap-4 text-xs text-surface-400 mb-3">
      <span>{{ t('strategyDev.stuckThreshold') }}: {{ fmtDur(data.threshold_minutes) }}</span>
      <span>{{ t('strategyDev.stuckMedian') }}: {{ fmtDur(data.median_duration_min) }}</span>
      <span v-if="data.opportunity_cost > 0">
        {{ t('strategyDev.stuckOppCost') }}: {{ data.opportunity_cost.toFixed(2) }}
      </span>
      <span v-if="data.funding_cost_estimate > 0" class="text-amber-400">
        {{ t('strategyDev.stuckFundingCost') }}: {{ data.funding_cost_estimate.toFixed(2) }}
      </span>
    </div>

    <!-- Worst stuck trades table -->
    <div v-if="data.worst_stuck.length" class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead>
          <tr class="text-surface-400 border-b border-surface-700">
            <th class="text-left py-1 px-1">{{ t('strategyDev.stuckPair') }}</th>
            <th class="text-right py-1 px-1">{{ t('strategyDev.stuckDuration') }}</th>
            <th class="text-right py-1 px-1">{{ t('strategyDev.stuckProfit') }}</th>
            <th class="text-right py-1 px-1">{{ t('strategyDev.stuckStake') }}</th>
            <th class="text-left py-1 px-1">{{ t('strategyDev.stuckExit') }}</th>
            <th class="text-right py-1 px-1">{{ t('strategyDev.stuckOrders') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(st, i) in data.worst_stuck"
            :key="i"
            class="border-b border-surface-800 hover:bg-surface-800/50"
          >
            <td class="py-1 px-1 text-surface-300">
              {{ st.pair }}
              <span v-if="st.is_short" class="text-red-400 text-[10px]">S</span>
            </td>
            <td class="py-1 px-1 text-right tabular-nums text-surface-300">{{ fmtDur(st.duration_min) }}</td>
            <td
              class="py-1 px-1 text-right tabular-nums"
              :class="st.profit >= 0 ? 'text-green-400' : 'text-red-400'"
            >
              {{ (st.profit * 100).toFixed(2) }}%
            </td>
            <td class="py-1 px-1 text-right tabular-nums text-surface-300">{{ st.stake_amount.toFixed(0) }}</td>
            <td class="py-1 px-1 text-surface-400">{{ st.exit_reason }}</td>
            <td class="py-1 px-1 text-right tabular-nums text-surface-400">{{ st.orders || '–' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
