<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  AgeBadge,
  Badge,
  DirectionChip,
  DsIcon,
  EmptyState,
  Meter,
  PnlValue,
  Popover,
  Sparkline,
  StatusDot,
  ValueState,
} from '@/components/ds';
import type { MeterTone } from '@/components/ds';
import { formatAge } from '@/components/ds/lib/format';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import { virtualWindow, VIRTUAL_THRESHOLD } from '@/components/ds/lib/table';
import { useColumns } from '@/composables/useColumns';
import { useValueSlot } from '@/composables/useValueSlot';
import { DIGEST_STALE_MS } from '@/datasource/calc/freshness';
import { ruleMeta } from '@/datasource/calc/alerts/rules';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { ScopeRef } from '@/datasource/types';
import type { BotRow } from '@/gateway/types.gen';
import type { BotGroupPrefs } from '@/migration/schema';

import {
  botState,
  exposureSide,
  fleetExposure,
  groupBots,
  isStaleGroup,
  minutesSince,
  drawdownPct,
  stableOrder,
  sumBots,
  UNGROUPED_ID,
  type FleetSort,
  type StableOrderState,
} from './lib/bots';
import {
  aggregateSlot,
  botSlot,
  PENDING,
  READY,
  type Slot,
  type SlotReason,
} from './lib/valueState';

/**
 * The fleet as a table (docs/redesign/05-friendly-plan.md, L4): the user's groups with their
 * aggregates and a "N to see" badge, one row per bot, six columns by default and a "Columns" menu
 * for the others. A bot that is silent shows "frozen" instead of a number that looks alive. The
 * order is the
 * "attention first" one (critical, warning, info, then worst latent) and it only changes when an
 * alert appears or resolves: never at a tick, and not at all while the pointer or the focus is in
 * the table. Columns drop by the width of THIS panel (container width), not of the window.
 * Not virtualised up to 100 lines (a fleet of 40 to 50 bots), windowed above.
 */
const props = withDefaults(
  defineProps<{
    rows: BotRow[];
    groups?: BotGroupPrefs[];
    sort?: FleetSort;
    freezeOnHover?: boolean;
    selectedKey?: string | null;
    /** Frozen clock (previews, tests); otherwise the shared 1 s clock. */
    nowMs?: number;
    /** Container width override in px (previews, tests); otherwise measured. */
    containerWidth?: number;
    maxHeight?: string;
    /** Bots shown before "See the N others"; absent: every bot. Groups always show all. */
    limit?: number;
  }>(),
  {
    groups: () => [],
    sort: 'attention',
    freezeOnHover: true,
    selectedKey: null,
    maxHeight: 'min(70vh, 640px)',
  },
);

const emit = defineEmits<{
  selectBot: [botKey: string];
  selectScope: [scope: ScopeRef];
  toggleGroup: [id: string, collapsed: boolean];
  'update:sort': [sort: FleetSort];
}>();

const { t, te, locale } = useI18n();
const fmt = useFormat();
const clock = useNowMs();
const conn = useFqConnectionStore();
const fleet = useFqFleetStore();
const prefs = useFqPrefsStore();

const now = computed(() => props.nowMs ?? clock.value);
const { vs } = useValueSlot();
const skew = computed(() => conn.status.clockSkewMs);

// ---- width of this panel ----
const root = ref<HTMLElement | null>(null);
const measuredWidth = ref(0);
const measuredHeight = ref(0);
const rowPx = ref(30);
const scrollTop = ref(0);
let observer: ResizeObserver | undefined;
function measure() {
  const el = root.value;
  if (!el) return;
  measuredWidth.value = el.clientWidth;
  measuredHeight.value = el.clientHeight;
  const token = parseFloat(getComputedStyle(el).getPropertyValue('--row'));
  if (Number.isFinite(token) && token > 0) rowPx.value = token;
}
onMounted(() => {
  measure();
  if (typeof ResizeObserver !== 'undefined' && root.value) {
    observer = new ResizeObserver(measure);
    observer.observe(root.value);
  }
});
onBeforeUnmount(() => observer?.disconnect());
const width = computed(() => props.containerWidth ?? measuredWidth.value);

const columnState = useColumns('fleet', width);
/** Columns that this source can not provide are listed under the table, not drawn empty. */
const unavailableCols = computed(() => columnState.columns.value.filter((c) => c.unavailable));
const cols = computed(() => columnState.columns.value.filter((c) => !c.unavailable));

