import type * as EchartsCore from 'echarts/core';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BaseChart from '../../../src/components/ds/BaseChart.vue';
import {
  BotRegistry,
  DcaDepthTable,
  DistributionChart,
  EquityCurve,
  ExitReasonTable,
  Leaderboard,
  MaeMfeBar,
  PnlCalendar,
  ReconciliationTable,
  RiskPanel,
  SystemHealth,
} from '../../../src/components/fq';
import BotHeader from '../../../src/components/fq/BotHeader.vue';
import { useFqPrefsStore } from '../../../src/datasource/stores/prefs';
import FleetTable from '../../../src/components/fq/FleetTable.vue';
import ScopePanel from '../../../src/components/fq/ScopePanel.vue';
import { FIXTURE_NOW, scopeDetailOf } from '../../../src/components/fq/fixtures';
import {
  closedPnlOf,
  makeClosedTrades,
  makeDailyPnl,
  makeDrawdown,
  makeEquity,
  makeRecon,
  makeRegistry,
} from '../../../src/components/fq/fixtures/charts';
import { itemsFromBots } from '../../../src/components/fq/lib/leaderboard';
import { pnlPeriods } from '../../../src/datasource/calc/periods';
import {
  HEALTH_REASON_CODES,
  type BotRow,
  type DrawdownResult,
} from '../../../src/gateway/types.gen';
import { charts, liveCharts, resetCharts } from './chartMock';
import { mountFq, setFqLocale, setupWorld, teardownWorld, type FqWorld } from './helpers';

vi.mock('echarts/core', async (orig) => {
  const actual = await orig<typeof EchartsCore>();
  const mock = await import('./chartMock');
  return { ...actual, init: mock.fakeInit };
});

let world: FqWorld;
beforeEach(() => {
  resetCharts();
  world = setupWorld();
});
afterEach(teardownWorld);

const FLEET = { kind: 'fleet' } as const;
const trades = () => makeClosedTrades(world.fixture.bots);

describe('B73: drawdown ratio shown as a percentage', () => {
  const withDrawdown = (pct: number | null, abs = 220): BotRow => {
    const bot = structuredClone(world.fixture.bots.find((b) => b.identity.mode === 'live')!);
    bot.metrics.drawdown_with_open = {
      abs,
      pct,
      peak_ms: null,
      trough_ms: null,
      current_abs: abs,
    };
    return bot;
  };

  it('BotHeader reads 0.184 as 18.4 % and raises the alert; 0.022 does not', () => {
    const deep = mountFq(BotHeader, { props: { bot: withDrawdown(0.184), nowMs: FIXTURE_NOW } });
    expect(deep.text()).toContain('18.4%');
    const alertCount = (w: { findAll: (s: string) => unknown[] }) => w.findAll('.alert').length;
    const calm = mountFq(BotHeader, { props: { bot: withDrawdown(0.022), nowMs: FIXTURE_NOW } });
    expect(calm.text()).toContain('2.2%');
    expect(calm.text()).not.toContain('0.0%');
    expect(alertCount(deep)).toBe(alertCount(calm) + 1);
  });

  it('an unknown ratio stays unknown: the absolute value alone, no 0 %', () => {
    const w = mountFq(BotHeader, { props: { bot: withDrawdown(null), nowMs: FIXTURE_NOW } });
    expect(w.text()).not.toMatch(/-0\.0%|−0\.0%/);
  });

  it('FleetTable shows the same figure (in the "Drawdown" column, offered by "Columns")', () => {
    useFqPrefsStore().update('columns', { fleet: { visible: ['bot', 'drawdown'], order: [] } });
    const bot = withDrawdown(0.184);
    const w = mountFq(FleetTable, {
      props: { rows: [bot], nowMs: FIXTURE_NOW, containerWidth: 1400 },
      attachTo: document.body,
    });
    expect(w.text()).toContain('18.4%');
  });

  it('ScopePanel shows the same figure', () => {
    const detail = scopeDetailOf(world.fixture, FLEET);
    const w = mountFq(ScopePanel, {
      props: { scope: FLEET, open: true, inline: true, detail },
      attachTo: document.body,
    });
    // The fixture detail carries 0.045 for the live block
    expect(w.text()).toContain('4.5%');
  });

  it('EquityCurve shows 2.4 % for a ratio of 0.024', () => {
    const dd: DrawdownResult = {
      realized: { abs: 216, pct: 0.024, peak_ms: null, trough_ms: null, current_abs: 0 },
      with_open: { abs: 270, pct: 0.03, peak_ms: null, trough_ms: null, current_abs: 0 },
    };
    const w = mountFq(EquityCurve, {
      props: {
        scope: FLEET,
        series: makeEquity('realized'),
        drawdown: dd,
        definition: 'realized',
        nowMs: FIXTURE_NOW,
      },
    });
    expect(w.find('[data-testid=eq-drawdown]').text()).toContain('2.4%');
  });
});

