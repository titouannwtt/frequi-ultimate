import { DOMWrapper, flushPromises } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';

import { useActionDialog } from '../../../src/composables/useActionDialog';
import type { DataSource } from '../../../src/datasource/types';
import { useBotConfigEditorStore } from '../../../src/stores/botConfigEditorStore';
import { mountFq, setupWorld, teardownWorld, type FqWorld } from './helpers';

// The raw tab hosts Monaco, which has no place in a DOM test: a textarea with the same contract.
vi.mock('../../../src/components/strategyDev/CodeEditor.vue', () => ({
  default: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    render(this: { modelValue: string; $emit: (e: string, v: string) => void }) {
      return h('textarea', {
        'data-testid': 'raw',
        value: this.modelValue,
        onInput: (e: Event) =>
          this.$emit('update:modelValue', (e.target as HTMLTextAreaElement).value),
      });
    },
  },
}));

const mocked = vi.hoisted(() => ({ source: null as unknown }));
vi.mock('../../../src/composables/useDataSource', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    useDataSource: () => ({ source: { value: mocked.source } }),
  };
});

import BotConfigEditorModal from '../../../src/components/ftbot/configEditor/BotConfigEditorModal.vue';

/**
 * The per-bot config editor (01 #138, 02 section 3.2 "Edit (diff review)"): it writes a file of a
 * live bot, so a save is a review of the changes plus the name of the bot typed back, sent once,
 * to THIS bot only.
 */
let world: FqWorld;
let bot: string;
let calls: Array<{ key: string; method: string; path: string; body?: unknown; confirm?: string }>;
let failures: Record<string, Error>;

const CONFIG = {
  entry_file: 'config_a.json',
  entry_editable: true,
  entry_content: '{\n  "max_open_trades": 3\n}',
  own: { max_open_trades: 3 },
  merged: {
    max_open_trades: 3,
    stake_amount: 100,
    tradable_balance_ratio: 0.99,
    last_stake_amount_min_ratio: 0.5,
    strategy: 'S1',
    stoploss: -0.1,
    minimal_roi: { '0': 0.05 },
    pairlists: [{ method: 'StaticPairList' }],
    stake_currency: 'USDC',
    exchange: { name: 'hyperliquid' },
  },
};

beforeEach(() => {
  world = setupWorld();
  bot = world.fixture.bots.find((b) => b.identity.mode === 'live')!.bot_key;
  calls = [];
  failures = {};
  mocked.source = {
    ...world.fake.source,
    proxy: vi.fn(
      async (
        key: string,
        method: string,
        path: string,
        body?: unknown,
        opts?: { confirmBot?: string },
      ) => {
        calls.push({ key, method, path, body, confirm: opts?.confirmBot });
        const failure = failures[`${method} ${path}`];
        if (failure) throw failure;
        if (path === '/stratdev/editor/bot-config') return CONFIG;
        if (path === '/stratdev/editor/config-fields') return [];
        if (path === '/stratdev/configs') return { strategies: ['S1'] };
        if (path === '/stratdev/editor/validate') return { errors: [] };
        if (path === '/stratdev/editor/file') return { ok: true };
        throw new Error(`unexpected ${method} ${path}`);
      },
    ),
  } as unknown as DataSource;
});
afterEach(teardownWorld);

const body = () => new DOMWrapper(document.body);

async function openEditor(mode = 'live') {
  const w = mountFq(BotConfigEditorModal, {
    global: { plugins: [[PrimeVue, { unstyled: true }]] },
    attachTo: document.body,
  });
  const name = world.fixture.bots.find((b) => b.bot_key === bot)!.identity.name;
  void useBotConfigEditorStore().open(bot, name, mode);
  await flushPromises();
  return { w, name };
}

async function editRaw(json: string) {
  const tab = body()
    .findAll('button')
    .find((b) => b.text() === 'Raw JSON')!;
  await tab.trigger('click');
  const ta = body().get('[data-testid=raw]');
  await ta.setValue(json);
  await vi.advanceTimersByTimeAsync(500);
  await flushPromises();
}

