/**
 * Snapshot cache (IndexedDB `fqu2-cache`, 02 section 10.1): the last snapshot of the fleet is kept
 * so that the next start paints at once, marked "data from N min ago", and is then replaced by the
 * live one. Only entities are cached, never a token.
 */
import type { Alert, BotRow, Health, Position } from '@/gateway/types.gen';

export interface CachedSnapshot {
  /** Client time the snapshot was taken. */
  savedAtMs: number;
  /** Which source produced it. */
  source: 'gateway' | 'direct';
  bots: Record<string, BotRow>;
  positions: Record<string, Position>;
  alerts: Record<string, Alert>;
  health: Health | null;
}

export interface SnapshotCache {
  load(): Promise<CachedSnapshot | null>;
  save(s: CachedSnapshot): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = 'fqu2-cache';
const STORE = 'snapshots';
const KEY = 'fleet';

/** IndexedDB implementation. Every failure (private mode, quota) degrades to "no cache". */
export function createIndexedDbCache(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): SnapshotCache {
  const open = (): Promise<IDBDatabase | null> =>
    new Promise((resolve) => {
      if (!factory) return resolve(null);
      try {
        const req = factory.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });

  const run = async <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | null> => {
    const db = await open();
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        tx.oncomplete = () => db.close();
      } catch {
        resolve(null);
      }
    });
  };

  return {
    async load() {
      const v = await run('readonly', (s) => s.get(KEY));
      return v && typeof v === 'object' ? (v as CachedSnapshot) : null;
    },
    async save(snapshot) {
      await run('readwrite', (s) => s.put(snapshot, KEY));
    },
    async clear() {
      await run('readwrite', (s) => s.delete(KEY));
    },
  };
}

/** In-memory cache, for tests and for browsers without IndexedDB. */
export function createMemoryCache(): SnapshotCache {
  let value: CachedSnapshot | null = null;
  return {
    async load() {
      return value ? structuredClone(value) : null;
    },
    async save(s) {
      value = structuredClone(s);
    },
    async clear() {
      value = null;
    },
  };
}
