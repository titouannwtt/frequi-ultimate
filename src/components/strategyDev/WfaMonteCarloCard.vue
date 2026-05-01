<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

interface WfaMCData {
  n_simulations: number;
  total_return_pct: number;
  max_dd_p5: number;
  max_dd_p50: number;
  max_dd_p95: number;
  return_dd_p5: number;
  return_dd_p50: number;
  return_dd_p95: number;
  max_consec_loss_p50: number;
  max_consec_loss_p95: number;
  carver_discount: number;
}

const props = defineProps<{ data: WfaMCData }>();

const { t } = useI18n();

const carverPct = computed(() => Math.round(props.data.carver_discount * 100));
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-4">
    <h4 class="text-sm font-semibold mb-3">{{ t('strategyDev.wfaMcTitle') }}</h4>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
      <div>
        <div
          class="text-xl font-bold tabular-nums"
          :class="data.total_return_pct >= 0 ? 'text-green-400' : 'text-red-400'"
        >
          {{ data.total_return_pct.toFixed(1) }}%
        </div>
        <div class="text-sm text-surface-500">Total Return</div>
      </div>
      <div>
        <div class="text-xl font-bold tabular-nums text-red-400">
          {{ data.max_dd_p50.toFixed(1) }}%
        </div>
        <div class="text-sm text-surface-500">Max DD (P50)</div>
      </div>
      <div>
        <div class="text-xl font-bold tabular-nums text-amber-400">
          {{ data.max_consec_loss_p95 }}
        </div>
        <div class="text-sm text-surface-500">Max Consec Loss (P95)</div>
      </div>
      <div>
        <div
          class="text-xl font-bold tabular-nums"
          :class="carverPct >= 50 ? 'text-green-400' : 'text-red-400'"
        >
          {{ carverPct }}%
        </div>
        <div class="text-sm text-surface-500">Carver Discount</div>
      </div>
    </div>
    <div class="mt-4 space-y-2">
      <h5 class="text-sm text-surface-400 uppercase">{{ t('strategyDev.wfaMcDdPercentiles') }}</h5>
      <div class="flex gap-4 text-sm">
        <div
          v-for="[label, val] in [
            ['P5', data.max_dd_p5],
            ['P50', data.max_dd_p50],
            ['P95', data.max_dd_p95],
          ]"
          :key="label"
          class="flex-1 text-center"
        >
          <div class="font-bold tabular-nums text-red-400">{{ (val as number).toFixed(1) }}%</div>
          <div class="text-sm text-surface-500">{{ label }}</div>
        </div>
      </div>
      <h5 class="text-sm text-surface-400 uppercase mt-2">{{ t('strategyDev.wfaMcReturnDdRatio') }}</h5>
      <div class="flex gap-4 text-sm">
        <div
          v-for="[label, val] in [
            ['P5', data.return_dd_p5],
            ['P50', data.return_dd_p50],
            ['P95', data.return_dd_p95],
          ]"
          :key="label"
          class="flex-1 text-center"
        >
          <div
            class="font-bold tabular-nums"
            :class="(val as number) >= 1 ? 'text-green-400' : 'text-amber-400'"
          >
            {{ (val as number).toFixed(2) }}
          </div>
          <div class="text-sm text-surface-500">{{ label }}</div>
        </div>
      </div>
    </div>
    <div class="text-sm text-surface-500 mt-3 text-right">
      {{ t('strategyDev.mcSimulations', { n: data.n_simulations }) }}
    </div>
  </div>
</template>
