<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  Badge,
  Btn,
  DataTable,
  DcaPips,
  DirectionChip,
  EmptyState,
  Meter,
  ModeMark,
  PnlValue,
  SegmentedControl,
} from '@/components/ds';
import type { ColumnDef, SortState } from '@/components/ds';
import { sortRows } from '@/components/ds/lib/table';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useColumns } from '@/composables/useColumns';
import { useScope } from '@/composables/useScope';
import { useShortcuts } from '@/composables/useShortcuts';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import type { BotKey, Position, TradeRow } from '@/gateway/types.gen';
import type { ColumnPreset } from '@/migration/schema';

import BotActionBar from './BotActionBar.vue';
import BotActionMenu from './BotActionMenu.vue';
import type { ActionId } from './lib/actions';
import { formatDateTime } from './lib/time';
import {
  compareWorstFirst,
  durationTone,
  lineFromPosition,
  lineFromTrade,
  liqTone,
  matchesQuickFilter,
  pairLabel,
  type QuickFilter,
  type TradeLine,
} from './lib/trades';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import PositionCard from './PositionCard.vue';

/**
 * The trade tables of the app (02 sections 3.1, 3.2 and 5.2) under one component and four
 * presets: `open` (positions of the fleet), `bot` (positions of one bot), `closed` (history of one
 * bot) and `journal` (history of the fleet). The columns come from the registry (`useColumns`)
 * and drop by the width of THIS panel; under `cardsBelow` px the table becomes cards.
 *
 * Targeting: a line is `(bot_key, trade_id)`, never `trade_id` alone, and an action of a line
 * opens the confirmation of THAT bot and trade. An orphan position has no exit, only the
 * reconciliation. Open lines are listed worst P&L first. No red button per row: the exit is a
 * neutral button shown on hover, focus and selection, and always on touch.
 */
const props = withDefaults(
  defineProps<{
    preset: Exclude<ColumnPreset, 'fleet'>;
    /** The bot of the `bot` and `closed` presets. */
    botKey?: BotKey;
    /** Closed trades (query result of the gateway or direct source) for `closed` and `journal`. */
    trades?: TradeRow[];
    /** Override of the positions store (previews, tests). */
    positions?: Position[];
    /** Quick filter of the open positions. */
    filter?: QuickFilter;
    cardsBelow?: number;
    /** More pages exist: shows "Load more". */
    cursor?: string | null;
    selectedKey?: string | null;
    /** Container width override in px (previews, tests). */
    containerWidth?: number;
    /** Maximum number of entries of a bot, when known, for the DCA pips. */
    dcaMax?: (botKey: string) => number | undefined;
    /** Take profit of a line, when known, for the ladders of the cards. */
    tpOf?: (line: TradeLine) => number | null;
    /** Register `J`/`K` (next, previous line) and `X` (exit the selected line). */
    shortcuts?: boolean;
    /** Cards shown before "See the N others". */
    cardLimit?: number;
    /** Apply the FleetScope (mode, search, groups) to the open positions. */
    scoped?: boolean;
    /** Hide the quick filter bar. */
    hideFilters?: boolean;
  }>(),
  {
    cardsBelow: 560,
    filter: 'all',
    cursor: null,
    selectedKey: null,
    cardLimit: 7,
    scoped: false,
    hideFilters: false,
  },
);

const emit = defineEmits<{
  open: [botKey: BotKey, tradeId: number];
  openBot: [botKey: BotKey];
  navigate: [id: ActionId, line: TradeLine];
  loadMore: [];
  'update:filter': [value: QuickFilter];
  'update:selectedKey': [value: string | null];
}>();

const { t, locale } = useI18n();
const fmt = useFormat();
const fleet = useFqFleetStore();
const positionsStore = useFqPositionsStore();
const prefs = useFqPrefsStore();
const scope = useScope();

