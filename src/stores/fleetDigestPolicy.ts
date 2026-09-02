/**
 * Where the fleet snapshot is published for non-component consumers.
 *
 * `useFleetSnapshot` owns the polling and the state, but it imports the bot store to pick a
 * bot to ask — so the bot store cannot import it back without a cycle. This module is the
 * one-way drop box in between, in the same spirit as `closedTradesPolicy` and
 * `perBotFetchPolicy`: the composable pushes what it fetched, the refresh tiers read it.
 *
 * It holds no opinion and starts nothing. With no snapshot published, every accessor says
 * "no", and the refresh tiers behave exactly as they did before the snapshot existed. That
 * is the required behaviour for a fleet without the daemon, and it is also the behaviour
 * during the first seconds after a page load.
 */

interface PublishedDigest {
  age_s: number;
}

let digests: Record<string, PublishedDigest> = {};
let usable = false;
/** Wall-clock ms at which the ages above were measured. */
let publishedAt = 0;

/**
 * How old a digest may be and still stand in for a per-bot fetch, in seconds.
 *
 * Deliberately far tighter than `FLEET_DIGEST_MAX_AGE_S` (600 s), which governs *displaying*
 * a figure that carries its age on screen. Here the digest decides whether to SKIP a
 * request, so it has to be recent enough that skipping cannot hide a bot going quiet. Bots
 * push once per bot cycle (60 s), so 150 s tolerates a missed push and no more.
 */
export const DIGEST_SUBSTITUTION_MAX_AGE_S = 150;

/** Called by `useFleetSnapshot` after every successful fetch. */
export function publishFleetDigests(next: Record<string, PublishedDigest>, isUsable: boolean) {
  digests = next;
  usable = isUsable;
  publishedAt = Date.now();
}

/**
 * Effective age of a bot's digest right now: the age at publication plus the time since.
 * Without that correction a snapshot fetched once and never refreshed would look eternally
 * fresh, which is the precise failure this whole mechanism exists to avoid.
 */
export function fleetDigestAgeFor(botName: string | undefined): number | undefined {
  if (!botName || !usable) return undefined;
  const d = digests[botName];
  if (!d) return undefined;
  return d.age_s + (Date.now() - publishedAt) / 1000;
}

/**
 * True when the snapshot can stand in for this bot's own polling this tick.
 * False for an unknown bot, a stale digest, or a fleet with no snapshot at all — in every
 * one of those cases the caller must make its own request.
 */
export function fleetDigestCovers(botName: string | undefined): boolean {
  const age = fleetDigestAgeFor(botName);
  return age !== undefined && age <= DIGEST_SUBSTITUTION_MAX_AGE_S;
}

/** True when a snapshot has been published and is currently usable. */
export function fleetDigestsUsable(): boolean {
  return usable;
}
