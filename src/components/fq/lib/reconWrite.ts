/**
 * The write side of the wallet reconciliation (02 section 11, destructive level). Pure: which
 * request a row asks for, how the typed confirmation is checked, how an answer of the gateway or of
 * a bot is read, and how the wallet is shown. Nothing here sends anything: the page sends exactly
 * one request per confirmed intent and never replays it.
 */
import type {
  FleetviewCoin,
  FleetviewResolveAction,
  FleetviewResolvePayload,
  FleetviewSlice,
  FleetviewTradeRef,
} from '@/types/fleetview';

import { reconView } from './recon';

/** What a preview is about: the action and, for a single trade, which one. */
export interface ReconIntent {
  action: FleetviewResolveAction;
  coin: FleetviewCoin;
  /** The trade the action touches (`delete_phantom`, `close_minority`); none for `close_unowned`. */
  trade: FleetviewTradeRef | null;
}

/** The intents a row offers (one per minority slice), empty for a row that cannot be previewed. */
export function intentsFor(c: FleetviewCoin): ReconIntent[] {
  const v = reconView(c);
  if (!v.actionable) return [];
  switch (c.status) {
    case 'unowned':
      return [{ action: 'close_unowned', coin: c, trade: null }];
    case 'phantom':
      return c.phantom_candidate
        ? [{ action: 'delete_phantom', coin: c, trade: c.phantom_candidate }]
        : [];
    case 'minority':
      return c.minority_slices.map((t) => ({ action: 'close_minority', coin: c, trade: t }));
    default:
      return [];
  }
}

/** The body that is sent, built from what the dialog shows. */
export function payloadOf(i: ReconIntent): FleetviewResolvePayload {
  return {
    action: i.action,
    coin: i.coin.coin,
    ...(i.trade ? { bot_name: i.trade.bot_name, trade_id: i.trade.trade_id } : {}),
    confirm: true,
  };
}

/** The slice of the coin a trade reference designates, for the amounts shown in the dialog. */
export function sliceOf(c: FleetviewCoin, t: FleetviewTradeRef | null): FleetviewSlice | null {
  if (!t) return null;
  return c.slices.find((s) => s.bot_name === t.bot_name && s.trade_id === t.trade_id) ?? null;
}

/** The coin name is typed back, case and spaces aside; the hold is only armed once it matches. */
export function typedMatches(typed: string, coin: string): boolean {
  return typed.trim().toUpperCase() === coin.trim().toUpperCase() && coin.trim() !== '';
}

/** `0xAbCd...1234`: the head and the tail of an address; short values are kept as they are. */
export function shortWallet(addr: string | null | undefined): string {
  if (!addr) return '';
  return addr.length <= 14 ? addr : `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export type WriteStatus = 'accepted' | 'rejected' | 'unknown' | 'unauthorized' | 'in_progress';

export interface WriteOutcome {
  status: WriteStatus;
  /** Parsed answer of the bot when it is JSON. */
  data: Record<string, unknown> | null;
  /** The answer as text (truncated by the gateway), or the reason of a refusal. */
  text: string | null;
}

const STATUSES = new Set<string>([
  'accepted',
  'rejected',
  'unknown',
  'unauthorized',
  'in_progress',
]);

function parseObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The answer of a proxied write. The gateway wraps the bot's answer in an action result (`status`,
 * `botResponse`, `error`); a direct call returns the bot's own JSON. `state_mismatch` cannot
 * happen here (nothing is pre-checked against a displayed state) and is read as a refusal.
 */
export function readWriteOutcome(kind: 'gateway' | 'direct', raw: unknown): WriteOutcome {
  if (kind === 'direct') {
    const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
    return { status: 'accepted', data: obj, text: obj ? JSON.stringify(obj) : null };
  }
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    status?: unknown;
    botResponse?: unknown;
    error?: unknown;
  };
  const text = typeof r.botResponse === 'string' ? r.botResponse : null;
  const status: WriteStatus =
    typeof r.status === 'string' && STATUSES.has(r.status) ? (r.status as WriteStatus) : 'rejected';
  return {
    status,
    data: parseObject(text),
    text: text ?? (typeof r.error === 'string' ? r.error : null),
  };
}
