import type { BotDescriptor } from '@/types';

export type BotSortMode = 'manual' | 'name' | 'oldest' | 'newest' | 'status' | 'mode';

export const BOT_SORT_MODES: BotSortMode[] = [
  'manual',
  'name',
  'oldest',
  'newest',
  'status',
  'mode',
];

/**
 * Sorting logic for the "Available bots" list.
 * - manual: user-defined order (drag handle), persisted via sortId
 * - name:   alphabetical by display name
 * - oldest / newest: by date added to FreqUI (createdAt). Bots added before this
 *   field existed have no createdAt and fall back to their sortId — since they
 *   genuinely predate the others, sorting them as the "oldest" stays intuitive.
 * - status: online first, then starting, then offline
 * - mode:   live first, then dry, then offline
 */
export function useBotListSort() {
  const botStore = useBotStore();
  const sortMode = useStorage<BotSortMode>('ftBotListSort', 'manual');

  function createdKey(b: BotDescriptor): number {
    return b.createdAt ?? b.sortId ?? 0;
  }

  function statusRank(botId: string): number {
    const sub = botStore.botStores[botId];
    if (sub?.isBotStarting) return 1;
    if (sub?.isBotOnline) return 0;
    return 2;
  }

  function modeRank(botId: string): number {
    const sub = botStore.botStores[botId];
    if (!sub?.isBotOnline) return 2;
    return botStore.allBotState[botId]?.dry_run ? 1 : 0; // live first
  }

  function bySortId(a: BotDescriptor, b: BotDescriptor): number {
    return (a.sortId ?? 0) - (b.sortId ?? 0);
  }

  function sortBots(bots: BotDescriptor[]): BotDescriptor[] {
    const arr = [...bots];
    switch (sortMode.value) {
      case 'name':
        return arr.sort((a, b) => (a.botName || a.botId).localeCompare(b.botName || b.botId));
      case 'oldest':
        return arr.sort((a, b) => createdKey(a) - createdKey(b) || bySortId(a, b));
      case 'newest':
        return arr.sort((a, b) => createdKey(b) - createdKey(a) || bySortId(a, b));
      case 'status':
        return arr.sort((a, b) => statusRank(a.botId) - statusRank(b.botId) || bySortId(a, b));
      case 'mode':
        return arr.sort((a, b) => modeRank(a.botId) - modeRank(b.botId) || bySortId(a, b));
      case 'manual':
      default:
        return arr.sort(bySortId);
    }
  }

  const isManualSort = computed(() => sortMode.value === 'manual');

  return { sortMode, sortBots, isManualSort };
}
