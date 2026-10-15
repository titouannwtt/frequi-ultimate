import { computed, shallowRef } from 'vue';

import { createLoginInfoAuthStore } from '@/datasource/direct/loginInfoStore';
import type { SourceMode } from '@/datasource/manager';
import { browserEnv, createRuntime, type Runtime } from '@/datasource/runtime';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { DataSource } from '@/datasource/types';

/**
 * Entry point of the data layer for the redesigned pages (docs/redesign/02-design.md, 5.3):
 * the active source (gateway or direct), the state of the connection and the clock skew.
 *
 * The runtime is a singleton. Nothing starts it until a redesigned shell calls `start()`: the
 * legacy pages never touch it, so loading this module changes nothing for them.
 */
const runtime = shallowRef<Runtime | null>(null);

export function useDataSource() {
  const conn = useFqConnectionStore();

  const source = computed<DataSource | null>(() => runtime.value?.manager.current.value ?? null);

  async function start(): Promise<void> {
    if (!runtime.value) {
      runtime.value = createRuntime(browserEnv(createLoginInfoAuthStore()));
    }
    await runtime.value.start();
  }

  function stop(): void {
    runtime.value?.stop();
    runtime.value = null;
  }

  /** The active source, or an error: for code that cannot do anything without one. */
  function requireSource(): DataSource {
    const s = source.value;
    if (!s) throw new Error('data source not started');
    return s;
  }

  /** Change the source policy (Settings): `auto` probes the gateway, the others force a source. */
  async function setMode(mode: SourceMode): Promise<void> {
    useFqPrefsStore().updateGateway({ mode });
    await runtime.value?.manager.modeChanged();
  }

  /** "Probe now" of the direct mode banner. */
  async function probeNow(): Promise<void> {
    await runtime.value?.manager.probeNow();
  }

  return {
    source,
    kind: computed(() => conn.kind),
    status: computed(() => conn.status),
    clockSkewMs: computed(() => conn.status.clockSkewMs),
    fromCache: computed(() => conn.fromCache),
    cachedAtMs: computed(() => conn.cachedAtMs),
    lastSwitch: computed(() => conn.lastSwitch),
    nextProbeAtMs: computed(() => conn.nextProbeAtMs),
    directSinceMs: computed(() => conn.directSinceMs),
    started: computed(() => runtime.value !== null),
    start,
    stop,
    requireSource,
    setMode,
    probeNow,
  };
}
