<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  AgeBadge,
  Badge,
  DirectionChip,
  DsIcon,
  EmptyState,
  ExcludedCount,
  Meter,
  PnlValue,
  Sparkline,
  StatusDot,
  ValueState,
} from '@/components/ds';
import type { BotRef, MeterTone } from '@/components/ds';
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
  slotsRatio,
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
 * The fleet as a table (02 section 3.1): a sticky "Σ" row that says how many bots it excludes, the
 * user's groups with their aggregates and a "N to see" badge, one row per bot. The order is the
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
    /** Label of the Σ row: "Σ Live fleet" by default. */
    scopeLabel?: string;
    maxHeight?: string;
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
}>();

const { t, locale } = useI18n();
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

const items = computed<Item[]>(() => {
  if (groups.value.length === 0) {
    return ordered.value.map((bot) => ({ type: 'bot' as const, key: bot.bot_key, bot }));
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

/**
 * Live and dry are never added together: a mixed scope shows one Σ row per mode (replay is a
 * simulation and has no Σ), a single-mode scope shows one.
 */
const sigmaRows = computed(() => {
  const modes = new Set(props.rows.map((b) => b.identity.mode));
  if (modes.size <= 1 || props.scopeLabel) {
    return [{ id: 'all', label: sigmaLabel.value, sums: sumsOf(props.rows) }];
  }
  const out: { id: string; label: string; sums: ReturnType<typeof sumsOf> }[] = [];
  if (modes.has('live')) {
    out.push({
      id: 'live',
      label: t('fq.fleet.sigmaLive'),
      sums: sumsOf(props.rows.filter((b) => b.identity.mode === 'live')),
    });
  }
  if (modes.has('dry')) {
    out.push({
      id: 'dry',
      label: t('fq.fleet.sigmaDry'),
      sums: sumsOf(props.rows.filter((b) => b.identity.mode === 'dry')),
    });
  }
  return out;
});

function excludedRefsOf(sums: ReturnType<typeof sumsOf>): BotRef[] {
  const keys = new Set([...sums.latent.excluded, ...sums.d1.excluded]);
  return props.rows
    .filter((b) => keys.has(b.bot_key))
    .map((b) => ({ key: b.bot_key, name: b.identity.name, reason: stateReason(b) }));
}

const sigmaLabel = computed(() => {
  if (props.scopeLabel) return props.scopeLabel;
  const modes = new Set(props.rows.map((b) => b.identity.mode));
  if (modes.size === 1 && modes.has('dry')) return t('fq.fleet.sigmaDry');
  if (modes.size > 1) return t('fq.fleet.sigmaAll');
  return t('fq.fleet.sigmaLive');
});
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
const hasSpark = (b: BotRow) => b.metrics.spark24h.length > 1;

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
            :class="{ l: c.align === 'left', c: c.align === 'center' }"
            :style="c.id === 'bot' ? { minWidth: '196px' } : undefined"
          >
            {{ headerLabel(c.id) }}
          </th>
        </tr>
        <tr
          v-for="sr in sigmaRows"
          :key="sr.id"
          class="sigma"
          :data-sigma="sr.id"
          @click="emit('selectScope', { kind: 'fleet' })"
        >
          <th v-for="(c, i) in cols" :key="c.id" :class="{ l: i === 0 }">
            <template v-if="c.id === 'bot'">
              <span class="sig-l">{{ sr.label }}</span>
              <ExcludedCount
                :bots="excludedRefsOf(sr.sums)"
                @select="(b) => emit('selectBot', b.key)"
              />
            </template>
            <template v-else-if="c.id === 'latent'">
              <PnlValue
                :value="sr.sums.latent.total"
                v-bind="vs(sr.sums.slot.latent, `${sr.id}/Σ/latent`)"
              />
            </template>
            <template v-else-if="c.id === 'realized_1d'">
              <PnlValue :value="sr.sums.d1.total" v-bind="vs(sr.sums.slot.d1, `${sr.id}/Σ/d1`)" />
            </template>
            <template v-else-if="c.id === 'realized_30d'">
              <PnlValue
                :value="sr.sums.d30.total"
                :decimals="0"
                v-bind="vs(sr.sums.slot.d30, `${sr.id}/Σ/d30`)"
              />
            </template>
            <template v-else-if="c.id === 'realized_total'">
              <PnlValue
                :value="sr.sums.total.total"
                :decimals="0"
                v-bind="vs(sr.sums.slot.total, `${sr.id}/Σ/total`)"
              />
            </template>
            <template v-else-if="c.id === 'exposure'">
              <ValueState v-bind="vs(sr.sums.slot.exposure, `${sr.id}/Σ/exposure`)">
                <span
                  :title="sr.sums.exposure.netted ? t('fq.fleet.netted') : t('fq.fleet.notNetted')"
                  >{{ fmt.number(sr.sums.exposure.total, 0) }}</span
                >
              </ValueState>
            </template>
            <template v-else-if="c.id === 'trades'">
              <ValueState v-bind="vs(sr.sums.slot.trades, `${sr.id}/Σ/trades`)">{{
                sr.sums.slots
              }}</ValueState>
            </template>
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
                  <Badge v-if="item.bot.identity.market !== 'crypto'" kind="xyz" />
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
                <PnlValue
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
                <div v-else class="slots">
                  <span class="num"
                    >{{ item.bot.state.open_trades }}/<ValueState
                      v-bind="
                        cell(item.bot, 'max', 'capital', item.bot.state.max_open_trades, {
                          settled: 'noData',
                        })
                      "
                      >{{ item.bot.state.max_open_trades }}</ValueState
                    ></span
                  >
                  <Meter
                    v-if="slotsRatio(item.bot) !== null"
                    :value="slotsRatio(item.bot)! * 100"
                    :tone="slotsRatio(item.bot)! >= 1 ? 'warn' : 'neutral'"
                    :label="t('fq.col.trades')"
                  />
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
  font-size: var(--t-sm);
}
th {
  position: sticky;
  top: 0;
  z-index: 3;
  height: 30px;
  padding: 0 8px;
  text-align: right;
  white-space: nowrap;
  background: var(--bg-1);
  border-bottom: 1px solid var(--line);
  color: var(--fg-3);
  font: 600 var(--t-xs) var(--font-ui);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
th.l,
td.l {
  text-align: left;
}
th.c,
td.c {
  text-align: center;
}
tr.sigma th {
  top: 30px;
  z-index: 2;
  height: var(--row);
  background: var(--bg-2);
  color: var(--fg);
  font: 600 var(--t-sm) var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
  text-transform: none;
  letter-spacing: 0;
  cursor: pointer;
}
tr.sigma + tr.sigma th {
  top: calc(30px + var(--row));
}
tr.sigma .sig-l {
  font-family: var(--font-ui);
  margin-right: 8px;
}
td {
  height: var(--row);
  padding: 0 8px;
  text-align: right;
  border-bottom: 1px solid var(--line);
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
.slots :deep(.meter),
.dd :deep(.meter) {
  width: 44px;
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
  tr.sigma th {
    top: 36px;
  }
  tr.sigma + tr.sigma th {
    top: calc(36px + var(--row));
  }
}
</style>
