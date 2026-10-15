/**
 * The actions of a bot, as the surfaces list them (row menu, header bar, drawer, palette), and
 * the rules that disable them. Everything that mutates goes through `useActionDialog` and
 * `useBotAction`; this file only describes and builds the typed action.
 * docs/redesign/02-design.md, sections 3.1, 3.2, 8, 10.2 and 11.
 */
import type { BotState, DsIconRef } from '@/components/ds/types';
import type { BotAction } from '@/datasource/types';
import type { BotRow, Position } from '@/gateway/types.gen';
import type { ConnectionState } from '@/datasource/types';

export type ActionId =
  | 'exit'
  | 'exitAll'
  | 'add'
  | 'forceEntry'
  | 'pause'
  | 'resume'
  | 'reload'
  | 'stop'
  | 'cancelOrder'
  | 'reloadTrade'
  | 'deleteTrade'
  | 'config'
  | 'replay'
  | 'openTrade'
  | 'chart'
  | 'reconcile';

export type ActionContextKind = 'row' | 'header' | 'drawer' | 'palette';

export interface ActionDef {
  id: ActionId;
  /** Key under `fq.act.`. */
  label: string;
  icon: DsIconRef;
  /** A mutation opens the confirmation; anything else only navigates. */
  mutation: boolean;
  /** Destructive: isolated and neutral-outlined, never a red fill. */
  danger?: boolean;
  shortcut?: string;
}

export const ACTIONS: Readonly<Record<ActionId, ActionDef>> = {
  exit: { id: 'exit', label: 'exit', icon: 'log-out', mutation: true, shortcut: 'X' },
  exitAll: { id: 'exitAll', label: 'exitAll', icon: 'log-out', mutation: true, danger: true },
  add: { id: 'add', label: 'add', icon: 'plus', mutation: true },
  forceEntry: { id: 'forceEntry', label: 'forceEntry', icon: 'log-in', mutation: true },
  pause: { id: 'pause', label: 'pause', icon: 'pause', mutation: true, shortcut: 'P' },
  resume: { id: 'resume', label: 'resume', icon: 'play', mutation: true },
  reload: { id: 'reload', label: 'reload', icon: 'refresh-cw', mutation: true },
  stop: { id: 'stop', label: 'stop', icon: 'square', mutation: true, danger: true },
  cancelOrder: { id: 'cancelOrder', label: 'cancelOrder', icon: 'x', mutation: true },
  reloadTrade: { id: 'reloadTrade', label: 'reloadTrade', icon: 'refresh-cw', mutation: true },
  deleteTrade: {
    id: 'deleteTrade',
    label: 'deleteTrade',
    icon: 'database',
    mutation: true,
    danger: true,
  },
  config: { id: 'config', label: 'config', icon: 'settings', mutation: false },
  replay: { id: 'replay', label: 'replay', icon: 'history', mutation: false },
  openTrade: { id: 'openTrade', label: 'openTrade', icon: 'layers', mutation: false },
  chart: { id: 'chart', label: 'chart', icon: 'chart-candlestick', mutation: false },
  reconcile: { id: 'reconcile', label: 'reconcile', icon: 'git-compare-arrows', mutation: false },
};

/** Actions of the menu of a position row (the menu is neutral; the danger one stays isolated). */
export function rowActionIds(orphan: boolean): ActionId[] {
  // An orphan position has no owner: never an exit, only the reconciliation (02 section 11.7)
  if (orphan) return ['openTrade', 'chart', 'reconcile'];
  return ['openTrade', 'chart', 'exit', 'add', 'pause'];
}

export function drawerActionIds(orphan: boolean): ActionId[] {
  if (orphan) return ['chart', 'reconcile'];
  return ['exit', 'add', 'pause', 'chart'];
}

/** Header of the Bot page: visible actions first, then the `...` menu, then "Exit all". */
export const HEADER_VISIBLE: readonly ActionId[] = ['pause', 'reload', 'config'];
export const HEADER_MORE: readonly ActionId[] = ['resume', 'forceEntry', 'replay', 'stop'];
export const HEADER_DANGER: ActionId = 'exitAll';

export type DisabledReason =
  | 'offline'
  | 'authExpired'
  | 'starting'
  | 'stopped'
  | 'connecting'
  | 'cache'
  | 'orphan'
  | 'unknownBot';

export interface Availability {
  connection: ConnectionState;
  /** What is on screen comes from the cache: actions wait for the first live snapshot. */
  fromCache: boolean;
}

/**
 * Why a bot can not be acted on right now, or null. Real-money actions never go to a bot that
 * does not answer (02 section 10.2: never "restart it just to close a position").
 */
export function disabledReasonFor(
  state: BotState | null,
  avail: Availability,
  opts: { orphan?: boolean } = {},
): DisabledReason | null {
  if (opts.orphan) return 'orphan';
  if (state === null) return 'unknownBot';
  if (avail.connection === 'connecting') return 'connecting';
  if (avail.fromCache) return 'cache';
  switch (state) {
    case 'offline':
      return 'offline';
    case 'auth_expired':
      return 'authExpired';
    case 'starting':
      return 'starting';
    case 'stopped':
      return 'stopped';
    case 'stale':
      return 'offline';
    default:
      return avail.connection === 'offline' ? 'offline' : null;
  }
}

export interface ActionTargetInfo {
  position?: Pick<Position, 'trade_id' | 'pair' | 'side' | 'orphan' | 'bot_key'> | null;
  /** Pair for an entry (forced entry or reinforcement). */
  pair?: string;
}

/**
 * The typed action of an id, or null when it is not a mutation or lacks what it needs. A single
 * exit carries the state the user saw (`expected`): the check before sending relies on it.
 */
export function buildAction(id: ActionId, info: ActionTargetInfo = {}): BotAction | null {
  const p = info.position ?? null;
  switch (id) {
    case 'pause':
      return { kind: 'stopbuy' };
    case 'resume':
      return { kind: 'start' };
    case 'reload':
      return { kind: 'reload_config' };
    case 'stop':
      return { kind: 'stop' };
    case 'exitAll':
      return { kind: 'forceexit', tradeId: 'all' };
    case 'exit':
      return p && !p.orphan
        ? {
            kind: 'forceexit',
            tradeId: p.trade_id,
            expected: { pair: p.pair, isShort: p.side === 'short' },
          }
        : null;
    case 'add':
      return p && !p.orphan ? { kind: 'forceentry', pair: p.pair, side: p.side } : null;
    case 'forceEntry':
      return { kind: 'forceentry', pair: info.pair ?? '' };
    case 'cancelOrder':
      return p && !p.orphan ? { kind: 'cancel_open_order', tradeId: p.trade_id } : null;
    case 'reloadTrade':
      return p && !p.orphan ? { kind: 'reload_trade', tradeId: p.trade_id } : null;
    case 'deleteTrade':
      return p && !p.orphan ? { kind: 'delete_trade', tradeId: p.trade_id } : null;
    default:
      return null;
  }
}

export function isEntryAction(a: BotAction): boolean {
  return a.kind === 'forceentry';
}

/** The state of a bot row as an action surface needs it. */
export function botIsLive(bot: BotRow | null | undefined): boolean {
  // Unknown bot: treated as live, the most protective assumption (same rule as useBotAction)
  return bot ? bot.identity.mode === 'live' : true;
}
