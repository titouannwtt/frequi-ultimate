import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import AlertCenter from '../../../src/components/fq/AlertCenter.vue';
import FleetAlerts from '../../../src/components/fq/FleetAlerts.vue';
import FleetMap from '../../../src/components/fq/FleetMap.vue';
import FleetKpis from '../../../src/components/fq/FleetKpis.vue';
import FleetVerdict from '../../../src/components/fq/FleetVerdict.vue';
import PositionCard from '../../../src/components/fq/PositionCard.vue';
import RiskPanel from '../../../src/components/fq/RiskPanel.vue';
import WatchList from '../../../src/components/fq/WatchList.vue';
import { FIXTURE_NOW, makeBot, scopeDetailOf } from '../../../src/components/fq/fixtures';
import { lineFromPosition, pairLabel } from '../../../src/components/fq/lib/trades';
import { useActionDialog } from '../../../src/composables/useActionDialog';
import { useFqAlertsStore } from '../../../src/datasource/stores/alerts';
import type { DataSource } from '../../../src/datasource/types';
import { mountFq, setFqLocale, setupWorld, teardownWorld, type FqWorld } from './helpers';

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
  setFqLocale('en');
  teardownWorld();
});

const FLEET = { kind: 'fleet' } as const;

describe('FleetKpis (four figures)', () => {
  it('shows capital, 30 days, drop and margin, and the rest in sub-lines', () => {
    const w = mountFq(FleetKpis, {
      props: { detail: scopeDetailOf(world.fixture, FLEET), nowMs: FIXTURE_NOW },
      attachTo: document.body,
    });
    const tiles = w.get('[data-testid=fleet-kpis] .row').findAll('.kpi');
    expect(tiles).toHaveLength(4);
    expect(tiles.map((t) => t.attributes('data-testid'))).toEqual([
      'kpi-equity',
      'kpi-30d',
      'kpi-dd',
      'kpi-margin',
    ]);
    // The open P&L is a sub-line of the capital; today and the win rate of the 30 days
    expect(w.get('[data-testid=kpi-equity]').text()).toMatch(/of which/);
    expect(w.get('[data-testid=kpi-30d]').text()).toMatch(/today/);
    expect(w.get('[data-testid=kpi-30d]').text()).toMatch(/winning trades/);
    // None of the removed tiles is left
    for (const id of ['kpi-day', 'kpi-exposure', 'kpi-online']) {
      expect(w.find(`.kpi[data-testid=${id}]`).exists()).toBe(false);
    }
  });

  it('speaks plainly in French', () => {
    setFqLocale('fr');
    const w = mountFq(FleetKpis, {
      props: { detail: scopeDetailOf(world.fixture, FLEET), nowMs: FIXTURE_NOW },
      attachTo: document.body,
    });
    const text = w.text();
    expect(text).toContain('Capital total');
    expect(text).toContain('Gagné sur 30 jours');
    expect(text).toContain('Recul depuis le plus haut');
    expect(text).toContain('Marge utilisée');
    expect(text).toMatch(/dont.*en cours/);
    expect(text).not.toMatch(/latent|drawdown/i);
  });
});

describe('FleetVerdict', () => {
  const alerts = world_alerts();
  function world_alerts() {
    return (kinds: Array<'critical' | 'warning' | 'info'>) =>
      kinds.map((k, i) => ({ id: `x${i}`, severity: k, bot_key: null }) as never);
  }
  it('says everything is fine and backs it with the counts', () => {
    const w = mountFq(FleetVerdict, { props: { alerts: [], nowMs: FIXTURE_NOW } });
    expect(w.get('[data-testid=fleet-verdict]').attributes('data-level')).toBe('calm');
    expect(w.text()).toContain('Everything is fine.');
    expect(w.text()).toMatch(/live bots? of \d+ (is|are) running/);
    expect(w.text()).toMatch(/open positions?/);
  });
  it('names one point, several, or the critical ones', () => {
    const one = mountFq(FleetVerdict, { props: { alerts: alerts(['warning']) } });
    expect(one.text()).toContain('One thing to check, the rest is calm.');
    const many = mountFq(FleetVerdict, { props: { alerts: alerts(['warning', 'warning']) } });
    expect(many.text()).toContain('2 things to check.');
    const crit = mountFq(FleetVerdict, { props: { alerts: alerts(['critical']) } });
    expect(crit.get('[data-testid=fleet-verdict]').attributes('data-level')).toBe('critical');
    expect(crit.text()).toContain('1 critical alert');
  });
});

