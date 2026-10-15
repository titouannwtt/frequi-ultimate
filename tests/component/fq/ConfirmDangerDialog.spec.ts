import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import ConfirmDangerDialog from '../../../src/components/fq/ConfirmDangerDialog.vue';
import type { BotAction } from '../../../src/datasource/types';
import type { BotRow, Position } from '../../../src/gateway/types.gen';
import { holdFor, mountFq, setupWorld, teardownWorld, type FqWorld } from './helpers';

let world: FqWorld;
let liveBot: BotRow;
let dryBot: BotRow;
let livePos: Position;
let dryPos: Position;

beforeEach(() => {
  world = setupWorld();
  const { bots, positions } = world.fixture;
  const ok = (b: BotRow) => b.state.status === 'online' && !b.freshness.state?.stale;
  liveBot = bots.find((b) => b.identity.mode === 'live' && ok(b))!;
  dryBot = bots.find((b) => b.identity.mode === 'dry' && ok(b))!;
  livePos = positions.find((p) => p.bot_key === liveBot.bot_key && !p.orphan)!;
  dryPos = positions.find((p) => p.bot_key === dryBot.bot_key && !p.orphan)!;
});
afterEach(teardownWorld);

const exitOf = (p: Position): BotAction => ({
  kind: 'forceexit',
  tradeId: p.trade_id,
  expected: { pair: p.pair, isShort: p.side === 'short' },
});

function mountDialog(bot: BotRow, action: BotAction, position: Position | null = null, extra = {}) {
  return mountFq(ConfirmDangerDialog, {
    props: {
      open: true,
      inline: true,
      action,
      position,
      source: world.fake.source,
      target: {
        botKey: bot.bot_key,
        name: bot.identity.name,
        tradeId: action.kind === 'forceexit' ? action.tradeId : undefined,
      },
      ...extra,
    },
    attachTo: document.body,
  });
}

