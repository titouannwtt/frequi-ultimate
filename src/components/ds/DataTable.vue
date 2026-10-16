<script setup lang="ts" generic="Row extends object">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import DsIcon from './DsIcon.vue';
import {
  sortRows,
  virtualWindow,
  visibleColumns,
  VIRTUAL_THRESHOLD,
  type ColumnDef,
  type SortState,
} from './lib/table';

/**
 * Table with a column registry, container-width responsive columns (`hideBelow`, measured with a
 * ResizeObserver on the table container, so a resized panel stays readable), sort, sticky header
 * and sum row, group (day) rows and virtual scrolling above 100 rows
 * (docs/redesign/02-design.md, sections 5.1 and 14).
 *
 * The order of the rows never changes by itself during a tick: sorting only happens on the
 * `sort` state. Hover freezing is the job of the caller (FleetTable, `freezeOnHover`).
 */
const props = withDefaults(
  defineProps<{
    columns: ColumnDef<Row>[];
    rows: Row[];
    /** Name of the key property of a row, or a function returning a unique key. */
    rowKey: keyof Row | ((row: Row) => string | number);
    /** Sort state; when omitted the table keeps its own. */
    sort?: SortState | null;
    /** Sorted by the caller (server side): the table only shows the state. */
    manualSort?: boolean;
    /** Force virtual scrolling on or off; by default it is on above 100 rows. */
    virtual?: boolean;
    stickyHeader?: boolean;
    /** Values of the sum row (sticky under the header), by column id. */
    summary?: Record<string, string | number> | null;
    summaryLabel?: string;
    /** Group rows (days, bot groups): the key changes, a group row is inserted. */
    groupBy?: (row: Row) => string;
    rowClass?: (row: Row) => string | string[] | Record<string, boolean> | undefined;
    /** Rows can be activated with a click or Enter/Space. */
    activatable?: boolean;
    /** Key of the selected row. */
    selectedKey?: string | number | null;
    /** Container width override in px (tests, previews); otherwise measured. */
    containerWidth?: number;
    /** Height of a row in px for the virtual window; read from the `--row` token by default. */
    rowHeight?: number;
    /** Max height of the scrolling area (virtual tables need a bounded one). */
    maxHeight?: string;
    caption?: string;
    emptyText?: string;
  }>(),
  {
    virtual: undefined,
    stickyHeader: true,
    activatable: true,
    summaryLabel: 'Σ',
    maxHeight: 'min(70vh, 640px)',
  },
);

const emit = defineEmits<{
  rowActivate: [row: Row, key: string | number];
  sort: [state: SortState | null];
  'update:sort': [state: SortState | null];
}>();

const { t } = useI18n();

const root = ref<HTMLElement | null>(null);
const measuredWidth = ref(0);
const measuredHeight = ref(0);
const measuredRow = ref(30);
const scrollTop = ref(0);

function keyOf(row: Row): string | number {
  return typeof props.rowKey === 'function'
    ? props.rowKey(row)
    : (row[props.rowKey] as unknown as string | number);
}

// --- Responsive columns -------------------------------------------------------------------
const width = computed(() => props.containerWidth ?? measuredWidth.value);
const cols = computed(() => visibleColumns(props.columns, width.value));
const hiddenCount = computed(() => props.columns.length - cols.value.length);

// --- Sort ---------------------------------------------------------------------------------
const localSort = ref<SortState | null>(null);
const activeSort = computed(() => (props.sort !== undefined ? props.sort : localSort.value));

function cellValue(row: Row, col: ColumnDef<Row>): unknown {
  return col.value ? col.value(row) : (row as Record<string, unknown>)[col.id];
}

function sortValueOf(row: Row, id: string): unknown {
  const col = props.columns.find((c) => c.id === id);
  if (!col) {
    return undefined;
  }
  return col.sortValue ? col.sortValue(row) : cellValue(row, col);
}

const sorted = computed(() =>
  props.manualSort ? props.rows : sortRows(props.rows, activeSort.value, sortValueOf),
);

function toggleSort(col: ColumnDef<Row>) {
  if (!col.sortable) {
    return;
  }
  const current = activeSort.value;
  const first = col.firstSort ?? (col.align === 'left' || col.ui ? 'asc' : 'desc');
  const second = first === 'asc' ? 'desc' : 'asc';
  let next: SortState | null;
  if (!current || current.id !== col.id) {
    next = { id: col.id, dir: first };
  } else if (current.dir === first) {
    next = { id: col.id, dir: second };
  } else {
    next = null;
  }
  localSort.value = next;
  emit('update:sort', next);
  emit('sort', next);
}

function ariaSort(col: ColumnDef<Row>): 'ascending' | 'descending' | 'none' | undefined {
  if (!col.sortable) {
    return undefined;
  }
  const s = activeSort.value;
  return s && s.id === col.id ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none';
}

