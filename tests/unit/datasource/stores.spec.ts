/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures and decoded wire frames */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { bindSourceToStores, hydrateFromCache } from '@/datasource/bind';
import { createMemoryCache, type CachedSnapshot } from '@/datasource/cache';
import { useFqAlertsStore } from '@/datasource/stores/alerts';
import { createFrameBatcher } from '@/datasource/stores/apply';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqEventsStore, MAX_EVENTS } from '@/datasource/stores/events';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import type {
  Channel,
  ChannelUpdate,
  DataSource,
  SourceKind,
  SourceStatus,
  StateUpdate,
} from '@/datasource/types';

const snapshot = (name: string, entities: Record<string, unknown>, seq = 1): StateUpdate => ({
  kind: 'snapshot',
  seq,
  ts: 1,
  replace: [name],
  upsert: { [name]: entities } as StateUpdate['upsert'],
  remove: {},
});

const delta = (
  name: string,
  entities: Record<string, unknown>,
  remove: string[] = [],
  seq = 2,
): StateUpdate => ({
  kind: 'delta',
  seq,
  ts: 2,
  replace: [],
  upsert: { [name]: entities } as StateUpdate['upsert'],
  remove: remove.length ? { [name]: remove } : {},
});

/** A source that lets the test push updates to whoever subscribed. */
function fakeSource(kind: SourceKind = 'gateway') {
  const sinks = new Map<string, Set<(u: any) => void>>();
  const status = ref<SourceStatus>({
    state: 'live',
    lastSyncMs: 5,
    clockSkewMs: 0,
    latencyMs: null,
    resyncing: false,
    reason: null,
  });
  const unsub = vi.fn();
  const source = {
    kind,
    status,
    start: async () => undefined,
    stop: () => undefined,
    subscribe<C extends Channel>(ch: C, _p: unknown, sink: (u: ChannelUpdate[C]) => void) {
      const set = sinks.get(ch) ?? new Set();
      set.add(sink);
      sinks.set(ch, set);
      return () => {
        unsub(ch);
        set.delete(sink);
      };
    },
  } as unknown as DataSource;
  return {
    source,
    status,
    unsub,
    push: (ch: Channel, u: unknown) => sinks.get(ch)?.forEach((s) => s(u)),
    listeners: (ch: Channel) => sinks.get(ch)?.size ?? 0,
  };
}

let frames: Array<() => void> = [];

