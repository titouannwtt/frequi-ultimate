import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import BotHeader from '../../../src/components/fq/BotHeader.vue';
import FleetKpis from '../../../src/components/fq/FleetKpis.vue';
import FleetMap from '../../../src/components/fq/FleetMap.vue';
import FleetTable from '../../../src/components/fq/FleetTable.vue';
import PositionCard from '../../../src/components/fq/PositionCard.vue';
import ScopePanel from '../../../src/components/fq/ScopePanel.vue';
import TradeDrawerBody from '../../../src/components/fq/TradeDrawerBody.vue';
import TradeTable from '../../../src/components/fq/TradeTable.vue';
import { FIXTURE_NOW, makeBot, makePosition } from '../../../src/components/fq/fixtures';
import { lineFromPosition } from '../../../src/components/fq/lib/trades';
import { scopeTotalsByMode } from '../../../src/datasource/calc/scopeTotals';
import type { ScopeDetail } from '../../../src/datasource/types';
import { useFqHealthStore } from '../../../src/datasource/stores/health';
import type { BotRow, Position } from '../../../src/gateway/types.gen';
import en from '../../../src/locales/redesign/en';
import fr from '../../../src/locales/redesign/fr';
import { mountFq, setFqLocale, setupWorld, teardownWorld } from './helpers';

/**
 * No placeholder word in a value slot (docs/redesign/02-design.md, section 10.1): while a figure is
 * not there, the slot is an icon (pending or unavailable), never "n/d", "n/a", "inconnu", "latent"
 * or "pas encore lu". The same rule, three ways: the messages are gone, no source reads them, and
 * the main composites render none in the states that used to show them.
 */
const SRC = join(__dirname, '../../../src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'fixtures' ? [] : walk(path);
    return /\.(vue|ts)$/.test(name) ? [path] : [];
  });
}

// The words that mean "no figure here" (not the labels "P&L latent" or "Drawdown avec latent")
const PLACEHOLDER = /(?<![\w&])(n\/[ad]|inconnu|unknown|pas encore lu|not read yet|--)(?![\w])/i;

