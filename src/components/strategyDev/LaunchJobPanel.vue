<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { VueDatePicker } from '@vuepic/vue-datepicker';
import '@vuepic/vue-datepicker/dist/main.css';
import { JobType, JobStatus } from '@/types';
import type { JobStartRequest } from '@/types';
import { parseTimerangeToDates } from '@/utils/reconstitute';

const props = defineProps<{
  configOverride?: string | null;
  prefill?: Partial<JobStartRequest> | null;
}>();

const emit = defineEmits<{
  'config-used': [];
  'prefill-applied': [];
}>();

const { t } = useI18n();
const jobStore = useStrategyDevJobStore();
const stratStore = useStrategyDevStore();
const settingsStore = useSettingsStore();
const editorStore = useEditorStore();

const jobType = ref<JobType>(JobType.backtest);
const configFile = ref('');
const strategy = ref('');
const dateFrom = ref('');
const dateTo = ref('');
const timeframe = ref('');

const timerange = computed(() => {
  if (!dateFrom.value && !dateTo.value) return '';
  const from = dateFrom.value ? dateStringToTimeRange(dateFrom.value) : '';
  const to = dateTo.value ? dateStringToTimeRange(dateTo.value) : '';
  return `${from}-${to}`;
});

const now = new Date();

interface ConfigGroup {
  label: string;
  configs: string[];
}

const configGroups = computed<ConfigGroup[]>(() => {
  const groups = new Map<string, string[]>();
  for (const c of jobStore.availableConfigs) {
    const slashIdx = c.lastIndexOf('/');
    const dir = slashIdx >= 0 ? c.substring(0, slashIdx) : '(root)';
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(c);
  }
  const order = ['backtest_configs', 'live_configs', 'user_data', 'config_examples', '(root)'];
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .map(([label, configs]) => ({ label, configs }));
});

// Base params
const maxOpenTrades = ref<number | null>(null);
const stakeAmount = ref('');
const enableProtections = ref(false);
const dryRunWallet = ref<number | null>(null);

// Common advanced
const dataFormatOhlcv = ref('');
const fee = ref<number | null>(null);
const pairsText = ref('');
const enablePositionStacking = ref(false);
const timeframeDetail = ref('');

// Backtest-only
const exportType = ref('trades');
const breakdown = ref<string[]>([]);
const cache = ref('');
const enableDynamicPairlist = ref(false);
const notes = ref('');

// Hyperopt / WFA
const epochs = ref(500);
const spaces = ref<string[]>(['default']);
const hyperoptLoss = ref('CalmarHyperOptLoss');
const sampler = ref('');
const earlyStop = ref<number | null>(null);
const minTrades = ref<number | null>(null);
const jobWorkers = ref(-2);
const randomState = ref<number | null>(null);

// Hyperopt-only flags
const printAll = ref(false);
const disableParamExport = ref(false);
const ignoreMissingSpaces = ref(false);
const analyzePerEpoch = ref(false);

// WFA
const wfWindows = ref(5);
const wfTrainRatio = ref(0.75);
const wfEmbargoDays = ref(7);
const wfHoldoutMonths = ref(0);
const wfMinTestTrades = ref(30);
const wfMode = ref('rolling');
const wfMultiSeed = ref<number | null>(null);
const wfCpcvGroups = ref(6);
const wfCpcvTestGroups = ref(2);

// UI state
const activeTab = ref<'config' | 'console'>('config');
const confirmAbort = ref(false);
const showAdvanced = ref(false);

const jobTypeOptions = [
  { label: 'Backtest', value: JobType.backtest },
  { label: 'Hyperopt', value: JobType.hyperopt },
  { label: 'Walk-Forward', value: JobType.wfa },
];

const spaceOptions = [
  { label: 'Default', value: 'default' },
  { label: 'All', value: 'all' },
  { label: 'Buy/Enter', value: 'buy' },
  { label: 'Sell/Exit', value: 'sell' },
  { label: 'ROI', value: 'roi' },
  { label: 'Stoploss', value: 'stoploss' },
  { label: 'Trailing', value: 'trailing' },
  { label: 'Protection', value: 'protection' },
  { label: 'Trades', value: 'trades' },
];

const samplerOptions = [
  { label: t('strategyDev.jobSamplerAuto'), value: '' },
  { label: 'NSGA-III (genetic)', value: 'NSGAIIISampler' },
  { label: 'TPE (bayesian)', value: 'TPESampler' },
  { label: 'CMA-ES (gradient-free)', value: 'CmaEsSampler' },
  { label: 'GP (gaussian)', value: 'GPSampler' },
  { label: 'QMC (pure exploration)', value: 'QMCSampler' },
];

const wfModeOptions = [
  { label: 'Rolling', value: 'rolling' },
  { label: 'Anchored', value: 'anchored' },
  { label: 'CPCV', value: 'cpcv' },
];

const lossOptions = [
  'CalmarHyperOptLoss',
  'SharpeHyperOptLoss',
  'SortinoHyperOptLoss',
  'MoutonMeanRevHyperOptLoss',
  'MoutonMomentumHyperOptLoss',
  'MaxDrawDownHyperOptLoss',
  'MaxDrawDownRelativeHyperOptLoss',
  'MaxDrawDownPerPairHyperOptLoss',
  'ProfitDrawDownHyperOptLoss',
  'MultiMetricHyperOptLoss',
  'OnlyProfitHyperOptLoss',
  'ShortTradeDurHyperOptLoss',
  'SharpeHyperOptLossDaily',
  'SortinoHyperOptLossDaily',
  'MyProfitDrawDownHyperOptLoss',
];

const dataFormatOptions = [
  { label: 'Feather (default)', value: '' },
  { label: 'Feather', value: 'feather' },
  { label: 'Parquet', value: 'parquet' },
  { label: 'JSON', value: 'json' },
  { label: 'JSON GZ', value: 'jsongz' },
];

const exportTypeOptions = [
  { label: 'Trades (default)', value: 'trades' },
  { label: 'Signals', value: 'signals' },
  { label: 'None', value: 'none' },
];

