import { computed, toValue, watch, type MaybeRefOrGetter } from 'vue';

import type { JournalTrade } from '@/components/fq/lib/journal';
import { useFqEventsStore } from '@/datasource/stores/events';
import type { BotKey } from '@/gateway/types.gen';

import { useSourceQuery } from './useSourceQuery';

/** Closed trades read for a chart: the latest ones, which is what its candles can show. */
export const CLOSED_ON_PAIR_LIMIT = 300;
const REFRESH_MS = 120_000;

/**
 * The closed trades of one bot on one pair, newest first, read through the same query as the
 * Journal (`trades` with the status `closed`: the gateway's cursor, or the history the direct
 * mode already loaded). One page, no more: a chart shows a few days of candles. The list is read
 * again when this bot closes a trade.
 */
export function useClosedOnPair(
  botKey: MaybeRefOrGetter<BotKey | null>,
  pair: MaybeRefOrGetter<string | null>,
) {
  const events = useFqEventsStore();
  const q = useSourceQuery(
    (source) => {
      const key = toValue(botKey);
      const p = toValue(pair);
      if (!key || !p) return null;
      return source.query
        .trades({
          status: 'closed',
          bots: [key],
          pair: p,
          sort: 'close_ms',
          order: 'desc',
          limit: CLOSED_ON_PAIR_LIMIT,
          mode: ['live', 'dry', 'replay'],
        })
        .then((page) => page.items as JournalTrade[]);
    },
    () => `${toValue(botKey)}|${toValue(pair)}`,
    { refreshMs: REFRESH_MS },
  );
  watch(
    () => events.counter,
    () => {
      const e = events.lastEvent;
      if (e && e.kind === 'exit_fill' && e.bot_key === toValue(botKey)) void q.reload();
    },
  );
  return {
    trades: computed<JournalTrade[]>(() => q.data.value ?? []),
    loading: q.loading,
    error: q.error,
  };
}
