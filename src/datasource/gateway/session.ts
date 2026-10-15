/**
 * Opening and keeping a gateway session without any action from the user (03 section 3.2).
 *
 * The browser already holds the tokens of every bot (`ftAuthLoginInfo`). To prove it may see them,
 * it refreshes the access tokens directly with the bots and uploads them once to the gateway
 * (`session/bootstrap`); the gateway checks them with a harmless `GET /version` on each bot and
 * answers with an opaque session. The refresh token of a bot that runs on the gateway's own host is
 * NOT uploaded: the gateway reads that bot's credentials from its configuration, so a dead
 * refresh token cannot lock the user out and no long lived secret crosses the network.
 */
import type { BotKey } from '@/gateway/types.gen';
import type { GatewayPrefs } from '@/migration/schema';

import type { AuthStore } from '../direct/auth';
import { jwtExpiryMs } from '../direct/auth';
import type { BotClient } from '../direct/botClient';
import { normalizeTsMs } from '../calc/time';
import { botKeyFromApiUrl } from '../protocol/identity';
import { GatewayError, type BootstrapBot, type GatewayHttp } from './http';

export interface GatewayPrefsPort {
  get(): GatewayPrefs;
  patch(p: Partial<GatewayPrefs>): void;
}

export interface SessionDeps {
  http: GatewayHttp;
  auth: AuthStore;
  botClient: BotClient;
  prefs: GatewayPrefsPort;
  localHosts: readonly string[];
  selfOrigin?: string;
  now?: () => number;
}

/** A session this close to its end is renewed first. */
const RENEW_MARGIN_MS = 60_000;
/** Access tokens expiring within this are refreshed before the upload. */
const TOKEN_MARGIN_MS = 2 * 60_000;

export function createSessionManager({
  http,
  auth,
  botClient,
  prefs,
  localHosts,
  selfOrigin,
  now = Date.now,
}: SessionDeps) {
  let opening: Promise<string> | null = null;

  const keyOf = (apiUrl: string | null): BotKey | null => {
    const url = apiUrl || selfOrigin || '';
    return url ? botKeyFromApiUrl(url, localHosts) : null;
  };

  async function open(): Promise<string> {
    const entries = auth.entries();
    if (entries.length === 0) {
      throw new GatewayError('unauthorized', null, 'no bot registered in this browser');
    }
    // Fresh access tokens first; a bot that cannot refresh is still listed (the gateway may know it).
    const stale = entries.filter((e) => {
      const exp = jwtExpiryMs(e.accessToken);
      return !e.accessToken || (exp !== null && exp - now() < TOKEN_MARGIN_MS);
    });
    for (let i = 0; i < stale.length; i += 4) {
      await Promise.allSettled(stale.slice(i, i + 4).map((e) => botClient.refresh(e.id)));
    }
    const bots: BootstrapBot[] = auth.entries().map((e) => {
      const local = keyOf(e.apiUrl)?.startsWith('local:') ?? false;
      return {
        ui_id: e.id,
        botName: e.botName,
        apiUrl: e.apiUrl || selfOrigin || '',
        accessToken: e.accessToken,
        ...(local || !e.refreshToken ? {} : { refreshToken: e.refreshToken }),
        ...(e.sortId !== undefined ? { sortId: e.sortId } : {}),
        ...(e.botIcon ? { botIcon: e.botIcon } : {}),
        ...(e.createdAt !== undefined ? { createdAt: e.createdAt } : {}),
      };
    });
    const res = await http.bootstrap({ device_id: prefs.get().deviceId, bots });
    const aliases: Record<string, BotKey> = {};
    for (const b of res.bots) aliases[b.ui_id] = b.bot_key;
    // Every gateway timestamp is in milliseconds; normalise anyway in case of seconds.
    prefs.patch({
      session: res.session,
      expiresAt: normalizeTsMs(res.expires_at) ?? res.expires_at,
      aliases,
    });
    return res.session;
  }

  return {
    /** A valid session token; opens one if needed. One bootstrap at a time. */
    async ensure(): Promise<string> {
      const p = prefs.get();
      if (p.session && p.expiresAt !== null && p.expiresAt - now() > RENEW_MARGIN_MS) {
        return p.session;
      }
      if (!opening) {
        opening = open().finally(() => {
          opening = null;
        });
      }
      return opening;
    },
    /** The current session token, or null (the socket needs it synchronously). */
    token(): string | null {
      return prefs.get().session;
    },
    /** Forget the session (the server said 401): the next `ensure` opens a new one. */
    invalidate(): void {
      prefs.patch({ session: null, expiresAt: null });
    },
    /** Open a new session whatever the current one looks like. */
    async renew(): Promise<string> {
      this.invalidate();
      return this.ensure();
    },
  };
}

export type SessionManager = ReturnType<typeof createSessionManager>;
