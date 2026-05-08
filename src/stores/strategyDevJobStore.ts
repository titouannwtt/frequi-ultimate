import type {
  ConfigDefaults,
  ConfigListResponse,
  JobListResponse,
  JobStartRequest,
  JobStatusResponse,
} from '@/types';
import { JobStatus } from '@/types';

const POLL_INTERVAL_MS = 2000;

export const useStrategyDevJobStore = defineStore('strategyDevJobs', () => {
  const botStore = useBotStore();

  const activeJob = ref<JobStatusResponse | null>(null);
  const jobHistory = ref<JobStatusResponse[]>([]);
  const availableConfigs = ref<string[]>([]);
  const availableStrategies = ref<string[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  let _pollTimer: ReturnType<typeof setInterval> | null = null;

  function getApi() {
    const loginInfo = useLoginInfo(botStore.selectedBot);
    return useApi(loginInfo, botStore.selectedBot).api;
  }

  const configsError = ref<string | null>(null);

  async function fetchConfigs() {
    configsError.value = null;
    try {
      const api = getApi();
      const { data } = await api.get<ConfigListResponse>('/stratdev/configs');
      availableConfigs.value = data.configs;
      availableStrategies.value = data.strategies;
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 404) {
        configsError.value =
          'Endpoint /stratdev/configs not found — this bot needs a restart to load the new code.';
      } else {
        configsError.value = e?.response?.data?.detail ?? e?.message ?? 'Failed to fetch configs';
      }
      console.error('Failed to fetch configs', e);
    }
  }

  async function fetchConfigDefaults(configFile: string): Promise<ConfigDefaults | null> {
    try {
      const api = getApi();
      const { data } = await api.get<ConfigDefaults>('/stratdev/configs/defaults', {
        params: { config_file: configFile },
      });
      return data;
    } catch (e) {
      console.error('Failed to fetch config defaults', e);
      return null;
    }
  }

  async function fetchJobs() {
    try {
      const api = getApi();
      const { data } = await api.get<JobListResponse>('/stratdev/jobs');
      if (data.active) {
        activeJob.value = data.active;
      }
      jobHistory.value = data.history;
    } catch (e) {
      console.error('Failed to fetch jobs', e);
    }
  }

  async function fetchJobDetail(jobId: string): Promise<JobStatusResponse | null> {
    try {
      const api = getApi();
      const { data } = await api.get<JobStatusResponse>(`/stratdev/jobs/${jobId}`);
      if (activeJob.value?.job_id === jobId) {
        activeJob.value = data;
      }
      return data;
    } catch (e) {
      console.error('Failed to fetch job detail', e);
      return null;
    }
  }

  async function startJob(request: JobStartRequest): Promise<JobStatusResponse | null> {
    loading.value = true;
    error.value = null;
    try {
      const api = getApi();
      const { data } = await api.post<JobStatusResponse>('/stratdev/jobs/start', request);
      activeJob.value = data;
      startPolling();
      return data;
    } catch (e: any) {
      const detail = e?.response?.data?.detail ?? e?.message ?? 'Unknown error';
      error.value = detail;
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function abortJob(jobId: string): Promise<boolean> {
    try {
      const api = getApi();
      const { data } = await api.post<JobStatusResponse>(`/stratdev/jobs/${jobId}/abort`);
      activeJob.value = data;
      return true;
    } catch (e: any) {
      error.value = e?.response?.data?.detail ?? 'Failed to abort';
      return false;
    }
  }

  function startPolling() {
    stopPolling();
    _pollTimer = setInterval(async () => {
      if (!activeJob.value) {
        stopPolling();
        return;
      }
      const detail = await fetchJobDetail(activeJob.value.job_id);
      if (detail) {
        activeJob.value = detail;
        if (detail.status !== JobStatus.pending && detail.status !== JobStatus.running) {
          stopPolling();
          await fetchJobs();
        }
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  const isJobRunning = computed(
    () => activeJob.value?.status === JobStatus.running
      || activeJob.value?.status === JobStatus.pending,
  );

  const jobProgress = computed(() => {
    if (!activeJob.value?.log_lines?.length) return '';
    const lines = activeJob.value.log_lines;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const pctMatch = line.match(/(\d+(?:\.\d+)?)\s*%/);
      if (pctMatch) return `${pctMatch[1]}%`;
      const epochMatch = line.match(/(\d+)\/(\d+)\s/);
      if (epochMatch) return `${epochMatch[1]}/${epochMatch[2]}`;
    }
    return '';
  });

  function $reset() {
    stopPolling();
    activeJob.value = null;
    jobHistory.value = [];
    availableConfigs.value = [];
    availableStrategies.value = [];
    loading.value = false;
    error.value = null;
  }

  return {
    activeJob,
    jobHistory,
    availableConfigs,
    availableStrategies,
    loading,
    error,
    configsError,
    isJobRunning,
    jobProgress,
    fetchConfigs,
    fetchConfigDefaults,
    fetchJobs,
    fetchJobDetail,
    startJob,
    abortJob,
    startPolling,
    stopPolling,
    $reset,
  };
});
