<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { Badge, DcaLadderH, DcaPips, DirectionChip, ModeMark, PnlValue } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useInflightLock } from '@/composables/useInflightLock';
import { lockKeyOf } from '@/composables/useBotAction';
import type { Position } from '@/gateway/types.gen';

import BotActionBar from './BotActionBar.vue';
import type { ActionId } from './lib/actions';
import { buildAction } from './lib/actions';
import { durationTone, ladderOf, pairLabel, type TradeLine } from './lib/trades';

/**
 * A position as a card, for a phone, the ScopePanel and the charts (02 sections 2.5 and 5.2): the
 * four figures m1 to m4 (P&L, entry and price, liquidation, duration) and the horizontal DCA
 * ladder, normalised so the liquidation is always on the left and the take profit on the right.
 * A closed trade keeps the same frame without the ladder. A tap opens the TradeDrawer; the
 * actions are the same as in the table row (same confirmation, same lock).
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
const lock = useInflightLock();

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

const tone = computed(() => durationTone(props.line.percentile));
const hours = computed(() => props.line.durationMs / 3_600_000);
const exitLabel = computed(() =>
  props.line.exitReason ? t(`fq.exit.${props.line.exitReason.kind}`) : t('fq.origin.unknown'),
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
        <Badge v-if="line.xyz" kind="xyz" />
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
        v-if="line.open"
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
          <PnlValue
            :value="line.pnlAbs"
            :unknown="line.profitUnknown"
            :muted="line.stale"
            unit="USDC"
          />
        </span>
        <span class="sub">
          <PnlValue v-if="line.pnlPct !== null" :value="line.pnlPct" unit="%" :muted="line.stale" />
        </span>
      </div>
      <div class="m2">
        <span class="k">{{ line.open ? t('fq.col.entry') : t('fq.col.exit_price') }}</span>
        <span class="v num">{{ fmt.price(line.entry) }}</span>
        <span class="sub num">
          {{
            line.open
              ? line.current === null
                ? t('fq.ds.notAvailable')
                : fmt.price(line.current)
              : line.exitPrice === null
                ? t('fq.ds.notAvailable')
                : fmt.price(line.exitPrice)
          }}
        </span>
      </div>
      <div class="m3">
        <template v-if="line.open">
          <span class="k">{{ t('fq.col.liq_distance') }}</span>
          <span
            class="v num"
            :class="{ crit: line.liqDistancePct !== null && line.liqDistancePct < 15 }"
          >
            {{
              line.liqDistancePct === null
                ? t('fq.ds.notAvailable')
                : fmt.percent(line.liqDistancePct, 0, false)
            }}
          </span>
          <span class="sub"
            ><DcaPips :filled="line.dcaFilled" :max="line.dcaMax ?? line.dcaFilled" show-count
          /></span>
        </template>
        <template v-else>
          <span class="k">{{ t('fq.col.exit_reason') }}</span>
          <span class="v">{{ exitLabel }}</span>
        </template>
      </div>
      <div class="m4">
        <span class="k">{{ t('fq.col.duration') }}</span>
        <span class="v num">{{ fmt.duration(hours) }}</span>
        <span v-if="line.percentile !== null && tone !== 'ok'" class="sub">
          <Badge
            :kind="tone === 'crit' ? 'crit' : 'warn'"
            :label="`p${Math.round(line.percentile)}`"
          />
        </span>
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
.sub {
  font: 500 var(--t-xs) var(--font-num);
  color: var(--fg-3);
  min-height: 15px;
}
</style>
