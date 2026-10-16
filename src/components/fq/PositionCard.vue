<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  Badge,
  DcaLadderH,
  DcaPips,
  DirectionChip,
  ModeMark,
  PnlValue,
  ValueState,
} from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useInflightLock } from '@/composables/useInflightLock';
import { lockKeyOf } from '@/composables/useBotAction';
import { useValueSlot } from '@/composables/useValueSlot';
import type { Position } from '@/gateway/types.gen';

import BotActionBar from './BotActionBar.vue';
import type { ActionId } from './lib/actions';
import { buildAction } from './lib/actions';
import { durationNote, ladderOf, pairLabel, type TradeLine } from './lib/trades';
import { lineSlot } from './lib/valueState';

/**
 * A position as a card, for a phone, the ScopePanel and the charts (02 sections 2.5 and 5.2): the
 * four figures m1 to m4 (P&L, entry and price, liquidation, duration) and the horizontal DCA
 * ladder, normalised so the liquidation is always on the left and the take profit on the right.
 * A closed trade keeps the same frame without the ladder. A tap opens the TradeDrawer; the
 * actions are the same as in the table row (same confirmation, same lock). On a phone the card has
 * no exit button of its own (seven red-zone buttons while scrolling): a tap opens the drawer, which
 * holds "Exit..." with its confirmation.
 */
const props = withDefaults(
  defineProps<{
    line: TradeLine;
    /** Take profit when the bot says it; without it the ladder draws no TP marker. */
    tp?: number | null;
    selected?: boolean;
    /** The registry position, for the action targeting (open positions). */
    position?: Position | null;
  }>(),
  { tp: null, selected: false, position: null },
);

const emit = defineEmits<{
  activate: [line: TradeLine];
  navigate: [id: ActionId, line: TradeLine];
  openMenu: [anchor: HTMLElement, line: TradeLine];
  openBot: [botKey: string];
}>();

const { t } = useI18n();
const fmt = useFormat();
const phone = useMediaQuery('(max-width: 599px)');
const lock = useInflightLock();
const { vs } = useValueSlot();

const ladder = computed(() => {
  if (!props.line.open) return null;
  const l = ladderOf(props.line, props.tp);
  if (!l) return null;
  return {
    ...l,
    liqText:
      props.line.liqDistancePct == null
        ? undefined
        : t('fq.trade.liqShort', { n: Math.round(props.line.liqDistancePct) }),
  };
});

const busy = computed(() => {
  const a = props.position ? buildAction('exit', { position: props.position }) : null;
  return a ? lock.isLocked(lockKeyOf(props.line.botKey, a)) : false;
});

const hours = computed(() => props.line.durationMs / 3_600_000);
const exitLabel = computed(() =>
  props.line.exitReason && props.line.exitReason.kind !== 'unknown'
    ? t(`fq.exit.${props.line.exitReason.kind}`)
    : '',
);
const pnlSlot = computed(() =>
  vs(lineSlot(props.line, props.line.pnlAbs, props.line.open ? 'prices' : 'profit')),
);
const pctSlot = computed(() =>
  vs(lineSlot(props.line, props.line.pnlPct, props.line.open ? 'prices' : 'profit')),
);
const priceSlot = computed(() =>
  vs(lineSlot(props.line, props.line.open ? props.line.current : props.line.exitPrice)),
);
const liqSlot = computed(() =>
  vs(
    lineSlot(
      props.line,
      props.line.liqDistancePct,
      props.line.current === null ? 'prices' : 'noData',
    ),
  ),
);
</script>

