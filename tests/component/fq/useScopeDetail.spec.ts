import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

import { useScopeDetail } from '../../../src/composables/useScopeDetail';
import type { ScopeDetail, ScopeRef } from '../../../src/datasource/types';

const held = vi.hoisted(() => ({ query: null as null | ((s: ScopeRef) => Promise<unknown>) }));
vi.mock('../../../src/composables/useDataSource', async () => {
  const { computed } = await import('vue');
  return {
    useDataSource: () => ({
      source: computed(() => ({ query: { scope: (s: ScopeRef) => held.query!(s) } })),
    }),
  };
});

const detailOf = (id: string) =>
  ({
    scope: { kind: 'bot', botKey: id },
    bots: [],
    positions: [],
    totals: [],
  }) as unknown as ScopeDetail;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

function host(scope: { value: ScopeRef }) {
  let api!: ReturnType<typeof useScopeDetail>;
  const C = defineComponent({
    setup() {
      api = useScopeDetail(() => scope.value);
      return () => null;
    },
  });
  const w = mount(C, { global: { plugins: [createPinia()] } });
  return { api: () => api, w };
}

describe('useScopeDetail', () => {
  it('keeps the last detail when a refresh fails, flagged stale, never blank', async () => {
    const scope = ref<ScopeRef>({ kind: 'bot', botKey: 'a' });
    held.query = async () => detailOf('a');
    const { api } = host(scope);
    await vi.advanceTimersByTimeAsync(0);
    expect(api().detail.value).not.toBeNull();
    held.query = async () => Promise.reject(new Error('boom'));
    await api().reload();
    expect(api().detail.value).not.toBeNull();
    expect(api().stale.value).toBe(true);
    held.query = async () => detailOf('a');
    await api().reload();
    expect(api().stale.value).toBe(false);
  });

  it('an answer that arrives after the scope changed is dropped', async () => {
    const scope = ref<ScopeRef>({ kind: 'bot', botKey: 'a' });
    const slow: Array<() => void> = [];
    held.query = (s) =>
      new Promise((res) => {
        slow.push(() => res(detailOf(s.kind === 'bot' ? s.botKey : 'x')));
      });
    const { api } = host(scope);
    await vi.advanceTimersByTimeAsync(0);
    scope.value = { kind: 'bot', botKey: 'b' };
    await vi.advanceTimersByTimeAsync(0);
    expect(slow).toHaveLength(2);
    // The answer for "b" arrives first, then the late one for "a"
    slow[1]!();
    await vi.advanceTimersByTimeAsync(0);
    slow[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect((api().detail.value!.scope as { botKey: string }).botKey).toBe('b');
  });
});
