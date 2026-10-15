import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { Position } from '@/gateway/types.gen';

import type { Collections } from '../protocol/apply';
import type { StateUpdate } from '../types';
import { applyStateUpdate } from './apply';

/** Key of a position: `trade_id` is only unique per bot (bug B1 came from forgetting it). */
export function positionKey(botKey: string, tradeId: number): string {
  return `${botKey}/${tradeId}`;
}

/** Open positions of every bot, keyed by `bot_key/trade_id` (`positions` channel). */
export const useFqPositionsStore = defineStore('fqPositions', () => {
  const collections = ref<Collections>({ positions: {} });
  const loaded = ref(false);
  const unavailable = ref<string | null>(null);

  const positions = computed(
    () => collections.value.positions as unknown as Record<string, Position>,
  );
  const list = computed<Position[]>(() => Object.values(positions.value));

  function apply(u: StateUpdate) {
    applyStateUpdate(collections.value, ['positions'], u);
    loaded.value = true;
    unavailable.value = null;
  }

  function byBot(botKey: string): Position[] {
    return list.value.filter((p) => p.bot_key === botKey);
  }

  function get(botKey: string, tradeId: number): Position | undefined {
    return positions.value[positionKey(botKey, tradeId)];
  }

  function markUnavailable(reason: string) {
    unavailable.value = reason;
  }

  function reset() {
    collections.value = { positions: {} };
    loaded.value = false;
    unavailable.value = null;
  }

  return { positions, list, loaded, unavailable, apply, byBot, get, markUnavailable, reset };
});