<template>
  <article
    class="card"
    :class="{ orphan: line.orphan, sel: selected, stale: line.stale, closed: !line.open }"
    :aria-busy="busy || undefined"
    :data-trade-key="line.key"
    tabindex="0"
    @click="emit('activate', line)"
    @keydown.enter.self.prevent="emit('activate', line)"
  >
    <header class="hd">
      <div class="id">
        <b class="pair">{{ pairLabel(line.pair) }}</b>
        <Badge
          v-if="line.xyz && line.open"
          kind="xyz"
          :label="t('fq.trade.marketHip3')"
          class="mkt"
        />
        <Badge v-if="line.orphan" kind="orphan" />
        <Badge v-if="line.manual" kind="manual" />
        <DirectionChip :side="line.side" :leverage="line.leverage" />
      </div>
      <div class="who">
        <template v-if="line.orphan">{{ t('fq.trade.noBot') }}</template>
        <button v-else type="button" class="bot" @click.stop="emit('openBot', line.botKey)">
          <ModeMark v-if="line.mode" :mode="line.mode" />
          {{ line.botName }}
        </button>
      </div>
      <BotActionBar
        v-if="line.open && !phone"
        class="acts"
        context="row"
        :bot-key="line.botKey"
        :position="position"
        @navigate="(id) => emit('navigate', id, line)"
        @open-menu="(a) => emit('openMenu', a, line)"
      />
    </header>

    <div class="m">
      <div class="m1">
        <span class="k">{{ t('fq.col.pnl_abs') }}</span>
        <span class="v big">
          <PnlValue :value="line.pnlAbs" :muted="line.stale" unit="USDC" v-bind="pnlSlot" />
        </span>
        <span class="sub">
          <PnlValue :value="line.pnlPct" unit="%" :muted="line.stale" v-bind="pctSlot" />
        </span>
      </div>
      <div class="m2">
        <span class="k">{{ t('fq.col.entry') }}</span>
        <span class="v num">{{ fmt.price(line.entry) }}</span>
        <span class="sub num" :title="line.open ? t('fq.trade.priceNow') : t('fq.trade.priceExit')">
          <span class="sl">{{ line.open ? t('fq.col.current') : t('fq.col.exit_price') }}</span>
          <ValueState v-bind="priceSlot">{{
            fmt.price((line.open ? line.current : line.exitPrice) as number)
          }}</ValueState>
        </span>
      </div>
      <div class="m3">
        <template v-if="line.open">
          <span class="k">{{ t('fq.col.liq_distance') }}</span>
          <span
            class="v num"
            :class="{ crit: line.liqDistancePct !== null && line.liqDistancePct < 15 }"
          >
            <ValueState v-bind="liqSlot">{{
              fmt.percent(line.liqDistancePct as number, 0, false)
            }}</ValueState>
          </span>
          <span class="sub" data-testid="card-orders"
            ><span class="sl">{{ t('fq.trade.ordersShort') }}</span>
            <DcaPips :filled="line.dcaFilled" :max="line.dcaMax ?? line.dcaFilled" show-count
          /></span>
        </template>
        <template v-else-if="exitLabel">
          <span class="k">{{ t('fq.col.exit_reason') }}</span>
          <span class="v">{{ exitLabel }}</span>
        </template>
      </div>
      <div class="m4">
        <span class="k">{{ t('fq.col.duration') }}</span>
        <span class="v num">{{ fmt.duration(hours) }}</span>
        <span
          v-if="durationNote(line.percentile)"
          class="sub dnote"
          :class="durationNote(line.percentile)!.tone"
          :title="t('fq.trade.durHint', { p: durationNote(line.percentile)!.pct })"
          >{{ t(durationNote(line.percentile)!.key) }}</span
        >
      </div>
    </div>

    <DcaLadderH v-if="ladder" :position="ladder" />
  </article>
</template>

<style scoped>
.card {
  display: grid;
  gap: var(--s2);
  padding: var(--s3);
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  cursor: pointer;
}
.card.sel {
  border-color: var(--accent);
  background: var(--accent-w);
}
.card.orphan {
  background: var(--crit-w);
  border-color: color-mix(in srgb, var(--crit) 40%, var(--line));
}
.card.stale {
  background-image: var(--stale-hatch);
}
.card[aria-busy='true'] {
  opacity: 0.65;
}
.hd {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px var(--s2);
  align-items: center;
}
.id {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.pair {
  font-size: var(--t-lg);
}
.who {
  grid-column: 1 / -1;
  grid-row: 2;
  font-size: var(--t-xs);
  color: var(--fg-2);
}
.bot {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.bot:hover {
  color: var(--accent);
}
.acts {
  grid-column: 2;
  grid-row: 1;
  justify-self: end;
  justify-content: flex-end;
  min-width: max-content;
}
.m {
  display: grid;
  grid-template-columns: auto repeat(3, minmax(0, 1fr));
  gap: var(--s2);
}
@media (max-width: 420px) {
  .m {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.m > div {
  display: grid;
  gap: 1px;
  align-content: start;
  min-width: 0;
}
.k {
  font-size: var(--t-xs);
  color: var(--fg-3);
}
.v {
  font: 600 var(--t-md) var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
}
.v.big {
  font-size: var(--t-lg);
}
.v.crit {
  color: var(--crit);
}
.mkt.badge {
  text-transform: none;
  letter-spacing: 0;
}
.dnote.warn {
  color: var(--warn);
}
.dnote.crit {
  color: var(--crit);
}
.sub {
  font: 500 var(--t-xs) var(--font-num);
  color: var(--fg-3);
  min-height: 15px;
}
/* The word that says what the figure under a value is ("Prix", "Ordres") */
.sl {
  margin-right: 4px;
  font-family: var(--font-ui);
}
</style>
