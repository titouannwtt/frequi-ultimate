<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { ExcludedCount, KpiTile, ModeMark, PnlValue } from '@/components/ds';
import type { BotRef, KpiMeter } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import { useScope } from '@/composables/useScope';
import { useScopeDetail } from '@/composables/useScopeDetail';
import { useValueSlot } from '@/composables/useValueSlot';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { ScopeDetail } from '@/datasource/types';
import type { BotKey } from '@/gateway/types.gen';

import { alertLimit } from './lib/fleetPage';
import { fleetKpiModel, type FleetKpiModel } from './lib/kpis';
import { riskModel } from './lib/risk';

/**
 * The four figures of the Fleet page (docs/redesign/05-friendly-plan.md, L4): total capital with
 * the open profit in its sub-line, what was won over 30 days (today and the win rate in its
 * sub-line), the fall from the highest point (USDC first, then the percentage and the limit) and
 * the margin used (the closest liquidation in its sub-line). The other figures went to sub-lines
 * or to the wallet risk card. Live by default; in the "All" scope the live and the dry figures are
 * shown one under the other and say they are not added. A bot whose figures are stale is left out
 * of the sums: "N excluded" lists them.
 */
const props = defineProps<{
  /** Preloaded detail (previews, tests); otherwise read from the active source. */
  detail?: ScopeDetail | null;
  nowMs?: number;
}>();
const emit = defineEmits<{ openBot: [botKey: BotKey]; openScope: [] }>();

const { t } = useI18n();
const fmt = useFormat();
const scope = useScope();
const fleet = useFqFleetStore();
const conn = useFqConnectionStore();
const prefs = useFqPrefsStore();
const clock = useNowMs();
const { vs } = useValueSlot();
// On a phone the sub-lines are short: a half-width tile has room for a few words
const phone = useMediaQuery('(max-width: 599px)');

// A page that already reads the detail (the Fleet) hands it over: one request, not two
const loaded = props.detail === undefined ? useScopeDetail(() => scope.fleetScopeRef.value) : null;
const data = computed<ScopeDetail | null>(() => props.detail ?? loaded?.detail.value ?? null);
const now = computed(() => props.nowMs ?? clock.value);

const wantedModes = computed(() =>
  scope.mode.value === 'all' ? (['live', 'dry'] as const) : ([scope.mode.value] as const),
);

const models = computed<FleetKpiModel[]>(() => {
  const d = data.value;
  if (!d) return [];
  return wantedModes.value.flatMap((mode, i) => {
    const block = d.totals.find((b) => b.mode === mode);
    return block ? [fleetKpiModel(block, d, now.value, conn.status.clockSkewMs, i === 0)] : [];
  });
});

function ddSub(m: FleetKpiModel): string | undefined {
  if (m.drawdown?.pct == null) return undefined;
  return t(`fq.pg.fleet.kpi.${phone.value ? 'ddLimitPhone' : 'ddLimit'}`, {
    pct: fmt.percent(m.drawdown.pct, 1, false),
    limit: fmt.number(ddThreshold.value, 0),
  });
}

const ddThreshold = computed(() => alertLimit(prefs.settings.alerts.rules, 'highDrawdown'));

function ddMeter(m: FleetKpiModel): KpiMeter | undefined {
  if (m.drawdown?.pct == null) return undefined;
  const pct = m.drawdown.pct;
  return {
    value: pct,
    max: Math.max(ddThreshold.value * 1.5, pct),
    threshold: ddThreshold.value,
    tone: pct >= ddThreshold.value ? 'crit' : 'neutral',
  };
}

/** The closest liquidation of the positions of this mode, in percent of the price. */
function nearestLiquidation(m: FleetKpiModel): number | null {
  const d = data.value;
  const block = d?.totals.find((b) => b.mode === m.mode);
  if (!d || !block || m.slots.margin.state !== 'ready') return null;
  const risk = riskModel({
    positions: d.positions,
    totals: block,
    mode: m.mode,
    modeOf: (k) => fleet.bots[k]?.identity.mode ?? null,
    walletOf: (k) => fleet.bots[k]?.state.wallet_id ?? null,
  });
  return risk.nearest?.distancePct ?? null;
}
function marginSub(m: FleetKpiModel): string | undefined {
  const pct = nearestLiquidation(m);
  return pct === null
    ? undefined
    : t(`fq.pg.fleet.kpi.${phone.value ? 'liqNearestPhone' : 'liqNearest'}`, {
        v: fmt.number(pct, 0),
      });
}

function excludedRefs(m: FleetKpiModel): BotRef[] {
  return m.excluded.map((k) => ({
    key: k,
    name: fleet.bots[k]?.identity.name ?? k,
  }));
}

const SKELETON = ['equityOpen', 'realized30d', 'drawdownOpen', 'margin'] as const;
</script>

