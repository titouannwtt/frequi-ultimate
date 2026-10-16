<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core';
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';

import { DsIcon, KpiStrip, KpiTile, PnlValue, Skeleton } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useValueSlot } from '@/composables/useValueSlot';
import type { TradeTotals } from '@/gateway/types.gen';

import type { JournalStats } from './lib/journalPage';
import { pairLabel } from './lib/trades';
import { PENDING, READY, unavailable, type Slot } from './lib/valueState';

/**
 * Filtered totals of the Journal (02 sections 3.4 and 12, 05 section 2.6). Four figures in the
 * strip: net P&L (a trade without a result is counted but left out of the sum), win rate, average
 * win and average loss, worst trade. "More figures" opens the rest: profit factor, expectancy,
 * worst adverse move in absolute USDC (never a percentage: it confuses risk and profit), median
 * and P90 duration, trades per day. The headline figures come from the gateway totals of the WHOLE
 * filtered set when there are some; the rest is computed on the trades loaded for the analysis.
 * A figure the source cannot give is "not available", never a zero.
 */
const props = defineProps<{
  stats: JournalStats | null;
  /** Totals of the whole filtered set (gateway). */
  totals?: TradeTotals | null;
  /** The figures only cover the history loaded so far (direct mode, or more rows than the cap). */
  partial?: boolean;
  loading?: boolean;
  botName?: (key: string) => string;
}>();

const { t } = useI18n();
const moreId = useId();
/** The second strip stays open (or closed) from one visit to the next. */
const more = useLocalStorage('fqu2.journal.moreTotals', false);
const fmt = useFormat();
const { vs } = useValueSlot();
/** A figure the filter cannot give: read again (pending) or not computable from these trades. */
const slotOf = (v: number | null | undefined): Slot =>
  v !== null && v !== undefined ? READY : props.loading ? PENDING : unavailable('noSample');

const s = computed(() => props.stats);
const net = computed(() => props.totals?.sum ?? s.value?.net ?? null);
const count = computed(() =>
  props.totals ? props.totals.count + props.totals.unknown : (s.value?.trades ?? 0),
);
const unknown = computed(() => props.totals?.unknown ?? s.value?.unknown ?? 0);
const wins = computed(() => props.totals?.wins ?? s.value?.wins ?? 0);
const losses = computed(() => props.totals?.losses ?? s.value?.losses ?? 0);
const winrate = computed(() => (props.totals ? props.totals.winrate : (s.value?.winrate ?? null)));
const factor = computed(() =>
  props.totals ? props.totals.profit_factor : (s.value?.profitFactor ?? null),
);
const worstAbs = computed(() => props.totals?.worst_abs ?? s.value?.worstTrade?.profit ?? null);
const expectancy = computed(() => {
  const known = count.value - unknown.value;
  if (net.value === null || known <= 0) return null;
  return net.value / known;
});
const avgWin = computed(() => s.value?.avgWin ?? null);
const avgLoss = computed(() => s.value?.avgLoss ?? null);
const worstDd = computed(() => s.value?.worstDrawdown ?? null);
const worstSub = computed(() => {
  const w = s.value?.worstTrade;
  if (!w || (props.totals && props.totals.worst_abs !== w.profit)) return undefined;
  const name = props.botName?.(w.botKey) ?? w.botKey;
  return `${pairLabel(w.pair)} · ${name}`;
});
</script>

