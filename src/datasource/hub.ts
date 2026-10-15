/**
 * Fan-out of a state channel to its subscribers, used by DirectSource. The hub holds the current
 * collections; `set` diffs a new full state against it and publishes only what changed as keyed
 * upserts (a changed top-level field replaces that field), `remove` for what vanished. A new
 * subscriber first receives a snapshot of everything.
 */
import type { Upsert } from '@/gateway/types.gen';

import type { StateUpdate, UnavailableUpdate } from './types';

type Entity = Record<string, unknown>;
type Collections = Record<string, Record<string, Entity>>;

export class StateHub {
  private collections: Collections = {};
  private sinks = new Set<(u: StateUpdate | UnavailableUpdate) => void>();
  private seq = 0;
  private unavailableReason: string | null = null;

  constructor(
    private readonly names: readonly string[],
    private readonly now: () => number,
  ) {
    for (const n of names) this.collections[n] = {};
  }

  /** Current entities of a collection (read only). */
  get(name: string): Record<string, Entity> {
    return this.collections[name] ?? {};
  }

  subscribe(sink: (u: StateUpdate | UnavailableUpdate) => void): () => void {
    this.sinks.add(sink);
    if (this.unavailableReason !== null) {
      sink({ kind: 'unavailable', reason: this.unavailableReason });
    } else {
      sink(this.snapshot());
    }
    return () => {
      this.sinks.delete(sink);
    };
  }

  get size(): number {
    return this.sinks.size;
  }

  private snapshot(): StateUpdate {
    return {
      kind: 'snapshot',
      seq: this.seq,
      ts: this.now(),
      replace: [...this.names],
      upsert: structuredClone(this.collections) as unknown as Upsert,
      remove: {},
    };
  }

  /** Mark the channel as not served (for example `recon` in direct mode). */
  setUnavailable(reason: string): void {
    this.unavailableReason = reason;
    for (const s of this.sinks) s({ kind: 'unavailable', reason });
  }

  /**
   * Replace the content of one collection with `next` (key to entity) and publish the difference.
   * Returns true when something changed.
   */
  set(name: string, next: Record<string, Entity>): boolean {
    const prev = this.collections[name] ?? {};
    const upsert: Record<string, Entity> = {};
    const remove: string[] = [];
    for (const [key, entity] of Object.entries(next)) {
      const old = prev[key];
      if (!old) {
        upsert[key] = entity;
        continue;
      }
      const patch: Entity = {};
      for (const [field, value] of Object.entries(entity)) {
        if (JSON.stringify(old[field]) !== JSON.stringify(value)) patch[field] = value;
      }
      if (Object.keys(patch).length > 0) upsert[key] = patch;
    }
    for (const key of Object.keys(prev)) {
      if (!(key in next)) remove.push(key);
    }
    if (Object.keys(upsert).length === 0 && remove.length === 0) {
      return false;
    }
    this.collections[name] = structuredClone(next);
    this.seq += 1;
    const frame: StateUpdate = {
      kind: 'delta',
      seq: this.seq,
      ts: this.now(),
      replace: [],
      upsert: { [name]: structuredClone(upsert) } as unknown as Upsert,
      remove: remove.length > 0 ? { [name]: remove } : {},
    };
    for (const s of this.sinks) s(frame);
    return true;
  }
}
