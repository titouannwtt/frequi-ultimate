import type {
  MethodStats,
  RateMetricsResponse,
  RateMetricsSummary,
  RateTimelineBucket,
  RateLimitEvent,
} from '@/types';

interface ExchangeOption {
  text: string;
  value: string;
}

interface UseRateMetricsOptions {
  multiBotView: boolean;
  defaultWindow?: number;
  refreshMs?: number;
}

export function useRateMetrics(opts: UseRateMetricsOptions) {
  const botStore = useBotStore();

  const selectedWindow = ref(opts.defaultWindow ?? 3600);
  const selectedExchange = ref('__all__');
  const localMetrics = ref<Record<string, RateMetricsResponse>>({});
  const refreshInterval = ref<number | null>(null);

  let fetchVersion = 0;

  const windowOptions = [
    { text: '10 min', value: 600 },
    { text: '30 min', value: 1800 },
    { text: '1h', value: 3600 },
    { text: '6h', value: 21600 },
    { text: '24h', value: 86400 },
  ];

  function bucketSize(windowS: number): number {
    if (windowS <= 1800) return 10;
    if (windowS <= 7200) return 30;
    return 60;
  }

  async function fetchMetrics() {
    const thisVersion = ++fetchVersion;
    const w = selectedWindow.value;
    const b = bucketSize(w);
    const result: Record<string, RateMetricsResponse> = {};

    if (opts.multiBotView) {
      const promises: Promise<void>[] = [];
      botStore.allBotStores.forEach((bot) => {
        if (bot.isBotOnline) {
          promises.push(
            bot
              .getRateMetrics(w, b)
              .then((data) => {
                result[bot.botId] = data;
              })
              .catch(() => {}),
          );
        }
      });
      await Promise.all(promises);
    } else {
      const bot = botStore.activeBot;
      if (bot) {
        try {
          const data = await bot.getRateMetrics(w, b);
          result[bot.botId] = data;
        } catch {
          // ignore
        }
      }
    }

    if (thisVersion !== fetchVersion) return;
    localMetrics.value = result;
  }

  const exchangeOptions = computed((): ExchangeOption[] => {
    const counts: Record<string, number> = {};
    for (const m of Object.values(localMetrics.value)) {
      const ex = m.exchange ?? 'unknown';
      counts[ex] = (counts[ex] ?? 0) + 1;
    }
    const total = Object.values(localMetrics.value).length;
    const allOpts: ExchangeOption[] = [{ text: `All (${total})`, value: '__all__' }];
    for (const [name, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      allOpts.push({ text: count > 1 ? `${name} (${count})` : name, value: name });
    }
    return allOpts;
  });

  const filteredMetrics = computed((): Record<string, RateMetricsResponse> => {
    if (selectedExchange.value === '__all__') return localMetrics.value;
    const result: Record<string, RateMetricsResponse> = {};
    for (const [id, m] of Object.entries(localMetrics.value)) {
      if (m.exchange === selectedExchange.value) {
        result[id] = m;
      }
    }
    return result;
  });

  const mergedMetrics = computed((): RateMetricsResponse | null => {
    const entries = Object.values(filteredMetrics.value);
    if (entries.length === 0) return null;
    if (entries.length === 1) return entries[0];

    const timelineBuckets: Record<number, RateTimelineBucket> = {};
    const all429s: RateLimitEvent[] = [];
    const methodAgg: Record<string, { count: number; cached: number; direct: number; errors: number; latSum: number; latCount: number; p95Max: number }> = {};
    let sumTotal = 0, sumCached = 0, sumDirect = 0, sumErrors = 0, sumErrors429 = 0;
    let latWeightedSum = 0, latWeightedCount = 0;
    let p95Max = 0;
    const exchanges = new Set<string>();

    for (const m of entries) {
      exchanges.add(m.exchange ?? 'unknown');

      for (const b of m.timeline) {
        const existing = timelineBuckets[b.ts];
        if (existing) {
          const prevDirect = existing.direct;
          existing.total += b.total;
          existing.cached += b.cached;
          existing.direct += b.direct;
          existing.errors += b.errors;
          existing.errors_429 += b.errors_429;
          const totalDirect = prevDirect + b.direct;
          if (totalDirect > 0) {
            existing.avg_latency_ms = Math.round(
              ((existing.avg_latency_ms * prevDirect) + (b.avg_latency_ms * b.direct)) / totalDirect * 10,
            ) / 10;
          }
          for (const [method, count] of Object.entries(b.by_method)) {
            existing.by_method[method] = (existing.by_method[method] ?? 0) + count;
          }
        } else {
          timelineBuckets[b.ts] = {
            ts: b.ts,
            total: b.total,
            cached: b.cached,
            direct: b.direct,
            errors: b.errors,
            errors_429: b.errors_429,
            avg_latency_ms: b.avg_latency_ms,
            by_method: { ...b.by_method },
          };
        }
      }

      all429s.push(...m.recent_429s);

      if (m.summary) {
        sumTotal += m.summary.total;
        sumCached += m.summary.cached;
        sumDirect += m.summary.direct;
        sumErrors += m.summary.errors;
        sumErrors429 += m.summary.errors_429;
        if (m.summary.direct > 0) {
          latWeightedSum += m.summary.avg_latency_ms * m.summary.direct;
          latWeightedCount += m.summary.direct;
        }
        p95Max = Math.max(p95Max, m.summary.p95_latency_ms ?? 0);

        for (const [method, stats] of Object.entries(m.summary.by_method ?? {})) {
          // pl: methods are global daemon stats (identical in all bots), take once
          if (method.startsWith('pl:')) {
            if (!methodAgg[method]) {
              methodAgg[method] = {
                count: stats.count, cached: stats.cached, direct: stats.direct,
                errors: stats.errors, latSum: 0, latCount: 0, p95Max: 0,
              };
            }
            continue;
          }
          const agg = methodAgg[method];
          if (agg) {
            agg.count += stats.count;
            agg.cached += stats.cached;
            agg.direct += stats.direct;
            agg.errors += stats.errors;
            if (stats.direct > 0) {
              agg.latSum += stats.avg_latency_ms * stats.direct;
              agg.latCount += stats.direct;
            }
            agg.p95Max = Math.max(agg.p95Max, stats.p95_latency_ms ?? 0);
          } else {
            methodAgg[method] = {
              count: stats.count,
              cached: stats.cached,
              direct: stats.direct,
              errors: stats.errors,
              latSum: stats.avg_latency_ms * stats.direct,
              latCount: stats.direct,
              p95Max: stats.p95_latency_ms ?? 0,
            };
          }
        }
      }
    }

    const mergedByMethod: Record<string, MethodStats> = {};
    for (const [method, agg] of Object.entries(methodAgg)) {
      mergedByMethod[method] = {
        count: agg.count,
        cached: agg.cached,
        direct: agg.direct,
        errors: agg.errors,
        avg_latency_ms: agg.latCount > 0 ? Math.round(agg.latSum / agg.latCount * 10) / 10 : 0,
        p95_latency_ms: agg.p95Max,
      };
    }

    const mergedSummary: RateMetricsSummary = {
      total: sumTotal,
      cached: sumCached,
      direct: sumDirect,
      errors: sumErrors,
      errors_429: sumErrors429,
      avg_latency_ms: latWeightedCount > 0 ? Math.round(latWeightedSum / latWeightedCount * 10) / 10 : 0,
      p95_latency_ms: p95Max,
      by_method: mergedByMethod,
    };

    all429s.sort((a, b) => b.ts - a.ts);

    const firstWithPairlist = entries.find((e) => e.ftpairlist) ?? entries[0];
    const firstWithRateLimit = entries.find((e) => e.exchange_rate_limit) ?? entries[0];

    return {
      exchange: [...exchanges].join(' + '),
      timeline: Object.values(timelineBuckets).sort((a, b) => a.ts - b.ts),
      recent_429s: all429s.slice(0, 100),
      summary: mergedSummary,
      current: entries[0].current,
      ftcache_extended: entries[0].ftcache_extended,
      ftpairlist: firstWithPairlist.ftpairlist,
      exchange_rate_limit: firstWithRateLimit.exchange_rate_limit,
    };
  });

  const primaryMetrics = computed((): RateMetricsResponse | null => mergedMetrics.value);

  const hasData = computed(() => Object.keys(filteredMetrics.value).length > 0);

  const lastRefreshTs = ref(0);
  const secondsSinceRefresh = ref(0);
  const freshnessInterval = ref<number | null>(null);

  const origFetchMetrics = fetchMetrics;
  async function fetchMetricsWithTs() {
    await origFetchMetrics();
    lastRefreshTs.value = Date.now();
  }
  fetchMetrics = fetchMetricsWithTs;

  function startRefresh() {
    stopRefresh();
    fetchMetrics();
    refreshInterval.value = window.setInterval(fetchMetrics, opts.refreshMs ?? 30000);
    freshnessInterval.value = window.setInterval(() => {
      secondsSinceRefresh.value = lastRefreshTs.value
        ? Math.round((Date.now() - lastRefreshTs.value) / 1000)
        : 0;
    }, 1000);
  }

  function stopRefresh() {
    if (refreshInterval.value) {
      clearInterval(refreshInterval.value);
      refreshInterval.value = null;
    }
    if (freshnessInterval.value) {
      clearInterval(freshnessInterval.value);
      freshnessInterval.value = null;
    }
  }

  watch(selectedWindow, () => startRefresh());

  onMounted(startRefresh);
  onUnmounted(stopRefresh);

  return {
    selectedWindow,
    selectedExchange,
    windowOptions,
    localMetrics,
    filteredMetrics,
    exchangeOptions,
    primaryMetrics,
    hasData,
    secondsSinceRefresh,
    fetchMetrics,
  };
}
