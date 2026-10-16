<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { ExcludedCount, KpiStrip, KpiTile, ModeMark, PnlValue, SplitBar } from '@/components/ds';
import type { BotRef, KpiMeter } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import { useScope } from '@/composables/useScope';
import { useScopeDetail } from '@/composables/useScopeDetail';
import { useValueSlot } from '@/composables/useValueSlot';
import { ruleMeta } from '@/datasource/calc/alerts/rules';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { ScopeDetail } from '@/datasource/types';
import type { BotKey } from '@/gateway/types.gen';

import { fleetKpiModel, type FleetKpiModel } from './lib/kpis';

/**
 * The KPI strip of the Fleet page (02 section 3.1): equity with the open profit, latent P&L, day,
 * 30 days, drawdown (USDC first), wallet exposure, margin, bots online. Live by default; in the
 * "All" scope the live and the dry figures are shown one under the other and say they are not
 * added. A bot whose figures are stale is left out of the sums: "N excluded" lists them.
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

const loaded = useScopeDetail(() => scope.fleetScopeRef.value);
const data = computed<ScopeDetail | null>(() => props.detail ?? loaded.detail.value);
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
  return `${fmt.percent(-m.drawdown.pct, 1)} · ${t('fq.kpi.threshold', { v: fmt.number(ddThreshold.value, 0) })}`;
}

const ddThreshold = computed(() => {
  const custom = prefs.settings.alerts.rules.global.highDrawdown?.threshold;
  return Math.abs(custom ?? ruleMeta('highDrawdown').threshold?.default ?? 15);
});

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

function exposureSub(m: FleetKpiModel): string | undefined {
  if (m.slots.exposure.state !== 'ready') return undefined;
  return `${t('fq.header.net', { n: fmt.signed(m.exposure.net, 0) })}${m.netted ? '' : ` · ${t('fq.fleet.notNetted')}`}`;
}

function excludedRefs(m: FleetKpiModel): BotRef[] {
  return m.excluded.map((k) => ({
    key: k,
    name: fleet.bots[k]?.identity.name ?? k,
  }));
}

function statesText(m: FleetKpiModel): string {
  const parts = (['offline', 'stale', 'starting', 'auth_expired', 'stopped'] as const)
    .filter((s) => (m.states[s] ?? 0) > 0)
    .map((s) => `${m.states[s]} ${t(`fq.kpi.state.${s}`)}`);
  return parts.join(' · ');
}

const tz = computed(() => prefs.settings.tz);

const SKELETON = [
  'equityOpen',
  'pnlOpen',
  'realizedToday',
  'realized30d',
  'drawdownOpen',
  'exposure',
  'margin',
  'botsOnline',
] as const;
</script>

<template>
  <div class="fk" data-testid="fleet-kpis">
    <div v-for="m in models" :key="m.mode" class="row" :data-mode="m.mode">
      <div v-if="models.length > 1" class="tag">
        <ModeMark :mode="m.mode" full />
        <span>{{ t('fq.kpi.notSummed') }}</span>
      </div>
      <KpiStrip :label="t('fq.kpi.strip', { mode: t(`fq.scope.${m.mode}`) })">
        <KpiTile
          :label="t('fq.kpi.equityOpen')"
          :hint="t('fq.hint.equityOpen')"
          :short-label="t('fq.kpiShort.equityOpen')"
          wide
          data-testid="kpi-equity"
          v-bind="vs(m.slots.equityOpen, `${m.mode}/equityOpen`)"
        >
          <template #value>
            {{ fmt.number(m.equityOpen as number, 2) }}<small> USDC</small>
          </template>
          <template #sub>
            <template v-if="m.equityRealized !== null">
              {{ t('fq.kpi.realizedEquity', { v: fmt.number(m.equityRealized, 2) }) }}
            </template>
            <ExcludedCount :bots="excludedRefs(m)" @select="(b) => emit('openBot', b.key)" />
          </template>
        </KpiTile>
        <KpiTile
          :label="t('fq.kpi.pnlOpen')"
          :hint="t('fq.hint.pnlOpen')"
          :sub="t('fq.kpi.positions', { n: m.openCount }, m.openCount)"
          data-testid="kpi-open"
          v-bind="vs(m.slots.openProfit, `${m.mode}/openProfit`)"
        >
          <template #value><PnlValue :value="m.openProfit" /></template>
        </KpiTile>
        <KpiTile
          :label="t('fq.kpi.realizedToday')"
          :hint="t('fq.hint.realizedToday')"
          :short-label="t('fq.kpiShort.realizedToday')"
          :sub="t('fq.kpi.sinceMidnight', { tz })"
          data-testid="kpi-day"
          v-bind="vs(m.slots.realized1d, `${m.mode}/realized1d`)"
        >
          <template #value><PnlValue :value="m.realized1d" /></template>
        </KpiTile>
        <KpiTile
          :label="t('fq.kpi.realized30d')"
          :hint="t('fq.hint.realized30d')"
          :short-label="t('fq.kpiShort.realized30d')"
          :sub="
            m.winrate === null
              ? undefined
              : t('fq.kpi.winrate', { v: fmt.percent(m.winrate * 100, 1, false) })
          "
          data-testid="kpi-30d"
          v-bind="vs(m.slots.realized30d, `${m.mode}/realized30d`)"
        >
          <template #value>
            <PnlValue :value="m.realized30d" :decimals="2" />
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
          :label="t('fq.kpi.exposure')"
          :sub="exposureSub(m)"
          wide
          data-testid="kpi-exposure"
          v-bind="vs(m.slots.exposure, `${m.mode}/exposure`)"
        >
          <template #value>
            <span class="long">{{ fmt.number(m.exposure.long, 0) }}</span> /
            <span class="short">{{ fmt.number(m.exposure.short, 0) }}</span>
          </template>
          <SplitBar
            v-if="m.slots.exposure.state === 'ready'"
            :long="m.exposure.long"
            :short="m.exposure.short"
          />
        </KpiTile>
        <KpiTile
          :label="t('fq.kpi.margin')"
          :hint="t('fq.hint.margin')"
          :meter="
            m.marginPct === null
              ? undefined
              : { value: m.marginPct, max: 100, tone: m.marginPct >= 85 ? 'warn' : 'neutral' }
          "
          data-testid="kpi-margin"
          v-bind="vs(m.slots.margin, `${m.mode}/margin`)"
        >
          <template #value> {{ fmt.number(m.marginPct as number, 1) }}<small> %</small> </template>
        </KpiTile>
        <KpiTile
          :label="t('fq.kpi.botsOnline')"
          :sub="statesText(m) || undefined"
          data-testid="kpi-online"
        >
          <template #value>
            {{ m.online }}<small> / {{ m.total }}</small>
          </template>
        </KpiTile>
      </KpiStrip>
    </div>
    <div v-if="models.length === 0" class="row" data-testid="kpi-loading">
      <KpiStrip :label="t('fq.kpi.strip', { mode: '' })">
        <KpiTile
          v-for="k in SKELETON"
          :key="k"
          :label="t(`fq.kpi.${k}`)"
          state="pending"
          :pending-key="`fleet/${k}`"
        />
      </KpiStrip>
    </div>
  </div>
</template>

<style scoped>
.fk {
  display: grid;
}
.row {
  display: grid;
}
.tag {
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: 4px var(--s3) 0;
  font-size: var(--t-xs);
  color: var(--fg-3);
  background: var(--bg-1);
}
small {
  font-size: var(--t-sm);
  color: var(--fg-3);
  font-weight: 500;
}
.long {
  color: var(--profit);
}
.short {
  color: var(--loss);
}
</style>
