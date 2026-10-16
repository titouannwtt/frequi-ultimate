import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PrimeVue from 'primevue/config';
import { reactive } from 'vue';

import DownloadDataMain from '../../../src/components/ftbot/DownloadDataMain.vue';
import i18n from '../../../src/locales';

const hoisted = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../../src/stores/ftbotwrapper', () => ({ useBotStore: () => hoisted.store }));

function fakeStore(state: Record<string, unknown>, stake: string) {
  const startDataDownload = vi.fn();
  hoisted.store = reactive({
    selectedBot: 'ftbot.0',
    activeBot: {
      stakeCurrency: stake,
      exchangeList: [],
      getExchangeList: vi.fn(() => Promise.resolve()),
      botState: state,
      botFeatures: { downloadDataPrepend: false, downloadDataCandleTypes: false },
      startDataDownload,
    },
  });
  return startDataDownload;
}

beforeEach(() => {
  setActivePinia(createPinia());
  i18n.global.locale.value = 'fr';
});
afterEach(() => {
  hoisted.store = null;
  i18n.global.locale.value = 'en';
});

describe('Download data on the bot of the tool (B195)', () => {
  const mountIt = () =>
    mount(DownloadDataMain, {
      global: { plugins: [i18n, [PrimeVue, { unstyled: true }]] },
      attachTo: document.body,
    });

  it('starts from the stake currency and the market of the bot, not from BTC/USDT', async () => {
    fakeStore({ exchange: 'hyperliquid', trading_mode: 'futures' }, 'USDC');
    const w = mountIt();
    await flushPromises();
    const values = w.findAll('input').map((i) => (i.element as HTMLInputElement).value);
    expect(values).toContain('BTC/USDC:USDC');
    expect(values).toContain('ETH/USDC:USDC');
    expect(values).not.toContain('BTC/USDT');
    w.unmount();
  });

  it('speaks French and enables the button only when there is something to download', async () => {
    const start = fakeStore({ exchange: 'hyperliquid', trading_mode: 'futures' }, 'USDC');
    const w = mountIt();
    await flushPromises();
    const text = w.text();
    expect(text).toContain('Options avancées');
    expect(text).toContain('Lancer le téléchargement');
    expect(text).not.toContain('Start Download');
    expect(text).not.toContain('Advanced Options');
    const button = w.findAll('button').find((b) => b.text().includes('Lancer le téléchargement'))!;
    expect(button.attributes('disabled')).toBeUndefined();
    // No pair at all: nothing to launch
    for (const i of w.findAll('input')) {
      if ((i.element as HTMLInputElement).value.includes('/')) await i.setValue('');
    }
    await flushPromises();
    expect(button.attributes('disabled')).toBeDefined();
    await button.trigger('click');
    expect(start).not.toHaveBeenCalled();
    w.unmount();
  });
});
