/**
 * Client-side merge of `up` frames (03 section 6.2). Port of `fg-core::protocol::ChannelState`.
 *
 * Updates are keyed upserts: idempotent and independent of array order. A patch is merged
 * shallowly per field group: an object group is merged key by key into the existing group,
 * anything else (scalar, array, null) replaces the group wholesale.
 */

export type Entity = Record<string, unknown>;
export type Collections = Record<string, Record<string, Entity>>;
export type UpsertFrame = Record<string, Record<string, unknown>>;
export type RemoveFrame = Record<string, readonly string[]>;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Shallow merge of an entity patch: `{metrics: {a: 1}}` onto `{metrics: {a: 0, b: 2}}` gives
 * `{metrics: {a: 1, b: 2}}`. Mutates `entity`.
 */
export function mergeEntity(entity: Entity, patch: unknown): void {
  if (!isPlainObject(patch)) {
    return;
  }
  for (const [group, pv] of Object.entries(patch)) {
    const existing = entity[group];
    if (isPlainObject(existing) && isPlainObject(pv)) {
      Object.assign(existing, pv);
    } else {
      entity[group] = isPlainObject(pv) ? { ...pv } : pv;
    }
  }
}

/**
 * Apply an `up` frame in place: upserts first, then removals (a key in both ends up removed).
 * Only the collections named in the frame are touched.
 */
export function applyUpsert(
  collections: Collections,
  upsert: UpsertFrame | undefined,
  remove: RemoveFrame | undefined,
): void {
  for (const [name, entities] of Object.entries(upsert ?? {})) {
    const coll = (collections[name] ??= {});
    for (const [key, patch] of Object.entries(entities)) {
      const existing = coll[key];
      if (existing) {
        mergeEntity(existing, patch);
      } else {
        const fresh: Entity = {};
        mergeEntity(fresh, patch);
        coll[key] = fresh;
      }
    }
  }
  for (const [name, keys] of Object.entries(remove ?? {})) {
    const coll = collections[name];
    if (coll) {
      for (const k of keys) {
        delete coll[k];
      }
    }
  }
}
