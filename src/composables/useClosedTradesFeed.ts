/**
 * Declare that this component needs the closed-trade history of every selected bot.
 *
 * Only three widgets genuinely need per-trade identity (the closed-trade table, the activity
 * timeline, the trade journal); the charts need reductions over the same rows. Either way the
 * data has to be downloaded, and it is the single heaviest thing the dashboard fetches — so
 * it is fetched on demand instead of unconditionally for the whole fleet at startup.
 *
 * Because dashboard widgets are viewport-lazy, mounting follows what the user is looking at:
 * scroll every trade-hungry widget off screen and the fleet-wide `/trades` sweep stops by
 * itself. Nothing degrades silently — a widget that is mounted always has its data.
 *
 * Call it once at the top level of `setup()`.
 */
import { onMounted, onUnmounted } from 'vue';
import { useBotStore } from '@/stores/ftbotwrapper';

export function useClosedTradesFeed() {
  const botStore = useBotStore();
  onMounted(() => botStore.requestClosedTrades());
  onUnmounted(() => botStore.releaseClosedTrades());
}