// ---- order: stable between ticks, frozen under the pointer ----
const hovered = ref(false);
const focused = ref(false);
const frozen = computed(() => props.freezeOnHover && (hovered.value || focused.value));
let prevOrder: StableOrderState | null = null;
const order = computed(() => {
  const next = stableOrder(props.rows, props.sort, prevOrder, frozen.value);
  prevOrder = next;
  return next;
});
const byKey = computed(() => new Map(props.rows.map((b) => [b.bot_key, b])));
const ordered = computed(() =>
  order.value.keys.map((k) => byKey.value.get(k)).filter((b): b is BotRow => !!b),
);

// ---- groups and flat list ----
const collapsedLocal = ref<Record<string, boolean>>({});
function isCollapsed(id: string, fallback: boolean): boolean {
  return collapsedLocal.value[id] ?? fallback;
}
function toggleGroup(id: string, current: boolean) {
  collapsedLocal.value = { ...collapsedLocal.value, [id]: !current };
  emit('toggleGroup', id, !current);
}

const groups = computed(() =>
  props.groups.length === 0 ? [] : groupBots(ordered.value, props.groups, t('fq.fleet.ungrouped')),
);

type Item =
  | { type: 'group'; key: string; group: ReturnType<typeof groupBots>[number]; collapsed: boolean }
  | { type: 'bot'; key: string; bot: BotRow };

// The list stops at `limit` bots until the reader asks for the others; groups always show theirs
const expanded = ref(false);
const shownBots = computed(() =>
  props.limit && !expanded.value ? ordered.value.slice(0, props.limit) : ordered.value,
);
const hiddenBots = computed(() =>
  groups.value.length > 0 ? 0 : ordered.value.length - shownBots.value.length,
);
const canShorten = computed(
  () =>
    !!props.limit &&
    expanded.value &&
    groups.value.length === 0 &&
    ordered.value.length > props.limit,
);

const items = computed<Item[]>(() => {
  if (groups.value.length === 0) {
    return shownBots.value.map((bot) => ({ type: 'bot' as const, key: bot.bot_key, bot }));
  }
  const out: Item[] = [];
  for (const g of groups.value) {
    const collapsed = isCollapsed(g.id, g.collapsed);
    out.push({ type: 'group', key: `g:${g.id}`, group: g, collapsed });
    if (!collapsed) {
      for (const bot of g.bots) out.push({ type: 'bot', key: bot.bot_key, bot });
    }
  }
  return out;
});

const isVirtual = computed(() => items.value.length > VIRTUAL_THRESHOLD);
const win = computed(() =>
  isVirtual.value
    ? virtualWindow({
        count: items.value.length,
        rowHeight: rowPx.value,
        scrollTop: scrollTop.value,
        viewHeight: measuredHeight.value || 400,
      })
    : { start: 0, end: items.value.length, padTop: 0, padBottom: 0 },
);
const shown = computed(() => items.value.slice(win.value.start, win.value.end));

// ---- aggregates ----
function sumsOf(bots: BotRow[]) {
  const n = now.value;
  const sk = skew.value;
  const sums = {
    latent: sumBots(bots, 'positions', (b) => b.metrics.open_profit_abs, n, sk),
    d1: sumBots(bots, 'metrics', (b) => b.metrics.realized_1d, n, sk),
    d30: sumBots(bots, 'metrics', (b) => b.metrics.realized_30d, n, sk),
    total: sumBots(bots, 'metrics', (b) => b.metrics.realized_total, n, sk),
    slots: bots.reduce((acc, b) => acc + b.state.open_trades, 0),
    exposure: fleetExposure(bots, fleet.wallets, n, sk),
  };
  const agg = (
    pick: (b: BotRow) => number | null | undefined,
    group: 'positions' | 'metrics',
    included: number,
    prices = false,
  ): Slot =>
    aggregateSlot({ bots, pick, group, hasValue: included > 0, prices, nowMs: n, skewMs: sk });
  const read = (b: BotRow) => b.state.status !== 'starting' || !!b.freshness.state;
  const slot = {
    latent: agg((b) => b.metrics.open_profit_abs, 'positions', sums.latent.included, true),
    d1: agg((b) => b.metrics.realized_1d, 'metrics', sums.d1.included),
    d30: agg((b) => b.metrics.realized_30d, 'metrics', sums.d30.included),
    total: agg((b) => b.metrics.realized_total, 'metrics', sums.total.included),
    exposure: agg((b) => b.metrics.exposure_long ?? b.metrics.exposure_short, 'positions', 1),
    // The count of open slots is the bots' own: unknown while none of them was read
    trades: bots.length > 0 && !bots.some(read) ? PENDING : READY,
  };
  return { ...sums, slot };
}

