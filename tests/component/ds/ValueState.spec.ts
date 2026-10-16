import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import KpiTile from '../../../src/components/ds/KpiTile.vue';
import PnlValue from '../../../src/components/ds/PnlValue.vue';
import ValueState from '../../../src/components/ds/ValueState.vue';
import { PENDING_TIMEOUT_MS, resetPending } from '../../../src/components/ds/lib/pending';
import { mountDs, setLocale, stubReducedMotion } from './helpers';

const NOW = 1_700_000_000_000;

describe('ValueState', () => {
  beforeEach(() => resetPending());
  afterEach(() => {
    setLocale('en');
    stubReducedMotion(false);
  });

  it('ready: renders the figure and nothing else', () => {
    const w = mountDs(ValueState, { props: { state: 'ready' }, slots: { default: '42' } });
    expect(w.text()).toBe('42');
    expect(w.find('[data-state]').exists()).toBe(false);
  });

  it('pending: a spinning icon named "Loading", no text at all', () => {
    const w = mountDs(ValueState, {
      props: { state: 'pending', nowMs: NOW },
      slots: { default: '42' },
    });
    const el = w.get('[data-state="pending"]');
    expect(el.attributes('aria-label')).toBe('Loading');
    expect(el.attributes('role')).toBe('img');
    expect(el.text()).toBe('');
    expect(w.find('svg.vs-spin').exists()).toBe(true);
    expect(w.text()).not.toContain('42');
  });

  it('pending in French is named "Chargement"; a live region only when asked', () => {
    setLocale('fr');
    const quiet = mountDs(ValueState, { props: { state: 'pending', nowMs: NOW } });
    expect(quiet.get('[data-state]').attributes('aria-label')).toBe('Chargement');
    expect(quiet.get('[data-state]').attributes('role')).toBe('img');
    const live = mountDs(ValueState, { props: { state: 'pending', announce: true, nowMs: NOW } });
    expect(live.get('[data-state]').attributes('role')).toBe('status');
  });

  it('unavailable: a static icon, the reason is the accessible name and the tooltip', async () => {
    const w = mountDs(ValueState, {
      props: { state: 'unavailable', reason: 'Prices frozen by the 429 backoff (12 positions)' },
    });
    const el = w.get('[data-state="unavailable"]');
    expect(el.attributes('aria-label')).toBe('Prices frozen by the 429 backoff (12 positions)');
    // No animation on an unavailable value, and no word in the slot itself
    expect(el.find('.vs-spin').exists()).toBe(false);
    expect(el.find('svg').exists()).toBe(true);
    expect(w.text()).toBe('');
    // The tooltip shows on hover and on focus (a tap on a phone), and goes away
    expect(w.find('.vs-tip').exists()).toBe(false);
    await el.trigger('pointerenter');
    expect(w.get('.vs-tip').text()).toBe('Prices frozen by the 429 backoff (12 positions)');
    await el.trigger('pointerleave');
    expect(w.find('.vs-tip').exists()).toBe(false);
    await el.trigger('focus');
    expect(w.find('.vs-tip').exists()).toBe(true);
    await el.trigger('blur');
    expect(w.find('.vs-tip').exists()).toBe(false);
  });

  it('an unavailable value without a reason still says something', () => {
    const w = mountDs(ValueState, { props: { state: 'unavailable' } });
    expect(w.get('[data-state]').attributes('aria-label')).toBe('Value unavailable');
  });

  it('keeps the room of a short number (no layout shift when the figure arrives)', () => {
    const css = readFileSync('src/components/ds/ValueState.vue', 'utf8');
    expect(css).toMatch(/\.vs\s*\{[^}]*min-width:\s*2\.4ch/s);
  });

  it('a pending value becomes unavailable "no answer for N s" after 45 s, never spinning forever', async () => {
    expect(PENDING_TIMEOUT_MS).toBe(45_000);
    const w = mountDs(ValueState, { props: { state: 'pending', pendingKey: 'k/a', nowMs: NOW } });
    expect(w.find('[data-state="pending"]').exists()).toBe(true);
    await w.setProps({ nowMs: NOW + 44_000 });
    expect(w.find('[data-state="pending"]').exists()).toBe(true);
    await w.setProps({ nowMs: NOW + 45_000 });
    const el = w.get('[data-state="unavailable"]');
    expect(el.attributes('aria-label')).toBe('No answer for 45 s');
    expect(el.attributes('data-timeout')).toBeDefined();
    await w.setProps({ nowMs: NOW + 130_000 });
    expect(w.get('[data-state="unavailable"]').attributes('aria-label')).toBe(
      'No answer for 2 min',
    );
  });

  it('the timeout is worded in French too', async () => {
    setLocale('fr');
    const w = mountDs(ValueState, { props: { state: 'pending', nowMs: NOW, timeoutMs: 1000 } });
    await w.setProps({ nowMs: NOW + 1500 });
    expect(w.get('[data-state="unavailable"]').attributes('aria-label')).toBe(
      'Pas de réponse depuis 1 s',
    );
  });

  it('the wait survives a remount of the same slot (a scrolled row does not restart its 45 s)', async () => {
    const a = mountDs(ValueState, {
      props: { state: 'pending', pendingKey: 'bot/latent', nowMs: NOW },
    });
    await a.setProps({ nowMs: NOW + 40_000 });
    a.unmount();
    const b = mountDs(ValueState, {
      props: { state: 'pending', pendingKey: 'bot/latent', nowMs: NOW + 46_000 },
    });
    await nextTick();
    expect(b.find('[data-state="unavailable"]').exists()).toBe(true);
  });

  it('a slot that is back after a long absence waits again from zero', () => {
    const a = mountDs(ValueState, { props: { state: 'pending', pendingKey: 'bot/x', nowMs: NOW } });
    a.unmount();
    const b = mountDs(ValueState, {
      props: { state: 'pending', pendingKey: 'bot/x', nowMs: NOW + 120_000 },
    });
    expect(b.find('[data-state="pending"]').exists()).toBe(true);
  });

  it('a resolved value (ready) after a pending one shows the figure and drops the wait', async () => {
    const w = mountDs(ValueState, {
      props: { state: 'pending', nowMs: NOW },
      slots: { default: '7' },
    });
    await w.setProps({ state: 'ready' });
    expect(w.text()).toBe('7');
  });
});

