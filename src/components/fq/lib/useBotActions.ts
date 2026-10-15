import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { useI18n } from 'vue-i18n';

import type { MenuItem } from '@/components/ds/types';
import { requestAction, type RequestResult } from '@/composables/useActionDialog';
import { lockKeyOf, useBotAction } from '@/composables/useBotAction';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import type { BotKey, Position } from '@/gateway/types.gen';

import {
  ACTIONS,
  buildAction,
  disabledReasonFor,
  type ActionId,
  type DisabledReason,
} from './actions';
import { botState } from './bots';

/**
 * What every action surface needs (row, header, drawer, palette): the list of actions of a bot
 * for a position, why they are disabled, whether one is in flight, and the single way to trigger
 * one. The surfaces differ only in layout; they all end in `requestAction`, then `useBotAction`.
 */
export function useBotActions(
  botKey: MaybeRefOrGetter<BotKey>,
  position: MaybeRefOrGetter<
    Pick<Position, 'trade_id' | 'pair' | 'side' | 'orphan' | 'bot_key'> | null | undefined
  > = null,
) {
  const { t } = useI18n();
  const fleet = useFqFleetStore();
  const conn = useFqConnectionStore();
  const actions = useBotAction(botKey);

  const bot = computed(() => fleet.bots[toValue(botKey)] ?? null);
  const state = computed(() =>
    bot.value ? botState(bot.value, Date.now(), conn.status.clockSkewMs) : null,
  );

  const reason = computed<DisabledReason | null>(() =>
    disabledReasonFor(
      state.value,
      { connection: conn.status.state, fromCache: conn.fromCache },
      { orphan: toValue(position)?.orphan === true },
    ),
  );
  const reasonText = computed(() =>
    reason.value ? t(`fq.act.disabled.${reason.value}`) : undefined,
  );

  function actionOf(id: ActionId, pair?: string) {
    return buildAction(id, { position: toValue(position), pair });
  }

  /** In-flight lock key of an action id, or undefined for navigation. */
  function lockKey(id: ActionId): string | undefined {
    const a = actionOf(id);
    return a ? lockKeyOf(toValue(botKey), a) : undefined;
  }

  function busy(id: ActionId): boolean {
    const a = actionOf(id);
    return a ? actions.isBusy(a) : false;
  }

  /** Whether the id is available: a mutation needs a bot that answers and a valid target. */
  function disabled(id: ActionId): boolean {
    if (!ACTIONS[id].mutation) return false;
    if (reason.value) return true;
    return actionOf(id) === null;
  }

  /**
   * Open the confirmation of a mutation. Returns what `requestAction` decided; a navigation id
   * returns null and the caller handles it.
   */
  function trigger(
    id: ActionId,
    opts: { fraction?: number; pair?: string } = {},
  ): RequestResult | null {
    if (!ACTIONS[id].mutation) return null;
    const action = actionOf(id, opts.pair);
    if (!action) return { ok: false, reason: 'missing_state' };
    return requestAction(toValue(botKey), action, {
      position: toValue(position) as Position | null | undefined,
      initialFraction: opts.fraction,
    });
  }

  function menuItem(id: ActionId): MenuItem {
    const def = ACTIONS[id];
    const off = disabled(id);
    return {
      id,
      label: t(`fq.act.${def.label}`),
      icon: def.icon,
      shortcut: def.shortcut,
      danger: def.danger,
      disabled: off || busy(id),
      disabledReason: off
        ? (reasonText.value ?? t('fq.act.disabled.target'))
        : t('fq.result.inProgressTitle'),
    };
  }

  return { bot, state, reason, reasonText, lockKey, busy, disabled, trigger, menuItem, t };
}
