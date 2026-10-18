<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core';
import DatePicker from 'primevue/datepicker';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  BaseChart,
  Btn,
  EmptyState,
  ModeMark,
  Popover,
  PnlValue,
  SegmentedControl,
  Skeleton,
} from '@/components/ds';
import type { SegmentOption } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import { useSourceQuery } from '@/composables/useSourceQuery';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import { scopeKey, type DataSource, type EquitySeries, type ScopeRef } from '@/datasource/types';
import type { BotMode, Tz } from '@/gateway/types.gen';
import { prefersReducedMotion } from '@/utils/motion';

import type { EquityPeriod } from './lib/equity';
import { useChartTokens } from './lib/chartTokens';
import {
  buildProfitCurves,
  buildProfitOption,
  customRange,
  profitRange,
  PROFIT_PERIODS,
  rangeDates,
  type CustomRange,
  type ProfitPeriod,
} from './lib/profit';
import { formatClock, formatDay } from './lib/time';

/**
 * The "Profit" block of the Fleet: what the ticked bots earned over a period, as two curves (the
 * closed trades, and the closed trades with the open positions) that both start at 0 where the
 * period starts. The period is one of the usual ones (24 h to the whole history) or a range of
 * days. Terms stay plain: "realised" and "latent" are in the tooltips. A failed refresh keeps the
 * last curves, marked. The curve with the open positions only exists since the gateway samples the
 * profit: the note under the figures says since when.
 */
const props = withDefaults(
  defineProps<{
    /** Bots of the figures (the ticked ones of `mode`). */
    scope: ScopeRef;
    mode?: BotMode;
    /** Latent profit of the open positions of the scope, now; null when not known. */
    latent?: number | null;
    latentState?: 'ready' | 'pending' | 'unavailable';
    /** CSS height of the chart; `fill` takes the room the container leaves. */
    height?: string;
    /** Replace the queries (previews, tests). */
    source?: DataSource | null;
    nowMs?: number;
  }>(),
  { mode: 'live', latent: null, latentState: 'ready', height: '320px' },
);

const { t, locale } = useI18n();
const fmt = useFormat();
const prefs = useFqPrefsStore();
const clock = useNowMs();
const { tokens } = useChartTokens();

const zone = computed<Tz>(() => prefs.settings.tz);

// ---- the period: kept between visits, a custom range with it ----
const PERIOD_KEY = 'fqu2.profitPeriod';
const RANGE_KEY = 'fqu2.profitRange';
const storedPeriod = useLocalStorage<ProfitPeriod>(PERIOD_KEY, '30d');
const storedRange = useLocalStorage<CustomRange | null>(RANGE_KEY, null, {
  serializer: {
    read: (raw) => {
      try {
        const v = JSON.parse(raw) as Partial<CustomRange> | null;
        return v && Number.isFinite(v.fromMs) && Number.isFinite(v.toMs)
          ? (v as CustomRange)
          : null;
      } catch {
        return null;
      }
    },
    write: (v) => JSON.stringify(v),
  },
});
const period = computed<ProfitPeriod>({
  get: () => {
    const p = storedPeriod.value;
    if (p === 'custom') return storedRange.value ? 'custom' : '30d';
    return PROFIT_PERIODS.includes(p as EquityPeriod) ? p : '30d';
  },
  set: (v) => (storedPeriod.value = v),
});

const periodOptions = computed<SegmentOption<ProfitPeriod>[]>(() =>
  PROFIT_PERIODS.map((p) => ({ value: p, label: t(`fq.eq.period.${p}`) })),
);

