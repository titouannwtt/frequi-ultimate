/**
 * Fleet-wide digests from a single request.
 *
 * The dashboard's cost grows with the fleet because every datum is polled per bot: 50 bots
 * × M endpoints. `GET /fleet/snapshot` returns all of them at once, served from the shared
 * daemon out of digests the bots pushed on their own cycles — so the work was already paid
 * for, and it happens outside any request handler.
 *
 * Three things this composable is careful about:
 *
 * **It asks one bot, not all of them.** Any bot can answer for the fleet, so querying more
 * than one would reintroduce the fan-out this exists to remove. It prefers the active bot
 * and falls back to any online one.
 *
 * **It degrades instead of failing.** An older bot answers 404, a fleet without the daemon
 * answers `{error}`. Either way `available` goes false and callers keep using whatever they
 * used before. Nothing here is load-bearing.
 *
 * **It never presents a stale figure as current.** Each digest carries its own `age_s`, and
 * `digestFor()` refuses to return one older than `maxAgeS`. A caller that wants to know
 * anyway can read `digests` directly — but it then has the age in hand.
 *
 * Module-level state on purpose: several widgets want the same snapshot, and giving each its
 * own poller is exactly the mistake `/rate_metrics` had been making four times over.
 */
import type { FleetBotDigest, FleetSnapshotResponse } from '@/types/fleetSnapshot';
import { computed, ref } from 'vue';

import { useVisibleInterval } from '@/composables/useVisibleInterval';
import { useBotStore } from '@/stores/ftbotwrapper';

const digests = ref<Record<string, FleetBotDigest>>({});
const available = ref<boolean | null>(null); // null = not tried yet
const lastError = ref<string>('');
const lastFetchTs = ref(0);
const snapshotTs = ref(0);

let consumers = 0;
let handle: { stop: () => void } | null = null;
let inFlight: Promise<void> | null = null;

/** Consecutive failures before we stop retrying on every tick. */
const GIVE_UP_AFTER = 3;
let failures = 0;

async function fetchSnapshot(): Promise<void> {
  if (inFlight) return inFlight;
  const botStore = useBotStore();
  // One bot answers for the whole fleet; asking several would rebuild the fan-out.
  const candidate =
    botStore.activeBot?.isBotOnline === true
      ? botStore.activeBot
      : botStore.allBotStores.find((b) => b.isBotOnline);
  if (!candidate) {
    return;
  }
  inFlight = (async () => {
    try {
      const data: FleetSnapshotResponse = await candidate.getFleetSnapshot();
      if (data.error || !data.bots) {
        available.value = false;
        lastError.value = data.error ?? 'no bots in snapshot';
        failures += 1;
        return;
      }
      digests.value = data.bots;
      snapshotTs.value = data.ts ?? Date.now() / 1000;
      lastFetchTs.value = Date.now();
      available.value = true;
      lastError.value = '';
      failures = 0;
    } catch (err) {
      // A 404 means this bot predates the endpoint — a normal state in a fleet that is
      // being rolled over, not an error worth surfacing to the user.
      available.value = false;
      lastError.value = err instanceof Error ? err.message : String(err);
      failures += 1;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function useFleetSnapshot(refreshMs = 10_000) {
  consumers += 1;
  if (!handle) {
    handle = useVisibleInterval(
      () => {
        // Once the endpoint has clearly answered "not here", stop asking every tick; retry
        // occasionally so a rolling deploy is picked up without a page reload.
        if (available.value === false && failures >= GIVE_UP_AFTER) {
          if (failures % 30 !== 0) {
            failures += 1;
            return;
          }
        }
        void fetchSnapshot();
      },
      refreshMs,
      { immediate: true },
    );
  }

  const release = () => {
    consumers -= 1;
    if (consumers <= 0 && handle) {
      handle.stop();
      handle = null;
      consumers = 0;
    }
  };

  /**
   * The digest for a bot, by its bot_name, only if fresh enough.
   * Returns undefined rather than a stale figure — the caller's fallback is authoritative
   * per-bot data, which is always preferable to an old aggregate.
   */
  const digestFor = (botName: string, maxAgeS = 60): FleetBotDigest | undefined => {
    const d = digests.value[botName];
    if (!d) return undefined;
    return d.age_s <= maxAgeS ? d : undefined;
  };

  return {
    digests: computed(() => digests.value),
    /** null while untried, true when the fleet answers, false when we must fall back. */
    available: computed(() => available.value),
    lastError: computed(() => lastError.value),
    /** Seconds since this client last got a snapshot; 0 when never. */
    secondsSinceFetch: computed(() =>
      lastFetchTs.value ? Math.round((Date.now() - lastFetchTs.value) / 1000) : 0,
    ),
    botCount: computed(() => Object.keys(digests.value).length),
    digestFor,
    refresh: fetchSnapshot,
    release,
  };
}