describe('Leaderboard', () => {
  const items = () => itemsFromBots(world.fixture.bots, '7d', FIXTURE_NOW, 0);

  it('shows one mode only, centred on zero, with the total of the counted bots', () => {
    const w = mountFq(Leaderboard, {
      props: { scope: FLEET, period: '7d', mode: 'live', nowMs: FIXTURE_NOW, limit: 100 },
    });
    const live = items().filter((i) => i.mode === 'live');
    expect(w.findAll('li.row')).toHaveLength(live.length);
    expect(w.find('.axis').exists()).toBe(true);
    const bars = w.findAll('i.bar');
    expect(bars.some((b) => b.classes().includes('p'))).toBe(true);
    expect(bars.some((b) => b.classes().includes('n'))).toBe(true);
  });

  it('a stale bot gets a hatch instead of a bar, is muted and does not set the scale', () => {
    const live = items().filter((i) => i.mode === 'live');
    const list = [
      { ...live[0]!, value: 99999, stale: true },
      { ...live[1]!, value: 10, stale: false },
      { ...live[2]!, value: -5, stale: false },
    ];
    const w = mountFq(Leaderboard, {
      props: { scope: FLEET, period: '7d', mode: 'live', items: list },
    });
    const rows = w.findAll('li.row');
    const off = rows.filter((r) => r.classes().includes('off'));
    expect(off).toHaveLength(1);
    expect(off[0]!.find('i.hatch').exists()).toBe(true);
    expect(off[0]!.find('i.bar').exists()).toBe(false);
    // The biggest counted bar fills its half of the track
    const widths = w.findAll('i.bar').map((b) => b.attributes('style'));
    expect(widths[0]).toContain('width: 50%');
    // The total leaves the stale value out
    expect(w.find('.sum').text()).toContain('+5.00');
    expect(w.find('.sum').text()).not.toContain('99');
  });

  it('an unknown value has no figure and no bar', () => {
    const live = items().filter((i) => i.mode === 'live');
    const w = mountFq(Leaderboard, {
      props: {
        scope: FLEET,
        period: '7d',
        mode: 'live',
        items: [{ ...live[0]!, value: null, stale: false }],
      },
    });
    expect(w.find('i.bar').exists()).toBe(false);
    expect(w.find('.val [data-state="unavailable"]').exists()).toBe(true);
  });

  it('emits the bot key on click', async () => {
    const live = items().filter((i) => i.mode === 'live');
    const w = mountFq(Leaderboard, {
      props: { scope: FLEET, period: '7d', mode: 'live', items: live.slice(0, 3) },
    });
    await w.find('button.nm').trigger('click');
    expect(w.emitted('select')?.[0]).toEqual([expect.any(String)]);
  });

  it('with no bot at all: the empty state, no total', () => {
    const w = mountFq(Leaderboard, { props: { scope: FLEET, period: '7d', items: [] } });
    expect(w.findAll('li.row')).toHaveLength(0);
    expect(w.find('.sum').exists()).toBe(false);
  });
});

