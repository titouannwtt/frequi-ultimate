import { useRouter } from 'vue-router';

import type { ActionId } from '@/components/fq/lib/actions';
import type { AlertActionId } from '@/components/fq/lib/alerts';
import type { Alert, BotKey } from '@/gateway/types.gen';
import { TOOL_PATHS } from '@/router/legacy';

import { useShellBus } from './useShellBus';

export interface ActionNavContext {
  botKey: BotKey;
  pair?: string | null;
  tradeId?: number | null;
}

/**
 * Where the actions that do not mutate anything lead (02 sections 3.1 and 3.2): the trade, the
 * chart, the config, the reconciliation preview, the logs, the diagnostic. Mutations never come
 * through here: they open their confirmation (`requestAction`), from whichever surface.
 */
export function useActionNav() {
  const router = useRouter();
  const bus = useShellBus();

  function openBot(botKey: BotKey, query: Record<string, string> = {}) {
    void router.push({ name: 'bot', params: { botKey }, query });
  }

  function navigateAction(id: ActionId, ctx: ActionNavContext) {
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