/** A group is summed only when all its bots share one mode (live and dry are never added). */
function groupMode(bots: BotRow[]): boolean {
  return new Set(bots.map((b) => b.identity.mode)).size === 1;
}

// ---- cells ----
const ddThreshold = computed(() => {
  const meta = ruleMeta('highDrawdown');
  const custom = prefs.settings.alerts.rules.global.highDrawdown?.threshold;
  return Math.abs(custom ?? meta.threshold?.default ?? 15);
});

function ddTone(pct: number | null): MeterTone {
  if (pct == null) return 'neutral';
  return pct >= ddThreshold.value ? 'crit' : pct >= ddThreshold.value * 0.66 ? 'warn' : 'neutral';
}

function stateReason(b: BotRow): string {
  const st = botState(b, now.value, skew.value);
  const min = minutesSince(b.state.since_ms, now.value, skew.value) ?? 0;
  switch (st) {
    case 'starting':
      return t('fq.fleet.state.starting', { n: min });
    case 'offline':
      return t('fq.fleet.state.offline', { n: min });
    case 'stopped':
      return t('fq.fleet.state.stopped');
    case 'auth_expired':
      return t('fq.status.sessionExpired');
    case 'stale': {
      const f = b.freshness.state;
      return t('fq.fleet.state.stale', {
        age: f ? formatAge(Math.max(0, now.value + skew.value - f.as_of_ms), locale.value) : '',
      }).trim();
    }
    default:
      return '';
  }
}

/** Text next to the name: the state in words, or "since DD/MM" for a seeded dry bot. */
function stateText(b: BotRow): string {
  const reason = stateReason(b);
  if (reason) return reason;
  if (b.identity.mode === 'dry' && b.state.first_real_trade_ms) {
    const d = new Date(b.state.first_real_trade_ms);
    const date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    return t('fq.origin.since', { date });
  }
  return '';
}

function rowClass(b: BotRow): Record<string, boolean> {
  const st = botState(b, now.value, skew.value);
  return {
    'is-live': b.identity.mode === 'live',
    'is-dry': b.identity.mode !== 'live',
    stale: st === 'stale',
    offline: st === 'offline',
    sel: props.selectedKey === b.bot_key,
  };
}

function numStale(b: BotRow, group: 'positions' | 'metrics') {
  return isStaleGroup(b, group, now.value, skew.value);
}

/** Slot props of one figure of a bot row (state, reason, identity of the wait). */
function cell(
  b: BotRow,
  field: string,
  group: 'positions' | 'metrics' | 'capital',
  value: number | null | undefined,
  o: { prices?: boolean; settled?: SlotReason } = {},
) {
  const slot = botSlot(b, group, value, { nowMs: now.value, skewMs: skew.value, ...o });
  return vs(slot, `${b.bot_key}/${field}`);
}

/** A bot that never closed a trade has no last trade and no win rate: that is a fact, not a gap. */
const noTrades = (b: BotRow): SlotReason => (b.metrics.trades_closed === 0 ? 'noTrades' : 'noData');

/** Drawdown with open positions needs the prices: it follows the latent profit when that is missing. */
function ddCell(b: BotRow) {
  const latent = botSlot(b, 'positions', b.metrics.open_profit_abs, {
    nowMs: now.value,
    skewMs: skew.value,
    prices: true,
  });
  if (latent.state !== 'ready') return vs(latent, `${b.bot_key}/drawdown`);
  return cell(b, 'drawdown', 'metrics', b.metrics.drawdown_with_open ? 0 : null);
}

function lastTrade(b: BotRow): string {
  const ms = b.metrics.last_trade_ms;
  return ms == null ? '' : formatAge(Math.max(0, now.value + skew.value - ms), locale.value);
}

const alertTitle = (b: BotRow) =>
  t('fq.fleet.alertsTitle', { n: b.alerts.count, severity: b.alerts.max_severity ?? '' });

function onScroll(e: Event) {
  scrollTop.value = (e.target as HTMLElement).scrollTop;
}

function activate(b: BotRow) {
  emit('selectBot', b.bot_key);
}
function onKey(e: KeyboardEvent, b: BotRow) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    activate(b);
  }
}