describe('ValueState and reduced motion', () => {
  afterEach(() => stubReducedMotion(false));

  it('still renders the spinner under reduced motion: the stylesheet turns the rotation into a slow pulse', () => {
    stubReducedMotion(true);
    const w = mountDs(ValueState, { props: { state: 'pending', nowMs: NOW } });
    expect(w.find('svg.vs-spin').exists()).toBe(true);
    const css = readFileSync('src/styles/motion.css', 'utf8');
    // System preference and the Settings override both switch rotation for an opacity pulse
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.vs-spin\s*\{\s*animation:\s*fq-pulse[^}]*!important/s,
    );
    expect(css).toMatch(
      /:root\[data-motion='reduce'\] \.vs-spin\s*\{\s*animation:\s*fq-pulse[^}]*!important/s,
    );
    // The component itself rotates by default
    const vue = readFileSync('src/components/ds/ValueState.vue', 'utf8');
    expect(vue).toMatch(/\.vs-spin\s*\{\s*animation:\s*fq-spin/);
  });
});

describe('PnlValue and KpiTile go through the same primitive', () => {
  it('PnlValue: pending and unavailable draw the icons, ready draws the figure', () => {
    const pending = mountDs(PnlValue, { props: { value: null, state: 'pending' } });
    expect(pending.find('[data-state="pending"]').exists()).toBe(true);
    expect(pending.text()).toBe('');
    const na = mountDs(PnlValue, {
      props: { value: null, state: 'unavailable', reason: 'Prices unavailable' },
    });
    expect(na.get('[data-state="unavailable"]').attributes('aria-label')).toBe(
      'Prices unavailable',
    );
    expect(mountDs(PnlValue, { props: { value: 3, state: 'ready' } }).text()).toBe('+3.00');
  });

  it('PnlValue never prints a word for a value that is not a number', () => {
    for (const props of [
      { value: null },
      { value: undefined },
      { value: NaN },
      { value: 3, unknown: true },
    ]) {
      const w = mountDs(PnlValue, { props });
      expect(w.text()).toBe('');
      expect(w.find('[data-state="unavailable"]').exists()).toBe(true);
    }
  });

  it('KpiTile: the value slot is replaced by the spinner (announced once) or by the icon', () => {
    const pending = mountDs(KpiTile, { props: { label: 'Open P&L', state: 'pending' } });
    expect(pending.get('.v [data-state="pending"]').attributes('role')).toBe('status');
    expect(pending.get('.v').text()).toBe('');
    const na = mountDs(KpiTile, {
      props: {
        label: 'Open P&L',
        state: 'unavailable',
        reason: 'Prices unavailable (43 positions)',
      },
      slots: { value: '0.00' },
    });
    expect(na.get('.v').text()).toBe('');
    expect(na.get('.v [data-state="unavailable"]').attributes('aria-label')).toBe(
      'Prices unavailable (43 positions)',
    );
    const ready = mountDs(KpiTile, { props: { label: 'Open P&L' }, slots: { value: '12.00' } });
    expect(ready.get('.v').text()).toBe('12.00');
  });
});
