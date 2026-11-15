import { onMounted, onUnmounted, ref } from 'vue';
import i18n from '@/locales';
import type {
  FleetviewOverviewResponse,
  FleetviewRealignPayload,
  FleetviewRealignPreview,
  FleetviewReconciliationResponse,
  FleetviewResolvePayload,
  FleetviewResolveResponse,
} from '@/types';

// Not every bot serves /fleetview yet (editable install: only restarted bots have it).
// Remember which connected bot answered so we do not re-scan on every call.
const servingBotId = ref<string | null>(null);

// Module-level shared state: the four dashboard widgets all read the same data,
// so overview/reconciliation are fetched once and polling is reference-counted
// (starts with the first mounted widget, stops when the last one unmounts).
const overview = ref<FleetviewOverviewResponse | null>(null);
const recon = ref<FleetviewReconciliationResponse | null>(null);
const overviewError = ref('');
const reconError = ref('');
const overviewLoading = ref(false);
const reconLoading = ref(false);

let consumerCount = 0;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let overviewInFlight: Promise<void> | null = null;
let reconInFlight: Promise<void> | null = null;

export function useFleetView() {
  const botStore = useBotStore();

  async function fetchOverview(): Promise<FleetviewOverviewResponse> {
    if (servingBotId.value) {
      const store = botStore.botStores[servingBotId.value];
      if (store && store.isBotOnline) {
        try {
          return await store.getFleetviewOverview();
        } catch {
          servingBotId.value = null;
        }
      } else {
        servingBotId.value = null;
      }
    }
    for (const [botId, store] of Object.entries(botStore.botStores)) {
      if (!store.isBotOnline) continue;
      try {
        const data = await store.getFleetviewOverview();
        servingBotId.value = botId;
        return data;
      } catch {
        // This bot does not serve /fleetview (not restarted yet), try the next one.
      }
    }
    throw new Error(i18n.global.t('fleet.errors.noServingBot'));
  }

  async function ensureServingStore() {
    if (!servingBotId.value) {
      await fetchOverview();
    }
    const store = servingBotId.value ? botStore.botStores[servingBotId.value] : undefined;
    if (!store) {
      throw new Error(i18n.global.t('fleet.errors.servingBotUnavailable'));
    }
    return store;
  }

  async function fetchReconciliation(refresh = false): Promise<FleetviewReconciliationResponse> {
    const store = await ensureServingStore();
    try {
      return await store.getFleetviewReconciliation(refresh);
    } catch (err) {
      servingBotId.value = null;
      throw err;
    }
  }

  async function resolveIssue(payload: FleetviewResolvePayload): Promise<FleetviewResolveResponse> {
    const store = await ensureServingStore();
    return store.fleetviewResolve(payload);
  }

  async function realignReconciliation(
    payload: FleetviewRealignPayload,
  ): Promise<FleetviewRealignPreview> {
    const store = await ensureServingStore();
    return store.fleetviewRealign(payload);
  }

  function loadOverview(): Promise<void> {
    if (overviewInFlight) return overviewInFlight;
    overviewLoading.value = true;
    overviewInFlight = (async () => {
      try {
        overview.value = await fetchOverview();
        overviewError.value = '';
      } catch (err: any) {
        overviewError.value = err?.message ?? i18n.global.t('fleet.errors.overviewFailed');
      } finally {
        overviewLoading.value = false;
        overviewInFlight = null;
      }
    })();
    return overviewInFlight;
  }

  function loadRecon(refresh = false): Promise<void> {
    if (reconInFlight) return reconInFlight;
    reconLoading.value = true;
    reconInFlight = (async () => {
      try {
        recon.value = await fetchReconciliation(refresh);
        reconError.value = '';
      } catch (err: any) {
        reconError.value =
          err?.response?.data?.detail ??
          err?.message ??
          i18n.global.t('fleet.errors.reconciliationFailed');
      } finally {
        reconLoading.value = false;
        reconInFlight = null;
      }
    })();
    return reconInFlight;
  }

  /**
   * Reference-counted subscription: call once from each widget's setup().
   * The first mounted widget triggers the initial load and starts the 60s
   * overview poll; the last unmounted widget stops it.
   */
  function subscribe() {
    onMounted(async () => {
      consumerCount += 1;
      if (consumerCount === 1) {
        await loadOverview();
        if (!overviewError.value && !recon.value) {
          await loadRecon();
        }
        refreshTimer = setInterval(loadOverview, 60000);
      }
    });
    onUnmounted(() => {
      consumerCount = Math.max(0, consumerCount - 1);
      if (consumerCount === 0 && refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
    });
  }

  return {
    servingBotId,
    overview,
    recon,
    overviewError,
    reconError,
    overviewLoading,
    reconLoading,
    fetchOverview,
    fetchReconciliation,
    resolveIssue,
    realignReconciliation,
    loadOverview,
    loadRecon,
    subscribe,
  };
}
