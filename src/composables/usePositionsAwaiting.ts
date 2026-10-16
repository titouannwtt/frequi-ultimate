import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import type { BotKey, BotRow } from '@/gateway/types.gen';

/**
 * Bots that announce more open positions than the app has read from them yet. In direct mode each
 * bot is read in turn, so for a while the header says "43 positions" (the count the bot reports)
 * while the table lists the 22 read so far: both are true, and the page must say which is which
 * instead of showing a table that looks complete (or "no open position" for a bot that has some).
 * Only a bot that is up (online or starting) counts: an offline one has nothing to wait for.
 */
export function usePositionsAwaiting(keys: MaybeRefOrGetter<readonly BotKey[]>) {
  const fleet = useFqFleetStore();
  const positions = useFqPositionsStore();

  const bots = computed<BotRow[]>(() => {
    const read = new Map<BotKey, number>();
    for (const p of positions.list) {
      if (!p.orphan) read.set(p.bot_key, (read.get(p.bot_key) ?? 0) + 1);
    }
    const out: BotRow[] = [];
    for (const key of toValue(keys)) {
      const bot = fleet.bots[key];
      if (!bot || (bot.state.status !== 'online' && bot.state.status !== 'starting')) continue;
      if (bot.state.open_trades > (read.get(key) ?? 0)) out.push(bot);
    }
    return out;
  });
  /** Positions announced and not read yet. */
  const missing = computed(() => {
    const read = new Map<BotKey, number>();
    for (const p of positions.list) {
      if (!p.orphan) read.set(p.bot_key, (read.get(p.bot_key) ?? 0) + 1);
    }
    return bots.value.reduce(
      (n, b) => n + Math.max(0, b.state.open_trades - (read.get(b.bot_key) ?? 0)),
      0,
    );
  });
  return { bots, missing };
}