describe('BotConfigEditor', () => {
  it('mounted after the config was loaded (the Bot page mounts it on first use), it starts clean (B159)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const name = world.fixture.bots.find((b) => b.bot_key === bot)!.identity.name;
    await useBotConfigEditorStore().open(bot, name, 'live');
    expect(useBotConfigEditorStore().botConfig).not.toBeNull();
    const w = mountFq(BotConfigEditorModal, {
      global: { plugins: [[PrimeVue, { unstyled: true }]] },
      attachTo: document.body,
    });
    await flushPromises();
    // The watch that reads the config runs at once: it used the ROI rows before they existed
    expect(errors.mock.calls.flat().map(String).join('\n')).not.toContain('roiRows');
    expect(body().get('[data-testid=config-editor-title]').exists()).toBe(true);
    w.unmount();
    errors.mockRestore();
  });

  it('reads the config of the chosen bot through the data source, reads only', async () => {
    await openEditor();
    expect(calls.map((c) => `${c.key} ${c.method} ${c.path}`)).toContain(
      `${bot} GET /stratdev/editor/bot-config`,
    );
    expect(calls.every((c) => c.method === 'GET' || c.path.endsWith('/validate'))).toBe(true);
    expect(body().get('[data-testid=config-editor-live]').exists()).toBe(true);
    // No em dash in the title
    expect(body().get('[data-testid=config-editor-title]').text()).not.toContain('—');
  });

  it('saving is a review of the changes plus the typed bot name, then one write to this bot', async () => {
    const { name } = await openEditor();
    await editRaw('{\n  "max_open_trades": 5\n}');

    // The Save button only opens the review: nothing is written yet
    await body().get('[data-testid=config-editor-save]').trigger('click');
    await flushPromises();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/stratdev/editor/file')).toBe(
      false,
    );
    const review = body().get('[data-testid=config-editor-review]');
    expect(review.text()).toContain('max_open_trades');
    expect(review.text()).toContain('3');
    expect(review.text()).toContain('5');
    expect(body().get('[data-testid=config-editor-review-live]').exists()).toBe(true);

    // The confirm button stays disabled until the name of the bot is typed back
    const confirm = body().get('[data-testid=config-editor-confirm]');
    expect(confirm.attributes('disabled')).toBeDefined();
    await body().get('[data-testid=config-editor-typed]').setValue('not-the-bot');
    expect(body().get('[data-testid=config-editor-confirm]').attributes('disabled')).toBeDefined();
    await body().get('[data-testid=config-editor-typed]').setValue(name);
    expect(
      body().get('[data-testid=config-editor-confirm]').attributes('disabled'),
    ).toBeUndefined();

    await body().get('[data-testid=config-editor-confirm]').trigger('click');
    await flushPromises();
    const writes = calls.filter((c) => c.method === 'POST' && c.path === '/stratdev/editor/file');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.key).toBe(bot);
    expect(writes[0]!.confirm).toBe(name);
    expect(writes[0]!.body).toMatchObject({ path: 'config_a.json' });
    expect(String((writes[0]!.body as { content: string }).content)).toContain(
      '"max_open_trades": 5',
    );
  });

  it('"reload now" after the save goes through the confirmation dialog of this bot', async () => {
    const { name } = await openEditor();
    await editRaw('{\n  "max_open_trades": 5\n}');
    await body().get('[data-testid=config-editor-save]').trigger('click');
    await flushPromises();
    await body().get('[data-testid=config-editor-typed]').setValue(name);
    await body().get('[data-testid=config-editor-confirm]').trigger('click');
    await flushPromises();
    const reload = body()
      .findAll('button')
      .find((b) => b.text().includes('Reload'))!;
    await reload.trigger('click');
    await flushPromises();
    const req = useActionDialog().current.value;
    expect(req?.botKey).toBe(bot);
    expect(req?.action).toEqual({ kind: 'reload_config' });
    // Nothing was sent to the bot by the editor itself
    expect(world.fake.acts).toHaveLength(0);
  });

  it('a failed write is reported and never retried', async () => {
    failures['POST /stratdev/editor/file'] = new Error('HTTP 502');
    const { name } = await openEditor();
    await editRaw('{\n  "max_open_trades": 5\n}');
    await body().get('[data-testid=config-editor-save]').trigger('click');
    await flushPromises();
    await body().get('[data-testid=config-editor-typed]').setValue(name);
    await body().get('[data-testid=config-editor-confirm]').trigger('click');
    await flushPromises();
    expect(useBotConfigEditorStore().saveError).toBe('HTTP 502');
    expect(calls.filter((c) => c.path === '/stratdev/editor/file')).toHaveLength(1);
  });

  it('a bot without the editor endpoints says so (404), instead of a blank dialog', async () => {
    failures['GET /stratdev/editor/bot-config'] = Object.assign(new Error('not found'), {
      status: 404,
    });
    await openEditor();
    expect(useBotConfigEditorStore().loadError).toBe('unsupported');
    expect(body().text()).toContain('Backend not supported');
  });
});