describe('PnlCalendar', () => {
  const tz = 'Europe/Paris' as const;
  const autumn = Date.UTC(2026, 9, 30, 12);
  const build = (now: number, n = 70) => pnlPeriods(makeDailyPnl(), 'day', tz, now, n);

  it('draws the month in the zone, Monday first, and says so', () => {
    const w = mountFq(PnlCalendar, {
      props: { scope: FLEET, buckets: build(autumn), month: '2026-10', tz, nowMs: autumn },
    });
    expect(w.find('[data-testid=cal-title]').text()).toBe('October 2026');
    expect(w.findAll('[role=columnheader]')[0]!.text()).toBe('Mon');
    expect(w.text()).toContain('Europe/Paris');
    expect(w.findAll('button.d')).toHaveLength(31);
  });

  it('a 25 hour day is marked, in the aria label too', () => {
    const w = mountFq(PnlCalendar, {
      props: { scope: FLEET, buckets: build(autumn), month: '2026-10', tz, nowMs: autumn },
    });
    const day = w.findAll('button.d').find((b) => b.find('.n').text() === '25')!;
    expect(day.find('.dst').text()).toBe('25 h');
    expect(day.attributes('aria-label')).toContain('25');
    const normal = w.findAll('button.d').find((b) => b.find('.n').text() === '24')!;
    expect(normal.find('.dst').exists()).toBe(false);
  });

  it('a 23 hour day in March', () => {
    const spring = Date.UTC(2026, 3, 5, 12);
    const w = mountFq(PnlCalendar, {
      props: { scope: FLEET, buckets: build(spring, 80), month: '2026-03', tz, nowMs: spring },
    });
    const day = w.findAll('button.d').find((b) => b.find('.n').text() === '29')!;
    expect(day.find('.dst').text()).toBe('23 h');
  });

  it('the same instant is another day in UTC: no daylight-saving mark', () => {
    const w = mountFq(PnlCalendar, {
      props: {
        scope: FLEET,
        buckets: pnlPeriods(makeDailyPnl(), 'day', 'UTC', autumn, 70),
        month: '2026-10',
        tz: 'UTC',
        nowMs: autumn,
      },
    });
    expect(w.find('.dst').exists()).toBe(false);
  });

  it('future days are disabled and carry no figure; a past day can be picked', async () => {
    const now = Date.UTC(2026, 9, 15, 12);
    const w = mountFq(PnlCalendar, {
      props: { scope: FLEET, buckets: build(now), month: '2026-10', tz, nowMs: now },
    });
    const future = w.findAll('button.d').find((b) => b.find('.n').text() === '20')!;
    expect(future.attributes('disabled')).toBeDefined();
    expect(future.find('.v').exists()).toBe(false);
    const past = w.findAll('button.d').find((b) => b.find('.n').text() === '10')!;
    await past.trigger('click');
    expect(w.emitted('selectDay')).toHaveLength(1);
    expect((w.emitted('selectDay')![0]![0] as { label: string }).label).toBe('2026-10-10');
  });

  it('a past day without any bucket is unknown (an icon with its reason), not zero', () => {
    const now = Date.UTC(2026, 9, 15, 12);
    const buckets = build(now).filter((b) => b.label !== '2026-10-05');
    const w = mountFq(PnlCalendar, {
      props: { scope: FLEET, buckets, month: '2026-10', tz, nowMs: now },
    });
    const day = w.findAll('button.d').find((b) => b.find('.n').text() === '5')!;
    expect(day.classes()).toContain('missing');
    expect(day.attributes('disabled')).toBeDefined();
    expect(day.find('.v').text()).toBe('');
    expect(day.find('.v [data-state="unavailable"]').attributes('aria-label')).toBe(
      'no figure for this day',
    );
  });

  it('month arrows emit the neighbour month; the next one is disabled on the current month', async () => {
    const now = Date.UTC(2026, 9, 15, 12);
    const w = mountFq(PnlCalendar, {
      props: { scope: FLEET, buckets: build(now), month: '2026-10', tz, nowMs: now },
    });
    await w.find('button[aria-label="Previous month"]').trigger('click');
    expect(w.emitted('update:month')?.[0]).toEqual(['2026-09']);
    expect(w.find('button[aria-label="Next month"]').attributes('aria-disabled')).toBe('true');
  });

  it('the month total is the sum of the days drawn, never of the future', () => {
    const now = Date.UTC(2026, 9, 15, 12);
    const closed = [
      { ts_ms: Date.UTC(2026, 9, 3, 10), profit_abs: 30 },
      { ts_ms: Date.UTC(2026, 9, 4, 10), profit_abs: -10 },
    ];
    const w = mountFq(PnlCalendar, {
      props: {
        scope: FLEET,
        buckets: pnlPeriods(closed, 'day', tz, now, 40),
        month: '2026-10',
        tz,
        nowMs: now,
      },
    });
    expect(w.find('[data-testid=cal-sum]').text()).toContain('+20');
    expect(w.find('[data-testid=cal-sum]').text()).toContain('1 winning day');
  });
});

