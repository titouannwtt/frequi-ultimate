import { computed, toValue, watch, type MaybeRefOrGetter, type WatchStopHandle } from 'vue';

import type { ToastAction } from '@/components/ds/types';
import { useFqEventsStore } from '@/datasource/stores/events';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import type { ActionResult, BotAction, DataSource } from '@/datasource/types';
import type { BotKey, BotMode } from '@/gateway/types.gen';
import i18n from '@/locales';

import { useDataSource } from './useDataSource';
import { useInflightLock } from './useInflightLock';
import { useToaster } from './useToaster';

/**
 * Every mutation of a bot goes through here (docs/redesign/02-design.md, section 11).
 *
 * What this composable guarantees, whatever the surface that triggers it:
 * - the target is explicit: `(botKey, action, tradeId)` travel together, there is no "active bot";
 * - one idempotency key per confirmed intent, one in-flight lock per `bot_key:action:trade_id`;
 * - the level of confirmation is derived from the mode and the action, never chosen by the caller;
 * - a destructive live action needs the bot name typed exactly (the server checks it again);
 * - exactly ONE call to `DataSource.act` per submit: no retry, no replay, not even after a
 *   timeout (`unknown`) or a 401. "Retry" opens a new confirmation, it never resends;
 * - the two-step result: `accepted` ("transmitted") then, for exits and entries, the fill event.
 */
export type ConfirmLevel = 'reduce' | 'dry' | 'live' | 'live_destructive';

export interface PendingAction {
  botKey: BotKey;
  botName: string;
  mode: BotMode;
  action: BotAction;
  level: ConfirmLevel;
  /** `bot_key:action:trade_id`, the same on every surface. */
  lockKey: string;
  /** UUID v4 of this confirmed intent. */
  idempotencyKey: string;
  requiresHold: boolean;
  requiresTypedName: boolean;
}

export interface ActionOutcome extends ActionResult {
  lockKey: string;
  idempotencyKey: string;
  /** Nothing was sent (validation, no source). */
  notSent: boolean;
}

/** Longest the lock is kept after an `accepted` exit/entry while the fill has not been seen. */
export const ACCEPTED_LOCK_MAX_MS = 60_000;

const DESTRUCTIVE_KINDS = new Set<BotAction['kind']>(['stop', 'delete_trade']);

export function confirmLevelOf(action: BotAction, mode: BotMode): ConfirmLevel {
  if (action.kind === 'stopbuy') return 'reduce';
  if (mode !== 'live') return 'dry';
  if (DESTRUCTIVE_KINDS.has(action.kind)) return 'live_destructive';
  if (action.kind === 'forceexit' && action.tradeId === 'all') return 'live_destructive';
  return 'live';
}

export function tradeIdOf(action: BotAction): number | 'all' | null {
  switch (action.kind) {
    case 'forceexit':
    case 'delete_trade':
    case 'cancel_open_order':
    case 'reload_trade':
      return action.tradeId;
    case 'lock_delete':
      return action.lockId;
    default:
      return null;
  }
}

export function lockKeyOf(botKey: BotKey, action: BotAction): string {
  const trade =
    action.kind === 'forceentry'
      ? action.pair
      : action.kind === 'blacklist_add' || action.kind === 'blacklist_remove'
        ? 'pairs'
        : (tradeIdOf(action) ?? '-');
  return `${botKey}:${action.kind}:${trade}`;
}

export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Not cryptographic; only needs to be unique per intent.
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}

/** Actions whose final result is a fill event. */
const AWAITS_FILL = new Set<BotAction['kind']>(['forceexit', 'forceentry']);

const inflight = new Set<string>();
const fillWatchers = new Map<
  string,
  { stop: WatchStopHandle; timer: ReturnType<typeof setTimeout> }
>();

function t(key: string, named?: Record<string, unknown>): string {
  return i18n.global.t(`fq.${key}`, named ?? {}) as string;
}

function localOutcome(
  p: Pick<PendingAction, 'lockKey' | 'idempotencyKey'>,
  status: ActionResult['status'],
  error: ActionResult['error'],
  message: string,
): ActionOutcome {
  return {
    status,
    botResponse: message,
    httpStatus: null,
    error,
    verify: null,
    latencyMs: 0,
    lockKey: p.lockKey,
    idempotencyKey: p.idempotencyKey,
    notSent: true,
  };
}

