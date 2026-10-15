/**
 * Bot identity (03 section 4.1). Port of `fg-core::identity`.
 *
 * The canonical identity of a bot is its `bot_key`: `local:<port>` for a bot running on the machine
 * that serves the UI, `url:<normalised origin>` for a remote one. The `ftbot.N` identifiers of the
 * browser are per-device aliases and never appear in the gateway protocol.
 */
import type { BotKey } from '@/gateway/types.gen';

export interface Origin {
  scheme: 'http' | 'https';
  host: string;
  port: number;
}

const lower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

function parsePort(p: string): number | null {
  if (!/^\d{1,5}$/.test(p)) return null;
  const n = Number(p);
  return n <= 65535 ? n : null;
}

/** Parse `scheme://[user@]host[:port][/path][?query]`; a missing scheme means `http`. */
export function parseOrigin(input: string): Origin | null {
  const url = input.trim();
  const sep = url.indexOf('://');
  const scheme = sep >= 0 ? lower(url.slice(0, sep)) : 'http';
  const rest = sep >= 0 ? url.slice(sep + 3) : url;
  if (scheme !== 'http' && scheme !== 'https') return null;
  const authorityFull = rest.split(/[/?#]/)[0];
  if (!authorityFull) return null;
  const authority = authorityFull.slice(authorityFull.lastIndexOf('@') + 1);
  const defaultPort = scheme === 'https' ? 443 : 80;
  let host: string;
  let port: number | null;
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']');
    if (close < 0) return null;
    host = `[${lower(authority.slice(1, close))}]`;
    const tail = authority.slice(close + 1);
    if (tail.startsWith(':')) {
      port = parsePort(tail.slice(1));
    } else if (tail === '') {
      port = defaultPort;
    } else {
      return null;
    }
  } else {
    const colon = authority.lastIndexOf(':');
    if (colon >= 0) {
      host = lower(authority.slice(0, colon));
      port = parsePort(authority.slice(colon + 1));
    } else {
      host = lower(authority);
      port = defaultPort;
    }
  }
  if (port === null || port === 0 || host === '') return null;
  return { scheme, host, port };
}

/** Normalised origin, default port elided. */
export function originToString(o: Origin): string {
  const def = o.scheme === 'https' ? 443 : 80;
  return o.port === def ? `${o.scheme}://${o.host}` : `${o.scheme}://${o.host}:${o.port}`;
}

/** Canonical form of a bot key, or null when it is not a valid one. */
export function parseBotKey(input: string): BotKey | null {
  const s = input.trim();
  if (s.startsWith('local:')) {
    const port = parsePort(s.slice(6));
    return port ? `local:${port}` : null;
  }
  if (s.startsWith('url:')) {
    const o = parseOrigin(s.slice(4));
    return o ? `url:${originToString(o)}` : null;
  }
  return null;
}

/**
 * Build a key from the `apiUrl` stored by the browser. When the host is one of `localHosts` (plus
 * the loopback names) the bot is local and keyed by port, otherwise by the normalised origin.
 */
export function botKeyFromApiUrl(url: string, localHosts: readonly string[] = []): BotKey | null {
  const o = parseOrigin(url);
  if (!o) return null;
  const host = o.host.replace(/^\[|\]$/g, '');
  const isLocal =
    ['localhost', '127.0.0.1', '::1'].includes(host) || localHosts.some((h) => lower(h) === host);
  return isLocal ? `local:${o.port}` : `url:${originToString(o)}`;
}

/** Port of a local bot key. */
export function localPort(key: BotKey): number | null {
  return key.startsWith('local:') ? Number(key.slice(6)) : null;
}
