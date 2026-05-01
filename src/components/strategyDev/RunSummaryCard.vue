<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { getVerdict, getVerdictText, validationChecklist, type VerdictLevel } from './metricThresholds';

const { t } = useI18n();
const store = useStrategyDevStore();

const detail = computed(() => store.hyperoptDetail);
const analysis = computed(() => store.hyperoptAnalysis);
const run = computed(() => store.selectedRun);

const bestMetrics = computed<Record<string, number>>(() => {
  const d = detail.value;
  if (!d) return {};
  return (d.best_epoch_metrics ?? {}) as Record<string, number>;
});

interface SentenceItem {
  text: string;
  verdict: VerdictLevel;
  anchor?: string;
}

const sentences = computed<SentenceItem[]>(() => {
  const m = bestMetrics.value;
  const r = run.value;
  const a = analysis.value;
  const items: SentenceItem[] = [];

  if (m.profit_total != null) {
    const pct = (m.profit_total * 100).toFixed(1);
    const v = getVerdict('profit_total', m.profit_total);
    const timerange = r?.timerange || '';
    items.push({
      text: `Profit de ${m.profit_total >= 0 ? '+' : ''}${pct}%${timerange ? ` sur ${timerange}` : ''} — ${getVerdictText('profit_total', m.profit_total).toLowerCase()}.`,
      verdict: v,
      anchor: 'overview',
    });
  }

  if (m.max_drawdown_account != null) {
    const dd = (m.max_drawdown_account * 100).toFixed(1);
    const v = getVerdict('max_drawdown_account', m.max_drawdown_account);
    items.push({
      text: `Drawdown max de ${dd}% — ${getVerdictText('max_drawdown_account', m.max_drawdown_account).toLowerCase()}.`,
      verdict: v,
      anchor: 'overview',
    });
  }

  if (m.total_trades != null) {
    const v = getVerdict('total_trades', m.total_trades);
    items.push({
      text: `${m.total_trades} trades — ${getVerdictText('total_trades', m.total_trades).toLowerCase()}.`,
      verdict: v,
      anchor: 'overview',
    });
  }

  if (m.winrate != null) {
    const wr = (m.winrate * 100).toFixed(1);
    const v = getVerdict('winrate', m.winrate);
    items.push({
      text: `Win rate ${wr}% — ${getVerdictText('winrate', m.winrate).toLowerCase()}.`,
      verdict: v,
      anchor: 'overview',
    });
  }

  const dsr = a?.dsr_analysis as { genuine?: boolean; dsr?: number } | undefined;
  if (dsr) {
    const v: VerdictLevel = dsr.genuine ? 'good' : 'bad';
    const dsrVal = dsr.dsr != null ? ` (DSR: ${dsr.dsr.toFixed(2)})` : '';
    items.push({
      text: dsr.genuine
        ? `DSR${dsrVal} — résultat considéré comme robuste.`
        : `DSR${dsrVal} — risque d'overfitting détecté.`,
      verdict: v,
      anchor: 'charts',
    });
  }

  const mc = a?.monte_carlo as { prob_positive?: number } | undefined;
  if (mc?.prob_positive != null) {
    const pp = mc.prob_positive;
    const v: VerdictLevel = pp >= 80 ? 'good' : pp >= 60 ? 'warn' : 'bad';
    items.push({
      text: `Monte Carlo : ${pp.toFixed(0)}% de probabilité de profit positif — ${pp >= 80 ? 'robuste' : pp >= 60 ? 'marginal' : 'pas d\'edge'}.`,
      verdict: v,
      anchor: 'charts',
    });
  }

  const dof = a?.dof_analysis as { level?: string; label?: string } | undefined;
  if (dof) {
    const v: VerdictLevel = dof.level === 'green' ? 'good' : dof.level === 'yellow' ? 'warn' : 'bad';
    items.push({
      text: `Degrés de liberté : ${dof.label?.toLowerCase() ?? 'inconnu'}.`,
      verdict: v,
      anchor: 'charts',
    });
  }

  return items;
});

// ── Validation checklist ──
const checklistResults = computed(() => {
  const m = bestMetrics.value;
  const r = run.value ?? {};
  return validationChecklist.map((item) => ({
    ...item,
    status: item.check(m, r as Record<string, unknown>),
    detail: item.reason(m, r as Record<string, unknown>),
  }));
});

const checklistScore = computed(() => {
  const results = checklistResults.value.filter((r) => r.status !== 'skip');
  const passed = results.filter((r) => r.status === 'pass').length;
  return { passed, total: results.length };
});

const overallVerdict = computed<VerdictLevel>(() => {
  const fails = checklistResults.value.filter((r) => r.status === 'fail').length;
  const warns = checklistResults.value.filter((r) => r.status === 'warn').length;
  if (fails >= 2) return 'bad';
  if (fails >= 1 || warns >= 3) return 'warn';
  return 'good';
});

