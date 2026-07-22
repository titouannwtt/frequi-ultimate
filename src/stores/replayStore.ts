import type {
  ReplayCoverage,
  ReplayRequest,
  ReplaySeededInfo,
  ReplayStatus,
  ReplaySummary,
} from '@/types/replay';

const SUB_STEP_TF: Record<number, string> = { 60: '1m', 300: '5m', 900: '15m' };

interface BotReplayState {
  status: ReplayStatus['status'];
  running: boolean;
  progress: number;
  step: string;
  elapsedS: number | null;
  etaS: number | null;
  result: ReplaySummary | null;
  error: string | null;
}

const EMPTY = (): BotReplayState => ({
  status: 'not_started',
  running: false,
  progress: 0,
  step: '',
  elapsedS: null,
  etaS: null,
  result: null,
  error: null,
});

/**
 * Fork-specific store backing the "Simulate a dry-run by replay" action on a bot.
 *
 * Seeds a *dry-run* bot's own database from a historical replay (the backend runs the
 * real live loop in an isolated subprocess), then reloads the bot. The user only picks
 * a period + resolution; strategy / pairs / wallet are auto-derived from the bot.
 *
 * The replay runs in the background regardless of the UI: `statusByBot` is the single
 * source of truth (modal + the per-bot indicator both read it), polling continues while
 * a replay runs, and completion auto-reloads the bot even if the modal was closed.
 */
