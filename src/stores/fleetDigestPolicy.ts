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
 *
 * It also owns the JOIN between the UI's bots and the snapshot's entries — see
 * `fleetDigestKeyFor`, and the chicken-and-egg it exists to break.
 */
import { botApiPort } from './botApiPort';
import { reportedBotName } from './botNameRegistry';

interface PublishedDigest {
  age_s: number;
  /** The port the daemon's registry says this bot serves its API on. Absent when unknown. */
  api_port?: number;
}

let digests: Record<string, PublishedDigest> = {};
let usable = false;
/** Wall-clock ms at which the ages above were measured. */
let publishedAt = 0;
/** Snapshot key for each API port, built at publish time. Ambiguous ports are excluded. */
let keyByPort: Record<number, string> = {};

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
  keyByPort = buildPortIndex(next);
}

/**
 * Snapshot key for each API port.
 *
 * A port claimed by two entries is dropped from the index entirely rather than resolved to
 * one of them: this index decides which digest's money is shown against which bot, and a
 * wrong answer there is worse than no answer. It can happen legitimately — two bots on the
 * same port behind different hosts — and the name join below still covers that case.
 */
export function buildPortIndex(
  next: Record<string, { api_port?: number }>,
): Record<number, string> {
  const index: Record<number, string> = {};
  const ambiguous = new Set<number>();
  for (const [key, d] of Object.entries(next)) {
    const port = d.api_port;
    if (!port) continue; // absent, or a 0 from an older daemon: never match on it
    if (port in index) {
      ambiguous.add(port);
      continue;
    }
    index[port] = key;
  }
  for (const port of ambiguous) delete index[port];
  return index;
}

/**
 * The snapshot key holding this bot's digest, or undefined when we cannot join it safely.
 *
 * Order matters, and it is the whole point of this function:
 *
 * 1. **By API port.** The browser knows every bot's port from its stored login URL, before
 *    it has spoken to a single bot. The daemon publishes the port each bot registered with.
 *    So the join works on the FIRST tick of a cold load — which is what the snapshot needs
 *    to be able to displace the startup fan-out at all.
 * 2. **By reported `bot_name`.** The snapshot is keyed by it, but the UI only learns it from
 *    `/show_config` — a per-bot request. `botNameRegistry` remembers it across sessions, so
 *    this covers returning visitors, and bots whose port the daemon does not publish (an
 *    older daemon, or a bot with no API server).
 * 3. **Nothing.** The caller must then poll that bot itself, which is the pre-snapshot
 *    behaviour and always correct, just more expensive.
 *
 * Never joins on the sub-store's `botName` getter: it falls back to the literal `'freqtrade'`
 * before `/show_config` answers, which would attribute one bot's money to another.
 */
export function fleetDigestKeyFor(botId: string): string | undefined {
  if (!botId) return undefined;
  const port = botApiPort(botId);
  if (port) {
    const key = keyByPort[port];
    if (key) return key;
  }
  const reported = reportedBotName(botId);
  return reported && reported in digests ? reported : undefined;
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

/** Effective age of the digest joined to this bot, whichever way it was joined. */
export function fleetDigestAgeForBot(botId: string): number | undefined {
  return fleetDigestAgeFor(fleetDigestKeyFor(botId));
}

/**
 * True when the snapshot can stand in for this bot's own polling this tick.
 * Takes a UI `botId` and does the join itself — see `fleetDigestKeyFor`.
 */
export function fleetDigestCoversBot(botId: string): boolean {
  return fleetDigestCovers(fleetDigestKeyFor(botId));
}

/** True when a snapshot has been published and is currently usable. */
export function fleetDigestsUsable(): boolean {
  return usable;
}
