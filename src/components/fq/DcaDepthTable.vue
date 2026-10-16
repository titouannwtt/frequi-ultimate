<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { EmptyState, PnlValue, Skeleton, ValueState } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { unavailable } from './lib/valueState';
import { useTradeSet } from '@/composables/useTradeSet';
import { useValueSlot } from '@/composables/useValueSlot';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import type { DataSource, TradeQuery } from '@/datasource/types';

import { dcaDepth, DCA_WARN_FROM, type DepthRow, type JournalTrade } from './lib/journal';

/**
 * Trades, win rate and P&L by number of filled orders (02 section 3.4). Amber from the 4th filled
 * order, like the pips of the tables. A trade whose depth the source did not give (direct mode)
 * is counted on its own row, never spread over the others; a trade with an unknown profit is left
 * out and counted.
 */
const props = defineProps<{
  query?: TradeQuery;
  trades?: JournalTrade[];
  source?: DataSource | null;
}>();

const { t } = useI18n();
const fmt = useFormat();
const connection = useFqConnectionStore();
// What the message says follows the source really in use: the gateway is not the direct mode
const missingKey = computed(() =>
  connection.kind === 'direct'
    ? 'fq.jr.depth.missingDirect'
    : connection.kind === 'gateway'
      ? 'fq.jr.depth.missingGateway'
      : 'fq.jr.depth.missing',
);

const loaded = useTradeSet(() => (props.trades ? null : (props.query ?? null)), {
  source: () => props.source,
});
const rows = computed(() => props.trades ?? loaded.trades.value);
const loading = computed(() => !props.trades && loaded.loading.value && rows.value.length === 0);
const summary = computed(() => dcaDepth(rows.value));
const scale = computed(() =>
  Math.max(
    0,
    ...summary.value.rows.map((r) => Math.abs(r.pnl)),
    Math.abs(summary.value.unknownDepth?.pnl ?? 0),
  ),
);
const noDepth = computed(() => summary.value.rows.length === 0 && summary.value.unknownDepth);
const partial = computed(() => !props.trades && !loaded.complete.value);

const { vs } = useValueSlot();
const noSample = computed(() => vs(unavailable('noSample')));
const pctOf = (v: number) => fmt.percent(v * 100, 0, false);
const widthOf = (r: DepthRow) =>
  scale.value > 0 ? `${(Math.abs(r.pnl) / scale.value) * 100}%` : '0%';
</script>

<template>
  <div class="dd" data-testid="dca-depth">
    <Skeleton v-if="loading" shape="row" :count="4" />
    <template v-else-if="summary.rows.length > 0 || summary.unknownDepth">
      <p
        v-if="
          summary.deep &&
          summary.deep.deep.winrate !== null &&
          summary.deep.shallow.winrate !== null
        "
        class="sent"
        data-testid="depth-sentence"
      >
        {{
          t('fq.jr.depth.sentence', {
            from: summary.deep.from,
            n: summary.deep.deep.trades,
            deepWin: pctOf(summary.deep.deep.winrate),
            shallowWin: pctOf(summary.deep.shallow.winrate),
          })
        }}
        <b :class="summary.deep.deep.pnl < 0 ? 'down' : 'up'">{{
          fmt.signed(summary.deep.deep.pnl, 2)
        }}</b>
        USDC.
      </p>
      <p v-else class="sent">{{ t('fq.jr.depth.intro') }}</p>
      <p v-if="noDepth" class="note" data-testid="depth-missing">{{ t(missingKey) }}</p>
      <table class="dtab">
        <thead>
          <tr>
            <th class="l">{{ t('fq.jr.depth.filled') }}</th>
            <th>{{ t('fq.jr.trades') }}</th>
            <th>{{ t('fq.jr.winrate') }}</th>
            <th>{{ t('fq.col.pnl_abs') }}</th>
            <th class="barc">
              <span class="sr">{{ t('fq.jr.bar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in summary.rows"
            :key="r.depth ?? 'n'"
            :class="{ deep: (r.depth ?? 0) >= DCA_WARN_FROM }"
          >
            <td class="l" :class="{ warn: (r.depth ?? 0) >= DCA_WARN_FROM }">{{ r.depth }}</td>
            <td>{{ r.trades }}</td>
            <td :class="{ warn: r.winrate !== null && r.winrate < 0.6 }">
              <ValueState v-if="r.winrate === null" v-bind="noSample" /><template v-else>{{
                pctOf(r.winrate)
              }}</template>
            </td>
            <td><PnlValue :value="r.pnl" :decimals="2" /></td>
            <td class="barc">
              <span
                class="hb"
                :class="r.pnl >= 0 ? 'p' : 'n'"
                :style="{ width: widthOf(r) }"
              ></span>
            </td>
          </tr>
          <tr v-if="summary.unknownDepth" class="unk">
            <td class="l">{{ t('fq.jr.depth.unknown') }}</td>
            <td>{{ summary.unknownDepth.trades }}</td>
            <td>
              <ValueState v-if="summary.unknownDepth.winrate === null" v-bind="noSample" />
              <template v-else>{{ pctOf(summary.unknownDepth.winrate) }}</template>
            </td>
            <td><PnlValue :value="summary.unknownDepth.pnl" :decimals="2" /></td>
            <td class="barc"></td>
          </tr>
        </tbody>
      </table>
      <p v-if="summary.unknownProfit > 0" class="note" data-testid="depth-unknown-profit">
        {{ t('fq.jr.unknownExcluded', { n: summary.unknownProfit }, summary.unknownProfit) }}
      </p>
      <p v-if="partial" class="note">{{ t('fq.jr.partial', { n: rows.length }) }}</p>
    </template>
    <EmptyState v-else icon="layers" :title="t('fq.jr.empty')" :hint="t('fq.jr.emptyHint')" />
  </div>
</template>

<style scoped>
.dd {
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
.sent b.down {
  color: var(--loss);
}
.sent b.up {
  color: var(--profit);
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
td.warn {
  color: var(--warn);
}
tr.unk td {
  color: var(--fg-3);
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