beforeEach(() => {
  setActivePinia(createPinia());
  frames = [];
  vi.useFakeTimers();
  // After the fake timers, which would otherwise replace it.
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    frames.push(cb);
    return frames.length;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const paint = () => {
  const run = frames;
  frames = [];
  run.forEach((f) => f());
};

describe('normalised stores', () => {
  it('replaces a collection at a snapshot, upserts and removes by key', () => {
    const fleet = useFqFleetStore();
    fleet.apply(snapshot('bots', { a: { bot_key: 'a' }, b: { bot_key: 'b' } }));
    expect(fleet.list.map((b) => b.bot_key).sort()).toEqual(['a', 'b']);
    fleet.apply(delta('bots', { a: { identity: { name: 'A' } } }, ['b']));
    expect(fleet.list).toHaveLength(1);
    expect(fleet.bots.a).toMatchObject({ bot_key: 'a', identity: { name: 'A' } });
    // A snapshot forgets what vanished while the app was away.
    fleet.apply(snapshot('bots', { c: { bot_key: 'c' } }, 9));
    expect(Object.keys(fleet.bots)).toEqual(['c']);
  });

  it('ignores collections that belong to another channel', () => {
    const fleet = useFqFleetStore();
    fleet.apply({
      ...snapshot('bots', { a: {} }),
      upsert: { bots: { a: {} }, positions: { x: {} } } as any,
    });
    expect(Object.keys(fleet.bots)).toEqual(['a']);
  });

  it('keeps the events newest first and capped', () => {
    const events = useFqEventsStore();
    for (let i = 0; i < MAX_EVENTS + 20; i++) {
      events.add({
        kind: 'warning',
        ts_ms: i,
        bot_key: i % 2 ? 'a' : 'b',
        trade_id: null,
        pair: null,
        profit_abs: null,
        severity: null,
        detail: null,
      });
    }
    expect(events.events).toHaveLength(MAX_EVENTS);
    expect(events.events[0]!.ts_ms).toBe(MAX_EVENTS + 19);
    expect(events.counter).toBe(MAX_EVENTS + 20);
    expect(events.forBot('a').every((e) => e.bot_key === 'a')).toBe(true);
  });

  it('orders alerts worst first and counts the bell from active warnings and criticals', () => {
    const alerts = useFqAlertsStore();
    const mk = (id: string, severity: string, since: number) => ({
      id,
      severity,
      since_ms: since,
      type_id: 'positionLoss',
      bot_key: 'a',
      subject: id,
      state: 'firing',
      acked_at_ms: null,
      silenced_until_ms: null,
    });
    alerts.apply(
      snapshot('alerts', {
        a: mk('a', 'info', 1),
        b: mk('b', 'critical', 5),
        c: mk('c', 'warning', 3),
      }),
    );
    expect(alerts.list.map((a) => a.id)).toEqual(['b', 'c', 'a']);
    expect(alerts.bellCount(100)).toBe(2);
  });

  it('records why a channel is unavailable and clears it at the next update', () => {
    const fleet = useFqFleetStore();
    fleet.markUnavailable('direct_mode');
    expect(fleet.unavailable).toBe('direct_mode');
    fleet.apply(snapshot('bots', {}));
    expect(fleet.unavailable).toBeNull();
  });
});

describe('frame batching', () => {
  it('applies everything pushed in one frame together, in order', () => {
    const seen: number[][] = [];
    const b = createFrameBatcher<number>((batch) => seen.push(batch));
    b.push(1);
    b.push(2);
    b.push(3);
    expect(seen).toEqual([]);
    paint();
    expect(seen).toEqual([[1, 2, 3]]);
  });

  it('applies at once when there is no animation frame', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const seen: number[][] = [];
    const b = createFrameBatcher<number>((batch) => seen.push(batch));
    b.push(1);
    expect(seen).toEqual([[1]]);
  });
});

describe('binding a source to the stores', () => {
  it('feeds the stores once per frame and marks the source kind', () => {
    const src = fakeSource('direct');
    const unbind = bindSourceToStores(src.source);
    const conn = useFqConnectionStore();
    const fleet = useFqFleetStore();
    expect(conn.kind).toBe('direct');
    expect(useFqAlertsStore().shared).toBe(false);
    src.push('fleet', snapshot('bots', { a: { bot_key: 'a' } }));
    src.push('fleet', delta('bots', { b: { bot_key: 'b' } }));
    expect(fleet.list).toHaveLength(0);
    paint();
    expect(fleet.list).toHaveLength(2);
    expect(conn.beat).toBe(1);
    unbind();
  });

  it('shares alerts only through the gateway', () => {
    const src = fakeSource('gateway');
    const unbind = bindSourceToStores(src.source);
    expect(useFqAlertsStore().shared).toBe(true);
    unbind();
  });

  it('shows `unavailable` answers instead of an empty table', () => {
    const src = fakeSource('direct');
    bindSourceToStores(src.source);
    src.push('positions', { kind: 'unavailable', reason: 'direct_mode' });
    src.push('events', { kind: 'unavailable', reason: 'direct_mode' });
    paint();
    expect(useFqPositionsStore().unavailable).toBe('direct_mode');
    expect(useFqEventsStore().unavailable).toBe('direct_mode');
  });

  it('routes the event stream and its resets', () => {
    const src = fakeSource();
    bindSourceToStores(src.source);
    const e = {
      kind: 'exit_fill',
      ts_ms: 1,
      bot_key: 'a',
      trade_id: 3,
      pair: 'X',
      profit_abs: 1,
      severity: null,
      detail: null,
    };
    src.push('events', { kind: 'item', seq: 1, item: e });
    paint();
    expect(useFqEventsStore().lastEvent).toEqual(e);
    src.push('events', { kind: 'reset' });
    paint();
    expect(useFqEventsStore().events).toEqual([]);
  });

  it('follows the status of the source even when no update arrives', () => {
    const src = fakeSource();
    bindSourceToStores(src.source);
    const conn = useFqConnectionStore();
    src.status.value = { ...src.status.value, state: 'offline', reason: 'ws_closed' };
    vi.advanceTimersByTime(1_100);
    expect(conn.status.state).toBe('offline');
  });

  it('unbinds cleanly', () => {
    const src = fakeSource();
    const unbind = bindSourceToStores(src.source);
    expect(src.listeners('fleet')).toBe(1);
    unbind();
    expect(src.listeners('fleet')).toBe(0);
    expect(src.unsub).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('snapshot cache', () => {
  const cached = (): CachedSnapshot => ({
    savedAtMs: 1_000,
    source: 'gateway',
    bots: { a: { bot_key: 'a' } as any },
    positions: { 'a/1': { bot_key: 'a', trade_id: 1 } as any },
    alerts: {},
    health: null,
  });

  it('paints the stores from the cache, marked as cached', async () => {
    const cache = createMemoryCache();
    await cache.save(cached());
    expect(await hydrateFromCache(cache)).toBe(true);
    const conn = useFqConnectionStore();
    expect(useFqFleetStore().list).toHaveLength(1);
    expect(useFqPositionsStore().list).toHaveLength(1);
    expect(conn.fromCache).toBe(true);
    expect(conn.cachedAtMs).toBe(1_000);
  });

  it('does nothing without a cache, and never overwrites live data', async () => {
    expect(await hydrateFromCache(createMemoryCache())).toBe(false);
    const cache = createMemoryCache();
    await cache.save(cached());
    useFqFleetStore().apply(snapshot('bots', { live: { bot_key: 'live' } }));
    expect(await hydrateFromCache(cache)).toBe(false);
    expect(Object.keys(useFqFleetStore().bots)).toEqual(['live']);
  });

  it('is replaced by the first live snapshot of the fleet', async () => {
    const cache = createMemoryCache();
    await cache.save(cached());
    await hydrateFromCache(cache);
    const src = fakeSource();
    bindSourceToStores(src.source);
    src.push('fleet', snapshot('bots', { live: { bot_key: 'live' } }));
    paint();
    const conn = useFqConnectionStore();
    expect(conn.fromCache).toBe(false);
    expect(Object.keys(useFqFleetStore().bots)).toEqual(['live']);
  });

  it('saves the stores at most every 30 s, never a token', async () => {
    let t = 0;
    const cache = createMemoryCache();
    const save = vi.spyOn(cache, 'save');
    const src = fakeSource();
    bindSourceToStores(src.source, { cache, now: () => t, saveEveryMs: 30_000 });
    src.push('fleet', snapshot('bots', { a: { bot_key: 'a' } }));
    t = 31_000;
    paint();
    src.push('fleet', delta('bots', { a: { x: 1 } }));
    t = 40_000;
    paint();
    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0]![0];
    expect(JSON.stringify(saved)).not.toMatch(/token|password|secret/i);
    expect(saved.source).toBe('gateway');
  });
});
