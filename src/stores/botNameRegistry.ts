/**
 * Remembers each bot's own `bot_name`, so the fleet snapshot can be joined to the bot list.
 *
 * `GET /fleet/snapshot` is keyed by the bot's configured `bot_name`. The UI, on the other
 * hand, knows bots by the local `botId` the user created when adding a login. The only place
 * the two meet is `/show_config`, which is a per-bot request — so on a fresh page load the
 * snapshot arrives first and cannot be attached to anything.
 *
 * Worse, the sub-store's `botName` getter falls back to the literal `'freqtrade'` when
 * `/show_config` has not answered. Joining on that would map most of the fleet onto whichever
 * digest happens to be called `freqtrade`, and attribute one bot's money to another. So the
 * join must never use the fallback: it uses only a name a bot actually reported, whether that
 * was this session or a previous one.
 *
 * Hence this tiny registry. It is a cache of identifiers, not of figures: nothing here is
 * ever displayed. A wrong entry can only mean a row is filled from the wrong digest, so it is
 * written solely from `/show_config` responses and dropped when a bot is removed.
 */

const STORAGE_KEY = 'ftBotNames';

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

let cache: Record<string, string> | null = null;

function all(): Record<string, string> {
  if (!cache) cache = load();
  return cache;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all()));
  } catch {
    // Private browsing or a full quota. The join just falls back to this session only.
  }
}

/** Record the `bot_name` a bot reported through /show_config. */
export function rememberBotName(botId: string, botName: string | undefined) {
  if (!botId || !botName) return;
  if (all()[botId] === botName) return;
  all()[botId] = botName;
  persist();
}

/**
 * The `bot_name` this bot reported, this session or a previous one.
 * Undefined when it has never reported one — the caller must then not guess.
 */
export function reportedBotName(botId: string): string | undefined {
  return all()[botId];
}

/** Forget a bot that was removed from the UI. */
export function forgetBotName(botId: string) {
  if (!(botId in all())) return;
  delete all()[botId];
  persist();
}
