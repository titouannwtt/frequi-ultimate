import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';

import { useFqFleetStore } from '../../../src/datasource/stores/fleet';
import { useStrategyDevStore } from '../../../src/stores/strategyDevStore';

// The legacy store polled only part of the fleet: the data layer knows the open trades of all
const hoisted = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../../src/stores/ftbotwrapper', () => ({ useBotStore: () => hoisted.store }));
vi.mock('../../../src/composables/useDataSource', () => ({
  useDataSource: () => ({
    source: ref({ registry: { botKeyOf: (id: string) => (id === 'ftbot.0' ? 'local:1' : null) } }),
  }),
}));

function legacyBot(openTrades: unknown[]) {
  return {
    isBotOnline: true,
    isTrading: true,
    botState: { strategy: 'Kelt', exchange: 'hyperliquid', dry_run: false },
    profitAll: undefined,
    trades: [],
    openTrades,
  };
}

describe('Strategy Dev live bot entries (B202)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('takes the open count from the data layer, not from the trades the legacy store polled', () => {
    hoisted.store = reactive({
      selectedBot: 'ftbot.0',
      availableBots: { 'ftbot.0': { botName: 'Kelt' }, 'ftbot.9': { botName: 'Other' } },
      botStores: { 'ftbot.0': legacyBot([]), 'ftbot.9': legacyBot([]) },
    });
    const fleet = useFqFleetStore();
    fleet.apply({ kind: 'snapshot', seq: 1, ts: 0, replace: ['bots'], upsert: {}, remove: {} });
    fleet.apply({
      kind: 'delta',
      seq: 2,
      ts: 0,
      replace: [],
      upsert: { bots: { 'local:1': { bot_key: 'local:1', state: { open_trades: 3 } } } as never },
      remove: {},
    });
    const s = useStrategyDevStore();
    const byId = Object.fromEntries(s.liveBotEntries.map((e) => [e.botId, e.open_trades_count]));
    expect(byId['ftbot.0']).toBe(3);
    // No registry match: the legacy figure, here the polled list (0 trades)
    expect(byId['ftbot.9']).toBe(0);
  });
});
