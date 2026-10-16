import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import {
  defaultGatewayUrl,
  PROBE_TIMEOUT_MS,
  REPROBE_EVERY_MS,
  SourceManager,
  WS_LOST_GRACE_MS,
  type ProbeRecord,
  type ProbeResult,
  type SourceMode,
} from '@/datasource/manager';
import type { DataSource, SourceKind, SourceStatus } from '@/datasource/types';
import { GATEWAY_PROTOCOL_VERSION } from '@/gateway/types.gen';

import { ManualTimers } from './helpers';

function fakeSource(kind: SourceKind, startImpl?: () => Promise<void>) {
  const status = ref<SourceStatus>({
    state: 'live',
    lastSyncMs: 0,
    clockSkewMs: 0,
    latencyMs: null,
    resyncing: false,
    reason: null,
  });
  const src = {
    kind,
    status,
    start: vi.fn(startImpl ?? (async () => undefined)),
    stop: vi.fn(),
  };
  return src as unknown as DataSource & {
    start: typeof src.start;
    stop: typeof src.stop;
    status: typeof status;
  };
}

function setup(opts: { mode?: SourceMode; probe?: () => ProbeResult | null; url?: string } = {}) {
  const timers = new ManualTimers();
  const state = {
    mode: opts.mode ?? 'auto',
    probe:
      opts.probe ??
      (() => ({
        hello: { version: 't', protocol: GATEWAY_PROTOCOL_VERSION, auth_modes: [] },
        rttMs: 12,
      })),
  };
  const gateways: ReturnType<typeof fakeSource>[] = [];
  const directs: ReturnType<typeof fakeSource>[] = [];
  const probes: string[] = [];
  const changes: Array<[SourceKind, SourceKind | null]> = [];
  const switches: string[] = [];
  const records: ProbeRecord[] = [];
  let clock = 0;
  const mgr = new SourceManager({
    mode: () => state.mode,
    configuredUrl: () => opts.url ?? '',
    protocol: 'https:',
    hostname: 'ui.test',
    probe: async (base, timeoutMs) => {
      probes.push(`${base}@${timeoutMs}`);
      return state.probe();
    },
    makeGateway: () => {
      const s = fakeSource('gateway');
      gateways.push(s);
      return s;
    },
    makeDirect: () => {
      const s = fakeSource('direct');
      directs.push(s);
      return s;
    },
    onSourceChange: (next, prev) => changes.push([next.kind, prev?.kind ?? null]),
    onSwitch: (sw) => switches.push(`${sw.from ?? '-'}>${sw.to}:${sw.reason}`),
    onProbe: (p) => records.push(p),
    now: () => clock,
    timers,
  });
  const advance = async (ms: number) => {
    clock += ms;
    timers.advance(ms);
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { mgr, state, gateways, directs, probes, changes, switches, records, timers, advance };
}

describe('SourceManager', () => {
  it('uses the gateway when `hello` answers within the probe time', async () => {
    const h = setup();
    await h.mgr.start();
    expect(h.mgr.kind.value).toBe('gateway');
    expect(h.probes).toEqual([`https://ui.test:9399@${PROBE_TIMEOUT_MS}`]);
    expect(h.switches).toEqual(['->gateway:probe_ok']);
  });

  it('falls back to the direct mode when the gateway is silent and probes again every 60 s', async () => {
    const h = setup({ probe: () => null });
    await h.mgr.start();
    expect(h.mgr.kind.value).toBe('direct');
    expect(h.switches).toEqual(['->direct:probe_failed']);
    expect(h.mgr.nextProbeAtMs.value).not.toBeNull();
    await h.advance(REPROBE_EVERY_MS);
    expect(h.probes).toHaveLength(2);
    expect(h.mgr.kind.value).toBe('direct');
  });

  it('comes back to the gateway by itself once it answers, starting it before stopping the direct mode', async () => {
    const h = setup({ probe: () => null });
    await h.mgr.start();
    const direct = h.directs[0]!;
    h.state.probe = () => ({
      hello: { version: 't', protocol: GATEWAY_PROTOCOL_VERSION, auth_modes: [] },
      rttMs: 5,
    });
    await h.advance(REPROBE_EVERY_MS);
    expect(h.mgr.kind.value).toBe('gateway');
    expect(h.gateways[0]!.start).toHaveBeenCalled();
    expect(direct.stop).toHaveBeenCalled();
    // The stores were bound to the new source before the old one stopped.
    expect(h.changes.at(-1)).toEqual(['gateway', 'direct']);
    expect(h.switches.at(-1)).toBe('direct>gateway:probe_ok');
  });

  it('stays on the direct mode when the gateway speaks another protocol', async () => {
    const h = setup({
      probe: () => ({
        hello: { version: 't', protocol: GATEWAY_PROTOCOL_VERSION + 1, auth_modes: [] },
        rttMs: 5,
      }),
    });
    await h.mgr.start();
    expect(h.mgr.kind.value).toBe('direct');
    expect(h.gateways).toHaveLength(0);
  });

  it('stays on the direct mode when the gateway answers `hello` but cannot start (no session)', async () => {
    const h = setup();
    h.state.probe = () => ({
      hello: { version: 't', protocol: GATEWAY_PROTOCOL_VERSION, auth_modes: [] },
      rttMs: 5,
    });
    const mgr = new SourceManager({
      mode: () => 'auto',
      configuredUrl: () => '',
      protocol: 'https:',
      hostname: 'ui.test',
      probe: async () => h.state.probe(),
      makeGateway: () => fakeSource('gateway', async () => Promise.reject(new Error('no session'))),
      makeDirect: () => fakeSource('direct'),
      onSourceChange: () => undefined,
      timers: h.timers,
    });
    await mgr.start();
    expect(mgr.kind.value).toBe('direct');
  });

  it('leaves a gateway whose socket has been down for 30 s and whose `hello` is silent', async () => {
    const h = setup();
    await h.mgr.start();
    const gw = h.gateways[0]!;
    gw.status.value = { ...gw.status.value, state: 'offline' };
    h.state.probe = () => null;
    await h.advance(5_000);
    expect(h.mgr.kind.value).toBe('gateway');
    await h.advance(WS_LOST_GRACE_MS + 5_000);
    expect(h.mgr.kind.value).toBe('direct');
    expect(h.switches.at(-1)).toBe('gateway>direct:ws_lost');
  });

  it('keeps a gateway whose socket is down but whose `hello` still answers', async () => {
    const h = setup();
    await h.mgr.start();
    h.gateways[0]!.status.value = { ...h.gateways[0]!.status.value, state: 'offline' };
    await h.advance(WS_LOST_GRACE_MS + 10_000);
    expect(h.mgr.kind.value).toBe('gateway');
  });

  it('forces the direct mode without any probe', async () => {
    const h = setup({ mode: 'direct' });
    await h.mgr.start();
    expect(h.mgr.kind.value).toBe('direct');
    expect(h.probes).toEqual([]);
    expect(h.mgr.nextProbeAtMs.value).toBeNull();
  });

  it('forced gateway does not fall back to the direct mode once it is running', async () => {
    const h = setup({ mode: 'gateway' });
    await h.mgr.start();
    expect(h.mgr.kind.value).toBe('gateway');
    h.gateways[0]!.status.value = { ...h.gateways[0]!.status.value, state: 'offline' };
    h.state.probe = () => null;
    await h.advance(WS_LOST_GRACE_MS * 3);
    expect(h.mgr.kind.value).toBe('gateway');
  });

  it('follows a change of the mode setting', async () => {
    const h = setup();
    await h.mgr.start();
    h.state.mode = 'direct';
    await h.mgr.modeChanged();
    expect(h.mgr.kind.value).toBe('direct');
  });

  it('falls back at once when the gateway reports itself unusable, and only in auto mode', async () => {
    const h = setup();
    await h.mgr.start();
    await h.mgr.reportUnusable('protocol');
    expect(h.mgr.kind.value).toBe('direct');
    expect(h.switches.at(-1)).toBe('gateway>direct:protocol');

    const forced = setup({ mode: 'gateway' });
    await forced.mgr.start();
    await forced.mgr.reportUnusable('protocol');
    expect(forced.mgr.kind.value).toBe('gateway');
  });

  it('"probe now" is immediate', async () => {
    const h = setup({ probe: () => null });
    await h.mgr.start();
    h.state.probe = () => ({
      hello: { version: 't', protocol: GATEWAY_PROTOCOL_VERSION, auth_modes: [] },
      rttMs: 5,
    });
    await h.mgr.probeNow();
    expect(h.mgr.kind.value).toBe('gateway');
  });

  it('stop stops the source and every timer', async () => {
    const h = setup({ probe: () => null });
    await h.mgr.start();
    h.mgr.stop();
    expect(h.directs[0]!.stop).toHaveBeenCalled();
    expect(h.timers.count).toBe(0);
  });

  it('uses the configured URL, trimmed, and the default one otherwise', async () => {
    const h = setup({ url: 'https://my-gw.test:1234///' });
    await h.mgr.start();
    expect(h.probes[0]).toBe(`https://my-gw.test:1234@${PROBE_TIMEOUT_MS}`);
    expect(defaultGatewayUrl('http:', '192.0.2.1')).toBe('http://192.0.2.1:9399');
    expect(defaultGatewayUrl('https:', '::1')).toBe('https://[::1]:9399');
  });
});

describe('SourceManager: probe record for Settings', () => {
  it('records every probe, answered or not, with the round trip and the version', async () => {
    const h = setup();
    await h.mgr.start();
    expect(h.records).toEqual([
      {
        atMs: 0,
        url: 'https://ui.test:9399',
        ok: true,
        rttMs: 12,
        protocol: GATEWAY_PROTOCOL_VERSION,
        version: 't',
      },
    ]);
    const silent = setup({ probe: () => null });
    await silent.mgr.start();
    expect(silent.records[0]).toMatchObject({
      ok: false,
      rttMs: null,
      protocol: null,
      version: null,
    });
  });

  it('probes again on "probe now" while on the gateway, without switching or restarting it', async () => {
    const h = setup();
    await h.mgr.start();
    await h.mgr.probeNow();
    expect(h.records).toHaveLength(2);
    expect(h.gateways).toHaveLength(1);
    expect(h.gateways[0].stop).not.toHaveBeenCalled();
  });

  it('does nothing before start', async () => {
    const h = setup();
    await h.mgr.probeNow();
    expect(h.records).toEqual([]);
  });
});
