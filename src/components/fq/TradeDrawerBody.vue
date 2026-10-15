<script setup lang="ts">
import { useWindowSize } from '@vueuse/core';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { Badge, Btn, DcaLadderV, DirectionChip, DsIcon, ModeMark, PnlValue } from '@/components/ds';
import type { LadderOrder } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import type { Position } from '@/gateway/types.gen';

import { useBotActions } from './lib/useBotActions';
import { durationTone, lineFromPosition, pairLabel } from './lib/trades';

/**
 * Body of the trade drawer (02 section 3.2): the target bot, the P&L, six facts, the DCA ladder
 * (always open, it is the risk information), the orders (folded under 900 px of height) and the
 * maintenance of the trade in the bot's database, folded and apart.
 */
const props = defineProps<{
  position: Position;
  /** Take profit and next safety order prices, when the bot says them. */
  tp?: number | null;
  nextSo?: number | null;
  dcaMax?: number | null;
  orders?: LadderOrder[];
}>();

const { t } = useI18n();
const fmt = useFormat();
const fleet = useFqFleetStore();
const { height } = useWindowSize();

const line = computed(() =>
  lineFromPosition(props.position, fleet.bots[props.position.bot_key], { dcaMax: props.dcaMax }),
);
const acts = useBotActions(
  () => props.position.bot_key,
  () => props.position,
);

const tone = computed(() => durationTone(line.value.percentile));
const max = computed(() => props.dcaMax ?? props.position.dca_entries);

/** Distance in percent of the price to a level, positive when the level is still ahead. */
function toward(level: number | null | undefined, towardLower: boolean): number | null {
  const cur = props.position.current_rate;
  if (level == null || cur == null || cur === 0) return null;
  const long = props.position.side === 'long';
  // A take profit is above a long and below a short; a safety order is the opposite
  const up = long !== towardLower;
  return ((up ? level - cur : cur - level) / cur) * 100;
}
const toTp = computed(() => toward(props.tp, false));
const toSo = computed(() => toward(props.nextSo, true));

const facts = computed(() => [
  { k: 'notional', v: fmt.number(props.position.notional, 2) },
  { k: 'stake', v: fmt.number(props.position.stake_amount, 2) },
  { k: 'dca', v: `${props.position.dca_entries}/${props.dcaMax ?? '?'}` },
  { k: 'toTp', v: toTp.value === null ? t('fq.ds.notAvailable') : fmt.percent(toTp.value, 2) },
  { k: 'toSo', v: toSo.value === null ? t('fq.ds.notAvailable') : fmt.percent(toSo.value, 2) },
  {
    k: 'toLiq',
    v:
      props.position.liq_distance_pct == null
        ? t('fq.ds.notAvailable')
        : fmt.percent(props.position.liq_distance_pct, 1, false),
    crit: props.position.liq_distance_pct != null && props.position.liq_distance_pct < 15,
  },
]);

const ladderPos = computed(() => ({
  price: props.position.current_rate ?? props.position.open_rate,
  avg: props.position.open_rate,
  tp: props.tp ?? undefined,
  liquidation: props.position.liquidation_price ?? undefined,
  liquidationDistancePct: props.position.liq_distance_pct ?? undefined,
}));

const ordersSummary = computed(() => {
  const list = props.orders ?? [];
  const filled = list.filter((o) => o.state === 'filled').length;
  return t('fq.drawer.ordersSummary', { filled, pending: list.length - filled });
});
/** Folded under 900 px of height: the ladder matters more than the order list. */
const ordersOpen = computed(() => height.value >= 900);
</script>

