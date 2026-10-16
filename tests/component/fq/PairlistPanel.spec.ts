import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

import ActionDialogHost from '../../../src/components/fq/ActionDialogHost.vue';
import PairlistPanel from '../../../src/components/fq/PairlistPanel.vue';
import { useToaster } from '../../../src/composables/useToaster';
import { useActionDialog } from '../../../src/composables/useActionDialog';
import { useFqConnectionStore } from '../../../src/datasource/stores/connection';
import type { DataSource } from '../../../src/datasource/types';
import { holdFor, mountFq, setupWorld, teardownWorld, type FqWorld } from './helpers';

/**
 * The pairlist tab of the Bot page (02 section 3.2): methods, whitelist, and an EDITABLE
 * blacklist. A blacklist change is a mutation of the bot: it goes through the one confirmation
 * dialog for this bot, and nothing but GET ever leaves the panel itself.
 */
let world: FqWorld;
let bot: string;
let calls: Array<{ method: string; path: string }>;
let blacklist: string[];

function source(): DataSource {
  return {
    ...world.fake.source,
    proxy: vi.fn(async (_key: string, method: string, path: string) => {
      calls.push({ method, path });
      if (path === '/whitelist') {
        return {
          method: ['VolumePairList', 'AgeFilter'],
          whitelist: ['ETH/USDC:USDC', 'BTC/USDC:USDC'],
          pipeline: [
            { handler: 'VolumePairList', count_after: 40 },
            { handler: 'AgeFilter', count_after: 38 },
          ],
          total_market_pairs: 190,
        };
      }
      if (path === '/blacklist') return { blacklist: [...blacklist] };
      throw new Error(`unexpected ${method} ${path}`);
    }),
  } as unknown as DataSource;
}

beforeEach(() => {
  world = setupWorld();
  calls = [];
  blacklist = ['SHIB/USDC:USDC'];
  bot = world.fixture.bots.find((b) => b.identity.mode === 'live')!.bot_key;
  // The seeded stores have no live connection: make the bot actionable
  const conn = useFqConnectionStore();
  conn.setStatus({ ...conn.status, state: 'live' });
});
afterEach(teardownWorld);

function mountPanel() {
  const src = source();
  const Harness = defineComponent({
    setup: () => () =>
      h('div', [
        h(PairlistPanel, { botKey: bot, source: src }),
        h(ActionDialogHost, { source: world.fake.source, inline: true }),
      ]),
  });
  return { w: mountFq(Harness, { attachTo: document.body }), src };
}

describe('PairlistPanel', () => {
  it('lists the methods with the pipeline, the whitelist and the blacklist', async () => {
    const { w } = mountPanel();
    await flushPromises();
    expect(w.get('[data-testid=pl-methods]').text()).toContain('VolumePairList');
    expect(w.get('[data-testid=pl-methods]').text()).toContain('38');
    expect(w.get('[data-testid=pl-whitelist]').text()).toContain('ETH/USDC:USDC');
    expect(w.get('[data-testid=pl-blacklist]').text()).toContain('SHIB/USDC:USDC');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('adds a pair only through the confirmation, sent once to this bot, then reads again', async () => {
    const { w } = mountPanel();
    await flushPromises();
    await w.get('[data-testid=pl-input]').setValue('DOGE/USDC:USDC');
    await w.get('[data-testid=pl-add]').trigger('click');
    await nextTick();
    // Nothing is sent yet: the dialog is open on this bot
    expect(world.fake.acts).toHaveLength(0);
    const req = useActionDialog().current.value;
    expect(req?.botKey).toBe(bot);
    expect(req?.action).toEqual({ kind: 'blacklist_add', pairs: ['DOGE/USDC:USDC'] });

    blacklist = ['SHIB/USDC:USDC', 'DOGE/USDC:USDC'];
    await holdFor(w.get('.hold-wrap button.hold'), 1000);
    await flushPromises();
    expect(world.fake.acts).toHaveLength(1);
    expect(world.fake.acts[0]!.botKey).toBe(bot);
    expect(world.fake.acts[0]!.action).toEqual({
      kind: 'blacklist_add',
      pairs: ['DOGE/USDC:USDC'],
    });
    // The panel never wrote by itself, and read the list again once the dialog closed
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    expect(w.get('[data-testid=pl-blacklist]').text()).toContain('DOGE/USDC:USDC');
  });

  it('removing a pair asks for the confirmation of the removal', async () => {
    const { w } = mountPanel();
    await flushPromises();
    await w.get('[data-testid=pl-remove]').trigger('click');
    expect(useActionDialog().current.value?.action).toEqual({
      kind: 'blacklist_remove',
      pairs: ['SHIB/USDC:USDC'],
    });
    expect(world.fake.acts).toHaveLength(0);
  });

  it('does not add an empty entry, and says so when the bot cannot be changed', async () => {
    const { w } = mountPanel();
    await flushPromises();
    expect(w.get('[data-testid=pl-add]').attributes('aria-disabled')).toBe('true');
    // Cached data: actions wait for a live snapshot
    useFqConnectionStore().fromCache = true;
    await w.get('[data-testid=pl-input]').setValue('DOGE/USDC:USDC');
    await w.get('[data-testid=pl-add]').trigger('click');
    expect(useActionDialog().current.value).toBeNull();
    expect(world.fake.acts).toHaveLength(0);
    // ... and the refusal is said, not silent
    const toasts = useToaster().toasts.value;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.kind).toBe('err');
  });
});
