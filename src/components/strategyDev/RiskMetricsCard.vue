<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  metrics: {
    var_95: number;
    cvar_95: number;
    omega: number;
    tail_ratio: number;
    ulcer_index: number;
    recovery_factor: number;
    gain_pain_ratio: number;
    kelly_criterion: number;
  };
}>();

interface RiskItem {
  key: string;
  label: string;
  value: string;
  description: string;
  verdict: 'good' | 'ok' | 'warn' | 'bad' | 'neutral';
}

const items = computed<RiskItem[]>(() => {
  const m = props.metrics;
  return [
    {
      key: 'var_95',
      label: 'VaR 95%',
      value: `${m.var_95.toFixed(2)}%`,
      description: t('strategyDev.descVar95'),
      verdict: m.var_95 > -2 ? 'good' : m.var_95 > -5 ? 'ok' : m.var_95 > -10 ? 'warn' : 'bad',
    },
    {
      key: 'cvar_95',
      label: 'CVaR 95%',
      value: `${m.cvar_95.toFixed(2)}%`,
      description: t('strategyDev.descCvar95'),
      verdict: m.cvar_95 > -3 ? 'good' : m.cvar_95 > -7 ? 'ok' : m.cvar_95 > -15 ? 'warn' : 'bad',
    },
    {
      key: 'omega',
      label: 'Omega',
      value: m.omega > 100 ? '>100' : m.omega.toFixed(2),
      description: t('strategyDev.descOmega'),
      verdict: m.omega > 2 ? 'good' : m.omega > 1.5 ? 'ok' : m.omega > 1 ? 'warn' : 'bad',
    },
    {
      key: 'tail_ratio',
      label: 'Tail Ratio',
      value: m.tail_ratio > 100 ? '>100' : m.tail_ratio.toFixed(2),
      description: t('strategyDev.descTailRatio'),
      verdict: m.tail_ratio > 1.5 ? 'good' : m.tail_ratio > 1 ? 'ok' : m.tail_ratio > 0.5 ? 'warn' : 'bad',
    },
    {
      key: 'ulcer_index',
      label: 'Ulcer Index',
      value: m.ulcer_index.toFixed(2),
      description: t('strategyDev.descUlcer'),
      verdict: m.ulcer_index < 5 ? 'good' : m.ulcer_index < 10 ? 'ok' : m.ulcer_index < 20 ? 'warn' : 'bad',
    },
    {
      key: 'recovery',
      label: 'Recovery Factor',
      value: m.recovery_factor > 100 ? '>100' : m.recovery_factor.toFixed(2),
      description: t('strategyDev.descRecovery'),
      verdict: m.recovery_factor > 3 ? 'good' : m.recovery_factor > 1.5 ? 'ok' : m.recovery_factor > 1 ? 'warn' : 'bad',
    },
    {
      key: 'gain_pain',
      label: 'Gain/Pain',
      value: m.gain_pain_ratio > 100 ? '>100' : m.gain_pain_ratio.toFixed(2),
      description: t('strategyDev.descGainPain'),
      verdict: m.gain_pain_ratio > 2 ? 'good' : m.gain_pain_ratio > 1 ? 'ok' : m.gain_pain_ratio > 0.5 ? 'warn' : 'bad',
    },
    {
      key: 'kelly',
      label: 'Kelly %',
      value: `${m.kelly_criterion.toFixed(1)}%`,
      description: t('strategyDev.descKelly'),
      verdict: m.kelly_criterion > 10 ? 'good' : m.kelly_criterion > 5 ? 'ok' : m.kelly_criterion > 0 ? 'warn' : 'bad',
    },
  ];
});

const verdictColor: Record<string, string> = {
  good: 'var(--sd-success)',
  ok: 'var(--sd-info)',
  warn: 'var(--sd-warning)',
  bad: 'var(--sd-danger)',
  neutral: 'var(--sd-text)',
};
</script>

<template>
  <div class="rm-grid">
    <div
      v-for="item in items"
      :key="item.key"
      class="rm-card"
    >
      <MetricPopover
        :label="item.label"
        :value="item.value"
        :verdict="item.verdict"
        :verdict-text="item.description"
        position="bottom"
      >
        <div class="rm-card-inner">
          <div class="rm-card-header">
            <span class="rm-label">{{ item.label }}</span>
            <span class="rm-verdict-dot" :style="{ backgroundColor: verdictColor[item.verdict] }" />
          </div>
          <span class="rm-value" :style="{ color: verdictColor[item.verdict] }">{{ item.value }}</span>
        </div>
      </MetricPopover>
    </div>
  </div>
</template>

<style scoped>
.rm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}

.rm-card {
  display: flex;
  flex-direction: column;
  background: var(--sd-base);
  border: 1px solid var(--sd-border-subtle);
  border-radius: var(--sd-radius-md);
  gap: 2px;
}

.rm-card-inner {
  padding: 12px;
}

.rm-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.rm-label {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--sd-overlay);
}

.rm-verdict-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.rm-value {
  font-size: var(--sd-text-lg);
  font-weight: 700;
  font-family: var(--sd-font-mono);
}

</style>