const breakdownOptions = [
  { label: 'Day', value: 'day' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
  { label: 'Year', value: 'year' },
  { label: 'Weekday', value: 'weekday' },
];

const cacheOptions = [
  { label: 'Day (default)', value: '' },
  { label: 'Day', value: 'day' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
  { label: 'None', value: 'none' },
];

const isBacktest = computed(() => jobType.value === JobType.backtest);
const isHyperopt = computed(() => jobType.value === JobType.hyperopt);
const isHyperoptOrWfa = computed(() => jobType.value !== JobType.backtest);
const isWfa = computed(() => jobType.value === JobType.wfa);
const isCpcv = computed(() => wfMode.value === 'cpcv');

const configInfo = ref('');

onMounted(() => {
  jobStore.fetchConfigs();
  jobStore.fetchJobs();
});

watch(configFile, async (newVal) => {
  if (!newVal) {
    configInfo.value = '';
    return;
  }
  const defaults = await jobStore.fetchConfigDefaults(newVal);
  if (!defaults) return;

  if (defaults.max_open_trades != null) maxOpenTrades.value = defaults.max_open_trades;
  if (defaults.stake_amount != null) stakeAmount.value = defaults.stake_amount;
  if (defaults.dry_run_wallet != null) dryRunWallet.value = defaults.dry_run_wallet;
  if (defaults.timeframe) timeframe.value = defaults.timeframe;

  const parts: string[] = [];
  if (defaults.exchange) parts.push(defaults.exchange);
  if (defaults.trading_mode) parts.push(defaults.trading_mode);
  if (defaults.stake_currency) parts.push(defaults.stake_currency);
  if (defaults.pairs_count) parts.push(`${defaults.pairs_count} pairs`);
  configInfo.value = parts.join(' · ');
});

watch(
  () => props.configOverride,
  (path) => {
    if (path) {
      configFile.value = path;
      emit('config-used');
    }
  },
);

function applyPrefill(p: Partial<JobStartRequest>) {
  if (p.job_type) jobType.value = p.job_type;
  if (p.config_file) configFile.value = p.config_file;
  if (p.strategy) strategy.value = p.strategy;
  if (p.timeframe) timeframe.value = p.timeframe;

  if (p.timerange) {
    const dates = parseTimerangeToDates(p.timerange);
    if (dates) {
      dateFrom.value = dates.from;
      dateTo.value = dates.to;
    }
  }

  if (p.max_open_trades != null) maxOpenTrades.value = p.max_open_trades;
  if (p.stake_amount != null) stakeAmount.value = String(p.stake_amount);
  if (p.dry_run_wallet != null) dryRunWallet.value = p.dry_run_wallet;
  if (p.enable_protections != null) enableProtections.value = p.enable_protections;

  if (p.epochs != null) epochs.value = p.epochs;
  if (p.spaces?.length) spaces.value = p.spaces;
  if (p.hyperopt_loss) hyperoptLoss.value = p.hyperopt_loss;
  if (p.sampler) sampler.value = p.sampler;
  if (p.early_stop != null) earlyStop.value = p.early_stop;
  if (p.min_trades != null) minTrades.value = p.min_trades;
  if (p.job_workers != null) jobWorkers.value = p.job_workers;
  if (p.random_state != null) randomState.value = p.random_state;

  if (p.wf_windows != null) wfWindows.value = p.wf_windows;
  if (p.wf_train_ratio != null) wfTrainRatio.value = p.wf_train_ratio;
  if (p.wf_embargo_days != null) wfEmbargoDays.value = p.wf_embargo_days;
  if (p.wf_holdout_months != null) wfHoldoutMonths.value = p.wf_holdout_months;
  if (p.wf_min_test_trades != null) wfMinTestTrades.value = p.wf_min_test_trades;
  if (p.wf_mode) wfMode.value = p.wf_mode;

  if (p.notes) notes.value = p.notes;
  if (p.pairs?.length) {
    pairsText.value = p.pairs.join(', ');
    showAdvanced.value = true;
  }
  if (p.fee != null) fee.value = p.fee;
  if (p.data_format_ohlcv) dataFormatOhlcv.value = p.data_format_ohlcv;

  activeTab.value = 'config';
}

watch(
  () => props.prefill,
  (p) => {
    if (p) {
      applyPrefill(p);
      emit('prefill-applied');
    }
  },
  { immediate: true },
);

const isCustomConfig = computed(() => configFile.value.startsWith('custom_configs/'));
const customConfigLabel = computed(() => {
  const m = configFile.value.match(/custom_config_(\d+)/);
  return m ? `Custom #${m[1]}` : '';
});

function editConfig() {
  if (!configFile.value) return;
  if (isCustomConfig.value) {
    editorStore.openFile(configFile.value, 'json');
  } else {
    editorStore.openFile(configFile.value, 'json', true).then(() => {
      const af = editorStore.activeFile;
      if (af?.isCustom) {
        configFile.value = af.path;
        jobStore.fetchConfigs();
      }
    });
  }
}

function editStrategy() {
  if (!strategy.value) return;
  editorStore.openFile(`user_data/strategies/${strategy.value}.py`, 'python');
}

const canStart = computed(() => {
  if (jobStore.isJobRunning) return false;
  if (!configFile.value || !strategy.value) return false;
  if (isHyperoptOrWfa.value && (!epochs.value || epochs.value < 1)) return false;
  return true;
});

async function handleStart() {
  const req: JobStartRequest = {
    job_type: jobType.value,
    config_file: configFile.value,
    strategy: strategy.value,
  };

  if (timerange.value) req.timerange = timerange.value;
  if (timeframe.value) req.timeframe = timeframe.value;
  if (maxOpenTrades.value != null) req.max_open_trades = maxOpenTrades.value;
  if (stakeAmount.value) req.stake_amount = stakeAmount.value;
  if (enableProtections.value) req.enable_protections = true;
  if (dryRunWallet.value != null) req.dry_run_wallet = dryRunWallet.value;

  // Common advanced
  if (dataFormatOhlcv.value) req.data_format_ohlcv = dataFormatOhlcv.value;
  if (fee.value != null) req.fee = fee.value;
  if (pairsText.value)
    req.pairs = pairsText.value
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  if (enablePositionStacking.value) req.enable_position_stacking = true;
  if (timeframeDetail.value) req.timeframe_detail = timeframeDetail.value;

  // Backtest-only
  if (isBacktest.value) {
    if (exportType.value && exportType.value !== 'trades') req.export_type = exportType.value;
    if (breakdown.value.length) req.breakdown = breakdown.value;
    if (cache.value) req.cache = cache.value;
    if (enableDynamicPairlist.value) req.enable_dynamic_pairlist = true;
    if (notes.value) req.notes = notes.value;
  }

  // Hyperopt / WFA
  if (isHyperoptOrWfa.value) {
    req.epochs = epochs.value;
    if (spaces.value.length) req.spaces = spaces.value;
    if (hyperoptLoss.value) req.hyperopt_loss = hyperoptLoss.value;
    if (sampler.value) req.sampler = sampler.value;
    if (earlyStop.value) req.early_stop = earlyStop.value;
    if (minTrades.value) req.min_trades = minTrades.value;
    req.job_workers = jobWorkers.value;
    if (randomState.value != null) req.random_state = randomState.value;
  }

  // Hyperopt-only flags
  if (isHyperopt.value) {
    if (printAll.value) req.print_all = true;
    if (disableParamExport.value) req.disable_param_export = true;
    if (ignoreMissingSpaces.value) req.ignore_missing_spaces = true;
    if (analyzePerEpoch.value) req.analyze_per_epoch = true;
  }

  // WFA
  if (isWfa.value) {
    req.wf_windows = wfWindows.value;
    req.wf_train_ratio = wfTrainRatio.value;
    req.wf_embargo_days = wfEmbargoDays.value;
    req.wf_holdout_months = wfHoldoutMonths.value;
    req.wf_min_test_trades = wfMinTestTrades.value;
    req.wf_mode = wfMode.value;
    if (wfMultiSeed.value != null) req.wf_multi_seed = wfMultiSeed.value;
    if (isCpcv.value) {
      req.wf_cpcv_groups = wfCpcvGroups.value;
      req.wf_cpcv_test_groups = wfCpcvTestGroups.value;
    }
  }

  const result = await jobStore.startJob(req);
  if (result) {
    activeTab.value = 'console';
  }
}

async function handleAbort() {
  if (!jobStore.activeJob) return;
  await jobStore.abortJob(jobStore.activeJob.job_id);
  confirmAbort.value = false;
}

const activeJob = computed(() => jobStore.activeJob);
const isRunning = computed(() => jobStore.isJobRunning);
const logLines = computed(() => activeJob.value?.log_lines ?? []);
const logText = computed(() => logLines.value.join('\n'));

const statusColor = computed(() => {
  switch (activeJob.value?.status) {
    case JobStatus.running:
      return 'var(--sd-info)';
    case JobStatus.completed:
      return 'var(--sd-success)';
    case JobStatus.failed:
      return 'var(--sd-danger)';
    case JobStatus.aborted:
      return 'var(--sd-warning)';
    default:
      return 'var(--sd-overlay)';
  }
});

const statusLabel = computed(() => {
  if (!activeJob.value) return '';
  const s = activeJob.value.status;
  const progress = jobStore.jobProgress;
  if (s === JobStatus.running && progress) return `${t('strategyDev.jobRunning')} — ${progress}`;
  return t(`strategyDev.jobStatus_${s}`);
});

function onJobComplete() {
  stratStore.fetchAllRuns();
}

watch(
  () => activeJob.value?.status,
  (newStatus, oldStatus) => {
    if (oldStatus === JobStatus.running && newStatus === JobStatus.completed) {
      onJobComplete();
    }
  },
);

const logContainer = ref<HTMLElement>();
watch(logLines, () => {
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight;
    }
  });
});