const headerLabel = (id: string) => t(`fq.col.${id}`);
/** The technical term behind a plain column label, when there is one. */
const headerHint = (id: string) => (te(`fq.hint.col.${id}`) ? t(`fq.hint.col.${id}`) : undefined);
const hasSpark = (b: BotRow) => b.metrics.spark24h.length > 1;

// ---- sorting by the header: the name and what is open are the two sorts, a third click restores
// the attention order ----
const SORT_OF: Record<string, FleetSort> = { bot: 'name', latent: 'latent' };
const sortedBy = (id: string) => (SORT_OF[id] && props.sort === SORT_OF[id] ? SORT_OF[id] : null);
function sortBy(id: string) {
  const mine = SORT_OF[id];
  if (!mine) return;
  emit('update:sort', props.sort === mine ? 'attention' : mine);
}

// ---- open positions of a bot as small bars, one per slot the bot has (a count beyond 12) ----
const MAX_PIPS = 12;
function slotPips(b: BotRow): boolean[] | null {
  const max = b.state.max_open_trades;
  if (max == null || max <= 0 || max > MAX_PIPS) return null;
  return Array.from({ length: max }, (_, i) => i < b.state.open_trades);
}
function slotsTitle(b: BotRow): string {
  const max = b.state.max_open_trades;
  return max == null || max <= 0
    ? t('fq.pg.fleet.slots.free', { open: b.state.open_trades }, b.state.open_trades)
    : t('fq.pg.fleet.slots.title', { open: b.state.open_trades, max }, b.state.open_trades);
}

// ---- the market of a bot, in plain words and in grey (cyan is for information) ----
function marketLabel(b: BotRow): string {
  const m = b.identity.market;
  if (m === 'crypto') return '';
  const key = {
    xyz_stocks: 'stocks',
    xyz_indices: 'indices',
    xyz_commodities: 'commodities',
    mixed: 'mixed',
  }[m as string];
  return t(`fq.pg.fleet.market.${key ?? 'other'}`);
}

// ---- a bot that is silent has a frozen number: the cell says so instead of looking alive ----
const isFrozen = (b: BotRow) => {
  const st = botState(b, now.value, skew.value);
  return st === 'stale' || st === 'offline' || st === 'auth_expired';
};

// ---- "Columns" menu: every column of the table, the choice is kept in the preferences ----
const colAnchor = ref<HTMLElement | null>(null);
const colOpen = ref(false);
const pickable = computed(() =>
  columnState.allColumns.value.filter((c) => !c.required && !c.unavailable),
);
const chosen = columnState.wanted;
function toggleCol(id: string, on: boolean) {
  columnState.setVisible(id, on);
}
function openCols(e: MouseEvent) {
  colAnchor.value = e.currentTarget as HTMLElement;
  colOpen.value = !colOpen.value;
}

defineExpose({ visibleColumnIds: () => cols.value.map((c) => c.id) });
</script>

