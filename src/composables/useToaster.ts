import { ref } from 'vue';
import type { ToastAction, ToastKind } from '@/components/ds/types';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  meta?: string;
  actions?: ToastAction[];
  /** Auto-dismiss delay in ms; 0 keeps it until closed. A success fades after 6 s. */
  ttl: number;
}

export type ToastInput = Omit<ToastItem, 'id' | 'ttl'> & { ttl?: number };

const toasts = ref<ToastItem[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 1;

/** Default lifetime: a fill confirmation fades, everything else waits for the user. */
export function defaultTtl(kind: ToastKind): number {
  return kind === 'ok' ? 6000 : 0;
}

/**
 * Module-level toast queue read by <Toaster />. Results of real-money actions are never lost:
 * only `ok` has a timeout (docs/redesign/02-design.md, section 11.5).
 */
export function useToaster() {
  function dismiss(id: number) {
    const timer = timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(id);
    }
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  function push(input: ToastInput): number {
    const id = nextId++;
    const item: ToastItem = { ...input, id, ttl: input.ttl ?? defaultTtl(input.kind) };
    toasts.value = [...toasts.value, item];
    if (item.ttl > 0) {
      timers.set(
        id,
        setTimeout(() => dismiss(id), item.ttl),
      );
    }
    return id;
  }

  function clear() {
    for (const id of [...timers.keys()]) {
      dismiss(id);
    }
    toasts.value = [];
  }

  return { toasts, push, dismiss, clear };
}