// ---- width of this panel ----
const root = ref<HTMLElement | null>(null);
const measured = ref(0);
let observer: ResizeObserver | undefined;
onMounted(() => {
  const measure = () => (measured.value = root.value?.clientWidth ?? 0);
  measure();
  if (typeof ResizeObserver !== 'undefined' && root.value) {
    observer = new ResizeObserver(measure);
    observer.observe(root.value);
  }
});
onBeforeUnmount(() => observer?.disconnect());
const width = computed(() => props.containerWidth ?? measured.value);
const asCards = computed(() => width.value > 0 && width.value < props.cardsBelow);

const columnState = useColumns(props.preset, width);
const isOpenPreset = computed(() => props.preset === 'open' || props.preset === 'bot');

// ---- lines ----
const positionsOf = computed<Position[]>(() => props.positions ?? positionsStore.list);
const positionByKey = computed(
  () => new Map(positionsOf.value.map((p) => [`${p.bot_key}/${p.trade_id}`, p])),
);

const lines = computed<TradeLine[]>(() => {
  if (isOpenPreset.value) {
    const inScope = props.scoped ? new Set(scope.botKeys.value) : null;
    return positionsOf.value
      .filter((p) => {
        if (props.preset === 'bot') return p.bot_key === props.botKey;
        if (p.orphan) return true;
        return inScope ? inScope.has(p.bot_key) : true;
      })
      .map((p) =>
        lineFromPosition(p, fleet.bots[p.bot_key], { dcaMax: props.dcaMax?.(p.bot_key) ?? null }),
      );
  }
  return (props.trades ?? [])
    .filter((tr) => (props.preset === 'closed' ? tr.bot_key === props.botKey : true))
    .map((tr) => lineFromTrade(tr, fleet.bots[tr.bot_key]));
});

const filtered = computed(() =>
  isOpenPreset.value ? lines.value.filter((l) => matchesQuickFilter(l, props.filter)) : lines.value,
);

const filterOptions = computed(() =>
  (['all', 'loss', 'dca3', 'xyz', 'orphan'] as QuickFilter[]).map((f) => ({
    value: f,
    label: t(`fq.trade.filter.${f}`),
    count: f === 'all' ? undefined : lines.value.filter((l) => matchesQuickFilter(l, f)).length,
  })),
);

// ---- sort ----
const sort = ref<SortState | null>(
  props.preset === 'open' || props.preset === 'bot'
    ? { id: 'pnl_abs', dir: 'asc' }
    : { id: 'closed_at', dir: 'desc' },
);

function sortValue(l: TradeLine, id: string): unknown {
  switch (id) {
    case 'pair':
      return pairLabel(l.pair);
    case 'bot':
      return l.botName;
    case 'side':
      return l.side;
    case 'pnl_abs':
      return l.pnlAbs;
    case 'pnl_pct':
      return l.pnlPct;
    case 'current':
      return l.current;
    case 'stake':
      return l.stake;
    case 'leverage':
      return l.leverage;
    case 'liq_distance':
      return l.liqDistancePct;
    case 'duration':
    case 'duration_pct':
      return id === 'duration' ? l.durationMs : l.percentile;
    case 'dca':
      return l.dcaFilled;
    case 'opened':
      return l.openMs;
    case 'closed_at':
    case 'closed_ago':
      return l.closeMs;
    case 'exit_reason':
      return l.exitReason?.kind ?? '';
    case 'trade_id':
      return l.tradeId;
    case 'tag':
      return l.enterTag ?? '';
    default:
      return undefined;
  }
}

/** Worst first when nothing is sorted: the order of the open positions list. */
const sorted = computed(() =>
  sort.value
    ? sortRows(filtered.value, sort.value, (l, id) => sortValue(l, id))
    : [...filtered.value].sort(compareWorstFirst),
);