describe('ConfirmDangerDialog: live exits', () => {
  it('names the target bot, its key and the trade before anything else', async () => {
    const w = mountDialog(liveBot, exitOf(livePos), livePos);
    await nextTick();
    const target = w.get('[data-testid=dialog-target]').text();
    expect(target).toContain(liveBot.identity.name);
    expect(target).toContain(liveBot.bot_key);
    expect(target).toContain(`#${livePos.trade_id}`);
    expect(w.get('[data-testid=confirm-dialog]').classes()).toContain('lvl-live');
  });

  it('a click can never fire a live exit: the button is a hold button, not a click button', async () => {
    const w = mountDialog(liveBot, exitOf(livePos), livePos);
    await nextTick();
    expect(w.find('[data-testid=dialog-confirm]').exists()).toBe(false);
    const go = w.get('.hold-wrap button.hold');
    await go.trigger('click');
    await go.trigger('click');
    await go.trigger('dblclick');
    await go.trigger('keydown', { key: 'Enter', repeat: true });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(world.fake.acts).toHaveLength(0);
  });

  it('a hold shorter than 1 s sends nothing; the full 1 s sends exactly once', async () => {
    const w = mountDialog(liveBot, exitOf(livePos), livePos);
    await nextTick();
    const go = w.get('.hold-wrap button.hold');
    await holdFor(go, 999);
    expect(world.fake.acts).toHaveLength(0);
    await go.trigger('pointerup');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(world.fake.acts).toHaveLength(0);

    await holdFor(go, 1000);
    expect(world.fake.acts).toHaveLength(1);
    const sent = world.fake.acts[0]!;
    expect(sent.botKey).toBe(liveBot.bot_key);
    expect(sent.action).toMatchObject({ kind: 'forceexit', tradeId: livePos.trade_id });
    // A full exit carries the state the user saw and no amount
    expect(sent.action).toMatchObject({
      expected: { pair: livePos.pair, isShort: livePos.side === 'short' },
    });
    expect((sent.action as { amount?: number }).amount).toBeUndefined();
    expect(sent.key).toMatch(/[0-9a-f-]{20,}/);
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('a partial exit sends the amount of the chosen share, never more than the position', async () => {
    const w = mountDialog(liveBot, exitOf(livePos), livePos, { initialFraction: 0.5 });
    await nextTick();
    await holdFor(w.get('.hold-wrap button.hold'), 1000);
    expect(world.fake.acts).toHaveLength(1);
    const a = world.fake.acts[0]!.action as { amount?: number };
    expect(a.amount).toBeCloseTo(livePos.amount * 0.5, 6);
    expect(a.amount!).toBeLessThan(livePos.amount);
  });

  it('a partial exit under the 10 USDC minimum cannot be confirmed', async () => {
    const tiny = { ...livePos, notional: 30, stake_amount: 15 };
    const w = mountDialog(liveBot, exitOf(tiny), tiny, { initialFraction: 0.25 });
    await nextTick();
    const go = w.get('.hold-wrap button.hold');
    expect(go.attributes('aria-disabled')).toBe('true');
    await holdFor(go, 1500);
    expect(world.fake.acts).toHaveLength(0);
    expect(w.text()).toContain('10');
  });

  it('Cancel, Escape and the scrim close without sending', async () => {
    const w = mountDialog(liveBot, exitOf(livePos), livePos);
    await nextTick();
    await w.get('button.cancel').trigger('click');
    await w.get('[data-testid=confirm-dialog]').trigger('keydown', { key: 'Escape' });
    await w.get('.scrim').trigger('click');
    expect(w.emitted('close')).toHaveLength(3);
    expect(world.fake.acts).toHaveLength(0);
  });

  it('an unknown outcome (the request threw) never releases a second send on its own', async () => {
    world.fake.next.throws = true;
    const w = mountDialog(liveBot, exitOf(livePos), livePos);
    await nextTick();
    await holdFor(w.get('.hold-wrap button.hold'), 1000);
    expect(world.fake.acts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(world.fake.acts).toHaveLength(1);
  });
});

describe('ConfirmDangerDialog: destructive live actions need the typed bot name', () => {
  it.each<[string, BotAction]>([
    ['exit all', { kind: 'forceexit', tradeId: 'all' }],
    ['stop', { kind: 'stop' }],
    ['delete trade', { kind: 'delete_trade', tradeId: 7 }],
  ])('%s: the hold stays disabled until the exact name is typed', async (_n, action) => {
    const w = mountDialog(liveBot, action);
    await nextTick();
    expect(w.get('[data-testid=confirm-dialog]').classes()).toContain('lvl-live_destructive');
    const go = w.get('.hold-wrap button.hold');
    expect(go.attributes('aria-disabled')).toBe('true');
    await holdFor(go, 1500);
    expect(world.fake.acts).toHaveLength(0);

    const input = w.get('.typed input');
    await input.setValue(liveBot.identity.name.slice(0, -1));
    expect(w.get('.hold-wrap button.hold').attributes('aria-disabled')).toBe('true');
    await input.setValue(liveBot.identity.name.toUpperCase() + 'x');
    expect(w.get('.hold-wrap button.hold').attributes('aria-disabled')).toBe('true');
    await input.setValue(liveBot.identity.name);
    expect(w.get('.hold-wrap button.hold').attributes('aria-disabled')).not.toBe('true');

    await holdFor(w.get('.hold-wrap button.hold'), 1000);
    expect(world.fake.acts).toHaveLength(1);
    expect(world.fake.acts[0]!.botKey).toBe(liveBot.bot_key);
    // The typed name travels with the action, the bot checks it too
    expect(world.fake.acts[0]!.action).toMatchObject({ confirm: liveBot.identity.name });
  });

  it('the name of ANOTHER bot does not unlock it', async () => {
    const w = mountDialog(liveBot, { kind: 'stop' });
    await nextTick();
    await w.get('.typed input').setValue(dryBot.identity.name);
    expect(w.get('.hold-wrap button.hold').attributes('aria-disabled')).toBe('true');
    await holdFor(w.get('.hold-wrap button.hold'), 1500);
    expect(world.fake.acts).toHaveLength(0);
  });

  it('shows the always-on warnings: stop is relaunched by the script, exit all says to pause first', async () => {
    const stop = mountDialog(liveBot, { kind: 'stop' });
    await nextTick();
    expect(stop.find('.warns').exists()).toBe(true);
    stop.unmount();
    const all = mountDialog(liveBot, { kind: 'forceexit', tradeId: 'all' });
    await nextTick();
    expect(all.findAll('.warns li').length).toBeGreaterThan(0);
  });
});

describe('ConfirmDangerDialog: dry and reduce levels', () => {
  it('a dry exit is one click on a primary button, still naming the bot', async () => {
    const w = mountDialog(dryBot, exitOf(dryPos), dryPos);
    await nextTick();
    expect(w.get('[data-testid=dialog-target]').text()).toContain(dryBot.identity.name);
    expect(w.find('.hold-wrap').exists()).toBe(false);
    await w.get('[data-testid=dialog-confirm]').trigger('click');
    await vi.advanceTimersByTimeAsync(0);
    expect(world.fake.acts).toHaveLength(1);
    expect(world.fake.acts[0]!.botKey).toBe(dryBot.bot_key);
  });

  it('pause entries on a live bot is one click (it only reduces risk)', async () => {
    const w = mountDialog(liveBot, { kind: 'stopbuy' });
    await nextTick();
    expect(w.get('[data-testid=confirm-dialog]').classes()).toContain('lvl-reduce');
    await w.get('[data-testid=dialog-confirm]').trigger('click');
    await vi.advanceTimersByTimeAsync(0);
    expect(world.fake.acts).toHaveLength(1);
    expect(world.fake.acts[0]!.action.kind).toBe('stopbuy');
  });

  it('a double click on the one-click button sends once', async () => {
    world.fake.next.delayMs = 400;
    const w = mountDialog(dryBot, exitOf(dryPos), dryPos);
    await nextTick();
    const go = w.get('[data-testid=dialog-confirm]');
    await go.trigger('click');
    await go.trigger('click');
    await go.trigger('click');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(world.fake.acts).toHaveLength(1);
  });
});

describe('ConfirmDangerDialog: forced entry direction, freqtrade defaults to LONG (B75)', () => {
  const entry = (extra: Partial<BotAction> = {}) =>
    ({ kind: 'forceentry', pair: 'ETH/USDC:USDC', ...extra }) as BotAction;

  async function fill(w: ReturnType<typeof mountDialog>) {
    // The pair is prefilled; the stake is the field whose placeholder is the currency
    await w
      .findAll('input')
      .find((i) => i.attributes('placeholder') === 'USDC')!
      .setValue('25');
  }

  it('shows the direction choice, with no default, and the text names both sides', async () => {
    const w = mountDialog(liveBot, entry());
    await nextTick();
    const row = w.get('[data-testid=entry-side]');
    expect(row.text()).toMatch(/long/i);
    expect(row.text()).toMatch(/short/i);
    expect(row.findAll('[role=radio][aria-checked=true]')).toHaveLength(0);
  });

  it('cannot be sent without a direction, however long it is held', async () => {
    const w = mountDialog(liveBot, entry());
    await nextTick();
    await fill(w);
    const go = w.get('.hold-wrap button.hold');
    expect(go.attributes('aria-disabled')).toBe('true');
    await holdFor(go, 1500);
    expect(world.fake.acts).toHaveLength(0);
  });

  it('sends the chosen side, and changing it changes what is sent', async () => {
    const w = mountDialog(liveBot, entry());
    await nextTick();
    await fill(w);
    const radios = w.get('[data-testid=entry-side]').findAll('[role=radio]');
    await radios.find((r) => /short/i.test(r.text()))!.trigger('click');
    await holdFor(w.get('.hold-wrap button.hold'), 1000);
    expect(world.fake.acts).toHaveLength(1);
    expect(world.fake.acts[0]!.action).toMatchObject({ kind: 'forceentry', side: 'short' });
  });

  it('a reinforcement keeps the side of its position and shows no choice', async () => {
    const w = mountDialog(
      liveBot,
      entry({ pair: livePos.pair, side: livePos.side as 'long' | 'short' }),
      livePos,
    );
    await nextTick();
    expect(w.get('[data-testid=entry-side]').findAll('[role=radio]')).toHaveLength(0);
    await fill(w);
    await holdFor(w.get('.hold-wrap button.hold'), 1000);
    expect(world.fake.acts[0]!.action).toMatchObject({ kind: 'forceentry', side: livePos.side });
  });
});