export const useReplayStore = defineStore('replayStore', () => {
  const botStore = useBotStore();

  /** Per-bot "already seeded" flag — greys the menu entry + flags the bot in the list. */
  const seededByBot = ref<Record<string, boolean>>({});
  /** Per-bot seed marker (timerange / seeded_at / closed_trades), for tooltips. */
  const seedInfoByBot = ref<Record<string, Record<string, unknown> | null>>({});
  /** Per-bot live replay status — drives the modal and the comparison-list indicator. */
  const statusByBot = ref<Record<string, BotReplayState>>({});

  // ── Modal + auto-derived context ──────────────────────────────────────
  const visible = ref(false);
  const botId = ref('');
  const botName = ref('');
  const strategy = ref('');
  const pairs = ref<string[]>([]);
  const pairsSource = ref(''); // 'whitelist' | 'trades' | 'logs' | '' — where pairs came from
  const wallet = ref<number | null>(null); // resolved from the bot config (dry_run_wallet)
  const loadingContext = ref(false);
  const alreadySeeded = ref(false);
  const seedInfo = ref<Record<string, unknown> | null>(null);
  const backupAvailable = ref(false); // a pre-replay DB snapshot exists → restore possible

  // ── Form (the only user inputs) ───────────────────────────────────────
  const startDate = ref('');
  const endDate = ref('');
  const subStep = ref(60); // 60=1m, 300=5m, 900=15m
  const resetDb = ref(false); // wipe the dry DB first (else preserve existing trades)

  // ── Coordinator queue (machine-wide view) ────────────────────────────
  const queue = ref<import('@/types/replay').ReplayQueue | null>(null);

  // ── Local data coverage (drives fidelity warnings), cached per timeframe ──
  const coverageByTf = ref<Record<string, ReplayCoverage | null>>({});
  const coverageLoading = ref(false);

  const timers: Record<string, ReturnType<typeof setInterval>> = {};
  const wasRunning: Record<string, boolean> = {};

  function getApi(id: string) {
    return useApi(useLoginInfo(id), id).api;
  }

  const subStepTf = computed(() => SUB_STEP_TF[subStep.value] ?? '1m');
  const coverage = computed<ReplayCoverage | null>(
    () => coverageByTf.value[subStepTf.value] ?? null,
  );

  async function fetchCoverage() {
    const tf = subStepTf.value;
    if (tf in coverageByTf.value || pairs.value.length === 0) return; // cached or nothing to scan
    coverageLoading.value = true;
    try {
      const { data } = await getApi(botId.value).get<ReplayCoverage>('/replay/coverage', {
        params: { timeframe: tf, pairs: pairs.value },
        paramsSerializer: { indexes: null }, // pairs=A&pairs=B (FastAPI list form)
      });
      coverageByTf.value[tf] = data;
    } catch {
      coverageByTf.value[tf] = null;
    } finally {
      coverageLoading.value = false;
    }
  }

  // ── Replay-trade tagging ──────────────────────────────────────────────
  // The replay prefixes each seeded trade's enter_tag with `[replay]` at the end of a
  // run. This travels with the trade — robust regardless of dates or the seed marker
  // (a crashed seed may never write the marker) — so the UI flags it from the tag alone.
  const REPLAY_TAG = '[replay]';

  /** Whether this trade came from a replay seed (its enter_tag carries the marker). */
  function isReplayTrade(enterTag: string | null | undefined): boolean {
    return !!enterTag && enterTag.startsWith(REPLAY_TAG);
  }

  /** enter_tag with the `[replay]` marker stripped, for clean display. */
  function cleanEnterTag(enterTag: string | null | undefined): string {
    return (enterTag ?? '').replace(/^\[replay\]\s?/, '');
  }

  const current = computed<BotReplayState>(() => statusByBot.value[botId.value] ?? EMPTY());
  // A replay is "active" (queued, running or paused) — the modal shows progress, not the form.
  const currentActive = computed(() =>
    ['queued', 'running', 'paused'].includes(current.value.status),
  );
  const canRun = computed(
    () =>
      !currentActive.value &&
      !alreadySeeded.value &&
      !!startDate.value &&
      !!endDate.value &&
      startDate.value < endDate.value &&
      pairs.value.length > 0,
  );

  function setEndToday() {
    endDate.value = new Date().toISOString().slice(0, 10);
  }

  async function checkSeeded(id: string): Promise<ReplaySeededInfo | null> {
    try {
      const { data } = await getApi(id).get<ReplaySeededInfo>('/replay/seeded');
      seededByBot.value[id] = !!data.seeded;
      seedInfoByBot.value[id] = data.seeded ? (data.info ?? null) : null;
      return data;
    } catch {
      seededByBot.value[id] = false;
      seedInfoByBot.value[id] = null;
      return null;
    }
  }

  function applyStatus(id: string, s: ReplayStatus) {
    statusByBot.value[id] = {
      status: s.status,
      running: s.running,
      progress: s.progress ?? 0,
      step: s.step ?? '',
      elapsedS: s.elapsed_s ?? null,
      etaS: s.eta_s ?? null,
      result: s.result ?? statusByBot.value[id]?.result ?? null,
      error: s.status === 'error' ? s.status_msg : null,
    };
  }

  /** Poll one bot's replay status; manages its own interval and the done-transition. */
  async function pollBot(id: string) {
    let data: ReplayStatus;
    try {
      ({ data } = await getApi(id).get<ReplayStatus>('/replay'));
    } catch {
      stopPolling(id);
      return;
    }
    applyStatus(id, data);
    // Keep polling through the whole active lifecycle (queued → running ⇄ paused).
    if (['queued', 'running', 'paused'].includes(data.status)) {
      wasRunning[id] = true;
      ensurePolling(id);
    } else {
      stopPolling(id);
      if (wasRunning[id] && data.status === 'done') {
        wasRunning[id] = false;
        seededByBot.value[id] = true;
        if (botId.value === id) alreadySeeded.value = true;
        checkSeeded(id); // refresh the seed marker (timerange) for the list indicator
        // Auto-reload so the seeded history loads — even if the modal is closed.
        try {
          await botStore.botStores[id]?.reloadConfig();
        } catch {
          /* non-fatal */
        }
      }
      wasRunning[id] = false;
    }
  }

  /** Machine-wide coordinator queue (capacity + running/paused/queued). */
  async function fetchQueue(id = botId.value) {
    if (!id) return;
    try {
      const { data } = await getApi(id).get<import('@/types/replay').ReplayQueue>('/replay/queue');
      queue.value = data;
    } catch {
      queue.value = null;
    }
  }

  /** Bump another bot's replay up the global queue (higher priority = sooner). */
  async function reprioritize(targetBotId: string, priority: number) {
    try {
      await getApi(botId.value || targetBotId).post('/replay/reprioritize', {
        bot_id: targetBotId,
        priority,
      });
      await fetchQueue();
    } catch {
      /* non-fatal */
    }
  }

  function ensurePolling(id: string) {
    if (timers[id]) return;
    timers[id] = setInterval(() => pollBot(id), 1500);
  }

  function stopPolling(id: string) {
    if (timers[id]) {
      clearInterval(timers[id]);
      delete timers[id];
    }
  }

  async function open(id: string) {
    botId.value = id;
    botName.value = botStore.botStores[id]?.botName ?? id;
    visible.value = true; // show the modal immediately; everything below loads in background
    strategy.value = botStore.allBotState[id]?.strategy ?? '';
    wallet.value = null; // resolved below from /replay/seeded (config's dry_run_wallet)
    coverageByTf.value = {}; // coverage depends on this bot's pairs
    alreadySeeded.value = false;
    backupAvailable.value = false;
    seedInfo.value = null;
    resetDb.value = false;
    fetchQueue(id); // machine-wide queue (for the "paused, waiting" panel)
    // Seed pairs from the cached (websocket) whitelist instantly — refined below.
    const cached = botStore.botStores[id]?.whitelist ?? [];
    pairs.value = [...cached];
    pairsSource.value = cached.length ? 'whitelist' : '';

    // Seeded status + running status — background, never blocks the form.
    checkSeeded(id).then((seeded) => {
      alreadySeeded.value = !!seeded?.seeded;
      seedInfo.value = (seeded?.info as Record<string, unknown> | null) ?? null;
      backupAvailable.value = !!seeded?.backup_available;
      wallet.value = seeded?.dry_run_wallet ?? null;
    });
    pollBot(id);

    // Resolve the bot's pairs robustly (bounded by per-source timeouts) — background.
    loadingContext.value = true;
    resolvePairs(id)
      .then((res) => {
        if (botId.value !== id) return; // modal switched bots meanwhile
        pairs.value = res.pairs;
        pairsSource.value = res.source;
      })
      .finally(() => {
        if (botId.value === id) {
          loadingContext.value = false;
          fetchCoverage();
        }
      });
  }

  /**
   * The bot's pairs, from the first source that has them (so the modal never hangs on a
   * slow/empty `/whitelist` and degrades gracefully): live whitelist → traded pairs → logs.
   */
  async function resolvePairs(id: string): Promise<{ pairs: string[]; source: string }> {
    const bs = botStore.botStores[id];
    if (bs?.whitelist?.length) return { pairs: [...bs.whitelist], source: 'whitelist' };
    try {
      const { data } = await getApi(id).get<{ whitelist: string[] }>('/whitelist', {
        timeout: 8000,
      });
      if (data?.whitelist?.length) return { pairs: data.whitelist, source: 'whitelist' };
    } catch {
      /* slow or empty — fall through */
    }
    const traded = new Set<string>();
    for (const tr of [...(bs?.openTrades ?? []), ...(bs?.trades ?? [])]) traded.add(tr.pair);
    if (traded.size) return { pairs: [...traded], source: 'trades' };
    const fromLogs = await pairsFromLogs(id);
    if (fromLogs.length) return { pairs: fromLogs, source: 'logs' };
    return { pairs: [], source: '' };
  }

  /** Last `Whitelist with N pairs: [...]` line freqtrade logged (pairlistmanager). */
  async function pairsFromLogs(id: string): Promise<string[]> {
    try {
      const { data } = await getApi(id).get<{ logs: unknown[][] }>('/logs', {
        params: { limit: 1500 },
        timeout: 8000,
      });
      let latest: string[] = [];
      for (const entry of data?.logs ?? []) {
        const msg = entry.map(String).join(' ');
        const m = /Whitelist with \d+ pairs: \[(.*?)\]/.exec(msg);
        if (m) {
          const found = m[1]
            .split(',')
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
          if (found.length) latest = found; // keep the most recent match
        }
      }
      return latest;
    } catch {
      return [];
    }
  }

  function close() {
    visible.value = false;
    // Keep polling in the background: the run continues; the indicator tracks it.
  }

  async function start() {
    const payload: ReplayRequest = {
      strategy: strategy.value,
      timerange: `${startDate.value.replaceAll('-', '')}-${endDate.value.replaceAll('-', '')}`,
      pairs: pairs.value,
      wallet: null, // let the backend resolve the config's dry_run_wallet (authoritative)
      slippage: 0.0005,
      sub_step: subStep.value,
      reset_db: resetDb.value,
      priority: 0,
    };
    try {
      const { data } = await getApi(botId.value).post<ReplayStatus>('/replay', payload);
      applyStatus(botId.value, data);
      wasRunning[botId.value] = true;
      ensurePolling(botId.value);
    } catch (e) {
      statusByBot.value[botId.value] = { ...EMPTY(), status: 'error', error: extractError(e) };
    }
  }

  async function stop(id = botId.value) {
    try {
      await getApi(id).delete('/replay');
    } finally {
      stopPolling(id);
      wasRunning[id] = false;
      const cur = statusByBot.value[id];
      if (cur) cur.running = false;
    }
  }

  // Undo a crashed/unwanted seed: restore the bot's DB from the pre-replay snapshot.
  async function restore() {
    const id = botId.value;
    try {
      await getApi(id).post('/replay/restore');
      backupAvailable.value = false;
      alreadySeeded.value = false;
      seededByBot.value[id] = false;
      seedInfoByBot.value[id] = null;
      statusByBot.value[id] = EMPTY();
    } catch (e) {
      statusByBot.value[id] = { ...EMPTY(), status: 'error', error: extractError(e) };
    }
  }

  return {
    seededByBot,
    seedInfoByBot,
    statusByBot,
    visible,
    botId,
    botName,
    strategy,
    pairs,
    pairsSource,
    wallet,
    loadingContext,
    alreadySeeded,
    seedInfo,
    backupAvailable,
    startDate,
    endDate,
    subStep,
    resetDb,
    queue,
    fetchQueue,
    reprioritize,
    coverage,
    coverageLoading,
    subStepTf,
    current,
    currentActive,
    canRun,
    setEndToday,
    fetchCoverage,
    isReplayTrade,
    cleanEnterTag,
    checkSeeded,
    pollBot,
    open,
    close,
    start,
    stop,
    restore,
  };
});

function extractError(e: unknown): string {
  const err = e as { response?: { data?: { detail?: string } } };
  if (err?.response?.data?.detail) return err.response.data.detail;
  return e instanceof Error ? e.message : String(e);
}

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useReplayStore, import.meta.hot));
}