describe('EquityCurve', () => {
  const mount = (extra: Record<string, unknown> = {}) =>
    mountFq(EquityCurve, {
      props: {
        scope: FLEET,
        series: makeEquity('realized'),
        drawdown: makeDrawdown(closedPnlOf(trades())),
        nowMs: FIXTURE_NOW,
        ...extra,
      },
      attachTo: document.body,
    });

  it('one chart instance, the drawdown inside it, released on unmount', () => {
    const w = mount();
    expect(w.findAllComponents(BaseChart)).toHaveLength(1);
    expect(liveCharts()).toHaveLength(1);
    const option = charts[0]!.last() as { series: Array<{ id?: string }> };
    expect(option.series.length).toBeGreaterThanOrEqual(2);
    w.unmount();
    expect(liveCharts()).toHaveLength(0);
    expect(charts.every((c) => c.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('absolute drawdown comes first, the percentage after', () => {
    const w = mount();
    const t = w.find('[data-testid=eq-drawdown]').text();
    expect(t.indexOf('USDC')).toBeGreaterThan(-1);
    expect(t.indexOf('USDC')).toBeLessThan(t.indexOf('%'));
  });

  it('both definitions are offered, with positions open by default, and emit', async () => {
    const w = mount();
    const radios = w.findAll('[role=radio]');
    const labels = radios.map((r) => r.text());
    expect(labels.slice(0, 2)).toEqual(['Open positions included', 'Without open positions']);
    await radios[1]!.trigger('click');
    expect(w.emitted('update:definition')?.[0]).toEqual(['realized']);
    await radios.find((r) => /^30/.test(r.text()))!.trigger('click');
    expect(w.emitted('update:period')?.[0]).toEqual(['30d']);
  });

  it('without a drawdown from the source the figure is read off the curve and says so', () => {
    const w = mount({ drawdown: null });
    expect(w.find('[data-testid=eq-drawdown]').text()).toMatch(/curve/i);
  });

  it('a series with no point shows an empty state and no chart', () => {
    const w = mount({ series: { mode: 'realized', points: [], unavailable: null, asOfMs: 1 } });
    expect(w.findAllComponents(BaseChart)).toHaveLength(0);
    expect(liveCharts()).toHaveLength(0);
  });

  it('a partial series (some bots unavailable) is announced', () => {
    const s = makeEquity('realized');
    const w = mount({ series: { ...s, unavailable: 'bots_offline' } });
    expect(w.find('[data-testid=eq-partial]').exists()).toBe(true);
  });
});

describe('DistributionChart', () => {
  it('one chart, a sentence about the left tail, the unknown trades counted apart', () => {
    const w = mountFq(DistributionChart, { props: { trades: trades() } });
    expect(w.findAllComponents(BaseChart)).toHaveLength(1);
    expect(w.find('[data-testid=dist-sentence]').text()).toMatch(/under −5/);
    expect(w.find('[data-testid=dist-unknown]').text()).toContain('1');
    const option = charts[0]!.last() as { series: Array<{ data: unknown[] }> };
    const drawn = (option.series[0]!.data as Array<number | { value: number }>).reduce<number>(
      (s, d) => s + (typeof d === 'number' ? d : d.value),
      0,
    );
    expect(drawn).toBe(trades().length - 1);
  });

  it('is released on unmount', () => {
    const w = mountFq(DistributionChart, { props: { trades: trades() } });
    expect(liveCharts()).toHaveLength(1);
    w.unmount();
    expect(liveCharts()).toHaveLength(0);
  });

  it('a set with no loss says nothing about a tail', () => {
    const wins = trades()
      .filter((t) => (t.profit_abs ?? -1) > 0)
      .slice(0, 5);
    const w = mountFq(DistributionChart, { props: { trades: wins } });
    expect(w.find('[data-testid=dist-sentence]').text()).not.toMatch(/%\s+of the gross/);
  });
});

describe('DcaDepthTable and ExitReasonTable', () => {
  it('DCA depth: the sentence compares deep and shallow ladders; unknown profit counted apart', () => {
    const w = mountFq(DcaDepthTable, { props: { trades: trades() } });
    expect(w.find('[data-testid=depth-sentence]').text()).toMatch(/From 4 filled orders/);
    expect(w.find('[data-testid=depth-unknown-profit]').exists()).toBe(true);
    expect(w.findAll('tbody tr').length).toBeGreaterThanOrEqual(5);
  });

  it('DCA depth without the field says it is missing instead of drawing zeros', () => {
    const bare = trades().map((t) => ({ ...t, dca_entries: undefined }));
    const w = mountFq(DcaDepthTable, { props: { trades: bare } });
    expect(w.find('[data-testid=depth-missing]').exists()).toBe(true);
    expect(w.find('[data-testid=depth-sentence]').exists()).toBe(false);
  });

  it('exit reasons: custom and unknown reasons are their own rows, manual exits marked', () => {
    const w = mountFq(ExitReasonTable, { props: { trades: trades() } });
    const text = w.text();
    expect(text).toContain('custom_exit_rsi_overbought');
    expect(text.toLowerCase()).toContain('unknown');
    expect(text).toContain('manual');
    expect(w.find('[data-testid=exit-unknown-profit]').exists()).toBe(true);
  });

  it('no trade: no row, no invented figure', () => {
    const w = mountFq(ExitReasonTable, { props: { trades: [] } });
    expect(w.findAll('tbody tr')).toHaveLength(0);
  });
});

describe('RiskPanel', () => {
  const detail = () => scopeDetailOf(world.fixture, FLEET);

  it('shows the closest liquidation, the leverage and the netted coins', () => {
    const w = mountFq(RiskPanel, {
      props: { scope: FLEET, scopeDetail: detail(), detail: true, mode: 'live' },
    });
    expect(w.find('[data-testid=risk-nearest]').text()).toMatch(/\d+(\.\d)?%/);
    expect(w.find('[data-testid=risk-leverage]').text()).toContain('×');
    expect(Number(w.find('[data-testid=risk-netting-count]').text())).toBeGreaterThan(0);
    expect(w.findAll('[role=row]').length + w.findAll('[role=cell]').length).toBeGreaterThan(0);
  });

  const withLive = (patch: Record<string, unknown>) => {
    const d = detail();
    return {
      ...d,
      totals: d.totals.map((t) => (t.mode === 'live' ? { ...t, ...patch } : t)),
    };
  };

  it('says exposure is not fully netted when some wallets are unknown', () => {
    const w = mountFq(RiskPanel, {
      props: { scope: FLEET, scopeDetail: withLive({ netted: false }), detail: true, mode: 'live' },
    });
    expect(w.find('[data-testid=risk-not-netted]').exists()).toBe(true);
    const ok = mountFq(RiskPanel, {
      props: { scope: FLEET, scopeDetail: withLive({ netted: true }), detail: true, mode: 'live' },
    });
    expect(ok.find('[data-testid=risk-not-netted]').exists()).toBe(false);
  });

  it('an unknown capital gives no leverage rather than infinity', () => {
    const w = mountFq(RiskPanel, {
      props: {
        scope: FLEET,
        scopeDetail: withLive({ starting_capital: { total: 0, known: 0, unknown: 3 } }),
        detail: true,
        mode: 'live',
      },
    });
    const t = w.find('[data-testid=risk-leverage]').text();
    expect(t).not.toMatch(/Infinity|NaN/);
    expect(t).not.toContain('×');
  });
});

describe('SystemHealth', () => {
  it('level, reasons, budget and cache in a degraded fixture', () => {
    const w = mountFq(SystemHealth, { props: { detail: true, nowMs: FIXTURE_NOW } });
    expect(w.find('[data-testid=health-level]').text()).toContain('Slowed');
    expect(w.find('[data-testid=health-budget]').text()).toContain('61%');
    expect(w.find('[data-testid=health-cache]').text()).toContain('97.0%');
    expect(w.find('[data-testid=health-connection]').exists()).toBe(true);
  });

  it('compact mode has no connection block', () => {
    const w = mountFq(SystemHealth, { props: { nowMs: FIXTURE_NOW } });
    expect(w.find('[data-testid=health-connection]').exists()).toBe(false);
  });

  it('a reason code the translations do not know is shown as received', () => {
    const health = structuredClone(world.fixture.health);
    health.reasons = [{ code: 'quantum_flux', severity: 'warning', detail: null } as never];
    const w = mountFq(SystemHealth, { props: { health, nowMs: FIXTURE_NOW } });
    expect(w.text()).toContain('quantum_flux');
    expect(w.find('[data-testid=health-no-reason]').exists()).toBe(false);
  });

  it('words every reason code of the gateway in both languages (QA 2026-10-15: raw `rate_budget_low`)', () => {
    for (const lang of ['en', 'fr'] as const) {
      setFqLocale(lang);
      for (const code of HEALTH_REASON_CODES) {
        const health = structuredClone(world.fixture.health);
        health.reasons = [{ code, severity: 'warning', detail: null, alert_id: null }];
        const w = mountFq(SystemHealth, { props: { health, nowMs: FIXTURE_NOW } });
        const text = w.find('.reasons b').text();
        expect(text, `${lang} ${code}`).not.toBe(code);
        expect(text, `${lang} ${code}`).not.toContain('fq.sysh');
        w.unmount();
      }
    }
  });

  it('words the figure of a detail and leaves the others as they are', () => {
    const health = structuredClone(world.fixture.health);
    health.reasons = [
      { code: 'rate_budget_low', severity: 'warning', detail: '20', alert_id: null },
      { code: 'bots_offline', severity: 'warning', detail: '3/24', alert_id: null },
      { code: 'rate_limit_events', severity: 'warning', detail: '1', alert_id: null },
    ];
    const text = mountFq(SystemHealth, { props: { health, nowMs: FIXTURE_NOW } }).text();
    expect(text).toContain('20 % left');
    expect(text).toContain('3/24');
    expect(text).toContain('1 bot');
    expect(text).not.toContain('20% left');
  });

  it('no reason: says so', () => {
    const health = structuredClone(world.fixture.health);
    health.reasons = [];
    health.level = 'ok';
    const w = mountFq(SystemHealth, { props: { health, nowMs: FIXTURE_NOW } });
    expect(w.find('[data-testid=health-no-reason]').exists()).toBe(true);
  });

  it('the backoff level is not shown as a budget in alarm', () => {
    const health = structuredClone(world.fixture.health);
    health.rate_budget_pct = 95;
    const w = mountFq(SystemHealth, { props: { health, nowMs: FIXTURE_NOW } });
    expect(w.find('[data-testid=health-budget]').html()).toMatch(/crit/);
  });
});

describe('ReconciliationTable', () => {
  const mount = (extra: Record<string, unknown> = {}) =>
    mountFq(ReconciliationTable, {
      props: {
        wallet: '0xAbCd...1234',
        rows: makeRecon(),
        checkedMs: FIXTURE_NOW - 20_000,
        nowMs: FIXTURE_NOW,
        ...extra,
      },
    });

  it('problems first; only unowned, phantom and minority rows can be previewed', () => {
    const w = mount();
    expect(w.findAll('tbody tr').map((r) => r.attributes('data-status'))).toEqual([
      'unowned',
      'ambiguous',
      'phantom',
      'ok',
      'ok',
    ]);
    const withButton = w
      .findAll('tbody tr')
      .filter((r) => r.find('button').exists())
      .map((r) => r.attributes('data-status'));
    expect(withButton).toEqual(['unowned', 'phantom']);
  });

  it('the preview button only emits: this component never writes', async () => {
    const w = mount();
    await w.find('button[data-coin=PENGU]').trigger('click');
    expect(w.emitted('preview')).toHaveLength(1);
    expect((w.emitted('preview')![0]![0] as { coin: string }).coin).toBe('PENGU');
  });

  it('busy blocks every preview', () => {
    const w = mount({ busy: true });
    for (const b of w.findAll('tbody button')) expect(b.attributes('aria-disabled')).toBe('true');
  });

  it('shows the wallet shortened and the time before the next sweep', () => {
    const w = mount();
    expect(w.text()).toContain('0xAbCd...1234');
    expect(w.find('[data-testid=recon-foot]').text()).toContain('40 s');
    const later = mount({ checkedMs: FIXTURE_NOW - 120_000 });
    expect(later.find('[data-testid=recon-foot]').text()).not.toMatch(/next possible/);
  });

  it('an ambiguous row lists the hints and offers no action', () => {
    const w = mount();
    const row = w.find('tr[data-status=ambiguous]');
    expect(row.text()).toContain('Refresh first');
    expect(row.find('button').exists()).toBe(false);
  });

  it('no coin: the empty state', () => {
    const w = mount({ rows: [], checkedMs: null });
    expect(w.findAll('tbody tr')).toHaveLength(0);
    expect(w.find('[data-testid=recon-foot]').exists()).toBe(false);
  });
});

describe('BotRegistry', () => {
  const mount = () => {
    const reg = makeRegistry(world.fixture);
    return mountFq(BotRegistry, { props: { ...reg, nowMs: FIXTURE_NOW } });
  };

  it('lists the migration, the discovered bots and the registry with aliases', () => {
    const w = mount();
    expect(w.find('[data-testid=registry-migration]').text()).toContain('13 bots');
    expect(w.find('[data-testid=registry-migration]').text()).toContain('1 entry could not');
    expect(w.find('[data-testid=registry-discovered]').text()).toContain('2 bots detected');
    expect(w.find('tr[data-key="local:9401"]').text()).toContain('ftbot.1 · local:9401');
    // The 14th bot has no alias yet: its key alone, never a renumbered ftbot.N
    const noAlias = w.find('tr[data-key="local:9414"]').text();
    expect(noAlias).toContain('local:9414');
    expect(noAlias).not.toMatch(/ftbot\.\d|- · local/);
  });

  it('an expired session offers Reconnect, others Edit; both only emit', async () => {
    const w = mount();
    const expired = w.find('tr[data-key="local:9406"]');
    await expired.find('button.relog').trigger('click');
    expect(w.emitted('reconnect')?.[0]).toEqual(['local:9406']);
    expect(expired.find('button[aria-label^="Edit"]').exists()).toBe(false);
    await w.find('tr[data-key="local:9401"] button').trigger('click');
    expect(w.emitted('edit')?.[0]).toEqual(['local:9401']);
  });

  it('adds one discovered bot or all of them', async () => {
    const w = mount();
    const one = w.find('[data-testid=registry-discovered] button.one');
    await one.trigger('click');
    expect(w.emitted('add')?.[0]![0]).toHaveLength(1);
    const all = w.findAll('[data-testid=registry-discovered] button').at(-1)!;
    await all.trigger('click');
    expect(w.emitted('add')?.[1]![0]).toHaveLength(2);
  });

  it('without a record it says no migration was needed', () => {
    const reg = makeRegistry(world.fixture);
    const w = mountFq(BotRegistry, { props: { ...reg, migration: null, discovered: [] } });
    expect(w.find('[data-testid=registry-no-migration]').exists()).toBe(true);
    expect(w.find('[data-testid=registry-discovered]').exists()).toBe(false);
  });

  it('French plural: one entry, one bot', () => {
    setFqLocale('fr');
    const reg = makeRegistry(world.fixture);
    const w = mountFq(BotRegistry, {
      props: { ...reg, bots: reg.bots.slice(0, 1), nowMs: FIXTURE_NOW },
    });
    const t = w.find('[data-testid=registry-migration]').text();
    expect(t).toContain("1 entrée n'a pas");
  });
});

describe('MaeMfeBar', () => {
  it('draws the excursions and the exit; unknown excursions draw nothing', () => {
    const w = mountFq(MaeMfeBar, { props: { mae: -0.05, mfe: 0.03, exit: 0.01 } });
    expect(w.find('[role=img]').exists()).toBe(true);
    expect(w.find('[role=img]').attributes('aria-label')).toMatch(/5/);
    const none = mountFq(MaeMfeBar, { props: { mae: null, mfe: null } });
    expect(none.find('.mm').exists()).toBe(false);
    expect(none.find('[data-state="unavailable"]').exists()).toBe(true);
    const half = mountFq(MaeMfeBar, { props: { mae: -0.02, mfe: undefined } });
    expect(half.find('.mm').exists()).toBe(false);
    expect(half.find('[data-state="unavailable"]').exists()).toBe(true);
  });
});

describe('render budget (02 section 14)', () => {
  it('only the three chart composites own an ECharts instance; the others are DOM', async () => {
    mountFq(EquityCurve, {
      props: { scope: FLEET, series: makeEquity('realized'), drawdown: null, nowMs: FIXTURE_NOW },
    });
    mountFq(DistributionChart, { props: { trades: trades() } });
    const chartsOnly = liveCharts().length;
    expect(chartsOnly).toBe(2);
    // The calendar, leaderboard, tables, risk panel and health block add no instance
    mountFq(PnlCalendar, { props: { scope: FLEET, buckets: [], month: '2026-10' } });
    mountFq(Leaderboard, { props: { scope: FLEET, period: '7d', items: [] } });
    mountFq(DcaDepthTable, { props: { trades: trades() } });
    mountFq(ExitReasonTable, { props: { trades: trades() } });
    mountFq(RiskPanel, {
      props: { scope: FLEET, scopeDetail: scopeDetailOf(world.fixture, FLEET) },
    });
    mountFq(SystemHealth, { props: { nowMs: FIXTURE_NOW } });
    await flushPromises();
    expect(liveCharts()).toHaveLength(chartsOnly);
    expect(liveCharts().length).toBeLessThanOrEqual(3);
  });
});