<template>
  <div class="jt" data-testid="journal-totals">
    <KpiStrip :label="t('fq.jr.totals.title')">
      <template v-if="loading && !s">
        <Skeleton shape="kpi" :count="4" />
      </template>
      <template v-else>
        <KpiTile
          :label="t('fq.jr.totals.net')"
          :hint="t('fq.jr.totals.netHint')"
          :sub="t('fq.jr.totals.netSub', { n: count, u: unknown })"
          data-testid="jt-net"
          v-bind="vs(slotOf(net))"
        >
          <template #value> <PnlValue :value="net" :decimals="2" /><small> USDC</small> </template>
        </KpiTile>
        <KpiTile
          :label="t('fq.jr.totals.winrate')"
          :value="fmt.percent((winrate ?? 0) * 100, 1, false)"
          :sub="t('fq.jr.totals.winsLosses', { w: wins, l: losses })"
          data-testid="jt-winrate"
          v-bind="vs(slotOf(winrate))"
        />
        <KpiTile
          :label="t('fq.jr.totals.avg')"
          :short-label="t('fq.jr.totals.avgShort')"
          :hint="t('fq.jr.totals.avgHint')"
          :sub="t('fq.jr.totals.avgSub')"
          data-testid="jt-avg"
          v-bind="vs(slotOf(avgWin ?? avgLoss))"
        >
          <template #value>
            <PnlValue v-if="avgWin !== null" :value="avgWin" :decimals="2" />
            <span v-else class="none">{{ t('fq.jr.totals.noWin') }}</span>
            <span class="slash"> / </span>
            <PnlValue v-if="avgLoss !== null" :value="avgLoss" :decimals="2" />
            <span v-else class="none">{{ t('fq.jr.totals.noLossShort') }}</span>
          </template>
        </KpiTile>
        <KpiTile
          :label="t('fq.jr.totals.worst')"
          :sub="worstSub"
          data-testid="jt-worst"
          v-bind="vs(slotOf(worstAbs))"
        >
          <template #value><PnlValue :value="worstAbs" :decimals="2" /></template>
        </KpiTile>
      </template>
    </KpiStrip>

    <div class="mrow">
      <button
        type="button"
        class="mbtn"
        :aria-expanded="more"
        :aria-controls="moreId"
        data-testid="jt-more"
        @click="more = !more"
      >
        <DsIcon :name="more ? 'chevron-up' : 'chevron-down'" :size="13" />
        {{ more ? t('fq.jr.totals.less') : t('fq.jr.totals.more') }}
      </button>
    </div>
    <KpiStrip v-if="more" :id="moreId" :label="t('fq.jr.totals.more')" data-testid="jt-extra">
      <template v-if="loading && !s">
        <Skeleton shape="kpi" :count="5" />
      </template>
      <template v-else>
        <KpiTile
          :label="t('fq.jr.totals.factor')"
          :hint="t('fq.jr.totals.factorHint')"
          :value="fmt.number(factor ?? 0, 2)"
          :sub="losses === 0 && wins > 0 ? t('fq.jr.totals.noLoss') : undefined"
          data-testid="jt-factor"
          v-bind="vs(slotOf(factor))"
        />
        <KpiTile
          :label="t('fq.jr.totals.expectancy')"
          :hint="t('fq.jr.totals.expectancyHint')"
          data-testid="jt-expectancy"
          v-bind="vs(slotOf(expectancy))"
        >
          <template #value><PnlValue :value="expectancy" :decimals="2" /></template>
        </KpiTile>
        <KpiTile
          :label="t('fq.jr.totals.worstDd')"
          :sub="worstDd === null ? t('fq.jr.totals.worstDdNoMae') : t('fq.jr.totals.worstDdSub')"
          data-testid="jt-worstdd"
          v-bind="vs(slotOf(worstDd ?? worstAbs))"
        >
          <template #value>
            <PnlValue v-if="worstDd !== null" :value="worstDd" :decimals="2" />
            <PnlValue v-else :value="Math.min(0, worstAbs ?? 0)" :decimals="2" muted />
            <small> USDC</small>
          </template>
        </KpiTile>
        <KpiTile
          :label="t('fq.jr.totals.duration')"
          :value="fmt.duration(s?.medianHours ?? 0)"
          :sub="
            s?.p90Hours === undefined || s.p90Hours === null
              ? undefined
              : t('fq.jr.totals.p90', { v: fmt.duration(s.p90Hours) })
          "
          data-testid="jt-duration"
          v-bind="vs(slotOf(s?.medianHours))"
        />
        <KpiTile
          :label="t('fq.jr.totals.perDay')"
          :value="fmt.number(s?.perDay ?? 0, 1)"
          :sub="s && s.days > 0 ? t('fq.jr.totals.overDays', { n: Math.round(s.days) }) : undefined"
          data-testid="jt-perday"
          v-bind="vs(slotOf(s?.perDay))"
        />
      </template>
    </KpiStrip>
    <p v-if="partial" class="partial" role="note">{{ t('fq.jr.totals.partial') }}</p>
  </div>
</template>

<style scoped>
.mrow {
  display: flex;
  padding: 0 var(--s3);
  background: var(--bg-1);
  border-bottom: 1px solid var(--line);
}
.mbtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--fg-3);
  font: inherit;
  font-size: var(--t-xs);
  cursor: pointer;
}
.mbtn:hover {
  color: var(--fg);
}
@media (max-width: 599px), (pointer: coarse) {
  .mbtn {
    height: 44px;
  }
}
.slash,
.none {
  color: var(--fg-3);
}
.none {
  font-size: var(--t-md);
}
.partial {
  margin: 0;
  padding: 2px var(--s3) 4px;
  background: var(--bg-1);
  border-bottom: 1px solid var(--line);
  color: var(--warn);
  font-size: var(--t-xs);
}
</style>
