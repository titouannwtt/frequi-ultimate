import { useRouter } from 'vue-router';

import { ACTIONS, buildAction, type ActionId } from '@/components/fq/lib/actions';
import type { AlertActionId } from '@/components/fq/lib/alerts';
import type { Alert, BotKey } from '@/gateway/types.gen';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import { TOOL_PATHS } from '@/router/legacy';

import { requestAction, toastRefusal } from './useActionDialog';

import { useShellBus } from './useShellBus';

export interface ActionNavContext {
  botKey: BotKey;
  pair?: string | null;
  tradeId?: number | null;
}

/**
 * Where the actions that do not mutate anything lead (02 sections 3.1 and 3.2): the trade, the
 * chart, the config, the reconciliation preview, the logs, the diagnostic. A mutation (the `X`
 * shortcut of a selected row) is never performed here: it only opens its confirmation
 * (`requestAction`), exactly as the row button would, for the bot and the trade of the line.
 */
export function useActionNav() {
  const router = useRouter();
  const bus = useShellBus();
  const positions = useFqPositionsStore();

  function openBot(botKey: BotKey, query: Record<string, string> = {}) {
    void router.push({ name: 'bot', params: { botKey }, query });
  }

  /** A keyboard path to a mutation: the same checks and the same dialog as the row button. */
  function mutate(id: ActionId, ctx: ActionNavContext) {
    const position = ctx.tradeId != null ? (positions.get(ctx.botKey, ctx.tradeId) ?? null) : null;
    const action = buildAction(id, { position, pair: ctx.pair ?? undefined });
    // No position to act on (closed since, or an orphan): nothing opens, and it is said
    if (!action) {
      toastRefusal({ ok: false, reason: 'missing_state' });
      return;
    }
    toastRefusal(requestAction(ctx.botKey, action, { position }));
  }

  function navigateAction(id: ActionId, ctx: ActionNavContext) {
    if (ACTIONS[id].mutation) {
      mutate(id, ctx);
      return;
    }
    switch (id) {
      case 'openTrade':
        openBot(ctx.botKey, ctx.tradeId != null ? { trade: String(ctx.tradeId) } : {});
        break;
      case 'config':
        openBot(ctx.botKey, { tab: 'config' });
        break;
      case 'chart':
        void router.push({
          path: '/charts',
          query: { bot: ctx.botKey, ...(ctx.pair ? { pair: ctx.pair } : {}) },
        });
        break;
      case 'replay':
        void router.push({ path: TOOL_PATHS.replay, query: { bot: ctx.botKey } });
        break;
      case 'reconcile':
        void router.push({
          path: TOOL_PATHS.reconciliation,
          query: ctx.pair ? { pair: ctx.pair } : {},
        });
        break;
      default:
        break;
    }
  }

  function alertAction(id: AlertActionId, alert: Alert) {
    const botKey = alert.bot_key;
    switch (id) {
      case 'open': {
        if (botKey) {
          const tradeId =
            alert.subject !== null && /^\d+$/.test(alert.subject) ? alert.subject : null;
          openBot(botKey, tradeId ? { trade: tradeId } : {});
        }
        break;
      }
      case 'logs':
        bus.logsBot.value = botKey;
        bus.logsOpen.value = true;
        break;
      case 'reconcile':
        void router.push({
          path: TOOL_PATHS.reconciliation,
          query: alert.subject ? { pair: alert.subject } : {},
        });
        break;
      case 'diagnostic':
        bus.healthOpen.value = true;
        break;
      case 'reconnect':
        void router.push({ name: 'login' });
        break;
      default:
        break;
    }
  }

  return { openBot, navigateAction, alertAction };
}
