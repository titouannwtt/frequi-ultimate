/**
 * Shared "initial loading" heuristic for dashboard widgets fed by the bot stores.
 * True only during the very first load phase: bots are selected but none of them
 * has delivered its status yet. As soon as one bot responds, widgets render with
 * partial data instead of a skeleton.
 */
export function useInitialBotLoading() {
  const botStore = useBotStore();

  const initialLoading = computed(() => {
    const selected = botStore.selectedBots;
    if (selected.length === 0) return false;
    return selected.every((bot) => !bot.botStatusAvailable);
  });

  return { initialLoading };
}
