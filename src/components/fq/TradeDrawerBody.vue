<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { Badge, Btn, DirectionChip, DsIcon, ModeMark, PnlValue, ValueState } from '@/components/ds';
import type { DsIconRef, LadderOrder } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useValueSlot } from '@/composables/useValueSlot';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import type { Position } from '@/gateway/types.gen';

import { useBotActions } from './lib/useBotActions';
import { refillRank } from './lib/orders';
import { durationTone, lineFromPosition, pairLabel } from './lib/trades';
import { lineSlot, PENDING, READY, unavailable, type Slot } from './lib/valueState';

/**
 * Body of the trade drawer (02 section 3.2, 05 section 2.4): the target bot, the P&L, three
 * sentences (target exit, next top-up, liquidation, each with its distance in percent), the
 * top-up bar (used out of planned, committed out of maximum: it is the risk information, always
 * visible), then folded: the details (notional, stake, orders) and the maintenance of the trade in
 * the bot's database, apart.
 */
const props = defineProps<{
  position: Position;
  /** Take profit and next safety order prices, when the bot says them. */
  tp?: number | null;
  nextSo?: number | null;
  dcaMax?: number | null;
  orders?: LadderOrder[];
  /** The orders are being read: say so instead of "not available". */
  ordersLoading?: boolean;
  /** The sheet already carries the pair and the trade number in its title: do not say them twice. */
  hideTitle?: boolean;
}>();

const { t } = useI18n();
const fmt = useFormat();
const { vs, reason: reasonOf } = useValueSlot();
const fleet = useFqFleetStore();

const line = computed(() =>
  lineFromPosition(props.position, fleet.bots[props.position.bot_key], { dcaMax: props.dcaMax }),
);
const acts = useBotActions(
  () => props.position.bot_key,
  () => props.position,
);

const tone = computed(() => durationTone(line.value.percentile));
// A bot name wraps after an underscore or a dash, never in the middle of a word
const nameParts = computed(() => line.value.botName.split(/(?<=[_\-.])/));

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
// The next safety order is the first ladder level that is not filled yet, when the ladder knows it
const nextSoPrice = computed(
  () => props.nextSo ?? props.orders?.find((o) => o.state === 'next')?.price ?? null,
);
const toSo = computed(() => toward(nextSoPrice.value, true));

// A sentence the bot can say is a figure; the others say why they are not (take profit and the
// maximum of entries have no API; the orders are read after the position, so the next safety order
// waits)
const noPrice = computed<Slot>(() => lineSlot(line.value, props.position.current_rate, 'prices'));
const long = computed(() => props.position.side === 'long');

interface Sentence {
  k: 'target' | 'refill' | 'liq';
  icon: DsIconRef;
  slot: Slot;
  /** The bold line (with the price when it is known). */
  title: string;
  /** The line under it: the distance, in words. */
  detail: string;
  tone?: 'warn' | 'crit';
}

/**
 * A level the drawer cannot give says it in words, under its title: an icon alone (the reason only
 * in its tooltip) read as a broken line. The bot that does not announce the level and the orders
 * that say nothing of it are one short phrase; the other reasons (prices, offline) keep theirs.
 */
function missingText(slot: Slot): string {
  if (slot.state !== 'unavailable') return '';
  if (slot.reason === 'noApi' || slot.reason === 'noData')
    return t('fq.drawer.sentence.notProvided');
  return reasonOf(slot) ?? t('fq.drawer.sentence.notProvided');
}

/** "2,7 %": a distance, always positive in the sentence (the verb says the direction). */
const pct = (v: number, decimals = 1) => fmt.percent(Math.abs(v), decimals, false);
const sx = (k: string, p: Record<string, string | number> = {}) => t(`fq.drawer.sentence.${k}`, p);

const sentences = computed<Sentence[]>(() => {
  const levelSlot = (known: boolean, missing: Slot): Slot =>
    noPrice.value.state !== 'ready' ? noPrice.value : known ? READY : missing;

  // Take profit: above a long, below a short
  const tp = props.tp;
  const toT = toTp.value;
  const target: Sentence = {
    k: 'target',
    icon: long.value ? 'arrow-up' : 'arrow-down',
    slot: levelSlot(toT !== null && tp != null, unavailable('noApi')),
    title: tp != null ? sx('targetAt', { price: fmt.price(tp) }) : sx('target'),
    detail:
      toT === null
        ? ''
        : toT > 0
          ? sx(long.value ? 'targetUp' : 'targetDown', { pct: pct(toT, 2) })
          : sx('targetPassed'),
  };

  // Next safety order: below a long, above a short
  const so = nextSoPrice.value;
  const toS = toSo.value;
  const refill: Sentence = {
    k: 'refill',
    icon: 'plus',
    slot: levelSlot(
      toS !== null && so !== null,
      props.ordersLoading ? PENDING : unavailable('noData'),
    ),
    title: so !== null ? sx('refillAt', { price: fmt.price(so) }) : sx('refill'),
    detail:
      toS === null
        ? ''
        : toS > 0
          ? sx(long.value ? 'refillDown' : 'refillUp', { pct: pct(toS, 1) })
          : sx('refillPassed'),
  };

  // Liquidation: below a long, above a short
  const toL = props.position.liq_distance_pct;
  const liqPrice = props.position.liquidation_price;
  const near = toL != null && toL < 15;
  const watch = toL != null && toL >= 15 && toL < 30;
  const liq: Sentence = {
    k: 'liq',
    icon: 'triangle-alert',
    slot: lineSlot(line.value, toL, props.position.current_rate === null ? 'prices' : 'noData'),
    title: toL == null ? sx('liq') : sx(near ? 'liqNear' : watch ? 'liqWatch' : 'liqFar'),
    detail:
      toL == null
        ? ''
        : liqPrice != null
          ? sx(long.value ? 'liqBelow' : 'liqAbove', {
              price: fmt.price(liqPrice),
              pct: pct(toL, 1),
            })
          : sx('liqPct', { pct: pct(toL, 1) }),
    tone: near ? 'crit' : watch ? 'warn' : undefined,
  };
  return [target, refill, liq];
});