<template>
  <div class="fk" data-testid="fleet-kpis">
    <div v-for="m in models" :key="m.mode" class="row" :data-mode="m.mode">
      <div v-if="models.length > 1" class="tag">
        <ModeMark :mode="m.mode" full />
        <span>{{ t('fq.kpi.notSummed') }}</span>
      </div>
      <div
        class="kpis"
        role="group"
        :aria-label="t('fq.kpi.strip', { mode: t(`fq.scope.${m.mode}`) })"
      >
        <KpiTile
          :label="t('fq.kpi.equityOpen')"
          :hint="t('fq.hint.equityOpen')"
          :short-label="t('fq.kpiShort.equityOpen')"
          data-testid="kpi-equity"
          v-bind="vs(m.slots.equityOpen, `${m.mode}/equityOpen`)"
        >
          <template #value>
            {{ fmt.number(m.equityOpen as number, 2) }}<small> USDC</small>
          </template>
          <template #sub>
            <span data-testid="kpi-open">
              {{ t(phone ? 'fq.pg.fleet.kpi.inProgressPhone' : 'fq.pg.fleet.kpi.inProgressPre') }}
              <PnlValue
                :value="m.openProfit"
                v-bind="vs(m.slots.openProfit, `${m.mode}/openProfit`)"
              />
              <span v-if="!phone" class="post">{{ t('fq.pg.fleet.kpi.inProgressPost') }}</span>
            </span>
            <ExcludedCount :bots="excludedRefs(m)" @select="(b) => emit('openBot', b.key)" />
          </template>
        </KpiTile>
        <KpiTile
          :label="t('fq.kpi.realized30d')"
          :hint="t('fq.hint.realized30d')"
          :short-label="t('fq.kpiShort.realized30d')"
          data-testid="kpi-30d"
          v-bind="vs(m.slots.realized30d, `${m.mode}/realized30d`)"
        >
          <template #value>
            <PnlValue :value="m.realized30d" :decimals="2" />
          </template>
          <template #sub>
            <span data-testid="kpi-day">
              {{ t('fq.pg.fleet.kpi.todayPre') }}
              <PnlValue
                :value="m.realized1d"
                v-bind="vs(m.slots.realized1d, `${m.mode}/realized1d`)"
              />
            </span>
            <template v-if="m.winrate !== null && !phone">
              ·
              {{ t('fq.pg.fleet.kpi.winrate', { v: fmt.percent(m.winrate * 100, 0, false) }) }}
            </template>
          </template>
        </KpiTile>
        <KpiTile
          :label="t('fq.kpi.drawdownOpen')"
          :hint="t('fq.hint.drawdownOpen')"
          :short-label="t('fq.kpiShort.drawdownOpen')"
          :meter="ddMeter(m)"
          :sub="ddSub(m)"
          data-testid="kpi-dd"
          v-bind="vs(m.slots.drawdown, `${m.mode}/drawdown`)"
        >
          <template #value>
            <PnlValue :value="-(m.drawdown?.abs as number)" :decimals="0" unit="USDC" />
          </template>
        </KpiTile>
        <KpiTile
          :label="t('fq.kpi.margin')"
          :hint="t('fq.hint.margin')"
          :meter="
            m.marginPct === null
              ? undefined
              : { value: m.marginPct, max: 100, tone: m.marginPct >= 85 ? 'warn' : 'neutral' }
          "
          :sub="marginSub(m)"
          data-testid="kpi-margin"
          v-bind="vs(m.slots.margin, `${m.mode}/margin`)"
        >
          <template #value> {{ fmt.number(m.marginPct as number, 1) }}<small> %</small> </template>
        </KpiTile>
      </div>
    </div>
    <div v-if="models.length === 0" class="row" data-testid="kpi-loading">
      <div class="kpis" role="group" :aria-label="t('fq.kpi.strip', { mode: '' })">
        <KpiTile
          v-for="k in SKELETON"
          :key="k"
          :label="t(`fq.kpi.${k}`)"
          state="pending"
          :pending-key="`fleet/${k}`"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.fk {
  display: grid;
  gap: var(--s3);
}
.row {
  display: grid;
  gap: var(--s1);
}
.tag {
  display: flex;
  align-items: center;
  gap: var(--s2);
  font-size: var(--t-xs);
  color: var(--fg-3);
}
/* Four cards, not a strip: each figure stands on its own */
.kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--s3);
}
.kpis > :deep(.kpi) {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-card);
  background: var(--bg-1);
  padding: var(--s3) var(--s4);
  gap: 3px;
}
.kpis > :deep(.kpi:last-child) {
  border-right: 1px solid var(--line);
}
.kpis > :deep(.kpi .k) {
  font-size: var(--t-sm);
  color: var(--fg-2);
}
.kpis > :deep(.kpi .v) {
  font-size: var(--t-xl);
  margin: 2px 0;
}
.kpis > :deep(.kpi .s) {
  font-size: var(--t-sm);
  /* A sub-line wraps rather than being cut: "N excluded" must stay readable */
  white-space: normal;
  overflow: visible;
}
.kpis > :deep(.kpi .s .excl-wrap) {
  margin-left: var(--s2);
}
.post {
  margin-left: 0.3em;
}
@media (max-width: 1023px) {
  .kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 599px) {
  .kpis {
    gap: var(--s2);
  }
  .kpis > :deep(.kpi) {
    padding: var(--s3);
  }
  .kpis > :deep(.kpi .k),
  .kpis > :deep(.kpi .s) {
    font-size: 12.5px;
  }
}
small {
  font-size: var(--t-sm);
  color: var(--fg-3);
  font-weight: 500;
}
</style>
