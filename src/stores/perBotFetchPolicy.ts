/**
 * Which per-bot endpoints are worth polling for a bot the user is not looking at.
 *
 * Same idea as `closedTradesPolicy`, applied to the endpoints whose only consumers turned
 * out to be single-bot views. Measured on a 45-bot fleet over a 4 min 43 s browser capture:
 *
 * | endpoint    | requests | read by                                          |
 * |-------------|----------|--------------------------------------------------|
 * | `/locks`    |     1298 | `TradingView` + `PairLockList`, via `activeBot`   |
 * | `/blacklist`|      188 | `PairListLive`, via `activeBot`                   |
 * | `/whitelist`|      188 | `PairListLive` (active) + `PairlistInfoCard` (hover) |
 *
 * `/locks` alone was a quarter of every API call the dashboard made, and not one of them
 * reached a pixel: no multi-bot widget reads lock state. It was polled for all 45 bots every
 * 10 s because it sat in `refreshFrequent` next to `/status`, which the dashboard genuinely
 * needs.
 *
 * So the rule is the same as for closed trades: the active bot always gets its data, and any
 * other bot gets it only while a mounted component says it needs the whole fleet. Nothing is
 * cached longer, nothing is guessed, and a fleet of two bots without the daemon behaves
 * exactly as before.
 *
 * `/whitelist` keeps one extra route: `PairlistInfoCard` opens on hover over an arbitrary row
 * of the comparison list, so it fetches its own bot's pairlist on mount. That is one request
 * when the user asks for it, against 188 fired at bots nobody hovered.
 */
import { ref } from 'vue';

// The bot on screen. Shared with closedTradesPolicy rather than tracked twice: there is
// exactly one active bot and two sources of truth for it would drift.
import { activeBotIdForTrades as activeBotId } from './closedTradesPolicy';

/** Mounted components that need every selected bot's lock state. */
export const locksDemand = ref(0);

/** Mounted components that need every selected bot's pairlist. */
export const pairlistDemand = ref(0);

/** Whether `/locks` should be polled for this bot. */
export function locksWanted(botId: string): boolean {
  return locksDemand.value > 0 || activeBotId.value === botId;
}

/** Whether `/whitelist` and `/blacklist` should be refreshed for this bot. */
export function pairlistWanted(botId: string): boolean {
  return pairlistDemand.value > 0 || activeBotId.value === botId;
}
