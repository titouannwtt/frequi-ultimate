import { DOMWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

import ActionDialogHost from '../../../src/components/fq/ActionDialogHost.vue';
import BotActionBar from '../../../src/components/fq/BotActionBar.vue';
import CommandPalette from '../../../src/components/fq/CommandPalette.vue';
import TradeDrawer from '../../../src/components/fq/TradeDrawer.vue';
import { requestAction, useActionDialog } from '../../../src/composables/useActionDialog';
import { useCommandPalette } from '../../../src/composables/useCommandPalette';
import { useToaster } from '../../../src/composables/useToaster';
import { useFqEventsStore } from '../../../src/datasource/stores/events';
import { useFqConnectionStore } from '../../../src/datasource/stores/connection';
import type { BotAction } from '../../../src/datasource/types';
import type { BotRow, Position } from '../../../src/gateway/types.gen';
import { holdFor, mountFq, setupWorld, teardownWorld, type FqWorld } from './helpers';

/**
 * Money safety of the composites (docs/redesign/02-design.md, sections 10.2 and 11). Everything
 * goes to a fake source: nothing here can reach a bot.
 */
let world: FqWorld;
let botA: BotRow;
let botB: BotRow;
let posA: Position;
let posB: Position;

const exitOf = (
  p: Position,
  over: Partial<{ pair: string; isShort: boolean }> = {},
): BotAction => ({
  kind: 'forceexit',
  tradeId: p.trade_id,
  expected: { pair: p.pair, isShort: p.side === 'short', ...over },
});

beforeEach(() => {
  world = setupWorld();
  const dupes = world.fixture.positions.filter((p) => p.trade_id === 1180);
  posA = dupes[0]!;
  posB = dupes[1]!;
  botA = world.fixture.bots.find((b) => b.bot_key === posA.bot_key)!;
  botB = world.fixture.bots.find((b) => b.bot_key === posB.bot_key)!;
});
afterEach(teardownWorld);

const dialogEl = () => document.body.querySelector('[data-testid=confirm-dialog]');
const dom = (el: Element | null) => new DOMWrapper(el as HTMLElement);

function mountSurfaces(position: Position, bot: BotRow) {
  const Harness = defineComponent({
    setup: () => () =>
      h('div', [
        h(BotActionBar, { botKey: bot.bot_key, context: 'row', position, class: 'row-bar' }),
        h(TradeDrawer, { botKey: bot.bot_key, tradeId: position.trade_id, docked: true }),
        h(CommandPalette, { currentBotKey: bot.bot_key }),
        h(ActionDialogHost, { source: world.fake.source, inline: true }),
      ]),
  });
  return mountFq(Harness, { attachTo: document.body });
}

describe('the sources of truth: trade 1180 exists on two bots', () => {
  it('the fixture really has the same trade id on two different live bots', () => {
    expect(posA.trade_id).toBe(posB.trade_id);
    expect(posA.bot_key).not.toBe(posB.bot_key);
    expect(botA.identity.mode).toBe('live');
    expect(botB.identity.mode).toBe('live');
  });

  it('a request that mixes the two bots opens nothing', () => {
    // Bot A, but the position of bot B: the dialog would show one bot and act on the other
    const r = requestAction(botA.bot_key, exitOf(posB), { position: posB });
    expect(r).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(useActionDialog().current.value).toBeNull();
  });

  it('an exit built from the other bot position (other side) is refused by the store lookup', () => {
    // No context: the position is read for (botA, 1180) and must agree with what was displayed
    const r = requestAction(botA.bot_key, exitOf(posA, { isShort: posA.side !== 'short' }));
    expect(r).toMatchObject({ ok: false, reason: 'mismatch' });
    const r2 = requestAction(botA.bot_key, exitOf(posA, { pair: 'DOGE/USDC:USDC' }));
    expect(r2).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(useActionDialog().current.value).toBeNull();
  });

  it('a single exit with no expected state is refused', () => {
    const r = requestAction(botA.bot_key, { kind: 'forceexit', tradeId: 1180 } as BotAction);
    expect(r).toMatchObject({ ok: false, reason: 'mismatch' });
  });

  it('an unknown trade of a known bot is refused (missing state), never sent blind', () => {
    const r = requestAction(botA.bot_key, {
      kind: 'forceexit',
      tradeId: 999_999,
      expected: { pair: 'TAO/USDC:USDC', isShort: false },
    });
    expect(r).toMatchObject({ ok: false, reason: 'missing_state' });
  });

  it('a lock removal is not looked up among the trades: its id is a lock id', () => {
    // No trade 999987 on the bot: the lock request must still open (it is not a trade action)
    const free = requestAction(botA.bot_key, { kind: 'lock_delete', lockId: 999_987 });
    expect(free).toEqual({ ok: true });
    expect(useActionDialog().current.value?.context.position).toBeNull();
    useActionDialog().close();

    // A lock whose id equals the id of an open trade must not borrow that trade as context
    const same = requestAction(botA.bot_key, { kind: 'lock_delete', lockId: posA.trade_id });
    expect(same).toEqual({ ok: true });
    expect(useActionDialog().current.value?.context.position).toBeNull();
  });

  it('a request for an unknown bot is refused', () => {
    expect(requestAction('local:1', { kind: 'stopbuy' })).toMatchObject({
      ok: false,
      reason: 'unknown_bot',
    });
  });

  it('exiting trade 1180 of bot B sends to bot B only, and leaves bot A free', async () => {
    const w = mountSurfaces(posB, botB);
    await nextTick();
    await w.get('[data-testid=trade-drawer] [data-action=exit]').trigger('click');
    await nextTick();
    const target = w.get('[data-testid=dialog-target]').text();
    expect(target).toContain(botB.identity.name);
    expect(target).toContain(botB.bot_key);
    expect(target).not.toContain(botA.identity.name);
    await holdFor(w.get('.hold-wrap button.hold'), 1000);
    expect(world.fake.acts).toHaveLength(1);
    expect(world.fake.acts[0]!.botKey).toBe(botB.bot_key);
    expect(world.fake.acts[0]!.action).toMatchObject({ kind: 'forceexit', tradeId: 1180 });

    // Bot A holds trade 1180 too: its lock key is its own, it is not busy and can be requested
    const other = requestAction(botA.bot_key, exitOf(posA), { position: posA });
    expect(other.ok).toBe(true);
    // ... and the dialog names bot A, not bot B
    await nextTick();
    expect(w.get('[data-testid=dialog-target]').text()).toContain(botA.identity.name);
  });
});

describe('a double submit is impossible across the surfaces of one action', () => {
  it('row button, drawer, palette and a second dialog all end on a single request', async () => {
    world.fake.next.delayMs = 500;
    const w = mountSurfaces(posA, botA);
    await nextTick();

    // 1. The row button opens the confirmation (nothing is sent yet)
    await w.get('.row-bar [data-action=exit]').trigger('click');
    await nextTick();
    expect(dialogEl()).not.toBeNull();
    expect(world.fake.acts).toHaveLength(0);

    // 2. While that dialog is open no other surface can open a second one
    await w.get('[data-testid=trade-drawer] [data-action=exit]').trigger('click');
    expect(document.body.querySelectorAll('[data-testid=confirm-dialog]')).toHaveLength(1);

    // 3. Hold 1 s: one request is in flight
    await holdFor(w.get('.hold-wrap button.hold'), 1000);
    expect(world.fake.acts).toHaveLength(1);
    expect(w.get('.row-bar [data-action=exit]').attributes('aria-busy')).toBe('true');
    expect(w.get('[data-testid=trade-drawer] [data-action=exit]').attributes('aria-busy')).toBe(
      'true',
    );

    // 4. Hammer every surface while it is in flight
    await w.get('.row-bar [data-action=exit]').trigger('click');
    await w.get('[data-testid=trade-drawer] [data-action=exit]').trigger('click');
    useCommandPalette().show();
    await nextTick();
    const input = document.body.querySelector(
      '[data-testid=command-palette] input',
    ) as HTMLInputElement;
    await dom(input).setValue(`exit ${botA.bot_key} tao`);
    const item = document.body.querySelector(
      `[data-item="act:${botA.bot_key}:exit:${posA.trade_id}"]`,
    );
    expect(item).not.toBeNull();
    await dom(item).trigger('click');
    await nextTick();
    expect(world.fake.acts).toHaveLength(1);

    // 5. The answer arrives: still one request, and the lock holds until the fill is seen
    await vi.advanceTimersByTimeAsync(600);
    expect(world.fake.acts).toHaveLength(1);
    expect(dialogEl()).toBeNull();
    expect(w.get('.row-bar [data-action=exit]').attributes('aria-busy')).toBe('true');
    await w.get('[data-testid=trade-drawer] [data-action=exit]').trigger('click');
    await nextTick();
    expect(dialogEl()).toBeNull();
    expect(world.fake.acts).toHaveLength(1);

    // Opening the same action from the palette again only says "already running"
    useCommandPalette().show();
    await nextTick();
    await dom(document.body.querySelector('[data-testid=command-palette] input')).setValue(
      `exit ${botA.bot_key} tao`,
    );
    await dom(
      document.body.querySelector(`[data-item="act:${botA.bot_key}:exit:${posA.trade_id}"]`),
    ).trigger('click');
    await nextTick();
    expect(dialogEl()).toBeNull();
    expect(useToaster().toasts.value.some((t) => t.kind === 'verify')).toBe(true);
    expect(world.fake.acts).toHaveLength(1);

    // 6. The fill of that very trade releases the lock; a new, deliberate exit is possible again
    useFqEventsStore().add({
      kind: 'exit_fill',
      ts_ms: Date.now(),
      bot_key: botA.bot_key,
      trade_id: posA.trade_id,
      pair: posA.pair,
      profit_abs: -1,
      severity: null,
      detail: null,
    });
    await nextTick();
    expect(w.get('.row-bar [data-action=exit]').attributes('aria-busy')).toBeUndefined();
    await w.get('.row-bar [data-action=exit]').trigger('click');
    await nextTick();
    expect(dialogEl()).not.toBeNull();
    await holdFor(w.get('.hold-wrap button.hold'), 1000);
    await vi.advanceTimersByTimeAsync(600);
    expect(world.fake.acts).toHaveLength(2);
    // A new intent has a new idempotency key
    expect(world.fake.acts[1]!.key).not.toBe(world.fake.acts[0]!.key);
  });

  it('the fill of ANOTHER bot with the same trade id does not release the lock', async () => {
    const w = mountSurfaces(posA, botA);
    await nextTick();
    await w.get('.row-bar [data-action=exit]').trigger('click');
    await nextTick();
    await holdFor(w.get('.hold-wrap button.hold'), 1000);
    await vi.advanceTimersByTimeAsync(10);
    expect(world.fake.acts).toHaveLength(1);
    useFqEventsStore().add({
      kind: 'exit_fill',
      ts_ms: Date.now(),
      bot_key: botB.bot_key,
      trade_id: 1180,
      pair: posB.pair,
      profit_abs: 3,
      severity: null,
      detail: null,
    });
    await nextTick();
    expect(w.get('.row-bar [data-action=exit]').attributes('aria-busy')).toBe('true');
  });

  it('an unauthorised answer is not replayed: Retry opens a NEW confirmation', async () => {
    world.fake.next.result = { status: 'unauthorized', httpStatus: 401, error: 'unauthorized' };
    const w = mountSurfaces(posA, botA);
    await nextTick();
    await w.get('.row-bar [data-action=exit]').trigger('click');
    await nextTick();
    await holdFor(w.get('.hold-wrap button.hold'), 1000);
    await vi.advanceTimersByTimeAsync(10);
    expect(world.fake.acts).toHaveLength(1);
    expect(dialogEl()).toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(world.fake.acts).toHaveLength(1);
    // Retry = a fresh confirmation, nothing sent until the hold completes again
    const retry = useActionDialog().retryLast();
    expect(retry.ok).toBe(true);
    await nextTick();
    expect(dialogEl()).not.toBeNull();
    expect(world.fake.acts).toHaveLength(1);
  });
});

describe('what can never be offered or opened', () => {
  it('an orphan position has no exit: no button, no palette entry, no dialog', async () => {
    const orphan = world.fixture.positions.find((p) => p.orphan)!;
    const w = mountFq(BotActionBar, {
      props: { botKey: orphan.bot_key, context: 'row', position: orphan },
      attachTo: document.body,
    });
    await nextTick();
    expect(w.find('[data-action=exit]').exists()).toBe(false);
    expect(w.find('[data-action=reconcile]').exists()).toBe(true);
    expect(requestAction(botA.bot_key, exitOf(orphan), { position: orphan })).toMatchObject({
      ok: false,
    });
    expect(useActionDialog().current.value).toBeNull();
    mountFq(CommandPalette, { attachTo: document.body });
    useCommandPalette().show();
    await nextTick();
    await dom(document.body.querySelector('[data-testid=command-palette] input')).setValue('pengu');
    expect(document.body.querySelector(`[data-item^="act:${orphan.bot_key}:exit"]`)).toBeNull();
  });

  it('a bot that does not answer cannot be acted on (offline, stale, expired, starting, stopped)', () => {
    const states = world.fixture.bots.filter((b) => b.state.status !== 'online');
    expect(states.length).toBeGreaterThanOrEqual(4);
    for (const b of states) {
      const r = requestAction(b.bot_key, { kind: 'stopbuy' });
      expect(r.ok, `${b.identity.name} (${b.state.status})`).toBe(false);
    }
    const staleBot = world.fixture.bots.find(
      (b) => b.state.status === 'online' && b.freshness.state?.stale,
    );
    if (staleBot) expect(requestAction(staleBot.bot_key, { kind: 'stopbuy' }).ok).toBe(false);
    expect(useActionDialog().current.value).toBeNull();
  });

  it('nothing opens while the data comes from the cache or the connection is not live', () => {
    const conn = useFqConnectionStore();
    conn.fromCache = true;
    expect(requestAction(botA.bot_key, { kind: 'stopbuy' })).toMatchObject({
      ok: false,
      reason: 'not_actionable',
      disabled: 'cache',
    });
    conn.fromCache = false;
    conn.setStatus({ ...conn.status, state: 'connecting' });
    expect(requestAction(botA.bot_key, { kind: 'stopbuy' })).toMatchObject({
      ok: false,
      disabled: 'connecting',
    });
    conn.setStatus({ ...conn.status, state: 'offline' });
    expect(requestAction(botA.bot_key, exitOf(posA), { position: posA }).ok).toBe(false);
    expect(useActionDialog().current.value).toBeNull();
    conn.setStatus({ ...conn.status, state: 'live' });
    expect(requestAction(botA.bot_key, { kind: 'stopbuy' }).ok).toBe(true);
  });

  it('the palette actions always go through the confirmation, never straight to the bot', async () => {
    mountFq(CommandPalette, { props: { currentBotKey: botA.bot_key }, attachTo: document.body });
    useCommandPalette().show();
    await nextTick();
    await dom(document.body.querySelector('[data-testid=command-palette] input')).setValue('stop');
    const item = document.body.querySelector(`[data-item="act:${botA.bot_key}:stop:"]`);
    expect(item).not.toBeNull();
    await dom(item).trigger('click');
    await nextTick();
    expect(useActionDialog().current.value).toMatchObject({
      botKey: botA.bot_key,
      action: { kind: 'stop' },
    });
    expect(world.fake.acts).toHaveLength(0);
    // Pressing Enter on it again while the dialog is open does not stack a second one
    expect(requestAction(botB.bot_key, { kind: 'stop' })).toMatchObject({
      ok: false,
      reason: 'dialog_open',
    });
  });

  it('a disabled palette entry (bot offline) can not be run', async () => {
    const offline = world.fixture.bots.find((b) => b.state.status === 'offline')!;
    mountFq(CommandPalette, { attachTo: document.body });
    useCommandPalette().show();
    await nextTick();
    await dom(document.body.querySelector('[data-testid=command-palette] input')).setValue(
      `stop ${offline.identity.name}`,
    );
    const item = document.body.querySelector(`[data-item="act:${offline.bot_key}:stop:"]`);
    expect(item?.getAttribute('aria-disabled')).toBe('true');
    await dom(item).trigger('click');
    expect(useActionDialog().current.value).toBeNull();
  });
});

describe('the quantity of an exit is chosen in the confirmation, not in the drawer', () => {
  it('the foot of the drawer offers no share: Exit opens the dialog on 100 %', async () => {
    const w = mountSurfaces(posA, botA);
    await nextTick();
    expect(
      w.findAll('[data-testid=trade-drawer] button').some((b) => /^\d+ %$/.test(b.text().trim())),
    ).toBe(false);
    await w.get('[data-testid=trade-drawer] [data-action=exit]').trigger('click');
    await nextTick();
    const checked = w.get('[data-testid=confirm-dialog] [role=radio][aria-checked=true]');
    expect(checked.text()).toBe('100 %');
    expect(world.fake.acts).toHaveLength(0);
  });

  it.each([
    ['100 %', undefined],
    ['50 %', 0.5],
    ['25 %', 0.25],
  ])(
    '%s in the dialog sends one forceexit with the matching amount, after the hold',
    async (label, share) => {
      const w = mountSurfaces(posA, botA);
      await nextTick();
      await w.get('[data-testid=trade-drawer] [data-action=exit]').trigger('click');
      await nextTick();
      const radio = w
        .findAll('[data-testid=confirm-dialog] [role=radio]')
        .find((b) => b.text().trim() === label)!;
      await radio.trigger('click');
      await nextTick();
      // Nothing is sent by choosing a quantity
      expect(world.fake.acts).toHaveLength(0);
      // The amount it stands for is said in the dialog
      expect(w.get('[data-testid=dialog-qty-note]').text()).toContain('USDC');
      await holdFor(w.get('.hold-wrap button.hold'), 1000);
      await vi.advanceTimersByTimeAsync(10);
      expect(world.fake.acts).toHaveLength(1);
      const sent = world.fake.acts[0]!;
      expect(sent.botKey).toBe(botA.bot_key);
      expect(sent.action).toMatchObject({ kind: 'forceexit', tradeId: posA.trade_id });
      const amount = (sent.action as { amount?: number }).amount;
      if (share === undefined) expect(amount).toBeUndefined();
      else expect(amount).toBeCloseTo(posA.amount * share, 6);
    },
  );
});
