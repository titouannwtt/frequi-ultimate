/**
 * Declare that this component needs every selected bot's whitelist.
 *
 * The comparison list is the real fleet-wide consumer: its "pairs" and "market" columns are
 * derived from each bot's pairlist, and its grouping filters read the market that comes out
 * of it. So it asks, and it is served.
 *
 * The gate exists for everywhere else. Outside the dashboard nothing reads a non-active
 * bot's whitelist, and the fleet-wide sweep used to run on every slow tick regardless of
 * which view was open. Since dashboard widgets are viewport-lazy, the demand follows what is
 * on screen, exactly like `useClosedTradesFeed`.
 *
 * Call it once at the top level of `setup()`.
 */
import { onMounted, onUnmounted } from 'vue';
import { whitelistDemand } from '@/stores/perBotFetchPolicy';
import { useBotStore } from '@/stores/ftbotwrapper';

export function useWhitelistFeed() {
  const botStore = useBotStore();
  onMounted(() => {
    whitelistDemand.value += 1;
    // Fetch straight away rather than waiting for the next slow tick: a column that just
    // scrolled into view must not sit empty for a minute, and the slow refresh only runs
    // for bots something else marked dirty.
    for (const store of botStore.allBotStores) {
      if (store.isBotOnline && store.isBotLoggedIn && store.whitelist.length === 0) {
        void store.getWhitelist().catch(() => {});
      }
    }
  });
  onUnmounted(() => {
    whitelistDemand.value = Math.max(0, whitelistDemand.value - 1);
  });
}
