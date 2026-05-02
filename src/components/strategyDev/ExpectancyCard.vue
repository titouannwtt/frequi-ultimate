<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  data: {
    expectancy: number;
    win_rate: number;
    avg_win: number;
    avg_loss: number;
    payoff_ratio: number;
    kelly_pct: number;
    half_kelly_pct: number;
    sqn: number;
    ci_95_low: number;
    ci_95_high: number;
    total_trades: number;
  };
}>();

interface MetricItem {
  key: string;
  label: string;
  value: string;
  color: string;
  badge?: string;
  badgeColor?: string;
}

function sqnLabel(sqn: number): { text: string; color: string } {
  if (sqn > 5) return { text: 'Superb', color: 'var(--sd-success)' };
  if (sqn >= 3) return { text: 'Excellent', color: 'var(--sd-success)' };
  if (sqn >= 2.5) return { text: 'Good', color: 'var(--sd-info)' };
  if (sqn >= 2) return { text: 'Average', color: 'var(--sd-text)' };
  if (sqn >= 1.6) return { text: 'Below avg', color: 'var(--sd-warning)' };
  return { text: 'Poor', color: 'var(--sd-danger)' };
}

function kellyColor(pct: number): string {
  if (pct >= 5) return 'var(--sd-success)';
  if (pct >= 1) return 'var(--sd-warning)';
  return 'var(--sd-danger)';
}

const items = computed<MetricItem[]>(() => {
  const d = props.data;
  const sqnInfo = sqnLabel(d.sqn);
  return [
    {
      key: 'expectancy',
      label: 'Expectancy',
      value: `${d.expectancy >= 0 ? '+' : ''}${d.expectancy.toFixed(4)}`,
      color: d.expectancy >= 0 ? 'var(--sd-success)' : 'var(--sd-danger)',
    },
    {
      key: 'win_rate',
      label: 'Win Rate',
      value: `${(d.win_rate * 100).toFixed(1)}%`,
      color: 'var(--sd-text)',
    },
    {
      key: 'avg_win',
      label: 'Avg Win',
      value: `+${d.avg_win.toFixed(2)}%`,
      color: 'var(--sd-success)',
    },
    {
      key: 'avg_loss',
      label: 'Avg Loss',
      value: `${d.avg_loss.toFixed(2)}%`,
      color: 'var(--sd-danger)',
    },
    {
      key: 'payoff_ratio',
      label: 'Payoff Ratio',
      value: d.payoff_ratio.toFixed(2),
      color: 'var(--sd-text)',
    },
    {
      key: 'kelly_pct',
      label: 'Kelly %',
      value: `${d.kelly_pct.toFixed(1)}%`,
      color: kellyColor(d.kelly_pct),
    },
    {
      key: 'half_kelly_pct',
      label: 'Half Kelly %',
      value: `${d.half_kelly_pct.toFixed(1)}%`,
      color: kellyColor(d.half_kelly_pct),
    },
    {
      key: 'sqn',
      label: 'SQN',
      value: d.sqn.toFixed(2),
      color: sqnInfo.color,
      badge: sqnInfo.text,
      badgeColor: sqnInfo.color,
    },
    {
      key: 'ci_95',
      label: 'CI 95%',
      value: `[${d.ci_95_low.toFixed(4)}, ${d.ci_95_high.toFixed(4)}]`,
      color: 'var(--sd-text)',
    },
    {
      key: 'total_trades',
      label: 'Total Trades',
      value: `${d.total_trades}`,
      color: 'var(--sd-text)',
    },
  ];
});
</script>

<template>
  <div class="ex-grid">
    <div
      v-for="item in items"
      :key="item.key"
      class="ex-card"
    >
      <div class="ex-card-header">
        <span class="ex-label">{{ item.label }}</span>
        <span
          v-if="item.badge"
          class="ex-badge"
          :style="{ color: item.badgeColor, borderColor: item.badgeColor }"
        >
          {{ item.badge }}
        </span>
      </div>
      <span
        class="ex-value"
        :style="{ color: item.color }"
      >
        {{ item.value }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.ex-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  background: var(--sd-surface0, #313244);
  border: 1px solid var(--sd-border-subtle, rgba(69, 71, 90, 0.3));
  border-radius: var(--sd-radius-md, 0.5rem);
  padding: 12px;
}

.ex-card {
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: var(--sd-base);
  border: 1px solid var(--sd-border-subtle);
  border-radius: var(--sd-radius-md);
  gap: 4px;
}

.ex-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ex-label {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--sd-overlay);
}

.ex-badge {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 6px;
  border: 1px solid;
  border-radius: 8px;
  line-height: 1.4;
}

.ex-value {
  font-size: var(--sd-text-lg);
  font-weight: 700;
  font-family: var(--sd-font-mono);
}
</style>
