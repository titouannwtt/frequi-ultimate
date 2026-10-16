import { shallowRef } from 'vue';

import { disabledReasonFor, type DisabledReason } from '@/components/fq/lib/actions';
import { botState } from '@/components/fq/lib/bots';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import type { BotAction } from '@/datasource/types';
import type { BotKey, Position } from '@/gateway/types.gen';
import i18n from '@/locales';

import { positionTradeIdOf, useBotAction } from './useBotAction';
import { useToaster } from './useToaster';

/**
 * The single confirmation dialog of the app (docs/redesign/02-design.md, section 11). Every
 * surface that can mutate a bot (row button, row menu, drawer, header, palette, alert) asks for it
 * here, with the bot and the trade it targets. There is one dialog at a time, so two surfaces can
 * never run two confirmations of the same action in parallel; `useBotAction` adds the in-flight
 * lock and the idempotency key on top.
 *
 * `requestAction` re-checks, whatever the surface did, what a disabled button already told the
 * user: the bot answers, nothing is orphan, the trade belongs to the bot it names and is the one
 * that was displayed. A request that fails a check opens nothing.
 */
export interface ActionContext {
  /** The position the action is about, as it was displayed. */
  position?: Position | null;
  /** Share of the position pre-selected by the drawer foot, 0 to 1. */
  initialFraction?: number;
}

export interface ActionRequest {
  botKey: BotKey;
  action: BotAction;
  context: ActionContext;
}

export type RequestRefusal =
  | 'dialog_open'
  | 'unknown_bot'
  | 'not_actionable'
  | 'orphan'
  | 'mismatch'
  | 'missing_state'
  | 'busy';

export type RequestResult =
  | { ok: true }
  | { ok: false; reason: RequestRefusal; disabled?: DisabledReason };

const current = shallowRef<ActionRequest | null>(null);
let last: ActionRequest | null = null;

function t(key: string): string {
  return i18n.global.t(`fq.${key}`) as string;
}

export function requestAction(
  botKey: BotKey,
  action: BotAction,
  context: ActionContext = {},
): RequestResult {
  if (current.value) return { ok: false, reason: 'dialog_open' };

  const fleet = useFqFleetStore();
  const conn = useFqConnectionStore();
  const bot = fleet.bots[botKey];
  if (!bot) return { ok: false, reason: 'unknown_bot', disabled: 'unknownBot' };

  const state = botState(bot, Date.now(), conn.status.clockSkewMs);
  const tradeId = positionTradeIdOf(action);
  const position =
    typeof tradeId === 'number'
      ? (context.position ?? useFqPositionsStore().get(botKey, tradeId) ?? null)
      : (context.position ?? null);

  const disabled = disabledReasonFor(
    state,
    { connection: conn.status.state, fromCache: conn.fromCache },
    { orphan: position?.orphan === true },
  );
  if (disabled) {
    return { ok: false, reason: disabled === 'orphan' ? 'orphan' : 'not_actionable', disabled };
  }

  if (typeof tradeId === 'number') {
    // The trade must be the one of this bot: the same trade_id exists on other bots
    if (!position) return { ok: false, reason: 'missing_state' };
    if (position.bot_key !== botKey || position.trade_id !== tradeId) {
      return { ok: false, reason: 'mismatch' };
    }
    if (
      action.kind === 'forceexit' &&
      (!action.expected ||
        action.expected.pair !== position.pair ||
        action.expected.isShort !== (position.side === 'short'))
    ) {
      return { ok: false, reason: 'mismatch' };
    }
  }

  if (useBotAction(botKey).isBusy(action)) {
    useToaster().push({
      kind: 'verify',
      title: t('result.inProgressTitle'),
      body: t('result.inProgressBody'),
    });
    return { ok: false, reason: 'busy' };
  }

  const req: ActionRequest = { botKey, action, context: { ...context, position } };
  current.value = req;
  last = req;
  return { ok: true };
}

/**
 * Say why a request opened nothing. A busy request already toasts by itself and an open dialog is
 * visible, so only the other refusals are reported; without this a refused click is silent.
 */
export function toastRefusal(r: RequestResult): void {
  if (r.ok || r.reason === 'busy' || r.reason === 'dialog_open') return;
  useToaster().push({
    kind: 'err',
    title: t('result.notSent'),
    body: t(`act.disabled.${r.disabled ?? 'target'}`),
  });
}

export function useActionDialog() {
  return {
    current,
    request: requestAction,
    close(): void {
      current.value = null;
    },
    /** "Retry" of a refused or unauthorised action: a new confirmation, never a replay. */
    retryLast(): RequestResult {
      if (!last) return { ok: false, reason: 'missing_state' };
      return requestAction(last.botKey, last.action, last.context);
    },
  };
}

/** Test helper: forget the open dialog and the last request (module state). */
export function resetActionDialog(): void {
  current.value = null;
  last = null;
}
