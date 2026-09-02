/**
 * The API port a bot is reached on, taken from the URL the user entered when adding it.
 *
 * This is the one identifier the browser holds about a bot BEFORE talking to it: it lives in
 * the stored login info, so it is available on the very first tick of a cold page load. The
 * bot's own `bot_name`, by contrast, is only learned from `/show_config` — a per-bot request,
 * which is exactly what the fleet snapshot exists to avoid making.
 *
 * See `fleetDigestPolicy` for what that buys: joining the snapshot by port instead of by
 * reported name is what lets the decimation apply from the first cycle rather than the second
 * page load.
 */
import { loggedInBots } from '@/composables/loginInfo';

/**
 * Port number in an API base URL, or undefined when it has none.
 *
 * Undefined rather than a default (80/443): this value is used to MATCH a bot against a
 * digest, and inventing a port would let two different bots claim the same one. Absent beats
 * wrong, as everywhere else in this join.
 */
export function apiPortFromUrl(url: string | undefined | null): number | undefined {
  if (!url) return undefined;
  try {
    const port = new URL(url).port;
    if (!port) return undefined;
    const n = parseInt(port, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    // A relative URL (the bot serving the UI itself) or a malformed one: no port to read.
    return undefined;
  }
}

/** The API port stored for this bot, or undefined when unknown. */
export function botApiPort(botId: string): number | undefined {
  return apiPortFromUrl(loggedInBots.value[botId]?.botUrl);
}
