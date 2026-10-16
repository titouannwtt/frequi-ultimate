import { computed, ref, shallowRef } from 'vue';

import { botState } from '@/components/fq/lib/bots';
import { readWriteOutcome, type WriteOutcome } from '@/components/fq/lib/reconWrite';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import type { BotKey } from '@/gateway/types.gen';
import type { FleetviewReconciliationResponse, FleetviewResolvePayload } from '@/types/fleetview';

import { useDataSource } from './useDataSource';

/**
 * The sweep of the wallet can take a while (it asks the exchange): a real deadline, not the
 * default. The gateway gives up first (40 s by default) and says so; this one only bounds the
 * direct mode, where the bot is asked as it is.
 */
const SWEEP_TIMEOUT_MS = 60_000;

/** Why a read of the reconciliation failed, as the page tells it. */
export type ReconError =
  | 'source'
  | 'noBot'
  /** No bot offers the route (a bot without the fleet tooling). */
  | 'noServing'
  /** The sweep did not answer in time. */
  | 'timeout'
  /** The last sweep just failed and the wallets rest: nothing is asked before `retryAfterMs`. */
  | 'resting'
  | 'failed';

export interface ReconFailure {
  kind: ReconError;
  retryAfterMs: number | null;
  /**
   * Ask the next bot. Only when this one does not serve the route: any other failure comes from
   * the sweep of the exchange, and every bot would start another one.
   */
  tryNext: boolean;
}

/** Classifies a failed read, from a `GatewayError` or from the message of the direct mode. */
export function classifyReconFailure(e: unknown): ReconFailure {
  const x = (typeof e === 'object' && e !== null ? e : {}) as {
    code?: string;
    status?: number | null;
    retryAfterMs?: number | null;
    message?: string;
  };
  const message = typeof x.message === 'string' ? x.message : String(e);
  const retryAfterMs =
    typeof x.retryAfterMs === 'number' && x.retryAfterMs > 0 ? x.retryAfterMs : null;
  if (x.code === 'not_found' || x.status === 404 || /\bHTTP (404|405)\b/.test(message)) {
    return { kind: 'noServing', retryAfterMs: null, tryNext: true };
  }
  if (retryAfterMs !== null) return { kind: 'resting', retryAfterMs, tryNext: false };
  if (x.code === 'timeout' || x.status === 504 || /timeout|timed out/i.test(message)) {
    return { kind: 'timeout', retryAfterMs: null, tryNext: false };
  }
  return { kind: 'failed', retryAfterMs: null, tryNext: false };
}

/**
 * The reconciliation of the wallet (Tools > Reconciliation). The sweep is read from a bot that
 * answers, through the source's proxy (cached by the gateway for 60 s, wallet level: any bot gives
 * the same answer). The write is one request, once: no retry, no replay, whatever the outcome.
 */
export function useReconciliation() {
  const data = useDataSource();
  const fleet = useFqFleetStore();
  const conn = useFqConnectionStore();

  const response = shallowRef<FleetviewReconciliationResponse | null>(null);
  const loading = ref(false);
  const error = ref<ReconError | null>(null);
  /** How long the gateway asks to wait before another sweep, when it said so. */
  const retryAfterMs = ref<number | null>(null);
  /** The bot that answered the last read, and through which a write goes. */
  const via = ref<BotKey | null>(null);
  let inflight: Promise<void> | null = null;

  /** Bots that can serve the sweep: online, live ones first, then by name. */
  const candidates = computed(() => {
    const now = Date.now();
    return fleet.list
      .filter((b) => botState(b, now, conn.status.clockSkewMs) === 'online')
      .sort((a, b) => {
        const la = a.identity.mode === 'live' ? 0 : 1;
        const lb = b.identity.mode === 'live' ? 0 : 1;
        return la - lb || a.identity.name.localeCompare(b.identity.name);
      })
      .map((b) => b.bot_key);
  });

  const viaName = computed(() =>
    via.value ? (fleet.bots[via.value]?.identity.name ?? null) : null,
  );

  function load(): Promise<void> {
    if (inflight) return inflight;
    const source = data.source.value;
    if (!source) {
      error.value = 'source';
      return Promise.resolve();
    }
    loading.value = true;
    inflight = (async () => {
      error.value = null;
      retryAfterMs.value = null;
      // The bot that answered last time first, then the others: not every bot serves /fleetview
      const order = via.value
        ? [via.value, ...candidates.value.filter((k) => k !== via.value)]
        : candidates.value;
      if (order.length === 0) {
        error.value = 'noBot';
        return;
      }
      let last: ReconFailure = { kind: 'noServing', retryAfterMs: null, tryNext: true };
      for (const key of order) {
        try {
          const r = await source.proxy<FleetviewReconciliationResponse>(
            key,
            'GET',
            '/fleetview/reconciliation',
            undefined,
            { timeoutMs: SWEEP_TIMEOUT_MS },
          );
          if (r && Array.isArray(r.coins)) {
            response.value = r;
            via.value = key;
            return;
          }
        } catch (e) {
          last = classifyReconFailure(e);
          // A sweep that failed is not started again on the next bot
          if (!last.tryNext) break;
        }
      }
      error.value = last.kind;
      retryAfterMs.value = last.retryAfterMs;
    })().finally(() => {
      loading.value = false;
      inflight = null;
    });
    return inflight;
  }

  /**
   * Send one confirmed resolution. Resolves with what came back; rejects only when the request
   * could not be sent or no answer arrived (the caller shows "unknown", never resends).
   */
  async function resolve(payload: FleetviewResolvePayload): Promise<WriteOutcome> {
    const source = data.source.value;
    const key = via.value;
    const name = viaName.value;
    if (!source || !key || !name) throw new Error('no serving bot');
    const raw = await source.proxy<unknown>(
      key,
      'POST',
      '/fleetview/reconciliation/resolve',
      payload,
      { timeoutMs: SWEEP_TIMEOUT_MS, confirmBot: name },
    );
    return readWriteOutcome(source.kind, raw);
  }

  return { response, loading, error, retryAfterMs, via, viaName, candidates, load, resolve };
}
