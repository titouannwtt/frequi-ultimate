import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import DcaDepthTable from '../../../src/components/fq/DcaDepthTable.vue';
import FleetTable from '../../../src/components/fq/FleetTable.vue';
import PositionCard from '../../../src/components/fq/PositionCard.vue';
import { FIXTURE_NOW } from '../../../src/components/fq/fixtures';
import { makeClosedTrades } from '../../../src/components/fq/fixtures/charts';
import { lineFromPosition } from '../../../src/components/fq/lib/trades';
import { useFqConnectionStore } from '../../../src/datasource/stores/connection';
import i18n from '../../../src/locales';
import { mountFq, setFqLocale, setupWorld, teardownWorld, type FqWorld } from './helpers';

/**
 * Minor defects of the QA pass on 2.1.1 (B392 to B401): the jargon "P&L" out of the labels, the
 * phone card and the fleet table say what their figures are, the Renforts message follows the
 * source really in use.
 */
let world: FqWorld;
beforeEach(() => {
  world = setupWorld();
});
afterEach(teardownWorld);

/** Every string of a message tree with its path. */
function strings(node: unknown, path: string, out: Array<[string, string]> = []) {
  if (typeof node === 'string') out.push([path, node]);
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) strings(v, `${path}.${k}`, out);
  }
  return out;
}

describe('no "P&L" in a label (B392)', () => {
  for (const lang of ['fr', 'en'] as const) {
    it(`${lang}: the redesign labels say gain or result, the term stays in the tooltips`, () => {
      const fq = i18n.global.getLocaleMessage(lang).fq;
      // Tooltips (`fq.hint`) may name the technical term next to the plain word
      const hits = strings(fq, 'fq').filter(
        ([path, text]) => !path.startsWith('fq.hint.') && /P&L|PnL|P&amp;L/i.test(text),
      );
      expect(hits).toEqual([]);
    });
    it(`${lang}: a tooltip that names P&L puts the plain word first`, () => {
      const fq = i18n.global.getLocaleMessage(lang).fq;
      const tips = strings(fq.hint, 'fq.hint').filter(([, text]) => /P&L/.test(text));
      expect(tips.length).toBeGreaterThan(0);
      expect(tips.filter(([, text]) => text.startsWith('P&L'))).toEqual([]);
    });
  }
  it('the by-bot table of the Journal does not hard-code the word', () => {
    const src = readFileSync(resolve(__dirname, '../../../src/views/fq/JournalPage.vue'), 'utf8');
    expect(src).not.toMatch(/P&amp;L|>P&L</);
  });
  it('the Settings time zone row talks about the daily gain', () => {
    const tz = (lang: 'fr' | 'en') =>
      strings(i18n.global.getLocaleMessage(lang).fq.pg.settings, 'settings')
        .filter(([path]) => path.endsWith('.tz'))
        .map(([, text]) => text);
    expect(tz('fr')).toEqual(['Fuseau du gain quotidien']);
    expect(tz('en')).toEqual(['Time zone of the daily gain']);
  });
});

describe('PositionCard on a phone says what its figures are (B395)', () => {
  const mount = (open = true) => {
    const p = world.fixture.positions.find((x) => !x.orphan)!;
    const line = {
      ...lineFromPosition(
        p,
        world.fixture.bots.find((b) => b.bot_key === p.bot_key),
      ),
      open,
      exitPrice: open ? null : 101.5,
    };
    return mountFq(PositionCard, { props: { line, position: p }, attachTo: document.body });
  };

  it('the price under the average entry is labelled "Price"', () => {
    const w = mount();
    const m2 = w.get('.m2');
    expect(m2.get('.k').text()).toBe('Avg entry');
    expect(m2.get('.sub .sl').text()).toBe('Price');
    expect(m2.get('.sub').attributes('title')).toBe('Current price');
  });

  it('a closed trade labels its exit price, and its entry is the entry', () => {
    const w = mount(false);
    const m2 = w.get('.m2');
    expect(m2.get('.k').text()).toBe('Avg entry');
    expect(m2.get('.sub .sl').text()).toBe('Exit');
    expect(m2.get('.sub').attributes('title')).toBe('Exit price');
  });

  it('the filled/max figure has a label and a title in words', () => {
    const w = mount();
    const orders = w.get('[data-testid=card-orders]');
    expect(orders.get('.sl').text()).toBe('Orders');
    const pips = orders.get('.pips');
    expect(pips.attributes('title')).toMatch(/^\d+ of \d+ orders filled$/);
    expect(pips.attributes('aria-label')).toBe(pips.attributes('title'));
  });

  it('in French too', () => {
    setFqLocale('fr');
    const w = mount();
    expect(w.get('.m2 .sub .sl').text()).toBe('Prix');
    expect(w.get('[data-testid=card-orders] .sl').text()).toBe('Ordres');
    setFqLocale('en');
  });
});

describe('Journal > Renforts: the message follows the source in use (B398)', () => {
  const bare = () =>
    makeClosedTrades(world.fixture.bots).map((t) => ({ ...t, dca_entries: undefined }));
  const messageIn = (kind: 'direct' | 'gateway' | null) => {
    useFqConnectionStore().kind = kind;
    const w = mountFq(DcaDepthTable, { props: { trades: bare() } });
    return w.get('[data-testid=depth-missing]').text();
  };

  it('on the gateway it does not say "direct mode"', () => {
    const text = messageIn('gateway');
    expect(text).not.toMatch(/direct/i);
    expect(text).toMatch(/gateway/i);
  });
  it('in direct mode it says so', () => {
    expect(messageIn('direct')).toMatch(/direct mode/);
  });
  it('before the source is known it names neither', () => {
    const text = messageIn(null);
    expect(text).not.toMatch(/direct|gateway/i);
  });
});

describe('Fleet table: the Positions column has a legend (B400)', () => {
  it('shows "open/max" next to the bars, with the header and the cell titles in words', () => {
    const bot = world.fixture.bots.find(
      (b) => b.state.status === 'online' && (b.state.max_open_trades ?? 0) > 0,
    )!;
    const w = mountFq(FleetTable, {
      props: { rows: [bot], nowMs: FIXTURE_NOW, containerWidth: 1300 },
      attachTo: document.body,
    });
    const cell = w.get('[data-testid=slots]');
    expect(w.get('[data-testid=slots-of]').text()).toBe(
      `${bot.state.open_trades}/${bot.state.max_open_trades}`,
    );
    expect(cell.attributes('title')).toMatch(/of \d+ possible/);
    const header = w.findAll('th').find((th) => th.text() === 'Positions')!;
    expect(header.attributes('title')).toMatch(/maximum/);
    expect(header.attributes('title')).not.toMatch(/slot/i);
  });
});
