import type { RateMetricsResponse } from '@/types';

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
  const selectedExchange = ref('');
  const localMetrics = ref<Record<string, RateMetricsResponse>>({});
  const refreshInterval = ref<number | null>(null);

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

    localMetrics.value = result;
  }

  const exchangeOptions = computed((): ExchangeOption[] => {
    const counts: Record<string, number> = {};
    for (const m of Object.values(localMetrics.value)) {
      const ex = m.exchange ?? 'unknown';
      counts[ex] = (counts[ex] ?? 0) + 1;
    }
    const total = Object.values(localMetrics.value).length;
    const allOpts: ExchangeOption[] = [{ text: `All (${total})`, value: '' }];
    for (const [name, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      allOpts.push({ text: count > 1 ? `${name} (${count})` : name, value: name });
    }
    return allOpts;
  });

  const filteredMetrics = computed((): Record<string, RateMetricsResponse> => {
    if (!selectedExchange.value) return localMetrics.value;
    const result: Record<string, RateMetricsResponse> = {};
    for (const [id, m] of Object.entries(localMetrics.value)) {
      if (m.exchange === selectedExchange.value) {
        result[id] = m;
      }
    }
    return result;
  });

  const primaryMetrics = computed((): RateMetricsResponse | null => {
    const entries = Object.values(filteredMetrics.value);
    return entries.length > 0 ? entries[0] : null;
  });

  const hasData = computed(() => Object.keys(filteredMetrics.value).length > 0);

  function startRefresh() {
    stopRefresh();
    fetchMetrics();
    refreshInterval.value = window.setInterval(fetchMetrics, opts.refreshMs ?? 30000);
  }

  function stopRefresh() {
    if (refreshInterval.value) {
      clearInterval(refreshInterval.value);
      refreshInterval.value = null;
    }
  }

  watch(selectedWindow, () => fetchMetrics());

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
    fetchMetrics,
  };
}