const jobDuration = computed(() => {
  const job = activeJob.value;
  if (!job?.started_at) return '';
  const end = job.finished_at ?? Date.now() / 1000;
  const secs = Math.floor(end - job.started_at);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m${remSecs > 0 ? ` ${remSecs}s` : ''}`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h${remMins > 0 ? ` ${remMins}m` : ''}`;
});

const durationTimer = ref(0);
let _durationInterval: ReturnType<typeof setInterval> | null = null;

watch(
  isRunning,
  (running) => {
    if (running) {
      _durationInterval = setInterval(() => {
        durationTimer.value++;
      }, 1000);
    } else if (_durationInterval) {
      clearInterval(_durationInterval);
      _durationInterval = null;
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (_durationInterval) clearInterval(_durationInterval);
});

const hasConsoleContent = computed(() => activeJob.value != null || jobStore.jobHistory.length > 0);

const consoleBadge = computed(() => {
  if (isRunning.value) return 'live';
  if (activeJob.value?.status === JobStatus.failed) return 'error';
  if (activeJob.value?.status === JobStatus.completed) return 'done';
  return '';
});
</script>

<template>
  <div class="launch-panel">
    <!-- Tab bar -->
    <div class="launch-tabs">
      <button
        class="launch-tab"
        :class="{ 'launch-tab--active': activeTab === 'config' }"
        @click="activeTab = 'config'"
      >
        <i-mdi-cog-outline class="launch-tab-icon" />
        {{ t('strategyDev.jobTabConfig') }}
      </button>
      <button
        class="launch-tab"
        :class="{
          'launch-tab--active': activeTab === 'console',
          'launch-tab--live': consoleBadge === 'live',
          'launch-tab--error': consoleBadge === 'error',
          'launch-tab--done': consoleBadge === 'done',
        }"
        @click="activeTab = 'console'"
      >
        <i-mdi-console class="launch-tab-icon" />
        {{ t('strategyDev.jobTabConsole') }}
        <span v-if="consoleBadge === 'live'" class="launch-tab-badge launch-tab-badge--live" />
        <span v-else-if="consoleBadge === 'error'" class="launch-tab-badge launch-tab-badge--error"
          >!</span
        >
      </button>
    </div>

    <!-- ═══════════════════ CONSOLE TAB ═══════════════════ -->
    <div v-if="activeTab === 'console'" class="launch-console">
      <!-- No job state -->
      <div v-if="!activeJob && !jobStore.jobHistory.length" class="launch-console-empty">
        <i-mdi-console-line class="launch-console-empty-icon" />
        <p>{{ t('strategyDev.jobConsoleEmpty') }}</p>
      </div>

      <template v-else>
        <!-- Status header -->
        <div v-if="activeJob" class="launch-console-header">
          <div class="launch-console-status">
            <span class="launch-status-dot" :style="{ backgroundColor: statusColor }" />
            <span class="launch-console-status-text">{{ statusLabel }}</span>
            <span class="launch-console-meta">
              {{ activeJob.job_type }} · {{ activeJob.strategy }}
            </span>
            <span v-if="jobDuration" class="launch-console-duration" :key="durationTimer">
              {{ jobDuration }}
            </span>
          </div>
          <div class="launch-console-actions">
            <button
              v-if="isRunning && !confirmAbort"
              class="launch-btn launch-btn--sm launch-btn--danger"
              @click="confirmAbort = true"
            >
              {{ t('strategyDev.jobAbort') }}
            </button>
            <template v-if="confirmAbort">
              <button class="launch-btn launch-btn--sm launch-btn--danger" @click="handleAbort">
                {{ t('strategyDev.jobConfirmAbort') }}
              </button>
              <button
                class="launch-btn launch-btn--sm launch-btn--ghost"
                @click="confirmAbort = false"
              >
                {{ t('general.cancel') }}
              </button>
            </template>
          </div>
        </div>

        <!-- Command -->
        <div v-if="activeJob?.command" class="launch-command">
          <code>{{ activeJob.command }}</code>
        </div>

        <!-- Log viewer -->
        <div ref="logContainer" class="launch-console-log">
          <pre v-if="logLines.length" class="launch-console-log-text">{{ logText }}</pre>
          <div v-else-if="isRunning" class="launch-console-waiting">
            <div class="launch-console-spinner" />
            <span>Waiting for output...</span>
          </div>
        </div>

        <!-- Error block -->
        <div v-if="activeJob?.error && activeJob.status === JobStatus.failed" class="launch-error">
          <i-mdi-alert-circle class="launch-error-icon" />
          <pre class="launch-error-text">{{ activeJob.error }}</pre>
        </div>

        <!-- Job history -->
        <div v-if="jobStore.jobHistory.length" class="launch-section launch-history">
          <h4 class="launch-section-title">{{ t('strategyDev.jobHistory') }}</h4>
          <div v-for="job in jobStore.jobHistory" :key="job.job_id" class="launch-history-item">
            <span
              class="launch-status-dot"
              :style="{
                backgroundColor:
                  job.status === JobStatus.completed
                    ? 'var(--sd-success)'
                    : job.status === JobStatus.failed
                      ? 'var(--sd-danger)'
                      : 'var(--sd-warning)',
              }"
            />
            <span class="launch-history-type">{{ job.job_type }}</span>
            <span class="launch-history-strategy">{{ job.strategy }}</span>
            <span class="launch-history-status">{{ job.status }}</span>
          </div>
        </div>
      </template>
    </div>

    <!-- ═══════════════════ CONFIG TAB ═══════════════════ -->
    <div v-if="activeTab === 'config'" class="launch-config-tab">
      <!-- Configs loading error -->
      <div v-if="jobStore.configsError" class="launch-error">
        <i-mdi-alert-circle class="launch-error-icon" />
        <span>{{ jobStore.configsError }}</span>
      </div>

      <!-- Form -->
      <div class="launch-form">
        <!-- Job type selector -->
        <div class="launch-section">
          <h4 class="launch-section-title">{{ t('strategyDev.jobTypeLabel') }}</h4>
          <div class="launch-radio-group">
            <label
              v-for="opt in jobTypeOptions"
              :key="opt.value"
              class="launch-radio"
              :class="{ 'launch-radio--active': jobType === opt.value }"
            >
              <input v-model="jobType" type="radio" :value="opt.value" class="launch-radio-input" />
              {{ opt.label }}
            </label>
          </div>
        </div>

        <!-- ═══ BASE CONFIGURATION ═══ -->
        <div class="launch-section">
          <h4 class="launch-section-title">{{ t('strategyDev.jobBaseConfig') }}</h4>
          <table class="launch-table">
            <tbody>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobConfig') }}</td>
                <td class="launch-td-input">
                  <div class="launch-input-with-edit">
                    <select v-model="configFile" class="launch-select">
                      <option value="" disabled>{{ t('strategyDev.jobSelectConfig') }}</option>
                      <optgroup
                        v-for="group in configGroups"
                        :key="group.label"
                        :label="group.label"
                      >
                        <option v-for="c in group.configs" :key="c" :value="c">
                          {{ c.includes('/') ? c.split('/').pop() : c }}
                        </option>
                      </optgroup>
                    </select>
                    <button
                      v-if="configFile"
                      class="launch-edit-btn"
                      :title="t('strategyDev.editorEditConfig')"
                      @click="editConfig"
                    >
                      <i-mdi-pencil-outline class="launch-edit-icon" />
                    </button>
                  </div>
                </td>
                <td class="launch-td-desc">
                  <span v-if="isCustomConfig" class="launch-custom-badge">{{
                    customConfigLabel
                  }}</span>
                  <span v-else-if="configInfo" class="launch-config-info">{{ configInfo }}</span>
                </td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobStrategy') }}</td>
                <td class="launch-td-input">
                  <div class="launch-input-with-edit">
                    <select v-model="strategy" class="launch-select">
                      <option value="" disabled>{{ t('strategyDev.jobSelectStrategy') }}</option>
                      <option v-for="s in jobStore.availableStrategies" :key="s" :value="s">
                        {{ s }}
                      </option>
                    </select>
                    <button
                      v-if="strategy"
                      class="launch-edit-btn"
                      :title="t('strategyDev.editorEditStrategy')"
                      @click="editStrategy"
                    >
                      <i-mdi-pencil-outline class="launch-edit-icon" />
                    </button>
                  </div>
                </td>
                <td class="launch-td-desc" />
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobDateFrom') }}</td>
                <td class="launch-td-input">
                  <VueDatePicker
                    v-model="dateFrom"
                    :dark="settingsStore.isDarkTheme"
                    :max-date="now"
                    model-type="yyyy-MM-dd"
                    :format="'yyyy-MM-dd'"
                    text-input
                    auto-apply
                    :enable-time-picker="false"
                    class="launch-datepicker"
                  />
                </td>
                <td class="launch-td-desc" />
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobDateTo') }}</td>
                <td class="launch-td-input">
                  <VueDatePicker
                    v-model="dateTo"
                    :dark="settingsStore.isDarkTheme"
                    :max-date="now"
                    model-type="yyyy-MM-dd"
                    :format="'yyyy-MM-dd'"
                    text-input
                    auto-apply
                    :enable-time-picker="false"
                    class="launch-datepicker"
                  />
                </td>
                <td class="launch-td-desc">
                  <span v-if="timerange" class="launch-hint">→ {{ timerange }}</span>
                </td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobTimeframe') }}</td>
                <td class="launch-td-input">
                  <TimeframeSelect :value="timeframe" size="small" @input="timeframe = $event" />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobTimeframeDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobMaxOpenTrades') }}</td>
                <td class="launch-td-input">
                  <input
                    v-model.number="maxOpenTrades"
                    type="number"
                    class="launch-input"
                    min="1"
                  />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobMaxOpenTradesDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobStakeAmount') }}</td>
                <td class="launch-td-input">
                  <input
                    v-model="stakeAmount"
                    type="text"
                    class="launch-input"
                    placeholder="unlimited"
                  />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobStakeAmountDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobDryRunWallet') }}</td>
                <td class="launch-td-input">
                  <input
                    v-model.number="dryRunWallet"
                    type="number"
                    class="launch-input"
                    min="0"
                    step="100"
                  />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobDryRunWalletDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobEnableProtections') }}</td>
                <td class="launch-td-input">
                  <label class="launch-toggle">
                    <input v-model="enableProtections" type="checkbox" />
                    <span class="launch-toggle-slider" />
                  </label>
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobEnableProtectionsDesc') }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- ═══ BACKTEST-ONLY PARAMS ═══ -->
        <div v-if="isBacktest" class="launch-section">
          <h4 class="launch-section-title">{{ t('strategyDev.jobBacktestParams') }}</h4>
          <table class="launch-table">
            <tbody>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobExportType') }}</td>
                <td class="launch-td-input">
                  <select v-model="exportType" class="launch-select">
                    <option v-for="o in exportTypeOptions" :key="o.value" :value="o.value">
                      {{ o.label }}
                    </option>
                  </select>
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobExportTypeDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobBreakdown') }}</td>
                <td class="launch-td-input">
                  <select v-model="breakdown" multiple class="launch-select launch-select--multi">
                    <option v-for="o in breakdownOptions" :key="o.value" :value="o.value">
                      {{ o.label }}
                    </option>
                  </select>
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobBreakdownDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobCache') }}</td>
                <td class="launch-td-input">
                  <select v-model="cache" class="launch-select">
                    <option v-for="o in cacheOptions" :key="o.value" :value="o.value">
                      {{ o.label }}
                    </option>
                  </select>
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobCacheDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobDynamicPairlist') }}</td>
                <td class="launch-td-input">
                  <label class="launch-toggle">
                    <input v-model="enableDynamicPairlist" type="checkbox" />
                    <span class="launch-toggle-slider" />
                  </label>
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobDynamicPairlistDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobNotes') }}</td>
                <td class="launch-td-input">
                  <input v-model="notes" type="text" class="launch-input" />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobNotesDesc') }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- ═══ HYPEROPT PARAMS ═══ -->
        <div v-if="isHyperoptOrWfa" class="launch-section">
          <h4 class="launch-section-title">{{ t('strategyDev.jobHyperoptParams') }}</h4>
          <table class="launch-table">
            <tbody>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobEpochs') }} *</td>
                <td class="launch-td-input">
                  <input
                    v-model.number="epochs"
                    type="number"
                    class="launch-input"
                    min="10"
                    max="10000"
                  />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobEpochsDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobLoss') }}</td>
                <td class="launch-td-input">
                  <select v-model="hyperoptLoss" class="launch-select">
                    <option v-for="l in lossOptions" :key="l" :value="l">{{ l }}</option>
                  </select>
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobLossDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobSampler') }}</td>
                <td class="launch-td-input">
                  <select v-model="sampler" class="launch-select">
                    <option v-for="s in samplerOptions" :key="s.value" :value="s.value">
                      {{ s.label }}
                    </option>
                  </select>
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobSamplerDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobSpaces') }}</td>
                <td class="launch-td-input">
                  <select v-model="spaces" multiple class="launch-select launch-select--multi">
                    <option v-for="s in spaceOptions" :key="s.value" :value="s.value">
                      {{ s.label }}
                    </option>
                  </select>
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobSpacesDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobEarlyStop') }}</td>
                <td class="launch-td-input">
                  <input
                    v-model.number="earlyStop"
                    type="number"
                    class="launch-input"
                    min="0"
                    placeholder="0"
                  />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobEarlyStopDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobMinTrades') }}</td>
                <td class="launch-td-input">
                  <input
                    v-model.number="minTrades"
                    type="number"
                    class="launch-input"
                    min="1"
                    placeholder="30"
                  />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobMinTradesDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobWorkers') }}</td>
                <td class="launch-td-input">
                  <input v-model.number="jobWorkers" type="number" class="launch-input" min="-2" />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobWorkersDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobRandomState') }}</td>
                <td class="launch-td-input">
                  <input
                    v-model.number="randomState"
                    type="number"
                    class="launch-input"
                    min="0"
                    placeholder="auto"
                  />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobRandomStateDesc') }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- ═══ HYPEROPT-ONLY FLAGS ═══ -->
        <div v-if="isHyperopt" class="launch-section">
          <h4 class="launch-section-title">Options Hyperopt</h4>
          <table class="launch-table">
            <tbody>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobPrintAll') }}</td>
                <td class="launch-td-input">
                  <label class="launch-toggle">
                    <input v-model="printAll" type="checkbox" />
                    <span class="launch-toggle-slider" />
                  </label>
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobPrintAllDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobDisableParamExport') }}</td>
                <td class="launch-td-input">
                  <label class="launch-toggle">
                    <input v-model="disableParamExport" type="checkbox" />
                    <span class="launch-toggle-slider" />
                  </label>
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobDisableParamExportDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobIgnoreMissingSpaces') }}</td>
                <td class="launch-td-input">
                  <label class="launch-toggle">
                    <input v-model="ignoreMissingSpaces" type="checkbox" />
                    <span class="launch-toggle-slider" />
                  </label>
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobIgnoreMissingSpacesDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobAnalyzePerEpoch') }}</td>
                <td class="launch-td-input">
                  <label class="launch-toggle">
                    <input v-model="analyzePerEpoch" type="checkbox" />
                    <span class="launch-toggle-slider" />
                  </label>
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobAnalyzePerEpochDesc') }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- ═══ WFA PARAMS ═══ -->
        <div v-if="isWfa" class="launch-section">
          <h4 class="launch-section-title">{{ t('strategyDev.jobWfaParams') }}</h4>
          <table class="launch-table">
            <tbody>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobWfWindows') }}</td>
                <td class="launch-td-input">
                  <input
                    v-model.number="wfWindows"
                    type="number"
                    class="launch-input"
                    min="2"
                    max="20"
                  />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobWfWindowsDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobWfTrainRatio') }}</td>
                <td class="launch-td-input">
                  <input
                    v-model.number="wfTrainRatio"
                    type="number"
                    class="launch-input"
                    min="0.5"
                    max="0.95"
                    step="0.05"
                  />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobWfTrainRatioDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobWfEmbargo') }}</td>
                <td class="launch-td-input">
                  <input
                    v-model.number="wfEmbargoDays"
                    type="number"
                    class="launch-input"
                    min="0"
                    max="30"
                  />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobWfEmbargoDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobWfHoldout') }}</td>
                <td class="launch-td-input">
                  <input
                    v-model.number="wfHoldoutMonths"
                    type="number"
                    class="launch-input"
                    min="0"
                    max="12"
                  />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobWfHoldoutDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobWfMinTrades') }}</td>
                <td class="launch-td-input">
                  <input
                    v-model.number="wfMinTestTrades"
                    type="number"
                    class="launch-input"
                    min="1"
                  />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobWfMinTradesDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobWfMode') }}</td>
                <td class="launch-td-input">
                  <select v-model="wfMode" class="launch-select">
                    <option v-for="m in wfModeOptions" :key="m.value" :value="m.value">
                      {{ m.label }}
                    </option>
                  </select>
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobWfModeDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobWfMultiSeed') }}</td>
                <td class="launch-td-input">
                  <input
                    v-model.number="wfMultiSeed"
                    type="number"
                    class="launch-input"
                    min="0"
                    placeholder="0"
                  />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobWfMultiSeedDesc') }}</td>
              </tr>
              <tr v-if="isCpcv">
                <td class="launch-td-label">{{ t('strategyDev.jobWfCpcvGroups') }}</td>
                <td class="launch-td-input">
                  <input
                    v-model.number="wfCpcvGroups"
                    type="number"
                    class="launch-input"
                    min="3"
                    max="20"
                  />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobWfCpcvGroupsDesc') }}</td>
              </tr>
              <tr v-if="isCpcv">
                <td class="launch-td-label">{{ t('strategyDev.jobWfCpcvTestGroups') }}</td>
                <td class="launch-td-input">
                  <input
                    v-model.number="wfCpcvTestGroups"
                    type="number"
                    class="launch-input"
                    min="1"
                    max="10"
                  />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobWfCpcvTestGroupsDesc') }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- ═══ ADVANCED (COLLAPSIBLE) ═══ -->
        <div class="launch-section">
          <button class="launch-toggle-advanced" @click="showAdvanced = !showAdvanced">
            <i-mdi-chevron-right v-if="!showAdvanced" class="launch-chevron" />
            <i-mdi-chevron-down v-else class="launch-chevron" />
            {{ t('strategyDev.jobAdvancedParams') }}
          </button>
          <table v-if="showAdvanced" class="launch-table">
            <tbody>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobDataFormat') }}</td>
                <td class="launch-td-input">
                  <select v-model="dataFormatOhlcv" class="launch-select">
                    <option v-for="o in dataFormatOptions" :key="o.value" :value="o.value">
                      {{ o.label }}
                    </option>
                  </select>
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobDataFormatDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobFee') }}</td>
                <td class="launch-td-input">
                  <input
                    v-model.number="fee"
                    type="number"
                    class="launch-input"
                    min="0"
                    step="0.0001"
                    placeholder="auto"
                  />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobFeeDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobPairs') }}</td>
                <td class="launch-td-input">
                  <input
                    v-model="pairsText"
                    type="text"
                    class="launch-input"
                    placeholder="BTC/USDT, ETH/USDT"
                  />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobPairsDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobPositionStacking') }}</td>
                <td class="launch-td-input">
                  <label class="launch-toggle">
                    <input v-model="enablePositionStacking" type="checkbox" />
                    <span class="launch-toggle-slider" />
                  </label>
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobPositionStackingDesc') }}</td>
              </tr>
              <tr>
                <td class="launch-td-label">{{ t('strategyDev.jobTimeframeDetail') }}</td>
                <td class="launch-td-input">
                  <TimeframeSelect
                    :value="timeframeDetail"
                    size="small"
                    @input="timeframeDetail = $event"
                  />
                </td>
                <td class="launch-td-desc">{{ t('strategyDev.jobTimeframeDetailDesc') }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Start button -->
        <div class="launch-actions">
          <button class="launch-btn launch-btn--primary" :disabled="!canStart" @click="handleStart">
            <i-mdi-play v-if="!jobStore.loading" class="launch-btn-icon" />
            <i-mdi-loading v-else class="launch-btn-icon launch-btn-icon--spin" />
            {{ t('strategyDev.jobStart') }}
            {{
              jobType === JobType.backtest
                ? 'Backtest'
                : jobType === JobType.hyperopt
                  ? 'Hyperopt'
                  : 'Walk-Forward'
            }}
          </button>
        </div>

        <!-- Error -->
        <div v-if="jobStore.error && !activeJob" class="launch-error">
          <i-mdi-alert-circle class="launch-error-icon" />
          <span>{{ jobStore.error }}</span>
        </div>
      </div>

      <!-- Running job mini-banner (on config tab) -->
      <div v-if="isRunning && activeJob" class="launch-running-hint" @click="activeTab = 'console'">
        <span
          class="launch-status-dot launch-status-dot--pulse"
          :style="{ backgroundColor: 'var(--sd-info)' }"
        />
        <span>{{ activeJob.job_type }} · {{ activeJob.strategy }}</span>
        <span v-if="jobStore.jobProgress" class="launch-running-progress">{{
          jobStore.jobProgress
        }}</span>
        <span class="launch-running-link">{{ t('strategyDev.jobTabConsole') }} →</span>
      </div>
    </div>
    <!-- end config tab -->
  </div>
</template>

<style scoped>
.launch-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ── Tabs ── */
.launch-tabs {
  display: flex;
  border-bottom: 1px solid var(--sd-border-subtle);
  padding: 0 16px;
  gap: 0;
}

.launch-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border: none;
  background: none;
  color: var(--sd-overlay);
  font-size: var(--sd-text-xs);
  font-weight: 600;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all var(--sd-transition-fast);
  position: relative;
}

