<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { EmptyState, IconBtn, ModeMark, PnlValue, Skeleton } from '@/components/ds';
import { signClass } from '@/components/ds/lib/format';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import { useSourceQuery } from '@/composables/useSourceQuery';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import { scopeKey, type ScopeRef } from '@/datasource/types';
import type { BotMode, PnlBucket, Tz } from '@/gateway/types.gen';
import type { DataSource } from '@/datasource/types';

import {
  bucketsNeeded,
  dayTint,
  monthGrid,
  monthOf,
  parseMonth,
  shiftMonth,
  type CalCell,
  type MonthKey,
} from './lib/calendar';

/**
 * P&L calendar, month view (02 section 3.1). Days are cut at local midnight of the chosen zone
 * (Europe/Paris by default), so a day around a daylight-saving change is 23 or 25 hours long and
 * says so. One trading mode at a time (live by default). A past day with no answer is "unknown",
 * never zero. Pure DOM (no chart instance).
 */
const props = withDefaults(
  defineProps<{
    scope: ScopeRef;
    /** `YYYY-MM`; the current month of the zone by default. */
    month?: MonthKey;
    tz?: Tz;
    mode?: BotMode;
    /** Replaces the query (previews and tests). */
    buckets?: PnlBucket[];
    /** A source to use instead of the active one (previews, tests). */
    source?: DataSource | null;
    nowMs?: number;
  }>(),
  { mode: 'live' },
);

const emit = defineEmits<{ 'update:month': [month: MonthKey]; selectDay: [bucket: PnlBucket] }>();

const { t, locale } = useI18n();
const fmt = useFormat();
const prefs = useFqPrefsStore();
const clock = useNowMs();

const now = computed(() => props.nowMs ?? clock.value);
const zone = computed<Tz>(() => props.tz ?? prefs.settings.tz);
const own = ref<MonthKey | null>(null);
const month = computed<MonthKey>(() => props.month ?? own.value ?? monthOf(now.value, zone.value));
const currentMonth = computed(() => monthOf(now.value, zone.value));

function go(m: MonthKey) {
  own.value = m;
  emit('update:month', m);
}

const query = useSourceQuery<PnlBucket[]>(
  (source) =>
    props.buckets
      ? null
      : source.query.periods({
          unit: 'day',
          scope: props.scope,
          tz: zone.value,
          n: bucketsNeeded(month.value, now.value, zone.value),
          tradingMode: props.mode,
        }),
  () => `${scopeKey(props.scope)}|${zone.value}|${props.mode}|${month.value}`,
  { refreshMs: 60_000, source: () => props.source },
);

const buckets = computed(() => props.buckets ?? query.data.value ?? []);
const loading = computed(() => !props.buckets && query.loading.value && !query.data.value);
const grid = computed(() => monthGrid(month.value, buckets.value, now.value, zone.value));

