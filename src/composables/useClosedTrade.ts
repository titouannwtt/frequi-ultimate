import { onBeforeUnmount, ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue';

import { withTimeout } from '@/components/fq/lib/logs';
import { mapClosedTrade } from '@/datasource/direct/mappers';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import type { BotKey, TradeRow } from '@/gateway/types.gen';
import type { ClosedTrade } from '@/types';

import { useDataSource } from './useDataSource';

const TIMEOUT_MS = 10_000;

export interface ClosedTradeLookup {
  /** The closed trade, or null (none asked, not found, or still open). */
  trade: ShallowRef<TradeRow | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
}

/**
 * A closed trade by `(botKey, tradeId)`, for a page that shows a trade the open positions do not
 * hold. The rows the page already has are searched first; otherwise the trade is read from the bot
 * (`GET /trade/{id}` through the proxy, like the Journal sheet does). A trade that is still open
 * is not a closed trade: the lookup gives null. An answer that arrives after the address changed
 * is dropped; a bot that answers for another trade is refused.
 */
export function useClosedTrade(
  botKey: () => BotKey | null,
  tradeId: () => number | null,
  known: () => readonly TradeRow[] = () => [],
): ClosedTradeLookup {
  const data = useDataSource();
  const fleet = useFqFleetStore();
  const trade = shallowRef<TradeRow | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let token = 0;

  async function load(): Promise<void> {
    const mine = ++token;
    const key = botKey();
    const id = tradeId();
    error.value = null;
    if (!key || id === null) {
      trade.value = null;
      loading.value = false;
      return;
    }
    const held = known().find((r) => r.bot_key === key && r.trade_id === id && r.close_ms != null);
    if (held) {
      trade.value = held;
      loading.value = false;
      return;
    }
    if (trade.value && (trade.value.bot_key !== key || trade.value.trade_id !== id)) {
      trade.value = null;
    }
    const source = data.source.value;
    if (!source) return;
    loading.value = true;
    try {
      const raw = await withTimeout(
        source.proxy<ClosedTrade>(key, 'GET', `/trade/${id}`, undefined, {
          timeoutMs: TIMEOUT_MS,
        }),
        TIMEOUT_MS,
      );
      if (mine !== token) return;
      if (raw.trade_id !== id) throw new Error('trade id mismatch');
      const row = mapClosedTrade(raw, key, fleet.bots[key]?.identity.mode ?? 'live');
      trade.value = row.close_ms != null ? row : null;
    } catch (e) {
      if (mine !== token) return;
      trade.value = null;
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      if (mine === token) loading.value = false;
    }
  }

  watch(() => [botKey(), tradeId(), data.source.value, known().length] as const, load, {
    immediate: true,
  });
  onBeforeUnmount(() => {
    token += 1;
  });
  return { trade, loading, error };
}