describe('FleetVerdict with notices (B360)', () => {
  const notice = (kind: string, severity: 'critical' | 'warning' = 'warning') =>
    ({ id: `n-${kind}`, kind, severity }) as never;
  it('is not calm when a session expired, though no alert is active', () => {
    setFqLocale('fr');
    const w = mountFq(FleetVerdict, {
      props: { alerts: [], notices: [notice('authExpired')], nowMs: FIXTURE_NOW },
    });
    expect(w.get('[data-testid=fleet-verdict]').attributes('data-level')).toBe('one');
    expect(w.text()).toContain('Un point à voir');
    expect(w.text()).not.toContain('Tout va bien');
  });
  it('counts alerts and notices together', () => {
    const w = mountFq(FleetVerdict, {
      props: {
        alerts: [{ id: 'x', severity: 'warning', bot_key: null }] as never,
        notices: [notice('drawdown')],
      },
    });
    expect(w.text()).toContain('2 things to check.');
  });
  it('does not say "fine" before the figures it reads have arrived', () => {
    const w = mountFq(FleetVerdict, { props: { alerts: [], ready: false, nowMs: FIXTURE_NOW } });
    expect(w.get('[data-testid=fleet-verdict]').attributes('data-level')).toBe('loading');
    expect(w.text()).not.toContain('Everything is fine');
  });
});

describe('FleetAlerts notice cards (B360)', () => {
  const expired = {
    id: 'authExpired:local:9405',
    kind: 'authExpired',
    severity: 'warning',
    botKey: world_key(),
    botKeys: [],
    mode: 'live',
    sinceMs: FIXTURE_NOW - 3_600_000,
    value: null,
    threshold: null,
    pair: null,
    n: 1,
    actions: ['reconnect'],
  };
  function world_key() {
    return 'local:9405';
  }
  it('shows the expired bot with "Reconnect" and "Later", and says it is out of the totals', async () => {
    setFqLocale('fr');
    const w = mountFq(FleetAlerts, {
      props: { alerts: [], notices: [expired], nowMs: FIXTURE_NOW },
      attachTo: document.body,
    });
    const card = w.get('article.card[data-notice=authExpired]');
    expect(card.text()).toContain('ne répond plus depuis');
    expect(card.text()).toContain('pas comptés dans les totaux');
    expect(card.get('[data-alert-action=reconnect]').text()).toBe('Se reconnecter');
    expect(card.find('[data-ctl=ack]').exists()).toBe(false);
    await card.get('[data-alert-action=reconnect]').trigger('click');
    expect(w.emitted('action')![0]![0]).toBe('reconnect');
    await card.get('[data-ctl=silence]').trigger('click');
    await card.get('[data-silence="1h"]').trigger('click');
    expect(w.emitted('later')![0]).toEqual([expired.id, FIXTURE_NOW + 3_600_000]);
    // A notice is not an alert: nothing is silenced at the source
    expect(world.fake.silences).toHaveLength(0);
  });
  it('puts a notice before the alerts of its severity and opens hidden notices in place', async () => {
    const all = useFqAlertsStore().view(FIXTURE_NOW, 'active');
    const w = mountFq(FleetAlerts, {
      props: { alerts: all, notices: [expired], limit: 1, nowMs: FIXTURE_NOW },
      attachTo: document.body,
    });
    const first = w.findAll('article.card')[0]!;
    expect(first.attributes('data-severity')).toBe('critical');
    expect(w.findAll('article.card')).toHaveLength(1);
    await w.get('[data-testid=fleet-alerts-more]').trigger('click');
    expect(w.find('article.card[data-notice=authExpired]').exists()).toBe(true);
  });
});

