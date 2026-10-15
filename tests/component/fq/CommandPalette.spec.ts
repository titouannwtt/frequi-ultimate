import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DOMWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

import CommandPalette from '../../../src/components/fq/CommandPalette.vue';
import { FIXTURE_NOW } from '../../../src/components/fq/fixtures';
import { resetActionDialog, useActionDialog } from '../../../src/composables/useActionDialog';
import { useCommandPalette } from '../../../src/composables/useCommandPalette';
import { useFqPositionsStore } from '../../../src/datasource/stores/positions';
import type { Position } from '../../../src/gateway/types.gen';
import { mountFq, setupWorld, teardownWorld, type FqWorld } from './helpers';

let world: FqWorld;
let mine: Position[];
beforeEach(() => {
  world = setupWorld();
  // A bot that can act and has several open positions, so that "exit <bot>" lists their exits
  const ok = world.fixture.bots.filter((b) => b.state.status === 'online');
  const bot = ok.find(
    (b) => world.fixture.positions.filter((p) => p.bot_key === b.bot_key && !p.orphan).length >= 3,
  )!;
  mine = world.fixture.positions.filter((p) => p.bot_key === bot.bot_key && !p.orphan);
});
afterEach(() => {
  resetActionDialog();
  teardownWorld();
});

async function openPalette() {
  mountFq(CommandPalette, { attachTo: document.body });
  useCommandPalette().show();
  await nextTick();
  await nextTick();
  // The palette is teleported to the body
  const w = new DOMWrapper(document.body);
  const input = w.get('[data-testid=command-palette] input');
  await input.setValue(`exit ${mine[0]!.bot_key}`);
  return { w, input };
}

const itemId = (p: Position) => `act:${p.bot_key}:exit:${p.trade_id}`;
const highlighted = (w: DOMWrapper<HTMLElement>) => {
  const on = w.find('.opt.on');
  return on.exists() ? (on.attributes('data-item') ?? null) : null;
};

async function arrowTo(w: DOMWrapper<HTMLElement>, input: DOMWrapper<HTMLElement>, id: string) {
  for (let i = 0; i < 60 && highlighted(w) !== id; i++) {
    await input.trigger('keydown', { key: 'ArrowDown' });
  }
  expect(highlighted(w)).toBe(id);
}

function closePosition(p: Position) {
  useFqPositionsStore().apply({
    kind: 'delta',
    seq: 100,
    ts: FIXTURE_NOW,
    replace: [],
    upsert: {},
    remove: { positions: [`${p.bot_key}/${p.trade_id}`] },
  } as never);
}

describe('CommandPalette: the highlighted entry is an id, not an index (B74)', () => {
  it('a row closing above the highlighted one does not move Enter to another trade', async () => {
    const { w, input } = await openPalette();
    const chosen = mine[1]!;
    await arrowTo(w, input, itemId(chosen));

    closePosition(mine[0]!);
    await nextTick();
    // The highlight stays on the same entry
    expect(highlighted(w)).toBe(itemId(chosen));

    await input.trigger('keydown', { key: 'Enter' });
    const req = useActionDialog().current.value;
    expect(req?.action).toMatchObject({ kind: 'forceexit', tradeId: chosen.trade_id });
    expect(req?.botKey).toBe(chosen.bot_key);
  });

  it('the highlighted entry vanishing clears the selection: Enter runs nothing', async () => {
    const { w, input } = await openPalette();
    const chosen = mine[1]!;
    await arrowTo(w, input, itemId(chosen));

    closePosition(chosen);
    await nextTick();
    expect(highlighted(w)).toBeNull();

    await input.trigger('keydown', { key: 'Enter' });
    expect(useActionDialog().current.value).toBeNull();

    // The selection is not resurrected by the entry reappearing
    useFqPositionsStore().apply({
      kind: 'delta',
      seq: 101,
      ts: FIXTURE_NOW,
      replace: [],
      upsert: { positions: { [`${chosen.bot_key}/${chosen.trade_id}`]: chosen } },
      remove: {},
    } as never);
    await nextTick();
    expect(highlighted(w)).toBeNull();

    // Arrow keys recover a selection from the top
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(highlighted(w)).not.toBeNull();
  });

  it('typing re-highlights the first entry', async () => {
    const { w, input } = await openPalette();
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.setValue('fleet');
    const first = w.find('.opt');
    expect(first.classes()).toContain('on');
  });
});
