/**
 * HTTP side of the gateway client (`/gw/v1`, docs/redesign/03 section 6.3).
 *
 * Contract assumptions that the gateway server (lot B4) must honour, written down here because the
 * document only describes them in prose:
 * - `GET /hello` is public: `{ version, protocol, auth_modes }`.
 * - `POST /session/bootstrap` takes `{ device_id, bots: [{ ui_id, botName, apiUrl, accessToken,
 *   refreshToken?, sortId, botIcon?, createdAt? }] }` and answers `{ session, expires_at, bots:
 *   [{ ui_id, bot_key, scope }] }`.
 * - `GET /snapshot?ch=a,b` answers the collections of the channels (`{ bots: {...}, positions:
 *   {...} }`, optionally wrapped in `{ collections }`) and the sequence number of each channel in
 *   the `X-Gw-Seq` header as `fleet=1842, alerts=77` (a single channel may use the bare number).
 * - Errors are `{ code, message, retry_after_ms }` (`ApiError`) with the HTTP status of the code.
 * - Mutations carry an `Idempotency-Key` header and are never retried by this client.
 */
import type { ApiError, ErrorCode } from '@/gateway/types.gen';

import type { HttpClient, HttpMethod, HttpResponse } from '../direct/http';
import { HttpTransportError } from '../direct/http';

export interface HelloResponse {
  version: string;
  protocol: number;
  auth_modes: string[];
}

export interface BootstrapBot {
  ui_id: string;
  botName: string;
  apiUrl: string;
  accessToken: string;
  refreshToken?: string;
  sortId?: number;
  botIcon?: string;
  createdAt?: number;
}

export interface BootstrapResponse {
  session: string;
  expires_at: number;
  bots: Array<{ ui_id: string; bot_key: string; scope: boolean | string }>;
}

export class GatewayError extends Error {
  constructor(
    public readonly code: ErrorCode | 'transport' | 'timeout',
    public readonly status: number | null,
    message: string,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export interface GatewayHttpDeps {
  http: HttpClient;
  /** Base URL, without trailing slash and without `/gw/v1`. */
  baseUrl: () => string;
  session: () => string | null;
}

const PREFIX = '/gw/v1';

function asApiError(status: number, data: unknown): GatewayError {
  const d = (data && typeof data === 'object' ? data : {}) as Partial<ApiError>;
  const code = (d.code ??
    (status === 401
      ? 'unauthorized'
      : status === 409
        ? 'state_mismatch'
        : 'internal')) as ErrorCode;
  return new GatewayError(
    code,
    status,
    typeof d.message === 'string' ? d.message : `HTTP ${status}`,
    d.retry_after_ms ?? null,
  );
}

export function createGatewayHttp({ http, baseUrl, session }: GatewayHttpDeps) {
  async function raw<T>(
    method: HttpMethod,
    path: string,
    opts: {
      params?: Record<string, unknown>;
      body?: unknown;
      headers?: Record<string, string>;
      timeoutMs?: number;
      auth?: boolean;
    } = {},
  ): Promise<HttpResponse<T>> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.auth !== false) {
      const s = session();
      if (s) headers.Authorization = `Bearer ${s}`;
    }
    try {
      return (await http({
        method,
        url: `${baseUrl()}${PREFIX}${path}`,
        headers,
        params: opts.params,
        body: opts.body,
        timeoutMs: opts.timeoutMs ?? 8_000,
      })) as HttpResponse<T>;
    } catch (e) {
      if (e instanceof HttpTransportError) {
        throw new GatewayError(e.kind === 'timeout' ? 'timeout' : 'transport', null, e.kind);
      }
      throw e;
    }
  }

  /** Success body, or a `GatewayError` carrying the server's code. */
  async function json<T>(
    method: HttpMethod,
    path: string,
    opts: Parameters<typeof raw>[2] = {},
  ): Promise<T> {
    const res = await raw<T>(method, path, opts);
    if (res.status >= 200 && res.status < 300) return res.data;
    throw asApiError(res.status, res.data);
  }

  return {
    raw,
    json,
    /** Public probe. Resolves with the answer and the round trip, or null when unreachable. */
    async hello(timeoutMs = 1_500): Promise<{ hello: HelloResponse; rttMs: number } | null> {
      const t0 = Date.now();
      try {
        const res = await raw<HelloResponse>('GET', '/hello', { auth: false, timeoutMs });
        if (res.status !== 200 || !res.data || typeof res.data.protocol !== 'number') return null;
        return { hello: res.data, rttMs: Date.now() - t0 };
      } catch {
        return null;
      }
    },
    bootstrap(body: { device_id: string; bots: BootstrapBot[] }) {
      return json<BootstrapResponse>('POST', '/session/bootstrap', {
        body,
        auth: false,
        timeoutMs: 15_000,
      });
    },
  };
}

export type GatewayHttp = ReturnType<typeof createGatewayHttp>;

/** Parse `X-Gw-Seq`: `fleet=1842, alerts=77`, or a bare number for a single channel. */
export function parseSeqHeader(
  value: string | undefined | null,
  onlyChannel?: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value) return out;
  const bare = /^\s*(\d+)\s*$/.exec(value);
  if (bare && onlyChannel) {
    out[onlyChannel] = Number(bare[1]);
    return out;
  }
  for (const part of value.split(',')) {
    const m = /^\s*([^=\s]+)\s*=\s*(\d+)\s*$/.exec(part);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}