// --- Flat list (rows and group rows) --------------------------------------------------------
type Item =
  | { type: 'group'; key: string; label: string }
  | { type: 'row'; key: string | number; row: Row };

const items = computed<Item[]>(() => {
  const out: Item[] = [];
  let lastGroup: string | undefined;
  // A group can come back when the sort does not follow it (journal grouped by day, sorted by P&L)
  const occurrences = new Map<string, number>();
  for (const row of sorted.value) {
    if (props.groupBy) {
      const g = props.groupBy(row);
      if (g !== lastGroup) {
        const n = occurrences.get(g) ?? 0;
        occurrences.set(g, n + 1);
        out.push({ type: 'group', key: `g:${g}:${n}`, label: g });
        lastGroup = g;
      }
    }
    out.push({ type: 'row', key: keyOf(row), row });
  }
  return out;
});

// --- Virtual scrolling ------------------------------------------------------------------------
const isVirtual = computed(() => props.virtual ?? props.rows.length > VIRTUAL_THRESHOLD);
const rowPx = computed(() => props.rowHeight ?? measuredRow.value);
const win = computed(() => {
  if (!isVirtual.value) {
    return { start: 0, end: items.value.length, padTop: 0, padBottom: 0 };
  }
  return virtualWindow({
    count: items.value.length,
    rowHeight: rowPx.value,
    scrollTop: scrollTop.value,
    viewHeight: measuredHeight.value || 400,
  });
});
const shown = computed(() => items.value.slice(win.value.start, win.value.end));

function onScroll(event: Event) {
  scrollTop.value = (event.target as HTMLElement).scrollTop;
}

// --- Measuring ---------------------------------------------------------------------------------
let observer: ResizeObserver | undefined;

function measure() {
  const el = root.value;
  if (!el) {
    return;
  }
  measuredWidth.value = el.clientWidth;
  measuredHeight.value = el.clientHeight;
  const token = parseFloat(getComputedStyle(el).getPropertyValue('--row'));
  if (Number.isFinite(token) && token > 0) {
    measuredRow.value = token;
  }
}

onMounted(() => {
  measure();
  if (typeof ResizeObserver !== 'undefined' && root.value) {
    observer = new ResizeObserver(measure);
    observer.observe(root.value);
  }
});
onBeforeUnmount(() => observer?.disconnect());

// A shorter list must not leave the window past its end
watch(
  () => items.value.length,
  async () => {
    await nextTick();
    if (root.value && isVirtual.value) {
      scrollTop.value = root.value.scrollTop;
    }
  },
);

// --- Rendering helpers ---------------------------------------------------------------------------
function cellText(row: Row, col: ColumnDef<Row>): string {
  const v = cellValue(row, col);
  if (col.format) {
    return col.format(v, row);
  }
  return v === null || v === undefined ? '' : String(v);
}

// A control inside a cell (row action, link, menu trigger) owns its own click and keys
const INTERACTIVE =
  'button, a, input, select, textarea, summary, label, [role="button"], [role="link"], [role="menuitem"], [role="checkbox"], [role="switch"], [tabindex]';

function fromInnerControl(event: Event): boolean {
  const row = event.currentTarget as Element | null;
  const target = event.target as Element | null;
  const control = target?.closest?.(INTERACTIVE);
  return !!row && !!control && control !== row && row.contains(control);
}

function activate(item: Item, event?: Event) {
  if (event && fromInnerControl(event)) {
    return;
  }
  if (props.activatable && item.type === 'row') {
    emit('rowActivate', item.row, item.key);
  }
}

function onRowKeydown(event: KeyboardEvent, item: Item) {
  if ((event.key === 'Enter' || event.key === ' ') && !fromInnerControl(event)) {
    event.preventDefault();
    activate(item);
  }
}

defineExpose({
  visibleColumnIds: () => cols.value.map((c) => c.id),
  scrollToTop: () => root.value?.scrollTo({ top: 0 }),
});
</script>

