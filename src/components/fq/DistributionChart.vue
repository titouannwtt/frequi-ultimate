<script setup lang="ts">
import type { EChartsOption } from 'echarts';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { BaseChart, EmptyState, Skeleton } from '@/components/ds';
import { MINUS } from '@/components/ds/lib/format';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useTradeSet } from '@/composables/useTradeSet';
import type { DataSource, TradeQuery } from '@/datasource/types';

import { useChartTokens } from './lib/chartTokens';
import { binLabel, distribution, type JournalTrade } from './lib/journal';

/**
 * Histogram of the results of the closed trades, log scale (02 section 3.4). The tail under the
 * threshold (-5 % by default) is drawn in the loss colour, and a sentence puts a number on its
 * weight in the gross loss. Trades with an unknown result are counted apart and never drawn. One
 * chart instance. The set comes from the Journal (`trades`) or is read from the source by `query`.
 */
const props = withDefaults(
  defineProps<{
    query?: TradeQuery;
    trades?: JournalTrade[];
    source?: DataSource | null;
    tailPct?: number;
    height?: string;
  }>(),
  { tailPct: -5, height: '230px' },
);

const { t } = useI18n();
const fmt = useFormat();
const { tokens } = useChartTokens();

const loaded = useTradeSet(() => (props.trades ? null : (props.query ?? null)), {
  source: () => props.source,
});
const rows = computed(() => props.trades ?? loaded.trades.value);
const loading = computed(() => !props.trades && loaded.loading.value && rows.value.length === 0);
const dist = computed(() => distribution(rows.value, { tailPct: props.tailPct }));
const partial = computed(() => !props.trades && !loaded.complete.value);

const pctLabel = (v: number) => fmt.percent(v, 0);

const option = computed<EChartsOption>(() => {
  const c = tokens.value;
  const bins = dist.value.bins;
  return {
    grid: { left: 8, right: 12, top: 14, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: bins.map((b) => binLabel(b)),
      axisLabel: {
        color: c.fg3,
        fontSize: 11,
        interval: 1,
        formatter: (v: string) => v.replace('-', MINUS),
      },
      axisLine: { lineStyle: { color: c.line2 } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'log',
      logBase: 2,
      min: 1,
      axisLabel: { color: c.fg3, fontSize: 11 },
      splitLine: { lineStyle: { color: c.line } },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (p: unknown) => {
        const first = (Array.isArray(p) ? p[0] : p) as { dataIndex: number } | undefined;
        const b = first ? bins[first.dataIndex] : undefined;
        return b
          ? `${binLabel(b).replace('-', MINUS)} %<br/>${t('fq.jr.tradesN', { n: b.count }, b.count)}`
          : '';
      },
    },
    series: [
      {
        id: 'dist',
        type: 'bar',
        barCategoryGap: '18%',
        data: bins.map((b) => ({
          value: b.count > 0 ? b.count : null,
          itemStyle: {
            color: b.tail ? c.loss : b.to <= 0 ? c.fg3 : c.fg2,
            borderRadius: [2, 2, 0, 0],
          },
        })),
      },
    ],
  };
});

const tailShare = computed(() => {
  const s = dist.value.tail.share;
  return s === null ? null : Math.round(s * 100);
});
const dominates = computed(() => (dist.value.tail.share ?? 0) >= 0.5);
</script>

<template>
  <div class="dist" data-testid="distribution">
    <Skeleton v-if="loading" shape="row" :count="4" />
    <template v-else-if="dist.drawn > 0">
      <p class="sent" data-testid="dist-sentence">
        <template v-if="dist.tail.count > 0 && tailShare !== null">
          {{ t('fq.jr.dist.tail', { n: dist.tail.count, pct: pctLabel(tailPct) }) }}
          <b class="down">{{ fmt.signed(dist.tail.sum, 2) }} USDC</b
          >{{ t('fq.jr.dist.share', { share: tailShare }) }}
          {{ dominates ? t('fq.jr.dist.dominates') : t('fq.jr.dist.notDominant') }}
        </template>
        <template v-else-if="dist.tail.count === 0">
          {{ t('fq.jr.dist.noTail', { pct: pctLabel(tailPct) }) }}
        </template>
        <template v-else>
          {{ t('fq.jr.dist.tailNoLoss', { n: dist.tail.count, pct: pctLabel(tailPct) }) }}
        </template>
      </p>
      <div class="plot" :style="{ minHeight: height }">
        <BaseChart class="fill" :option="option" :label="t('fq.jr.dist.chartLabel')" />
      </div>
      <p v-if="dist.unknown > 0" class="note" data-testid="dist-unknown">
        {{ t('fq.jr.unknownExcluded', { n: dist.unknown }, dist.unknown) }}
      </p>
      <p v-if="partial" class="note" data-testid="dist-partial">
        {{ t('fq.jr.partial', { n: rows.length }) }}
      </p>
    </template>
    <EmptyState
      v-else
      icon="activity"
      :title="t('fq.jr.empty')"
      :hint="
        dist.unknown > 0
          ? t('fq.jr.unknownExcluded', { n: dist.unknown }, dist.unknown)
          : t('fq.jr.emptyHint')
      "
    />
  </div>
</template>

<style scoped>
.dist {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.sent {
  margin: 0;
  padding: 10px var(--s3);
  font-size: var(--t-sm);
  color: var(--fg-2);
  border-bottom: 1px solid var(--line);
}
.sent b {
  color: var(--fg);
}
.sent .down {
  color: var(--loss);
}
.plot {
  position: relative;
  min-width: 0;
  /* The given height is the least; a taller panel gives the rest to the chart */
  flex: 1 1 0;
}
/* The chart fills its box whatever the height chain above it (a percentage would not resolve) */
.plot :deep(.fill) {
  position: absolute;
  inset: var(--s2) var(--s2) 0;
  width: auto;
  height: auto !important;
}
.note {
  margin: 0;
  padding: 6px var(--s3);
  color: var(--fg-3);
  font-size: var(--t-xs);
}
</style>
