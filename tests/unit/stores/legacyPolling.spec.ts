import axios from 'axios';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The browser must not poll the bots on its own once the user is back on a gateway page.
// Count every request the legacy stores send, through a stub axios instance.
const requests: string[] = [];

function stubApi() {
  const call = (url: string) => {
    requests.push(url);
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

  it('is a no-op when the legacy stores never started', async () => {
    const { suspendBots, useBotStore } = await import('@/stores/ftbotwrapper');
    expect(() => suspendBots()).not.toThrow();
    expect(useBotStore().refreshInterval).toBeNull();
  });
});
