import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import { orderModel, type OrderModel } from '@/components/fq/lib/orders';
import type { DataSource, OrderRow } from '@/datasource/types';
import type { BotKey, Side } from '@/gateway/types.gen';

import { useSourceQuery } from './useSourceQuery';

/** A drawer and a chart ask for the orders of the same trade together: one request serves both. */
const SHARE_MS = 5_000;
const recent = new WeakMap<
  DataSource,
  Map<string, { at: number; p: Promise<OrderRow[] | null> }>
>();

function sharedOrders(source: DataSource, key: BotKey, id: number): Promise<OrderRow[] | null> {
  let byKey = recent.get(source);
  if (!byKey) recent.set(source, (byKey = new Map()));
  const k = `${key}/${id}`;
  const hit = byKey.get(k);
  if (hit && Date.now() - hit.at < SHARE_MS) return hit.p;
  const p = source.query.tradeOrders!(key, id);
  byKey.set(k, { at: Date.now(), p });
  // A failed read is not shared: the next one tries again
  void p.then(
    (rows) => rows === null && byKey.get(k)?.p === p && byKey.delete(k),
    () => byKey.get(k)?.p === p && byKey.delete(k),
  );
  return p;
}

/**
 * Orders of one trade (DCA ladder levels and fills), read once per trade from the active source.
 * `available` is false when the source could not give them: the drawer then says so.
 */
export function useTradeOrders(
  botKey: MaybeRefOrGetter<BotKey | null>,
  tradeId: MaybeRefOrGetter<number | null>,
  side: MaybeRefOrGetter<Side>,
) {
  const q = useSourceQuery(
    (source) => {
      const key = toValue(botKey);
      const id = toValue(tradeId);
      if (!key || id === null || !source.query.tradeOrders) return null;
      return sharedOrders(source, key, id);
    },
    () => `${toValue(botKey)}/${toValue(tradeId)}`,
  );
  const model = computed<OrderModel | null>(() =>
    q.data.value ? orderModel(q.data.value, toValue(side)) : null,
  );
  return {
    model,
    /** The rows as the source gave them (null: none read, or they could not be read). */
    rows: computed<OrderRow[] | null>(() => q.data.value),
    loading: q.loading,
    available: computed(() => q.data.value !== null),
    reload: q.reload,
  };
}
