import { describe, expect, it } from 'vitest';
import AgeBadge from '../../../src/components/ds/AgeBadge.vue';
import { mountDs, setLocale } from './helpers';

const NOW = 1_800_000_000_000;
const props = (extra: Record<string, unknown>) => ({
  asOfMs: NOW - 12_000,
  staleAfterMs: 360_000,
  nowMs: NOW,
  ...extra,
});

describe('AgeBadge', () => {
  it('shows a fresh value in the neutral style', () => {
    const wrapper = mountDs(AgeBadge, { props: props({}) });
    expect(wrapper.text()).toBe('12 s');
    expect(wrapper.classes()).not.toContain('stale');
    expect(wrapper.emitted('stale')![0]).toEqual([false]);
  });

  it('turns stale past the threshold: amber class, hatch, readable text and event', () => {
    const wrapper = mountDs(AgeBadge, { props: props({ asOfMs: NOW - 25 * 60_000 }) });
    expect(wrapper.classes()).toContain('stale');
    expect(wrapper.text()).toContain('25 min');
    expect(wrapper.get('.sr').text()).toBe('Stale');
    expect(wrapper.emitted('stale')![0]).toEqual([true]);
  });

  it('is stale only strictly after the threshold', () => {
    expect(mountDs(AgeBadge, { props: props({ asOfMs: NOW - 360_000 }) }).classes()).not.toContain(
      'stale',
    );
    expect(mountDs(AgeBadge, { props: props({ asOfMs: NOW - 360_001 }) }).classes()).toContain(
      'stale',
    );
  });

  it('corrects the age with the server clock offset', () => {
    // Browser clock 80 s ahead of the server: the real age is 90 s - 80 s... skew is server - client
    const skewed = mountDs(AgeBadge, {
      props: props({ asOfMs: NOW - 400_000, clockSkewMs: -80_000 }),
    });
    expect(skewed.classes()).not.toContain('stale');
    expect(skewed.text()).toBe('5 min');
    const plain = mountDs(AgeBadge, { props: props({ asOfMs: NOW - 400_000 }) });
    expect(plain.classes()).toContain('stale');
  });

  it('never shows a negative age', () => {
    const wrapper = mountDs(AgeBadge, { props: props({ asOfMs: NOW + 5000 }) });
    expect(wrapper.text()).toBe('0 s');
  });

  it('writes days with the language unit and translates the stale text', () => {
    setLocale('fr');
    const wrapper = mountDs(AgeBadge, { props: props({ asOfMs: NOW - 3 * 86_400_000 }) });
    setLocale('fr');
    expect(wrapper.text()).toContain('3 j');
    setLocale('en');
  });
});