.launch-tab:hover {
  color: var(--sd-text);
  background: var(--sd-surface0);
}

.launch-tab--active {
  color: var(--sd-info);
  border-bottom-color: var(--sd-info);
}

.launch-tab--live {
  color: var(--sd-success);
}

.launch-tab--live.launch-tab--active {
  border-bottom-color: var(--sd-success);
}

.launch-tab--error {
  color: var(--sd-danger);
}

.launch-tab-icon {
  width: 14px;
  height: 14px;
}

.launch-tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 8px;
  height: 8px;
  border-radius: 50%;
  font-size: 8px;
  font-weight: 700;
  line-height: 1;
}

.launch-tab-badge--live {
  background: var(--sd-success);
  animation: sd-pulse 1.5s ease infinite;
}

.launch-tab-badge--error {
  background: var(--sd-danger);
  color: white;
  min-width: 14px;
  height: 14px;
  border-radius: 7px;
  font-size: 9px;
}

/* ── Console tab ── */
.launch-console {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 0;
  min-height: 300px;
  align-items: stretch;
}

.launch-console-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 0;
  color: var(--sd-overlay);
}

.launch-console-empty-icon {
  width: 48px;
  height: 48px;
  opacity: 0.2;
}

.launch-console-empty p {
  font-size: var(--sd-text-xs);
  margin: 0;
}

