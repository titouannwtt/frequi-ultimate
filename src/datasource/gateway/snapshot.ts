/**
 * Reading of `GET /snapshot?ch=...`: which collections belong to which channel, and how the
 * answer is split per channel. The wire shape is documented in `http.ts`.
 */
import type { Channel } from '../protocol/channel';
import { parseSeqHeader } from './http';

/** Collections owned by each state channel. Channels not listed here carry whatever they answer. */
export const CHANNEL_COLLECTIONS: Readonly<Record<string, readonly string[]>> = {
  fleet: ['bots', 'wallets'],
  positions: ['positions'],
  alerts: ['alerts'],
  health: ['health'],
};

/** State channels are loaded from a snapshot and then followed by deltas; the rest stream. */
export function isStateChannel(c: Channel): boolean {
  return c.kind !== 'events' && c.kind !== 'logs' && c.kind !== 'chart';
}

export interface ParsedSnapshot {
  /** Sequence number of each channel at the time of the snapshot. */
  seq: Record<string, number>;
  /** Collections of each requested channel, `{ collection: { key: entity } }`. */
  byChannel: Record<string, Record<string, Record<string, unknown>>>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Split a snapshot answer into channels. `body.channels[name]` wins when present (channels with
 * free-form collections such as `bot:<key>`); otherwise the known collections of the channel are
 * picked from the top level (or from `body.collections`).
 */
export function parseSnapshot(
  body: unknown,
  headers: Record<string, string> | undefined,
  channels: readonly string[],
): ParsedSnapshot {
  const root = isObject(body) ? body : {};
  const flat = isObject(root.collections) ? root.collections : root;
  const perChannel = isObject(root.channels) ? root.channels : {};
  const seq: Record<string, number> = {};
  Object.assign(
    seq,
    ...(isObject(root.seq)
      ? [Object.fromEntries(Object.entries(root.seq).filter(([, v]) => typeof v === 'number'))]
      : []),
    parseSeqHeader(headers?.['x-gw-seq'], channels.length === 1 ? channels[0] : undefined),
  );
  const byChannel: ParsedSnapshot['byChannel'] = {};
  for (const name of channels) {
    const explicit = perChannel[name];
    const own = isObject(explicit) ? explicit : null;
    const names = CHANNEL_COLLECTIONS[name];
    const cols: Record<string, Record<string, unknown>> = {};
    if (own) {
      for (const [k, v] of Object.entries(own)) if (isObject(v)) cols[k] = v;
    } else if (names) {
      for (const k of names) {
        const v = flat[k];
        cols[k] = isObject(v) ? v : {};
      }
    }
    byChannel[name] = cols;
  }
  return { seq, byChannel };
}