describe('FleetMap tile wording (B364)', () => {
  it('writes "4 positions sur 4" and no bare 4/4', () => {
    setFqLocale('fr');
    const bot = makeBot(97, { name: 'tile', mode: 'live', slots: 4, maxSlots: 4 });
    const w = mountFq(FleetMap, { props: { rows: [bot], nowMs: FIXTURE_NOW } });
    expect(w.get('.t-sub').text()).toMatch(/4 positions sur\s*4/);
    expect(w.get('.t-sub').text()).not.toContain('4/4');
  });
});

describe('FleetAlerts (cards under the verdict)', () => {
  const mountCards = (props: Record<string, unknown> = {}) =>
    mountFq(FleetAlerts, {
      props: {
        alerts: useFqAlertsStore().view(FIXTURE_NOW, 'active'),
        nowMs: FIXTURE_NOW,
        ...props,
      },
      attachTo: document.body,
    });

  it('renders nothing when calm', () => {
    const w = mountCards({ alerts: [] });
    expect(w.find('[data-testid=fleet-alerts]').exists()).toBe(false);
  });

  it('one card per alert up to the limit, then "See the N other alerts"', async () => {
    const all = useFqAlertsStore().view(FIXTURE_NOW, 'active');
    const w = mountCards({ alerts: all, limit: 2 });
    expect(w.findAll('article.card')).toHaveLength(2);
    const more = w.get('[data-testid=fleet-alerts-more]');
    expect(more.text()).toContain(String(all.length - 2));
    await more.trigger('click');
    expect(w.emitted('more')).toHaveLength(1);
  });

  it('acknowledging ("Seen") goes to the source and sends nothing to any bot', async () => {
    const w = mountCards();
    const first = w.get('article.card');
    await first.get('[data-ctl=ack]').trigger('click');
    await nextTick();
    expect(world.fake.ack).toEqual([first.attributes('data-alert-id')]);
    expect(world.fake.acts).toHaveLength(0);
  });

  it('"Later" offers 1 h, 4 h and tomorrow and silences the right alert', async () => {
    const w = mountCards();
    const card = w.findAll('article.card').find((a) => a.attributes('data-alert-id') === 'a1')!;
    await card.get('[data-ctl=silence]').trigger('click');
    expect(card.findAll('[data-silence]').map((c) => c.attributes('data-silence'))).toEqual([
      '1h',
      '4h',
      'tomorrow',
    ]);
    await card.get('[data-silence="1h"]').trigger('click');
    await nextTick();
    expect(world.fake.silences[0]).toMatchObject({
      typeId: 'nearLiquidation',
      untilMs: FIXTURE_NOW + 3_600_000,
    });
    expect(world.fake.acts).toHaveLength(0);
  });

  it('"Pause entries" opens the confirmation of the alert bot and sends nothing', async () => {
    const w = mountCards();
    const card = w.findAll('article.card').find((a) => a.attributes('data-alert-id') === 'a1')!;
    await card.get('[data-alert-action="pause"]').trigger('click');
    expect(useActionDialog().current.value).toMatchObject({ action: { kind: 'stopbuy' } });
    expect(world.fake.acts).toHaveLength(0);
  });

  it('two alerts of one bot name their position, so the cards do not read the same', () => {
    const [p1, p2] = world.fixture.positions.filter((x) => !x.orphan);
    const base = useFqAlertsStore().view(FIXTURE_NOW, 'active')[0]!;
    const alerts = [p1!, p2!].map((p, i) => ({
      ...base,
      id: `liq${i}`,
      type_id: 'liquidationBeforeStoploss' as const,
      bot_key: p.bot_key,
      subject: String(p.trade_id),
    }));
    const w = mountCards({ alerts });
    const who = w.findAll('article.card .who').map((x) => x.text());
    expect(who[0]).toContain(pairLabel(p1!.pair));
    expect(who[1]).toContain(pairLabel(p2!.pair));
    expect(who[0]).not.toBe(who[1]);
  });

  it('the other actions are only reported to the page', async () => {
    const w = mountCards();
    const wallet = w.findAll('article.card').find((a) => a.attributes('data-alert-id') === 'a5')!;
    await wallet.get('[data-alert-action="reconcile"]').trigger('click');
    expect(w.emitted('action')![0]![0]).toBe('reconcile');
  });
});

