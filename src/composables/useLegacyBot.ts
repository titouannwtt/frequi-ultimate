import { watch, type MaybeRefOrGetter, toValue } from 'vue';

import type { BotKey } from '@/gateway/types.gen';

import { useDataSource } from './useDataSource';

/**
 * Makes the bot chosen in the redesigned shell the active bot of the legacy stores, for the tool
 * pages that still run on them (Diagnostic timeline, Volume, Replay). The legacy store knows bots
 * by their `ftbot.N` id, which the registry maps to the canonical key. Nothing happens for a bot
 * the legacy store does not know (it was added in this tab, or the mapping is missing).
 */
export function useLegacyBot(botKey: MaybeRefOrGetter<BotKey | null>) {
  const data = useDataSource();
  const botStore = useBotStore();

  watch(
    [() => toValue(botKey), () => data.source.value],
    ([key, source]) => {
      if (!key || !source) return;
      const uiId = source.registry.uiIdOf(key);
      if (uiId && uiId in botStore.botStores && botStore.selectedBot !== uiId) {
        botStore.selectBot(uiId);
      }
    },
    { immediate: true },
  );
}
