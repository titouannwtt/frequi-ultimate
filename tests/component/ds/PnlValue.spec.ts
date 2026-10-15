import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import PnlValue from '../../../src/components/ds/PnlValue.vue';
import { mountDs, setLocale, stubReducedMotion } from './helpers';

const MINUS = '−';

describe('PnlValue', () => {
  afterEach(() => {
    setLocale('en');
    stubReducedMotion(false);
  });

  it('always writes the sign, with the true minus U+2212', () => {
    expect(mountDs(PnlValue, { props: { value: 42.5 } }).text()).toBe('+42.50');
    expect(mountDs(PnlValue, { props: { value: -18.074 } }).text()).toBe(`${MINUS}18.07`);
  });

  it('shows no sign for a value that rounds to zero', () => {
    const wrapper = mountDs(PnlValue, { props: { value: -0.004 } });
    expect(wrapper.text()).toBe('0.00');
    expect(wrapper.classes()).toContain('flat');
    expect(mountDs(PnlValue, { props: { value: 0 } }).text()).toBe('0.00');
  });

  it('uses the thin no-break space and decimal comma in French', () => {
    setLocale('fr');
    const wrapper = mountDs(PnlValue, { props: { value: 1234.567 } });
    expect(wrapper.text()).toBe('+1\u202f234,57');
    expect(mountDs(PnlValue, { props: { value: -1234.5, decimals: 1 } }).text()).toBe(
      `${MINUS}1\u202f234,5`,
    );
  });

  it('groups thousands with commas in English', () => {
    expect(mountDs(PnlValue, { props: { value: 1234.567 } }).text()).toBe('+1,234.57');
  });

  it('colours by sign and mutes a stale value while keeping the sign', () => {
    expect(mountDs(PnlValue, { props: { value: 5 } }).classes()).toContain('up');
    expect(mountDs(PnlValue, { props: { value: -5 } }).classes()).toContain('down');
    const stale = mountDs(PnlValue, { props: { value: -5, muted: true } });
    expect(stale.classes()).toContain('muted');
    expect(stale.classes()).not.toContain('down');
    expect(stale.text()).toBe(`${MINUS}5.00`);
  });

  it('renders the unit and never invents a number for unknown or missing values', () => {
    expect(mountDs(PnlValue, { props: { value: 3, unit: 'USDC' } }).text()).toBe('+3.00USDC');
    const unknown = mountDs(PnlValue, { props: { value: 3, unknown: true } });
    expect(unknown.text()).toBe('unknown');
    expect(mountDs(PnlValue, { props: { value: null } }).text()).toBe('n/a');
    setLocale('fr');
    expect(mountDs(PnlValue, { props: { value: null, unknown: true } }).text()).toBe('inconnu');
  });

  describe('flash and tween', () => {
    beforeEach(() => {
      vi.useFakeTimers({
        toFake: [
          'setTimeout',
          'clearTimeout',
          'requestAnimationFrame',
          'cancelAnimationFrame',
          'performance',
        ],
      });
    });
    afterEach(() => vi.useRealTimers());

    it('flashes up then clears, and ends exactly on the new value', async () => {
      const wrapper = mountDs(PnlValue, { props: { value: 10, tween: true, flash: true } });
      await wrapper.setProps({ value: 20 });
      await nextTick();
      await nextTick();
      expect(wrapper.classes()).toContain('fl-up');
      vi.advanceTimersByTime(1000);
      await nextTick();
      expect(wrapper.classes()).not.toContain('fl-up');
      expect(wrapper.text()).toBe('+20.00');
    });

    it('flashes down on a decrease', async () => {
      const wrapper = mountDs(PnlValue, { props: { value: 10, tween: true, flash: true } });
      await wrapper.setProps({ value: 4 });
      await nextTick();
      await nextTick();
      expect(wrapper.classes()).toContain('fl-dn');
    });

    it('does not tween or flash under reduced motion', async () => {
      stubReducedMotion(true);
      const wrapper = mountDs(PnlValue, { props: { value: 10, tween: true, flash: true } });
      await wrapper.setProps({ value: 20 });
      await nextTick();
      expect(wrapper.text()).toBe('+20.00');
      expect(wrapper.classes()).not.toContain('fl-up');
    });

    it('snaps without animation when neither tween nor flash is requested', async () => {
      const wrapper = mountDs(PnlValue, { props: { value: 10 } });
      await wrapper.setProps({ value: 20 });
      await nextTick();
      expect(wrapper.text()).toBe('+20.00');
      expect(wrapper.classes().some((c) => c.startsWith('fl-'))).toBe(false);
    });
  });
});
