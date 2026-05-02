<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const C = {
  surface0: '#1e1e2e',
  surface1: '#313244',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  overlay: '#45475a',
  blue: '#89b4fa',
  lavender: '#b4befe',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  peach: '#fab387',
  mauve: '#cba6f7',
} as const;

interface MaxLossData {
  max_loss_abs: number;
  max_loss_date: string;
  max_loss_count: number;
  max_loss_pairs: string[];
}

const props = defineProps<{ data: MaxLossData }>();

const { t } = useI18n();

const fmtDate = computed(() => {
  if (!props.data.max_loss_date) return '—';
  return props.data.max_loss_date.slice(0, 10);
});

const fmtLoss = computed(() => {
  const loss = props.data.max_loss_abs;
  if (Math.abs(loss) >= 1000) return `${loss >= 0 ? '' : '-'}${(Math.abs(loss) / 1000).toFixed(1)}K`;
  return loss.toFixed(2);
});

const severityColor = computed(() => {
  const count = props.data.max_loss_count;
  if (count <= 2) return C.yellow;
  if (count <= 4) return C.peach;
  return C.red;
});

const shortPairs = computed(() =>
  props.data.max_loss_pairs.map((p) => p.replace(/\/USDC:USDC$/, '').replace(/\/USDT:USDT$/, '')),
);
</script>

<template>
  <div class="sd-chart-card">
    <!-- Main loss display -->
    <div class="grid grid-cols-3 gap-3 mb-4">
      <div class="text-center">
        <div class="text-2xl font-bold tabular-nums" :style="{ color: C.red }">
          {{ fmtLoss }}
        </div>
        <div class="text-xs mt-0.5" :style="{ color: C.subtext }">
          {{ t('strategyDev.mslMaxLoss') }}
        </div>
      </div>
      <div class="text-center">
        <div class="text-2xl font-bold tabular-nums" :style="{ color: severityColor }">
          {{ data.max_loss_count }}
        </div>
        <div class="text-xs mt-0.5" :style="{ color: C.subtext }">
          {{ t('strategyDev.mslPositions') }}
        </div>
      </div>
      <div class="text-center">
        <div class="text-lg font-bold tabular-nums" :style="{ color: C.subtext }">
          {{ fmtDate }}
        </div>
        <div class="text-xs mt-0.5" :style="{ color: C.subtext }">
          {{ t('strategyDev.mslDate') }}
        </div>
      </div>
    </div>

    <!-- Pairs involved -->
    <div v-if="shortPairs.length">
      <div
        class="text-xs font-semibold uppercase tracking-wide mb-2"
        :style="{ color: C.subtext }"
      >
        {{ t('strategyDev.mslPairsInvolved') }}
      </div>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="(pair, i) in shortPairs"
          :key="i"
          class="inline-block text-xs font-medium px-2 py-0.5 rounded-full"
          :style="{
            color: C.red,
            backgroundColor: C.red + '18',
            border: '1px solid ' + C.red + '40',
          }"
        >
          {{ pair }}
        </span>
      </div>
    </div>
  </div>
</template>
