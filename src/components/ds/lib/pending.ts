/**
 * How long a value may stay "pending" (spinner) before it is declared unavailable (docs/redesign/
 * 02-design.md, section 10.1). A spinner never spins forever: past this delay the slot shows the
 * static icon with "no answer for N s". 45 s is three polls of the fastest REST channel (15 s):
 * a bot that did not answer in that time is not "loading", it is silent.
 */
export const PENDING_TIMEOUT_MS = 45_000;

/** A key unmounted for longer than this starts a new wait (a bot that came back and went silent again). */
const RESET_GAP_MS = 10_000;

interface Entry {
  first: number;
  mounted: number;
  goneAt: number | null;
}

const entries = new Map<string, Entry>();

/**
 * Start (or join) the wait of a slot and return when it began. Slots that share a key share the
 * start, so a virtualised row that scrolls out and back in does not restart its 45 s.
 */
export function beginPending(key: string, nowMs: number): number {
  const e = entries.get(key);
  if (!e) {
    entries.set(key, { first: nowMs, mounted: 1, goneAt: null });
    return nowMs;
  }
  if (e.mounted === 0 && e.goneAt !== null && nowMs - e.goneAt > RESET_GAP_MS) {
    e.first = nowMs;
  }
  e.mounted += 1;
  e.goneAt = null;
  return e.first;
}

export function endPending(key: string, nowMs: number): void {
  const e = entries.get(key);
  if (!e) return;
  e.mounted = Math.max(0, e.mounted - 1);
  if (e.mounted === 0) e.goneAt = nowMs;
}

/** Tests only. */
export function resetPending(): void {
  entries.clear();
}
