/**
 * Rows of the bot registry (02 section 3.6, 1): one list for the bots of this browser, the gateway
 * and the migration. The key of a bot is its `bot_key`; the `ftbot.N` of this device is only an
 * alias shown next to it and never renumbered.
 */
import type { BotState } from '@/components/ds/types';
import type { RegistryBot } from '@/datasource/types';
import type { BotKey, BotMode, BotRow, Market } from '@/gateway/types.gen';
import type { BotGroupPrefs, MigrationRecord } from '@/migration/schema';

import { botState } from './bots';

export interface RegistryRow {
  botKey: BotKey;
  name: string;
  alias: string | null;
  mode: BotMode | null;
  /** State of the process; null when the fleet does not know the bot (not reachable yet). */
  state: BotState | null;
  market: Market | null;
  group: string | null;
  /** Dry bot whose figures start at a seed: "since DD/MM". */
  sinceMs: number | null;
  /** A session expired: the row offers "Reconnect" instead of "Edit". */
  needsLogin: boolean;
}

export function registryRows(
  bots: readonly RegistryBot[],
  fleet: Readonly<Record<BotKey, BotRow>>,
  groups: readonly BotGroupPrefs[],
  nowMs: number,
  skewMs: number,
): RegistryRow[] {
  const groupOf = new Map<BotKey, string>();
  for (const g of groups) for (const k of g.botKeys) if (!groupOf.has(k)) groupOf.set(k, g.name);
  return bots.map((b) => {
    const row = fleet[b.botKey];
    const state = row ? botState(row, nowMs, skewMs) : null;
    return {
      botKey: b.botKey,
      name: row?.identity.name ?? b.name,
      alias: b.uiId,
      mode: row?.identity.mode ?? null,
      state,
      market: row?.identity.market ?? null,
      group: groupOf.get(b.botKey) ?? null,
      sinceMs: row?.state.first_real_trade_ms ?? null,
      needsLogin: state === 'auth_expired',
    };
  });
}

/** Bots first that need the user (expired session), then live before dry, then by name. */
export function sortRegistry(rows: readonly RegistryRow[]): RegistryRow[] {
  const modeRank = (m: BotMode | null) =>
    m === 'live' ? 0 : m === 'dry' ? 1 : m === 'replay' ? 2 : 3;
  return rows
    .slice()
    .sort(
      (a, b) =>
        Number(b.needsLogin) - Number(a.needsLogin) ||
        modeRank(a.mode) - modeRank(b.mode) ||
        a.name.localeCompare(b.name, 'en', { numeric: true }) ||
        a.botKey.localeCompare(b.botKey),
    );
}

export interface MigrationView {
  /** When the migration ran (ms). */
  atMs: number;
  /** Bots that came from this browser: the ones with a `ftbot.N` alias. */
  imported: number;
  unmapped: string[];
  forcedConfirmation: boolean;
  localeFallback: boolean;
}

export function migrationView(
  record: MigrationRecord | null,
  bots: readonly RegistryBot[],
): MigrationView | null {
  if (!record) return null;
  return {
    atMs: record.at,
    imported: bots.filter((b) => b.uiId !== null).length,
    unmapped: record.report.unmappedBots,
    forcedConfirmation: record.report.forcedConfirmation,
    localeFallback: record.report.localeFallback,
  };
}
