/**
 * Assembly of the data layer for the running app: the legacy credentials, the preferences, the
 * source manager (gateway or direct) and the binding of the active source to the normalised
 * stores. One instance per app; everything here is injectable so the wiring is testable without a
 * browser (`createRuntime`), while `useDataSource` builds the real one.
 */
import type { AlertRulesConfig } from '@/gateway/types.gen';
import type { GatewayPrefs } from '@/migration/schema';

import { createIndexedDbCache, type SnapshotCache } from './cache';
import { bindSourceToStores, hydrateFromCache } from './bind';
import { createBotClient } from './direct/botClient';
import { DirectSource } from './direct/DirectSource';
import type { AuthStore } from './direct/auth';
import { axiosHttp, type HttpClient } from './direct/http';
import { createGatewayHttp } from './gateway/http';
import { GatewaySource } from './gateway/GatewaySource';
import { createSessionManager } from './gateway/session';
import type { WsFactory, WsLike } from './gateway/socket';
import { SourceManager, type SourceMode } from './manager';
import { useFqConnectionStore } from './stores/connection';
import { useFqPrefsStore } from './stores/prefs';
import type { DataSource } from './types';

export interface RuntimeEnv {
  auth: AuthStore;
  http?: HttpClient;
  wsFactory: WsFactory;
  cache?: SnapshotCache;
  protocol: string;
  hostname: string;
  selfOrigin: string;
  localHosts: readonly string[];
  isVisible?: () => boolean;
  profile?: 'full' | 'reduced';
  now?: () => number;
}

export interface Runtime {
  manager: SourceManager;
  start(): Promise<void>;
  stop(): void;
}

export function createRuntime(env: RuntimeEnv): Runtime {
  const prefs = useFqPrefsStore();
  const conn = useFqConnectionStore();
  const http = env.http ?? axiosHttp;
  const now = env.now ?? Date.now;

  const gatewayPrefsPort = {
    get: (): GatewayPrefs => prefs.gateway,
    patch: (p: Partial<GatewayPrefs>) => prefs.updateGateway(p),
  };

  const makeDirect = (): DataSource =>
    new DirectSource({
      auth: env.auth,
      http,
      now,
      localHosts: env.localHosts,
      selfOrigin: env.selfOrigin,
      profile: env.profile,
      isVisible: env.isVisible,
      getAlertRules: () => prefs.settings.alerts.rules,
      setAlertRules: (cfg: AlertRulesConfig) =>
        prefs.update('alerts', { ...prefs.settings.alerts, rules: cfg }),
      getGroups: () => prefs.settings.fleet.groups,
    });

  const makeGateway = (baseUrl: string): DataSource => {
    const gwHttp = createGatewayHttp({
      http,
      baseUrl: () => baseUrl,
      session: () => prefs.gateway.session,
    });
    const botClient = createBotClient({ http, auth: env.auth, now });
    const session = createSessionManager({
      http: gwHttp,
      auth: env.auth,
      botClient,
      prefs: gatewayPrefsPort,
      localHosts: env.localHosts,
      selfOrigin: env.selfOrigin,
      now,
    });
    return new GatewaySource({
      http: gwHttp,
      session,
      baseUrl: () => baseUrl,
      deviceId: () => prefs.gateway.deviceId,
      wsFactory: env.wsFactory,
      aliases: () => prefs.gateway.aliases,
      now,
      onUnusable: (reason) => void manager.reportUnusable(reason),
    });
  };

  const manager: SourceManager = new SourceManager({
    mode: (): SourceMode => prefs.gateway.mode,
    configuredUrl: () => prefs.gateway.url,
    protocol: env.protocol,
    hostname: env.hostname,
    probe: (baseUrl, timeoutMs) =>
      createGatewayHttp({ http, baseUrl: () => baseUrl, session: () => null }).hello(timeoutMs),
    makeGateway,
    makeDirect,
    onSourceChange: (next) => {
      unbind?.();
      unbind = bindSourceToStores(next, { cache: env.cache, now });
    },
    onSwitch: (sw) => conn.recordSwitch(sw),
    now,
  });

  let unbind: (() => void) | null = null;
  let stopWatch: (() => void) | null = null;

  return {
    manager,
    async start() {
      if (!prefs.ready) {
        prefs.init({
          storage: localStorage,
          localHosts: env.localHosts,
          selfOrigin: env.selfOrigin,
          browserLanguages: typeof navigator === 'undefined' ? [] : navigator.languages,
        });
      }
      // Paint from the cache at once; the first live snapshot replaces it.
      if (env.cache) void hydrateFromCache(env.cache).catch(() => undefined);
      await manager.start();
      stopWatch = watchProbeCountdown();
    },
    stop() {
      stopWatch?.();
      stopWatch = null;
      manager.stop();
      unbind?.();
      unbind = null;
    },
  };

  function watchProbeCountdown(): () => void {
    const timer = setInterval(() => {
      conn.nextProbeAtMs = manager.nextProbeAtMs.value;
    }, 1000);
    return () => clearInterval(timer);
  }
}

export function browserEnv(auth: AuthStore): RuntimeEnv {
  const hostname = window.location.hostname;
  return {
    auth,
    wsFactory: (url) => new WebSocket(url) as unknown as WsLike,
    cache: createIndexedDbCache(),
    protocol: window.location.protocol,
    hostname,
    selfOrigin: window.location.origin,
    localHosts: [hostname, 'localhost', '127.0.0.1', '::1'],
    isVisible: () => document.visibilityState !== 'hidden',
    profile: window.matchMedia?.('(max-width: 767px)').matches ? 'reduced' : 'full',
  };
}
