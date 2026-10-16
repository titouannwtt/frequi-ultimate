/**
 * Choice of the data source and automatic switch between gateway and direct mode, with no action
 * from the user (03 section 9.1, 02 section 10.3):
 *
 * - `auto` (default) probes `GET /gw/v1/hello` on the configured URL (default: same host, port
 *   9399) within 1.5 s. Answer: gateway. No answer: direct mode, and a new probe every 60 s.
 * - A gateway whose WebSocket has been lost for more than 30 s while `hello` no longer answers is
 *   left for the direct mode (with a banner); the way back is automatic as soon as `hello` answers
 *   and a session can be opened.
 * - `gateway` and `direct` force the choice (settings), without any fallback.
 *
 * A switch starts the new source before the old one stops, so the screen never goes empty; the
 * stores keep the last values (marked by their age) until the new source's snapshot replaces them.
 */
import { ref, shallowRef, type Ref, type ShallowRef } from 'vue';

import { GATEWAY_PROTOCOL_VERSION } from '@/gateway/types.gen';

import type { DataSource, SourceKind } from './types';
import type { HelloResponse } from './gateway/http';
import type { SourceSwitch } from './stores/connection';

export type SourceMode = 'auto' | 'gateway' | 'direct';

export interface ProbeResult {
  hello: HelloResponse;
  rttMs: number;
}

/** What the last `hello` probe found (Settings > Gateway). */
export interface ProbeRecord {
  atMs: number;
  url: string;
  ok: boolean;
  rttMs: number | null;
  protocol: number | null;
  version: string | null;
}

export interface ManagerTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export interface SourceManagerDeps {
  mode: () => SourceMode;
  /** Configured gateway URL, or '' for the default. */
  configuredUrl: () => string;
  protocol: string;
  hostname: string;
  /** `GET hello` on this base URL, or null when unreachable. */
  probe: (baseUrl: string, timeoutMs: number) => Promise<ProbeResult | null>;
  makeGateway: (baseUrl: string) => DataSource;
  makeDirect: () => DataSource;
  /** The active source changed (the stores are bound to the new one). */
  onSourceChange: (next: DataSource, previous: DataSource | null) => void;
  onSwitch?: (sw: SourceSwitch) => void;
  /** Every probe, answered or not. */
  onProbe?: (p: ProbeRecord) => void;
  now?: () => number;
  timers?: ManagerTimers;
}

export const PROBE_TIMEOUT_MS = 1_500;
export const REPROBE_EVERY_MS = 60_000;
/** The WebSocket may be down this long before the gateway is given up on. */
export const WS_LOST_GRACE_MS = 30_000;
const WATCH_EVERY_MS = 5_000;
export const DEFAULT_GATEWAY_PORT = 9399;

export function defaultGatewayUrl(protocol: string, hostname: string): string {
  const host = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
  return `${protocol}//${host}:${DEFAULT_GATEWAY_PORT}`;
}

export class SourceManager {
  readonly current: ShallowRef<DataSource | null> = shallowRef(null);
  readonly kind: Ref<SourceKind | null> = ref(null);
  /** Client time of the next gateway probe (direct mode, auto), for the banner countdown. */
  readonly nextProbeAtMs: Ref<number | null> = ref(null);

  private readonly now: () => number;
  private readonly timers: ManagerTimers;
  private running = false;
  private probeTimer: unknown = null;
  private watchTimer: unknown = null;
  private offlineSince: number | null = null;
  private switching: Promise<void> | null = null;

