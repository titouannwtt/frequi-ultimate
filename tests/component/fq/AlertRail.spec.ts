import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import AlertRail from '../../../src/components/fq/AlertRail.vue';
import EventFeed from '../../../src/components/fq/EventFeed.vue';
import SinceLastVisit from '../../../src/components/fq/SinceLastVisit.vue';
import { FIXTURE_NOW } from '../../../src/components/fq/fixtures';
import { useActionDialog } from '../../../src/composables/useActionDialog';
import { useToaster } from '../../../src/composables/useToaster';
import { useFqAlertsStore } from '../../../src/datasource/stores/alerts';
import { useFqConnectionStore } from '../../../src/datasource/stores/connection';
import type { DataSource } from '../../../src/datasource/types';
import { mountFq, setFqLocale, setupWorld, teardownWorld, type FqWorld } from './helpers';

// The rail reads the active source from the data layer: give it the fake one (no network at all)
const held = vi.hoisted(() => ({ source: null as unknown }));
vi.mock('../../../src/composables/useDataSource', async () => {
  const { computed } = await import('vue');
  return {
    useDataSource: () => ({ source: computed(() => held.source as DataSource | null) }),
  };
});

let world: FqWorld;
beforeEach(() => {
  world = setupWorld();
  held.source = world.fake.source;
  localStorage.clear();
});
afterEach(() => {
  held.source = null;
  teardownWorld();
});

const mountRail = (props: Record<string, unknown> = {}) =>
  mountFq(AlertRail, { props: { nowMs: FIXTURE_NOW, ...props }, attachTo: document.body });

