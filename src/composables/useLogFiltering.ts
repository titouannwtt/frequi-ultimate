/**
 * useLogFiltering — Pure reactive logic for filtering and grouping aggregated logs.
 *
 * Separated from the store so it can be tested in isolation and reused.
 * All outputs are computed refs that react to filter changes.
 */
import type { AggregatedLogEntry } from '@/stores/logConsole';

// ── Filter state types ──

export type LogLevel = 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO';

export interface LogFilters {
  /** Enabled severity levels */
  levels: Set<LogLevel>;
  /** Selected bot IDs (empty = all) */
  botIds: Set<string>;
  /** Selected exchanges (empty = all) */
  exchanges: Set<string>;
  /** Selected modules (empty = all) */
  modules: Set<string>;
  /** Excluded module prefixes (noise suppression) */
  excludedModulePrefixes: string[];
  /** Free-text search */
  searchText: string;
  /** Bot mode filter: 'all' | 'live' | 'dry' */
  botMode: 'all' | 'live' | 'dry';
  /** Market type filter: 'all' | 'spot' | 'futures' */
  marketType: 'all' | 'spot' | 'futures';
  /** Time window in ms (0 = no limit) */
  timeWindowMs: number;
}

// ── Grouped log entry ──

export interface GroupedLogEntry {
  /** Grouping key: botId + level + messageTemplate */
  key: string;
  /** First occurrence (oldest) */
  first: AggregatedLogEntry;
  /** Last occurrence (newest) */
  last: AggregatedLogEntry;
  /** Number of occurrences */
  count: number;
  /** Bot identification */
  botId: string;
  botName: string;
  /** Severity of this group */
  level: string;
  /** Module of the first occurrence */
  module: string;
  /** The normalized template (for display) */
  messageTemplate: string;
  /** All entries in this group (for expand) */
  entries: AggregatedLogEntry[];
}

// ── Severity ranking for sorting ──

const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 0,
  ERROR: 1,
  WARNING: 2,
  INFO: 3,
  DEBUG: 4,
};

// ── Default excluded module prefixes (noise) ──

const DEFAULT_EXCLUDED_PREFIXES = [
  'uvicorn.',
  'freqtrade.rpc.api_server.ws.',
];

// ── Factory ──