// ---- the range of dates ----
const rangeAnchor = ref<HTMLElement | null>(null);
const rangeOpen = ref(false);
const picked = ref<Date[] | null>(null);
function toggleRange(e: MouseEvent) {
  rangeAnchor.value = e.currentTarget as HTMLElement;
  if (!rangeOpen.value) picked.value = rangeDates(storedRange.value, zone.value);
  rangeOpen.value = !rangeOpen.value;
}
const canApply = computed(() => !!picked.value?.[0]);
function applyRange() {
  const [start, end] = picked.value ?? [];
  if (!start) return;
  storedRange.value = customRange(start, end ?? null, zone.value);
  period.value = 'custom';
  rangeOpen.value = false;
}
// Two days picked by the user: that is a range, no need for another click. Only a real choice
// applies: reopening the panel on the saved range must not close it again.
function onPick(v: Date | Date[] | (Date | null)[] | null | undefined) {
  picked.value = Array.isArray(v) ? (v.filter(Boolean) as Date[]) : v ? [v] : null;
  if (picked.value?.[0] && picked.value[1]) applyRange();
}
const today = computed(() => new Date(props.nowMs ?? clock.value));

// ---- what is asked ----
// The clock ticks every second: the start of the period is cut to the minute. The key does not
// carry it (a sliding start is the same question): the last answer stays on screen while the next
// refresh, which reads the range when it runs, comes in.
const minute = computed(() => Math.floor((props.nowMs ?? clock.value) / 60_000));
const nowMin = computed(() => minute.value * 60_000);
const range = computed(() =>
  profitRange(period.value, storedRange.value, nowMin.value, zone.value),
);
const rangeKey = computed(() =>
  period.value === 'custom'
    ? `custom|${range.value.fromMs ?? 0}|${range.value.toMs ?? 0}`
    : period.value,
);
const empty = computed(() => props.scope.kind === 'bots' && props.scope.botKeys.length === 0);

function ask(mode: 'realized' | 'with_open') {
  return (source: DataSource) =>
    empty.value
      ? null
      : source.query.equity({
          scope: props.scope,
          fromMs: range.value.fromMs,
          toMs: range.value.toMs,
          points: 600,
          mode,
          tradingMode: props.mode,
        });
}
const keyOf = (def: string) => () =>
  `${scopeKey(props.scope)}|${props.mode}|${def}|${rangeKey.value}`;
const realizedQ = useSourceQuery<EquitySeries>(ask('realized'), keyOf('r'), {
  refreshMs: 30_000,
  source: () => props.source,
});
const openQ = useSourceQuery<EquitySeries>(ask('with_open'), keyOf('o'), {
  refreshMs: 30_000,
  source: () => props.source,
});

const endMs = computed(() => Math.min(range.value.toMs ?? nowMin.value, nowMin.value));
const curves = computed(() =>
  buildProfitCurves(realizedQ.data.value, openQ.data.value, range.value.fromMs, endMs.value),
);
const loading = computed(() => !empty.value && realizedQ.loading.value && !realizedQ.data.value);
const failed = computed(() => realizedQ.error.value !== null || openQ.error.value !== null);
const hasCurve = computed(
  () => curves.value.realized.length > 1 || curves.value.withOpen.length > 1,
);
const partial = computed(() => realizedQ.data.value?.unavailable === 'partial_history');
const noOpenHistory = computed(
  () => !!realizedQ.data.value && openQ.data.value?.unavailable === 'no_history',
);

// ---- the drawing ----
const spanDays = computed(() => {
  const pts = curves.value.realized.length ? curves.value.realized : curves.value.withOpen;
  return pts.length > 1 ? (pts[pts.length - 1]![0] - pts[0]![0]) / 86_400_000 : 0;
});
const longSpan = computed(() => spanDays.value > 120);
const dayText = (ts: number, withYear = longSpan.value) =>
  formatDay(ts, zone.value, locale.value, withYear);
const option = computed(() =>
  buildProfitOption({
    curves: curves.value,
    tokens: tokens.value,
    fmtValue: (v, decimals) => fmt.number(v, decimals ?? (Math.abs(v) >= 1000 ? 0 : 2)),
    fmtDate: (ts) => (period.value === '24h' ? formatClock(ts, zone.value) : dayText(ts)),
    fmtFull: (ts) => `${dayText(ts)} ${formatClock(ts, zone.value)}`,
    labels: {
      realized: t('fq.pg.fleet.profit.realized'),
      withOpen: t('fq.pg.fleet.profit.withOpen'),
      gap: t('fq.pg.fleet.profit.gap'),
    },
  }),
);

