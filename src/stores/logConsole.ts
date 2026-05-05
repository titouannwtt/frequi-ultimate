/**
 * Log Console Store — Collects and stores logs from all bots.
 *
 * Polls each online bot's /logs endpoint every 10 seconds.
 * Stores aggregated logs with bot metadata for filtering/grouping.
 * Designed for the multi-bot log console dashboard widget.
 */
import type { LogLine } from '@/types/types';
import { timestampms } from '@/utils/formatters/timeformat';

/** A single log entry enriched with bot metadata */
export interface AggregatedLogEntry {
  /** Stable unique ID for keying/dedup */
  id: string;
  /** Bot store ID */
  botId: string;
  /** Display name of the bot */
  botName: string;
  /** Epoch milliseconds (from LogLine[1]) */
  timestamp: number;
  /** Pre-formatted datetime string (from LogLine[0]) */
  timestampFormatted: string;
  /** Log severity level */
  level: 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG';
  /** Python module that emitted the log */
  module: string;
  /** Raw log message (may include exception after \n) */
  message: string;
  /** Exception traceback if present (split from message) */
  exception: string | null;
  /** Normalized message for grouping (dynamic values replaced with placeholders) */
  messageTemplate: string;
  // Bot metadata for filtering
  /** Exchange name (lowercase) */
  exchange: string;
  /** Trading mode: 'spot' | 'futures' | 'margin' */
  tradingMode: string;
  /** Whether bot is in dry_run mode */
  isDryRun: boolean;
}

/** Status of a bot's log fetch */
export interface BotLogStatus {
  botId: string;
  botName: string;
  isOnline: boolean;
  lastFetchTimestamp: number;
  lastError: string | null;
  logCount: number;
}

/** Normalize a log message for grouping: replace dynamic values with placeholders */
function normalizeMessage(msg: string): string {
  return msg
    .replace(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?/g, '{TS}')
    .replace(/\b[A-Z]{2,10}\/[A-Z]{2,10}(:[A-Z]{2,10})?\b/g, '{PAIR}')
    .replace(/\b(trade|order)\s+\d+\b/gi, '$1 {ID}')
    .replace(/\b\d+\.\d+\b/g, '{N}')
    .replace(/\b\d{5,}\b/g, '{N}');
}

/** Generate a stable ID for a log entry (bot + timestamp + module + first 40 chars) */
function logEntryId(botId: string, log: LogLine): string {
  return `${botId}_${log[1]}_${log[2]}_${log[4].slice(0, 40)}`;
}

/** Parse a LogLine into an AggregatedLogEntry */
function parseLogLine(
  botId: string,
  botName: string,
  exchange: string,
  tradingMode: string,
  isDryRun: boolean,
  log: LogLine,
): AggregatedLogEntry {
  const rawMessage = log[4];
  const newlineIdx = rawMessage.indexOf('\n');
  const message = newlineIdx >= 0 ? rawMessage.slice(0, newlineIdx) : rawMessage;
  const exception = newlineIdx >= 0 ? rawMessage.slice(newlineIdx + 1).trim() : null;

  return {
    id: logEntryId(botId, log),
    botId,
    botName,
    timestamp: log[1],
    timestampFormatted: timestampms(log[1]),
    level: log[3] as AggregatedLogEntry['level'],
    module: log[2],
    message,
    exception: exception || null,
    messageTemplate: normalizeMessage(message),
    exchange,
    tradingMode,
    isDryRun,
  };
}

const LOG_LIMIT_PER_BOT = 200;
const POLL_INTERVAL_MS = 10_000;
const FETCH_TIMEOUT_MS = 3_000;

