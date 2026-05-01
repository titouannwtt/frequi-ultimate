<script setup lang="ts">
import { computed } from 'vue';

interface BandData {
  min: number;
  median: number;
  max: number;
}

interface DispersionData {
  profit: BandData | null;
  drawdown: BandData | null;
  sharpe: BandData | null;
}

const props = defineProps<{ data: DispersionData }>();

const bands = computed(() => {
  const items: { label: string; band: BandData; unit: string; color: string }[] = [];
  if (props.data.profit)
    items.push({ label: 'Profit', band: props.data.profit, unit: '%', color: 'green' });
  if (props.data.drawdown)
    items.push({ label: 'Drawdown', band: props.data.drawdown, unit: '%', color: 'red' });
  if (props.data.sharpe)
    items.push({ label: 'Sharpe', band: props.data.sharpe, unit: '', color: 'blue' });
  return items;
});
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-4">
    <h4 class="text-sm font-semibold mb-3">Top-10 Dispersion</h4>
    <div class="space-y-4">
      <div v-for="b in bands" :key="b.label">
        <div class="flex justify-between text-xs text-surface-500 mb-1">
          <span>{{ b.label }}</span>
          <span
            >{{ b.band.min.toFixed(2) }}{{ b.unit }} &mdash; {{ b.band.max.toFixed(2)
            }}{{ b.unit }}</span
          >
        </div>
        <div class="relative h-6 bg-surface-700 rounded-full">
          <div
            class="absolute h-full rounded-full opacity-30"
            :class="`bg-${b.color}-500`"
            :style="{
              left: '10%',
              right: '10%',
            }"
          />
          <div
            class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white"
            :class="`bg-${b.color}-400`"
            :style="{ left: '50%', transform: 'translate(-50%, -50%)' }"
          />
        </div>
        <div class="flex justify-between text-xs mt-0.5">
          <span class="text-surface-500">Min: {{ b.band.min.toFixed(2) }}{{ b.unit }}</span>
          <span class="font-medium">Median: {{ b.band.median.toFixed(2) }}{{ b.unit }}</span>
          <span class="text-surface-500">Max: {{ b.band.max.toFixed(2) }}{{ b.unit }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