// The curve draws itself the first time only; later updates never animate
const animateFirst = ref(!prefersReducedMotion());
watch(
  hasCurve,
  (has) => {
    if (has) setTimeout(() => (animateFirst.value = false), 800);
  },
  { immediate: true },
);

const rangeLabel = computed(() => {
  const r = storedRange.value;
  if (!r) return t('fq.pg.fleet.profit.dates');
  const long = r.toMs - r.fromMs > 120 * 86_400_000;
  return `${dayText(r.fromMs, long)} - ${dayText(r.toMs, long)}`;
});
const periodWord = computed(() =>
  period.value === 'custom'
    ? t('fq.pg.fleet.profit.overRange', { r: rangeLabel.value })
    : t('fq.pg.fleet.profit.over', { p: t(`fq.pg.fleet.eq.period.${period.value}`) }),
);
const trackedText = computed(() =>
  curves.value.trackedSince === null
    ? ''
    : t('fq.pg.fleet.profit.trackedSince', {
        date: formatDay(curves.value.trackedSince, zone.value, locale.value),
      }),
);
</script>

<template>
  <div class="pf" data-testid="profit-panel" :aria-busy="loading || undefined">
    <div class="bar">
      <SegmentedControl
        :model-value="period"
        :options="periodOptions"
        size="sm"
        :label="t('fq.eq.periodLabel')"
        data-testid="profit-periods"
        @update:model-value="(v) => (period = v)"
      />
      <Btn
        class="dates"
        :variant="period === 'custom' ? 'secondary' : 'ghost'"
        size="sm"
        icon="calendar"
        :aria-expanded="rangeOpen"
        :title="t('fq.pg.fleet.profit.datesHint')"
        data-testid="profit-dates"
        @click="toggleRange"
      >
        {{ period === 'custom' ? rangeLabel : t('fq.pg.fleet.profit.dates') }}
      </Btn>
      <ModeMark :mode="mode" class="mm" />
    </div>

    <Popover
      :open="rangeOpen"
      :anchor="rangeAnchor"
      :label="t('fq.pg.fleet.profit.datesHint')"
      @close="rangeOpen = false"
    >
      <div class="range" data-testid="profit-range">
        <DatePicker
          :model-value="picked"
          inline
          selection-mode="range"
          :max-date="today"
          :manual-input="false"
          @update:model-value="onPick"
        />
        <div class="act">
          <Btn size="sm" variant="ghost" @click="rangeOpen = false">{{
            t('fq.pg.fleet.profit.cancel')
          }}</Btn>
          <Btn size="sm" variant="primary" :disabled="!canApply" @click="applyRange">{{
            t('fq.pg.fleet.profit.apply')
          }}</Btn>
        </div>
      </div>
    </Popover>

    <div class="figs" data-testid="profit-figures">
      <div class="fig main" :title="t('fq.pg.fleet.profit.profitHint')">
        <span class="lab">{{ t('fq.pg.fleet.profit.profit') }} {{ periodWord }}</span>
        <span class="big"
          ><PnlValue
            :value="curves.profit"
            unit="USDC"
            :decimals="2"
            :state="loading ? 'pending' : 'ready'"
            :unknown="!loading && curves.profit === null"
        /></span>
      </div>
      <div class="fig" :title="t('fq.pg.fleet.profit.realizedHint')">
        <span class="lab">{{ t('fq.pg.fleet.profit.realized') }}</span>
        <span class="big"
          ><PnlValue
            :value="curves.realizedProfit"
            unit="USDC"
            :decimals="2"
            :state="loading ? 'pending' : 'ready'"
            :unknown="!loading && curves.realizedProfit === null"
        /></span>
      </div>
      <div class="fig" :title="t('fq.pg.fleet.profit.latentHint')">
        <span class="lab">{{ t('fq.pg.fleet.profit.latent') }}</span>
        <span class="big"
          ><PnlValue
            :value="latent"
            unit="USDC"
            :decimals="2"
            :state="latentState"
            :unknown="latentState === 'ready' && latent === null"
        /></span>
      </div>
      <ul class="legend" aria-hidden="true">
        <li><i class="dot r"></i>{{ t('fq.pg.fleet.profit.realized') }}</li>
        <li><i class="dot o"></i>{{ t('fq.pg.fleet.profit.withOpen') }}</li>
      </ul>
    </div>

    <p v-if="failed" class="note warn" role="status">
      {{ t('fq.ds.pane.error') }} · {{ t('fq.ds.pane.lastValues') }}
    </p>
    <p v-if="partial" class="note" role="status" data-testid="profit-partial">
      {{ t('fq.eq.partial') }}
    </p>
    <p v-if="trackedText" class="note" data-testid="profit-tracked">{{ trackedText }}</p>
    <p v-else-if="noOpenHistory" class="note" data-testid="profit-no-open">
      {{ t('fq.pg.fleet.profit.noOpenHistory') }}
    </p>

    <Skeleton v-if="loading" shape="kpi" :count="2" />
    <EmptyState
      v-else-if="empty"
      icon="bot"
      :title="t('fq.pg.fleet.profit.noBots')"
      :hint="t('fq.pg.fleet.profit.noBotsHint')"
    />
    <div
      v-else-if="hasCurve"
      class="chart"
      :class="{ fill: height === 'fill' }"
      :style="height === 'fill' ? undefined : { height }"
    >
      <BaseChart
        :option="option"
        :animate="animateFirst"
        :label="t('fq.pg.fleet.profit.chartLabel')"
      />
    </div>
    <EmptyState
      v-else
      icon="chart-line"
      :title="t('fq.pg.fleet.profit.empty')"
      :hint="t('fq.pg.fleet.profit.emptyHint')"
    />
  </div>
