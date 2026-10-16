import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import { orderModel, type OrderModel } from '@/components/fq/lib/orders';
import type { BotKey, Side } from '@/gateway/types.gen';

import { useSourceQuery } from './useSourceQuery';

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
      return source.query.tradeOrders(key, id);
    },
    () => `${toValue(botKey)}/${toValue(tradeId)}`,
  );
  const model = computed<OrderModel | null>(() =>
    q.data.value ? orderModel(q.data.value, toValue(side)) : null,
  );
  return {
    model,
    loading: q.loading,
    available: computed(() => q.data.value !== null),
    reload: q.reload,
  };
}