describe('WatchList', () => {
  const lines = () =>
    world.fixture.positions
      .filter((p) => !p.orphan)
      .slice(0, 3)
      .map((p) =>
        lineFromPosition(
          p,
          world.fixture.bots.find((b) => b.bot_key === p.bot_key),
        ),
      );

  it('tells each position in words, with no exit button on the row', async () => {
    const w = mountFq(WatchList, { props: { lines: lines() }, attachTo: document.body });
    const rows = w.findAll('li.row');
    expect(rows).toHaveLength(3);
    expect(rows[0]!.text()).toMatch(/Safety orders/);
    expect(rows[0]!.text()).toMatch(/Liquidation/);
    expect(rows[0]!.text()).toMatch(/Open for/);
    expect(rows[0]!.find('[data-action=exit]').exists()).toBe(false);
    expect(w.find('button[data-action]').exists()).toBe(false);
    await rows[0]!.trigger('click');
    const l = lines()[0]!;
    expect(w.emitted('open')![0]).toEqual([l.botKey, l.tradeId]);
  });

  it('says there is nothing open when the list is empty', () => {
    const w = mountFq(WatchList, { props: { lines: [] } });
    expect(w.text()).toContain('No open position.');
  });
});

describe('RiskPanel summary', () => {
  it('one word and four lines; "Details" opens the rest', async () => {
    const w = mountFq(RiskPanel, {
      props: { scope: FLEET, summary: true, scopeDetail: scopeDetailOf(world.fixture, FLEET) },
      attachTo: document.body,
    });
    expect(w.get('[data-testid=risk-level]').text()).toMatch(/Moderate|High|Critical|No position/);
    expect(w.findAll('dl.sum dt').length).toBeGreaterThanOrEqual(4);
    expect(w.find('.coins').exists()).toBe(false);
    await w.get('[data-testid=risk-details]').trigger('click');
    expect(w.find('.detail-expo').exists()).toBe(true);
  });
});

describe('PositionCard on a phone', () => {
  it('has no exit button of its own: a tap opens the drawer', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes('max-width: 599px'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
      onchange: null,
    })) as never;
    try {
      const p = world.fixture.positions.find((x) => !x.orphan)!;
      const line = lineFromPosition(
        p,
        world.fixture.bots.find((b) => b.bot_key === p.bot_key),
      );
      const w = mountFq(PositionCard, { props: { line, position: p }, attachTo: document.body });
      expect(w.find('[data-action]').exists()).toBe(false);
      await w.trigger('click');
      expect(w.emitted('activate')).toHaveLength(1);
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('AlertCenter (behind the bell)', () => {
  it('holds the whole rail: active, acknowledged, silenced and the events', () => {
    const w = mountFq(AlertCenter, {
      props: { open: true, inline: true },
      attachTo: document.body,
    });
    const rail = document.body.querySelector('[data-testid=alert-rail]');
    expect(rail).not.toBeNull();
    const tabs = [...rail!.querySelectorAll('[role=tab]')].map((t) => t.textContent);
    expect(tabs.join(' ')).toMatch(/Active.*Acknowledged.*Silenced.*Events/s);
    w.unmount();
  });
});
