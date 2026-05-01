import type {
  AllRunsResponse,
  BacktestSnapshotResponse,
  GlossaryResponse,
  MetadataUpdateRequest,
  RunListEntry,
  SnapshotDiffResponse,
} from '@/types';
import { RunType } from '@/types';

export const useStrategyDevStore = defineStore('strategyDev', () => {
  const botStore = useBotStore();

  const allRuns = ref<AllRunsResponse | null>(null);
  const loading = ref(false);
  const errorCode = ref<number | null>(null);
  const errorMessage = ref<string | null>(null);
  const selectedRun = ref<RunListEntry | null>(null);
  const hyperoptDetail = ref<Record<string, unknown> | null>(null);
  const hyperoptAnalysis = ref<Record<string, unknown> | null>(null);
  const wfaDetail = ref<Record<string, unknown> | null>(null);
  const backtestSnapshot = ref<BacktestSnapshotResponse | null>(null);
  const diffResult = ref<SnapshotDiffResponse | null>(null);
  const glossary = ref<GlossaryResponse | null>(null);
  const filterText = ref('');
  const filterType = ref<RunType | null>(null);
  const filterStrategy = ref<string | null>(null);

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
    if (filterType.value) {
      runs = runs.filter((r) => r.run_type === filterType.value);
    }
    if (filterStrategy.value) {
      runs = runs.filter((r) => r.strategy === filterStrategy.value);
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
    return runs;
  });

  const strategies = computed<string[]>(() => {
    const set = new Set(allRunsFlat.value.map((r) => r.strategy));
    return [...set].sort();
  });

  async function fetchAllRuns() {
    loading.value = true;
    errorCode.value = null;
    errorMessage.value = null;
    try {
      const api = getApi();
      const { data } = await api.get<AllRunsResponse>('/stratdev/runs');
      allRuns.value = data;
    } catch (e: unknown) {
      const axiosErr = e as { response?: { status?: number; data?: { detail?: string } } };
      errorCode.value = axiosErr.response?.status ?? 0;
      errorMessage.value = axiosErr.response?.data?.detail ?? 'Network error';
      console.error('Failed to fetch stratdev runs', e);
    } finally {
      loading.value = false;
    }
  }

  async function fetchHyperoptDetail(filename: string) {
    try {
      const api = getApi();
      const { data } = await api.get<Record<string, unknown>>(`/stratdev/hyperopt/${filename}`);
      hyperoptDetail.value = data;
    } catch (e) {
      console.error('Failed to fetch hyperopt detail', e);
    }
  }

  async function fetchHyperoptAnalysis(filename: string) {
    try {
      const api = getApi();
      const { data } = await api.get<Record<string, unknown>>(
        `/stratdev/hyperopt/${filename}/analysis`,
      );
      hyperoptAnalysis.value = data;
    } catch (e) {
      console.error('Failed to fetch hyperopt analysis', e);
    }
  }

  async function fetchWfaDetail(filename: string) {
    try {
      const api = getApi();
      const { data } = await api.get<Record<string, unknown>>(`/stratdev/wfa/${filename}`);
      wfaDetail.value = data;
    } catch (e) {
      console.error('Failed to fetch WFA detail', e);
    }
  }

  async function fetchBacktestSnapshot(filename: string, strategy: string) {
    try {
      const api = getApi();
      const { data } = await api.get<BacktestSnapshotResponse>(
        `/stratdev/backtest/${filename}/snapshot`,
        { params: { strategy } },
      );
      backtestSnapshot.value = data;
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
      await fetchAllRuns();
      if (selectedRun.value?.filename === filename) {
        selectedRun.value = null;
        hyperoptDetail.value = null;
        wfaDetail.value = null;
      }
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

  function selectRun(run: RunListEntry | null) {
    selectedRun.value = run;
    hyperoptDetail.value = null;
    hyperoptAnalysis.value = null;
    wfaDetail.value = null;
    backtestSnapshot.value = null;
    diffResult.value = null;
  }

  return {
    allRuns,
    loading,
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
    allRunsFlat,
    filteredRuns,
    strategies,
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
  };
});
