/** Channel names of the gateway protocol (03 section 6.2). Port of `fg-core::protocol::Channel`. */
import { parseBotKey } from './identity';

import type { BotKey } from '@/gateway/types.gen';

export type SimpleChannelKind = 'fleet' | 'positions' | 'alerts' | 'events' | 'health' | 'recon';

export type Channel =
  | { kind: SimpleChannelKind }
  | { kind: 'bot'; bot_key: BotKey }
  /** Log lines: `bot_key` null means the errors of all bots, merged. */
  | { kind: 'logs'; bot_key: BotKey | null }
  | { kind: 'chart'; bot_key: BotKey; pair: string; timeframe: string };

export type ChannelParse =
  | { ok: true; channel: Channel }
  | { ok: false; error: 'unknown' | 'malformed' };

const SIMPLE: readonly string[] = ['fleet', 'positions', 'alerts', 'events', 'health', 'recon'];

/** Render the wire name of a channel. */
export function formatChannel(c: Channel): string {
  switch (c.kind) {
    case 'bot':
      return `bot:${c.bot_key}`;
    case 'logs':
      return c.bot_key === null ? 'logs:errors' : `logs:${c.bot_key}`;
    case 'chart':
      return `chart:${c.bot_key}:${c.pair}:${c.timeframe}`;
    default:
      return c.kind;
  }
}

/**
 * Split a leading bot key off `s`, returning it and the remainder (which starts after the
 * separating colon, if any). `local:<port>` and `url:<scheme>://<host>[:<port>]` are the only
 * shapes; a numeric segment followed by a colon after the host is a port.
 */
function splitBotKey(s: string): [BotKey, string] | null {
  if (s.startsWith('local:')) {
    const rest = s.slice(6);
    const digits = /^\d*/.exec(rest)?.[0].length ?? 0;
    const key = parseBotKey(`local:${rest.slice(0, digits)}`);
    if (!key) return null;
    const tail = rest.slice(digits);
    return [key, tail.startsWith(':') ? tail.slice(1) : tail];
  }
  if (!s.startsWith('url:')) return null;
  const rest = s.slice(4);
  const sep = rest.indexOf('://');
  if (sep < 0) return null;
  const scheme = rest.slice(0, sep);
  const after = rest.slice(sep + 3);
  // Host runs to the next colon or the end.
  const colon = after.indexOf(':');
  const hostEnd = colon < 0 ? after.length : colon;
  let end = hostEnd;
  // An optional numeric port: ":<digits>" followed by ":" or the end.
  if (after[hostEnd] === ':') {
    const portPart = after.slice(hostEnd + 1);
    const digits = /^\d*/.exec(portPart)?.[0].length ?? 0;
    if (digits > 0 && (digits === portPart.length || portPart[digits] === ':')) {
      end = hostEnd + 1 + digits;
    }
  }
  const key = parseBotKey(`url:${scheme}://${after.slice(0, end)}`);
  if (!key) return null;
  const tail = after.slice(end);
  return [key, tail.startsWith(':') ? tail.slice(1) : tail];
}

const malformed: ChannelParse = { ok: false, error: 'malformed' };

/** Parse a wire channel name. */
export function parseChannel(s: string): ChannelParse {
  if (SIMPLE.includes(s)) {
    return { ok: true, channel: { kind: s as SimpleChannelKind } };
  }
  if (s === 'logs:errors') {
    return { ok: true, channel: { kind: 'logs', bot_key: null } };
  }
  if (s.startsWith('bot:')) {
    const r = splitBotKey(s.slice(4));
    return r && r[1] === '' ? { ok: true, channel: { kind: 'bot', bot_key: r[0] } } : malformed;
  }
  if (s.startsWith('logs:')) {
    const r = splitBotKey(s.slice(5));
    return r && r[1] === '' ? { ok: true, channel: { kind: 'logs', bot_key: r[0] } } : malformed;
  }
  if (s.startsWith('chart:')) {
    const r = splitBotKey(s.slice(6));
    if (!r) return malformed;
    const [bot, tail] = r;
    const i = tail.lastIndexOf(':');
    if (i < 0) return malformed;
    const pair = tail.slice(0, i);
    const timeframe = tail.slice(i + 1);
    if (pair === '' || timeframe === '') return malformed;
    return { ok: true, channel: { kind: 'chart', bot_key: bot, pair, timeframe } };
  }
  return { ok: false, error: 'unknown' };
}
