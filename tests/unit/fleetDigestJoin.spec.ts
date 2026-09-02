import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as BotApiPortModule from '@/stores/botApiPort';

import { apiPortFromUrl } from '@/stores/botApiPort';
import { buildPortIndex, fleetDigestKeyFor, publishFleetDigests } from '@/stores/fleetDigestPolicy';

/**
 * The join between the UI's bots and the fleet snapshot's entries.
 *
 * The snapshot is keyed by the `bot_name` each bot reports, which the browser only learns by
 * calling `/show_config` — a per-bot request, and precisely one of the requests the snapshot
 * exists to remove. On a cold load nothing could be joined, so the decimation never fired and
 * the full fan-out happened anyway. Joining by API port breaks that circle: the port comes
 * from the login URL the user typed, so it is known before a single request is made.
 *
 * What must never regress: matching the wrong bot. These rows carry money.
 */

// `botApiPort` and `reportedBotName` each read localStorage once and memoise it at module
// load, so writing to localStorage inside a test would change nothing. They are stubbed to
// what they resolve TO, which is also what the ordering under test actually depends on. The
// real URL parsing keeps its own tests below.
const ports: Record<string, number | undefined> = {};
const names: Record<string, string | undefined> = {};

vi.mock('@/stores/botApiPort', async (importOriginal) => ({
  ...(await importOriginal<typeof BotApiPortModule>()),
  botApiPort: (botId: string) => ports[botId],
}));
vi.mock('@/stores/botNameRegistry', () => ({
  reportedBotName: (botId: string) => names[botId],
  rememberBotName: () => {},
  forgetBotName: () => {},
}));

function reset() {
  for (const k of Object.keys(ports)) delete ports[k];
  for (const k of Object.keys(names)) delete names[k];
}

describe('apiPortFromUrl', () => {
  it('reads the port out of an API base URL', () => {
    expect(apiPortFromUrl('http://127.0.0.1:9501')).toBe(9501);
    expect(apiPortFromUrl('https://bots.example.com:8080/api/v1')).toBe(8080);
  });

  it('returns undefined rather than inventing the protocol default', () => {
    // 80/443 are not written in the URL. Defaulting to them would let every port-less bot
    // claim the same port, and match whichever digest happened to publish it.
    expect(apiPortFromUrl('http://example.com')).toBeUndefined();
    expect(apiPortFromUrl('https://example.com/api/v1')).toBeUndefined();
  });

  it('survives an empty, relative or malformed URL', () => {
    expect(apiPortFromUrl('')).toBeUndefined();
    expect(apiPortFromUrl(undefined)).toBeUndefined();
    expect(apiPortFromUrl(null)).toBeUndefined();
    expect(apiPortFromUrl('/api/v1')).toBeUndefined();
    expect(apiPortFromUrl('not a url at all')).toBeUndefined();
  });
});

describe('buildPortIndex', () => {
  it('indexes each digest by the port it published', () => {
    expect(buildPortIndex({ alpha: { api_port: 9501 }, beta: { api_port: 9502 } })).toEqual({
      9501: 'alpha',
      9502: 'beta',
    });
  });

  it('ignores an absent or zero port instead of indexing it', () => {
    // A zero is what an older daemon, or a bot with no API server, would amount to. Indexed,
    // it would match every client that could not read a port either.
    expect(buildPortIndex({ alpha: {}, beta: { api_port: 0 } })).toEqual({});
  });

  it('drops a port two bots claim rather than picking one', () => {
    // Legitimate on a fleet split across hosts. Guessing here would show one bot's balance
    // against another's row, which is the single worst outcome for this dashboard.
    const index = buildPortIndex({
      alpha: { api_port: 9501 },
      beta: { api_port: 9501 },
      gamma: { api_port: 9502 },
    });
    expect(index).toEqual({ 9502: 'gamma' });
  });
});

describe('fleetDigestKeyFor', () => {
  beforeEach(() => {
    reset();
    publishFleetDigests({}, false);
  });

  it('joins by port on a cold cache, with no name ever reported', () => {
    // The whole point: no /show_config has answered, the name registry is empty, and the
    // bot is still matched to its digest on the first tick.
    ports.botA = 9501;
    publishFleetDigests({ hippo_short: { age_s: 3, api_port: 9501 } }, true);
    expect(fleetDigestKeyFor('botA')).toBe('hippo_short');
  });

  it('falls back to the remembered bot_name when no port is published', () => {
    // An older daemon that does not send api_port: the previous behaviour must survive.
    ports.botA = 9501;
    names.botA = 'hippo_short';
    publishFleetDigests({ hippo_short: { age_s: 3 } }, true);
    expect(fleetDigestKeyFor('botA')).toBe('hippo_short');
  });

  it('prefers the port over a remembered name that has gone stale', () => {
    // A bot renamed since the last visit. The port is current, the stored name is not.
    ports.botA = 9501;
    names.botA = 'old_name';
    publishFleetDigests(
      { new_name: { age_s: 3, api_port: 9501 }, old_name: { age_s: 3, api_port: 9502 } },
      true,
    );
    expect(fleetDigestKeyFor('botA')).toBe('new_name');
  });

  it('refuses to join a bot it can match neither way', () => {
    ports.botA = 9599;
    names.botA = undefined;
    publishFleetDigests({ hippo_short: { age_s: 3, api_port: 9501 } }, true);
    expect(fleetDigestKeyFor('botA')).toBeUndefined();
  });

  it('refuses a remembered name absent from the snapshot', () => {
    // Otherwise the caller would look up a key that is not there and read undefined anyway,
    // but through a path that reports "joined".
    names.botA = 'retired_bot';
    publishFleetDigests({ hippo_short: { age_s: 3, api_port: 9501 } }, true);
    expect(fleetDigestKeyFor('botA')).toBeUndefined();
  });

  it('joins nothing once the snapshot is republished as unusable', () => {
    // Daemon gone or endpoint 404: the port index must be cleared with the digests, or the
    // tiers would keep skipping requests on the strength of a snapshot that no longer exists.
    ports.botA = 9501;
    publishFleetDigests({ hippo_short: { age_s: 3, api_port: 9501 } }, true);
    publishFleetDigests({}, false);
    expect(fleetDigestKeyFor('botA')).toBeUndefined();
  });

  it('returns undefined for an empty botId', () => {
    expect(fleetDigestKeyFor('')).toBeUndefined();
  });
});
