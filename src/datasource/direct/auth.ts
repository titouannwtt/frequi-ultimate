/**
 * Source of the bot credentials of the direct mode: `ftAuthLoginInfo`, exactly as the legacy UI
 * keeps it (ids `ftbot.N` are never renumbered). The tokens are written back in the same shape, so
 * the old pages keep working next to the new layer.
 */

export interface AuthEntry {
  id: string;
  botName: string;
  botIcon?: string;
  /** `''` or null: the UI is served by this bot (same origin). */
  apiUrl: string | null;
  username?: string;
  accessToken: string;
  refreshToken: string;
  sortId?: number;
  createdAt?: number;
}

export interface AuthStore {
  entries(): AuthEntry[];
  /** Persist new tokens of one bot. Must not change anything else. */
  patch(id: string, tokens: { accessToken?: string; refreshToken?: string }): void;
}

/** In-memory store for tests. */
export function createMemoryAuthStore(initial: AuthEntry[]): AuthStore & { data: AuthEntry[] } {
  const data = initial.map((e) => ({ ...e }));
  return {
    data,
    entries: () => data,
    patch(id, tokens) {
      const e = data.find((x) => x.id === id);
      if (e) Object.assign(e, tokens);
    },
  };
}

/** Base64url JSON payload of a JWT, or null. No signature check: used only to read `exp`. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(part.length / 4) * 4, '=');
    const json = atob(b64);
    const utf8 = decodeURIComponent(
      [...json].map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
    );
    const parsed: unknown = JSON.parse(utf8);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Expiry of a JWT in ms since the epoch, or null when unreadable. */
export function jwtExpiryMs(token: string): number | null {
  const exp = decodeJwtPayload(token)?.exp;
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
}
