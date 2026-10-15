<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { Badge, EmptyState, PnlValue, Skeleton } from '@/components/ds';
import { useTradeSet } from '@/composables/useTradeSet';
import type { DataSource, TradeQuery } from '@/datasource/types';

import { exitReasons, type ExitRow, type JournalTrade } from './lib/journal';

/**
 * P&L by exit reason (02 section 3.4). The reason is a neutral chip in the user's language with the
 * raw freqtrade value in the tooltip; the stop loss is the only one in the loss colour; a custom
 * reason of a strategy keeps its own text and an unknown one is "unknown", never merged into another.
 * A human exit carries the "manual" badge. A trade with an unknown profit is left out and counted.
 */
const props = defineProps<{
  query?: TradeQuery;
  trades?: JournalTrade[];
  source?: DataSource | null;
}>();

const { t } = useI18n();

const loaded = useTradeSet(() => (props.trades ? null : (props.query ?? null)), {
  source: () => props.source,
});
const rows = computed(() => props.trades ?? loaded.trades.value);
const loading = computed(() => !props.trades && loaded.loading.value && rows.value.length === 0);
const summary = computed(() => exitReasons(rows.value));
const scale = computed(() => Math.max(0, ...summary.value.rows.map((r) => Math.abs(r.pnl))));
const partial = computed(() => !props.trades && !loaded.complete.value);

function label(r: ExitRow): string {
  return r.kind === 'custom' ? (r.raws[0] ?? t('fq.exit.custom')) : t(`fq.exit.${r.kind}`);
}
function tip(r: ExitRow): string {
  return r.raws.length > 0 ? r.raws.join(', ') : t('fq.jr.exit.noRaw');
}
const widthOf = (r: ExitRow) =>
  scale.value > 0 ? `${(Math.abs(r.pnl) / scale.value) * 100}%` : '0%';
</script>

<template>
  <div class="er" data-testid="exit-reasons">
    <Skeleton v-if="loading" shape="row" :count="4" />
    <template v-else-if="summary.rows.length > 0">
      <p class="sent">{{ t('fq.jr.exit.intro') }}</p>
      <table class="dtab">
        <thead>
          <tr>
            <th class="l">{{ t('fq.jr.exit.reason') }}</th>
            <th>{{ t('fq.jr.trades') }}</th>
            <th>{{ t('fq.col.pnl_abs') }}</th>
            <th class="barc">
              <span class="sr">{{ t('fq.jr.bar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in summary.rows" :key="r.key">
            <td class="l ui">
              <div class="rc">
                <span class="chip" :class="{ loss: r.kind === 'stop_loss' }" :title="tip(r)">{{
                  label(r)
                }}</span>
                <Badge
                  v-if="r.manual > 0"
                  kind="manual"
                  :label="t('fq.jr.exit.manualN', { n: r.manual })"
                />
              </div>
            </td>
            <td>{{ r.trades }}</td>
            <td><PnlValue :value="r.pnl" :decimals="2" /></td>
            <td class="barc">
              <span
                class="hb"
                :class="r.pnl >= 0 ? 'p' : 'n'"
                :style="{ width: widthOf(r) }"
              ></span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="summary.unknownProfit > 0" class="note" data-testid="exit-unknown-profit">
        {{ t('fq.jr.unknownExcluded', { n: summary.unknownProfit }, summary.unknownProfit) }}
      </p>
      <p v-if="partial" class="note">{{ t('fq.jr.partial', { n: rows.length }) }}</p>
    </template>
    <EmptyState v-else icon="log-out" :title="t('fq.jr.empty')" :hint="t('fq.jr.emptyHint')" />
  </div>
</template>

<style scoped>
.er {
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
.note {
  margin: 0;
  padding: 6px var(--s3);
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.dtab {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--t-sm);
}
th {
  text-align: right;
  height: 30px;
  padding: 0 8px;
  color: var(--fg-3);
  font-weight: 500;
  font-size: var(--t-xs);
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
td {
  text-align: right;
  height: var(--row);
  padding: 0 8px;
  border-bottom: 1px solid var(--line);
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
}
th.l,
td.l {
  text-align: left;
}
td.ui {
  font-family: var(--font-ui);
}
.rc {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.chip {
  display: inline-block;
  padding: 1px 7px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-1);
  background: var(--bg-2);
  color: var(--fg-2);
  font-size: var(--t-xs);
  cursor: help;
}
.chip.loss {
  color: var(--loss);
  border-color: color-mix(in srgb, var(--loss) 45%, var(--line-2));
}
.barc {
  width: 34%;
}
.hb {
  display: block;
  height: 8px;
  border-radius: 2px;
  margin-left: auto;
}
.hb.p {
  background: var(--profit);
}
.hb.n {
  background: var(--loss);
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