export const useLogConsoleStore = defineStore('logConsole', {
  state: () => ({
    /** All aggregated log entries from all bots, newest first */
    entries: [] as AggregatedLogEntry[],
    /** Per-bot fetch status */
    botStatuses: {} as Record<string, BotLogStatus>,
    /** Polling interval handle */
    _pollInterval: null as ReturnType<typeof setInterval> | null,
    /** Whether the first fetch has completed */
    initialLoadDone: false,
    /** Whether a fetch is currently in progress */
    fetching: false,
    /** Last global fetch timestamp */
    lastFetchTimestamp: 0,
    /** IDs of entries added in the most recent fetch (for new-entry animation) */
    newEntryIds: {} as Record<string, boolean>,
  }),

  getters: {
    /** All unique modules across all entries (for filter dropdown) */
    allModules(): string[] {
      const modules = new Set<string>();
      for (const e of this.entries) modules.add(e.module);
      return Array.from(modules).sort();
    },

    /** All unique exchanges across all entries */
    allExchanges(): string[] {
      const exchanges = new Set<string>();
      for (const e of this.entries) if (e.exchange) exchanges.add(e.exchange);
      return Array.from(exchanges).sort();
    },

    /** Bot statuses as sorted array */
    botStatusList(): BotLogStatus[] {
      return Object.values(this.botStatuses).sort((a, b) => a.botName.localeCompare(b.botName));
    },

    /** Count of bots that are unreachable */
    unreachableBotCount(): number {
      return Object.values(this.botStatuses).filter((s) => !s.isOnline && s.lastError).length;
    },
  },

  actions: {
    /** Fetch logs from all online bots and merge into entries */
    async fetchAllLogs() {
      const botStore = useBotStore();
      this.fetching = true;

      const fetchPromises: Promise<void>[] = [];

      for (const [botId, store] of Object.entries(botStore.botStores)) {
        const botState = botStore.allBotState[botId];
        const botName = store.uiBotName ?? botId;
        const exchange = ((botState?.exchange as string) ?? '').toLowerCase();
        const tradingMode = ((botState?.trading_mode as string) ?? 'spot').toLowerCase();
        const isDryRun = (botState?.dry_run as boolean) ?? false;

        // Initialize status if new
        if (!this.botStatuses[botId]) {
          this.botStatuses[botId] = {
            botId,
            botName,
            isOnline: store.isBotOnline,
            lastFetchTimestamp: 0,
            lastError: null,
            logCount: 0,
          };
        }

        // Update online status
        this.botStatuses[botId].isOnline = store.isBotOnline;
        this.botStatuses[botId].botName = botName;

        // Skip offline bots
        if (!store.isBotOnline || !store.isBotLoggedIn) continue;

        fetchPromises.push(
          (async () => {
            try {
              // Timeout-protected fetch
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

              await store.getLogs();
              clearTimeout(timeoutId);

              const logs: LogLine[] = store.lastLogs ?? [];
              const parsed = logs
                .slice(-LOG_LIMIT_PER_BOT)
                .map((log) => parseLogLine(botId, botName, exchange, tradingMode, isDryRun, log));

              // Merge by ID: keep existing entries, only add genuinely new ones
              const existingIds = new Set(
                this.entries.filter((e) => e.botId === botId).map((e) => e.id),
              );

              const added: AggregatedLogEntry[] = [];
              for (const entry of parsed) {
                if (!existingIds.has(entry.id)) {
                  added.push(entry);
                  this.newEntryIds[entry.id] = true;
                }
              }
              if (added.length > 0) {
                this.entries.push(...added);
              }

              this.botStatuses[botId].lastFetchTimestamp = Date.now();
              this.botStatuses[botId].lastError = null;
              this.botStatuses[botId].logCount = parsed.length;
            } catch (err: any) {
              this.botStatuses[botId].lastError = err?.message ?? 'Fetch failed';
              this.botStatuses[botId].lastFetchTimestamp = Date.now();
            }
          })(),
        );
      }

      await Promise.allSettled(fetchPromises);

      // Only re-sort and cap if entries actually changed
      const newIdKeys = Object.keys(this.newEntryIds);
      if (newIdKeys.length > 0) {
        this.entries.sort((a, b) => b.timestamp - a.timestamp);

        if (this.entries.length > 2000) {
          this.entries = this.entries.slice(0, 2000);
        }
      }

      this.fetching = false;
      this.initialLoadDone = true;
      this.lastFetchTimestamp = Date.now();

      // Clear new-entry markers after animation duration (1s)
      if (newIdKeys.length > 0) {
        const keysToClean = [...newIdKeys];
        setTimeout(() => {
          for (const id of keysToClean) delete this.newEntryIds[id];
        }, 1000);
      }
    },

    /** Start periodic polling */
    startPolling() {
      if (this._pollInterval) return;
      // Immediate first fetch
      this.fetchAllLogs();
      this._pollInterval = setInterval(() => {
        this.fetchAllLogs();
      }, POLL_INTERVAL_MS);
    },

    /** Stop periodic polling */
    stopPolling() {
      if (this._pollInterval) {
        clearInterval(this._pollInterval);
        this._pollInterval = null;
      }
    },

    /** Clear all stored logs */
    clear() {
      this.entries = [];
      this.botStatuses = {};
      this.initialLoadDone = false;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useLogConsoleStore, import.meta.hot));
}
