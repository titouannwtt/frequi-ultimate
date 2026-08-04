<script setup lang="ts">
import type { Trade, ClosedTrade } from '@/types';
import { useI18n } from 'vue-i18n';
import { exitReasonColor } from '@/composables/tradeColumns';

const { t } = useI18n();

const props = defineProps<{
  trade: Trade | ClosedTrade | null;
  trades: (Trade | ClosedTrade)[];
}>();

const exitReasonStats = computed(() => {
  const reasons: Record<string, number> = {};
  const tags: Record<string, number> = {};
  for (const tr of props.trades) {
    const reason = (tr as any).exit_reason ?? (tr as any).sell_reason ?? '';
    if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
    const tag = tr.enter_tag ?? '';
    if (tag) tags[tag] = (tags[tag] ?? 0) + 1;
  }
  const total = props.trades.length || 1;
  return {
    reasons: Object.entries(reasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8),
    tags: Object.entries(tags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8),
    total,
  };
});
</script>

<template>
  <div class="p-4 min-w-[300px] max-w-[400px]">
    <div class="font-bold text-xs mb-2">{{ t('exitReasonStats.title') }}</div>

    <!-- This trade -->
    <div v-if="trade" class="text-[13px] mb-2 border-b border-surface-700 pb-2">
      <div class="flex justify-between">
        <span class="text-surface-400">{{ t('exitReasonStats.exitReason') }}</span>
        <span
          class="font-mono font-bold px-1.5 py-0.5 rounded text-[12px]"
          :style="{
            color: exitReasonColor((trade as any).exit_reason ?? ''),
            background: exitReasonColor((trade as any).exit_reason ?? '') + '20',
          }"
          >{{ (trade as any).exit_reason ?? '—' }}</span
        >
      </div>
      <div v-if="trade.enter_tag" class="flex justify-between mt-0.5">
        <span class="text-surface-400">{{ t('exitReasonStats.entryTag') }}</span>
        <span class="font-mono text-blue-400">{{ trade.enter_tag }}</span>
      </div>
    </div>

    <!-- Exit reason distribution -->
    <div class="text-[13px] mb-2">
      <div class="text-surface-400 text-[12px] mb-1">
        {{ t('exitReasonStats.reasonDistribution') }}
      </div>
      <div
        v-for="[reason, count] in exitReasonStats.reasons"
        :key="reason"
        class="flex items-center justify-between py-0.5"
      >
        <span
          class="font-mono px-1 py-0.5 rounded text-[12px]"
          :style="{ color: exitReasonColor(reason), background: exitReasonColor(reason) + '15' }"
          >{{ reason }}</span
        >
        <span class="font-mono text-surface-300"
          >{{ count }}
          <span class="text-surface-500"
            >({{ ((count / exitReasonStats.total) * 100).toFixed(0) }}%)</span
          ></span
        >
      </div>
    </div>

    <!-- Entry tag distribution -->
    <div
      v-if="exitReasonStats.tags.length > 0"
      class="text-[13px] border-t border-surface-700 pt-2"
    >
      <div class="text-surface-400 text-[12px] mb-1">
        {{ t('exitReasonStats.tagDistribution') }}
      </div>
      <div
        v-for="[tag, count] in exitReasonStats.tags"
        :key="tag"
        class="flex items-center justify-between py-0.5"
      >
        <span class="font-mono text-blue-400 text-[12px]">{{ tag }}</span>
        <span class="font-mono text-surface-300"
          >{{ count }}
          <span class="text-surface-500"
            >({{ ((count / exitReasonStats.total) * 100).toFixed(0) }}%)</span
          ></span
        >
      </div>
    </div>
  </div>
</template>
