import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { SourceKind, SourceStatus } from '../types';

export interface SourceSwitch {
  from: SourceKind | null;
  to: SourceKind;
  /** Short machine code: `probe_failed`, `probe_ok`, `ws_lost`, `forced`, `protocol`, `auth`. */
  reason: string;
  atMs: number;
}

/**
 * Where the data comes from and in what condition: the source in use, its state, whether what is
 * on screen is a cached snapshot, and the last automatic switch (one toast per change).
 */
export const useFqConnectionStore = defineStore('fqConnection', () => {
  const kind = ref<SourceKind | null>(null);
  const status = ref<SourceStatus>({
    state: 'connecting',
    lastSyncMs: 0,
    clockSkewMs: 0,
    latencyMs: null,
    resyncing: false,
    reason: null,
  });
  /** What is shown comes from the IndexedDB cache, not yet from a live snapshot. */
  const fromCache = ref(false);
  /** When the cached snapshot was taken (client clock), for "Données d'il y a N min". */
  const cachedAtMs = ref<number | null>(null);
  const lastSwitch = ref<SourceSwitch | null>(null);
  /** Direct mode only: when the next gateway probe is due, for the banner countdown. */
  const nextProbeAtMs = ref<number | null>(null);
  /** Direct mode only: since when the gateway has been unreachable. */
  const directSinceMs = ref<number | null>(null);
  /** Incremented at every applied delta: the connection dot beats once. */
  const beat = ref(0);

  function setStatus(s: SourceStatus) {
    status.value = { ...s };
  }

  function recordSwitch(sw: SourceSwitch) {
    lastSwitch.value = sw;
    directSinceMs.value = sw.to === 'direct' ? sw.atMs : null;
  }

  return {
    kind,
    status,
    fromCache,
    cachedAtMs,
    lastSwitch,
    nextProbeAtMs,
    directSinceMs,
    beat,
    setStatus,
    recordSwitch,
  };
});