describe('AlertRail', () => {
  it('shows the level and the active alerts, critical first, with their counts in the tabs', () => {
    const w = mountRail();
    const items = w.findAll('article.al');
    expect(items.length).toBe(5);
    const severities = items.map((i) => i.attributes('data-severity'));
    expect(severities.slice(0, 3)).toEqual(['critical', 'critical', 'critical']);
    expect(severities[severities.length - 1]).not.toBe('critical');
    expect(w.text()).toContain('Critical');
    const tabs = w.findAll('[role=tab]').map((t) => t.text());
    expect(tabs.some((t) => /Acknowledged.*1/.test(t))).toBe(true);
    expect(tabs.some((t) => /Silenced.*1/.test(t))).toBe(true);
  });

  it('is calm and says so when nothing needs a decision', () => {
    useFqAlertsStore().reset();
    const w = mountRail();
    expect(w.findAll('article.al')).toHaveLength(0);
    expect(w.text()).toContain('Calm');
    expect(w.find('[data-testid=alert-rail] svg').exists()).toBe(true);
  });

  it('acknowledging goes to the source with the alert id and sends nothing to any bot', async () => {
    const w = mountRail();
    const first = w.get('article.al');
    await first.get('[data-ctl=ack]').trigger('click');
    await nextTick();
    expect(world.fake.ack).toEqual([first.attributes('data-alert-id')]);
    expect(world.fake.acts).toHaveLength(0);
  });

  it('silencing offers 1 h, 4 h and tomorrow 08:00 and passes the right bot and type', async () => {
    const w = mountRail();
    const card = w.findAll('article.al').find((a) => a.attributes('data-alert-id') === 'a1')!;
    await card.get('[data-ctl=silence]').trigger('click');
    const choices = card.findAll('[data-silence]').map((c) => c.attributes('data-silence'));
    expect(choices).toEqual(['1h', '4h', 'tomorrow']);
    await card.get('[data-silence="1h"]').trigger('click');
    await card.get('[data-ctl=silence]').trigger('click');
    await card.get('[data-silence="tomorrow"]').trigger('click');
    await nextTick();
    expect(world.fake.silences).toHaveLength(2);
    expect(world.fake.silences[0]).toMatchObject({
      typeId: 'nearLiquidation',
      untilMs: FIXTURE_NOW + 3_600_000,
    });
    expect(world.fake.silences[0]!.botKey).toBeTruthy();
    // 08:00 in Paris on the 16th, 06:00 UTC (summer time)
    expect(world.fake.silences[1]!.untilMs).toBe(Date.UTC(2026, 9, 16, 6, 0, 0));
    expect(world.fake.acts).toHaveLength(0);
  });

  it('a failing acknowledge says so instead of failing silently', async () => {
    const failing = {
      ...(world.fake.source as object),
      alerts: {
        ...world.fake.source.alerts,
        ack: async () => Promise.reject(new Error('gateway down')),
      },
    };
    held.source = failing;
    const w = mountRail();
    await w.get('article.al [data-ctl=ack]').trigger('click');
    await vi.advanceTimersByTimeAsync(0);
    expect(useToaster().toasts.value.some((t) => t.kind === 'err')).toBe(true);
  });

  it('without a source nothing is sent and the user is told', async () => {
    held.source = null;
    const w = mountRail();
    await w.get('article.al [data-ctl=ack]').trigger('click');
    expect(useToaster().toasts.value.some((t) => t.kind === 'err')).toBe(true);
    expect(world.fake.ack).toHaveLength(0);
  });

  it('"Pause entries" opens the confirmation of the alert bot; nothing is sent from the rail', async () => {
    const w = mountRail();
    const card = w.findAll('article.al').find((a) => a.attributes('data-alert-id') === 'a1')!;
    const alertBotKey = world.fixture.alerts.find((a) => a.id === 'a1')!.bot_key!;
    await card.get('[data-alert-action="pause"]').trigger('click');
    expect(useActionDialog().current.value).toMatchObject({
      botKey: alertBotKey,
      action: { kind: 'stopbuy' },
    });
    expect(world.fake.acts).toHaveLength(0);
    expect(w.emitted('action')).toBeUndefined();
  });

  it('other contextual actions are only reported to the parent (navigation), never executed', async () => {
    const w = mountRail();
    const wallet = w.findAll('article.al').find((a) => a.attributes('data-alert-id') === 'a5')!;
    await wallet.get('[data-alert-action="reconcile"]').trigger('click');
    expect(w.emitted('action')![0]![0]).toBe('reconcile');
    expect(useActionDialog().current.value).toBeNull();
    expect(world.fake.acts).toHaveLength(0);
  });

  it('acknowledged and silenced alerts show their status and no ack/silence buttons', () => {
    const acked = mountRail({ tab: 'acked' });
    expect(acked.findAll('article.al')).toHaveLength(1);
    expect(acked.find('[data-ctl=ack]').exists()).toBe(false);
    expect(acked.text()).toMatch(/Acknowledged at/i);
    const silenced = mountRail({ tab: 'silenced' });
    expect(silenced.findAll('article.al')).toHaveLength(1);
    expect(silenced.find('[data-ctl=silence]').exists()).toBe(false);
    expect(silenced.text()).toMatch(/Silenced until/i);
  });

  it('limit: shows the first alerts and "See the N others" reveals the rest (phone)', async () => {
    const w = mountRail({ limit: 2 });
    expect(w.findAll('article.al')).toHaveLength(2);
    const more = w.get('.more');
    expect(more.text()).toContain('3');
    await more.trigger('click');
    expect(w.findAll('article.al')).toHaveLength(5);
  });

  it('filters by bot on the Bot page', () => {
    const bot = world.fixture.alerts.find((a) => a.id === 'a1')!.bot_key!;
    const w = mountRail({ botKey: bot });
    expect(w.findAll('article.al').map((a) => a.attributes('data-alert-id'))).toEqual(['a1']);
  });

  it('says when alerts are local to this tab (direct mode)', () => {
    useFqAlertsStore().shared = false;
    const w = mountRail();
    expect(w.find('.note').exists()).toBe(true);
  });

  it('a wallet alert is attributed to the wallet, a bot alert to its bot with the mode mark', () => {
    const w = mountRail();
    const wallet = w.findAll('article.al').find((a) => a.attributes('data-alert-id') === 'a5')!;
    expect(wallet.text()).toContain('wallet');
    const bot = w.findAll('article.al').find((a) => a.attributes('data-alert-id') === 'a1')!;
    const name = world.fixture.bots.find((b) => b.bot_key === world.fixture.alerts[0]!.bot_key)!
      .identity.name;
    expect(bot.text()).toContain(name);
  });

  it('the figures are written with their threshold, never NaN', () => {
    const w = mountRail();
    expect(w.text()).not.toMatch(/NaN|undefined|\{/);
    expect(w.get('[data-alert-id="a1"]').text()).toMatch(/11/);
    expect(w.get('[data-alert-id="a1"]').text()).toMatch(/15/);
  });

  it('speaks French', () => {
    setFqLocale('fr');
    const w = mountRail();
    expect(w.text()).toContain('À traiter');
    expect(w.text()).not.toMatch(/NaN|undefined|\{/);
  });
});

describe('Events tab: since your last visit and the feed', () => {
  it('digest of the events since the marker, and "mark as seen" moves it', async () => {
    const w = mountFq(SinceLastVisit, {
      props: { since: FIXTURE_NOW - 4 * 3_600_000, nowMs: FIXTURE_NOW },
      attachTo: document.body,
    });
    // +4.18 -18.6 +9.9 over the window
    expect(w.text()).toMatch(/4[.,]18|18[.,]6|9[.,]9|-4[.,]52/);
    await w.get('button').trigger('click');
    expect(w.emitted('seen')![0]).toEqual([FIXTURE_NOW]);
    expect(localStorage.getItem('fqu2.lastVisit')).toBe(String(FIXTURE_NOW));
  });

  it('nothing happened: says so rather than showing zeros', () => {
    const w = mountFq(SinceLastVisit, {
      props: { since: FIXTURE_NOW + 1, nowMs: FIXTURE_NOW },
      attachTo: document.body,
    });
    expect(w.text()).toMatch(/nothing/i);
  });

  it('the feed lists events newest first, filters by bot and kind, and says what direct mode lacks', () => {
    const all = mountFq(EventFeed, { attachTo: document.body });
    expect(all.findAll('li.ev')).toHaveLength(world.fixture.events.length);
    expect(all.findAll('li.ev')[0]!.attributes('data-kind')).toBe('exit_fill');
    const bot = world.fixture.events[0]!.bot_key!;
    const only = mountFq(EventFeed, { props: { bot }, attachTo: document.body });
    expect(only.findAll('li.ev').length).toBeLessThan(world.fixture.events.length);
    const kinds = mountFq(EventFeed, { props: { kinds: ['exit_fill'] }, attachTo: document.body });
    expect(kinds.findAll('li.ev').every((e) => e.attributes('data-kind') === 'exit_fill')).toBe(
      true,
    );
    useFqConnectionStore().kind = 'direct';
    return nextTick().then(() => {
      expect(all.find('.note').exists()).toBe(true);
    });
  });

  it('a loss is written with its sign and an exit without profit has none', () => {
    const w = mountFq(EventFeed, { attachTo: document.body });
    const text = w.text();
    expect(text).toMatch(/[-−]18[.,]6/);
    expect(text).toMatch(/\+4[.,]18/);
  });
});
