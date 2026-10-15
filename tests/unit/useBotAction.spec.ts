/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures and decoded wire frames */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFqEventsStore } from '@/datasource/stores/events';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import type { ActionResult, BotAction, DataSource } from '@/datasource/types';
import {
  ACCEPTED_LOCK_MAX_MS,
  confirmLevelOf,
  lockKeyOf,
  resetBotActionState,
  tradeIdOf,
  useBotAction,
} from '@/composables/useBotAction';
import { useInflightLock } from '@/composables/useInflightLock';
import { useToaster } from '@/composables/useToaster';

const LIVE = 'local:9400';
const DRY = 'local:9056';

const result = (over: Partial<ActionResult> = {}): ActionResult => ({
  status: 'accepted',
  botResponse: null,
  httpStatus: 200,
  error: null,
  verify: null,
  latencyMs: 3,
  ...over,
});

function fakeSource(impl: () => Promise<ActionResult> = async () => result()) {
  const act = vi.fn(impl);
  return { source: { act } as unknown as DataSource, act };
}

const exit = (tradeId: number | 'all' = 7): BotAction => ({
  kind: 'forceexit',
  tradeId,
  expected: { pair: 'BTC/USDC:USDC', isShort: false },
});

beforeEach(() => {
  setActivePinia(createPinia());
  resetBotActionState();
  useToaster().clear();
  const fleet = useFqFleetStore();
  fleet.apply({
    kind: 'snapshot',
    seq: 1,
    ts: 1,
    replace: ['bots'],
    upsert: {
      bots: {
        [LIVE]: { bot_key: LIVE, identity: { name: 'hippo_live', mode: 'live' } },
        [DRY]: { bot_key: DRY, identity: { name: 'dry_one', mode: 'dry' } },
      },
    } as any,
    remove: {},
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('confirmation levels (02 section 11.2)', () => {
  const live: Array<[BotAction, string]> = [
    [{ kind: 'stopbuy' }, 'reduce'],
    [exit(7), 'live'],
    [exit('all'), 'live_destructive'],
    [{ kind: 'forceentry', pair: 'ETH/USDC:USDC' }, 'live'],
    [{ kind: 'start' }, 'live'],
    [{ kind: 'stop' }, 'live_destructive'],
    [{ kind: 'reload_config' }, 'live'],
    [{ kind: 'delete_trade', tradeId: 3 }, 'live_destructive'],
    [{ kind: 'cancel_open_order', tradeId: 3 }, 'live'],
    [{ kind: 'reload_trade', tradeId: 3 }, 'live'],
    [{ kind: 'blacklist_add', pairs: ['X'] }, 'live'],
    [{ kind: 'blacklist_remove', pairs: ['X'] }, 'live'],
    [{ kind: 'lock_delete', lockId: 2 }, 'live'],
  ];

  it.each(live)('%j on a live bot is %s', (action, level) => {
    expect(confirmLevelOf(action, 'live')).toBe(level);
  });

  it('a dry bot gets the named one click confirmation, whatever the action', () => {
    for (const [action] of live) {
      expect(confirmLevelOf(action, 'dry')).toBe(action.kind === 'stopbuy' ? 'reduce' : 'dry');
    }
  });

  it('every live mutation needs the 1 s hold (legacy bug B2: the confirmation cannot be switched off)', () => {
    const { prepare } = useBotAction(LIVE);
    for (const [action, level] of live) {
      const p = prepare(action);
      expect(p.requiresHold).toBe(level === 'live' || level === 'live_destructive');
      expect(p.requiresTypedName).toBe(level === 'live_destructive');
    }
    // No option, setting or argument exists to relax it.
    expect(Object.keys(useBotAction(LIVE)).sort()).toEqual(
      ['bot', 'botName', 'isBusy', 'mode', 'prepare', 'submit'].sort(),
    );
  });

  it('an unknown bot is treated as live', () => {
    const { prepare } = useBotAction('local:1');
    expect(prepare(exit()).level).toBe('live');
  });
});

describe('keys', () => {
  it('builds bot_key:action:trade_id', () => {
    expect(lockKeyOf(LIVE, exit(7))).toBe(`${LIVE}:forceexit:7`);
    expect(lockKeyOf(LIVE, exit('all'))).toBe(`${LIVE}:forceexit:all`);
    expect(lockKeyOf(LIVE, { kind: 'stopbuy' })).toBe(`${LIVE}:stopbuy:-`);
    expect(lockKeyOf(LIVE, { kind: 'forceentry', pair: 'ETH/USDC:USDC' })).toBe(
      `${LIVE}:forceentry:ETH/USDC:USDC`,
    );
    expect(tradeIdOf({ kind: 'start' })).toBeNull();
  });

  it('gives each confirmed intent its own UUID', () => {
    const { prepare } = useBotAction(LIVE);
    const a = prepare(exit());
    const b = prepare(exit());
    expect(a.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
    expect(a.lockKey).toBe(b.lockKey);
  });
});

describe('submit: exactly one request, never a replay', () => {
  it('sends the action once with the idempotency key and the bot it was prepared for', async () => {
    const { source, act } = fakeSource();
    const { prepare, submit } = useBotAction(LIVE);
    const p = prepare(exit());
    useInflightLock().acquire(p.lockKey); // what the hold button does when it completes
    const r = await submit(p, { source });
    expect(r.status).toBe('accepted');
    expect(act).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledWith(LIVE, p.action, p.idempotencyKey);
  });

  it('refuses a duplicate submit while the first is in flight (legacy bug B3: no double sending)', async () => {
    let release!: (r: ActionResult) => void;
    const { source, act } = fakeSource(() => new Promise((res) => (release = res)));
    const { prepare, submit } = useBotAction(LIVE);
    const p = prepare(exit('all'));
    const first = submit(p, { source, typedName: 'hippo_live', notify: false });
    const second = await submit(p, { source, typedName: 'hippo_live', notify: false });
    expect(second.status).toBe('in_progress');
    expect(second.notSent).toBe(true);
    release(result());
    await first;
    expect(act).toHaveBeenCalledTimes(1);
  });

  it('shows the busy state of every surface until the final result', async () => {
    let release!: (r: ActionResult) => void;
    const { source } = fakeSource(() => new Promise((res) => (release = res)));
    const { prepare, submit, isBusy } = useBotAction(LIVE);
    const p = prepare({ kind: 'stopbuy' });
    expect(isBusy(p.action)).toBe(false);
    const pending = submit(p, { source, notify: false });
    expect(isBusy(p.action)).toBe(true);
    release(result());
    await pending;
    expect(isBusy(p.action)).toBe(false);
  });

  it('refuses a second action of another surface that holds the same lock', async () => {
    const { source, act } = fakeSource();
    const { prepare, submit } = useBotAction(LIVE);
    const p = prepare({ kind: 'stopbuy' });
    useInflightLock().acquire(p.lockKey); // another surface got there first
    const r = await submit(p, { source, notify: false });
    expect(r.status).toBe('in_progress');
    expect(act).not.toHaveBeenCalled();
  });

  it('needs the exact bot name for a destructive live action, and sends the typed name', async () => {
    const { source, act } = fakeSource();
    const { prepare, submit } = useBotAction(LIVE);
    const p = prepare(exit('all'));
    const bad = await submit(p, { source, typedName: 'hippo', notify: false });
    expect(bad).toMatchObject({ status: 'rejected', notSent: true });
    expect(act).not.toHaveBeenCalled();
    useInflightLock().acquire(p.lockKey);
    await submit(p, { source, typedName: 'hippo_live', notify: false });
    expect(act).toHaveBeenCalledTimes(1);
    expect((act.mock.calls[0]![1] as any).confirm).toBe('hippo_live');
  });

  it('gives back the lock the hold button took when the submit is refused before sending (B72)', async () => {
    const { source, act } = fakeSource();
    const { prepare, submit } = useBotAction(LIVE);
    const lock = useInflightLock();
    const p = prepare(exit('all'));
    lock.acquire(p.lockKey); // the hold button completed
    await submit(p, { source, typedName: 'wrong', notify: false });
    expect(lock.isLocked(p.lockKey)).toBe(false);
    const q = prepare(exit(7));
    lock.acquire(q.lockKey);
    await submit(q, { source: null, notify: false });
    expect(lock.isLocked(q.lockKey)).toBe(false);
    expect(act).not.toHaveBeenCalled();
  });

  it('treats an exception as `unknown` and never calls the source again', async () => {
    const { source, act } = fakeSource(async () => {
      throw new Error('socket hang up');
    });
    const { prepare, submit } = useBotAction(DRY);
    const r = await submit(prepare({ kind: 'stopbuy' }), { source, notify: false });
    expect(r.status).toBe('unknown');
    expect(r.verify).not.toBeNull();
    expect(act).toHaveBeenCalledTimes(1);
  });

  it('does not replay after a 401: it says nothing was executed and offers to retry', async () => {
    const { source, act } = fakeSource(async () =>
      result({ status: 'unauthorized', error: 'unauthorized' }),
    );
    const { prepare, submit, isBusy } = useBotAction(LIVE);
    const p = prepare(exit());
    useInflightLock().acquire(p.lockKey);
    const r = await submit(p, { source });
    expect(r.status).toBe('unauthorized');
    expect(act).toHaveBeenCalledTimes(1);
    expect(isBusy(p.action)).toBe(false);
    const toast = useToaster().toasts.value.at(-1)!;
    expect(toast.kind).toBe('err');
    expect(toast.actions?.map((a) => a.id)).toEqual(['retry']);
    // "Retry" is a NEW confirmation with a new intent key, not a resend.
    expect(useBotAction(LIVE).prepare(exit()).idempotencyKey).not.toBe(p.idempotencyKey);
  });

  it.each(['rejected', 'state_mismatch', 'unknown', 'in_progress'] as const)(
    'releases the lock on a final `%s` result',
    async (status) => {
      const { source } = fakeSource(async () => result({ status }));
      const { prepare, submit, isBusy } = useBotAction(LIVE);
      const p = prepare(exit());
      useInflightLock().acquire(p.lockKey);
      await submit(p, { source, notify: false });
      expect(isBusy(p.action)).toBe(false);
    },
  );

  it('rejects, without sending, when there is no data source', async () => {
    const { prepare, submit } = useBotAction(LIVE);
    const r = await submit(prepare({ kind: 'stopbuy' }), { source: null, notify: false });
    expect(r).toMatchObject({ status: 'rejected', error: 'unavailable', notSent: true });
  });
});

describe('two step result', () => {
  const fill = (tradeId: number | null, bot = LIVE) => ({
    kind: 'exit_fill' as const,
    ts_ms: 1,
    bot_key: bot,
    trade_id: tradeId,
    pair: 'BTC/USDC:USDC',
    profit_abs: 3,
    severity: null,
    detail: null,
  });

  it('says "transmitted" first and keeps the row busy until the fill arrives', async () => {
    const { source } = fakeSource();
    const { prepare, submit, isBusy } = useBotAction(LIVE);
    const p = prepare(exit(7));
    useInflightLock().acquire(p.lockKey);
    await submit(p, { source });
    expect(useToaster().toasts.value.at(-1)).toMatchObject({ kind: 'sent' });
    expect(isBusy(p.action)).toBe(true);
    useFqEventsStore().add(fill(8)); // another trade: still busy
    await Promise.resolve();
    expect(isBusy(p.action)).toBe(true);
    useFqEventsStore().add(fill(7));
    await Promise.resolve();
    expect(isBusy(p.action)).toBe(false);
    expect(useToaster().toasts.value.at(-1)).toMatchObject({
      kind: 'ok',
      title: expect.any(String),
    });
  });

  it('B77: a forced exit is done by an exit fill only: a DCA entry fill of the same trade does not release it', async () => {
    const { source } = fakeSource();
    const { prepare, submit, isBusy } = useBotAction(LIVE);
    const p = prepare(exit(7));
    useInflightLock().acquire(p.lockKey);
    await submit(p, { source, notify: false });
    useFqEventsStore().add({ ...fill(7), kind: 'entry_fill' });
    await Promise.resolve();
    expect(isBusy(p.action)).toBe(true);
    useFqEventsStore().add(fill(7));
    await Promise.resolve();
    expect(isBusy(p.action)).toBe(false);
  });

  it('B78: sees its fill even when it is applied in the same batch as other events', async () => {
    const { source } = fakeSource();
    const { prepare, submit, isBusy } = useBotAction(LIVE);
    const p = prepare(exit(7));
    useInflightLock().acquire(p.lockKey);
    await submit(p, { source });
    const events = useFqEventsStore();
    // Same frame: its own fill, then an unrelated event of another bot
    events.add(fill(7));
    events.add({ ...fill(null, DRY), kind: 'alert_raised' as any });
    await Promise.resolve();
    expect(isBusy(p.action)).toBe(false);
    expect(useToaster().toasts.value.at(-1)).toMatchObject({ kind: 'ok' });
  });

  it('B77: exit of the whole bot stays busy until no position is left, not on the first fill', async () => {
    const { source } = fakeSource();
    const { prepare, submit, isBusy } = useBotAction(LIVE);
    const positions = useFqPositionsStore();
    const pos = (id: number) => ({ bot_key: LIVE, trade_id: id, orphan: false });
    const apply = (upsert: object, remove: string[] = []) =>
      positions.apply({
        kind: 'delta',
        seq: 2,
        ts: 1,
        replace: [],
        upsert: { positions: upsert },
        remove: { positions: remove },
      } as any);
    apply({ [`${LIVE}/1`]: pos(1), [`${LIVE}/2`]: pos(2), [`${LIVE}/3`]: pos(3) });
    const p = prepare(exit('all'));
    useInflightLock().acquire(p.lockKey);
    await submit(p, { source, typedName: 'hippo_live', notify: false });
    expect(isBusy(p.action)).toBe(true);

    useFqEventsStore().add(fill(1));
    apply({}, [`${LIVE}/1`]);
    await Promise.resolve();
    expect(isBusy(p.action)).toBe(true);
    useFqEventsStore().add(fill(2));
    apply({}, [`${LIVE}/2`]);
    await Promise.resolve();
    expect(isBusy(p.action)).toBe(true);
    useFqEventsStore().add(fill(3));
    apply({}, [`${LIVE}/3`]);
    await Promise.resolve();
    expect(isBusy(p.action)).toBe(false);
  });

  it('B75: a forced entry without a side is refused before anything is sent (freqtrade would open a long)', async () => {
    const { source, act } = fakeSource();
    const { prepare, submit } = useBotAction(LIVE);
    const lock = useInflightLock();
    const p = prepare({ kind: 'forceentry', pair: 'ETH/USDC:USDC', stakeAmount: 20 });
    lock.acquire(p.lockKey); // the hold button completed
    const r = await submit(p, { source, notify: false });
    expect(r).toMatchObject({ status: 'rejected', error: 'bad_request', notSent: true });
    expect(act).not.toHaveBeenCalled();
    expect(lock.isLocked(p.lockKey)).toBe(false);
    const ok = prepare({ kind: 'forceentry', pair: 'ETH/USDC:USDC', side: 'short' });
    lock.acquire(ok.lockKey);
    await submit(ok, { source, notify: false });
    expect(act).toHaveBeenCalledTimes(1);
  });

  it('ignores the fill of another bot', async () => {
    const { source } = fakeSource();
    const { prepare, submit, isBusy } = useBotAction(LIVE);
    const p = prepare(exit(7));
    useInflightLock().acquire(p.lockKey);
    await submit(p, { source, notify: false });
    useFqEventsStore().add(fill(7, DRY));
    await Promise.resolve();
    expect(isBusy(p.action)).toBe(true);
  });

  it('never keeps the lock forever if the fill is never seen', async () => {
    vi.useFakeTimers();
    const { source } = fakeSource();
    const { prepare, submit, isBusy } = useBotAction(LIVE);
    const p = prepare(exit(7));
    useInflightLock().acquire(p.lockKey);
    await submit(p, { source, notify: false });
    expect(isBusy(p.action)).toBe(true);
    vi.advanceTimersByTime(ACCEPTED_LOCK_MAX_MS + 1);
    expect(isBusy(p.action)).toBe(false);
  });

  it('releases an accepted action that has no fill to wait for', async () => {
    const { source } = fakeSource();
    const { prepare, submit, isBusy } = useBotAction(DRY);
    const p = prepare({ kind: 'stopbuy' });
    await submit(p, { source, notify: false });
    expect(isBusy(p.action)).toBe(false);
  });
});

describe('toasts follow the microcopy of 11.5', () => {
  const cases: Array<[ActionResult['status'], string]> = [
    ['accepted', 'sent'],
    ['unknown', 'verify'],
    ['rejected', 'err'],
    ['state_mismatch', 'err'],
    ['in_progress', 'verify'],
    ['unauthorized', 'err'],
  ];
  it.each(cases)('%s -> %s toast', async (status, kind) => {
    const { source } = fakeSource(async () => result({ status, botResponse: 'because' }));
    const { prepare, submit } = useBotAction(DRY);
    await submit(prepare({ kind: 'stopbuy' }), { source });
    const toast = useToaster().toasts.value.at(-1)!;
    expect(toast.kind).toBe(kind);
    expect(toast.title).toBeTruthy();
    expect(`${toast.title}${toast.body}`).not.toContain('—');
  });
});
