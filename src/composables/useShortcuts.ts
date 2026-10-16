import { tryOnScopeDispose } from '@vueuse/core';
import { shallowRef } from 'vue';

/**
 * Single registry of the keyboard shortcuts and of the command palette (02 section 2.6).
 *
 * Rules written in the design and enforced here:
 * - a key without a modifier never acts while a field has the focus (or a contenteditable);
 * - `Ctrl A` and the other browser chords are never intercepted;
 * - two sequences `G D`, `G B`... wait 1.2 s for their second key;
 * - an action shortcut only opens a confirmation (the handler decides), it never sends anything.
 */
export interface Shortcut {
  id: string;
  /** Single key (`j`, `?`, `Escape`) or a two key sequence (`g d`). Lower case. */
  keys: string;
  /** Needs Ctrl or Meta (`Ctrl K`). */
  mod?: boolean;
  alt?: boolean;
  /** i18n key of the description shown in the help sheet and the palette. */
  labelKey: string;
  group: 'goto' | 'list' | 'actions' | 'display' | 'general';
  /** Runs when the shortcut fires. Returning `false` lets the event through. */
  run: (e: KeyboardEvent) => void | false;
  /** Evaluated at each key: a disabled shortcut is skipped (no bot selected...). */
  enabled?: () => boolean;
}

const SEQUENCE_WINDOW_MS = 1_200;

const registry = shallowRef<readonly Shortcut[]>([]);

/** Read-only view of the registered shortcuts, for the help sheet. */
export const shortcutRegistry = registry;

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Pure matcher, exported for tests. `pending` is the first key of a sequence typed just before. */
export function matchShortcut(
  list: readonly Shortcut[],
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'target'>,
  pending: string | null,
): { hit: Shortcut | null; pending: string | null } {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const mod = e.ctrlKey || e.metaKey;
  const typing = isTypingTarget(e.target);

  for (const s of list) {
    if (s.enabled && !s.enabled()) continue;
    const parts = s.keys.split(' ');
    const needsMod = !!s.mod;
    const needsAlt = !!s.alt;
    if (mod !== needsMod || e.altKey !== needsAlt) continue;
    // Plain keys never act inside a field; chords (Ctrl K) and Escape still do.
    if (typing && !needsMod && !needsAlt && k !== 'Escape') continue;
    if (parts.length === 1) {
      if (parts[0] === k) return { hit: s, pending: null };
    } else if (parts.length === 2) {
      if (pending && parts[0] === pending && parts[1] === k) return { hit: s, pending: null };
    }
  }
  // Start of a sequence: a plain key that is the first half of an enabled sequence.
  if (!mod && !e.altKey && !typing) {
    const starts = list.some(
      (s) =>
        (!s.enabled || s.enabled()) && s.keys.split(' ').length === 2 && s.keys.startsWith(`${k} `),
    );
    if (starts) return { hit: null, pending: k };
  }
  return { hit: null, pending: null };
}

export function useShortcuts(
  initial: readonly Shortcut[] = [],
  target: Window | null = typeof window === 'undefined' ? null : window,
) {
  const mine = new Set<string>();
  let pending: string | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  function register(list: readonly Shortcut[]): () => void {
    const ids = list.map((s) => s.id);
    registry.value = [...registry.value.filter((s) => !ids.includes(s.id)), ...list];
    ids.forEach((id) => mine.add(id));
    return () => unregister(ids);
  }

  function unregister(ids: readonly string[]): void {
    registry.value = registry.value.filter((s) => !ids.includes(s.id));
    ids.forEach((id) => mine.delete(id));
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.isComposing) return;
    const res = matchShortcut(registry.value, e, pending);
    if (pendingTimer) clearTimeout(pendingTimer);
    pending = res.pending;
    if (pending) pendingTimer = setTimeout(() => (pending = null), SEQUENCE_WINDOW_MS);
    if (res.hit) {
      const out = res.hit.run(e);
      if (out !== false) e.preventDefault();
    }
  }

  if (initial.length > 0) register(initial);
  target?.addEventListener('keydown', onKeydown);

  tryOnScopeDispose(() => {
    target?.removeEventListener('keydown', onKeydown);
    if (pendingTimer) clearTimeout(pendingTimer);
    unregister([...mine]);
  });

  return { shortcuts: registry, register, unregister, onKeydown };
}
