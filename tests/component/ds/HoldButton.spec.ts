import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import HoldButton from '../../../src/components/ds/HoldButton.vue';
import { useInflightLock } from '../../../src/composables/useInflightLock';
import { HOLD_MS } from '../../../src/utils/motion';
import { mountDs, stubReducedMotion } from './helpers';

describe('HoldButton', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    useInflightLock().releaseAll();
  });
  afterEach(() => {
    vi.useRealTimers();
    stubReducedMotion(false);
  });

  const label = 'Hold to exit with real money';

  it('has one fixed 1000 ms delay and no duration prop', () => {
    expect(HOLD_MS).toBe(1000);
    expect(Object.keys(HoldButton.props ?? {})).not.toContain('durationMs');
  });

  it('completes only after 1000 ms of pointer hold', async () => {
    const wrapper = mountDs(HoldButton, { props: { label } });
    const btn = wrapper.get('button');
    await btn.trigger('pointerdown', { button: 0 });
    expect(btn.classes()).toContain('holding');
    vi.advanceTimersByTime(999);
    expect(wrapper.emitted('complete')).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(wrapper.emitted('complete')).toHaveLength(1);
    expect(wrapper.emitted('tooShort')).toBeUndefined();
  });

  it('emits tooShort with the held time and shows the help when released early', async () => {
    const wrapper = mountDs(HoldButton, { props: { label } });
    const btn = wrapper.get('button');
    await btn.trigger('pointerdown', { button: 0 });
    vi.advanceTimersByTime(300);
    await btn.trigger('pointerup');
    vi.advanceTimersByTime(2000);
    expect(wrapper.emitted('complete')).toBeUndefined();
    const too = wrapper.emitted('tooShort');
    expect(too).toHaveLength(1);
    expect(too![0][0]).toBeGreaterThanOrEqual(300);
    expect(too![0][0]).toBeLessThan(1000);
    expect(wrapper.get('.hold-hint').text()).toContain('1 second');
  });

  it('works with Enter held and ignores key repeat', async () => {
    const wrapper = mountDs(HoldButton, { props: { label } });
    const btn = wrapper.get('button');
    await btn.trigger('keydown', { key: 'Enter' });
    vi.advanceTimersByTime(500);
    await btn.trigger('keydown', { key: 'Enter', repeat: true });
    vi.advanceTimersByTime(499);
    expect(wrapper.emitted('complete')).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(wrapper.emitted('complete')).toHaveLength(1);
  });

  it('releases an early Enter as tooShort', async () => {
    const wrapper = mountDs(HoldButton, { props: { label } });
    const btn = wrapper.get('button');
    await btn.trigger('keydown', { key: ' ' });
    vi.advanceTimersByTime(200);
    await btn.trigger('keyup', { key: ' ' });
    expect(wrapper.emitted('tooShort')).toHaveLength(1);
    expect(wrapper.emitted('complete')).toBeUndefined();
  });

  it('keeps the 1000 ms hold under reduced motion', async () => {
    stubReducedMotion(true);
    const wrapper = mountDs(HoldButton, { props: { label } });
    const btn = wrapper.get('button');
    await btn.trigger('pointerdown', { button: 0 });
    vi.advanceTimersByTime(600);
    expect(wrapper.emitted('complete')).toBeUndefined();
    vi.advanceTimersByTime(400);
    expect(wrapper.emitted('complete')).toHaveLength(1);
  });

  it('does nothing when disabled', async () => {
    const wrapper = mountDs(HoldButton, { props: { label, disabled: true } });
    await wrapper.get('button').trigger('pointerdown', { button: 0 });
    vi.advanceTimersByTime(1500);
    expect(wrapper.emitted('complete')).toBeUndefined();
    expect(wrapper.get('button').attributes('aria-disabled')).toBe('true');
  });

  it('cancels when the pointer leaves the button', async () => {
    const wrapper = mountDs(HoldButton, { props: { label } });
    const btn = wrapper.get('button');
    await btn.trigger('pointerdown', { button: 0 });
    vi.advanceTimersByTime(400);
    await btn.trigger('pointerleave');
    vi.advanceTimersByTime(2000);
    expect(wrapper.emitted('complete')).toBeUndefined();
    expect(wrapper.emitted('tooShort')).toHaveLength(1);
  });

  it('lockKey prevents a double submit until the lock is released', async () => {
    const lock = useInflightLock();
    const wrapper = mountDs(HoldButton, { props: { label, lockKey: 'bot1:forceexit:1180' } });
    const btn = wrapper.get('button');

    await btn.trigger('pointerdown', { button: 0 });
    vi.advanceTimersByTime(1000);
    expect(wrapper.emitted('complete')).toHaveLength(1);
    expect(lock.isLocked('bot1:forceexit:1180')).toBe(true);
    await nextTick();
    expect(btn.attributes('aria-busy')).toBe('true');

    // A second hold on the same key (another surface) can not start while the lock is held
    vi.advanceTimersByTime(700);
    await btn.trigger('pointerdown', { button: 0 });
    vi.advanceTimersByTime(1500);
    expect(wrapper.emitted('complete')).toHaveLength(1);

    lock.release('bot1:forceexit:1180');
    await nextTick();
    await btn.trigger('pointerdown', { button: 0 });
    vi.advanceTimersByTime(1000);
    expect(wrapper.emitted('complete')).toHaveLength(2);
  });

  it('reports blocked when the key was taken by another surface during the hold', async () => {
    const lock = useInflightLock();
    const wrapper = mountDs(HoldButton, { props: { label, lockKey: 'k' } });
    await wrapper.get('button').trigger('pointerdown', { button: 0 });
    vi.advanceTimersByTime(500);
    lock.acquire('k');
    vi.advanceTimersByTime(500);
    expect(wrapper.emitted('complete')).toBeUndefined();
    expect(wrapper.emitted('blocked')).toEqual([['k']]);
  });

  it('cancels silently when disabled during the hold (connection lost)', async () => {
    const wrapper = mountDs(HoldButton, { props: { label, lockKey: 'k2' } });
    const btn = wrapper.get('button');
    await btn.trigger('pointerdown', { button: 0 });
    vi.advanceTimersByTime(400);
    await wrapper.setProps({ disabled: true });
    expect(btn.classes()).not.toContain('holding');
    vi.advanceTimersByTime(2000);
    expect(wrapper.emitted('complete')).toBeUndefined();
    expect(wrapper.emitted('tooShort')).toBeUndefined();
    expect(wrapper.emitted('blocked')).toBeUndefined();
    expect(useInflightLock().isLocked('k2')).toBe(false);
    // Re-enabled: a fresh full hold works again
    await wrapper.setProps({ disabled: false });
    await btn.trigger('pointerdown', { button: 0 });
    vi.advanceTimersByTime(1000);
    expect(wrapper.emitted('complete')).toHaveLength(1);
  });

  it('never completes when disabled right before the end of the hold', async () => {
    const wrapper = mountDs(HoldButton, { props: { label } });
    await wrapper.get('button').trigger('pointerdown', { button: 0 });
    vi.advanceTimersByTime(999);
    // Props changed without a flush yet: finish() must still re-check it
    wrapper.vm.$.props.disabled = true;
    vi.advanceTimersByTime(1);
    expect(wrapper.emitted('complete')).toBeUndefined();
  });

  it('without a lockKey it latches after complete until reset()', async () => {
    const wrapper = mountDs(HoldButton, { props: { label } });
    const btn = wrapper.get('button');
    await btn.trigger('pointerdown', { button: 0 });
    vi.advanceTimersByTime(1000);
    expect(wrapper.emitted('complete')).toHaveLength(1);
    vi.advanceTimersByTime(700);
    await nextTick();
    expect(btn.attributes('aria-busy')).toBe('true');
    await btn.trigger('pointerdown', { button: 0 });
    vi.advanceTimersByTime(1500);
    expect(wrapper.emitted('complete')).toHaveLength(1);

    (wrapper.vm as unknown as { reset: () => void }).reset();
    await nextTick();
    expect(btn.attributes('aria-busy')).toBeUndefined();
    await btn.trigger('pointerdown', { button: 0 });
    vi.advanceTimersByTime(1000);
    expect(wrapper.emitted('complete')).toHaveLength(2);
  });
});
