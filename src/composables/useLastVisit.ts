import { useLocalStorage } from '@vueuse/core';

const KEY = 'fqu2.lastVisit';
const sessionStartMs = Date.now();

/**
 * The reference point of "Since your last visit" (02 section 3.1), per device. Stored under the
 * `fqu2.` prefix so the export and the migration know it. Before a first "Mark as seen" the
 * digest starts at the beginning of this session.
 */
export function useLastVisit() {
  const stored = useLocalStorage<number>(KEY, 0);
  return {
    since: () => (stored.value > 0 ? stored.value : sessionStartMs),
    markSeen: (nowMs: number = Date.now()) => {
      stored.value = nowMs;
    },
    stored,
  };
}
