/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures and decoded wire frames */
/**
 * Test doubles of the data layer. Nothing here (or in the specs using it) talks to a real bot: the
 * HTTP port is always a fake, hosts are `*.test`, tokens are made up. A write that reaches a fake is
 * recorded, never executed anywhere.
 */
import {
  HttpTransportError,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
} from '@/datasource/direct/http';

export function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** An unsigned JWT-shaped token that only carries `exp`. */
export function makeJwt(expMs: number, extra: Record<string, unknown> = {}): string {
  return `${b64url({ alg: 'none' })}.${b64url({ exp: Math.floor(expMs / 1000), ...extra })}.sig`;
}

export type FakeAnswer = HttpResponse | 'timeout' | 'network';
export type FakeHandler = (req: HttpRequest, n: number) => FakeAnswer | Promise<FakeAnswer>;

export interface FakeHttp {
  http: HttpClient;
  calls: HttpRequest[];
  /** Calls matching a predicate. */
  where(pred: (r: HttpRequest) => boolean): HttpRequest[];
  writes(): HttpRequest[];
}

export function createFakeHttp(handler: FakeHandler): FakeHttp {
  const calls: HttpRequest[] = [];
  const http: HttpClient = async (req) => {
    if (!/^(https?|wss?):\/\/[^/]*\.test(:\d+)?(\/|$)/.test(req.url)) {
      throw new Error(`test refused a request to a non fake host: ${req.url}`);
    }
    calls.push(structuredClone(req));
    const answer = await handler(req, calls.length);
    if (answer === 'timeout') throw new HttpTransportError('timeout');
    if (answer === 'network') throw new HttpTransportError('network');
    return answer;
  };
  return {
    http,
    calls,
    where: (pred) => calls.filter(pred),
    writes: () => calls.filter((c) => c.method !== 'GET'),
  };
}

export const ok = <T>(data: T, headers?: Record<string, string>): HttpResponse => ({
  status: 200,
  data,
  headers,
});
export const status = (s: number, data: unknown = {}): HttpResponse => ({ status: s, data });

/** Flush pending microtasks and zero delay timers. */
export const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- timers and sockets

interface Pending {
  id: number;
  at: number;
  fn: () => void;
}

/** Deterministic timers: nothing fires until `advance`. */
export class ManualTimers {
  now = 0;
  private seq = 0;
  private pending: Pending[] = [];

  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.pending.push({ id, at: this.now + ms, fn });
    return id;
  };

  clearTimeout = (h: unknown): void => {
    this.pending = this.pending.filter((p) => p.id !== h);
  };

  get count(): number {
    return this.pending.length;
  }

  /** Delays of the timers still waiting, ascending. */
  delays(): number[] {
    return this.pending.map((p) => p.at - this.now).sort((a, b) => a - b);
  }

  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const next = this.pending
        .filter((p) => p.at <= end)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      this.pending = this.pending.filter((p) => p !== next);
      this.now = next.at;
      next.fn();
    }
    this.now = end;
  }
}

export class FakeWs {
  static all: FakeWs[] = [];
  readyState = 0;
  sent: Array<Record<string, any>> = [];
  closedWith: { code?: number; reason?: string } | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(public readonly url: string) {
    FakeWs.all.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }

  /** The server accepted the connection. */
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  /** A frame from the server. */
  serve(frame: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  /** The server (or the network) closed the connection. */
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  frames(t: string): Array<Record<string, any>> {
    return this.sent.filter((f) => f.t === t);
  }
}

export function fakeWsFactory(): (url: string) => FakeWs {
  FakeWs.all = [];
  return (url) => new FakeWs(url);
}

export const lastWs = (): FakeWs => FakeWs.all[FakeWs.all.length - 1]!;
