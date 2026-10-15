import { computed, onBeforeUnmount, ref, toValue, watch, type MaybeRefOrGetter } from 'vue';

import { useFqFleetStore } from '@/datasource/stores/fleet';
import { scopeKey, type ScopeDetail, type ScopeRef } from '@/datasource/types';

import { useDataSource } from './useDataSource';

/** Refresh at most this often while the fleet keeps changing. */
const REFRESH_MS = 5_000;

/**
 * Detail of a scope (a bot, a group or the fleet) from the active source (`GET /scope/{scope}`
 * on the gateway, computed from the bots in direct mode). Keeps the last detail when a refresh
 * fails, flagged `error`, so a panel never goes blank. An answer that arrives after the scope
 * changed is dropped.
 */
export function useScopeDetail(scope: MaybeRefOrGetter<ScopeRef>) {
  const data = useDataSource();
  const fleet = useFqFleetStore();

  const detail = ref<ScopeDetail | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let token = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastLoadAt = 0;

  async function load(): Promise<void> {
    const source = data.source.value;
    if (!source) return;
    const mine = ++token;
    const ref_ = toValue(scope);
    loading.value = true;
    try {
      const d = await source.query.scope(ref_);
      if (mine !== token) return;
      detail.value = d;
      error.value = null;
    } catch (e) {
      if (mine !== token) return;
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      if (mine === token) loading.value = false;
      lastLoadAt = Date.now();
    }
  }

  function schedule(): void {
    if (timer) return;
    const wait = Math.max(0, REFRESH_MS - (Date.now() - lastLoadAt));
    timer = setTimeout(() => {
      timer = undefined;
      void load();
    }, wait);
  }

  watch(
    () => scopeKey(toValue(scope)),
    () => {
      detail.value = null;
      void load();
    },
    { immediate: true },
  );
  watch(data.source, () => void load());
  watch(
    () => fleet.lastSeq,
    () => schedule(),
  );

  onBeforeUnmount(() => {
    token += 1;
    if (timer) clearTimeout(timer);
  });

  return { detail, loading, error, reload: load, stale: computed(() => error.value !== null) };
}
