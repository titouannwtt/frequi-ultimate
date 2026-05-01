<script setup lang="ts">
import { computed } from 'vue';

interface RegimeStats {
  trades: number;
  profit_pct: number;
  win_rate: number;
  sharpe: number;
}

interface WfaRegimeData {
  regime_stats: Record<string, RegimeStats>;
  worst_regime: string;
  regime_dependent: boolean;
}

const props = defineProps<{ data: WfaRegimeData }>();

const regimeColors: Record<string, string> = {
  bull: 'text-green-400',
  bear: 'text-red-400',
  sideways: 'text-amber-400',
  volatile: 'text-purple-400',
};

const regimes = computed(() =>
  Object.entries(props.data.regime_stats)
    .map(([regime, stats]) => ({ regime, ...stats }))
    .sort((a, b) => b.profit_pct - a.profit_pct),
);
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-4">
    <div class="flex items-center justify-between mb-3">
      <h4 class="text-sm font-semibold">Regime Analysis</h4>
      <span
        class="text-xs px-2 py-0.5 rounded-full"
        :class="
          data.regime_dependent
            ? 'bg-amber-900/30 text-amber-400 border border-amber-700/40'
            : 'bg-green-900/30 text-green-400 border border-green-700/40'
        "
      >
        {{ data.regime_dependent ? 'Regime-Dependent' : 'Regime-Robust' }}
      </span>
    </div>
    <div class="space-y-2">
      <div
        v-for="r in regimes"
        :key="r.regime"
        class="flex items-center gap-3 p-2 rounded bg-surface-700/20"
        :class="r.regime === data.worst_regime ? 'border border-red-800/40' : ''"
      >
        <span
          class="text-sm font-semibold w-20 capitalize"
          :class="regimeColors[r.regime] || 'text-surface-300'"
        >
          {{ r.regime }}
        </span>
        <div class="flex-1 grid grid-cols-4 gap-2 text-xs text-center">
          <div>
            <span
              class="font-bold tabular-nums"
              :class="r.profit_pct >= 0 ? 'text-green-400' : 'text-red-400'"
            >
              {{ r.profit_pct.toFixed(1) }}%
            </span>
            <div class="text-surface-500">Profit</div>
          </div>
          <div>
            <span class="tabular-nums">{{ r.trades }}</span>
            <div class="text-surface-500">Trades</div>
          </div>
          <div>
            <span class="tabular-nums">{{ (r.win_rate * 100).toFixed(0) }}%</span>
            <div class="text-surface-500">Win Rate</div>
          </div>
          <div>
            <span class="tabular-nums">{{ r.sharpe.toFixed(2) }}</span>
            <div class="text-surface-500">Sharpe</div>
          </div>
        </div>
      </div>
    </div>
    <div v-if="data.worst_regime" class="text-xs text-red-400/70 mt-2">
      Worst regime: {{ data.worst_regime }}
    </div>
  </div>
</template>
