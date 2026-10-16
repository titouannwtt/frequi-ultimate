<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { KpiStrip, KpiTile, PnlValue, Skeleton } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import type { TradeTotals } from '@/gateway/types.gen';

import type { JournalStats } from './lib/journalPage';
import { pairLabel } from './lib/trades';

/**
 * Filtered totals of the Journal (02 sections 3.4 and 12): net P&L (a trade without a result is
 * counted but left out of the sum), win rate, profit factor, expectancy, worst trade, worst
 * adverse move in absolute USDC (never a percentage: it confuses risk and profit), median and P90
 * duration, trades per day. The headline figures come from the gateway totals of the WHOLE
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
const fmt = useFormat();

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
const worstDd = computed(() => s.value?.worstDrawdown ?? null);
const hours = (h: number | null) => (h === null ? t('fq.ds.notAvailable') : fmt.duration(h));
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
        <Skeleton shape="kpi" :count="6" />
      </template>
      <template v-else>
        <KpiTile
          :label="t('fq.jr.totals.net')"
          :sub="t('fq.jr.totals.netSub', { n: count, u: unknown })"
          data-testid="jt-net"
        >
          <template #value>
            <PnlValue v-if="net !== null" :value="net" :decimals="2" />
            <template v-else>{{ t('fq.ds.notAvailable') }}</template>
            <small v-if="net !== null"> USDC</small>
          </template>
        </KpiTile>
        <KpiTile
          :label="t('fq.jr.totals.winrate')"
          :value="winrate === null ? t('fq.ds.notAvailable') : fmt.percent(winrate * 100, 1, false)"
          :sub="t('fq.jr.totals.winsLosses', { w: wins, l: losses })"
          data-testid="jt-winrate"
        />
        <KpiTile
          :label="t('fq.jr.totals.factor')"
          :value="factor === null ? t('fq.ds.notAvailable') : fmt.number(factor, 2)"
          :sub="
            s?.avgWin === undefined || s.avgWin === null
              ? t('fq.jr.totals.noLoss')
              : t('fq.jr.totals.avgWin', { v: fmt.signed(s.avgWin, 2) })
          "
          data-testid="jt-factor"
        />
        <KpiTile
          :label="t('fq.jr.totals.expectancy')"
          :sub="
            s?.avgLoss === undefined || s.avgLoss === null
              ? undefined
              : t('fq.jr.totals.avgLoss', { v: fmt.signed(s.avgLoss, 2) })
          "
          data-testid="jt-expectancy"
        >
          <template #value>
            <PnlValue v-if="expectancy !== null" :value="expectancy" :decimals="2" />
            <template v-else>{{ t('fq.ds.notAvailable') }}</template>
          </template>
        </KpiTile>
        <KpiTile :label="t('fq.jr.totals.worst')" :sub="worstSub" data-testid="jt-worst">
          <template #value>
            <PnlValue v-if="worstAbs !== null" :value="worstAbs" :decimals="2" />
            <template v-else>{{ t('fq.ds.notAvailable') }}</template>
          </template>
        </KpiTile>
        <KpiTile
          :label="t('fq.jr.totals.worstDd')"
          :sub="worstDd === null ? t('fq.jr.totals.worstDdNoMae') : t('fq.jr.totals.worstDdSub')"
          data-testid="jt-worstdd"
        >
          <template #value>
            <PnlValue v-if="worstDd !== null" :value="worstDd" :decimals="2" />
            <PnlValue
              v-else-if="worstAbs !== null"
              :value="Math.min(0, worstAbs)"
              :decimals="2"
              muted
            />
            <template v-else>{{ t('fq.ds.notAvailable') }}</template>
            <small v-if="worstDd !== null || worstAbs !== null"> USDC</small>
          </template>
        </KpiTile>
        <KpiTile
          class="k-x"
          :label="t('fq.jr.totals.duration')"
          :value="hours(s?.medianHours ?? null)"
          :sub="
            s?.p90Hours === undefined || s.p90Hours === null
              ? undefined
              : t('fq.jr.totals.p90', { v: fmt.duration(s.p90Hours) })
          "
          data-testid="jt-duration"
        />
        <KpiTile
          class="k-x"
          :label="t('fq.jr.totals.perDay')"
          :value="
            s?.perDay === undefined || s.perDay === null
              ? t('fq.ds.notAvailable')
              : fmt.number(s.perDay, 1)
          "
          :sub="s && s.days > 0 ? t('fq.jr.totals.overDays', { n: Math.round(s.days) }) : undefined"
          data-testid="jt-perday"
        />
      </template>
    </KpiStrip>
    <p v-if="partial" class="partial" role="note">{{ t('fq.jr.totals.partial') }}</p>
  </div>
</template>

<style scoped>
.partial {
  margin: 0;
  padding: 2px var(--s3) 4px;
  background: var(--bg-1);
  border-bottom: 1px solid var(--line);
  color: var(--warn);
  font-size: var(--t-xs);
}
@media (max-width: 599px) {
  .jt :deep(.k-x) {
    display: none;
  }
}
</style>
