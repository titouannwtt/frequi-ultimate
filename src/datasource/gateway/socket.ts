/**
 * WebSocket client of the gateway (`GET /gw/v1/ws`, docs/redesign/03 section 6.2).
 *
 * Connection life cycle: open, send `auth` within 5 s (the token is in the first frame, never in
 * the URL), wait for `authed`, send `sub` with the resume points, wait for `subscribed`, live. No
 * frame for 35 s (the server sends a heartbeat every 15 s) means the link is dead: close and
 * reconnect with the backoff 1, 2, 5, 10, 30 s (then 30 s, with a little jitter so that several
 * tabs do not come back together). `4401` means the session is not valid: the owner re-opens one,
 * the socket does not retry by itself. `4403` and `4429` are final.
 */
import {
  AUTH_TIMEOUT_S,
  HEARTBEAT_TIMEOUT_S,
  RECONNECT_BACKOFF_S,
  type ClientFrame,
  type ServerFrame,
} from '@/gateway/types.gen';

export interface WsLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type WsFactory = (url: string) => WsLike;

export type SocketState =
  | 'idle'
  | 'connecting'
  | 'authing'
  | 'subscribing'
  | 'live'
  | 'backoff'
  | 'closed';

export interface SocketTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export interface SocketDeps {
  url: () => string;
  token: () => string | null;
  deviceId: () => string;
  factory: WsFactory;
  /** Channels to subscribe to and the last applied sequence number of each (resume). */
  wanted: () => { channels: string[]; resume: Record<string, number> };
  timers?: SocketTimers;
  jitter?: boolean;
  onFrame: (f: ServerFrame) => void;
  onState: (s: SocketState, info: { code?: number; attempt: number; retryInMs?: number }) => void;
  /** The server refused the session (4401). */
  onAuthFailure: () => void;
}

const OPEN = 1;

export class GatewaySocket {
  private ws: WsLike | null = null;
  private state: SocketState = 'idle';
  private attempt = 0;
  private wantRunning = false;
  private authTimer: unknown = null;
  private watchdog: unknown = null;
  private retryTimer: unknown = null;
  private readonly timers: SocketTimers;

  constructor(private readonly d: SocketDeps) {
    this.timers = d.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    };
  }

  get current(): SocketState {
    return this.state;
  }

  start(): void {
    if (this.wantRunning) return;
    this.wantRunning = true;
    this.open();
  }

  stop(): void {
    this.wantRunning = false;
    this.clearAll();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close(1000, 'client stop');
      } catch {
        // already closed
      }
    }
    this.setState('closed');
  }

  /** Reconnect now (new session after a 4401, or the app came back online). */
  reconnectNow(): void {
    if (!this.wantRunning) return;
    this.clearAll();
    this.dropSocket();
    this.open();
  }

  send(frame: ClientFrame): boolean {
    if (
      !this.ws ||
      this.ws.readyState !== OPEN ||
      (this.state !== 'live' && this.state !== 'subscribing')
    ) {
      return false;
    }
    this.ws.send(JSON.stringify(frame));
    return true;
  }

  // ---- internals ----

  private setState(s: SocketState, info: { code?: number; retryInMs?: number } = {}): void {
    this.state = s;
    this.d.onState(s, { ...info, attempt: this.attempt });
  }

  private clearAll(): void {
    for (const t of [this.authTimer, this.watchdog, this.retryTimer]) {
      if (t !== null) this.timers.clearTimeout(t);
    }
    this.authTimer = this.watchdog = this.retryTimer = null;
  }

  private dropSocket(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        // already closed
      }
    }
  }

  private open(): void {
    const token = this.d.token();
    if (!token) {
      // No session: the owner has to obtain one first.
      this.d.onAuthFailure();
      return;
    }
    this.setState('connecting');
    let ws: WsLike;
    try {
      ws = this.d.factory(this.d.url());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.setState('authing');
      ws.send(
        JSON.stringify({ t: 'auth', token, device_id: this.d.deviceId() } satisfies ClientFrame),
      );
      this.authTimer = this.timers.setTimeout(() => {
        // The server did not answer the auth frame in time.
        this.dropSocket();
        this.scheduleReconnect();
      }, AUTH_TIMEOUT_S * 1000);
      this.armWatchdog();
    };
    ws.onmessage = (ev) => {
      this.armWatchdog();
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(ev.data)) as ServerFrame;
      } catch {
        return;
      }
      this.handle(frame);
    };
    ws.onclose = (ev) => {
      this.clearAll();
      this.ws = null;
      if (!this.wantRunning) return;
      if (ev.code === 4401) {
        this.setState('closed', { code: ev.code });
        this.d.onAuthFailure();
      } else if (ev.code === 4403 || ev.code === 4429) {
        this.wantRunning = false;
        this.setState('closed', { code: ev.code });
      } else {
        this.scheduleReconnect(ev.code);
      }
    };
    ws.onerror = () => {
      // The close event follows and drives the reconnection.
    };
  }

  private handle(frame: ServerFrame): void {
    if (frame.t === 'authed') {
      if (this.authTimer !== null) this.timers.clearTimeout(this.authTimer);
      this.authTimer = null;
      this.setState('subscribing');
      const { channels, resume } = this.d.wanted();
      if (channels.length > 0) {
        this.ws?.send(JSON.stringify({ t: 'sub', ch: channels, resume } satisfies ClientFrame));
      } else {
        this.attempt = 0;
        this.setState('live');
      }
    } else if (frame.t === 'subscribed') {
      this.attempt = 0;
      this.setState('live');
    } else if (frame.t === 'err' && this.state === 'authing') {
      // Refused before authentication: let the close code decide.
    }
    this.d.onFrame(frame);
  }

  private armWatchdog(): void {
    if (this.watchdog !== null) this.timers.clearTimeout(this.watchdog);
    this.watchdog = this.timers.setTimeout(() => {
      // Nothing for 35 s: the link is dead even if the OS has not noticed.
      this.dropSocket();
      this.scheduleReconnect();
    }, HEARTBEAT_TIMEOUT_S * 1000);
  }

  private scheduleReconnect(code?: number): void {
    if (!this.wantRunning) return;
    this.clearAll();
    const base = RECONNECT_BACKOFF_S[Math.min(this.attempt, RECONNECT_BACKOFF_S.length - 1)] * 1000;
    this.attempt += 1;
    const delay = this.d.jitter === false ? base : Math.round(base * (0.9 + Math.random() * 0.2));
    this.setState('backoff', { code, retryInMs: delay });
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }
}
