import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { BotKey, BotRow, WalletRow } from '@/gateway/types.gen';

import type { Collections } from '../protocol/apply';
import type { StateUpdate } from '../types';
import { applyStateUpdate } from './apply';

const NAMES = ['bots', 'wallets'] as const;

/** Bots and wallets, normalised by key and fed by the active source (`fleet` channel). */
export const useFqFleetStore = defineStore('fqFleet', () => {
  const collections = ref<Collections>({ bots: {}, wallets: {} });
  /** At least one snapshot (live or cached) was applied. */
  const loaded = ref(false);
  /** The channel is served by no source right now (reason), or null. */
  const unavailable = ref<string | null>(null);
  const lastSeq = ref(0);

  const bots = computed(() => collections.value.bots as unknown as Record<BotKey, BotRow>);
  const wallets = computed(() => collections.value.wallets as unknown as Record<string, WalletRow>);
  const list = computed<BotRow[]>(() => Object.values(bots.value));

  function apply(u: StateUpdate) {
    applyStateUpdate(collections.value, NAMES, u);
    lastSeq.value = u.seq;
    loaded.value = true;
    unavailable.value = null;
  }

  function markUnavailable(reason: string) {
    unavailable.value = reason;
  }

  function reset() {
    collections.value = { bots: {}, wallets: {} };
    loaded.value = false;
    unavailable.value = null;
    lastSeq.value = 0;
  }

  return { bots, wallets, list, loaded, unavailable, lastSeq, apply, markUnavailable, reset };
});
