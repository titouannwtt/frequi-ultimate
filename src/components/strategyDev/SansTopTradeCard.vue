<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

interface SansTopData {
  total_profit: number;
  without_top1: number;
  without_top1_pct: number;
  without_top2: number;
  without_top2_pct: number;
  fragile: boolean;
}

defineProps<{ data: SansTopData }>();
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-4">
    <div class="flex items-center justify-between mb-3">
      <h4 class="text-sm font-semibold">{{ t('strategyDev.sttTitle') }}</h4>
      <span
        class="text-sm px-2 py-0.5 rounded-full"
        :class="
          data.fragile
            ? 'bg-red-900/30 text-red-400 border border-red-700/40'
            : 'bg-green-900/30 text-green-400 border border-green-700/40'
        "
      >
        {{ data.fragile ? t('strategyDev.sttFragile') : t('strategyDev.sttDiversified') }}
      </span>
    </div>
    <div class="space-y-3">
      <div
        v-for="(item, label) in {
          [t('strategyDev.sttAllTrades')]: { val: data.total_profit, pct: 100 },
          [t('strategyDev.sttWithoutTop1')]: { val: data.without_top1, pct: data.without_top1_pct },
          [t('strategyDev.sttWithoutTop2')]: { val: data.without_top2, pct: data.without_top2_pct },
        }"
        :key="label"
      >
        <div class="flex justify-between text-sm mb-1">
          <span class="text-surface-500">{{ label }}</span>
          <span
            :class="item.val >= 0 ? 'text-green-400' : 'text-red-400'"
            class="tabular-nums"
          >
            {{ item.val.toFixed(2) }} ({{ item.pct.toFixed(0) }}%)
          </span>
        </div>
        <div class="h-1.5 bg-surface-700 rounded-full overflow-hidden">
          <div
            class="h-full rounded-full"
            :class="item.val >= 0 ? 'bg-green-500' : 'bg-red-500'"
            :style="{ width: Math.max(Math.abs(item.pct), 2) + '%' }"
          />
        </div>
      </div>
    </div>
  </div>
</template>