const verdictColors: Record<VerdictLevel, { text: string; bg: string }> = {
  good: { text: 'var(--sd-success)', bg: 'var(--sd-success-dim)' },
  ok: { text: 'var(--sd-info)', bg: 'var(--sd-info-dim)' },
  warn: { text: 'var(--sd-warning)', bg: 'var(--sd-warning-dim)' },
  bad: { text: 'var(--sd-danger)', bg: 'var(--sd-danger-dim)' },
  neutral: { text: 'var(--sd-subtext)', bg: 'rgba(166,173,200,0.08)' },
};

const statusIcons: Record<string, { icon: string; color: string }> = {
  pass: { icon: '✓', color: 'var(--sd-success)' },
  warn: { icon: '⚠', color: 'var(--sd-warning)' },
  fail: { icon: '✗', color: 'var(--sd-danger)' },
  skip: { icon: '—', color: 'var(--sd-overlay)' },
};

const showChecklist = ref(false);
</script>

<template>
  <div v-if="sentences.length" class="summary-card sd-panel-enter">
    <!-- Header -->
    <div class="summary-header">
      <div class="summary-title-row">
        <i-mdi-robot-outline class="summary-icon" />
        <span class="summary-title">{{ t('strategyDev.summaryTitle') }}</span>
      </div>
      <div
        class="summary-score"
        :style="{ color: verdictColors[overallVerdict].text, background: verdictColors[overallVerdict].bg }"
      >
        {{ checklistScore.passed }}/{{ checklistScore.total }}
      </div>
    </div>

    <!-- Sentences -->
    <div class="summary-sentences">
      <p
        v-for="(s, i) in sentences"
        :key="i"
        class="summary-sentence"
        :style="{ borderLeftColor: verdictColors[s.verdict].text }"
      >
        <span
          class="summary-dot"
          :style="{ backgroundColor: verdictColors[s.verdict].text }"
        />
        {{ s.text }}
      </p>
    </div>

    <!-- Checklist toggle -->
    <button class="summary-checklist-toggle" @click="showChecklist = !showChecklist">
      <i-mdi-clipboard-check-outline class="w-3.5 h-3.5" />
      {{ t('strategyDev.validationChecklist') }}
      <i-mdi-chevron-down v-if="showChecklist" class="w-3.5 h-3.5" />
      <i-mdi-chevron-right v-else class="w-3.5 h-3.5" />
    </button>

    <!-- Checklist -->
    <Transition name="sd-group">
      <div v-if="showChecklist" class="summary-checklist">
        <div
          v-for="item in checklistResults"
          :key="item.key"
          class="checklist-item"
        >
          <span
            class="checklist-status"
            :style="{ color: statusIcons[item.status].color }"
          >
            {{ statusIcons[item.status].icon }}
          </span>
          <span class="checklist-label">{{ item.label }}</span>
          <span class="checklist-detail" :style="{ color: statusIcons[item.status].color }">
            {{ item.detail }}
          </span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.summary-card {
  background: var(--sd-base);
  border: 1px solid var(--sd-border-accent);
  border-radius: var(--sd-radius-lg);
  padding: 14px 16px;
  margin-bottom: 12px;
}

.summary-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.summary-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.summary-icon {
  width: 16px;
  height: 16px;
  color: var(--sd-info);
}

.summary-title {
  font-size: var(--sd-text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--sd-info);
}

.summary-score {
  font-size: var(--sd-text-sm);
  font-weight: 700;
  font-family: var(--sd-font-mono);
  padding: 2px 10px;
  border-radius: 10px;
}

/* ── Sentences ── */
.summary-sentences {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.summary-sentence {
  font-size: var(--sd-text-xs);
  color: var(--sd-text);
  line-height: 1.5;
  padding: 3px 0 3px 10px;
  border-left: 2px solid;
  margin: 0;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.summary-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 5px;
}

/* ── Checklist toggle ── */
.summary-checklist-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  padding: 4px 0;
  font-size: var(--sd-text-xs);
  font-weight: 500;
  color: var(--sd-subtext);
  background: none;
  border: none;
  cursor: pointer;
  transition: color var(--sd-transition-fast);
}

.summary-checklist-toggle:hover {
  color: var(--sd-text);
}

/* ── Checklist ── */
.summary-checklist {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--sd-border-subtle);
}

.checklist-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--sd-text-xs);
  padding: 2px 0;
}

.checklist-status {
  width: 14px;
  text-align: center;
  font-weight: 700;
  flex-shrink: 0;
}

.checklist-label {
  color: var(--sd-text);
  flex: 1;
}

.checklist-detail {
  font-family: var(--sd-font-mono);
  font-size: var(--sd-text-2xs);
  flex-shrink: 0;
}

/* ── Transitions ── */
.sd-group-enter-active {
  transition: opacity 200ms ease, max-height 200ms ease;
  overflow: hidden;
}
.sd-group-leave-active {
  transition: opacity 150ms ease;
}
.sd-group-enter-from,
.sd-group-leave-to {
  opacity: 0;
}
</style>