describe('the placeholder messages are gone', () => {
  it('fq.ds.notAvailable and fq.ds.dash exist in neither language', () => {
    for (const messages of [fr, en] as Array<{ ds: Record<string, unknown> }>) {
      expect(messages.ds).not.toHaveProperty('notAvailable');
      expect(messages.ds).not.toHaveProperty('dash');
    }
  });

  it('no component of the redesign reads them or writes "n/d" in a value', () => {
    const files = [
      ...walk(join(SRC, 'components/ds')),
      ...walk(join(SRC, 'components/fq')),
      ...walk(join(SRC, 'views/fq')),
    ];
    const offenders: string[] = [];
    for (const file of files) {
      // Comments may say what is forbidden
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/<!--[\s\S]*?-->/g, '');
      if (/ds\.notAvailable|ds\.dash|origin\.unknown/.test(text)) offenders.push(`${file}: key`);
      // A string literal that is a placeholder: 'n/d', "n/a", '--'
      if (/['"`](n\/[ad]|--)['"`]/.test(text)) offenders.push(`${file}: literal`);
    }
    expect(offenders).toEqual([]);
  });
});

// ---- the composites, in the states that used to print a word ----

const live = (seq: number, slots: number, latent: number | null, extra: Partial<BotRow> = {}) =>
  ({
    ...makeBot(seq, {
      name: `bot_${seq}`,
      mode: 'live',
      slots,
      latent,
      capital: 1000,
      long: slots * 100,
      short: 0,
    }),
    ...extra,
  }) as BotRow;

const starting = (seq: number) => {
  const b = live(seq, 0, null);
  return {
    ...b,
    state: { ...b.state, status: 'starting' },
    freshness: {},
    metrics: {
      ...b.metrics,
      realized_1d: null,
      realized_7d: null,
      realized_30d: null,
      realized_total: null,
      starting_capital: null,
      exposure_long: null,
      exposure_short: null,
      drawdown_with_open: null,
      winrate: null,
      last_trade_ms: null,
      spark24h: [],
    },
  } as BotRow;
};

function detailOf(bots: BotRow[], blind: boolean): ScopeDetail {
  const positions: Position[] = bots.flatMap((b) =>
    Array.from({ length: b.state.open_trades }, (_, i) => {
      const p = makePosition(b, 'BTC/USDC:USDC', i + 1, 'long', 0.5);
      return blind
        ? { ...p, current_rate: null, profit_abs: null, profit_ratio: null, liq_distance_pct: null }
        : p;
    }),
  );
  return {
    scope: { kind: 'fleet' },
    bots,
    positions,
    totals: scopeTotalsByMode(bots, positions, (k) => k),
    drawdown: {
      realized: { abs: 10, pct: 0.01, peak_ms: null, trough_ms: null, current_abs: 0 },
      with_open: { abs: 30, pct: 0.03, peak_ms: null, trough_ms: null, current_abs: 0 },
      open_worst_sum: 0,
      has_open: true,
      base: 1000,
    },
    asOfMs: FIXTURE_NOW,
  };
}

const valueTexts = (w: ReturnType<typeof mountFq>) => w.findAll('.v').map((v) => v.text());

describe.each(['en', 'fr'] as const)('composites without a figure (%s)', (lang) => {
  beforeEach(() => {
    setupWorld();
    setFqLocale(lang);
  });
  afterEach(() => {
    setFqLocale('en');
    teardownWorld();
  });

  it('KPI strip not loaded yet: four spinners, no word, one live region each', () => {
    const w = mountFq(FleetKpis, { props: { nowMs: FIXTURE_NOW }, attachTo: document.body });
    const tiles = w.get('[data-testid=kpi-loading]').findAll('.kpi');
    expect(tiles).toHaveLength(4);
    for (const tile of tiles) {
      expect(tile.find('.v [data-state="pending"]').exists()).toBe(true);
      expect(tile.get('.v').text()).toBe('');
      expect(tile.get('.v [data-state="pending"]').attributes('role')).toBe('status');
    }
  });

  it('KPI strip with every position unpriced: the open P&L, the capital and the drawdown are icons, not 0.00', () => {
    const d = detailOf([live(60, 4, null), live(61, 3, null), live(62, 0, 0)], true);
    const w = mountFq(FleetKpis, {
      props: { detail: d, nowMs: FIXTURE_NOW },
      attachTo: document.body,
    });
    for (const id of ['kpi-equity', 'kpi-dd']) {
      const tile = w.get(`[data-testid=${id}]`);
      expect(tile.get('.v').text(), id).toBe('');
      const icon = tile.get('.v [data-state="unavailable"]');
      expect(icon.attributes('aria-label')).toMatch(/7/);
    }
    // The open P&L, in the sub-line of the capital, is an icon too
    expect(w.get('[data-testid=kpi-open] [data-state="unavailable"]').exists()).toBe(true);
    // The figures that need no price are still there
    expect(w.get('[data-testid=kpi-30d]').get('.v').text()).toMatch(/\d/);
    expect(w.text()).not.toMatch(/0[.,]00/);
    expect(valueTexts(w).join(' ')).not.toMatch(PLACEHOLDER);
  });

  it('KPI strip with some positions unpriced: the partial sum and "N excluded"', () => {
    const good = live(63, 2, 8);
    const blind = live(64, 3, null);
    const d = detailOf([good, blind], false);
    d.positions = d.positions.map((p) =>
      p.bot_key === blind.bot_key ? { ...p, current_rate: null, profit_abs: null } : p,
    );
    const w = mountFq(FleetKpis, {
      props: { detail: d, nowMs: FIXTURE_NOW },
      attachTo: document.body,
    });
    expect(w.get('[data-testid=kpi-open]').text()).toMatch(/8/);
    expect(w.get('[data-testid=kpi-open]').find('[data-state]').exists()).toBe(false);
    expect(w.find('.excl').exists()).toBe(true);
  });

  it('fleet table: a bot not read yet is spinners, an unpriced one is icons', () => {
    const rows = [starting(65), live(66, 3, null), live(67, 2, 4.5)];
    const w = mountFq(FleetTable, {
      props: { rows, nowMs: FIXTURE_NOW, containerWidth: 1300 },
      attachTo: document.body,
    });
    const unread = w.get(`tr[data-bot-key="${rows[0]!.bot_key}"]`);
    expect(unread.findAll('[data-state="pending"]').length).toBeGreaterThanOrEqual(4);
    const blind = w.get(`tr[data-bot-key="${rows[1]!.bot_key}"]`);
    expect(blind.findAll('[data-state="unavailable"]').length).toBeGreaterThan(0);
    for (const row of w.findAll('tr.bot')) {
      expect(row.text()).not.toMatch(PLACEHOLDER);
    }
  });

  it('fleet map: a tile without a figure shows the icon', () => {
    const rows = [starting(70), live(71, 3, null)];
    const w = mountFq(FleetMap, { props: { rows, nowMs: FIXTURE_NOW }, attachTo: document.body });
    for (const tile of w.findAll('.tile')) {
      expect(tile.find('.t-val [data-state]').exists()).toBe(true);
      expect(tile.get('.t-val').text()).toBe('');
    }
  });

  it('bot header: unread bot is spinners everywhere, unpriced bot says why', () => {
    const unread = mountFq(BotHeader, {
      props: { bot: starting(72), nowMs: FIXTURE_NOW },
      attachTo: document.body,
    });
    for (const v of unread.findAll('.kpi .v')) {
      expect(v.find('[data-state]').exists() || /\d/.test(v.text())).toBe(true);
    }
    expect(unread.text()).not.toMatch(PLACEHOLDER);
    const blind = mountFq(BotHeader, {
      props: { bot: live(73, 2, null), nowMs: FIXTURE_NOW },
      attachTo: document.body,
    });
    const latent = blind
      .findAll('.kpi')
      .find((k) => /En cours|P&L|Open/i.test(k.find('.k').text()))!;
    expect(latent.find('.v [data-state="unavailable"]').exists()).toBe(true);
    expect(latent.get('.v').text()).toBe('');
  });

  it('scope panel: the same states as the strip', () => {
    const d = detailOf([live(74, 4, null), live(75, 0, 0)], true);
    const w = mountFq(ScopePanel, {
      props: { scope: { kind: 'fleet' }, open: true, detail: d, inline: true },
      attachTo: document.body,
    });
    const tiles = w.findAll('.tiles .kpi');
    expect(tiles.length).toBeGreaterThan(3);
    const open = tiles[0]!;
    expect(open.find('.v [data-state="unavailable"]').exists()).toBe(true);
    expect(open.get('.v').text()).toBe('');
    expect(w.text()).not.toMatch(PLACEHOLDER);
  });

  it('trade table and cards: a position without a price is icons, not a word', () => {
    const bot = live(76, 2, null);
    const blind = [1, 2].map((id) => ({
      ...makePosition(bot, 'BTC/USDC:USDC', id, 'long', 0.5),
      current_rate: null,
      profit_abs: null,
      profit_ratio: null,
      liq_distance_pct: null,
    })) as Position[];
    const table = mountFq(TradeTable, {
      props: { preset: 'open', positions: blind, containerWidth: 1300 },
      attachTo: document.body,
    });
    const rows = table.findAll('tbody tr:not(.pad):not(.none)');
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.findAll('[data-state="unavailable"]').length).toBeGreaterThanOrEqual(3);
      expect(row.text()).not.toMatch(PLACEHOLDER);
    }
    const card = mountFq(PositionCard, {
      props: { line: lineFromPosition(blind[0]!, bot) },
      attachTo: document.body,
    });
    expect(card.findAll('[data-state="unavailable"]').length).toBeGreaterThanOrEqual(3);
    expect(card.text()).not.toMatch(PLACEHOLDER);
  });

  it('drawer: no take profit API and unread orders are icons', () => {
    const bot = live(77, 2, 3);
    const p = makePosition(bot, 'BTC/USDC:USDC', 1, 'long', 0.5);
    const w = mountFq(TradeDrawerBody, {
      props: { position: p, tp: null, orders: [], ordersLoading: true },
      attachTo: document.body,
    });
    const facts = w.findAll('.fact');
    const byKey = (k: string) =>
      facts.find((f) => f.find('.k').text().length > 0 && f.html().includes(k));
    expect(facts.length).toBe(6);
    // Take profit: no API exposes it, said once the page is loaded, not "loading"
    const tp = facts[3]!;
    expect(tp.find('[data-state="unavailable"]').exists()).toBe(true);
    expect(tp.get('.v').text()).toBe('');
    // Next safety order: the orders are being read
    expect(facts[4]!.find('[data-state="pending"]').exists()).toBe(true);
    expect(byKey).toBeDefined();
    expect(w.text()).not.toMatch(PLACEHOLDER);
  });

  it('a price based reason names the 429 backoff when the daemon says it is on', async () => {
    useFqHealthStore().apply({
      kind: 'snapshot',
      seq: 1,
      ts: 0,
      replace: ['health'],
      upsert: {
        health: {
          h: {
            level: 'degraded',
            reasons: [],
            rate_budget_pct: 100,
            backoff_active: true,
            hit_rate: null,
            bots_process: null,
            digest_age_s: null,
            freshness: { as_of_ms: FIXTURE_NOW, source: 'digest', stale: false },
          },
        },
      } as never,
      remove: {},
    });
    const d = detailOf([live(78, 5, null)], true);
    const w = mountFq(FleetKpis, {
      props: { detail: d, nowMs: FIXTURE_NOW },
      attachTo: document.body,
    });
    const label = w
      .get('[data-testid=kpi-open] [data-state="unavailable"]')
      .attributes('aria-label');
    expect(label).toMatch(lang === 'en' ? /429.*5 positions/ : /429.*5 positions/);
  });
});