export function useBotAction(botKey: MaybeRefOrGetter<BotKey>) {
  const fleet = useFqFleetStore();
  const events = useFqEventsStore();
  const positions = useFqPositionsStore();
  const lock = useInflightLock();
  const toaster = useToaster();
  const data = useDataSource();

  const bot = computed(() => fleet.bots[toValue(botKey)] ?? null);
  /** An unknown bot is treated as live: the most protective assumption. */
  const mode = computed<BotMode>(() => bot.value?.identity.mode ?? 'live');
  const botName = computed(() => bot.value?.identity.name ?? toValue(botKey));

  function prepare(action: BotAction): PendingAction {
    const key = toValue(botKey);
    const level = confirmLevelOf(action, mode.value);
    return {
      botKey: key,
      botName: botName.value,
      mode: mode.value,
      action,
      level,
      lockKey: lockKeyOf(key, action),
      idempotencyKey: newIdempotencyKey(),
      requiresHold: level === 'live' || level === 'live_destructive',
      requiresTypedName: level === 'live_destructive',
    };
  }

  /** True while any surface holds the lock of this action: rows set `aria-busy` from it. */
  function isBusy(action: BotAction): boolean {
    return lock.isLocked(lockKeyOf(toValue(botKey), action));
  }

  function toast(p: PendingAction, r: ActionOutcome): void {
    const subject = `${p.botName} · ${p.action.kind}${
      tradeIdOf(p.action) !== null ? ` #${tradeIdOf(p.action)}` : ''
    }`;
    const retry: ToastAction[] = [{ id: 'retry', label: t('result.retry') }];
    switch (r.status) {
      case 'accepted':
        toaster.push({
          kind: 'sent',
          title: t('result.sent'),
          body: `${subject}: ${t(AWAITS_FILL.has(p.action.kind) ? 'result.acceptedAwaitFill' : 'result.accepted')}`,
        });
        break;
      case 'unknown':
        toaster.push({
          kind: 'verify',
          title: t('result.needsChecking'),
          body: `${subject}: ${t('result.unknownBody')}`,
          actions: [
            { id: 'trade', label: t('result.openTrade') },
            { id: 'logs', label: t('result.viewLogs') },
          ],
        });
        break;
      case 'rejected':
        toaster.push({
          kind: 'err',
          title: t('result.rejected'),
          body: `${subject}: ${r.botResponse ?? ''} ${t('result.nothingExecuted')}`.trim(),
        });
        break;
      case 'state_mismatch':
        toaster.push({
          kind: 'err',
          title: t('result.mismatchTitle'),
          body: `${subject}: ${t('result.mismatchBody')}`,
          actions: [{ id: 'trade', label: t('result.reviewTrade') }],
        });
        break;
      case 'in_progress':
        toaster.push({
          kind: 'verify',
          title: t('result.inProgressTitle'),
          body: `${subject}: ${t('result.inProgressBody')}`,
        });
        break;
      case 'unauthorized':
        toaster.push({
          kind: 'err',
          title: t('result.sessionTitle'),
          body: `${subject}: ${t('result.noReplay')}`,
          actions: retry,
        });
        break;
    }
  }

  /** Release the lock when the fill of an accepted exit/entry shows up, or after the cap. */
  function holdUntilFill(p: PendingAction): void {
    const done = () => {
      const w = fillWatchers.get(p.lockKey);
      if (w) {
        w.stop();
        clearTimeout(w.timer);
        fillWatchers.delete(p.lockKey);
      }
      lock.release(p.lockKey);
    };
    done();
    lock.acquire(p.lockKey);
    const tradeId = tradeIdOf(p.action);
    // An exit is only done by an exit fill, an entry by an entry fill (a DCA entry fill of the
    // same trade must not release a pending exit)
    const wanted = p.action.kind === 'forceexit' ? 'exit_fill' : 'entry_fill';
    const openOfBot = () => positions.byBot(p.botKey).filter((x) => !x.orphan).length;
    const finish = (pair: string | null) => {
      done();
      toaster.push({
        kind: 'ok',
        title: t('result.filled'),
        body: `${p.botName} · ${pair ?? ''}`.trim(),
      });
    };
    const stop = watch(
      () => [events.counter, openOfBot()] as const,
      ([counter, open], [prev]) => {
        if (tradeId === 'all') {
          // Exit of the whole bot: one fill is not the end, wait until nothing remains open
          if (open === 0 && fillWatchers.has(p.lockKey)) finish(null);
          return;
        }
        // Events are applied in batches: look at every event added since the last run, newest
        // first, not only the last one
        const fresh = events.events.slice(
          0,
          Math.max(0, Math.min(counter - prev, events.events.length)),
        );
        const hit = fresh.find(
          (e) =>
            e.bot_key === p.botKey &&
            e.kind === wanted &&
            !(typeof tradeId === 'number' && e.trade_id !== null && e.trade_id !== tradeId),
        );
        if (hit) finish(hit.pair ?? null);
      },
    );
    const timer = setTimeout(done, ACCEPTED_LOCK_MAX_MS);
    fillWatchers.set(p.lockKey, { stop, timer });
  }

  /**
   * Send the confirmed action, once. `typedName` is the text of the confirmation field for the
   * destructive level. Never throws; the outcome says what happened.
   */
  async function submit(
    p: PendingAction,
    opts: { typedName?: string; source?: DataSource | null; notify?: boolean } = {},
  ): Promise<ActionOutcome> {
    const notify = opts.notify !== false;
    const finish = (r: ActionOutcome) => {
      if (notify) toast(p, r);
      return r;
    };

    // The hold button took the lock when it completed. A refusal before anything is sent must give
    // it back, or the action stays "in progress" until the page is reloaded (B72).
    const giveBackHeldLock = () => {
      if (p.requiresHold && !inflight.has(p.lockKey)) lock.release(p.lockKey);
    };
    if (p.requiresTypedName && opts.typedName !== p.botName) {
      giveBackHeldLock();
      return finish(localOutcome(p, 'rejected', 'bad_request', t('result.nameMismatch')));
    }
    // freqtrade opens a LONG when no side is sent: a forced entry never leaves without one
    if (p.action.kind === 'forceentry' && !p.action.side) {
      giveBackHeldLock();
      return finish(localOutcome(p, 'rejected', 'bad_request', t('result.sideMissing')));
    }
    const source = opts.source === undefined ? data.source.value : opts.source;
    if (!source) {
      giveBackHeldLock();
      return finish(localOutcome(p, 'rejected', 'unavailable', t('result.noSource')));
    }
    // A duplicate submit (double click, two surfaces) never reaches the bot.
    if (inflight.has(p.lockKey)) {
      return finish(localOutcome(p, 'in_progress', 'in_progress', ''));
    }
    // A hold button already took the lock when it completed; the other levels take it here.
    if (!p.requiresHold && !lock.acquire(p.lockKey)) {
      return finish(localOutcome(p, 'in_progress', 'in_progress', ''));
    }
    inflight.add(p.lockKey);

    const action: BotAction = p.requiresTypedName
      ? ({ ...p.action, confirm: opts.typedName } as BotAction)
      : p.action;

    let result: ActionOutcome;
    try {
      const r = await source.act(p.botKey, action, p.idempotencyKey);
      result = { ...r, lockKey: p.lockKey, idempotencyKey: p.idempotencyKey, notSent: false };
    } catch {
      // The request may or may not have reached the bot: neither success nor failure.
      result = {
        status: 'unknown',
        botResponse: null,
        httpStatus: null,
        error: null,
        verify: { expectedState: 'unknown', checkAfterMs: 5_000 },
        latencyMs: 0,
        lockKey: p.lockKey,
        idempotencyKey: p.idempotencyKey,
        notSent: false,
      };
    } finally {
      inflight.delete(p.lockKey);
    }

    if (result.status === 'accepted' && AWAITS_FILL.has(p.action.kind)) {
      holdUntilFill(p);
    } else {
      lock.release(p.lockKey);
    }
    return finish(result);
  }

  return { bot, mode, botName, prepare, submit, isBusy };
}

/** Test helper: forget every in-flight record (module state). */
export function resetBotActionState(): void {
  for (const w of fillWatchers.values()) {
    w.stop();
    clearTimeout(w.timer);
  }
  fillWatchers.clear();
  inflight.clear();
  useInflightLock().releaseAll();
}