// The DCA count is read from the bot (entry included); the top-ups are the entries after the first
const used = computed(() => Math.max(0, props.position.dca_entries - 1));
const refills = computed(() => {
  const list = props.orders ?? [];
  // "Out of N" is only said when the ladder shows levels still to come: a list of filled orders
  // alone says what happened, not what the bot may still add
  const planned = list.some((o) => o.state !== 'filled');
  const max = planned && list.length > 1 ? list.length - 1 : null;
  const stake = (o: LadderOrder) => (Number.isFinite(o.stake) ? o.stake : 0);
  const committed = list.filter((o) => o.state === 'filled').reduce((a, o) => a + stake(o), 0);
  const total = list.reduce((a, o) => a + stake(o), 0);
  return {
    title:
      max !== null
        ? t('fq.drawer.refills', { used: used.value, max })
        : t('fq.drawer.refillsOnly', { used: used.value }),
    bar: max !== null,
    committed: list.length > 0 ? t('fq.drawer.committed', { v: fmt.number(committed, 2) }) : '',
    upTo:
      list.length > 0 && total > committed ? t('fq.drawer.upTo', { v: fmt.number(total, 2) }) : '',
  };
});

/** Notional and stake: kept under "Details", the sentences carry the decisions. */
const facts = computed<Array<{ k: string; v: string }>>(() => [
  { k: 'notional', v: fmt.number(props.position.notional, 2) },
  { k: 'stake', v: fmt.number(props.position.stake_amount, 2) },
]);

/** "E" is the entry, "SO2" the second top-up: the words, not the identifiers of the ladder. */
function orderName(label: string): string {
  const rank = refillRank(label);
  if (rank !== null) return t('fq.drawer.refillN', { n: rank });
  return label === 'E' ? t('fq.drawer.entryName') : label;
}

const ordersSummary = computed(() => {
  const list = props.orders ?? [];
  const filled = list.filter((o) => o.state === 'filled').length;
  // Two counts, two nouns: each carries its own plural ("1 rempli, 0 en attente", B237)
  return `${t('fq.drawer.ordersFilled', { n: filled }, filled)}, ${t('fq.drawer.ordersPending', { n: list.length - filled })}`;
});
</script>