.launch-console-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.launch-console-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.launch-console-status-text {
  font-size: var(--sd-text-sm);
  font-weight: 600;
  color: var(--sd-text);
}

.launch-console-meta {
  font-size: var(--sd-text-xs);
  color: var(--sd-overlay);
  font-family: var(--sd-font-mono);
}

.launch-console-duration {
  font-size: var(--sd-text-xs);
  color: var(--sd-subtext);
  font-family: var(--sd-font-mono);
  padding: 2px 6px;
  background: var(--sd-surface0);
  border-radius: var(--sd-radius-sm);
}

.launch-console-actions {
  display: flex;
  gap: 6px;
}

.launch-console-log {
  flex: 1;
  min-height: 200px;
  max-height: calc(100vh - 300px);
  overflow: auto;
  background: #1a1b26;
  border-radius: var(--sd-radius-sm);
  padding: 12px 16px;
  border: 1px solid var(--sd-border-subtle);
}

.launch-console-log-text {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #c0caf5;
  margin: 0;
  white-space: pre;
  overflow-x: auto;
  text-align: left;
}

.launch-console-waiting {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--sd-overlay);
  font-size: var(--sd-text-xs);
  padding: 12px 0;
}

.launch-console-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--sd-surface1);
  border-top-color: var(--sd-info);
  border-radius: 50%;
  animation: sd-spin 800ms linear infinite;
}

