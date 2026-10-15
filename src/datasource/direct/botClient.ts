/**
 * Authenticated requests to the bots (direct mode). The two rules that matter for real money:
 *
 * - A READ that gets a 401 refreshes the token and is replayed once; if the refresh fails the 401
 *   is returned, never replayed with an empty token (the legacy `api.ts` did, bug B4).
 * - A WRITE is sent exactly once. The access token is refreshed BEFORE the send when it expires in
 *   less than 60 s; a failed refresh means nothing is sent. A 401 answer proves that the bot did not
 *   execute the request and is returned as is. A timeout is `unknown`: it may have reached the bot.
 */
import { jwtExpiryMs, type AuthEntry, type AuthStore } from './auth';
import { HttpTransportError, type HttpClient, type HttpMethod, type HttpResponse } from './http';

const API = '/api/v1';
/** A write is not sent with a token that expires in less than this. */
export const WRITE_MIN_TOKEN_TTL_MS = 60_000;
export const READ_TIMEOUT_MS = 8_000;
export const WRITE_TIMEOUT_MS = 20_000;

export type BotRequestFailure =
  | { kind: 'transport'; transport: 'timeout' | 'network' }
  /** The refresh token is dead (or there is none): the user must log in again. */
  | { kind: 'auth_expired' }
  | { kind: 'unknown_bot' };

export class BotRequestError extends Error {
  constructor(public readonly failure: BotRequestFailure) {
    super(failure.kind);
    this.name = 'BotRequestError';
  }
}

export interface BotResult<T = unknown> extends HttpResponse<T> {
  /** The request actually left (false: refused before sending, for example a dead token). */
  sent: boolean;
}

export interface ReadOptions {
  params?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface WriteOptions {
  params?: Record<string, unknown>;
  body?: unknown;
  timeoutMs?: number;
}

export interface BotClientDeps {
  http: HttpClient;
  auth: AuthStore;
  now?: () => number;
}

export function baseUrlOf(entry: Pick<AuthEntry, 'apiUrl'>): string {
  const url = (entry.apiUrl ?? '').replace(/\/+$/, '');
  return `${url.replace(new RegExp(`${API}$`), '')}${API}`;
}

export function createBotClient({ http, auth, now = Date.now }: BotClientDeps) {
  const refreshing = new Map<string, Promise<'ok' | 'expired' | 'transport'>>();

  const entryOf = (id: string): AuthEntry => {
    const e = auth.entries().find((x) => x.id === id);
    if (!e) throw new BotRequestError({ kind: 'unknown_bot' });
    return e;
  };

  /** One refresh per bot at a time; every caller waits for the same outcome. */
  function refresh(id: string): Promise<'ok' | 'expired' | 'transport'> {
    const running = refreshing.get(id);
    if (running) return running;
    const p = (async (): Promise<'ok' | 'expired' | 'transport'> => {
      const e = entryOf(id);
      if (!e.refreshToken) return 'expired';
      try {
        const res = await http({
          method: 'POST',
          url: `${baseUrlOf(e)}/token/refresh`,
          headers: { Authorization: `Bearer ${e.refreshToken}` },
          body: {},
          timeoutMs: READ_TIMEOUT_MS,
        });
        const token = (res.data as { access_token?: string } | null)?.access_token;
        if (res.status >= 200 && res.status < 300 && token) {
          auth.patch(id, { accessToken: token });
          return 'ok';
        }
        // 401/403: the refresh token is dead. Anything else (500, 404): the bot is not ready.
        return res.status === 401 || res.status === 403 ? 'expired' : 'transport';
      } catch {
        return 'transport';
      }
    })().finally(() => refreshing.delete(id));
    refreshing.set(id, p);
    return p;
  }

  function tokenExpiresWithin(e: AuthEntry, ms: number): boolean {
    if (!e.accessToken) return true;
    const exp = jwtExpiryMs(e.accessToken);
    return exp !== null && exp - now() < ms;
  }

  async function send<T>(
    e: AuthEntry,
    method: HttpMethod,
    path: string,
    opts: WriteOptions,
    timeoutMs: number,
  ): Promise<HttpResponse<T>> {
    return (await http({
      method,
      url: `${baseUrlOf(e)}${path}`,
      headers: e.accessToken ? { Authorization: `Bearer ${e.accessToken}` } : undefined,
      params: opts.params,
      body: opts.body,
      timeoutMs,
    })) as HttpResponse<T>;
  }

  function wrapTransport(e: unknown): never {
    if (e instanceof HttpTransportError) {
      throw new BotRequestError({ kind: 'transport', transport: e.kind });
    }
    throw e;
  }

  return {
    /** Authenticated GET. Throws `BotRequestError` when no usable answer could be obtained. */
    async get<T = unknown>(
      id: string,
      path: string,
      opts: ReadOptions = {},
    ): Promise<HttpResponse<T>> {
      let e = entryOf(id);
      const timeoutMs = opts.timeoutMs ?? READ_TIMEOUT_MS;
      try {
        let res = await send<T>(e, 'GET', path, { params: opts.params }, timeoutMs);
        if (res.status === 401) {
          const outcome = await refresh(id);
          if (outcome === 'expired') throw new BotRequestError({ kind: 'auth_expired' });
          if (outcome === 'transport') return res;
          e = entryOf(id);
          // A read may be replayed once, with the NEW token.
          res = await send<T>(e, 'GET', path, { params: opts.params }, timeoutMs);
        }
        return res;
      } catch (err) {
        if (err instanceof BotRequestError) throw err;
        return wrapTransport(err);
      }
    },

    /**
     * Authenticated mutation, sent once. Resolves with `sent: false` and status 401 when the token
     * could not be made fresh (nothing left the browser). A transport error rejects with
     * `BotRequestError('transport')`: the caller must treat a timeout as "unknown".
     */
    async write<T = unknown>(
      id: string,
      method: Exclude<HttpMethod, 'GET'>,
      path: string,
      opts: WriteOptions = {},
    ): Promise<BotResult<T>> {
      let e = entryOf(id);
      if (tokenExpiresWithin(e, WRITE_MIN_TOKEN_TTL_MS)) {
        const outcome = await refresh(id);
        if (outcome !== 'ok') {
          // Nothing was sent: the user is told, and the dialog offers to retry.
          return { status: 401, data: null as T, sent: false };
        }
        e = entryOf(id);
      }
      try {
        const res = await send<T>(e, method, path, opts, opts.timeoutMs ?? WRITE_TIMEOUT_MS);
        return { ...res, sent: true };
      } catch (err) {
        return wrapTransport(err);
      }
    },

    refresh,
  };
}

export type BotClient = ReturnType<typeof createBotClient>;