<template>
  <div
    ref="root"
    class="ft"
    :class="{ virtual: isVirtual, frozen }"
    :style="isVirtual ? { maxHeight } : undefined"
    :data-frozen="frozen || undefined"
    :data-width="width"
    @scroll.passive="onScroll"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @focusin="focused = true"
    @focusout="focused = false"
  >
    <table class="tbl" :aria-rowcount="items.length + 2">
      <thead>
        <tr>
          <th
            v-for="c in cols"
            :key="c.id"
            class="colh"
            :class="{ l: c.align === 'left', c: c.align === 'center', sortable: !!SORT_OF[c.id] }"
            :style="c.id === 'bot' ? { minWidth: '196px' } : undefined"
            :title="headerHint(c.id)"
            :aria-sort="
              sortedBy(c.id) ? (sortedBy(c.id) === 'name' ? 'ascending' : 'ascending') : undefined
            "
          >
            <button v-if="SORT_OF[c.id]" type="button" class="hbtn" @click="sortBy(c.id)">
              {{ headerLabel(c.id) }}
              <DsIcon v-if="sortedBy(c.id)" name="arrow-up" :size="13" />
            </button>
            <template v-else>{{ headerLabel(c.id) }}</template>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="win.padTop > 0" class="pad" aria-hidden="true">
          <td :colspan="cols.length" :style="{ height: win.padTop + 'px', padding: 0 }"></td>
        </tr>
        <template v-for="item in shown" :key="item.key">
          <tr
            v-if="item.type === 'group'"
            class="grp act"
            tabindex="0"
            :data-group="item.group.id"
            @click="
              item.group.id === UNGROUPED_ID
                ? undefined
                : emit('selectScope', { kind: 'group', id: item.group.id })
            "
            @keydown.enter.prevent="
              item.group.id === UNGROUPED_ID
                ? undefined
                : emit('selectScope', { kind: 'group', id: item.group.id })
            "
          >
            <td class="l">
              <button
                type="button"
                class="chev"
                :aria-expanded="!item.collapsed"
                :aria-label="item.group.name"
                @click.stop="toggleGroup(item.group.id, item.collapsed)"
              >
                <DsIcon :name="item.collapsed ? 'chevron-right' : 'chevron-down'" :size="13" />
              </button>
              <span class="g-name">{{ item.group.name }}</span>
              <span class="g-n">{{ item.group.bots.length }}</span>
              <span v-if="item.group.toWatch > 0" class="to-watch">{{
                t('fq.fleet.toWatch', { n: item.group.toWatch })
              }}</span>
            </td>
            <td v-for="c in cols.slice(1)" :key="c.id" :class="{ c: c.align === 'center' }">
              <template v-if="!groupMode(item.group.bots)"></template>
              <template v-else-if="c.id === 'latent'">
                <PnlValue
                  :value="sumsOf(item.group.bots).latent.total"
                  muted
                  v-bind="vs(sumsOf(item.group.bots).slot.latent, `${item.key}/latent`)"
                />
              </template>
              <template v-else-if="c.id === 'realized_1d'">
                <PnlValue
                  :value="sumsOf(item.group.bots).d1.total"
                  muted
                  v-bind="vs(sumsOf(item.group.bots).slot.d1, `${item.key}/d1`)"
                />
              </template>
              <template v-else-if="c.id === 'realized_30d'">
                <PnlValue
                  :value="sumsOf(item.group.bots).d30.total"
                  :decimals="0"
                  muted
                  v-bind="vs(sumsOf(item.group.bots).slot.d30, `${item.key}/d30`)"
                />
              </template>
            </td>
          </tr>
          <tr
            v-else
            :class="['bot', rowClass(item.bot)]"
            :data-bot-key="item.bot.bot_key"
            tabindex="0"
            :aria-selected="selectedKey === item.bot.bot_key"
            @click="activate(item.bot)"
            @keydown="onKey($event, item.bot)"
          >
            <td
              v-for="c in cols"
              :key="c.id"
              :class="{ l: c.align === 'left', c: c.align === 'center' }"
            >
              <template v-if="c.id === 'bot'">
                <div class="name-cell">
                  <StatusDot :state="botState(item.bot, now, skew)" />
                  <span class="name" :title="item.bot.identity.name">{{
                    item.bot.identity.name
                  }}</span>
                  <Badge v-if="item.bot.identity.mode === 'dry'" kind="dry" />
                  <Badge v-else-if="item.bot.identity.mode === 'replay'" kind="replay" />
                  <Badge
                    v-if="marketLabel(item.bot)"
                    kind="neutral"
                    :label="marketLabel(item.bot)"
                    class="mk"
                  />
                  <span
                    v-if="item.bot.alerts.count > 0"
                    class="al"
                    :class="item.bot.alerts.max_severity ?? ''"
                    role="img"
                    :aria-label="alertTitle(item.bot)"
                    :title="alertTitle(item.bot)"
                  >
                    <DsIcon
                      :name="
                        item.bot.alerts.max_severity === 'critical'
                          ? 'octagon-alert'
                          : item.bot.alerts.max_severity === 'warning'
                            ? 'triangle-alert'
                            : 'info'
                      "
                      :size="13"
                    />
                  </span>
                  <span v-if="stateText(item.bot)" class="st-text">{{ stateText(item.bot) }}</span>
                </div>
              </template>
              <template v-else-if="c.id === 'state'">{{
                stateReason(item.bot) || t('fq.ds.state.online')
              }}</template>
              <template v-else-if="c.id === 'mode'">
                <Badge :kind="item.bot.identity.mode" />
              </template>
              <template v-else-if="c.id === 'market'">{{ item.bot.identity.market }}</template>
              <template v-else-if="c.id === 'side'">
                <DirectionChip v-if="exposureSide(item.bot)" :side="exposureSide(item.bot)!" />
                <ValueState
                  v-else
                  v-bind="
                    cell(
                      item.bot,
                      'side',
                      'positions',
                      item.bot.metrics.exposure_long ?? item.bot.metrics.exposure_short,
                    )
                  "
                />
              </template>
              <template v-else-if="c.id === 'latent'">
                <span v-if="isFrozen(item.bot)" class="frozen" data-testid="frozen">{{
                  t('fq.pg.fleet.frozen')
                }}</span>
                <PnlValue
                  v-else
                  :value="item.bot.metrics.open_profit_abs"
                  :muted="numStale(item.bot, 'positions')"
                  :flash="true"
                  v-bind="
                    cell(item.bot, 'latent', 'positions', item.bot.metrics.open_profit_abs, {
                      prices: true,
                    })
                  "
                />
              </template>
              <template v-else-if="c.id === 'realized_1d'">
                <PnlValue
                  :value="item.bot.metrics.realized_1d"
                  :muted="numStale(item.bot, 'metrics')"
                  v-bind="cell(item.bot, 'd1', 'metrics', item.bot.metrics.realized_1d)"
                />
              </template>
              <template v-else-if="c.id === 'realized_7d'">
                <PnlValue
                  :value="item.bot.metrics.realized_7d"
                  :decimals="0"
                  :muted="numStale(item.bot, 'metrics')"
                  v-bind="cell(item.bot, 'd7', 'metrics', item.bot.metrics.realized_7d)"
                />
              </template>
              <template v-else-if="c.id === 'realized_30d'">
                <PnlValue
                  :value="item.bot.metrics.realized_30d"
                  :decimals="0"
                  :muted="numStale(item.bot, 'metrics')"
                  v-bind="cell(item.bot, 'd30', 'metrics', item.bot.metrics.realized_30d)"
                />
              </template>
              <template v-else-if="c.id === 'realized_total'">
                <PnlValue
                  :value="item.bot.metrics.realized_total"
                  :decimals="0"
                  :muted="numStale(item.bot, 'metrics')"
                  v-bind="cell(item.bot, 'total', 'metrics', item.bot.metrics.realized_total)"
                />
              </template>
              <template v-else-if="c.id === 'spark24h'">
                <Sparkline
                  v-if="hasSpark(item.bot)"
                  :values="item.bot.metrics.spark24h"
                  :width="64"
                  :height="18"
                />
              </template>
              <template v-else-if="c.id === 'exposure'">
                <ValueState
                  v-bind="
                    cell(
                      item.bot,
                      'exposure',
                      'positions',
                      item.bot.metrics.exposure_long ?? item.bot.metrics.exposure_short,
                    )
                  "
                  >{{
                    fmt.number(
                      (item.bot.metrics.exposure_long ?? 0) +
                        (item.bot.metrics.exposure_short ?? 0),
                      0,
                    )
                  }}</ValueState
                >
              </template>
              <template v-else-if="c.id === 'trades'">
                <ValueState
                  v-if="item.bot.state.status === 'starting' && !item.bot.freshness.state"
                  v-bind="vs(PENDING, `${item.bot.bot_key}/slots`)"
                />
                <div
                  v-else
                  class="slots"
                  data-testid="slots"
                  role="img"
                  :aria-label="slotsTitle(item.bot)"
                  :title="slotsTitle(item.bot)"
                >
                  <template v-if="slotPips(item.bot)">
                    <i
                      v-for="(on, k) in slotPips(item.bot)"
                      :key="k"
                      class="pip"
                      :class="{ on }"
                    ></i>
                  </template>
                  <span v-else class="num">{{ item.bot.state.open_trades }}</span>
                </div>
              </template>
              <template v-else-if="c.id === 'drawdown'">
                <div
                  v-if="item.bot.metrics.drawdown_with_open && ddCell(item.bot).state === 'ready'"
                  class="dd"
                >
                  <PnlValue :value="-item.bot.metrics.drawdown_with_open.abs" :decimals="0" />
                  <span
                    v-if="drawdownPct(item.bot.metrics.drawdown_with_open) !== null"
                    class="pct"
                    >{{
                      fmt.percent(-(drawdownPct(item.bot.metrics.drawdown_with_open) as number), 1)
                    }}</span
                  >
                  <Meter
                    v-if="drawdownPct(item.bot.metrics.drawdown_with_open) !== null"
                    :value="drawdownPct(item.bot.metrics.drawdown_with_open) as number"
                    :max="ddThreshold * 1.5"
                    :threshold="ddThreshold"
                    :tone="ddTone(drawdownPct(item.bot.metrics.drawdown_with_open))"
                    :label="t('fq.col.drawdown')"
                  />
                </div>
                <ValueState v-else v-bind="ddCell(item.bot)" />
              </template>
              <template v-else-if="c.id === 'last_trade'">
                <template v-if="lastTrade(item.bot)">{{ lastTrade(item.bot) }}</template>
                <ValueState
                  v-else
                  v-bind="
                    cell(item.bot, 'last_trade', 'metrics', null, { settled: noTrades(item.bot) })
                  "
                />
              </template>
              <template v-else-if="c.id === 'alerts'">{{ item.bot.alerts.count || '' }}</template>
              <template v-else-if="c.id === 'age'">
                <AgeBadge
                  v-if="item.bot.freshness.state"
                  :as-of-ms="item.bot.freshness.state.as_of_ms"
                  :stale-after-ms="DIGEST_STALE_MS"
                  :clock-skew-ms="skew"
                  :now-ms="now"
                />
                <ValueState v-else v-bind="vs(PENDING, `${item.bot.bot_key}/age`)" />
              </template>
              <template v-else-if="c.id === 'exchange'">{{
                item.bot.identity.exchange ?? ''
              }}</template>
              <template v-else-if="c.id === 'strategy'">{{
                item.bot.identity.strategy ?? ''
              }}</template>
              <template v-else-if="c.id === 'capital'">
                <ValueState
                  v-bind="
                    cell(item.bot, 'capital', 'capital', item.bot.metrics.starting_capital, {
                      settled: 'capital',
                    })
                  "
                  >{{ fmt.number(item.bot.metrics.starting_capital as number, 0) }}</ValueState
                >
              </template>
              <template v-else-if="c.id === 'winrate'">
                <ValueState
                  v-bind="
                    cell(item.bot, 'winrate', 'metrics', item.bot.metrics.winrate, {
                      settled: noTrades(item.bot),
                    })
                  "
                  >{{
                    fmt.percent((item.bot.metrics.winrate as number) * 100, 0, false)
                  }}</ValueState
                >
              </template>
              <template v-else-if="c.id === 'port'">{{ item.bot.identity.port ?? '' }}</template>
            </td>
          </tr>
        </template>
        <tr v-if="win.padBottom > 0" class="pad" aria-hidden="true">
          <td :colspan="cols.length" :style="{ height: win.padBottom + 'px', padding: 0 }"></td>
        </tr>
        <tr v-if="items.length === 0" class="none">
          <td :colspan="cols.length">
            <EmptyState icon="bot" :title="t('fq.fleet.empty')" :hint="t('fq.fleet.emptyHint')" />
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="limit || pickable.length > 0" class="foot">
      <button
        v-if="hiddenBots > 0"
        type="button"
        class="link"
        data-testid="fleet-more-bots"
        @click="expanded = true"
      >
        {{ t('fq.pg.fleet.seeMoreBots', { n: hiddenBots }, hiddenBots) }}
      </button>
      <button v-else-if="canShorten" type="button" class="link" @click="expanded = false">
        {{ t('fq.pg.fleet.fewerBots') }}
      </button>
      <span class="sp"></span>
      <button
        v-if="pickable.length > 0"
        type="button"
        class="link"
        data-testid="fleet-columns"
        :aria-expanded="colOpen"
        @click="openCols"
      >
        <DsIcon name="columns-2" :size="13" />
        {{ t('fq.pg.fleet.columns.button') }}
      </button>
      <Popover
        :open="colOpen"
        :anchor="colAnchor"
        placement="top-end"
        :label="t('fq.pg.fleet.columns.title')"
        @close="colOpen = false"
      >
        <div class="colmenu">
          <label v-for="c in pickable" :key="c.id" class="colrow">
            <input
              type="checkbox"
              :checked="chosen.has(c.id)"
              @change="toggleCol(c.id, ($event.target as HTMLInputElement).checked)"
            />
            <span>{{ headerLabel(c.id) }}</span>
          </label>
          <button type="button" class="link reset" @click="columnState.reset()">
            {{ t('fq.pg.fleet.columns.reset') }}
          </button>
        </div>
      </Popover>
    </div>
    <p v-if="unavailableCols.length > 0" class="note">
      {{ t('fq.connection.unavailableDirect') }}:
      {{ unavailableCols.map((c) => headerLabel(c.id)).join(', ') }}
    </p>
  </div>
