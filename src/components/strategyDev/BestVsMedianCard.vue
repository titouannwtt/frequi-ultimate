<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

interface BvMData {
  best_profit: number;
  median_profit: number;
  gap_ratio: number;
  outlier: boolean;
}

const props = defineProps<{ data: BvMData }>();

const gapColor = computed(() => {
  const r = props.data.gap_ratio;
  if (r <= 1.5) return { color: '#a6e3a1', bg: 'rgba(166, 227, 161, 0.12)', label: t('strategyDev.bvmConsistent') };
  if (r <= 2.0) return { color: '#f9e2af', bg: 'rgba(249, 226, 175, 0.12)', label: t('strategyDev.bvmModerateGap') };
  return { color: '#f38ba8', bg: 'rgba(243, 139, 168, 0.12)', label: t('strategyDev.bvmOutlier') };
});
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-4 border border-surface-200 dark:border-surface-700">
    <h4 class="text-sm font-semibold mb-3 flex items-center gap-2">
      {{ t('strategyDev.bvmTitle') }}
      <InfoTip :text="t('strategyDev.hintBvm')" />
    </h4>

    <div class="flex gap-6 mb-3">
      <div class="flex flex-col">
        <span class="text-sm text-surface-500 uppercase tracking-wide">{{ t('strategyDev.bvmBestEpoch') }}</span>
        <span class="text-lg font-semibold mt-0.5"
          :class="data.best_profit >= 0 ? 'text-green-400' : 'text-red-400'"
        >{{ data.best_profit.toFixed(2) }}%</span>
      </div>
      <div class="flex flex-col">
        <span class="text-sm text-surface-500 uppercase tracking-wide">{{ t('strategyDev.bvmMedianTop10') }}</span>
        <span class="text-lg font-semibold mt-0.5"
          :class="data.median_profit >= 0 ? 'text-green-400' : 'text-red-400'"
        >{{ data.median_profit.toFixed(2) }}%</span>
      </div>
      <div class="flex flex-col">
        <span class="text-sm text-surface-500 uppercase tracking-wide">{{ t('strategyDev.bvmGapRatio') }}</span>
        <span class="text-lg font-semibold mt-0.5" :style="{ color: gapColor.color }">
          {{ data.gap_ratio.toFixed(1) }}x
        </span>
      </div>
    </div>

    <!-- Advisory -->
    <div
      class="px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2"
      :style="{ backgroundColor: gapColor.bg, color: gapColor.color, border: `1px solid ${gapColor.color}33` }"
    >
      <span class="inline-block w-2 h-2 rounded-full flex-shrink-0" :style="{ backgroundColor: gapColor.color }" />
      {{ gapColor.label }}
    </div>
  </div>
</template>
