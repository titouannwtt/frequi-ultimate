import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import LegacyToolGate from '../../../src/components/fq/LegacyToolGate.vue';
import { mountFq, setFqLocale, setupWorld, teardownWorld } from './helpers';

// The gate reads the legacy bot store: a plain object stands in for it
const hoisted = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../../src/stores/ftbotwrapper', () => ({ useBotStore: () => hoisted.store }));

interface FakeBot {
  botId: string;
  botName: string;
  botStatusAvailable: boolean;
  botState: { runmode: string } | null;
  isWebserverMode: boolean;
}
const bot = (id: string, runmode: string, loaded = true): FakeBot => ({
  botId: id,
  botName: `name-${id}`,
  botStatusAvailable: loaded,
  botState: loaded ? { runmode } : null,
  isWebserverMode: runmode === 'webserver',
});

function store(bots: FakeBot[], selected: string) {
  const s = reactive({
    hasBots: bots.length > 0,
    selectedBot: selected,
    allBotStores: bots,
    get activeBot() {
      return bots.find((b) => b.botId === s.selectedBot);
    },
    selectBot: vi.fn((id: string) => (s.selectedBot = id)),
  });
  hoisted.store = s;
  return s;
}

function mountGate() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/tools', name: 'tools', component: { render: () => null } },
      { path: '/settings', name: 'settings', component: { render: () => null } },
    ],
  });
  return mountFq(LegacyToolGate, {
    props: { title: 'Backtest', subtitle: 'sub' },
    slots: { default: '<button data-testid="launch">Start</button>' },
    global: { plugins: [router] },
    attachTo: document.body,
  });
}

beforeEach(() => {
  setupWorld();
});
afterEach(() => {
  teardownWorld();
  hoisted.store = null;
});

describe('legacy tools on a trading bot (B195)', () => {
  it('says the tool is not available instead of mounting a form that can only fail', async () => {
    store([bot('ftbot.0', 'live')], 'ftbot.0');
    const w = mountGate();
    await flushPromises();
    const msg = w.find('[data-testid=legacy-unavailable]');
    expect(msg.exists()).toBe(true);
    expect(msg.text()).toContain('Not available on this bot');
    expect(msg.text()).toContain('name-ftbot.0');
    expect(msg.text()).toContain('webserver');
    // Nothing to launch: the tool itself is not mounted, so it never asks the bot for strategies,
    // exchanges or pairlists (the 503 of the QA)
    expect(w.find('[data-testid=launch]').exists()).toBe(false);
  });

  it('is in French too, with the mode of the bot and a way back to the Tools', async () => {
    store([bot('ftbot.0', 'dry_run')], 'ftbot.0');
    setFqLocale('fr');
    const w = mountGate();
    await flushPromises();
    const text = w.text();
    expect(text).toContain('Indisponible sur ce bot');
    expect(text).toContain('dry-run');
    expect(w.find('[data-testid=tool-frame] .back').text()).toContain('Outils');
  });

  it('offers to use a bot that is a webserver, and switches to it on request', async () => {
    const s = store([bot('ftbot.0', 'live'), bot('ftbot.1', 'webserver')], 'ftbot.0');
    const w = mountGate();
    await flushPromises();
    const use = w.findAll('button').find((b) => b.text().includes('Use name-ftbot.1'));
    expect(use).toBeDefined();
    await use!.trigger('click');
    expect(s.selectBot).toHaveBeenCalledWith('ftbot.1');
    await flushPromises();
    // The webserver bot can serve the tool: it is mounted now
    expect(w.find('[data-testid=launch]').exists()).toBe(true);
    expect(w.find('[data-testid=legacy-unavailable]').exists()).toBe(false);
  });

  it('waits for the state of the bot before deciding, and never mounts the tool on a guess', async () => {
    store([bot('ftbot.0', 'live', false)], 'ftbot.0');
    const w = mountGate();
    await flushPromises();
    expect(w.find('[data-testid=legacy-loading]').exists()).toBe(true);
    expect(w.find('[data-testid=launch]').exists()).toBe(false);
    expect(w.find('[data-testid=legacy-unavailable]').exists()).toBe(false);
    // A bot that never answers is said so instead of leaving a skeleton for ever
    await vi.advanceTimersByTimeAsync(13_000);
    await flushPromises();
    expect(w.find('[data-testid=legacy-silent]').exists()).toBe(true);
  });

  it('says so when no bot is registered', async () => {
    store([], '');
    const w = mountGate();
    await flushPromises();
    expect(w.find('[data-testid=legacy-no-bot]').exists()).toBe(true);
  });
});