/* ── Edit button inline ── */
.launch-input-with-edit {
  display: flex;
  gap: 4px;
  align-items: center;
}

.launch-input-with-edit .launch-select {
  flex: 1;
  min-width: 0;
}

.launch-edit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--sd-border-subtle);
  border-radius: var(--sd-radius-sm);
  background: var(--sd-surface0);
  color: var(--sd-overlay);
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--sd-transition-fast);
}

.launch-edit-btn:hover {
  background: var(--sd-info-dim);
  color: var(--sd-info);
  border-color: rgba(137, 180, 250, 0.3);
}

.launch-edit-icon {
  width: 13px;
  height: 13px;
}

.launch-custom-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  background: var(--sd-info-dim);
  color: var(--sd-info);
  border-radius: var(--sd-radius-sm);
  font-size: 10px;
  font-weight: 600;
  font-family: var(--sd-font-mono);
}

/* ── Config tab ── */
.launch-config-tab {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

/* ── Running hint on config tab ── */
.launch-running-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(137, 180, 250, 0.06);
  border: 1px solid rgba(137, 180, 250, 0.15);
  border-radius: var(--sd-radius-sm);
  cursor: pointer;
  transition: background var(--sd-transition-fast);
  font-size: var(--sd-text-xs);
  color: var(--sd-subtext);
  font-family: var(--sd-font-mono);
}