<template>
  <div class="body" :class="{ stale: position.freshness.stale }" data-testid="trade-drawer-body">
    <section class="head">
      <div class="h1">
        <b class="pair">{{ pairLabel(position.pair) }}</b>
        <DirectionChip :side="position.side" :leverage="position.leverage" />
        <Badge v-if="line.xyz" kind="xyz" />
        <Badge v-if="position.orphan" kind="orphan" />
        <span class="tid num">#{{ position.trade_id }}</span>
      </div>
      <div v-if="!position.orphan" class="target" data-testid="drawer-target">
        <span class="k">{{ t('fq.action.targetBot') }}</span>
        <span class="nm">{{ line.botName }}</span>
        <ModeMark v-if="line.mode" :mode="line.mode" full />
      </div>
      <p v-else class="orph">
        <DsIcon name="triangle-alert" :size="15" />
        {{ t('fq.drawer.orphan') }}
      </p>
    </section>

    <section class="pnl">
      <span class="big">
        <PnlValue
          :value="position.profit_abs"
          :unknown="position.profit_abs === null"
          :muted="position.freshness.stale"
          unit="USDC"
        />
      </span>
      <span v-if="position.profit_ratio !== null" class="pct">
        <PnlValue :value="position.profit_ratio * 100" unit="%" :muted="position.freshness.stale" />
      </span>
      <span class="dur num">
        {{ t('fq.drawer.openSince', { d: fmt.duration(position.duration_ms / 3_600_000) }) }}
        <Badge
          v-if="position.percentile !== null && tone !== 'ok'"
          :kind="tone === 'crit' ? 'crit' : 'warn'"
          :label="`p${Math.round(position.percentile)}`"
        />
      </span>
    </section>

    <section class="facts" :aria-label="t('fq.drawer.facts')">
      <div v-for="f in facts" :key="f.k" class="fact">
        <span class="k">{{ t(`fq.drawer.fact.${f.k}`) }}</span>
        <span class="v num" :class="{ crit: f.crit }">{{ f.v }}</span>
      </div>
    </section>

    <section class="ladder">
      <h3><DsIcon name="layers" /> {{ t('fq.ds.ladder.title') }}</h3>
      <DcaLadderV v-if="orders && orders.length > 0" :position="ladderPos" :orders="orders" />
      <p v-else class="dim">
        {{ t('fq.drawer.ordersUnavailable', { n: position.dca_entries, max }) }}
      </p>
    </section>

    <details v-if="orders && orders.length > 0" class="orders" :open="ordersOpen">
      <summary>
        {{ t('fq.drawer.orders') }} <span class="sum">{{ ordersSummary }}</span>
      </summary>
      <table>
        <thead>
          <tr>
            <th class="l">{{ t('fq.drawer.order') }}</th>
            <th>{{ t('fq.col.entry') }}</th>
            <th>{{ t('fq.col.stake') }}</th>
            <th>{{ t('fq.drawer.state') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in orders" :key="o.id">
            <td class="l">{{ o.label }}</td>
            <td>{{ fmt.price(o.price) }}</td>
            <td>{{ fmt.number(o.stake, 2) }}</td>
            <td>{{ t(`fq.drawer.orderState.${o.state}`) }}</td>
          </tr>
        </tbody>
      </table>
    </details>

    <details v-if="!position.orphan" class="maint">
      <summary><DsIcon name="database" :size="13" /> {{ t('fq.drawer.maintenance') }}</summary>
      <div class="m-body">
        <Btn
          size="sm"
          icon="x"
          :disabled="acts.disabled('cancelOrder')"
          :disabled-reason="acts.reasonText.value"
          :lock-key="acts.lockKey('cancelOrder')"
          @click="acts.trigger('cancelOrder')"
        >
          {{ t('fq.act.cancelOrder') }}
        </Btn>
        <Btn
          size="sm"
          icon="refresh-cw"
          :disabled="acts.disabled('reloadTrade')"
          :disabled-reason="acts.reasonText.value"
          :lock-key="acts.lockKey('reloadTrade')"
          @click="acts.trigger('reloadTrade')"
        >
          {{ t('fq.act.reloadTrade') }}
        </Btn>
        <hr />
        <Btn
          size="sm"
          variant="danger-outline"
          icon="database"
          :disabled="acts.disabled('deleteTrade')"
          :disabled-reason="acts.reasonText.value"
          :lock-key="acts.lockKey('deleteTrade')"
          @click="acts.trigger('deleteTrade')"
        >
          {{ t('fq.act.deleteTrade') }}
        </Btn>
        <p class="dim">{{ t('fq.drawer.deleteNote') }}</p>
      </div>
    </details>
  </div>
</template>

<style scoped>
.body {
  display: grid;
  gap: var(--s3);
  padding: var(--s3);
  align-content: start;
}
.body.stale {
  background-image: var(--stale-hatch);
}
.h1 {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.pair {
  font-size: var(--t-xl);
}
.tid {
  color: var(--fg-3);
  font-size: var(--t-sm);
}
.target {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding: 6px 10px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-2);
  background: var(--bg-2);
}
.k {
  font-size: var(--t-xs);
  color: var(--fg-3);
}
.nm {
  font-weight: 700;
  margin-right: auto;
  overflow-wrap: anywhere;
}
.orph {
  display: flex;
  gap: 8px;
  margin: 6px 0 0;
  padding: 8px 10px;
  border-radius: var(--r-2);
  background: var(--crit-w);
  color: var(--crit);
  font-size: var(--t-sm);
}
.pnl {
  display: flex;
  align-items: baseline;
  gap: var(--s3);
  flex-wrap: wrap;
}
.big {
  font: 700 var(--t-2xl) var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
}
.pct {
  font: 600 var(--t-lg) var(--font-num);
}
.dur {
  color: var(--fg-3);
  font-size: var(--t-sm);
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
}
.fact {
  display: grid;
  gap: 2px;
  padding: 7px var(--s3);
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.fact:nth-child(3n) {
  border-right: 0;
}
.fact:nth-last-child(-n + 3) {
  border-bottom: 0;
}
.v {
  font: 600 var(--t-md) var(--font-num);
}
.v.crit {
  color: var(--crit);
}
h3 {
  margin: 0 0 6px;
  font-size: var(--t-md);
  display: flex;
  align-items: center;
  gap: 6px;
}
.dim {
  color: var(--fg-3);
  font-size: var(--t-sm);
  margin: 0;
}
details {
  border: 1px solid var(--line);
  border-radius: var(--r-2);
}
summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 var(--s3);
  cursor: pointer;
  font-weight: 600;
  font-size: var(--t-sm);
}
.sum {
  margin-left: auto;
  color: var(--fg-3);
  font-weight: 400;
}
table {
  width: 100%;
  border-collapse: collapse;
  font: var(--t-sm) var(--font-num);
}
th,
td {
  padding: 5px var(--s3);
  text-align: right;
  border-top: 1px solid var(--line);
}
th {
  color: var(--fg-3);
  font: 600 var(--t-xs) var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
th.l,
td.l {
  text-align: left;
}
.m-body {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s2);
  padding: var(--s2) var(--s3) var(--s3);
}
.m-body hr {
  flex: 1 0 100%;
  border: 0;
  border-top: 1px dashed var(--line-2);
  margin: 4px 0;
}
.m-body .dim {
  flex: 1 0 100%;
}
</style>
