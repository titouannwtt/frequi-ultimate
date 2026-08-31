/**
 * Who is allowed to pull `/trades` — and therefore how big the dashboard's network fan-out is.
 *
 * Closed-trade history is by far the heaviest thing the UI downloads: paginated at 500 rows a
 * page, unbounded, and multiplied by the number of bots. On a 45-bot fleet that is roughly
 * 180 000 trade objects and 11 MB of JSON pulled at startup, for widgets that may not even be
 * on screen.
 *
 * The fix is not to cache harder, it is to stop asking. Two things want this history:
 *
 * - **The bot you are actually looking at.** Single-bot views (trading, charts, mobile trade
 *   list) read `activeBot.trades` directly and must never be starved, so the active bot is
 *   always allowed. That is one bot, not forty-five.
 * - **A mounted multi-bot widget.** Those declare themselves through `useClosedTradesFeed()`,
 *   which bumps `closedTradesDemand`. Since dashboard widgets are viewport-lazy, the demand
 *   naturally follows what the user is looking at: scroll the trade widgets off screen and the
 *   fleet-wide download stops.
 *
 * Deliberately module-level rather than store state: both the per-bot sub-stores and the
 * wrapper must read the same counter, and threading it through 45 store instances would be
 * ceremony for a single integer.
 */
import { ref } from 'vue';

/** Number of currently-mounted components that need every selected bot's closed history. */
export const closedTradesDemand = ref(0);

/** The bot the user is looking at; always allowed to load its own history. */
export const activeBotIdForTrades = ref('');

/** Whether `/trades` should be pulled for this bot on the next slow refresh. */
export function closedTradesWanted(botId: string): boolean {
  return closedTradesDemand.value > 0 || activeBotIdForTrades.value === botId;
}
