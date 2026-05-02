<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

interface MarketRegimeData {
  regime_labels: string[];
  daily_performance: {
    regime: string;
    days: number;
    pct_time: number;
    total_profit: number;
    avg_daily_profit: number;
    winrate: number;
  }[];
  trade_performance: {
    regime: string;
    trades: number;
    avg_profit: number;
    total_profit: number;
    winrate: number;
  }[];
  transition_matrix: number[][];
  timeline: { date: string; regime: string; volatility: number; trend: number }[];
  insights: string[];
  window: number;
}

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
  teal: '#94e2d5',
} as const;

const REGIME_COLORS: Record<string, string> = {
  bull_quiet: '#a6e3a1',
  bull_volatile: '#f9e2af',
  bear_quiet: '#89b4fa',
  bear_volatile: '#f38ba8',
};

const REGIME_LABEL_KEYS: Record<string, string> = {
  bull_quiet: 'strategyDev.regimeBullQuiet',
  bull_volatile: 'strategyDev.regimeBullVolatile',
  bear_quiet: 'strategyDev.regimeBearQuiet',
  bear_volatile: 'strategyDev.regimeBearVolatile',
};

const { t } = useI18n();

function regimeLabel(regime: string): string {
  const key = REGIME_LABEL_KEYS[regime];
  return key ? t(key) : regime;
}

const props = defineProps<{ data: MarketRegimeData }>();

const regimeKeys = computed(() => props.data.regime_labels);

const matrixRows = computed(() => {
  return regimeKeys.value.map((fromRegime, rowIdx) => ({
    regime: fromRegime,
    label: regimeLabel(fromRegime),
    color: REGIME_COLORS[fromRegime] ?? C.subtext,
    cells: regimeKeys.value.map((toRegime, colIdx) => ({
      regime: toRegime,
      value: props.data.transition_matrix[rowIdx]?.[colIdx] ?? 0,
    })),
  }));
});

function cellBackground(value: number, colRegime: string): string {
  const baseColor = REGIME_COLORS[colRegime] ?? C.subtext;
  const alpha = Math.min(value / 100, 1);
  // Convert hex to rgba
  const r = parseInt(baseColor.slice(1, 3), 16);
  const g = parseInt(baseColor.slice(3, 5), 16);
  const b = parseInt(baseColor.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${(alpha * 0.6).toFixed(2)})`;
}

interface InsightConfig {
  key: string;
  label: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
}

const insightDefs: Record<string, { i18nKey: string; color: string }> = {
  regime_dependent: { i18nKey: 'strategyDev.regimeDependent', color: C.yellow },
  vulnerable_bear_volatile: { i18nKey: 'strategyDev.regimeVulnerableBear', color: C.red },
  all_weather: { i18nKey: 'strategyDev.regimeAllWeather', color: C.green },
};

const activeInsights = computed(() =>
  props.data.insights
    .filter((key) => key in insightDefs)
    .map((key) => {
      const def = insightDefs[key];
      return {
        key,
        label: t(def.i18nKey),
        bgColor: def.color + '20',
        textColor: def.color,
        borderColor: def.color + '40',
      } as InsightConfig;
    }),
);
</script>

<template>
  <div class="sd-chart-card">
    <h4 class="text-sm font-semibold mb-3" :style="{ color: C.text }">
      {{ t('strategyDev.regimeTransitions', 'Regime Transitions') }}
    </h4>

    <!-- Transition Matrix -->
    <div class="overflow-x-auto mb-4">
      <table class="w-full text-xs border-collapse" :style="{ color: C.text }">
        <thead>
          <tr>
            <th class="p-2 text-left" :style="{ color: C.subtext }">{{ t('strategyDev.regimeFromTo') }}</th>
            <th
              v-for="regime in regimeKeys"
              :key="regime"
              class="p-2 text-center whitespace-nowrap"
            >
              <span class="flex items-center justify-center gap-1">
                <span
                  class="inline-block w-2 h-2 rounded-full"
                  :style="{ backgroundColor: REGIME_COLORS[regime] ?? C.subtext }"
                />
                <span :style="{ color: C.subtext }">
                  {{ regimeLabel(regime) }}
                </span>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in matrixRows" :key="row.regime">
            <td class="p-2 whitespace-nowrap">
              <span class="flex items-center gap-1">
                <span
                  class="inline-block w-2 h-2 rounded-full"
                  :style="{ backgroundColor: row.color }"
                />
                <span :style="{ color: C.subtext }">{{ row.label }}</span>
              </span>
            </td>
            <td
              v-for="cell in row.cells"
              :key="cell.regime"
              class="p-2 text-center font-mono tabular-nums"
              :style="{
                backgroundColor: cellBackground(cell.value, cell.regime),
                borderRadius: '2px',
              }"
            >
              {{ cell.value.toFixed(1) }}%
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Insights -->
    <div v-if="activeInsights.length > 0" class="space-y-2">
      <h5 class="text-xs font-medium uppercase tracking-wide" :style="{ color: C.subtext }">
        {{ t('strategyDev.regimeInsights', 'Insights') }}
      </h5>
      <div class="flex flex-wrap gap-2">
        <span
          v-for="insight in activeInsights"
          :key="insight.key"
          class="text-xs px-2.5 py-1 rounded-full border"
          :style="{
            backgroundColor: insight.bgColor,
            color: insight.textColor,
            borderColor: insight.borderColor,
          }"
        >
          {{ insight.label }}
        </span>
      </div>
    </div>
  </div>
</template>
