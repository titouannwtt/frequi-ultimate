import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyReconFailure } from '../../../src/composables/useReconciliation';
import ReconciliationPage from '../../../src/views/fq/tools/ReconciliationPage.vue';
import { mountFq, setFqLocale, setupWorld, teardownWorld } from './helpers';

// The page reads through the active source's proxy: here a script of answers, never a bot
const held = vi.hoisted(() => ({
  proxy: null as null | ((key: string) => Promise<unknown>),
  calls: [] as string[],
}));
vi.mock('../../../src/composables/useDataSource', async () => {
  const { computed } = await import('vue');
  return {
    useDataSource: () => ({
      source: computed(() => ({
        kind: 'gateway',
        proxy: (key: string) => {
          held.calls.push(key);
          return held.proxy!(key);
        },
      })),
    }),
  };
});

beforeEach(() => {
  setupWorld(6);
  held.calls = [];
});
afterEach(teardownWorld);

const apiError = (over: Record<string, unknown>) =>
  Object.assign(new Error('boom'), { name: 'GatewayError', ...over });

describe('classifyReconFailure', () => {
  it('moves to the next bot only when this one does not serve the route', () => {
    expect(classifyReconFailure(apiError({ code: 'not_found', status: 404 })).tryNext).toBe(true);
    expect(classifyReconFailure(new Error('HTTP 404')).tryNext).toBe(true);
    for (const e of [
      apiError({ code: 'timeout', status: null }),
      apiError({ code: 'bot_unreachable', status: 504 }),
      new Error('HTTP 502'),
      new Error('timeout'),
    ]) {
      expect(classifyReconFailure(e).tryNext, String(e)).toBe(false);
    }
  });

  it('tells a first timeout from a failure the gateway keeps for a while', () => {
    expect(classifyReconFailure(apiError({ code: 'bot_unreachable', status: 504 })).kind).toBe(
      'timeout',
    );
    const resting = classifyReconFailure(
      apiError({ code: 'bot_unreachable', status: 504, retryAfterMs: 42_000 }),
    );
    expect(resting).toMatchObject({ kind: 'resting', retryAfterMs: 42_000, tryNext: false });
  });
});

describe('Tools > Reconciliation, when the sweep does not answer', () => {
  it('shows an error with a retry, not a skeleton, and asks one bot only (QA 2026-10-15)', async () => {
    held.proxy = () => Promise.reject(apiError({ code: 'bot_unreachable', status: 504 }));
    const w = mountFq(ReconciliationPage);
    await flushPromises();
    expect(held.calls).toHaveLength(1);
    expect(w.find('[data-testid="recon-error"]').text()).toContain('did not answer in time');
    expect(w.find('.skeleton, [data-skeleton]').exists()).toBe(false);
    expect(w.find('[data-testid="reconciliation"]').exists()).toBe(false);
  });

  it('retries on demand and shows the table once a sweep answers', async () => {
    held.proxy = () => Promise.reject(apiError({ code: 'bot_unreachable', status: 504 }));
    const w = mountFq(ReconciliationPage);
    await flushPromises();
    held.proxy = async () => ({
      generated_at: Date.now() / 1000,
      wallet: '0xAbCd...1234',
      wallets: ['0xAbCd...1234'],
      multi_address: false,
      unresolved_bots: [],
      live_bots: 1,
      coins: [],
      issues: 0,
    });
    await w.find('[data-testid="recon-error"] button').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="recon-error"]').exists()).toBe(false);
    expect(w.find('[data-testid="reconciliation"]').exists()).toBe(true);
  });

  it('tells how long the wallets rest when the gateway keeps the failure, in French too', async () => {
    held.proxy = () =>
      Promise.reject(apiError({ code: 'bot_unreachable', status: 504, retryAfterMs: 41_200 }));
    setFqLocale('fr');
    const w = mountFq(ReconciliationPage);
    await flushPromises();
    expect(w.find('[data-testid="recon-error"]').text()).toContain('42 s');
    expect(held.calls).toHaveLength(1);
  });

  it('goes on to the next bot when one does not have the route', async () => {
    let n = 0;
    held.proxy = () => {
      n += 1;
      return n === 1
        ? Promise.reject(apiError({ code: 'not_found', status: 404 }))
        : Promise.resolve({
            generated_at: Date.now() / 1000,
            wallet: '0xAbCd...1234',
            wallets: [],
            multi_address: false,
            unresolved_bots: [],
            live_bots: 1,
            coins: [],
            issues: 0,
          });
    };
    const w = mountFq(ReconciliationPage);
    await flushPromises();
    expect(held.calls).toHaveLength(2);
    expect(w.find('[data-testid="reconciliation"]').exists()).toBe(true);
  });
});
