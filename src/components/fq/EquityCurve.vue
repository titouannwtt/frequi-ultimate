<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  BaseChart,
  EmptyState,
  ModeMark,
  PnlValue,
  SegmentedControl,
  Skeleton,
} from '@/components/ds';
import type { SegmentOption } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import { useSourceQuery } from '@/composables/useSourceQuery';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import { scopeKey, type EquitySeries, type ScopeRef } from '@/datasource/types';
import type { BotMode, DrawdownResult, Tz } from '@/gateway/types.gen';
import type { DataSource } from '@/datasource/types';
import { prefersReducedMotion } from '@/utils/motion';

import { drawdownPct } from './lib/bots';
import { useChartTokens } from './lib/chartTokens';
import { formatClock, formatDateTime } from './lib/time';
import {
  buildEquityOption,
  EQUITY_PERIODS,
  maxDrawdownAbs,
  periodStartMs,
  variation,
  type EquityDefinition,
  type EquityPeriod,
} from './lib/equity';

/**
 * Equity curve with its drawdown (02 sections 3.1 and 12): one chart instance, the curve above and
 * the drawdown below, in USDC first. Two named definitions, never mixed: "realised" and "with open
 * positions". The headline numbers come from the source (`/equity` and `/drawdown` on the gateway);
 * when only part of the history is known (direct mode) it says so. A failed refresh keeps the last
 * curve, marked.
 */
const props = withDefaults(
  defineProps<{
    scope: ScopeRef;
    period?: EquityPeriod;
    definition?: EquityDefinition;
    mode?: BotMode;
    tz?: Tz;
    /** Replace the queries (previews, tests). */
    series?: EquitySeries | null;
    drawdown?: DrawdownResult | null;
    /** CSS height of the chart; `fill` takes the room the container leaves. */
    height?: string;
    /** A source to use instead of the active one (previews, tests). */
    source?: DataSource | null;
    nowMs?: number;
  }>(),
  { period: '7d', definition: 'with_open', mode: 'live', height: '260px' },
);

const emit = defineEmits<{
  'update:period': [period: EquityPeriod];
  'update:definition': [definition: EquityDefinition];
}>();

const { t, locale } = useI18n();
const fmt = useFormat();
const prefs = useFqPrefsStore();
const clock = useNowMs();
const { tokens } = useChartTokens();

const zone = computed<Tz>(() => props.tz ?? prefs.settings.tz);
const now = computed(() => props.nowMs ?? clock.value);
const preloaded = computed(() => props.series !== undefined);

// The clock ticks every second: the start of the period is rounded to the minute so the key (and
// the query) only changes when the question does
const minute = computed(() => Math.floor(now.value / 60_000));
const fromMs = computed(() => periodStartMs(props.period, minute.value * 60_000, zone.value));

const eq = useSourceQuery<EquitySeries>(
  (source) =>
    preloaded.value
      ? null
      : source.query.equity({
          scope: props.scope,
          fromMs: fromMs.value,
          points: 600,
          mode: props.definition,
          tradingMode: props.mode,
        }),
  () =>
    `${scopeKey(props.scope)}|${props.period}|${props.definition}|${props.mode}|${props.period === 'all' ? 0 : minute.value}`,
  { refreshMs: 30_000, source: () => props.source },
);
const dd = useSourceQuery<DrawdownResult | null>(
  (source) =>
    props.drawdown !== undefined
      ? null
      : source.query.drawdown({
          scope: props.scope,
          def: props.definition === 'realized' ? 'realized' : 'with_open',
          tradingMode: props.mode,
        }),
  () => `${scopeKey(props.scope)}|${props.definition}|${props.mode}`,
  { refreshMs: 60_000, source: () => props.source },
);

const series = computed<EquitySeries | null>(() =>
  preloaded.value ? (props.series ?? null) : eq.data.value,
);
const points = computed(() => series.value?.points ?? []);
const loading = computed(() => !preloaded.value && eq.loading.value && !eq.data.value);

const ddResult = computed<DrawdownResult | null>(() =>
  props.drawdown !== undefined ? props.drawdown : dd.data.value,
);
const ddValue = computed(() =>
  ddResult.value
    ? props.definition === 'realized'
      ? ddResult.value.realized
      : ddResult.value.with_open
    : null,
);
/** Absolute value first; without the source's figure, the one read off the curve. */
const ddAbs = computed(() =>
  ddValue.value ? ddValue.value.abs : points.value.length > 1 ? maxDrawdownAbs(points.value) : null,
);
const ddFromCurve = computed(() => !ddValue.value && ddAbs.value !== null);

const change = computed(() => variation(points.value));

const periodOptions = computed<SegmentOption<EquityPeriod>[]>(() =>
  EQUITY_PERIODS.map((p) => ({ value: p, label: t(`fq.eq.period.${p}`) })),
);
const definitionOptions = computed<SegmentOption<EquityDefinition>[]>(() => [
  { value: 'with_open', label: t('fq.eq.def.with_open') },
  { value: 'realized', label: t('fq.eq.def.realized') },
]);

