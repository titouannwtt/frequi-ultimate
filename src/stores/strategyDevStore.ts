import type {
  AllRunsResponse,
  BacktestSnapshotResponse,
  GlossaryResponse,
  MetadataUpdateRequest,
  RunListEntry,
  SnapshotDiffResponse,
} from '@/types';
import { RunType } from '@/types';

interface CachedRunData {
  detail: Record<string, unknown> | null;
  analysis: Record<string, unknown> | null;
  snapshot: BacktestSnapshotResponse | null;
}

export const useStrategyDevStore = defineStore('strategyDev', () => {
  const botStore = useBotStore();

  const allRuns = ref<AllRunsResponse | null>(null);
  const loading = ref(false);
  const loadingTypes = ref<Set<string>>(new Set());
  const errorCode = ref<number | null>(null);
  const errorMessage = ref<string | null>(null);
  const selectedRun = ref<RunListEntry | null>(null);
  const hyperoptDetail = ref<Record<string, unknown> | null>(null);
  const hyperoptAnalysis = ref<Record<string, unknown> | null>(null);
  const advancedAnalytics = ref<Record<string, unknown> | null>(null);
  const wfaDetail = ref<Record<string, unknown> | null>(null);
  const backtestSnapshot = ref<BacktestSnapshotResponse | null>(null);
  const backtestAnalysis = ref<Record<string, unknown> | null>(null);
  const diffResult = ref<SnapshotDiffResponse | null>(null);
  const glossary = ref<GlossaryResponse | null>(null);
  const plotProfitData = ref<Record<string, unknown> | null>(null);
  const plotDataframeData = ref<Record<string, unknown> | null>(null);
  const backtestPairs = ref<string[]>([]);

  const runCache = reactive(new Map<string, CachedRunData>());
  const epochAnalyticsCache = reactive(new Map<string, Record<string, unknown>>());
  const selectedEpochRank = ref(1);
  const analyseMode = ref<'global' | 'epoch' | 'compare'>('global');
  const compareEpochRanks = ref<[number, number]>([1, 2]);
  const filterText = ref('');
  const filterType = ref<RunType | null>(null);
  const filterStrategy = ref<string | null>(null);
  const filterDateRange = ref<number | null>(null);
  const filterFavoritesOnly = ref(false);
  const sortBy = ref<'date' | 'profit' | 'loss' | 'grade'>(
    (localStorage.getItem('sd-sortBy') as 'date' | 'profit' | 'loss' | 'grade') || 'date',
  );
  const groupBy = ref<'type' | 'strategy'>(
    (localStorage.getItem('sd-groupBy') as 'type' | 'strategy') || 'type',
  );
  const sidebarWidth = ref(parseInt(localStorage.getItem('sd-sidebarWidth') || '300', 10));

  function getApi() {
    const loginInfo = useLoginInfo(botStore.selectedBot);
    return useApi(loginInfo, botStore.selectedBot).api;
  }

  const allRunsFlat = computed<RunListEntry[]>(() => {
    if (!allRuns.value) return [];
    return [...allRuns.value.backtests, ...allRuns.value.hyperopts, ...allRuns.value.wfa_runs].sort(
      (a, b) => b.timestamp - a.timestamp,
    );
  });

  const filteredRuns = computed<RunListEntry[]>(() => {
    let runs = allRunsFlat.value;
    if (filterDateRange.value) {
      const cutoff = Date.now() / 1000 - filterDateRange.value;
      runs = runs.filter((r) => r.timestamp >= cutoff);
    }
    if (filterType.value) {
      runs = runs.filter((r) => r.run_type === filterType.value);
    }
    if (filterStrategy.value) {
      runs = runs.filter((r) => r.strategy === filterStrategy.value);
    }
    if (filterFavoritesOnly.value) {
      runs = runs.filter((r) => r.favorite);
    }
    if (filterText.value) {
      const q = filterText.value.toLowerCase();
      runs = runs.filter(
        (r) =>
          r.strategy.toLowerCase().includes(q) ||
          r.filename.toLowerCase().includes(q) ||
          (r.notes ?? '').toLowerCase().includes(q),
      );
    }
    const s = sortBy.value;
    if (s === 'profit') {
      runs = [...runs].sort((a, b) => (b.total_profit_pct ?? -Infinity) - (a.total_profit_pct ?? -Infinity));
    } else if (s === 'loss') {
      runs = [...runs].sort((a, b) => (a.best_loss ?? Infinity) - (b.best_loss ?? Infinity));
    } else if (s === 'grade') {
      const gradeOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, F: 4 };
      runs = [...runs].sort(
        (a, b) =>
          (gradeOrder[a.verdict_grade ?? ''] ?? 99) - (gradeOrder[b.verdict_grade ?? ''] ?? 99),
      );
    }
    return runs;
  });

  const favoriteRuns = computed<RunListEntry[]>(() => {
    return allRunsFlat.value.filter((r) => r.favorite).slice(0, 5);
  });

  function setSortBy(s: 'date' | 'profit' | 'loss' | 'grade') {
    sortBy.value = s;
    localStorage.setItem('sd-sortBy', s);
  }

  function setGroupBy(g: 'type' | 'strategy') {
    groupBy.value = g;
    localStorage.setItem('sd-groupBy', g);
  }

  function setSidebarWidth(w: number) {
    sidebarWidth.value = w;
    localStorage.setItem('sd-sidebarWidth', String(w));
  }

  const strategies = computed<string[]>(() => {
    const set = new Set(allRunsFlat.value.map((r) => r.strategy));
    return [...set].sort();
  });

  const HO_BATCH_SIZE = 15;
  let _fetchInFlight = false;

  async function fetchAllRuns() {
    if (_fetchInFlight) return;
    _fetchInFlight = true;
    loading.value = true;
    errorCode.value = null;
    errorMessage.value = null;

    allRuns.value = { backtests: [], hyperopts: [], wfa_runs: [] };

    loadingTypes.value = new Set(['backtest', 'wfa', 'hyperopt']);

    const api = getApi();
    let firstError: { status: number; detail: string } | null = null;

    function captureError(e: unknown) {
      const axiosErr = e as { response?: { status?: number; data?: { detail?: string } } };
      if (!firstError) {
        firstError = {
          status: axiosErr.response?.status ?? 0,
          detail: axiosErr.response?.data?.detail ?? 'Network error',
        };
      }
    }

    function finishType(param: string) {
      loadingTypes.value.delete(param);
      loadingTypes.value = new Set(loadingTypes.value);
    }

    const fastTypes = [
      { key: 'backtests' as const, param: 'backtest' },
      { key: 'wfa_runs' as const, param: 'wfa' },
    ];

    const fastPromises = fastTypes.map(async ({ key, param }) => {
      try {
        const { data } = await api.get<AllRunsResponse>('/stratdev/runs', {
          params: { run_type: param },
          timeout: 120000,
        });
        allRuns.value = { ...allRuns.value!, [key]: data[key] || [] };
      } catch (e) {
        captureError(e);
        console.error(`Failed to fetch ${param} runs`, e);
      } finally {
        finishType(param);
      }
    });

    const hyperoptPromise = (async () => {
      try {
        let offset = 0;
        let total = Infinity;
        while (offset < total) {
          const { data } = await api.get<AllRunsResponse>('/stratdev/runs', {
            params: { run_type: 'hyperopt', ho_offset: offset, ho_limit: HO_BATCH_SIZE },
            timeout: 120000,
          });
          const batch = data.hyperopts || [];
          total = data.hyperopts_total ?? batch.length;
          allRuns.value = {
            ...allRuns.value!,
            hyperopts: [...(allRuns.value?.hyperopts || []), ...batch],
          };
          offset += HO_BATCH_SIZE;
          if (batch.length < HO_BATCH_SIZE) break;
        }
      } catch (e) {
        captureError(e);
        console.error('Failed to fetch hyperopt runs', e);
      } finally {
        finishType('hyperopt');
      }
    })();

    await Promise.all([...fastPromises, hyperoptPromise]);

    if (
      firstError &&
      !allRuns.value?.backtests.length &&
      !allRuns.value?.hyperopts.length &&
      !allRuns.value?.wfa_runs.length
    ) {
      errorCode.value = firstError.status;
      errorMessage.value = firstError.detail;
      allRuns.value = null;
    }

    loading.value = false;
    _fetchInFlight = false;
  }

  function _ensureCacheEntry(filename: string): CachedRunData {
    if (!runCache.has(filename)) {
      runCache.set(filename, { detail: null, analysis: null, snapshot: null });
    }
    return runCache.get(filename)!;
  }

  async function fetchHyperoptDetail(filename: string) {
    const cached = runCache.get(filename);
    if (cached?.detail) {
      hyperoptDetail.value = cached.detail;
      return;
    }
    try {
      const api = getApi();
      const { data } = await api.get<Record<string, unknown>>(`/stratdev/hyperopt/${filename}`);
      hyperoptDetail.value = data;
      _ensureCacheEntry(filename).detail = data;
    } catch (e) {
      console.error('Failed to fetch hyperopt detail', e);
    }
  }

  async function fetchHyperoptAnalysis(filename: string) {
    const cached = runCache.get(filename);
    if (cached?.analysis) {
      hyperoptAnalysis.value = cached.analysis;
      return;
    }
    try {
      const api = getApi();
      const { data } = await api.get<Record<string, unknown>>(
        `/stratdev/hyperopt/${filename}/analysis`,
      );
      hyperoptAnalysis.value = data;
      _ensureCacheEntry(filename).analysis = data;
    } catch (e) {
      console.error('Failed to fetch hyperopt analysis', e);
    }
  }

  async function fetchWfaDetail(filename: string) {
    const cached = runCache.get(filename);
    if (cached?.detail) {
      wfaDetail.value = cached.detail;
      return;
    }
    try {
      const api = getApi();
      const { data } = await api.get<Record<string, unknown>>(`/stratdev/wfa/${filename}`);
      wfaDetail.value = data;
      _ensureCacheEntry(filename).detail = data;
    } catch (e) {
      console.error('Failed to fetch WFA detail', e);
    }
  }

  async function fetchBacktestSnapshot(filename: string, strategy: string) {
    const cached = runCache.get(filename);
    if (cached?.snapshot) {
      backtestSnapshot.value = cached.snapshot;
      return;
    }
    try {
      const api = getApi();
      const { data } = await api.get<BacktestSnapshotResponse>(
        `/stratdev/backtest/${filename}/snapshot`,
        { params: { strategy } },
      );
      backtestSnapshot.value = data;
      _ensureCacheEntry(filename).snapshot = data;
    } catch (e) {
      console.error('Failed to fetch backtest snapshot', e);
    }
  }

  async function fetchDiff(runType: RunType, filename: string, diffType: string) {
    try {
      const api = getApi();
      const { data } = await api.post<SnapshotDiffResponse>('/stratdev/diff', {
        run_type: runType,
        filename,
        diff_type: diffType,
      });
      diffResult.value = data;
    } catch (e) {
      console.error('Failed to fetch diff', e);
    }
  }

  async function deleteRun(runType: RunType, filename: string) {
    try {
      const api = getApi();
      if (runType === RunType.hyperopt) {
        await api.delete(`/stratdev/hyperopt/${filename}`);
      } else if (runType === RunType.wfa) {
        await api.delete(`/stratdev/wfa/${filename}`);
      }

      // Immediately clear selection if we deleted the selected run
      if (selectedRun.value?.filename === filename) {
        selectedRun.value = null;
        hyperoptDetail.value = null;
        wfaDetail.value = null;
      }

      // Remove from local list immediately for snappy UI
      if (allRuns.value) {
        if (runType === RunType.hyperopt) {
          allRuns.value.hyperopts = allRuns.value.hyperopts.filter(
            (r) => r.filename !== filename,
          );
        } else if (runType === RunType.wfa) {
          allRuns.value.wfa_runs = allRuns.value.wfa_runs.filter(
            (r) => r.filename !== filename,
          );
        } else if (runType === RunType.backtest) {
          allRuns.value.backtests = allRuns.value.backtests.filter(
            (r) => r.filename !== filename,
          );
        }
      }

      runCache.delete(filename);

    } catch (e) {
      console.error('Failed to delete run', e);
    }
  }

  async function updateMetadata(runType: RunType, filename: string, body: MetadataUpdateRequest) {
    try {
      const api = getApi();
      if (runType === RunType.hyperopt) {
        await api.patch(`/stratdev/hyperopt/${filename}`, body);
      } else if (runType === RunType.wfa) {
        await api.patch(`/stratdev/wfa/${filename}`, body);
      }
      const entry = allRunsFlat.value.find((r) => r.filename === filename);
      if (entry && body.favorite !== undefined) {
        entry.favorite = body.favorite;
      }
    } catch (e) {
      console.error('Failed to update metadata', e);
    }
  }

  async function fetchGlossary() {
    if (glossary.value) return;
    try {
      const api = getApi();
      const { data } = await api.get<GlossaryResponse>('/stratdev/glossary');
      glossary.value = data;
    } catch (e) {
      console.error('Failed to fetch glossary', e);
    }
  }

  // ── Per-run view state (tab + scroll persistence) ──
  const runViewState = reactive(new Map<string, { tab: string; scrollTop: Record<string, number> }>());

  function saveRunViewState(filename: string, tab: string, scrollTop: Record<string, number>) {
    runViewState.set(filename, { tab, scrollTop });
  }

  function getRunViewState(filename: string) {
    return runViewState.get(filename) ?? null;
  }

  // ── Comparison ──
  const compareRun = ref<RunListEntry | null>(null);
  const compareDetail = ref<Record<string, unknown> | null>(null);

  async function setCompareRun(run: RunListEntry | null) {
    compareRun.value = run;
    compareDetail.value = null;
    if (!run) return;
    const cached = runCache.get(run.filename);
    if (cached?.detail) {
      compareDetail.value = cached.detail;
      return;
    }
    if (cached?.snapshot) {
      compareDetail.value = cached.snapshot as unknown as Record<string, unknown>;
      return;
    }
    try {
      const api = getApi();
      if (run.run_type === RunType.hyperopt) {
        const { data } = await api.get<Record<string, unknown>>(`/stratdev/hyperopt/${run.filename}`);
        compareDetail.value = data;
        _ensureCacheEntry(run.filename).detail = data;
      } else if (run.run_type === RunType.wfa) {
        const { data } = await api.get<Record<string, unknown>>(`/stratdev/wfa/${run.filename}`);
        compareDetail.value = data;
        _ensureCacheEntry(run.filename).detail = data;
      } else if (run.run_type === RunType.backtest) {
        const { data } = await api.get<Record<string, unknown>>(
          `/stratdev/backtest/${run.filename}/snapshot`,
          { params: { strategy: run.strategy } },
        );
        compareDetail.value = data;
        _ensureCacheEntry(run.filename).snapshot = data as unknown as BacktestSnapshotResponse;
      }
    } catch (e) {
      console.error('Failed to fetch compare detail', e);
    }
  }

  function selectRun(run: RunListEntry | null) {
    selectedRun.value = run;
    diffResult.value = null;
    if (run) {
      const cached = runCache.get(run.filename);
      hyperoptDetail.value = cached?.detail && run.run_type === RunType.hyperopt ? cached.detail : null;
      hyperoptAnalysis.value = cached?.analysis ?? null;
      wfaDetail.value = cached?.detail && run.run_type === RunType.wfa ? cached.detail : null;
      backtestSnapshot.value = cached?.snapshot ?? null;
      backtestAnalysis.value = null;
    } else {
      hyperoptDetail.value = null;
      hyperoptAnalysis.value = null;
      advancedAnalytics.value = null;
      wfaDetail.value = null;
      backtestSnapshot.value = null;
      backtestAnalysis.value = null;
      plotProfitData.value = null;
      plotDataframeData.value = null;
      backtestPairs.value = [];
    }
  }

  async function fetchAdvancedAnalytics(filename: string) {
    try {
      const api = getApi();
      const { data } = await api.get<Record<string, unknown>>(
        `/stratdev/hyperopt/${filename}/advanced`,
      );
      advancedAnalytics.value = data;
    } catch (e) {
      console.error('Failed to fetch advanced analytics', e);
    }
  }

  async function fetchEpochDetail(filename: string, rank: number): Promise<Record<string, unknown> | null> {
    try {
      const api = getApi();
      const { data } = await api.get<Record<string, unknown>>(
        `/stratdev/hyperopt/${filename}/epoch/${rank}`,
      );
      return data;
    } catch (e) {
      console.error('Failed to fetch epoch detail', e);
      return null;
    }
  }

  async function fetchEpochAdvancedAnalytics(
    filename: string,
    rank: number,
  ): Promise<Record<string, unknown> | null> {
    const cacheKey = `${filename}:${rank}`;
    const cached = epochAnalyticsCache.get(cacheKey);
    if (cached) return cached;
    try {
      const api = getApi();
      const { data } = await api.get<Record<string, unknown>>(
        `/stratdev/hyperopt/${filename}/epoch/${rank}/advanced`,
      );
      epochAnalyticsCache.set(cacheKey, data);
      return data;
    } catch (e) {
      console.error('Failed to fetch epoch advanced analytics', e);
      return null;
    }
  }

  async function fetchPlotProfit(filename: string, strategy: string) {
    try {
      const api = getApi();
      const { data } = await api.get<Record<string, unknown>>(
        `/stratdev/backtest/${filename}/plot-profit`,
        { params: { strategy } },
      );
      plotProfitData.value = data;
    } catch (e) {
      console.error('Failed to fetch plot-profit data', e);
    }
  }

  async function fetchPlotDataframe(filename: string, strategy: string, pair: string) {
    try {
      const api = getApi();
      const { data } = await api.get<Record<string, unknown>>(
        `/stratdev/backtest/${filename}/plot-dataframe`,
        { params: { strategy, pair } },
      );
      plotDataframeData.value = data;
    } catch (e) {
      console.error('Failed to fetch plot-dataframe data', e);
    }
  }

  async function fetchBacktestPairs(filename: string, strategy: string) {
    try {
      const api = getApi();
      const { data } = await api.get<{ pairs: string[] }>(
        `/stratdev/backtest/${filename}/pairs`,
        { params: { strategy } },
      );
      backtestPairs.value = data.pairs || [];
    } catch (e) {
      console.error('Failed to fetch backtest pairs', e);
    }
  }

  async function fetchBacktestAnalysis(filename: string, strategy: string) {
    try {
      const api = getApi();
      const { data } = await api.get<Record<string, unknown>>(
        `/stratdev/backtest/${filename}/analysis`,
        { params: { strategy } },
      );
      backtestAnalysis.value = data;
    } catch (e) {
      console.error('Failed to fetch backtest analysis', e);
    }
  }

  return {
    allRuns,
    loading,
    loadingTypes,
    errorCode,
    errorMessage,
    selectedRun,
    hyperoptDetail,
    hyperoptAnalysis,
    wfaDetail,
    backtestSnapshot,
    diffResult,
    glossary,
    filterText,
    filterType,
    filterStrategy,
    filterDateRange,
    filterFavoritesOnly,
    sortBy,
    groupBy,
    sidebarWidth,
    allRunsFlat,
    filteredRuns,
    favoriteRuns,
    strategies,
    setSortBy,
    setGroupBy,
    setSidebarWidth,
    fetchAllRuns,
    fetchHyperoptDetail,
    fetchHyperoptAnalysis,
    fetchWfaDetail,
    fetchBacktestSnapshot,
    fetchDiff,
    deleteRun,
    updateMetadata,
    fetchGlossary,
    selectRun,
    compareRun,
    compareDetail,
    setCompareRun,
    runCache,
    runViewState,
    saveRunViewState,
    getRunViewState,
    advancedAnalytics,
    backtestAnalysis,
    fetchBacktestAnalysis,
    fetchAdvancedAnalytics,
    fetchEpochDetail,
    epochAnalyticsCache,
    selectedEpochRank,
    analyseMode,
    compareEpochRanks,
    fetchEpochAdvancedAnalytics,
    plotProfitData,
    plotDataframeData,
    backtestPairs,
    fetchPlotProfit,
    fetchPlotDataframe,
    fetchBacktestPairs,
  };
});