<template>
  <div class="body" :class="{ stale: position.freshness.stale }" data-testid="trade-drawer-body">
    <section class="head">
      <div class="h1">
        <b v-if="!hideTitle" class="pair">{{ pairLabel(position.pair) }}</b>
        <DirectionChip :side="position.side" :leverage="position.leverage" />
        <Badge v-if="line.xyz" kind="neutral" :label="t('fq.drawer.marketHip3')" />
        <Badge v-if="position.orphan" kind="orphan" />
        <span v-if="!hideTitle" class="tid num">#{{ position.trade_id }}</span>
      </div>
      <div v-if="!position.orphan" class="target" data-testid="drawer-target">
        <span class="k">{{ t('fq.action.targetBot') }}</span>
        <span class="nm" :title="line.botName"
          ><template v-for="(part, i) in nameParts" :key="i">{{ part }}<wbr /></template
        ></span>
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
          :muted="position.freshness.stale"
          unit="USDC"
          v-bind="vs(lineSlot(line, position.profit_abs))"
        />
      </span>
      <span class="pct">
        <PnlValue
          :value="position.profit_ratio === null ? null : position.profit_ratio * 100"
          unit="%"
          :muted="position.freshness.stale"
          v-bind="vs(lineSlot(line, position.profit_ratio))"
        />
      </span>
      <span class="dur num">
        {{ t('fq.drawer.openSince', { d: fmt.duration(position.duration_ms / 3_600_000) }) }}
        <!-- "long", not "P98": the percentile is a statistic, only in the tooltip -->
        <span
          v-if="position.percentile !== null && tone !== 'ok'"
          class="long"
          :class="tone"
          data-testid="drawer-long"
          :title="t('fq.drawer.durHint', { p: Math.round(position.percentile) })"
          >{{ t(`fq.drawer.dur.${tone}`) }}</span
        >
      </span>
    </section>

    <section class="plain" :aria-label="t('fq.drawer.facts')" data-testid="drawer-sentences">
      <div v-for="r in sentences" :key="r.k" class="f" :class="r.tone" :data-sentence="r.k">
        <span class="ic"><DsIcon :name="r.icon" :size="15" /></span>
        <div class="tx">
          <b>{{ r.title }}</b>
          <span v-if="r.slot.state === 'ready'" class="sub">{{ r.detail }}</span>
          <span v-else class="sub" :class="{ na: r.slot.state === 'unavailable' }"
            ><ValueState
              v-bind="vs(r.slot, `drawer/${position.bot_key}/${position.trade_id}/${r.k}`)"
            /><span
              v-if="r.slot.state === 'unavailable'"
              class="na-t"
              data-testid="drawer-missing"
              >{{ missingText(r.slot) }}</span
            ></span
          >
        </div>
      </div>
    </section>

    <section class="refills" data-testid="drawer-refills">
      <p class="rt">{{ refills.title }}</p>
      <div v-if="refills.bar" class="rail" role="img" :aria-label="refills.title">
        <i
          v-for="o in orders"
          :key="o.id"
          :class="{ f: o.state === 'filled', n: o.state === 'next' }"
          :title="`${orderName(o.label)} ${fmt.price(o.price)}`"
        ></i>
      </div>
      <p v-if="ordersLoading && !orders?.length" class="dim">
        <ValueState state="pending" announce />
      </p>
      <p v-if="refills.committed" class="cap num">
        <span>{{ refills.committed }}</span>
        <span v-if="refills.upTo">{{ refills.upTo }}</span>
      </p>
    </section>

    <details class="orders" data-testid="drawer-details">
      <summary>{{ t('fq.drawer.details') }}</summary>
      <dl class="dl">
        <template v-for="f in facts" :key="f.k">
          <dt>{{ t(`fq.drawer.fact.${f.k}`) }}</dt>
          <dd class="num">{{ f.v }}</dd>
        </template>
        <dt>{{ t('fq.drawer.fact.dca') }}</dt>
        <dd class="num">{{ position.dca_entries }}</dd>
      </dl>
      <p v-if="!orders || orders.length === 0" class="dim pad">
        {{ t('fq.drawer.ordersUnavailable', { n: position.dca_entries }, position.dca_entries) }}
      </p>
      <template v-else>
        <p class="dim pad">{{ ordersSummary }}</p>
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
              <td class="l">{{ orderName(o.label) }}</td>
              <td>{{ fmt.price(o.price) }}</td>
              <td>{{ fmt.number(o.stake, 2) }}</td>
              <td>{{ t(`fq.drawer.orderState.${o.state}`) }}</td>
            </tr>
          </tbody>
        </table>
      </template>
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
  min-width: 0;
  overflow-wrap: break-word;
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
.big :deep(small) {
  font-size: var(--t-sm);
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
.plain {
  display: grid;
  gap: var(--s3);
}
.f {
  display: flex;
  gap: var(--s3);
  align-items: flex-start;
}
.f .ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg-2);
  color: var(--fg-2);
}
.f.warn .ic {
  background: var(--warn-w);
  color: var(--warn);
}
.f.crit .ic {
  background: var(--crit-w);
  color: var(--crit);
}
.f.crit b {
  color: var(--crit);
}
.tx {
  display: grid;
  gap: 1px;
  min-width: 0;
  font-size: var(--t-md);
}
.tx b {
  font-weight: 600;
}
.sub {
  color: var(--fg-2);
  font-size: var(--t-sm);
  overflow-wrap: anywhere;
}
.sub.na {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-3);
}
.long {
  font-weight: 600;
  font-size: var(--t-xs);
}
.long.warn {
  color: var(--warn);
}
.long.crit {
  color: var(--crit);
}
.refills {
  display: grid;
  gap: 6px;
}
.rt {
  margin: 0;
  color: var(--fg-2);
  font-size: var(--t-sm);
}
.rail {
  display: flex;
  gap: 3px;
}
.rail i {
  flex: 1 1 0;
  height: 8px;
  border-radius: 4px;
  background: var(--bg-3);
}
.rail i.n {
  box-shadow: inset 0 0 0 1px var(--fg-3);
  background: none;
}
.rail i.f {
  background: var(--accent);
}
.cap {
  display: flex;
  justify-content: space-between;
  gap: var(--s3);
  flex-wrap: wrap;
  margin: 0;
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px var(--s4);
  margin: 0;
  padding: var(--s2) var(--s3);
  font-size: var(--t-sm);
}
.dl dt {
  color: var(--fg-3);
}
.dl dd {
  margin: 0;
  text-align: right;
  font-weight: 600;
}
.pad {
  padding: 0 var(--s3) var(--s2);
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
  font: var(--th-weight) var(--t-xs) var(--font-ui);
  text-transform: var(--th-case);
  letter-spacing: var(--th-track);
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