.launch-running-hint:hover {
  background: rgba(137, 180, 250, 0.12);
}

.launch-running-progress {
  color: var(--sd-info);
  font-weight: 600;
}

.launch-running-link {
  margin-left: auto;
  color: var(--sd-info);
  font-weight: 600;
}

.launch-status-dot--pulse {
  animation: sd-pulse 1.5s ease infinite;
}

/* ── Shared: status dot ── */
.launch-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* ── Error ── */
.launch-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  background: rgba(243, 139, 168, 0.08);
  border-radius: var(--sd-radius-sm);
  color: var(--sd-danger);
  font-size: var(--sd-text-xs);
}

.launch-error-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  margin-top: 1px;
}

.launch-error-text {
  margin: 0;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace;
  font-size: 11px;
  white-space: pre;
  overflow-x: auto;
  text-align: left;
}

/* ── Command ── */
.launch-command {
  padding: 6px 8px;
  background: var(--sd-mantle);
  border-radius: var(--sd-radius-sm);
}

.launch-command code {
  font-size: 10px;
  color: var(--sd-overlay);
  font-family: var(--sd-font-mono);
  word-break: break-all;
}

/* ── Form ── */
.launch-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.launch-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.launch-section-title {
  font-size: var(--sd-text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--sd-overlay);
  margin: 0;
}

