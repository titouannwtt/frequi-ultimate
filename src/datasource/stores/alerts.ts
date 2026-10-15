import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { Alert, AlertView, Silence } from '@/gateway/types.gen';

import { alertView } from '../calc/alerts/book';
import { SEVERITY_RANK } from '../calc/alerts/rules';
import type { Collections } from '../protocol/apply';
import type { StateUpdate } from '../types';
import { applyStateUpdate } from './apply';

/**
 * Alerts of the fleet (`alerts` channel). In gateway mode they are evaluated 24/7 and shared
 * between devices; in direct mode they come from the open tab only (`shared` is false and the rail
 * says so).
 */
export const useFqAlertsStore = defineStore('fqAlerts', () => {
  const collections = ref<Collections>({ alerts: {} });
  const silences = ref<Silence[]>([]);
  const loaded = ref(false);
  const unavailable = ref<string | null>(null);
  /** Acknowledgements and silences are shared between devices. */
  const shared = ref(false);

  const alerts = computed(() => collections.value.alerts as unknown as Record<string, Alert>);

  /** Worst first, then oldest: the order of the rail. */
  const list = computed<Alert[]>(() =>
    Object.values(alerts.value).sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        a.since_ms - b.since_ms ||
        a.id.localeCompare(b.id),
    ),
  );

  function view(nowMs: number, v: AlertView): Alert[] {
    return list.value.filter((a) => alertView(a, nowMs) === v);
  }

  /** Number on the bell: active critical and warning alerts. */
  function bellCount(nowMs: number): number {
    return list.value.filter(
      (a) => alertView(a, nowMs) === 'active' && SEVERITY_RANK[a.severity] >= SEVERITY_RANK.warning,
    ).length;
  }

  function apply(u: StateUpdate) {
    applyStateUpdate(collections.value, ['alerts'], u);
    loaded.value = true;
    unavailable.value = null;
  }

  function setSilences(s: Silence[]) {
    silences.value = s;
  }

  function markUnavailable(reason: string) {
    unavailable.value = reason;
  }

  function reset() {
    collections.value = { alerts: {} };
    silences.value = [];
    loaded.value = false;
    unavailable.value = null;
  }

  return {
    alerts,
    list,
    silences,
    loaded,
    unavailable,
    shared,
    view,
    bellCount,
    apply,
    setSilences,
    markUnavailable,
    reset,
  };
});
