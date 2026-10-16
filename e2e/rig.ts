import { readFileSync } from 'node:fs';

import type { BrowserContext, Page } from '@playwright/test';

/**
 * Access to the e2e rig started by `pnpm e2e:rig` (scripts/e2e-rig): fake freqtrade bots, the real
 * gateway in front of them, and a control channel. Everything here talks to those and to nothing
 * else: no real bot is ever reachable from the rig.
 */

export interface RigBot {
  index: number;
  name: string;
  port: number;
  live: boolean;
  user: string;
  password: string;
}

export interface Rig {
  gateway: string;
  control: string;
  password: string;
  bots: RigBot[];
  /** Indexes of the bots that were started offline / still starting. */
  down: number[];
  starting: number[];
}

export const hasRig = Boolean(process.env.FQ_E2E_RIG);

let cached: Rig | null = null;
export function rig(): Rig {
  if (!cached) {
    const file = process.env.FQ_E2E_RIG;
    if (!file) throw new Error('the rig is not running: use `pnpm e2e:rig`');
    cached = JSON.parse(readFileSync(file, 'utf8')) as Rig;
  }
  return cached;
}

export const botKey = (b: RigBot): string => `local:${b.port}`;
export const botUrl = (b: RigBot): string => `http://127.0.0.1:${b.port}`;

interface Tokens {
  access_token: string;
  refresh_token: string;
}

/** Log in to a fake bot like the UI does (HTTP Basic on /token/login). */
async function login(b: RigBot): Promise<Tokens | null> {
  try {
    const r = await fetch(`${botUrl(b)}/api/v1/token/login`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${b.user}:${b.password}`).toString('base64')}`,
      },
    });
    return r.ok ? ((await r.json()) as Tokens) : null;
  } catch {
    return null;
  }
}

export interface SeedOptions {
  /** `auto` (gateway first, direct fallback), or `direct` (never uses the gateway). */
  mode?: 'auto' | 'direct';
  /** Only these bots are registered in the browser (indexes); default all. */
  only?: number[];
}

/**
 * Register the rig's bots in the browser the way a user would have: `ftAuthLoginInfo` (the legacy
 * key, kept) with fresh tokens, and the address of the gateway in `fqu2.gateway`. Written once per
 * browser context and never overwritten, so the app's own changes survive a reload.
 */
export async function seed(context: BrowserContext, options: SeedOptions = {}): Promise<void> {
  const r = rig();
  const bots = r.bots.filter((b) => !options.only || options.only.includes(b.index));
  const info: Record<string, unknown> = {};
  await Promise.all(
    bots.map(async (b) => {
      const t = await login(b);
      info[`ftbot.${b.index}`] = {
        botName: b.name,
        apiUrl: botUrl(b),
        // A bot that is down has no token: a placeholder keeps it registered (and offline)
        accessToken: t?.access_token ?? 'x.y.z',
        refreshToken: t?.refresh_token ?? 'x.y.z',
        autoRefresh: true,
        sortId: b.index,
      };
    }),
  );
  await context.addInitScript(
    ([login, gateway, mode]) => {
      if (localStorage.getItem('ftAuthLoginInfo') === null) {
        localStorage.setItem('ftAuthLoginInfo', JSON.stringify(login));
      }
      if (localStorage.getItem('fqu2.gateway') === null) {
        localStorage.setItem('fqu2.gateway', JSON.stringify({ url: gateway, mode }));
      }
    },
    [info, r.gateway, options.mode ?? 'auto'] as const,
  );
}

/**
 * The fake bots send no CORS headers (a real bot answers the origins of its `CORS_origins`): this
 * route adds them, so that the direct mode of the app, which talks to the bots from the browser,
 * can be exercised. The gateway is not touched: it has its own CORS policy, which is what the
 * other specs verify.
 */
export async function allowBotCors(context: BrowserContext, uiOrigin: string): Promise<void> {
  const ports = new Set(rig().bots.map((b) => b.port));
  await context.route(/^http:\/\/127\.0\.0\.1:\d+\/api\/v1\//, async (route) => {
    const port = Number(new URL(route.request().url()).port);
    if (!ports.has(port)) return route.continue();
    const cors = {
      'access-control-allow-origin': uiOrigin,
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*',
    };
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: cors });
    }
    try {
      const response = await route.fetch();
      return await route.fulfill({ response, headers: { ...response.headers(), ...cors } });
    } catch {
      // The page navigated or closed while the request was in flight: nothing left to answer
    }
  });
}

/** One command of the fakebot control protocol (`stats`, `mode`, `fill`, `log`...). */
export async function fakebot(command: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch(`${rig().control}/fakebot`, {
    method: 'POST',
    body: JSON.stringify(command),
  });
  return (await r.json()) as Record<string, unknown>;
}

export interface RecordedWrite {
  method: string;
  path: string;
  body: Record<string, unknown>;
  at_ms: number;
}

/**
 * The writes that reached a fake bot since `sinceMs` (epoch ms, default: all), with the index of
 * the bot. The fake bots list them bot by bot, so a count taken earlier cannot be used as an
 * offset: filter by time.
 */
export async function recordedWrites(
  sinceMs = 0,
): Promise<Array<{ bot: number; write: RecordedWrite }>> {
  const reply = (await fakebot({ cmd: 'stats' })) as {
    stats?: { writes?: Array<[number, RecordedWrite]> };
  };
  return (reply.stats?.writes ?? [])
    .map(([bot, write]) => ({ bot, write }))
    .filter((w) => w.write.at_ms >= sinceMs)
    .sort((a, b) => a.write.at_ms - b.write.at_ms);
}

export async function stopGateway(): Promise<void> {
  await fetch(`${rig().control}/gateway/stop`, { method: 'POST' });
}

export async function startGateway(): Promise<void> {
  await fetch(`${rig().control}/gateway/start`, { method: 'POST' });
}

/** The page has no horizontal overflow: nothing sticks out of the viewport. */
export async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