export function useLogFiltering(entries: Ref<AggregatedLogEntry[]>) {
  // ── Reactive filter state ──
  const filters = reactive<LogFilters>({
    levels: new Set<LogLevel>(['CRITICAL', 'ERROR', 'WARNING', 'INFO']),
    botIds: new Set<string>(),
    exchanges: new Set<string>(),
    modules: new Set<string>(),
    excludedModulePrefixes: [...DEFAULT_EXCLUDED_PREFIXES],
    searchText: '',
    botMode: 'all',
    marketType: 'all',
    timeWindowMs: 0,
  });

  // ── Display mode ──
  const displayMode = ref<'grouped' | 'timeline'>('grouped');

  // ── Step 1: Filtered entries (computed, reactive to filter changes) ──
  const filteredEntries = computed<AggregatedLogEntry[]>(() => {
    const now = Date.now();
    const search = filters.searchText.toLowerCase();

    return entries.value.filter((e) => {
      // Severity filter
      if (!filters.levels.has(e.level as LogLevel)) return false;

      // Bot ID filter (empty = all)
      if (filters.botIds.size > 0 && !filters.botIds.has(e.botId)) return false;

      // Exchange filter (empty = all)
      if (filters.exchanges.size > 0 && !filters.exchanges.has(e.exchange)) return false;

      // Module filter (empty = all)
      if (filters.modules.size > 0 && !filters.modules.has(e.module)) return false;

      // Excluded module prefixes
      for (const prefix of filters.excludedModulePrefixes) {
        if (e.module.startsWith(prefix)) return false;
      }

      // Bot mode filter
      if (filters.botMode === 'live' && e.isDryRun) return false;
      if (filters.botMode === 'dry' && !e.isDryRun) return false;

      // Market type filter
      if (filters.marketType === 'spot' && e.tradingMode !== 'spot') return false;
      if (filters.marketType === 'futures' && e.tradingMode !== 'futures') return false;

      // Time window
      if (filters.timeWindowMs > 0 && now - e.timestamp > filters.timeWindowMs) return false;

      // Text search (message, module, botName)
      if (search) {
        const haystack = `${e.message} ${e.module} ${e.botName}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      return true;
    });
  });

  // ── Step 2: Grouped entries (computed) ──
  const groupedEntries = computed<GroupedLogEntry[]>(() => {
    const groups = new Map<string, GroupedLogEntry>();

    for (const entry of filteredEntries.value) {
      const key = `${entry.botId}__${entry.level}__${entry.messageTemplate}`;

      const existing = groups.get(key);
      if (existing) {
        existing.count++;
        existing.entries.push(entry);
        // entries are sorted newest-first, so first entry in array = last occurrence
        if (entry.timestamp < existing.first.timestamp) {
          existing.first = entry;
        }
        if (entry.timestamp > existing.last.timestamp) {
          existing.last = entry;
        }
      } else {
        groups.set(key, {
          key,
          first: entry,
          last: entry,
          count: 1,
          botId: entry.botId,
          botName: entry.botName,
          level: entry.level,
          module: entry.module,
          messageTemplate: entry.messageTemplate,
          entries: [entry],
        });
      }
    }

    // Sort: by severity (CRITICAL first), then by last occurrence (newest first)
    return Array.from(groups.values()).sort((a, b) => {
      const sevDiff = (SEVERITY_RANK[a.level] ?? 9) - (SEVERITY_RANK[b.level] ?? 9);
      if (sevDiff !== 0) return sevDiff;
      return b.last.timestamp - a.last.timestamp;
    });
  });

  // ── Step 3: Grouped by bot (for the sectioned view) ──
  const groupedByBot = computed<{ botId: string; botName: string; maxSeverity: string; groups: GroupedLogEntry[] }[]>(() => {
    const botMap = new Map<string, GroupedLogEntry[]>();

    for (const group of groupedEntries.value) {
      const existing = botMap.get(group.botId);
      if (existing) {
        existing.push(group);
      } else {
        botMap.set(group.botId, [group]);
      }
    }

    const result = Array.from(botMap.entries()).map(([botId, groups]) => {
      const botName = groups[0]?.botName ?? botId;
      // Max severity across all groups of this bot
      let maxSev = 9;
      for (const g of groups) {
        const sev = SEVERITY_RANK[g.level] ?? 9;
        if (sev < maxSev) maxSev = sev;
      }
      const maxSeverity = Object.entries(SEVERITY_RANK).find(([, v]) => v === maxSev)?.[0] ?? 'INFO';
      return { botId, botName, maxSeverity, groups };
    });

    // Sort bots by max severity (most critical first), then by name
    return result.sort((a, b) => {
      const sevDiff = (SEVERITY_RANK[a.maxSeverity] ?? 9) - (SEVERITY_RANK[b.maxSeverity] ?? 9);
      if (sevDiff !== 0) return sevDiff;
      return a.botName.localeCompare(b.botName);
    });
  });

  // ── Summary counts ──
  const summaryCounts = computed(() => {
    let critical = 0, error = 0, warning = 0, info = 0;
    for (const e of filteredEntries.value) {
      switch (e.level) {
        case 'CRITICAL': critical++; break;
        case 'ERROR': error++; break;
        case 'WARNING': warning++; break;
        case 'INFO': info++; break;
      }
    }
    return { critical, error, warning, info, total: filteredEntries.value.length };
  });

  // ── Unique bot IDs that have issues (for "N bots without issues" count) ──
  const botsWithIssues = computed(() => {
    const ids = new Set<string>();
    for (const e of filteredEntries.value) {
      if (e.level === 'CRITICAL' || e.level === 'ERROR' || e.level === 'WARNING') {
        ids.add(e.botId);
      }
    }
    return ids;
  });

  // ── Filter helpers ──
  function toggleLevel(level: LogLevel) {
    if (filters.levels.has(level)) {
      filters.levels.delete(level);
    } else {
      filters.levels.add(level);
    }
  }

  function toggleBotId(botId: string) {
    if (filters.botIds.has(botId)) {
      filters.botIds.delete(botId);
    } else {
      filters.botIds.add(botId);
    }
  }

  function toggleExchange(exchange: string) {
    if (filters.exchanges.has(exchange)) {
      filters.exchanges.delete(exchange);
    } else {
      filters.exchanges.add(exchange);
    }
  }

  function toggleModule(mod: string) {
    if (filters.modules.has(mod)) {
      filters.modules.delete(mod);
    } else {
      filters.modules.add(mod);
    }
  }

  function resetFilters() {
    filters.levels = new Set<LogLevel>(['CRITICAL', 'ERROR', 'WARNING', 'INFO']);
    filters.botIds.clear();
    filters.exchanges.clear();
    filters.modules.clear();
    filters.excludedModulePrefixes = [...DEFAULT_EXCLUDED_PREFIXES];
    filters.searchText = '';
    filters.botMode = 'all';
    filters.marketType = 'all';
    filters.timeWindowMs = 0;
  }

  function setTimeWindow(hours: number) {
    filters.timeWindowMs = hours > 0 ? hours * 3600_000 : 0;
  }

  return {
    // Filter state
    filters,
    displayMode,

    // Computed outputs
    filteredEntries,
    groupedEntries,
    groupedByBot,
    summaryCounts,
    botsWithIssues,

    // Actions
    toggleLevel,
    toggleBotId,
    toggleExchange,
    toggleModule,
    resetFilters,
    setTimeWindow,
  };
}
