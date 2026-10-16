import { useI18n } from 'vue-i18n';

import type { Slot } from '@/components/fq/lib/valueState';
import { useFqHealthStore } from '@/datasource/stores/health';

/**
 * Props of the `ValueState` primitive for a `Slot`: the state, the reason in words (FR/EN) and the
 * identity of the wait. A price based reason names the 429 backoff when the daemon says it is on.
 */
export function useValueSlot() {
  const { t } = useI18n();
  const health = useFqHealthStore();

  function reason(slot: Slot): string | undefined {
    if (slot.state !== 'unavailable' || !slot.reason) return undefined;
    const n = slot.n ?? 0;
    if (slot.reason === 'prices') {
      const key = health.health?.backoff_active ? 'backoff' : 'prices';
      return t(`fq.value.reason.${key}`, { n }, n);
    }
    return t(`fq.value.reason.${slot.reason}`, { n }, n);
  }

  function vs(slot: Slot, pendingKey?: string) {
    return { state: slot.state, reason: reason(slot), pendingKey };
  }

  return { reason, vs };
}