  constructor(private readonly d: SourceManagerDeps) {
    this.now = d.now ?? Date.now;
    this.timers = d.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    };
  }

  /** Base URL of the gateway: the configured one, else same host on port 9399. */
  baseUrl(): string {
    const url = this.d.configuredUrl().trim().replace(/\/+$/, '');
    return url || defaultGatewayUrl(this.d.protocol, this.d.hostname);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.choose();
  }

  stop(): void {
    this.running = false;
    this.clearTimers();
    this.current.value?.stop();
  }

  /** Probe now and switch if the answer calls for it ("Sonder maintenant"). */
  async probeNow(): Promise<void> {
    if (!this.running) return;
    this.clearProbeTimer();
    // Already on the gateway: nothing to switch, the probe only refreshes what Settings shows
    if (this.kind.value === 'gateway') {
      await this.probe(this.baseUrl());
      return;
    }
    await this.choose();
  }

  /**
   * The gateway source says it cannot be used (protocol mismatch, session refused twice). In auto
   * mode the app falls back to the direct mode at once and probes again later; a forced gateway
   * stays where it is and shows the problem.
   */
  async reportUnusable(reason: string): Promise<void> {
    if (!this.running || this.kind.value !== 'gateway' || this.d.mode() !== 'auto') return;
    if (this.watchTimer !== null) this.timers.clearTimeout(this.watchTimer);
    this.watchTimer = null;
    await this.switchTo('direct', reason);
    this.scheduleProbe();
  }

  /** The mode setting changed. */
  async modeChanged(): Promise<void> {
    if (!this.running) return;
    await this.choose();
  }

  private clearProbeTimer(): void {
    if (this.probeTimer !== null) this.timers.clearTimeout(this.probeTimer);
    this.probeTimer = null;
    this.nextProbeAtMs.value = null;
  }

  private clearTimers(): void {
    this.clearProbeTimer();
    if (this.watchTimer !== null) this.timers.clearTimeout(this.watchTimer);
    this.watchTimer = null;
  }

  private scheduleProbe(): void {
    this.clearProbeTimer();
    if (!this.running || this.d.mode() !== 'auto') return;
    this.nextProbeAtMs.value = this.now() + REPROBE_EVERY_MS;
    this.probeTimer = this.timers.setTimeout(() => {
      this.probeTimer = null;
      this.nextProbeAtMs.value = null;
      void this.choose();
    }, REPROBE_EVERY_MS);
  }

  /** Decide which source should be active and switch to it. */
  private async choose(): Promise<void> {
    if (this.switching) return this.switching;
    this.switching = this.doChoose().finally(() => {
      this.switching = null;
    });
    return this.switching;
  }

  private async doChoose(): Promise<void> {
    const mode = this.d.mode();
    const cur = this.kind.value;
    if (mode === 'direct') {
      this.clearTimers();
      if (cur !== 'direct') await this.switchTo('direct', 'forced');
      return;
    }
    if (mode === 'gateway') {
      this.clearProbeTimer();
      if (cur !== 'gateway') {
        // Forced: no fallback. The source reports itself offline if the gateway is down.
        const ok = await this.trySwitchToGateway('forced');
        if (!ok && cur === null) await this.switchTo('direct', 'forced');
      }
      this.watch();
      return;
    }
    // auto
    if (cur === 'gateway') {
      this.watch();
      return;
    }
    const ok = await this.trySwitchToGateway('probe_ok');
    if (!ok) {
      if (cur === null) await this.switchTo('direct', 'probe_failed');
      this.scheduleProbe();
    } else {
      this.clearProbeTimer();
      this.watch();
    }
  }

  /** One `hello`, recorded for the Settings page. */
  private async probe(base: string): Promise<ProbeResult | null> {
    const r = await this.d.probe(base, PROBE_TIMEOUT_MS);
    this.d.onProbe?.({
      atMs: this.now(),
      url: base,
      ok: r !== null,
      rttMs: r?.rttMs ?? null,
      protocol: r?.hello.protocol ?? null,
      version: r?.hello.version ?? null,
    });
    return r;
  }

  /** Probe, start a gateway source, and swap it in. False when any step failed. */
  private async trySwitchToGateway(reason: string): Promise<boolean> {
    const base = this.baseUrl();
    const probe = await this.probe(base);
    if (!probe || probe.hello.protocol !== GATEWAY_PROTOCOL_VERSION) {
      return false;
    }
    const next = this.d.makeGateway(base);
    try {
      await next.start();
    } catch {
      next.stop();
      return false;
    }
    this.swap(next, 'gateway', reason);
    return true;
  }

  private async switchTo(kind: SourceKind, reason: string): Promise<void> {
    const next = kind === 'direct' ? this.d.makeDirect() : this.d.makeGateway(this.baseUrl());
    await next.start();
    this.swap(next, kind, reason);
  }

  private swap(next: DataSource, kind: SourceKind, reason: string): void {
    const previous = this.current.value;
    const from = this.kind.value;
    this.current.value = next;
    this.kind.value = kind;
    this.offlineSince = null;
    this.d.onSourceChange(next, previous);
    previous?.stop();
    if (from !== kind) {
      this.d.onSwitch?.({ from, to: kind, reason, atMs: this.now() });
    }
  }

  /** While on the gateway: leave it when the socket has been down for long and `hello` is silent. */
  private watch(): void {
    if (this.watchTimer !== null) this.timers.clearTimeout(this.watchTimer);
    this.watchTimer = this.timers.setTimeout(() => void this.watchTick(), WATCH_EVERY_MS);
  }

  private async watchTick(): Promise<void> {
    this.watchTimer = null;
    if (!this.running || this.kind.value !== 'gateway') return;
    const src = this.current.value;
    const state = src?.status.value.state;
    const t = this.now();
    if (state === 'offline') {
      this.offlineSince ??= t;
      if (this.d.mode() === 'auto' && t - this.offlineSince >= WS_LOST_GRACE_MS) {
        const probe = await this.probe(this.baseUrl());
        if (!probe) {
          this.offlineSince = null;
          await this.switchTo('direct', 'ws_lost');
          this.scheduleProbe();
          return;
        }
      }
    } else {
      this.offlineSince = null;
    }
    this.watch();
  }
}