<template>
  <div
    ref="root"
    class="dt-wrap"
    :class="{ virtual: isVirtual }"
    :style="isVirtual ? { maxHeight } : undefined"
    :data-hidden-columns="hiddenCount"
    @scroll.passive="onScroll"
  >
    <table class="tbl" :aria-rowcount="items.length + 1">
      <caption v-if="caption" class="sr">
        {{
          caption
        }}
      </caption>
      <thead>
        <tr>
          <th
            v-for="col in cols"
            :key="col.id"
            class="colh"
            :class="{ l: col.align === 'left', c: col.align === 'center', sticky: stickyHeader }"
            :style="col.width ? { width: col.width } : undefined"
            :aria-sort="ariaSort(col)"
            :title="col.title"
          >
            <button v-if="col.sortable" type="button" class="sort" @click="toggleSort(col)">
              {{ col.label }}
              <DsIcon
                v-if="activeSort && activeSort.id === col.id"
                :name="activeSort.dir === 'asc' ? 'arrow-up' : 'arrow-down'"
                :size="13"
              />
            </button>
            <template v-else>{{ col.label }}</template>
          </th>
        </tr>
        <tr v-if="summary" class="sigma">
          <th
            v-for="(col, ci) in cols"
            :key="col.id"
            scope="col"
            :class="{ l: col.align === 'left' || ci === 0, c: col.align === 'center', num: ci > 0 }"
          >
            <template v-if="ci === 0 && summary[col.id] === undefined">{{ summaryLabel }}</template>
            <template v-else>{{ summary[col.id] ?? '' }}</template>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="win.padTop > 0" class="pad" aria-hidden="true">
          <td :colspan="cols.length" :style="{ height: win.padTop + 'px', padding: 0 }"></td>
        </tr>
        <template v-for="item in shown" :key="item.key">
          <tr v-if="item.type === 'group'" class="grp">
            <td :colspan="cols.length" class="l ui">
              <slot name="group" :label="item.label">{{ item.label }}</slot>
            </td>
          </tr>
          <tr
            v-else
            :class="[
              rowClass?.(item.row),
              {
                sel: selectedKey !== undefined && selectedKey !== null && selectedKey === item.key,
                act: activatable,
              },
            ]"
            :tabindex="activatable ? 0 : undefined"
            :aria-selected="
              selectedKey !== undefined && selectedKey !== null
                ? selectedKey === item.key
                : undefined
            "
            @click="activate(item, $event)"
            @keydown="onRowKeydown($event, item)"
          >
            <td
              v-for="col in cols"
              :key="col.id"
              :class="{ l: col.align === 'left', c: col.align === 'center', ui: col.ui }"
            >
              <slot
                :name="`cell-${col.id}`"
                :row="item.row"
                :value="cellValue(item.row, col)"
                :column="col"
                >{{ cellText(item.row, col) }}</slot
              >
            </td>
          </tr>
        </template>
        <tr v-if="win.padBottom > 0" class="pad" aria-hidden="true">
          <td :colspan="cols.length" :style="{ height: win.padBottom + 'px', padding: 0 }"></td>
        </tr>
        <tr v-if="items.length === 0" class="none">
          <td :colspan="cols.length" class="l ui">
            <slot name="empty">{{ emptyText ?? t('fq.ds.pane.empty') }}</slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.dt-wrap {
  width: 100%;
  height: 100%;
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
  text-align: right;
  padding: 0 8px;
  height: var(--th-h);
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
  background: var(--bg-1);
  color: var(--th-color);
  font-weight: var(--th-weight);
}
th.sticky {
  position: sticky;
  top: 0;
  z-index: 3;
}
th.l,
td.l {
  text-align: left;
}
th.c,
td.c {
  text-align: center;
}
th[aria-sort='ascending'],
th[aria-sort='descending'] {
  color: var(--fg);
}
.sort {
  background: none;
  border: 0;
  padding: 0;
  color: inherit;
  font: inherit;
  text-transform: inherit;
  letter-spacing: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  position: relative;
}
.sort:hover {
  color: var(--fg);
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
td.ui {
  font-family: var(--font-ui);
}
tbody tr {
  transition: background var(--d-instant);
  position: relative;
}
tbody tr:hover:not(.grp):not(.pad) {
  background: var(--bg-2);
}
tbody tr.act {
  cursor: pointer;
}
tbody tr.sel {
  background: var(--accent-w);
}
/* Real-money rows: violet edge; dry rows: dashed grey edge */
tbody tr.is-live td:first-child {
  box-shadow: inset 2px 0 0 var(--live);
}
tbody tr.is-dry td:first-child {
  box-shadow: inset 2px 0 0 color-mix(in srgb, var(--dry) 50%, transparent);
}
tbody tr.stale td {
  background-image: var(--stale-hatch);
  color: var(--fg-3);
}
tbody tr.offline td {
  opacity: 0.62;
  background-image: var(--off-hatch);
}
tbody tr.offline td:first-child {
  opacity: 1;
}
tbody tr.busy td {
  opacity: 0.6;
}
tr.orphan td {
  background: var(--crit-w);
}
/* Sum row sticks under the header */
tr.sigma th {
  position: sticky;
  top: var(--th-h);
  z-index: 2;
  background: var(--bg-2);
  font-weight: 600;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
  text-transform: none;
  letter-spacing: 0;
  color: var(--fg);
  font-size: var(--t-sm);
  height: var(--row);
}
tr.grp td {
  background: color-mix(in srgb, var(--bg-2) 60%, var(--bg-1));
  color: var(--fg-2);
  font-weight: 600;
  position: sticky;
  top: var(--th-h);
  z-index: 1;
}
.none td {
  color: var(--fg-3);
  height: calc(var(--row) * 1.5);
  text-align: center;
}
@media (max-width: 599px), (pointer: coarse) {
  /* 44 px touch target around the small sort label (the header stays 36 px high) */
  .sort::before {
    content: '';
    position: absolute;
    inset: -14px -10px;
  }
}
</style>
