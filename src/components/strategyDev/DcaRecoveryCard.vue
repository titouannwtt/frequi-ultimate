<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

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

interface DcaAnalysis {
  total_trades: number;
  max_entries: number;
  avg_entries: number;
  no_dca?: boolean;
  level_distribution: {
    level: number;
    label: string;
    count: number;
    pct_of_total: number;
    avg_profit: number;
    total_profit: number;
    winrate: number;
    avg_duration: number;
    avg_stake: number;
  }[];
  recovery_rate: number;
  single_entry_avg: number;
  multi_entry_avg: number;
  single_count: number;
  multi_count: number;
  profit_contribution_single: number;
  profit_contribution_multi: number;
  pair_dca_stats: { pair: string; avg_entries: number; avg_profit: number; trades: number }[];
  insights: string[];
}

const props = defineProps<{
  data: DcaAnalysis;
}>();

function recoveryColor(rate: number): string {
  if (rate > 0.6) return C.green;
  if (rate >= 0.4) return C.yellow;
  return C.red;
}

function profitColor(val: number): string {
  return val >= 0 ? C.green : C.red;
}

interface InsightBadge {
  key: string;
  label: string;
  color: string;
  bg: string;
}

const insightMap: Record<string, { labelKey: string; color: string }> = {
  dca_high_recovery: { labelKey: 'strategyDev.dcaHighRecovery', color: C.green },
  dca_low_recovery: { labelKey: 'strategyDev.dcaLowRecovery', color: C.red },
  dca_improves_profit: { labelKey: 'strategyDev.dcaImprovesProfit', color: C.green },
  dca_degrades_profit: { labelKey: 'strategyDev.dcaDegradesProfit', color: C.red },
  deep_dca_losing: { labelKey: 'strategyDev.dcaDeepLosing', color: C.red },
};

const badges = computed<InsightBadge[]>(() => {
  return props.data.insights
    .filter((key) => key in insightMap)
    .map((key) => {
      const info = insightMap[key];
      const hex = info.color;
      // Parse hex to rgba for background
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return {
        key,
        label: t(info.labelKey),
        color: hex,
        bg: `rgba(${r}, ${g}, ${b}, 0.12)`,
      };
    });
});
</script>

<template>
  <div v-if="!data.no_dca" class="sd-chart-card">
    <!-- KPI Grid 2x2 -->
    <div class="dca-kpi-grid">
      <div class="dca-kpi">
        <span class="dca-kpi-label">{{ t('strategyDev.dcaRecoveryRate') }}</span>
        <span class="dca-kpi-value" :style="{ color: recoveryColor(data.recovery_rate) }">
          {{ (data.recovery_rate * 100).toFixed(1) }}%
        </span>
      </div>
      <div class="dca-kpi">
        <span class="dca-kpi-label">{{ t('strategyDev.dcaTrades') }}</span>
        <span class="dca-kpi-value" :style="{ color: C.text }">
          {{ data.multi_count }} / {{ data.total_trades }}
        </span>
      </div>
      <div class="dca-kpi">
        <span class="dca-kpi-label">{{ t('strategyDev.dcaSingleEntryAvg') }}</span>
        <span class="dca-kpi-value" :style="{ color: profitColor(data.single_entry_avg) }">
          {{ data.single_entry_avg >= 0 ? '+' : '' }}{{ data.single_entry_avg.toFixed(2) }}%
        </span>
      </div>
      <div class="dca-kpi">
        <span class="dca-kpi-label">{{ t('strategyDev.dcaMultiEntryAvg') }}</span>
        <span class="dca-kpi-value" :style="{ color: profitColor(data.multi_entry_avg) }">
          {{ data.multi_entry_avg >= 0 ? '+' : '' }}{{ data.multi_entry_avg.toFixed(2) }}%
        </span>
      </div>
    </div>

    <!-- Insight badges -->
    <div v-if="badges.length" class="dca-insights">
      <span
        v-for="badge in badges"
        :key="badge.key"
        class="dca-insight-badge"
        :style="{ color: badge.color, backgroundColor: badge.bg, borderColor: badge.color }"
      >
        {{ badge.label }}
      </span>
    </div>
  </div>
</template>
