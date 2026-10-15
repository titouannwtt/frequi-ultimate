import { applyUpsert, type Collections } from '../protocol/apply';
import type { StateUpdate } from '../types';

/**
 * Apply a state channel update to a set of collections, in place. A snapshot first empties the
 * collections it replaces, so an entity that vanished while we were away does not linger.
 */
export function applyStateUpdate(
  collections: Collections,
  names: readonly string[],
  u: StateUpdate,
): void {
  const mine = new Set(names);
  if (u.kind === 'snapshot') {
    for (const name of u.replace) {
      if (mine.has(name)) collections[name] = {};
    }
  }
  const upsert: Record<string, Record<string, unknown>> = {};
  for (const [name, entities] of Object.entries(u.upsert)) {
    if (mine.has(name)) upsert[name] = entities as Record<string, unknown>;
  }
  const remove: Record<string, string[]> = {};
  for (const [name, keys] of Object.entries(u.remove)) {
    if (mine.has(name)) remove[name] = keys;
  }
  applyUpsert(collections, upsert, remove);
}

/**
 * Coalesce updates and apply them once per animation frame (02 section 14: deltas are applied by
 * batch at every `requestAnimationFrame`). Without `requestAnimationFrame` (tests, workers) the
 * updates are applied at once.
 */
export function createFrameBatcher<T>(apply: (batch: T[]) => void) {
  let queue: T[] = [];
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    apply(batch);
  };
  return {
    push(item: T) {
      queue.push(item);
      if (typeof requestAnimationFrame === 'function') {
        if (!scheduled) {
          scheduled = true;
          requestAnimationFrame(flush);
        }
      } else {
        flush();
      }
    },
    flush,
    get pending() {
      return queue.length;
    },
  };
}
