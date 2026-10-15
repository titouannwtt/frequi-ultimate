/**
 * Resolve the bot that must receive a trade action.
 *
 * Multi-bot views show trades from many bots; trade ids are only unique per bot,
 * so an action must go to the bot owning the trade, never to whichever bot is active.
 */
export function resolveTargetBot<T>(
  botStores: Record<string, T>,
  botId: string | undefined,
  activeBot: T,
): T {
  if (botId && botStores[botId]) {
    return botStores[botId];
  }
  return activeBot;
}
