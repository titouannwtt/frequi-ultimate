import type { VolumeHistoryResponse, VolumeBucketSize } from '@/types';

interface UseVolumeComparatorOptions {
  multiBotView: boolean;
  defaultDays?: number;
  defaultBucket?: VolumeBucketSize;
  refreshMs?: number;
}

export function useVolumeComparator(opts: UseVolumeComparatorOptions) {
  const botStore = useBotStore();

  const selectedDays = ref(opts.defaultDays ?? 90);
  const selectedBucket = ref<VolumeBucketSize>(opts.defaultBucket ?? '1d');
  const localData = ref<Record<string, VolumeHistoryResponse>>({});
  const loading = ref(false);
  const lastFetchTs = ref(0);
  const refreshInterval = ref<ReturnType<typeof setInterval> | null>(null);

  let fetchVersion = 0;

  const daysOptions = [
    { text: '30d', value: 30 },
    { text: '90d', value: 90 },
    { text: '180d', value: 180 },
    { text: '1y', value: 365 },
  ];

  const bucketOptions: { text: string; value: VolumeBucketSize }[] = [
    { text: '1 day', value: '1d' },
    { text: '3 days', value: '3d' },
    { text: '7 days', value: '7d' },
    { text: '1 month', value: '1M' },
    { text: '1 quarter', value: '1Q' },
  ];

  async function fetchData() {
    const thisVersion = ++fetchVersion;
    loading.value = true;
    const d = selectedDays.value;
    const b = selectedBucket.value;
    const result: Record<string, VolumeHistoryResponse> = {};

    if (opts.multiBotView) {
      const promises = Object.entries(botStore.botStores).map(async ([botId, bot]) => {
        if (!bot.isSelected || !bot.isBotOnline) return;
        try {
          const data = await bot.getVolumeHistory(d, b);
          result[botId] = data;
        } catch {
          // skip bots that fail
        }
      });
      await Promise.all(promises);
    } else {
      try {
        const data = await botStore.activeBot.getVolumeHistory(d, b);
        result[botStore.selectedBot] = data;
      } catch {
        // ignore
      }
    }

    if (thisVersion === fetchVersion) {
      localData.value = result;
      lastFetchTs.value = Date.now();
      loading.value = false;
    }
  }

  const mergedData = computed((): VolumeHistoryResponse | null => {
    const entries = Object.values(localData.value);
    if (entries.length === 0) return null;
    if (entries.length === 1) return entries[0];

    const dateMap = new Map<
      string,
      { exchange_volume: number; bot_volume: number; trade_count: number; abs_profit: number }
    >();

    const exchangesSeen = new Set<string>();

    for (const resp of entries) {
      const isNewExchange = !exchangesSeen.has(resp.exchange_name);
      exchangesSeen.add(resp.exchange_name);

      for (const b of resp.buckets) {
        const existing = dateMap.get(b.date);
        if (existing) {
          if (isNewExchange) {
            existing.exchange_volume += b.exchange_volume;
          }
          existing.bot_volume += b.bot_volume;
          existing.trade_count += b.trade_count;
          existing.abs_profit += b.abs_profit;
        } else {
          dateMap.set(b.date, {
            exchange_volume: b.exchange_volume,
            bot_volume: b.bot_volume,
            trade_count: b.trade_count,
            abs_profit: b.abs_profit,
          });
        }
      }
    }

    const first = entries[0];
    const buckets = [...dateMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({ date, ...vals }));

    const totalWhitelist = entries.reduce((s, e) => s + e.whitelist_count, 0);
    const avgCoverage =
      entries.reduce((s, e) => s + e.data_coverage_pct, 0) / entries.length;

    return {
      buckets,
      exchange_name: [...exchangesSeen].join(' + '),
      stake_currency: first.stake_currency,
      whitelist_count: totalWhitelist,
      data_coverage_pct: avgCoverage,
      anomaly_threshold_high: first.anomaly_threshold_high,
      anomaly_threshold_low: first.anomaly_threshold_low,
    };
  });

  const anomalyDates = computed((): Set<string> => {
    const data = mergedData.value;
    if (!data) return new Set();
    const set = new Set<string>();
    for (const b of data.buckets) {
      if (
        b.exchange_volume > data.anomaly_threshold_high ||
        (data.anomaly_threshold_low > 0 && b.exchange_volume < data.anomaly_threshold_low)
      ) {
        set.add(b.date);
      }
    }
    return set;
  });

  const correlation = computed((): number | null => {
    const data = mergedData.value;
    if (!data || data.buckets.length < 5) return null;
    const exVol = data.buckets.map((b) => b.exchange_volume);
    const botVol = data.buckets.map((b) => b.bot_volume);
    const n = exVol.length;
    const meanEx = exVol.reduce((a, b) => a + b, 0) / n;
    const meanBot = botVol.reduce((a, b) => a + b, 0) / n;
    let cov = 0;
    let varEx = 0;
    let varBot = 0;
    for (let i = 0; i < n; i++) {
      const dEx = exVol[i] - meanEx;
      const dBot = botVol[i] - meanBot;
      cov += dEx * dBot;
      varEx += dEx * dEx;
      varBot += dBot * dBot;
    }
    const denom = Math.sqrt(varEx * varBot);
    return denom > 0 ? cov / denom : null;
  });

  const avgVolumeRatio = computed((): number | null => {
    const data = mergedData.value;
    if (!data || data.buckets.length === 0) return null;
    const ratios = data.buckets
      .filter((b) => b.exchange_volume > 0)
      .map((b) => b.bot_volume / b.exchange_volume);
    if (ratios.length === 0) return null;
    return (ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100;
  });

  const avgProfitPerVolume = computed((): number | null => {
    const data = mergedData.value;
    if (!data) return null;
    const totalBotVol = data.buckets.reduce((s, b) => s + b.bot_volume, 0);
    const totalProfit = data.buckets.reduce((s, b) => s + b.abs_profit, 0);
    if (totalBotVol === 0) return null;
    return (totalProfit / totalBotVol) * 100;
  });

  const secondsSinceRefresh = computed((): number => {
    if (!lastFetchTs.value) return Infinity;
    return Math.floor((Date.now() - lastFetchTs.value) / 1000);
  });

  const hasData = computed(() => mergedData.value !== null && mergedData.value.buckets.length > 0);

  function startRefresh() {
    stopRefresh();
    fetchData();
    const ms = opts.refreshMs ?? 300000;
    refreshInterval.value = setInterval(fetchData, ms);
  }

  function stopRefresh() {
    if (refreshInterval.value) {
      clearInterval(refreshInterval.value);
      refreshInterval.value = null;
    }
  }

  watch([selectedDays, selectedBucket], () => {
    fetchData();
  });

  onMounted(startRefresh);
  onUnmounted(stopRefresh);

  return {
    selectedDays,
    selectedBucket,
    daysOptions,
    bucketOptions,
    loading,
    localData,
    mergedData,
    anomalyDates,
    correlation,
    avgVolumeRatio,
    avgProfitPerVolume,
    secondsSinceRefresh,
    hasData,
    fetchData,
  };
}
