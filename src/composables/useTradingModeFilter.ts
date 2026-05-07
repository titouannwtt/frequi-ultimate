import type { Trade, ClosedTrade } from '@/types';

export type TradingModeFilter = 'all' | 'live' | 'dry';

export function useTradingModeFilter() {
  const botStore = useBotStore();
  const tradingMode = ref<TradingModeFilter>('all');

  const hasMultipleModes = computed(() => {
    let hasLive = false;
    let hasDry = false;
    for (const [botId, store] of Object.entries(botStore.botStores)) {
      if (!store.isSelected) continue;
      if (botStore.allBotState[botId]?.dry_run) hasDry = true;
      else if (store.isBotOnline) hasLive = true;
      if (hasLive && hasDry) return true;
    }
    return false;
  });

  function isBotInMode(botId: string): boolean {
    if (tradingMode.value === 'all') return true;
    const isDry = !!botStore.allBotState[botId]?.dry_run;
    return tradingMode.value === 'dry' ? isDry : !isDry;
  }

  function filterTradesByMode<T extends Trade | ClosedTrade>(trades: T[]): T[] {
    if (tradingMode.value === 'all') return trades;
    return trades.filter((t) => isBotInMode(t.botId));
  }

  return { tradingMode, hasMultipleModes, isBotInMode, filterTradesByMode };
}
