/**
 * Pure helpers of DataTable: sort, responsive columns, virtual window.
 */

export type SortDir = 'asc' | 'desc';

export interface SortState {
  id: string;
  dir: SortDir;
}

export interface ColumnDef<Row = never> {
  id: string;
  /** Header text (already translated). */
  label: string;
  align?: 'left' | 'right' | 'center';
  /** CSS width of the column, for example `64px` or `1fr`-like `auto`. */
  width?: string;
  /** Hidden when the table container is narrower than this many px. */
  hideBelow?: number;
  sortable?: boolean;
  /** Value used to sort; defaults to `value`. */
  sortValue?: (row: Row) => unknown;
  /** Raw value of the cell; defaults to `row[id]`. */
  value?: (row: Row) => unknown;
  /** Plain text rendering of the cell when no `cell-<id>` slot is given. */
  format?: (value: unknown, row: Row) => string;
  /** Use the UI font instead of the monospace one (names, text). */
  ui?: boolean;
  /** Tooltip of the header. */
  title?: string;
  /** First direction when the header is clicked; numeric right-aligned columns default to desc. */
  firstSort?: SortDir;
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function isMissing(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
}

/** Compare two cell values; missing values are handled by the caller (always last). */
export function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime();
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b);
  }
  return collator.compare(String(a), String(b));
}

/** Stable sort; missing values go last whatever the direction. */
export function sortRows<Row>(
  rows: readonly Row[],
  sort: SortState | null,
  getValue: (row: Row, columnId: string) => unknown,
): Row[] {
  if (!sort) {
    return rows.slice();
  }
  const factor = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: getValue(row, sort.id) }))
    .sort((x, y) => {
      const mx = isMissing(x.value);
      const my = isMissing(y.value);
      if (mx || my) {
        return mx && my ? x.index - y.index : mx ? 1 : -1;
      }
      return compareValues(x.value, y.value) * factor || x.index - y.index;
    })
    .map((e) => e.row);
}

/** Columns kept for a container width; a width of 0 or less means not measured, keep all. */
export function visibleColumns<C extends { hideBelow?: number }>(
  columns: readonly C[],
  containerWidth: number,
): C[] {
  if (!(containerWidth > 0)) {
    return columns.slice();
  }
  return columns.filter((c) => c.hideBelow === undefined || containerWidth >= c.hideBelow);
}

export interface VirtualWindow {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
}

/** Rows to render for a scroll position, with overscan; spacers keep the scroll height exact. */
export function virtualWindow(opts: {
  count: number;
  rowHeight: number;
  scrollTop: number;
  viewHeight: number;
  overscan?: number;
}): VirtualWindow {
  const { count, rowHeight } = opts;
  const overscan = opts.overscan ?? 6;
  const first = Math.floor(Math.max(0, opts.scrollTop) / rowHeight);
  const visible = Math.ceil(opts.viewHeight / rowHeight);
  const start = Math.max(0, Math.min(count, first - overscan));
  const end = Math.max(start, Math.min(count, first + visible + overscan));
  return { start, end, padTop: start * rowHeight, padBottom: (count - end) * rowHeight };
}

/** Number of rows above which DataTable switches to virtual scrolling. */
export const VIRTUAL_THRESHOLD = 100;