/* ── Table layout (one row per param) ── */
.launch-table {
  width: 100%;
  border-collapse: collapse;
}

.launch-table tr {
  border-bottom: 1px solid var(--sd-border-subtle);
}

.launch-table tr:last-child {
  border-bottom: none;
}

.launch-td-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--sd-subtext);
  white-space: nowrap;
  padding: 6px 8px 6px 0;
  width: 130px;
  vertical-align: middle;
}

.launch-td-input {
  padding: 4px 8px;
  width: 200px;
  vertical-align: middle;
}

.launch-td-desc {
  font-size: 10px;
  color: var(--sd-overlay);
  padding: 6px 0 6px 8px;
  vertical-align: middle;
  line-height: 1.4;
}

/* ── Inputs ── */
.launch-input,
.launch-select {
  width: 100%;
  padding: 5px 7px;
  border: 1px solid var(--sd-border-subtle);
  border-radius: var(--sd-radius-sm);
  background: var(--sd-mantle);
  color: var(--sd-text);
  font-size: 11px;
  font-family: var(--sd-font-mono);
  outline: none;
  transition: border-color var(--sd-transition-fast);
}

.launch-input:focus,
.launch-select:focus {
  border-color: var(--sd-info);
}

.launch-select--multi {
  min-height: 54px;
}

.launch-hint {
  font-size: 10px;
  color: var(--sd-overlay);
  font-family: var(--sd-font-mono);
}

.launch-config-info {
  font-size: 10px;
  color: var(--sd-info);
  font-family: var(--sd-font-mono);
  font-weight: 500;
}

.launch-datepicker {
  width: 100%;
}

.launch-datepicker :deep(.dp__input) {
  font-size: 11px;
  font-family: var(--sd-font-mono);
  padding: 5px 7px 5px 8px;
  background: var(--sd-mantle);
  border-color: var(--sd-border-subtle);
  color: var(--sd-text);
  border-radius: var(--sd-radius-sm);
}

.launch-datepicker :deep(.dp__input_icon) {
  display: none;
}

.launch-datepicker :deep(.dp__clear_icon) {
  display: inline-flex;
}

/* ── Toggle switch ── */
.launch-toggle {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
}

.launch-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.launch-toggle-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: var(--sd-surface0);
  border-radius: 9px;
  transition: background var(--sd-transition-fast);
}

.launch-toggle-slider::before {
  content: '';
  position: absolute;
  height: 14px;
  width: 14px;
  left: 2px;
  bottom: 2px;
  background: var(--sd-text);
  border-radius: 50%;
  transition: transform var(--sd-transition-fast);
}

.launch-toggle input:checked + .launch-toggle-slider {
  background: var(--sd-info);
}

.launch-toggle input:checked + .launch-toggle-slider::before {
  transform: translateX(14px);
}

/* ── Radio group ── */
.launch-radio-group {
  display: flex;
  gap: 4px;
}

.launch-radio {
  padding: 6px 12px;
  border: 1px solid var(--sd-border-subtle);
  border-radius: var(--sd-radius-sm);
  cursor: pointer;
  font-size: var(--sd-text-xs);
  font-weight: 500;
  color: var(--sd-subtext);
  transition: all var(--sd-transition-fast);
  user-select: none;
}

.launch-radio:hover {
  background: var(--sd-surface0);
}

.launch-radio--active {
  background: var(--sd-info-dim);
  border-color: rgba(137, 180, 250, 0.3);
  color: var(--sd-info);
}

.launch-radio-input {
  display: none;
}

/* ── Advanced toggle ── */
.launch-toggle-advanced {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--sd-text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--sd-overlay);
  padding: 0;
}

.launch-toggle-advanced:hover {
  color: var(--sd-text);
}

.launch-chevron {
  width: 14px;
  height: 14px;
}

/* ── Buttons ── */
.launch-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: var(--sd-radius-sm);
  font-size: var(--sd-text-xs);
  font-weight: 600;
  cursor: pointer;
  transition: all var(--sd-transition-fast);
  color: inherit;
  background: transparent;
}

.launch-btn--primary {
  background: var(--sd-info);
  color: var(--sd-crust);
  padding: 8px 20px;
  font-size: var(--sd-text-sm);
}

.launch-btn--primary:hover:not(:disabled) {
  filter: brightness(1.1);
}

.launch-btn--primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.launch-btn--danger {
  background: rgba(243, 139, 168, 0.15);
  color: var(--sd-danger);
  border-color: rgba(243, 139, 168, 0.2);
}

.launch-btn--danger:hover {
  background: rgba(243, 139, 168, 0.25);
}

.launch-btn--ghost {
  color: var(--sd-subtext);
}

.launch-btn--ghost:hover {
  background: var(--sd-surface0);
}

.launch-btn--sm {
  padding: 3px 8px;
  font-size: 10px;
}

.launch-btn-icon {
  width: 16px;
  height: 16px;
}

.launch-btn-icon--spin {
  animation: sd-spin 800ms linear infinite;
}

/* ── Actions ── */
.launch-actions {
  display: flex;
  gap: 8px;
  padding-top: 4px;
}

/* ── History ── */
.launch-history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: var(--sd-text-xs);
}

.launch-history-type {
  font-weight: 600;
  color: var(--sd-subtext);
  min-width: 70px;
}

.launch-history-strategy {
  color: var(--sd-text);
  font-family: var(--sd-font-mono);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.launch-history-status {
  color: var(--sd-overlay);
  font-size: 10px;
}

@keyframes sd-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes sd-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
</style>
