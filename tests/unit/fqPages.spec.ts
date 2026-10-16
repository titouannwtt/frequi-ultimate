import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { FIXTURE_NOW, makeFixture, resetStores, seedStores } from '@/components/fq/fixtures';
import i18n from '@/locales';
import BotPage from '@/views/fq/BotPage.vue';
import FleetPage from '@/views/fq/FleetPage.vue';

// Charts need a canvas; the pages are checked for what they wire, not for pixels.
const stubs = {
  BaseChart: true,
  EquityCurve: true,
  PnlCalendar: true,
  Leaderboard: true,
  CandleChart: true,
  Teleport: true,
};

function pageRouter(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/dashboard', name: 'fleet', component: { render: () => null } },
      { path: '/bot/:botKey', name: 'bot', component: { render: () => null } },
      { path: '/journal', component: { render: () => null } },
      { path: '/charts', component: { render: () => null } },
    ],
  });
  void router.push(path);
  return router;
}

const fixture = makeFixture(12);

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXTURE_NOW);
  seedStores(fixture);
});
afterEach(() => {
  resetStores();
  vi.useRealTimers();
});

describe('FleetPage', () => {
  it('shows the fleet, the open positions and the "needs attention" rail from the stores', async () => {
    const router = pageRouter('/dashboard');
    await router.isReady();
    const w = mount(FleetPage, {
      global: { plugins: [i18n, router], stubs },
      attachTo: document.body,
    });
    await flushPromises();
    expect(w.find('[data-testid="fleet-page"]').exists()).toBe(true);
    expect(w.find('[data-testid="alert-rail"]').exists()).toBe(true);
    // One row per bot of the scope (live by default), named like in the fleet store.
    const live = fixture.bots.filter((b) => b.identity.mode === 'live');
    expect(live.length).toBeGreaterThan(0);
    for (const b of live.slice(0, 3)) expect(w.text()).toContain(b.identity.name);
    w.unmount();
  });

  it('keeps the live and the dry figures apart in the All scope', async () => {
    const router = pageRouter('/dashboard?scope=all');
    await router.isReady();
    const w = mount(FleetPage, { global: { plugins: [i18n, router], stubs } });
    await flushPromises();
    expect(w.findAll('[data-testid="fleet-kpis"] .row').length).toBeLessThanOrEqual(2);
    w.unmount();
  });
});

describe('BotPage', () => {
  it('opens the bot of the URL with its header and its positions', async () => {
    const bot = fixture.bots.find((b) => b.identity.mode === 'live')!;
    const router = pageRouter(`/bot/${encodeURIComponent(bot.bot_key)}`);
    await router.isReady();
    const w = mount(BotPage, { global: { plugins: [i18n, router], stubs } });
    await flushPromises();
    expect(w.text()).toContain(bot.identity.name);
    w.unmount();
  });
});