const title = computed(() => {
  const { y, m } = parseMonth(month.value);
  return new Intl.DateTimeFormat(locale.value === 'fr' ? 'fr-FR' : 'en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(y, m - 1, 1));
});
const weekdays = computed(() => {
  const f = new Intl.DateTimeFormat(locale.value === 'fr' ? 'fr-FR' : 'en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  });
  // 2024-01-01 is a Monday
  return Array.from({ length: 7 }, (_, i) => f.format(Date.UTC(2024, 0, 1 + i)));
});

const tradesLabel = (n: number) => t('fq.cal.trades', { n }, n);

function tintOf(c: CalCell): string | undefined {
  const b = c.bucket;
  if (!b || c.future || b.profit_abs === 0) return undefined;
  const pct = dayTint(b.profit_abs, grid.value.maxAbs);
  return `color-mix(in srgb, var(${b.profit_abs > 0 ? '--profit' : '--loss'}) ${pct}%, transparent)`;
}

function cellLabel(c: CalCell): string {
  if (c.day === null) return '';
  const day = `${c.day} ${title.value}`;
  if (c.future) return day;
  if (!c.bucket) return `${day}: ${t('fq.cal.unknownDay')}`;
  const base = `${day}: ${fmt.signed(c.bucket.profit_abs, 2)} USDC, ${tradesLabel(c.bucket.trades)}`;
  return c.dstHours !== null ? `${base}, ${t('fq.cal.dstDay', { h: c.dstHours })}` : base;
}

function onPick(c: CalCell) {
  if (c.bucket && !c.future) emit('selectDay', c.bucket);
}

const isEmptyMonth = computed(
  () => !loading.value && buckets.value.length > 0 && grid.value.trades === 0,
);
</script>

<template>
  <div class="cal" data-testid="pnl-calendar" :aria-busy="loading || undefined">
    <div class="head">
      <IconBtn
        icon="chevron-left"
        :label="t('fq.cal.prev')"
        size="sm"
        @click="go(shiftMonth(month, -1))"
      />
      <h3 class="title" data-testid="cal-title">{{ title }}</h3>
      <IconBtn
        icon="chevron-right"
        :label="t('fq.cal.next')"
        size="sm"
        :disabled="month >= currentMonth"
        @click="go(shiftMonth(month, 1))"
      />
      <button v-if="month !== currentMonth" type="button" class="today" @click="go(currentMonth)">
        {{ t('fq.cal.today') }}
      </button>
      <span class="meta">
        <ModeMark :mode="mode" />
        {{ t('fq.cal.zone', { tz: zone }) }}
      </span>
    </div>

    <p v-if="query.error.value" class="err" role="status">
      {{ t('fq.ds.pane.error') }} · {{ t('fq.ds.pane.lastValues') }}
    </p>

    <Skeleton v-if="loading" shape="row" :count="5" />
    <template v-else>
      <div class="sum" data-testid="cal-sum">
        <span class="k">{{ t('fq.cal.monthTotal') }}</span>
        <PnlValue :value="grid.total" :decimals="2" unit="USDC" />
        <span class="mut"
          >{{ t('fq.cal.days', { w: grid.winningDays, l: grid.losingDays }) }} ·
          {{ tradesLabel(grid.trades) }}</span
        >
      </div>
      <div class="g" role="grid" :aria-label="title">
        <span v-for="d in weekdays" :key="d" class="dh" role="columnheader">{{ d }}</span>
        <template v-for="(c, i) in grid.cells" :key="c.label ?? `pad${i}`">
          <span v-if="c.day === null" class="pad" role="gridcell"></span>
          <button
            v-else
            type="button"
            class="d"
            role="gridcell"
            :class="{ today: c.today, future: c.future, missing: c.missing }"
            :style="{ background: tintOf(c) }"
            :aria-label="cellLabel(c)"
            :title="cellLabel(c)"
            :disabled="!c.bucket || c.future"
            @click="onPick(c)"
          >
            <span class="n">{{ c.day }}</span>
            <span
              v-if="c.bucket && !c.future"
              class="v num"
              :class="signClass(c.bucket.profit_abs, 0)"
              >{{ c.bucket.trades === 0 ? '0' : fmt.signed(c.bucket.profit_abs, 0) }}</span
            >
            <span v-else-if="c.missing" class="v mut">{{ t('fq.ds.dash') }}</span>
            <span v-if="c.dstHours !== null" class="dst">{{ c.dstHours }} h</span>
          </button>
        </template>
      </div>
      <EmptyState
        v-if="isEmptyMonth"
        icon="info"
        :title="t('fq.cal.empty')"
        :hint="t('fq.cal.emptyHint')"
      />
      <p v-if="grid.best && grid.worst && grid.trades > 0" class="foot mut">
        {{ t('fq.cal.best') }}
        <PnlValue :value="grid.best.profit_abs" :decimals="2" />
        ({{ grid.best.label }}) · {{ t('fq.cal.worst') }}
        <PnlValue :value="grid.worst.profit_abs" :decimals="2" />
        ({{ grid.worst.label }})
      </p>
    </template>
  </div>
</template>

<style scoped>
.cal {
  display: grid;
  gap: var(--s2);
  padding: var(--s3);
  min-width: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: var(--s2);
  flex-wrap: wrap;
}
.title {
  margin: 0;
  font-size: var(--t-md);
  text-transform: capitalize;
  min-width: 9.5em;
  text-align: center;
}
.today {
  background: none;
  border: 1px solid var(--line-2);
  border-radius: var(--r-2);
  color: var(--accent);
  font: inherit;
  font-size: var(--t-xs);
  padding: 2px 8px;
  cursor: pointer;
}
@media (max-width: 599px), (pointer: coarse) {
  .today {
    min-height: 44px;
    min-width: 44px;
  }
}
.meta {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.err {
  margin: 0;
  color: var(--warn);
  font-size: var(--t-xs);
}
.sum {
  display: flex;
  align-items: baseline;
  gap: var(--s2);
  flex-wrap: wrap;
  font-size: var(--t-sm);
}
.k {
  color: var(--fg-3);
}
.mut {
  color: var(--fg-3);
}
.g {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 3px;
}
.dh {
  font-size: var(--t-xs);
  color: var(--fg-3);
  text-align: center;
  padding: 2px 0;
  text-transform: capitalize;
}
.pad {
  min-height: 46px;
}
.d {
  position: relative;
  display: grid;
  align-content: space-between;
  min-height: 46px;
  padding: 3px 5px;
  border: 1px solid var(--line);
  border-radius: var(--r-1, 3px);
  background: var(--bg-1);
  color: var(--fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
  overflow: hidden;
}
.d:disabled {
  cursor: default;
}
.d:not(:disabled):hover {
  border-color: var(--fg-4);
}
.d.future {
  opacity: 0.35;
}
.d.today {
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
.n {
  font-size: var(--t-xs);
  color: var(--fg-3);
}
.v {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
  font-size: var(--t-sm);
  font-weight: 600;
  text-align: right;
}
.v.up {
  color: var(--profit);
}
.v.down {
  color: var(--loss);
}
.v.flat {
  color: var(--fg-3);
}
.d.missing {
  background-image: var(--off-hatch);
}
.dst {
  position: absolute;
  top: 2px;
  right: 4px;
  font-size: 10px;
  color: var(--warn);
  font-family: var(--font-num);
}
.foot {
  margin: 0;
  font-size: var(--t-xs);
}
@container (max-width: 420px) {
  .d {
    min-height: 40px;
  }
}
</style>
