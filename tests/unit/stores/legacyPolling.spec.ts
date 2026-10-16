import axios from 'axios';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The browser must not poll the bots on its own once the user is back on a gateway page.
// Count every request the legacy stores send, through a stub axios instance.
const requests: string[] = [];
/** When set, every request answers after this delay with `answer(url)` instead of failing. */
let slow: { delayMs: number; answer: (url: string) => unknown } | null = null;

function stubApi() {
  const call = (url: string) => {
    requests.push(url);
    if (slow) {
      const s = slow;
      return new Promise((resolve) =>
        setTimeout(() => resolve({ data: s.answer(url), status: 200 }), s.delayMs),
      );
    }
    return Promise.reject(new Error('stub'));
  };
  return {
    get: call,
    post: call,
    delete: call,
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    defaults: { headers: { common: {} } },
  };
}

describe('legacy polling follows the legacy pages', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    requests.length = 0;
    slow = null;
    localStorage.setItem(
      'ftAuthLoginInfo',
      JSON.stringify({
        'ftbot.0': {
          botName: 'a',
          apiUrl: 'http://127.0.0.1:18080',
          refreshToken: 'r',
          accessToken: 'a',
          autoRefresh: true,
        },
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(axios, 'create').mockImplementation(() => stubApi() as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('sends nothing after suspendBots, and resumes on the next legacy page', async () => {
    const { initBots, suspendBots, useBotStore } = await import('@/stores/ftbotwrapper');
    initBots();
    await vi.advanceTimersByTimeAsync(130_000);
    const whileLegacy = requests.length;
    expect(whileLegacy).toBeGreaterThan(0);

    suspendBots();
    const store = useBotStore();
    expect(store.refreshInterval).toBeNull();
    expect(store.refreshIntervalSlow).toBeNull();
    expect(store.tradesRefreshInterval).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    const atSuspend = requests.length;
    // Longer than the 10 s, 60 s and 10 min cadences
    await vi.advanceTimersByTimeAsync(25 * 60_000);
    expect(requests.length).toBe(atSuspend);

    initBots();
    expect(store.refreshInterval).not.toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(requests.length).toBeGreaterThan(atSuspend);

    // Idempotent: a second suspend is a no-op, and leaves it stopped
    suspendBots();
    suspendBots();
    const again = requests.length;
    await vi.advanceTimersByTimeAsync(25 * 60_000);
    expect(requests.length).toBe(again);
  });

  it('does not go on with a sweep that was in flight when the user left (B192)', async () => {
    // 14 bots: the startup sweep needs three batches, each waiting for the slowest bot
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 14; i++) {
      many[`ftbot.${i}`] = {
        botName: `b${i}`,
        apiUrl: `http://127.0.0.1:${18080 + i}`,
        refreshToken: 'r',
        accessToken: 'a',
        autoRefresh: true,
      };
    }
    localStorage.setItem('ftAuthLoginInfo', JSON.stringify(many));
    slow = { delayMs: 4_000, answer: () => ({ status: 'pong' }) };
    const { initBots, suspendBots } = await import('@/stores/ftbotwrapper');
    initBots();
    await vi.advanceTimersByTimeAsync(1_000);
    const firstBatch = requests.length;
    expect(firstBatch).toBeGreaterThan(0);
    // Back on a gateway page while the first batch still waits for its bots
    suspendBots();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(requests.length, 'nothing after the batch that was already sent').toBe(firstBatch);
  });

  it('never opens the bot socket for a config answered after the user left (B192)', async () => {
    const sockets: string[] = [];
    class FakeSocket {
      readyState = 0;
      constructor(url: string) {
        sockets.push(url);
      }
      close() {}
      send() {}
      addEventListener() {}
      removeEventListener() {}
    }
    vi.stubGlobal('WebSocket', FakeSocket);
    slow = {
      delayMs: 3_000,
      answer: (url) =>
        url === '/show_config'
          ? { api_version: 2.45, runmode: 'live', bot_name: 'a' }
          : { status: 'pong' },
    };
    const { initBots, suspendBots } = await import('@/stores/ftbotwrapper');
    initBots();
    // The ping answered (t = 3 s) and `/show_config` is in flight when the user leaves (t = 4 s)
    await vi.advanceTimersByTimeAsync(4_000);
    expect(requests).toContain('/show_config');
    suspendBots();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('is a no-op when the legacy stores never started', async () => {
    const { suspendBots, useBotStore } = await import('@/stores/ftbotwrapper');
    expect(() => suspendBots()).not.toThrow();
    expect(useBotStore().refreshInterval).toBeNull();
  });
});
