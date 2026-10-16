import { onBeforeUnmount, ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue';

import type { DataSource } from '@/datasource/types';

import { useDataSource } from './useDataSource';
import { useVisibleInterval } from './useVisibleInterval';

export interface SourceQueryOptions {
  /** Refresh period while the tab is visible; omit for a one-shot query per key. */
  refreshMs?: number;
  /** A source to use instead of the active one (previews, tests); null/undefined: the active one. */
  source?: () => DataSource | null | undefined;
}

export interface SourceQuery<T> {
  data: ShallowRef<T | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  reload: () => Promise<void>;
}

/**
 * One read of the active data source, re-run when its key changes, when the source changes and on
 * a visible-tab timer. The last answer is kept when a refresh fails (`error` is then set and the
 * view marks the values stale instead of going blank), and an answer that arrives after the key
 * changed is dropped. `run` returns null to stay idle (nothing to ask yet).
 */
export function useSourceQuery<T>(
  run: (source: DataSource) => Promise<T> | null,
  key: () => string,
  opts: SourceQueryOptions = {},
): SourceQuery<T> {
  const data = useDataSource();
  const result = shallowRef<T | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let token = 0;

  async function load(): Promise<void> {
    const source = opts.source?.() ?? data.source.value;
    const mine = ++token;
    const pending = source ? run(source) : null;
    if (!pending) {
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const value = await pending;
      if (mine !== token) return;
      result.value = value;
      error.value = null;
    } catch (e) {
      if (mine !== token) return;
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      if (mine === token) loading.value = false;
    }
  }

  watch(
    key,
    () => {
      // A new key is a different question: do not show the old answer under it
      result.value = null;
      error.value = null;
      void load();
    },
    { immediate: true },
  );
  watch(
    () => opts.source?.() ?? data.source.value,
    () => void load(),
  );
  if (opts.refreshMs) useVisibleInterval(() => load(), opts.refreshMs, { runOnVisible: true });

  onBeforeUnmount(() => {
    token += 1;
  });

  return { data: result, loading, error, reload: load };
}
