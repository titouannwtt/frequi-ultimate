/**
 * Plug a data source into the normalised stores. Components read the stores, never the source:
 * the same screen works with the gateway, the direct mode, or a cached snapshot.
 *
 * Updates are applied in batches, once per animation frame (02 section 14). `unavailable` answers
 * are recorded on the store, which the panes show as "Indisponible en mode direct" with the reason
 * instead of an empty table.
 */
import type { CachedSnapshot, SnapshotCache } from './cache';
import type { DataSource, StateUpdate } from './types';
import { createFrameBatcher } from './stores/apply';
import { useFqAlertsStore } from './stores/alerts';
import { useFqConnectionStore } from './stores/connection';
import { useFqEventsStore } from './stores/events';
import { useFqFleetStore } from './stores/fleet';
import { useFqHealthStore } from './stores/health';
import { useFqPositionsStore } from './stores/positions';

export interface BindOptions {
  cache?: SnapshotCache;
  now?: () => number;
  /** Minimum time between two writes of the cache. */
  saveEveryMs?: number;
}

const SAVE_EVERY_MS = 30_000;

function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Paint the stores from the last cached snapshot, marked as such until a live snapshot arrives. */
export async function hydrateFromCache(cache: SnapshotCache): Promise<boolean> {
  const snap = await cache.load();
  if (!snap) return false;
  const fleet = useFqFleetStore();
  // Never overwrite live data that arrived while the cache was being read.
  if (fleet.loaded) return false;
  const conn = useFqConnectionStore();
  const asSnapshot = (name: string, entities: Record<string, unknown>): StateUpdate => ({
    kind: 'snapshot',
    seq: 0,
    ts: snap.savedAtMs,
    replace: [name],
    upsert: { [name]: entities } as unknown as StateUpdate['upsert'],
    remove: {},
  });
  fleet.apply(asSnapshot('bots', snap.bots));
  useFqPositionsStore().apply(asSnapshot('positions', snap.positions));
  useFqAlertsStore().apply(asSnapshot('alerts', snap.alerts));
  if (snap.health) useFqHealthStore().apply(asSnapshot('health', { fleet: snap.health }));
  conn.fromCache = true;
  conn.cachedAtMs = snap.savedAtMs;
  return true;
}

function buildSnapshot(source: DataSource, now: number): CachedSnapshot {
  return {
    savedAtMs: now,
    source: source.kind,
    bots: plain(useFqFleetStore().bots),
    positions: plain(useFqPositionsStore().positions),
    alerts: plain(useFqAlertsStore().alerts),
    health: plain(useFqHealthStore().health),
  };
}

/** Subscribe the stores to a source. Returns the function that unbinds them. */
export function bindSourceToStores(source: DataSource, opts: BindOptions = {}): () => void {
  const now = opts.now ?? Date.now;
  const conn = useFqConnectionStore();
  const fleet = useFqFleetStore();
  const positions = useFqPositionsStore();
  const alerts = useFqAlertsStore();
  const health = useFqHealthStore();
  const events = useFqEventsStore();

  conn.kind = source.kind;
  alerts.shared = source.kind === 'gateway';

  let lastSave = 0;
  const maybeSave = () => {
    if (!opts.cache) return;
    const t = now();
    if (t - lastSave < (opts.saveEveryMs ?? SAVE_EVERY_MS)) return;
    lastSave = t;
    void opts.cache.save(buildSnapshot(source, t)).catch(() => undefined);
  };

  const batcher = createFrameBatcher<() => void>((batch) => {
    for (const apply of batch) apply();
    conn.beat += 1;
    conn.setStatus(source.status.value);
    maybeSave();
  });

  const stateSink =
    (store: { apply: (u: StateUpdate) => void; markUnavailable: (r: string) => void }) =>
    (u: StateUpdate | { kind: 'unavailable'; reason: string }) => {
      batcher.push(() => {
        if (u.kind === 'unavailable') {
          store.markUnavailable(u.reason);
          return;
        }
        // The first live snapshot replaces what was painted from the cache.
        if (u.kind === 'snapshot' && conn.fromCache && store === fleet) {
          conn.fromCache = false;
          conn.cachedAtMs = null;
        }
        store.apply(u);
      });
    };

  const unsubs = [
    source.subscribe('fleet', undefined, stateSink(fleet)),
    source.subscribe('positions', undefined, stateSink(positions)),
    source.subscribe('alerts', undefined, stateSink(alerts)),
    source.subscribe('health', undefined, stateSink(health)),
    source.subscribe('events', undefined, (u) => {
      batcher.push(() => {
        if (u.kind === 'item') events.add(u.item);
        else if (u.kind === 'reset') events.reset();
        else events.markUnavailable(u.reason);
      });
    }),
  ];

  // Keep the pill's status current even when no delta arrives (an offline link sends none).
  const statusTimer = setInterval(() => conn.setStatus(source.status.value), 1000);
  conn.setStatus(source.status.value);

  return () => {
    clearInterval(statusTimer);
    for (const u of unsubs) u();
    batcher.flush();
  };
}
