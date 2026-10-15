/**
 * Minimal HTTP port of the direct mode. The default implementation rides on axios (same CORS and
 * proxy behaviour as the legacy pages); tests inject a fake. The contract is the one the
 * real-money rules need:
 *
 * - it resolves for EVERY HTTP status (a 401 or a 502 is an answer, not an exception);
 * - it rejects only when no answer came back (`HttpTransportError`), and says whether the request
 *   timed out (it may or may not have reached the bot) or never connected.
 */
import axios from 'axios';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface HttpRequest {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  body?: unknown;
  timeoutMs: number;
}

export interface HttpResponse<T = unknown> {
  status: number;
  data: T;
  /** Response headers, names in lower case. Absent when the client does not expose them. */
  headers?: Record<string, string>;
}

export class HttpTransportError extends Error {
  constructor(
    public readonly kind: 'timeout' | 'network',
    message?: string,
  ) {
    super(message ?? kind);
    this.name = 'HttpTransportError';
  }
}

export type HttpClient = (req: HttpRequest) => Promise<HttpResponse>;

/** axios based client. `validateStatus` accepts everything: the caller reads `status`. */
export const axiosHttp: HttpClient = async (req) => {
  try {
    const res = await axios.request({
      method: req.method,
      url: req.url,
      headers: req.headers,
      params: req.params,
      data: req.body,
      timeout: req.timeoutMs,
      validateStatus: () => true,
      // Repeated keys for arrays (`pairs_to_delete=A&pairs_to_delete=B`), like the legacy calls.
      paramsSerializer: { indexes: null },
    });
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers ?? {})) {
      if (typeof v === 'string') headers[k.toLowerCase()] = v;
    }
    return { status: res.status, data: res.data, headers };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (
      err.code === 'ECONNABORTED' ||
      err.code === 'ETIMEDOUT' ||
      /timeout/i.test(err.message ?? '')
    ) {
      throw new HttpTransportError('timeout');
    }
    throw new HttpTransportError('network', err.message);
  }
};