</template>

<style scoped>
.pf {
  display: flex;
  flex-direction: column;
  gap: var(--s3);
  padding: var(--s3);
  min-width: 0;
  box-sizing: border-box;
}
.bar {
  display: flex;
  align-items: center;
  gap: var(--s2);
  flex-wrap: wrap;
  min-width: 0;
}
.mm {
  margin-left: auto;
}
.figs {
  display: flex;
  align-items: flex-end;
  gap: var(--s2) var(--s6);
  flex-wrap: wrap;
}
.fig {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.lab {
  font-size: var(--t-xs);
  color: var(--fg-3);
}
.big {
  font-family: var(--font-num);
  font-size: var(--t-lg);
  font-weight: 600;
  font-variant-numeric: tabular-nums slashed-zero;
}
.fig.main .big {
  font-size: var(--t-xl);
}
.legend {
  display: flex;
  gap: var(--s4);
  margin: 0 0 0 auto;
  padding: 0;
  list-style: none;
  font-size: var(--t-xs);
  color: var(--fg-3);
}
.legend li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dot.r {
  background: var(--accent);
}
.dot.o {
  background: var(--info);
}
.note {
  margin: 0;
  font-size: var(--t-xs);
  color: var(--fg-3);
}
.note.warn {
  color: var(--warn);
}
.chart {
  min-width: 0;
}
.chart.fill {
  flex: 1 1 0;
  min-height: 160px;
}
.range {
  display: grid;
  gap: var(--s2);
  padding: var(--s2);
  max-width: calc(100vw - 24px);
}
.act {
  display: flex;
  justify-content: flex-end;
  gap: var(--s2);
}
@media (max-width: 599px) {
  .legend {
    margin-left: 0;
    width: 100%;
  }
  .big {
    font-size: var(--t-md);
  }
  .fig.main .big {
    font-size: var(--t-lg);
  }
}
</style>
