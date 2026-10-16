/**
 * Legacy URLs and where they lead now (docs/redesign/02-design.md, section 2.1). Every path of the
 * old router keeps working: nothing a user bookmarked ends in a 404. The functions here are pure
 * so the table is testable without a router.
 */
import type { LocationQueryRaw } from 'vue-router';

import { botKeyFromApiUrl, parseBotKey } from '@/datasource/protocol/identity';

/** The part of the stored logins this module needs (`ftAuthLoginInfo`). */
export interface StoredLogins {
  [uiId: string]: { botName?: string; apiUrl?: string } | undefined;
}

export interface BotLookup {
  logins: StoredLogins;
  /** `bot_key` to the name the fleet knows (once loaded). */
  fleetNames?: Record<string, string>;
  /** `ftbot.N` to `bot_key`, as answered by the gateway bootstrap. */
  aliases?: Record<string, string>;
  selfOrigin: string;
  localHosts: readonly string[];
}

/**
 * The `bot_key` a legacy parameter designates: a canonical key, a `ftbot.N` alias of this device,
 * or a bot name. `null` when it designates nothing known.
 */
export function resolveBotParam(param: unknown, lookup: BotLookup): string | null {
  if (typeof param !== 'string' || param.trim() === '') return null;
  const value = param.trim();
  const canonical = parseBotKey(value);
  if (canonical) return canonical;

  const alias = lookup.aliases?.[value];
  if (alias) return alias;
  const login = lookup.logins[value];
  if (login) {
    const url = login.apiUrl || lookup.selfOrigin;
    return url ? botKeyFromApiUrl(url, lookup.localHosts) : null;
  }
  // A name: the fleet first (it is authoritative), then the names stored with the logins
  for (const [key, name] of Object.entries(lookup.fleetNames ?? {})) {
    if (name === value) return key;
  }
  for (const entry of Object.values(lookup.logins)) {
    if (entry?.botName === value) {
      const url = entry.apiUrl || lookup.selfOrigin;
      return url ? botKeyFromApiUrl(url, lookup.localHosts) : null;
    }
  }
  return null;
}

/** Paths of the Tools pages (docs/redesign/02-design.md, section 2.2). */
export const TOOL_PATHS = {
  diagnostic: '/tools/diagnostic',
  reconciliation: '/tools/reconciliation',
  risk: '/tools/risk',
  logs: '/tools/logs',
  strategyDev: '/tools/strategy-dev',
  backtest: '/tools/backtest',
  downloadData: '/tools/download-data',
  pairlistConfig: '/tools/pairlist-config',
  replay: '/tools/replay',
  volume: '/tools/volume',
} as const;

export type ToolId = keyof typeof TOOL_PATHS;

/** Old path to its new home, for the paths that do not need a bot to be resolved. */
export const LEGACY_REDIRECTS: Readonly<Record<string, string>> = {
  '/': '/dashboard',
  '/open_trades': '/dashboard',
  '/trade_history': '/journal',
  '/logs': TOOL_PATHS.logs,
  '/backtest': TOOL_PATHS.backtest,
  '/download_data': TOOL_PATHS.downloadData,
  '/pairlist_config': TOOL_PATHS.pairlistConfig,
  '/strategy-dev': TOOL_PATHS.strategyDev,
};

/** Tab of the Bot page that replaces the old `/balance` and `/pairlist` tabs. */
export const LEGACY_BOT_TABS: Readonly<Record<string, string>> = {
  '/balance': 'performance',
  '/pairlist': 'pairs',
};

/**
 * Query of a redirect: what the old page honoured (`bot` is turned into the path, `highlight`,
 * `q` and `redirect` are kept) and nothing else.
 */
export function carryQuery(
  query: LocationQueryRaw,
  drop: readonly string[] = [],
): LocationQueryRaw {
  const out: LocationQueryRaw = {};
  for (const [k, v] of Object.entries(query)) {
    if (!drop.includes(k) && v !== undefined) out[k] = v;
  }
  return out;
}
