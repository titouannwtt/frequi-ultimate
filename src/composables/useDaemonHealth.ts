import type {
  CacheStatusResponse,
  FleetStatusResponse,
  FleetEvent,
  RateMetricsResponse,
} from '@/types';

export interface DaemonHealthState {
  cache: CacheStatusResponse | null;
  fleet: FleetStatusResponse | null;
  events: FleetEvent[];
  rate: RateMetricsResponse | null;
  loading: boolean;
  lastRefresh: number;
  error: string;
}

export type HealthLevel = 'healthy' | 'degraded' | 'critical' | 'offline';

export function useDaemonHealth(opts: { refreshMs?: number } = {}) {
  const botStore = useBotStore();
  const refreshMs = opts.refreshMs ?? 10_000;

  const state = reactive<DaemonHealthState>({
    cache: null,
    fleet: null,
    events: [],
    rate: null,
    loading: false,
    lastRefresh: 0,
    error: '',
  });

  const refreshTimer = ref<ReturnType<typeof setInterval> | null>(null);
  const MAX_EVENTS = 500;

  function eventKey(e: FleetEvent): string {
    return `${e.ts}|${e.event_type}|${e.bot_id ?? ''}`;
  }

  function mergeEvents(incoming: FleetEvent[]) {
    const seen = new Set(state.events.map(eventKey));
    const newEvts = incoming.filter((e) => !seen.has(eventKey(e)));
    if (newEvts.length === 0) return;
    const merged = [...state.events, ...newEvts]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, MAX_EVENTS);
    state.events = merged;
  }

  async function fetchAll() {
    const bot = botStore.activeBot;
    if (!bot?.isBotOnline) {
      state.error = 'Bot offline';
      return;
    }
    state.loading = true;
    state.error = '';

    const promises: Promise<void>[] = [];

    promises.push(
      bot.getCacheStatus().then((d) => { state.cache = d; }).catch(() => {}),
    );
    promises.push(
      bot.getFleetStatus().then((d) => {
        if (d && !d.error) state.fleet = d;
        else state.error = d?.error ?? '';
      }).catch(() => {}),
    );
    promises.push(
      bot.getFleetEvents(Date.now() / 1000 - 3600, 100).then((d) => {
        if (d?.events) mergeEvents(d.events);
      }).catch(() => {}),
    );
    promises.push(
      bot.getRateMetrics(3600, 30).then((d) => { state.rate = d; }).catch(() => {}),
    );

    await Promise.all(promises);
    state.lastRefresh = Date.now();
    state.loading = false;
  }

  const secondsSinceRefresh = ref(0);
  const freshnessTimer = ref<ReturnType<typeof setInterval> | null>(null);

  const healthLevel = computed((): HealthLevel => {
    const f = state.fleet;
    const r = state.rate?.current;
    if (!f && !state.cache) return 'offline';
    const crashed = f?.bots?.filter((b) => b.state === 'crashed').length ?? 0;
    const backoffLevel = r?.consecutive_backoffs ?? 0;
    if (crashed > 0 || backoffLevel >= 3) return 'critical';
    if (backoffLevel >= 1 || (r?.backoff_active ?? false)) return 'degraded';
    const cacheOnline = state.cache?.ftcache?.online ?? false;
    if (!cacheOnline) return 'degraded';
    return 'healthy';
  });

  const healthScore = computed((): number => {
    let score = 100;
    const f = state.fleet;
    const r = state.rate?.current;
    const c = state.cache?.ftcache;
    if (!f && !c) return 0;
    const totalBots = f?.bots?.length ?? 0;
    const running = f?.bots?.filter((b) => b.state === 'running').length ?? 0;
    const crashed = f?.bots?.filter((b) => b.state === 'crashed').length ?? 0;
    if (totalBots > 0) {
      score -= (1 - running / totalBots) * 30;
      score -= crashed * 15;
    }
    if (r?.backoff_active) score -= 15;
    score -= Math.min(30, (r?.consecutive_backoffs ?? 0) * 10);
    const hitRate = c?.hit_rate_pct ?? 0;
    if (hitRate < 50) score -= 10;
    if (hitRate < 20) score -= 10;
    return Math.max(0, Math.round(score));
  });

  function startRefresh() {
    stopRefresh();
    fetchAll();
    refreshTimer.value = setInterval(fetchAll, refreshMs);
    freshnessTimer.value = setInterval(() => {
      secondsSinceRefresh.value = state.lastRefresh
        ? Math.round((Date.now() - state.lastRefresh) / 1000)
        : 0;
    }, 1000);
  }

  function stopRefresh() {
    if (refreshTimer.value) { clearInterval(refreshTimer.value); refreshTimer.value = null; }
    if (freshnessTimer.value) { clearInterval(freshnessTimer.value); freshnessTimer.value = null; }
  }

  onMounted(startRefresh);
  onUnmounted(stopRefresh);

  return {
    state,
    healthLevel,
    healthScore,
    secondsSinceRefresh,
    fetchAll,
  };
}
