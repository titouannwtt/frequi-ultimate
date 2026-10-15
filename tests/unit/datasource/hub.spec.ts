/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { StateHub } from '@/datasource/hub';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { createFrameBatcher } from '@/datasource/stores/apply';
import type { StateUpdate, UnavailableUpdate } from '@/datasource/types';

const isState = (u: StateUpdate | UnavailableUpdate): u is StateUpdate => u.kind !== 'unavailable';

beforeEach(() => {
  setActivePinia(createPinia());
});

function wire() {
  const hub = new StateHub(['bots', 'wallets'], () => 1);
  const store = useFqFleetStore();
  const frames: StateUpdate[] = [];
  // Same path as bind.ts: frames are queued and applied together
  const batcher = createFrameBatcher<StateUpdate>((batch) => batch.forEach((u) => store.apply(u)));
  hub.subscribe((u) => {
    if (!isState(u)) return;
    frames.push(u);
    batcher.push(u);
  });
  // The rAF of the browser is replaced by an explicit flush: the whole batch lands at once
  const set = (name: string, next: Record<string, any>) => {
    hub.set(name, next);
    batcher.flush();
  };
  return { hub, set, store, frames };
}

describe('StateHub -> store: object fields that lose a key (B76)', () => {
  it('a coin whose position closed leaves net_exposure', () => {
    const { set, store } = wire();
    set('wallets', { w1: { wallet_id: 'w1', net_exposure: { BTC: 100, ETH: -50 } } });
    expect((store.wallets as any).w1.net_exposure).toEqual({ BTC: 100, ETH: -50 });

    set('wallets', { w1: { wallet_id: 'w1', net_exposure: { BTC: 100 } } });
    expect((store.wallets as any).w1.net_exposure).toEqual({ BTC: 100 });

    set('wallets', { w1: { wallet_id: 'w1', net_exposure: {} } });
    expect((store.wallets as any).w1.net_exposure).toEqual({});
  });

  it('a key that vanishes from a record of optional groups (freshness) is dropped too', () => {
    const { set, store } = wire();
    set('bots', {
      b: { bot_key: 'b', freshness: { state: { stale: false }, metrics: { stale: false } } },
    });
    set('bots', { b: { bot_key: 'b', freshness: { state: { stale: false } } } });
    expect((store.bots as any).b.freshness).toEqual({ state: { stale: false } });
  });

  it('a field that only gains or changes keys still travels as a plain patch, in one frame', () => {
    const { set, store, frames } = wire();
    set('wallets', { w1: { wallet_id: 'w1', net_exposure: { BTC: 100 } } });
    const before = frames.length;
    set('wallets', { w1: { wallet_id: 'w1', net_exposure: { BTC: 120, ETH: 5 } } });
    expect(frames.length - before).toBe(1);
    expect((store.wallets as any).w1.net_exposure).toEqual({ BTC: 120, ETH: 5 });
  });

  it('a late subscriber receives the exact current state in its snapshot', () => {
    const hub = new StateHub(['wallets'], () => 1);
    hub.set('wallets', { w1: { wallet_id: 'w1', net_exposure: { BTC: 1, ETH: 2 } } });
    hub.set('wallets', { w1: { wallet_id: 'w1', net_exposure: { BTC: 1 } } });
    let first: StateUpdate | null = null;
    hub.subscribe((u) => {
      if (isState(u)) first ??= u;
    });
    expect((first as any).upsert.wallets.w1.net_exposure).toEqual({ BTC: 1 });
  });
});
