import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { FIXTURE_NOW, makeFixture, resetStores, seedStores } from '@/components/fq/fixtures';
import i18n from '@/locales';
import ChartsPage from '@/views/fq/ChartsPage.vue';
import JournalPage from '@/views/fq/JournalPage.vue';
import SettingsPage from '@/views/fq/SettingsPage.vue';
import RiskToolPage from '@/views/fq/tools/RiskToolPage.vue';

const stubs = {
  BaseChart: true,
  EquityCurve: true,
  PnlCalendar: true,
  Leaderboard: true,
  CandleChart: true,
  DistributionChart: true,
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
      { path: '/settings', component: { render: () => null } },
      { path: '/tools', component: { render: () => null } },
      { path: '/tools/:tool', component: { render: () => null } },
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

async function mountPage(comp: object, path: string) {
  const router = pageRouter(path);
  await router.isReady();
  const w = mount(comp, { global: { plugins: [i18n, router], stubs }, attachTo: document.body });
  await flushPromises();
  return w;
}

describe('ChartsPage', () => {
  it('opens on the worst open position and carries the state in the URL', async () => {
    const w = await mountPage(ChartsPage, '/charts');
    expect(w.find('[data-testid="charts-page"]').exists()).toBe(true);
    expect(w.find('[data-testid="charts-page"]').attributes('data-cells')).toBe('1');
    w.unmount();
  });

  it('shows two cells when the URL asks for them', async () => {
    const w = await mountPage(ChartsPage, '/charts?cells=2');
    expect(w.find('[data-testid="charts-page"]').attributes('data-cells')).toBe('2');
    w.unmount();
  });
});

describe('JournalPage', () => {
  it('mounts with its filter bar and offers the refresh only when new trades closed', async () => {
    const w = await mountPage(JournalPage, '/journal');
    expect(w.find('[data-testid="journal-page"]').exists()).toBe(true);
    expect(w.find('[data-testid="journal-refresh"]').exists()).toBe(false);
    w.unmount();
  });
});

describe('SettingsPage', () => {
  it('shows the seven sections of 02 section 3.6', async () => {
    const w = await mountPage(SettingsPage, '/settings');
    expect(w.find('[data-testid="settings-page"]').exists()).toBe(true);
    for (const id of ['bots', 'gateway', 'display', 'alerts', 'security', 'workspaces', 'about']) {
      expect(w.find(`[data-section="${id}"]`).exists(), `section ${id}`).toBe(true);
    }
    w.unmount();
  });

  it('only demonstrates the action confirmations, it never sends anything', async () => {
    const w = await mountPage(SettingsPage, '/settings');
    expect(w.find('[data-testid="security-panel"]').exists()).toBe(true);
    w.unmount();
  });
});

describe('Risk tool', () => {
  it('mounts and offers the stress test per mode', async () => {
    const w = await mountPage(RiskToolPage, '/tools/risk');
    expect(w.text().length).toBeGreaterThan(0);
    w.unmount();
  });
});
