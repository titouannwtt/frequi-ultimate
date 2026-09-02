/**
 * Fleet-wide profit-history series from a single request.
 *
 * Two widgets (the benchmark chart and the drawdown card) each pull `/profit_history` for
 * every bot they draw. That endpoint ships a bot's whole sampled ledger, so on a 45-bot
 * fleet the pair of them accounted for 8.4 MB of the dashboard's traffic, re-fetched
 * whenever the bot selection moved.
 *
 * `GET /fleetview/profit_history` answers for every local bot at once, decimated
 * server-side. This composable is the single place that calls it, and it is careful about
 * the same three things `useFleetSnapshot` is:
 *
 * **It asks one bot, not all of them.** Any bot on the host reads the same ledgers, so
 * querying several would rebuild the fan-out this exists to remove.
 *
 * **It degrades per bot, not globally.** The aggregate answers by `bot_name`; a UI botId
 * that has not yet learnt its reported name, or a bot the host does not know (a remote bot
 * added by URL), simply falls back to its own `/profit_history`. A 404 on the aggregate
 * puts every bot on the fallback path, which is exactly the pre-existing behaviour.
 *
 * **It does not invent a series.** A bot in the response's `errors` map, or one whose
 * ledger is empty, yields no entry at all. The callers already treat a missing series as
 * "fall back to the projected curve", which is the honest outcome.
 *
 * Module-level cache on purpose: both widgets want the same payload, usually within the
 * same tick, and the whole point is that it is fetched once.
 */
import type { FleetProfitHistoryResponse, ProfitHistoryPoints } from '@/types/fleetProfitHistory';

import { computed, ref } from 'vue';

import { reportedBotName } from '@/stores/botNameRegistry';
import { useBotStore } from '@/stores/ftbotwrapper';

/** How long an aggregate answer is reused. Matches the per-bot cache in `getProfitHistory`. */
const CACHE_TTL_MS = 60_000;

const byBotName = ref<Record<string, ProfitHistoryPoints>>({});
const available = ref<boolean | null>(null); // null = not tried yet
const fetchedAt = ref(0);
let inFlight: Promise<void> | null = null;

async function fetchFleet(force: boolean): Promise<void> {
  if (!force && fetchedAt.value && Date.now() - fetchedAt.value < CACHE_TTL_MS) return;
  if (inFlight) return inFlight;
  const botStore = useBotStore();
  const candidate =
    botStore.activeBot?.isBotOnline === true
      ? botStore.activeBot
      : botStore.allBotStores.find((b) => b.isBotOnline);
  if (!candidate) return;
  inFlight = (async () => {
    try {
      const data: FleetProfitHistoryResponse = await candidate.getFleetProfitHistory();
      if (!data?.bots) {
        available.value = false;
        return;
      }
      const next: Record<string, ProfitHistoryPoints> = {};
      for (const bot of data.bots) {
        // An empty series is not a series: leaving the key out sends the caller down its
        // own fallback instead of drawing a flat line at zero.
        if (bot.data?.length) next[bot.bot_name] = bot.data;
      }
      byBotName.value = next;
      fetchedAt.value = Date.now();
      available.value = true;
    } catch {
      // 404 on a bot that predates the endpoint, or a fleet without the daemon. Not an
      // error worth surfacing: every caller has a working per-bot path.
      available.value = false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function useFleetProfitHistory() {
  /**
   * Series for each of `botIds`, keyed by botId.
   *
   * Tries the fleet aggregate first, then fills whatever it could not cover with per-bot
   * requests. On a fleet where the aggregate works this is one request instead of N; where
   * it does not, it is the N requests that were being made anyway.
   */
  const loadHistories = async (botIds: string[]): Promise<Record<string, ProfitHistoryPoints>> => {
    const botStore = useBotStore();
    const res: Record<string, ProfitHistoryPoints> = {};
    await fetchFleet(false);

    const missing: string[] = [];
    for (const id of botIds) {
      const reported = available.value ? reportedBotName(id) : undefined;
      const points = reported ? byBotName.value[reported] : undefined;
      if (points) {
        res[id] = points;
      } else if (!available.value || !reported) {
        // Either the aggregate is unusable, or we cannot join this bot to it by name.
        // A bot the aggregate *does* cover but which has no samples is deliberately NOT
        // retried per-bot: its own endpoint would return the same emptiness.
        missing.push(id);
      }
    }

    await Promise.all(
      missing.map(async (id) => {
        const h = await botStore.botStores[id]?.getProfitHistory?.();
        if (h?.data?.length) res[id] = h.data;
      }),
    );
    return res;
  };

  return {
    loadHistories,
    /** null while untried, true when the aggregate answers, false when we fall back. */
    available: computed(() => available.value),
    refresh: () => fetchFleet(true),
  };
}