// ---- DataTable columns ----
const tableCols = computed<ColumnDef<TradeLine>[]>(() =>
  columnState.columns.value
    .filter((c) => !(props.preset === 'bot' && c.id === 'bot') && !c.unavailable)
    .map((c) => ({
      id: c.id,
      label: t(`fq.col.${c.id}`),
      align: c.align,
      sortable: c.sortable,
      sortValue: (l: TradeLine) => sortValue(l, c.id),
      ui: ['pair', 'bot', 'exit_reason', 'tag'].includes(c.id),
      width: c.id === 'actions' ? '132px' : undefined,
      firstSort: c.id === 'pnl_abs' || c.id === 'pnl_pct' ? 'asc' : undefined,
    })),
);
const unavailableNote = computed(() =>
  columnState.columns.value.filter((c) => c.unavailable).map((c) => t(`fq.col.${c.id}`)),
);

// ---- selection and menu ----
const selected = computed(() => props.selectedKey);
function activate(l: TradeLine) {
  emit('update:selectedKey', l.key);
  emit('open', l.botKey, l.tradeId);
}

const menuOpen = ref(false);
const menuAnchor = ref<HTMLElement | null>(null);
const menuLine = ref<TradeLine | null>(null);
function openMenu(anchor: HTMLElement, l: TradeLine) {
  if (menuOpen.value && menuLine.value?.key === l.key) {
    menuOpen.value = false;
    return;
  }
  menuAnchor.value = anchor;
  menuLine.value = l;
  menuOpen.value = true;
}
const menuPosition = computed(() => (menuLine.value ? positionOf(menuLine.value) : null));
function positionOf(l: TradeLine): Position | null {
  return positionByKey.value.get(l.key) ?? null;
}

function onNavigate(id: ActionId, l: TradeLine) {
  if (id === 'openTrade') activate(l);
  emit('navigate', id, l);
}

// ---- cards ----
const showAll = ref(false);
const visibleCards = computed(() =>
  showAll.value ? sorted.value : sorted.value.slice(0, props.cardLimit),
);
const hiddenCards = computed(() => Math.max(0, sorted.value.length - visibleCards.value.length));

// ---- keyboard: J / K / X ----
function move(delta: number) {
  const list = sorted.value;
  if (list.length === 0) return;
  const i = list.findIndex((l) => l.key === props.selectedKey);
  const next =
    list[
      Math.min(list.length - 1, Math.max(0, i < 0 ? (delta > 0 ? 0 : list.length - 1) : i + delta))
    ];
  if (next) emit('update:selectedKey', next.key);
}
useShortcuts(
  props.shortcuts
    ? [
        {
          id: `tt.${props.preset}.next`,
          keys: 'j',
          labelKey: 'fq.shortcut.next',
          group: 'list',
          run: () => move(1),
        },
        {
          id: `tt.${props.preset}.prev`,
          keys: 'k',
          labelKey: 'fq.shortcut.prev',
          group: 'list',
          run: () => move(-1),
        },
        {
          id: `tt.${props.preset}.exit`,
          keys: 'x',
          labelKey: 'fq.shortcut.exit',
          group: 'actions',
          // Opens the confirmation of the selected line only; sends nothing
          run: () => {
            const l = sorted.value.find((x) => x.key === props.selectedKey);
            if (!l || l.orphan || !l.open) return false;
            emit('navigate', 'exit', l);
            return undefined;
          },
          enabled: () => !!props.selectedKey,
        },
      ]
    : [],
);

watch(
  () => props.filter,
  () => (showAll.value = false),
);

// ---- cell helpers ----
const dateOf = (ms: number | null) =>
  ms == null ? '' : formatDateTime(ms, prefs.settings.tz, locale.value);
const hoursOf = (l: TradeLine) => l.durationMs / 3_600_000;
const sideLabel = (l: TradeLine) => (l.side === 'long' ? t('fq.side.long') : t('fq.side.short'));
function rowClass(l: TradeLine): string[] {
  const out: string[] = [];
  if (l.mode === 'live') out.push('is-live');
  else if (l.mode) out.push('is-dry');
  if (l.orphan) out.push('orphan');
  if (l.stale) out.push('stale');
  return out;
}
const empty = computed(() => ({
  title: t(`fq.trade.empty.${props.preset}`),
  hint: t(`fq.trade.emptyHint.${props.preset}`),
}));

