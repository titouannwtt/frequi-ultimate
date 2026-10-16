<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { DirectionChip, EmptyState, IconBtn, Menu, ModeMark, PnlValue } from '@/components/ds';
import type { MenuItem } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useValueSlot } from '@/composables/useValueSlot';

import { isLongerThanUsual, liqWord, safetyOrders, safetyOrdersMax } from './lib/fleetPage';
import { pairLabel, type TradeLine } from './lib/trades';
import { lineSlot } from './lib/valueState';

/**
 * "Positions to watch" (docs/redesign/05-friendly-plan.md, L4): the few positions that do the
 * worst, each with its facts told in words (safety orders, how far the liquidation is, how long it
 * has been open) instead of eleven columns. No exit button on the row: a click opens the position,
 * where "Exit..." and its confirmation live. The list is given, so the page decides which ones.
 */
const props = defineProps<{
  lines: readonly TradeLine[];
  /** Maximum number of entries of a bot, when known ("2 of 4"). */
  dcaMax?: (botKey: string) => number | undefined;
}>();

const emit = defineEmits<{
  open: [botKey: string, tradeId: number];
  openBot: [botKey: string];
  chart: [line: TradeLine];
}>();

const { t } = useI18n();
const fmt = useFormat();
const { vs } = useValueSlot();

const menuOpen = ref(false);
const menuAnchor = ref<HTMLElement | null>(null);
const menuLine = ref<TradeLine | null>(null);
function items(l: TradeLine): MenuItem[] {
  return [
    { id: 'trade', label: t('fq.pg.fleet.watch.openTrade') },
    ...(l.orphan ? [] : [{ id: 'bot', label: t('fq.pg.fleet.watch.openBot') }]),
    { id: 'chart', label: t('fq.pg.fleet.watch.openChart') },
  ];
}
function openMenu(e: MouseEvent, l: TradeLine) {
  const anchor = e.currentTarget as HTMLElement;
  if (menuOpen.value && menuLine.value?.key === l.key) {
    menuOpen.value = false;
    return;
  }
  menuAnchor.value = anchor;
  menuLine.value = l;
  menuOpen.value = true;
}
function onSelect(id: string) {
  const l = menuLine.value;
  if (!l) return;
  if (id === 'trade') emit('open', l.botKey, l.tradeId);
  else if (id === 'bot') emit('openBot', l.botKey);
  else if (id === 'chart') emit('chart', l);
}

function renforts(l: TradeLine): string {
  const n = safetyOrders(l);
  if (n === 0) return t('fq.pg.fleet.watch.dcaNone');
  const max = props.dcaMax?.(l.botKey);
  const cap = safetyOrdersMax({ dcaMax: max ?? l.dcaMax });
  return cap === null ? String(n) : t('fq.pg.fleet.watch.dcaOf', { n, max: cap });
}
function liquidation(l: TradeLine): { text: string; word: string } | null {
  const w = liqWord(l.liqDistancePct);
  if (!w) return null;
  const key = w === 'far' ? 'liqFar' : w === 'watch' ? 'liqWatch' : 'liqNear';
  return {
    word: w,
    text: t(`fq.pg.fleet.watch.${key}`, { v: fmt.number(l.liqDistancePct as number, 0) }),
  };
}
const slotOf = (l: TradeLine, v: number | null, reason: 'prices' | 'noData' = 'prices') =>
  vs(lineSlot(l, v, reason));
</script>

<template>
  <ul v-if="lines.length > 0" class="wl" data-testid="watch-list">
    <li
      v-for="l in lines"
      :key="l.key"
      class="row"
      :class="{ stale: l.stale, orphan: l.orphan }"
      :data-trade-key="l.key"
      tabindex="0"
      @click="emit('open', l.botKey, l.tradeId)"
      @keydown.enter.self.prevent="emit('open', l.botKey, l.tradeId)"
    >
      <div class="p">
        <b class="pair">{{ pairLabel(l.pair) }}</b>
        <DirectionChip :side="l.side" :leverage="l.leverage" />
        <div class="who">
          <template v-if="l.orphan">{{ t('fq.pg.fleet.watch.orphan') }}</template>
          <template v-else>
            <ModeMark v-if="l.mode && l.mode !== 'live'" :mode="l.mode" /> {{ l.botName }}
          </template>
        </div>
      </div>
      <div class="pl">
        <PnlValue :value="l.pnlAbs" :muted="l.stale" v-bind="slotOf(l, l.pnlAbs)" />
        <small>
          <PnlValue :value="l.pnlPct" unit="%" :muted="l.stale" v-bind="slotOf(l, l.pnlPct)" />
        </small>
      </div>
      <div class="facts">
        <span
          >{{ t('fq.pg.fleet.watch.dca') }} <b>{{ renforts(l) }}</b></span
        >
        <span v-if="liquidation(l)"
          >{{ t('fq.pg.fleet.watch.liq') }}
          <b :class="liquidation(l)!.word">{{ liquidation(l)!.text }}</b></span
        >
        <span v-if="l.durationMs > 0"
          >{{ t('fq.pg.fleet.watch.open') }}
          <b :class="{ warn: isLongerThanUsual(l) }"
            >{{ fmt.duration(l.durationMs / 3_600_000)
            }}<template v-if="isLongerThanUsual(l)"
              >, {{ t('fq.pg.fleet.watch.long') }}</template
            ></b
          ></span
        >
      </div>
      <IconBtn
        class="more"
        icon="ellipsis"
        size="sm"
        :label="t('fq.pg.fleet.watch.more', { pair: pairLabel(l.pair) })"
        @click.stop="openMenu($event, l)"
      />
    </li>
  </ul>
  <EmptyState
    v-else
    icon="layers"
    :title="t('fq.pg.fleet.watch.empty')"
    :hint="t('fq.pg.fleet.watch.emptyHint')"
  />
  <Menu
    :open="menuOpen"
    :anchor="menuAnchor"
    :items="menuLine ? items(menuLine) : []"
    :label="t('fq.pg.fleet.watch.title')"
    @select="onSelect"
    @close="menuOpen = false"
  />
</template>

<style scoped>
.wl {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0 var(--s4);
  list-style: none;
}
.row {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) 96px minmax(0, 3fr) auto;
  gap: var(--s3) 14px;
  align-items: center;
  padding: var(--s3) 0;
  border-bottom: 1px solid var(--row-line);
  cursor: pointer;
}
.row:last-child {
  border-bottom: 0;
}
.row:hover {
  background: color-mix(in srgb, var(--bg-2) 60%, transparent);
}
.row.orphan {
  background: var(--crit-w);
}
.p {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 8px;
  min-width: 0;
}
.pair {
  font-size: var(--t-lg);
}
.who {
  flex: 1 0 100%;
  color: var(--fg-3);
  font-size: var(--t-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pl {
  display: grid;
  font: 600 var(--t-lg) var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
  text-align: right;
}
.pl small {
  font-size: var(--t-xs);
  font-weight: 500;
}
.facts {
  display: flex;
  gap: 4px 18px;
  flex-wrap: wrap;
  color: var(--fg-2);
  font-size: var(--t-sm);
}
.facts b {
  color: var(--fg);
  font-weight: 500;
}
.facts b.warn,
.facts b.watch {
  color: var(--warn);
}
.facts b.near {
  color: var(--crit);
}
@container (max-width: 640px) {
  .wl {
    padding: 0 var(--s3);
  }
  .row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .facts {
    grid-column: 1 / -1;
    order: 3;
  }
  .more {
    display: none;
  }
}
</style>
