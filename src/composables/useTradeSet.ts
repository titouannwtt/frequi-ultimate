import { onBeforeUnmount, ref, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue';

import type { JournalTrade } from '@/components/fq/lib/journal';
import type { DataSource, TradeQuery } from '@/datasource/types';

import { useDataSource } from './useDataSource';

/** Pages read at most, and rows kept at most: the analysis never pulls an unbounded history. */
const MAX_PAGES = 20;
const MAX_ROWS = 5_000;

/**
 * The closed trades of a Journal query, all pages up to a cap (`GET /trades` with the cursor on
 * the gateway, the loaded history in direct mode). It feeds the analysis panels (distribution,
 * DCA depth, exit reasons), which need the whole filtered set and not one page.
 *
 * `complete` is false when the source says its figures only cover what it loaded (direct mode) or
 * when the cap was reached: the panels then say so instead of presenting a partial set as the whole.
 * A `null` query keeps the composable idle. An answer for an older query is dropped.
 */
export function useTradeSet(
  query: MaybeRefOrGetter<TradeQuery | null | undefined>,
  opts: { source?: () => DataSource | null | undefined } = {},
) {
  const data = useDataSource();
  const trades = shallowRef<JournalTrade[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const complete = ref(true);
  const truncated = ref(false);
  let token = 0;

  async function load(): Promise<void> {
    const q = toValue(query);
    const source = opts.source?.() ?? data.source.value;
    const mine = ++token;
    if (!q || !source) {
      trades.value = [];
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const rows: JournalTrade[] = [];
      let cursor: string | null = q.cursor ?? null;
      let allComplete = true;
      let pages = 0;
      let capped = false;
      do {
        const page = await source.query.trades({ ...q, cursor, limit: q.limit ?? 500 });
        if (mine !== token) return;
        rows.push(...(page.items as JournalTrade[]));
        allComplete = allComplete && page.complete;
        cursor = page.nextCursor;
        pages += 1;
        if (cursor && (pages >= MAX_PAGES || rows.length >= MAX_ROWS)) {
          capped = true;
          break;
        }
      } while (cursor);
      trades.value = rows;
      complete.value = allComplete && !capped;
      truncated.value = capped;
      error.value = null;
    } catch (e) {
      if (mine !== token) return;
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      if (mine === token) loading.value = false;
    }
  }

  // The query is a small plain object: its JSON is the change signal, no deep watcher on rows
  watch(
    () => {
      const q = toValue(query);
      return q ? JSON.stringify(q) : '';
    },
    () => void load(),
    { immediate: true },
  );
  watch(
    () => opts.source?.() ?? data.source.value,
    () => void load(),
  );

  onBeforeUnmount(() => {
    token += 1;
  });

  return { trades, loading, error, complete, truncated, reload: load };
}