</template>

<style scoped>
.ft {
  width: 100%;
  overflow: auto;
  container-type: inline-size;
  position: relative;
}
.tbl {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--t-cell);
}
th {
  position: sticky;
  top: 0;
  z-index: 3;
  height: var(--th-h);
  padding: 0 8px;
  text-align: right;
  white-space: nowrap;
  background: var(--bg-1);
  border-bottom: 1px solid var(--line);
  color: var(--th-color);
  font: var(--th-weight) var(--t-xs) var(--font-ui);
  text-transform: var(--th-case);
  letter-spacing: var(--th-track);
}
th.l,
td.l {
  text-align: left;
}
th.c,
td.c {
  text-align: center;
}
td {
  height: var(--row);
  padding: 0 8px;
  text-align: right;
  border-bottom: 1px solid var(--row-line);
  white-space: nowrap;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
}
td.l {
  font-family: var(--font-ui);
}
tbody tr {
  transition: background var(--d-instant);
}
tbody tr.bot,
tbody tr.grp {
  cursor: pointer;
}
tbody tr:hover:not(.pad):not(.none) {
  background: var(--bg-2);
}
tbody tr.sel {
  background: var(--accent-w);
}
tbody tr.is-live td:first-child {
  box-shadow: inset 2px 0 0 var(--live);
}
tbody tr.is-dry td:first-child {
  box-shadow: inset 2px 0 0 color-mix(in srgb, var(--dry) 50%, transparent);
}
tbody tr.stale td {
  background-image: var(--stale-hatch);
}
tbody tr.offline td {
  background-image: var(--off-hatch);
}
tbody tr.offline td:not(:first-child) {
  opacity: 0.62;
  text-decoration: line-through;
}
tr.grp td {
  background: color-mix(in srgb, var(--bg-2) 60%, var(--bg-1));
  color: var(--fg-2);
  font-weight: 600;
}
.chev {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 0;
  background: none;
  color: var(--fg-3);
  cursor: pointer;
  margin-right: 2px;
}
@media (max-width: 599px), (pointer: coarse) {
  /* 02 section 17: touch targets are 44 x 44, and a miss would select the group scope */
  .chev {
    width: 44px;
    height: 44px;
    margin: -12px 0 -12px -12px;
  }
}
.g-n {
  color: var(--fg-3);
  font-weight: 500;
  margin: 0 8px;
}
.to-watch {
  display: inline-block;
  padding: 1px 6px;
  border-radius: var(--r-sm, 4px);
  background: color-mix(in srgb, var(--warn) 16%, transparent);
  color: var(--warn);
  font: 600 var(--t-xs) var(--font-ui);
  text-transform: none;
}
.name-cell {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
  min-width: 196px;
}
.name {
  /* The name is never cut: bots with long names wrap to a second line instead */
  min-width: min(100%, 11ch);
  font-weight: 500;
  overflow-wrap: anywhere;
  white-space: normal;
  line-height: 1.15;
}
.st-text {
  color: var(--fg-3);
  font-size: var(--t-xs);
  font-weight: 400;
}
.al.critical {
  color: var(--crit);
}
.al.warning {
  color: var(--warn);
}
.al.info {
  color: var(--info);
}
.slots,
.dd {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}
.dd :deep(.meter) {
  width: 44px;
}
.pip {
  width: 7px;
  height: 12px;
  border-radius: 2px;
  background: var(--bg-3);
}
.pip.on {
  background: var(--fg-3);
}
.slots {
  gap: 3px;
}
.hbtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
}
.hbtn:hover {
  color: var(--fg);
}
.frozen {
  color: var(--fg-3);
  font-family: var(--font-ui);
  font-size: var(--t-sm);
}
.mk {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
}
.foot {
  display: flex;
  align-items: center;
  gap: var(--s3);
  padding: var(--s2) var(--s3);
  font-size: var(--t-sm);
}
.foot .sp {
  flex: 1;
}
.link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}
.colmenu {
  display: grid;
  gap: 2px;
  padding: var(--s2);
  min-width: 190px;
  font-size: var(--t-sm);
}
.colrow {
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: 4px 6px;
  border-radius: var(--r-1);
  cursor: pointer;
}
.colrow:hover {
  background: var(--bg-2);
}
.reset {
  margin-top: 4px;
  padding: 4px 6px;
  border-top: 1px solid var(--line);
  padding-top: 8px;
  color: var(--fg-3);
}
@media (max-width: 599px), (pointer: coarse) {
  .colrow {
    min-height: 44px;
  }
  .foot .link {
    min-height: 44px;
  }
}
.pct,
.dim {
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.none td {
  height: auto;
  border-bottom: 0;
}
.note {
  margin: 0;
  padding: 6px var(--s3);
  color: var(--fg-3);
  font-size: var(--t-xs);
}
@media (max-width: 599px), (pointer: coarse) {
  th {
    height: 36px;
  }
}
</style>
