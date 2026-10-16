import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import { FIXTURE_NOW } from '@/components/fq/fixtures';
import { alertsToNotify, notifyKey, staleKeys } from '@/components/fq/lib/alertNotify';
import { useBrowserNotifications } from '@/composables/useBrowserNotifications';
import { useFqAlertsStore } from '@/datasource/stores/alerts';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { Alert } from '@/gateway/types.gen';

const NOW = FIXTURE_NOW;

const alert = (over: Partial<Alert> = {}): Alert => ({
  id: 'a1',
  type_id: 'nearLiquidation',
  bot_key: 'local:8080',
  subject: 'NVDA',
  severity: 'critical',
  value: 11,
  threshold: 15,
  since_ms: NOW - 60_000,
  last_seen_ms: NOW,
  state: 'firing',
  acked_at_ms: null,
  acked_by_session: null,
  silenced_until_ms: null,
  detail: null,
  pair: null,
  ...over,
});

describe('alertsToNotify', () => {
  const none = new Set<string>();

  it('keeps the active warnings and criticals, once', () => {
    const a = alert();
    expect(alertsToNotify([a], NOW, none, {})).toEqual([a]);
    expect(alertsToNotify([a], NOW, new Set([notifyKey(a)]), {})).toEqual([]);
  });

  it('skips what is acknowledged, silenced, pending, resolved or only informative', () => {
    const list = [
      alert({ id: 'acked', acked_at_ms: NOW - 1 }),
      alert({ id: 'silenced', silenced_until_ms: NOW + 60_000 }),
      alert({ id: 'pending', state: 'pending' }),
      alert({ id: 'resolved', state: 'resolved' }),
      alert({ id: 'info', severity: 'info' }),
    ];
    expect(alertsToNotify(list, NOW, none, {})).toEqual([]);
  });

  it('honours the type switches: only an explicit false turns a type off', () => {
    const loss = alert({ id: 'l', type_id: 'positionLoss' });
    const offline = alert({ id: 'o', type_id: 'botOffline' });
    const other = alert({ id: 'w', type_id: 'walletMismatch' });
    const out = alertsToNotify([loss, offline, other], NOW, none, { botOffline: false });
    expect(out.map((a) => a.id)).toEqual(['l', 'w']);
    // Missing entries mean "on"
    expect(alertsToNotify([loss, offline], NOW, none, {})).toHaveLength(2);
    // near liquidation belongs to the position loss switch
    expect(alertsToNotify([alert()], NOW, none, { positionLoss: false })).toEqual([]);
  });

  it('a later return of the same alert is a new occurrence', () => {
    const first = alert({ since_ms: NOW - 1000 });
    const again = alert({ since_ms: NOW });
    expect(notifyKey(first)).not.toBe(notifyKey(again));
    expect(alertsToNotify([again], NOW, new Set([notifyKey(first)]), {})).toEqual([again]);
  });

  it('forgets the occurrences that are no longer active', () => {
    const a = alert();
    const gone = alert({ id: 'gone', acked_at_ms: NOW - 1 });
    const seen = new Set([notifyKey(a), notifyKey(gone), 'removed@1']);
    expect(staleKeys(seen, [a, gone], NOW).sort()).toEqual([notifyKey(gone), 'removed@1'].sort());
  });
});

describe('useBrowserNotifications', () => {
  const shown: Array<{ title: string; body?: string }> = [];

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    shown.length = 0;
    class FakeNotification {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      constructor(title: string, opts?: { body?: string }) {
        shown.push({ title, body: opts?.body });
      }
      close() {}
    }
    vi.stubGlobal('Notification', FakeNotification);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const snapshot = (alerts: Alert[], seq = 1) => ({
    kind: 'snapshot' as const,
    seq,
    ts: NOW,
    replace: ['alerts'],
    upsert: { alerts: Object.fromEntries(alerts.map((a) => [a.id, a])) } as never,
    remove: {},
  });
  const delta = (alerts: Alert[], seq: number) => ({
    kind: 'delta' as const,
    seq,
    ts: NOW,
    replace: [],
    upsert: { alerts: Object.fromEntries(alerts.map((a) => [a.id, a])) } as never,
    remove: {},
  });

  function enable(on = true) {
    const prefs = useFqPrefsStore();
    prefs.update('alerts', {
      ...prefs.settings.alerts,
      notifications: { ...prefs.settings.alerts.notifications, browser: on },
    });
  }

  it('notifies a new alert once, not the ones already active at load', async () => {
    enable();
    const store = useFqAlertsStore();
    const stop = useBrowserNotifications();
    store.apply(snapshot([alert({ id: 'old' })]));
    await nextTick();
    expect(shown).toHaveLength(0);

    store.apply(delta([alert({ id: 'new', subject: 'ETH' })], 2));
    await nextTick();
    expect(shown).toHaveLength(1);
    expect(shown[0]!.body).toContain('ETH');

    // The same alert updated again is not announced twice
    store.apply(delta([alert({ id: 'new', subject: 'ETH', value: 12 })], 3));
    await nextTick();
    expect(shown).toHaveLength(1);
    stop();
  });

  it('says nothing while the switch is off, or the browser did not grant the permission', async () => {
    const store = useFqAlertsStore();
    const stop = useBrowserNotifications();
    store.apply(snapshot([]));
    await nextTick();
    store.apply(delta([alert({ id: 'x' })], 2));
    await nextTick();
    expect(shown).toHaveLength(0);

    enable();
    (Notification as unknown as { permission: string }).permission = 'denied';
    store.apply(delta([alert({ id: 'y', since_ms: NOW + 1 })], 3));
    await nextTick();
    expect(shown).toHaveLength(0);
    stop();
  });
});
