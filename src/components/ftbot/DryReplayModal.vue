<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const store = useReplayStore();
const { t } = useI18n();

function fmtPct(v: number | null | undefined): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
}
function fmtDuration(s: number | null | undefined): string {
  if (s == null) return '—';
  const sec = Math.max(0, Math.round(s));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const r = sec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${r}s`;
  return `${r}s`;
}

const pnlClass = computed(() =>
  (store.current.result?.total_profit_abs ?? 0) >= 0 ? 'text-green-500' : 'text-red-500',
);
const seededTimerange = computed(() => (store.seedInfo?.timerange as string) ?? '');
const resolutions = [
  { value: 60, label: '1m' },
  { value: 300, label: '5m' },
  { value: 900, label: '15m' },
];

const today = new Date().toISOString().slice(0, 10);
const coverageEarliestDay = computed(() => store.coverage?.earliest?.slice(0, 10) ?? null);
// No pair has data at the chosen resolution before start_date → replay can't be faithful that early.
const startBeforeData = computed(
  () => !!coverageEarliestDay.value && !!store.startDate && store.startDate < coverageEarliestDay.value,
);
const endInFuture = computed(() => !!store.endDate && store.endDate > today);

async function confirmRestore() {
  if (window.confirm(t('botComparison.replay.restoreConfirm'))) {
    await store.restore();
  }
}

function selectResolution(value: number) {
  if (store.currentActive) return;
  store.subStep = value;
  store.fetchCoverage();
}

// ── enriched detail view (from the seed marker) ──
const botStore = useBotStore();
const RES_LABEL: Record<number, string> = { 60: '1m', 300: '5m', 900: '15m' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const seed = computed<Record<string, any> | null>(() => store.seedInfo as any);
const seedResolution = computed(() =>
  seed.value?.resolution_s
    ? (RES_LABEL[seed.value.resolution_s] ?? `${seed.value.resolution_s}s`)
    : '—',
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const seedResult = computed<any>(() => seed.value?.result ?? null);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const botProfit = computed<any>(() => (botStore.botStores[store.botId] as any)?.profit ?? null);
const replayClosed = computed<number | null>(() => seedResult.value?.closed_trades ?? null);
// "Prioritize" sets a value above every current job → jumps to the front of the queue.
const topPriority = computed(() => {
  const q = store.queue;
  if (!q) return 1;
  const all = [...q.running, ...q.paused, ...q.queued];
  return Math.max(0, ...all.map((r) => r.priority ?? 0)) + 1;
});
const stateLabel = computed(
  () =>
    ({
      running: t('botComparison.replay.runningTitle'),
      queued: t('botComparison.replay.stateQueued'),
      paused: t('botComparison.replay.statePaused'),
    })[store.current.status] ?? store.current.step,
);
const tradesOutsideReplay = computed<number | null>(() => {
  const total = botProfit.value?.closed_trade_count ?? botProfit.value?.trade_count;
  return total != null && replayClosed.value != null
    ? Math.max(0, total - replayClosed.value)
    : null;
});
</script>

<template>
  <Dialog
    v-model:visible="store.visible"
    modal
    :header="t('botComparison.replay.title', { bot: store.botName })"
    :style="{ width: '34rem', maxWidth: '95vw' }"
    :dismissable-mask="!store.currentActive"
  >
    <p class="text-sm text-surface-600 dark:text-surface-300 mb-3">
      {{ t('botComparison.replay.intro') }}
    </p>

    <!-- Already seeded → enriched detail view -->
    <div
      v-if="store.alreadySeeded && !store.currentActive"
      class="rounded border border-amber-400/50 bg-amber-400/10 p-3 text-sm flex flex-col gap-2"
    >
      <div class="flex items-center gap-2 font-semibold">
        <i-mdi-fast-forward class="text-amber-500" /> {{ t('botComparison.replay.alreadyTitle') }}
      </div>
      <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        <span class="text-surface-500">{{ t('botComparison.replay.detailPeriod') }}</span>
        <span class="font-mono">{{ seededTimerange }}</span>
        <span class="text-surface-500">{{ t('botComparison.replay.resolution') }}</span>
        <span>{{ seedResolution }}</span>
        <span class="text-surface-500">{{ t('botComparison.replay.detailDuration') }}</span>
        <span>{{ fmtDuration(seed?.duration_s) }}</span>
        <span class="text-surface-500">{{ t('botComparison.replay.detailPairs') }}</span>
        <span>{{ seed?.pairs?.length ?? '—' }}</span>
      </div>
      <!-- Replay's own result -->
      <div v-if="seedResult" class="rounded bg-surface-100/60 dark:bg-surface-800/60 p-2 text-xs">
        <div class="font-semibold mb-0.5">{{ t('botComparison.replay.detailReplayResult') }}</div>
        <div>{{ t('botComparison.replay.closed') }}: {{ seedResult.closed_trades }}</div>
        <div>{{ t('botComparison.replay.winRate') }}: {{ fmtPct(seedResult.win_rate) }}</div>
        <div :class="(seedResult.total_profit_abs ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'">
          {{ t('botComparison.replay.pnl') }}: {{ (seedResult.total_profit_abs ?? 0).toFixed(2) }}
          ({{ fmtPct(seedResult.total_profit_ratio) }})
        </div>
      </div>
      <!-- Current combined (replay + live-dry since) -->
      <div v-if="botProfit" class="rounded bg-surface-100/60 dark:bg-surface-800/60 p-2 text-xs">
        <div class="font-semibold mb-0.5">{{ t('botComparison.replay.detailCurrent') }}</div>
        <div>
          {{ t('botComparison.replay.closed') }}:
          {{ botProfit.closed_trade_count ?? botProfit.trade_count ?? '—' }}
        </div>
        <div v-if="tradesOutsideReplay !== null">
          {{ t('botComparison.replay.detailOutside') }}: {{ tradesOutsideReplay }}
        </div>
      </div>
    </div>

    <template v-else>
      <!-- Auto-derived context -->
      <div class="rounded bg-surface-100 dark:bg-surface-800 p-3 text-sm mb-3 flex flex-col gap-1">
        <div>
          <span class="text-surface-500">{{ t('botComparison.replay.strategy') }}:</span>
          <span class="font-mono">{{ store.strategy || '—' }}</span>
        </div>
        <div>
          <span class="text-surface-500">{{ t('botComparison.replay.wallet') }}:</span>
          {{ store.wallet ?? '…' }}
        </div>
        <div>
          <span class="text-surface-500"
            >{{ t('botComparison.replay.pairs') }} ({{ store.pairs.length }}):</span
          >
        </div>
        <div v-if="store.loadingContext" class="text-surface-500 italic">
          {{ t('botComparison.replay.loading') }}
        </div>
        <div v-else class="flex flex-wrap gap-1 max-h-24 overflow-auto">
          <span
            v-for="p in store.pairs"
            :key="p"
            class="px-1.5 py-0.5 rounded bg-surface-200 dark:bg-surface-700 text-xs font-mono"
            >{{ p }}</span
          >
        </div>
      </div>

      <p
        v-if="store.pairs.length === 0 && !store.loadingContext"
        class="text-xs text-red-500 mb-3"
      >
        ⚠️ {{ t('botComparison.replay.noPairs') }}
      </p>
      <template v-else>
        <p class="text-xs text-amber-600 dark:text-amber-400 mb-1">
          ⚠️ {{ t('botComparison.replay.pairsWarning', { n: store.pairs.length }) }}
        </p>
        <p
          v-if="store.pairsSource === 'trades' || store.pairsSource === 'logs'"
          class="text-xs text-surface-500 mb-3"
        >
          ℹ️ {{ t(`botComparison.replay.pairsSource_${store.pairsSource}`) }}
        </p>
      </template>

      <!-- Period -->
      <div class="flex gap-3 mb-1">
        <label class="flex flex-col gap-1 flex-1 text-sm">
          <span class="font-semibold">{{ t('botComparison.replay.startDate') }}</span>
          <input
            v-model="store.startDate"
            type="date"
            :disabled="store.currentActive"
            class="border border-surface-300 dark:border-surface-600 rounded px-2 py-1 bg-transparent"
          />
        </label>
        <label class="flex flex-col gap-1 flex-1 text-sm">
          <span class="font-semibold">{{ t('botComparison.replay.endDate') }}</span>
          <div class="flex gap-1">
            <input
              v-model="store.endDate"
              type="date"
              :disabled="store.currentActive"
              class="border border-surface-300 dark:border-surface-600 rounded px-2 py-1 bg-transparent w-full"
            />
            <Button
              size="small"
              severity="secondary"
              variant="outlined"
              :disabled="store.currentActive"
              :label="t('botComparison.replay.today')"
              @click="store.setEndToday"
            />
          </div>
        </label>
      </div>
      <p v-if="startBeforeData" class="text-xs text-amber-600 dark:text-amber-400 mb-1">
        ⚠️ {{ t('botComparison.replay.startBeforeData', { date: coverageEarliestDay }) }}
      </p>
      <p v-if="endInFuture" class="text-xs text-surface-500 mb-1">
        ℹ️ {{ t('botComparison.replay.endFuture') }}
      </p>

      <!-- Resolution (segmented buttons — reliable inside the dialog) -->
      <div class="flex flex-col gap-1 text-sm mb-1">
        <span class="font-semibold">{{ t('botComparison.replay.resolution') }}</span>
        <div class="inline-flex w-fit rounded overflow-hidden border border-surface-300 dark:border-surface-600">
          <button
            v-for="r in resolutions"
            :key="r.value"
            type="button"
            :disabled="store.currentActive"
            class="px-3 py-1 text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            :class="
              store.subStep === r.value
                ? 'bg-primary-500 text-white'
                : 'bg-transparent hover:bg-surface-200 dark:hover:bg-surface-700'
            "
            @click="selectResolution(r.value)"
          >
            {{ r.label }}
          </button>
        </div>
      </div>
      <p class="text-xs text-surface-500 mb-1">{{ t('botComparison.replay.resolutionHint') }}</p>
      <!-- Local data coverage at the chosen resolution.
           Only relevant once the user has committed both dates — otherwise the warning
           triggers prematurely (just opening the modal would flag "no 1m data" before the
           user has even chosen a period). -->
      <template v-if="store.startDate && store.endDate">
        <div
          v-if="store.coverageLoading"
          class="flex items-center gap-2 text-xs text-surface-500 mb-3"
        >
          <i-mdi-loading class="animate-spin" /> {{ t('botComparison.replay.coverageLoading') }}
        </div>
        <p
          v-else-if="store.coverage && !store.coverage.earliest"
          class="text-xs text-red-500 mb-3"
        >
          ⚠️ {{ t('botComparison.replay.coverageNone', { tf: store.subStepTf }) }}
        </p>
        <p
          v-else-if="coverageEarliestDay"
          class="text-xs text-amber-600 dark:text-amber-400 mb-3"
        >
          ⚠️
          {{
            t('botComparison.replay.coverageEarliest', {
              tf: store.subStepTf,
              date: coverageEarliestDay,
              n: store.coverage?.pairs_with_data,
              total: store.coverage?.pairs_total,
            })
          }}
        </p>
        <div v-else class="mb-3"></div>
      </template>

      <!-- Reset DB option -->
      <label class="flex items-start gap-2 text-xs mb-3 cursor-pointer">
        <input v-model="store.resetDb" type="checkbox" :disabled="store.currentActive" class="mt-0.5" />
        <span>
          <span class="font-semibold">{{ t('botComparison.replay.resetDb') }}</span>
          <span class="block text-surface-500">{{ t('botComparison.replay.resetDbHint') }}</span>
        </span>
      </label>

      <ul class="text-xs text-surface-500 flex flex-col gap-1 mb-3">
        <li>🔒 {{ t('botComparison.replay.preventDry') }}</li>
        <li>⏱️ {{ t('botComparison.replay.preventIsolated') }}</li>
      </ul>

      <!-- Progress / queue state -->
      <div v-if="store.currentActive" class="flex flex-col gap-1 mb-3">
        <div class="text-sm font-semibold flex items-center gap-2">
          <i-mdi-fast-forward v-if="store.current.status === 'running'" class="animate-pulse text-amber-500" />
          <i-mdi-pause-circle-outline v-else-if="store.current.status === 'paused'" class="text-amber-500" />
          <i-mdi-tray-full v-else class="text-surface-400" />
          {{ stateLabel }}
        </div>
        <div class="h-2 w-full rounded bg-surface-200 dark:bg-surface-700 overflow-hidden">
          <div
            class="h-full bg-primary-500 transition-all duration-300"
            :style="{ width: `${Math.round(store.current.progress * 100)}%` }"
          />
        </div>
        <small class="text-surface-500">
          {{ Math.round(store.current.progress * 100) }}% — {{ store.current.step }}
        </small>
        <small v-if="store.current.status === 'running'" class="text-surface-500">
          {{ t('botComparison.replay.elapsed') }}: {{ fmtDuration(store.current.elapsedS) }} ·
          {{ t('botComparison.replay.eta') }}: {{ fmtDuration(store.current.etaS) }}
        </small>

        <!-- Queue panel: active replays machine-wide + prioritize -->
        <div
          v-if="store.current.status !== 'running' && store.queue"
          class="mt-1 rounded border border-surface-200 dark:border-surface-700 p-2 text-xs flex flex-col gap-1"
        >
          <div class="font-semibold">
            {{ t('botComparison.replay.queueTitle', {
              cap: store.queue.capacity, cores: store.queue.cores, hopt: store.queue.hyperopt_cores }) }}
          </div>
          <div
            v-for="r in [...store.queue.running, ...store.queue.paused, ...store.queue.queued]"
            :key="r.bot_id"
            class="flex items-center justify-between gap-2"
          >
            <span class="font-mono truncate">
              {{ { running: '⏩', paused: '⏸', queued: '🕒' }[r.state] }} {{ r.bot_id }}
              · {{ Math.round((r.progress ?? 0) * 100) }}%
            </span>
            <Button
              size="small"
              severity="secondary"
              variant="outlined"
              :label="t('botComparison.replay.prioritize')"
              @click="store.reprioritize(r.bot_id, topPriority)"
            />
          </div>
        </div>
        <div
          class="mt-1 rounded border border-blue-400/40 bg-blue-400/10 p-2 text-xs text-blue-600 dark:text-blue-300"
        >
          ℹ️ {{ t('botComparison.replay.closeContinues') }}
        </div>
      </div>

      <!-- Result -->
      <div
        v-if="store.current.result"
        class="rounded border border-surface-200 dark:border-surface-700 p-3 text-sm flex flex-col gap-1 mb-2"
      >
        <div class="font-semibold mb-1">{{ t('botComparison.replay.resultTitle') }}</div>
        <div>{{ t('botComparison.replay.closed') }}: {{ store.current.result.closed_trades }}</div>
        <div>{{ t('botComparison.replay.winRate') }}: {{ fmtPct(store.current.result.win_rate) }}</div>
        <div :class="pnlClass" class="font-semibold">
          {{ t('botComparison.replay.pnl') }}: {{ store.current.result.total_profit_abs.toFixed(2) }}
          ({{ fmtPct(store.current.result.total_profit_ratio) }})
        </div>
        <div class="text-green-500 text-xs mt-1">✓ {{ t('botComparison.replay.doneReload') }}</div>
      </div>

      <p v-if="store.current.error" class="text-red-500 text-sm whitespace-pre-line mb-2">
        {{ store.current.error }}
      </p>
    </template>

    <template #footer>
      <Button
        severity="secondary"
        size="small"
        :label="t('botComparison.replay.close')"
        @click="store.close"
      />
      <Button
        v-if="store.backupAvailable && !store.currentActive"
        severity="warn"
        size="small"
        outlined
        :title="t('botComparison.replay.restoreHint')"
        :label="t('botComparison.replay.restore')"
        @click="confirmRestore"
      />
      <Button
        v-if="store.currentActive"
        severity="danger"
        size="small"
        :label="t('botComparison.replay.stop')"
        @click="store.stop()"
      />
      <Button
        v-else-if="!store.alreadySeeded && !store.current.result"
        severity="primary"
        size="small"
        :disabled="!store.canRun"
        :label="t('botComparison.replay.run')"
        @click="store.start"
      />
    </template>
  </Dialog>
</template>
