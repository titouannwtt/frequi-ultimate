import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue';

import { exitReasons, type JournalTrade } from '@/components/fq/lib/journal';
import {
  defaultJournalFilters,
  depthMatches,
  hasDepth,
  journalBots,
  journalQuery,
  journalStats,
  periodBounds,
  resolvePair,
  tradesToCsv,
  type JournalFilters,
} from '@/components/fq/lib/journalPage';
import { useFqEventsStore } from '@/datasource/stores/events';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { TradeQuery } from '@/datasource/types';
import type { TradeTotals } from '@/gateway/types.gen';

import { useDataSource } from './useDataSource';
import { useScope } from './useScope';
import { useTradeSet } from './useTradeSet';

/** Rows asked per page of the list; the analysis reads the whole set by pages of 500. */
export const PAGE_SIZE = 100;

// Module level: the filters survive a visit to another page, like the FleetScope they extend
const filters = reactive<JournalFilters>(defaultJournalFilters());

/**
 * State of the Journal page (02 section 3.4): the shared FleetScope, the Journal filters, the query
 * they make, the list read page by page with the server cursor, the whole filtered set for the
 * analysis, the totals and the export. One source of truth for the list, the totals and the three
 * analysis panels: they are all computed from the same query.
 */
export function useJournal() {
  const data = useDataSource();
  const fleet = useFqFleetStore();
  const prefs = useFqPrefsStore();
  const positions = useFqPositionsStore();
  const events = useFqEventsStore();
  const scope = useScope();

  // The instant the relative periods are cut from. It moves when the filters change or when the
  // user refreshes, never by itself: a list that reloaded every minute would lose its place.
  const anchorMs = ref(Date.now());
  const staleSince = ref<number | null>(null);

  const botKeys = computed(() =>
    journalBots(scope.bots.value, fleet.list, filters, scope.mode.value),
  );

  // The pair typed by the user finds its market among the pairs already seen
  const seenPairs = shallowRef<string[]>([]);
  const pair = computed(() =>
    resolvePair(filters.pair, [...new Set([...seenPairs.value, ...positions.list.map((p) => p.pair)])]),
  );

  function queryOf(extra: { cursor?: string | null; limit?: number }): TradeQuery {
    return journalQuery({
      filters: { ...filters, pair: pair.value },
      bots: botKeys.value,
      nowMs: anchorMs.value,
      tz: prefs.settings.tz,
      ...extra,
    });
  }

  /** The query without cursor and limit: its JSON says when everything must be read again. */
  const baseQuery = computed(() => queryOf({}));
  const signature = computed(() => JSON.stringify(baseQuery.value));

  // ---- the list: server cursor, pages appended ----
  const rows = shallowRef<JournalTrade[]>([]);
  const cursor = ref<string | null>(null);
  const totals = ref<TradeTotals | null>(null);
  const complete = ref(true);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let token = 0;

  async function fetchPage(more: boolean): Promise<void> {
    const source = data.source.value;
    const mine = ++token;
    if (!source) {
      rows.value = [];
      return;
    }
    if (botKeys.value.length === 0) {
      rows.value = [];
      cursor.value = null;
      totals.value = null;
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const page = await source.query.trades(
        queryOf({ cursor: more ? cursor.value : null, limit: PAGE_SIZE }),
      );
      if (mine !== token) return;
      const items = page.items as JournalTrade[];
      rows.value = more ? [...rows.value, ...items] : items;
      cursor.value = page.nextCursor;
      if (!more) totals.value = page.totals;
      complete.value = page.complete;
      error.value = null;
    } catch (e) {
      if (mine !== token) return;
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      if (mine === token) loading.value = false;
    }
  }

  // The clock is rebased as soon as a filter changes (synchronously, before the queries are built)
  watch(
    () => JSON.stringify([filters, botKeys.value, prefs.settings.tz]),
    () => (anchorMs.value = Date.now()),
    { flush: 'sync' },
  );
  // Any change of the question starts again from the first page
  watch(
    signature,
    () => {
      staleSince.value = null;
      void fetchPage(false);
    },
    { immediate: true },
  );
  watch(
    () => data.source.value,
    () => void fetchPage(false),
  );

  // ---- the whole filtered set, for the analysis ----
  const analysis = useTradeSet(() =>
    botKeys.value.length === 0 || !data.source.value ? null : queryOf({ limit: 500 }),
  );
  const depthAvailable = computed(() => hasDepth(analysis.trades.value) || hasDepth(rows.value));

  const listRows = computed(() =>
    filters.depth ? rows.value.filter((t) => depthMatches(t, filters.depth)) : rows.value,
  );
  const analysisRows = computed(() =>
    filters.depth
      ? analysis.trades.value.filter((t) => depthMatches(t, filters.depth))
      : analysis.trades.value,
  );

  watch(
    () => [...analysis.trades.value, ...rows.value].length,
    () => {
      const next = new Set(seenPairs.value);
      for (const t of analysis.trades.value) next.add(t.pair);
      for (const t of rows.value) next.add(t.pair);
      if (next.size !== seenPairs.value.length) seenPairs.value = [...next];
    },
  );

  // The reasons offered by the filter: everything seen so far, so choosing one does not hide the others
  const knownReasons = reactive(new Map<string, { label: string; kind: string; trades: number }>());
  watch(analysisRows, (set) => {
    if (filters.exitReason !== null) return;
    knownReasons.clear();
    for (const r of exitReasons(set).rows) {
      const value = r.kind === 'unknown' ? 'unknown' : (r.raws[0] ?? r.key);
      knownReasons.set(value, { label: r.kind === 'custom' ? (r.raws[0] ?? r.key) : r.kind, kind: r.kind, trades: r.trades });
    }
  });

  const stats = computed(() => {
    const b = periodBounds(filters, anchorMs.value, prefs.settings.tz);
    return analysis.loading.value && analysisRows.value.length === 0
      ? null
      : journalStats(analysisRows.value, b, anchorMs.value);
  });
  /** The figures cover less than the filtered set: the history loaded so far, or a capped read. */
  const partial = computed(() => !analysis.complete.value || !complete.value);

  // ---- new closed trades since the list was read ----
  watch(
    () => events.counter,
    () => {
      const e = events.lastEvent;
      if (e && e.kind === 'exit_fill' && e.bot_key && botKeys.value.includes(e.bot_key)) {
        staleSince.value = e.ts_ms;
      }
    },
  );

  function refresh(): void {
    const before = signature.value;
    anchorMs.value = Date.now();
    staleSince.value = null;
    // A period that does not slide (all, a range) gives the same question: read it again anyway
    if (signature.value === before) {
      void fetchPage(false);
      void analysis.reload();
    }
  }

  // ---- export ----
  const exporting = ref(false);
  const exportScope = computed<'all' | 'page'>(() =>
    data.source.value?.query.exportTradesCsv ? 'all' : 'page',
  );
  async function exportCsv(): Promise<string> {
    const source = data.source.value;
    if (source?.query.exportTradesCsv) {
      exporting.value = true;
      try {
        return await source.query.exportTradesCsv(queryOf({}));
      } finally {
        exporting.value = false;
      }
    }
    // Direct mode: the rows on screen (the bots hold no filtered export)
    return tradesToCsv(listRows.value);
  }

  onBeforeUnmount(() => {
    token += 1;
  });

  return {
    filters,
    scope,
    botKeys,
    rows,
    listRows,
    cursor,
    totals,
    loading,
    error,
    complete,
    analysis,
    analysisRows,
    depthAvailable,
    knownReasons,
    stats,
    partial,
    staleSince,
    exporting,
    exportScope,
    loadMore: () => fetchPage(true),
    reload: () => fetchPage(false),
    refresh,
    exportCsv,
    reset: () => Object.assign(filters, defaultJournalFilters()),
  };
}
