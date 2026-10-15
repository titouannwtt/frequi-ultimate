import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { Health } from '@/gateway/types.gen';

import type { Collections } from '../protocol/apply';
import type { StateUpdate } from '../types';
import { applyStateUpdate } from './apply';

/** System health (`health` channel): level, reasons, budgets. A single entity. */
export const useFqHealthStore = defineStore('fqHealth', () => {
  const collections = ref<Collections>({ health: {} });
  const unavailable = ref<string | null>(null);

  // A single entity; the key it travels under does not matter.
  const health = computed<Health | null>(
    () =>
      (Object.values(collections.value.health ?? {})[0] as unknown as Health | undefined) ?? null,
  );

  function apply(u: StateUpdate) {
    applyStateUpdate(collections.value, ['health'], u);
    unavailable.value = null;
  }

  function markUnavailable(reason: string) {
    unavailable.value = reason;
  }

  function reset() {
    collections.value = { health: {} };
    unavailable.value = null;
  }

  return { health, unavailable, apply, markUnavailable, reset };
});