const option = computed(() =>
  buildEquityOption({
    points: points.value,
    tokens: tokens.value,
    fmtValue: (v, decimals) => fmt.number(v, decimals ?? (Math.abs(v) >= 1000 ? 0 : 2)),
    fmtDate: (ts) =>
      props.period === '24h'
        ? formatClock(ts, zone.value)
        : formatDateTime(ts, zone.value, locale.value).slice(0, 5),
    labels: { equity: t('fq.eq.series.equity'), drawdown: t('fq.eq.series.drawdown') },
  }),
);

// The curve draws itself the first time only; later updates (a point added) never animate
const animateFirst = ref(!prefersReducedMotion());
watch(
  () => points.value.length > 1,
  (has) => {
    if (has) setTimeout(() => (animateFirst.value = false), 800);
  },
  { immediate: true },
);

const chartLabel = computed(() =>
  t('fq.eq.chartLabel', { def: t(`fq.eq.def.${props.definition}`) }),
);
</script>

<template>
  <div class="eq" data-testid="equity-curve" :aria-busy="loading || undefined">
    <div class="bar">
      <SegmentedControl
        :model-value="definition"
        :options="definitionOptions"
        size="sm"
        :label="t('fq.eq.definition')"
        @update:model-value="(v) => emit('update:definition', v)"
      />
      <SegmentedControl
        :model-value="period"
        :options="periodOptions"
        size="sm"
        :label="t('fq.eq.periodLabel')"
        @update:model-value="(v) => emit('update:period', v)"
      />
      <ModeMark :mode="mode" class="mm" />
    </div>

    <p v-if="eq.error.value" class="note warn" role="status">
      {{ t('fq.ds.pane.error') }} · {{ t('fq.ds.pane.lastValues') }}
    </p>
    <p v-if="series?.unavailable" class="note" role="status" data-testid="eq-partial">
      {{ t('fq.eq.partial') }}
    </p>

    <Skeleton v-if="loading" shape="kpi" :count="2" />
    <template v-else-if="points.length > 1">
      <div class="head">
        <div class="fig">
          <span class="lab"
            >{{ t('fq.eq.variation', { p: t(`fq.eq.period.${period}`) }) }}
            <span class="mut">({{ t(`fq.eq.def.${definition}`) }})</span></span
          >
          <span class="big"><PnlValue :value="change" unit="USDC" :decimals="2" /></span>
        </div>
        <div class="fig" data-testid="eq-drawdown">
          <span class="lab"
            >{{ t('fq.eq.drawdownMax') }}
            <span class="mut">({{ t(`fq.eq.def.${definition}`) }})</span></span
          >
          <span class="big">
            <template v-if="ddAbs !== null">
              <PnlValue :value="-ddAbs" unit="USDC" :decimals="0" />
              <small v-if="drawdownPct(ddValue) !== null" class="pct">
                &nbsp;{{ fmt.percent(-(drawdownPct(ddValue) as number), 1) }}</small
              >
            </template>
            <span v-else class="mut">{{ t('fq.ds.notAvailable') }}</span>
          </span>
          <span v-if="ddFromCurve" class="mut sub">{{ t('fq.eq.fromCurve') }}</span>
        </div>
      </div>
      <div
        class="chart"
        :class="{ fill: height === 'fill' }"
        :style="height === 'fill' ? undefined : { height }"
      >
        <BaseChart :option="option" :animate="animateFirst" :label="chartLabel" />
      </div>
    </template>
    <EmptyState
      v-else
      icon="activity"
      :title="t('fq.eq.empty')"
      :hint="series?.unavailable ? t('fq.eq.partial') : t('fq.eq.emptyHint')"
    />
  </div>
</template>

<style scoped>
.eq {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  padding: var(--s3);
  min-width: 0;
  min-height: 100%;
  box-sizing: border-box;
}
.bar {
  display: flex;
  align-items: center;
  gap: var(--s2);
  flex-wrap: wrap;
}
.mm {
  margin-left: auto;
}
.note {
  margin: 0;
  font-size: var(--t-xs);
  color: var(--fg-3);
}
.note.warn {
  color: var(--warn);
}
.head {
  display: flex;
  gap: var(--s5);
  flex-wrap: wrap;
}
.fig {
  display: grid;
  gap: 2px;
}
.lab {
  font-size: var(--t-xs);
  color: var(--fg-3);
}
.mut {
  color: var(--fg-3);
}
.big {
  font-family: var(--font-num);
  font-size: var(--t-lg);
  font-weight: 600;
  font-variant-numeric: tabular-nums slashed-zero;
}
.pct {
  margin-left: var(--s1);
  font-size: var(--t-xs);
  color: var(--fg-3);
  font-weight: 500;
}
.sub {
  font-size: var(--t-xs);
}
.chart {
  min-width: 0;
}
.chart.fill {
  flex: 1;
  min-height: 130px;
}
</style>
