import type { Trade, ClosedTrade } from '@/types';

export type TradingModeFilter = 'all' | 'live' | 'dry';

/**
 * @param persistKey When provided, the selected mode is auto-persisted to
 *   localStorage under a widget-specific key and restored on page reload —
 *   the user's last choice survives dashboard refreshes.
 * @param defaultMode Initial mode when nothing was persisted yet.
 */
export function useTradingModeFilter(persistKey?: string, defaultMode: TradingModeFilter = 'all') {
  const botStore = useBotStore();
  const storageKey = persistKey ? `ftTradingModeFilter-${persistKey}` : undefined;
  const readStored = (): TradingModeFilter => {
    if (storageKey) {
      try {
        const v = localStorage.getItem(storageKey);
        if (v === 'all' || v === 'live' || v === 'dry') return v;
      } catch {
        // localStorage unavailable — fall through to default
      }
    }
    return defaultMode;
  };
  const tradingMode = ref<TradingModeFilter>(readStored());
  if (storageKey) {
    watch(tradingMode, (v) => {
      try {
        localStorage.setItem(storageKey, v);
      } catch {
        // ignore quota/unavailable errors
      }
    });
  }
  /** Re-apply the persisted value — call after any defaults-loader that may
   *  have overridden it, so the user's LAST choice always wins on reload. */
  function restorePersistedTradingMode() {
    tradingMode.value = readStored();
  }

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

  return {
    tradingMode,
    hasMultipleModes,
    isBotInMode,
    filterTradesByMode,
    restorePersistedTradingMode,
  };
}
