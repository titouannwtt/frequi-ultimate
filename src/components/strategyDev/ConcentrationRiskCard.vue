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

interface PairCorrelationData {
  pairs: string[];
  matrix: number[][];
  avg_correlation: number;
  highly_correlated: { pair_a: string; pair_b: string; correlation: number }[];
  hhi: number;
  hhi_label: string;
  top_pair_pct: number;
  top_pair: string;
  max_simultaneous_loss: {
    max_loss_abs: number;
    max_loss_date: string;
    max_loss_count: number;
    max_loss_pairs: string[];
  };
  pair_stats: { pair: string; trades: number; volume_pct: number }[];
}

const props = defineProps<{ data: PairCorrelationData }>();

const { t } = useI18n();

function hhiColor(label: string): string {
  if (label === 'diversified' || label === 'Diversified') return C.green;
  if (label === 'moderate' || label === 'Moderate') return C.yellow;
  return C.red;
}

function corrSeverityColor(avg: number): string {
  if (avg < 0.3) return C.green;
  if (avg < 0.5) return C.yellow;
  return C.red;
}

function topPairColor(pct: number): string {
  if (pct < 30) return C.green;
  if (pct < 50) return C.yellow;
  return C.red;
}

function highCorrCountColor(count: number): string {
  if (count === 0) return C.green;
  if (count <= 2) return C.yellow;
  return C.red;
}

interface KpiItem {
  key: string;
  label: string;
  value: string;
  color: string;
  badge?: string;
  badgeColor?: string;
}

const kpis = computed<KpiItem[]>(() => {
  const d = props.data;
  return [
    {
      key: 'hhi',
      label: t('strategyDev.concHhi'),
      value: d.hhi.toFixed(2),
      color: hhiColor(d.hhi_label),
      badge: d.hhi_label,
      badgeColor: hhiColor(d.hhi_label),
    },
    {
      key: 'top_pair',
      label: t('strategyDev.concTopPair'),
      value: `${d.top_pair_pct.toFixed(1)}%`,
      color: topPairColor(d.top_pair_pct),
      badge: d.top_pair.replace(/\/USDC:USDC$/, ''),
      badgeColor: C.subtext,
    },
    {
      key: 'avg_corr',
      label: t('strategyDev.concAvgCorr'),
      value: d.avg_correlation.toFixed(3),
      color: corrSeverityColor(d.avg_correlation),
    },
    {
      key: 'high_corr_count',
      label: t('strategyDev.concHighCorrCount'),
      value: String(d.highly_correlated.length),
      color: highCorrCountColor(d.highly_correlated.length),
    },
  ];
});

const topPairs = computed(() =>
  [...props.data.pair_stats]
    .sort((a, b) => b.volume_pct - a.volume_pct)
    .slice(0, 5),
);

const maxVolumePct = computed(() => {
  if (!topPairs.value.length) return 1;
  return Math.max(...topPairs.value.map((p) => p.volume_pct));
});
</script>

<template>
  <div class="sd-chart-card">
    <!-- KPI grid -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      <div v-for="kpi in kpis" :key="kpi.key" class="text-center">
        <div class="text-lg font-bold tabular-nums" :style="{ color: kpi.color }">
          {{ kpi.value }}
        </div>
        <div class="text-xs mt-0.5" :style="{ color: C.subtext }">{{ kpi.label }}</div>
        <span
          v-if="kpi.badge"
          class="inline-block text-xs font-medium px-1.5 py-0.5 rounded mt-1"
          :style="{
            color: kpi.badgeColor,
            backgroundColor: kpi.badgeColor + '18',
            border: '1px solid ' + kpi.badgeColor + '40',
          }"
        >
          {{ kpi.badge }}
        </span>
      </div>
    </div>

    <!-- Pair volume distribution bars -->
    <div v-if="topPairs.length">
      <div
        class="text-xs font-semibold uppercase tracking-wide mb-2"
        :style="{ color: C.subtext }"
      >
        {{ t('strategyDev.concVolumeDistribution') }}
      </div>
      <div class="space-y-1.5">
        <div v-for="pair in topPairs" :key="pair.pair" class="flex items-center gap-2">
          <span
            class="text-xs font-medium w-20 text-right truncate shrink-0"
            :style="{ color: C.text }"
          >
            {{ pair.pair.replace(/\/USDC:USDC$/, '') }}
          </span>
          <div class="flex-1 h-3 rounded-full overflow-hidden" :style="{ backgroundColor: C.overlay + '40' }">
            <div
              class="h-full rounded-full transition-all"
              :style="{
                width: Math.max((pair.volume_pct / maxVolumePct) * 100, 2) + '%',
                backgroundColor: topPairColor(pair.volume_pct),
              }"
            />
          </div>
          <span
            class="text-xs tabular-nums font-medium w-12 text-right shrink-0"
            :style="{ color: C.subtext }"
          >
            {{ pair.volume_pct.toFixed(1) }}%
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