defineExpose({ sorted: () => sorted.value.map((l) => l.key) });
</script>

<template>
  <div ref="root" class="tt" :data-cards="asCards || undefined" :data-preset="preset">
    <div v-if="isOpenPreset && !hideFilters" class="bar">
      <SegmentedControl
        :options="filterOptions"
        :model-value="filter"
        size="sm"
        :label="t('fq.trade.filter.label')"
        @update:model-value="(v: QuickFilter) => emit('update:filter', v)"
      />
    </div>

    <template v-if="asCards">
      <div v-if="sorted.length === 0" class="empty">
        <EmptyState icon="layers" :title="empty.title" :hint="empty.hint" />
      </div>
      <div v-else class="cards">
        <PositionCard
          v-for="l in visibleCards"
          :key="l.key"
          :line="l"
          :tp="tpOf?.(l) ?? null"
          :position="positionOf(l)"
          :selected="selected === l.key"
          @activate="activate"
          @navigate="onNavigate"
          @open-menu="openMenu"
          @open-bot="(k) => emit('openBot', k)"
        />
        <Btn v-if="hiddenCards > 0" class="more" @click="showAll = true">
          {{ t('fq.trade.seeOthers', { n: hiddenCards }) }}
        </Btn>
      </div>
    </template>

    <DataTable
      v-else
      :columns="tableCols"
      :rows="sorted"
      :row-key="(l: TradeLine) => l.key"
      :sort="sort"
      manual-sort
      :container-width="width || undefined"
      :selected-key="selected"
      :row-class="rowClass"
      :empty-text="empty.title"
      max-height="min(70vh, 640px)"
      @update:sort="(s) => (sort = s)"
      @row-activate="(l) => activate(l)"
    >
      <template #cell-pair="{ row }">
        <span class="pair">
          <b>{{ pairLabel(row.pair) }}</b>
          <Badge v-if="row.xyz" kind="xyz" />
          <Badge v-if="row.orphan" kind="orphan" />
          <Badge v-if="row.manual" kind="manual" />
        </span>
      </template>
      <template #cell-bot="{ row }">
        <span v-if="row.orphan" class="dim">{{ t('fq.trade.noBot') }}</span>
        <button v-else type="button" class="botlink" @click.stop="emit('openBot', row.botKey)">
          <ModeMark v-if="row.mode" :mode="row.mode" />
          {{ row.botName }}
        </button>
      </template>
      <template #cell-side="{ row }">
        <DirectionChip :side="row.side" :leverage="row.leverage" :title="sideLabel(row)" />
      </template>
      <template #cell-leverage="{ row }">×{{ row.leverage }}</template>
      <template #cell-trade_id="{ row }">#{{ row.tradeId }}</template>
      <template #cell-dca="{ row }">
        <DcaPips :filled="row.dcaFilled" :max="row.dcaMax ?? row.dcaFilled" />
      </template>
      <template #cell-entry="{ row }">{{ fmt.price(row.entry) }}</template>
      <template #cell-current="{ row }">{{
        row.current === null ? t('fq.ds.notAvailable') : fmt.price(row.current)
      }}</template>
      <template #cell-pnl_abs="{ row }">
        <PnlValue :value="row.pnlAbs" :unknown="row.profitUnknown" :muted="row.stale" />
      </template>
      <template #cell-pnl_pct="{ row }">
        <PnlValue v-if="row.pnlPct !== null" :value="row.pnlPct" unit="%" :muted="row.stale" />
        <span v-else class="dim">{{ t('fq.ds.notAvailable') }}</span>
      </template>
      <template #cell-stake="{ row }">{{ fmt.number(row.stake, 2) }}</template>
      <template #cell-tag="{ row }">{{ row.enterTag ?? '' }}</template>
      <template #cell-liq_distance="{ row }">
        <span v-if="row.liqDistancePct !== null" class="liq">
          <Meter
            :value="row.liqDistancePct"
            :max="50"
            :tone="
              liqTone(row.liqDistancePct) === 'neutral' ? 'neutral' : liqTone(row.liqDistancePct)
            "
            :label="t('fq.col.liq_distance')"
          />
          <span class="num">{{ fmt.percent(row.liqDistancePct, 0, false) }}</span>
        </span>
        <span v-else class="dim">{{ t('fq.ds.notAvailable') }}</span>
      </template>
      <template #cell-duration="{ row }">
        <span class="dur">
          {{ fmt.duration(hoursOf(row)) }}
          <Badge
            v-if="row.percentile !== null && durationTone(row.percentile) !== 'ok'"
            :kind="durationTone(row.percentile) === 'crit' ? 'crit' : 'warn'"
            :label="`p${Math.round(row.percentile)}`"
          />
        </span>
      </template>
      <template #cell-duration_pct="{ row }">{{
        row.percentile === null ? t('fq.ds.notAvailable') : `p${Math.round(row.percentile)}`
      }}</template>
      <template #cell-opened="{ row }">{{ dateOf(row.openMs) }}</template>
      <template #cell-exit_price="{ row }">{{
        row.exitPrice === null ? t('fq.ds.notAvailable') : fmt.price(row.exitPrice)
      }}</template>
      <template #cell-exit_reason="{ row }">
        <span :title="row.exitReason?.raw ?? ''">{{
          row.exitReason ? t(`fq.exit.${row.exitReason.kind}`) : t('fq.origin.unknown')
        }}</span>
      </template>
      <template #cell-closed_at="{ row }">{{ dateOf(row.closeMs) }}</template>
      <template #cell-mae_mfe>{{ t('fq.connection.unavailableDirect') }}</template>
      <template #cell-actions="{ row }">
        <BotActionBar
          context="row"
          :bot-key="row.botKey"
          :position="positionOf(row)"
          :icon-only="width > 0 && width < 820"
          @navigate="(id) => onNavigate(id, row)"
          @open-menu="(a) => openMenu(a, row)"
        />
      </template>
    </DataTable>

    <p v-if="unavailableNote.length > 0" class="note">
      {{ t('fq.connection.unavailableDirect') }}: {{ unavailableNote.join(', ') }}
    </p>
    <div v-if="cursor" class="loadmore">
      <Btn @click="emit('loadMore')">{{ t('fq.trade.loadMore') }}</Btn>
    </div>

    <BotActionMenu
      v-if="menuLine && menuLine.open"
      context="row"
      :bot-key="menuLine.botKey"
      :position="menuPosition"
      :open="menuOpen"
      :anchor="menuAnchor"
      @navigate="(id) => menuLine && onNavigate(id, menuLine)"
      @close="menuOpen = false"
    />
  </div>
</template>

<style scoped>
.tt {
  display: grid;
  gap: var(--s2);
  min-width: 0;
  container-type: inline-size;
}
.bar {
  padding: var(--s2) var(--s3) 0;
  overflow-x: auto;
}
.cards {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--s2);
  padding: var(--s2) var(--s3) var(--s3);
}
.empty {
  padding: var(--s4);
}
.more {
  justify-self: center;
}
.pair {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.botlink {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--fg);
  font: inherit;
  text-align: left;
  /* A long bot name wraps instead of stretching the table */
  max-width: 220px;
  overflow-wrap: anywhere;
  white-space: normal;
  line-height: 1.15;
  cursor: pointer;
}
.botlink:hover {
  color: var(--accent);
  text-decoration: underline;
}
.dim {
  color: var(--fg-3);
}
.liq {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}
.liq :deep(.meter) {
  width: 44px;
}
.dur {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}
.note {
  margin: 0;
  padding: 0 var(--s3);
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.loadmore {
  display: flex;
  justify-content: center;
  padding: var(--s2);
}
</style>
