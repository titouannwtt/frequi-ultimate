import { reactive } from 'vue';

/**
 * In-flight lock shared by every surface of an action (row button, menu, drawer, palette, header).
 * The key is `bot_key:action:trade_id` (docs/redesign/02-design.md, section 11.4).
 *
 * A control with a `lockKey` acquires the lock when it fires and shows `aria-busy` while the key
 * is held. The owner of the action (useBotAction) releases it at the final result, or after an
 * `unknown` outcome. Module level state on purpose: it must be the same set everywhere.
 */
const held = reactive(new Set<string>());

export function useInflightLock() {
  return {
    isLocked: (key: string | undefined) => !!key && held.has(key),
    /** Returns false when the key is already held (a duplicate submit). */
    acquire(key: string): boolean {
      if (held.has(key)) {
        return false;
      }
      held.add(key);
      return true;
    },
    release(key: string) {
      held.delete(key);
    },
    releaseAll() {
      held.clear();
    },
  };
}
