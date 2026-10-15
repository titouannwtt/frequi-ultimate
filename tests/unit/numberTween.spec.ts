import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { useNumberTween } from '../../src/composables/useNumberTween';

describe('useNumberTween', () => {
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
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(opts: Parameters<typeof useNumberTween>[1] = {}, start = 10) {
    const source = ref(start);
    const scope = effectScope();
    const tween = scope.run(() => useNumberTween(source, { reducedMotion: false, ...opts }))!;
    return { source, tween, scope };
  }

  it('starts on the initial value without flashing', () => {
    const { tween, scope } = setup();
    expect(tween.displayed.value).toBe(10);
    expect(tween.flashClass.value).toBe('');
    scope.stop();
  });

  it('eases to the new value and flashes up then clears', async () => {
    const { source, tween, scope } = setup({ format: (v) => v.toFixed(1) });
    source.value = 20;
    await nextTick();
    await nextTick();
    expect(tween.flash.value).toBe('up');
    expect(tween.flashClass.value).toBe('fl-up');

    await vi.advanceTimersByTimeAsync(200);
    expect(tween.displayed.value).toBeGreaterThan(10);
    expect(tween.displayed.value).toBeLessThan(20);

    await vi.advanceTimersByTimeAsync(300);
    expect(tween.displayed.value).toBe(20);
    expect(tween.text.value).toBe('20.0');
    expect(tween.flash.value).toBe('up');

    await vi.advanceTimersByTimeAsync(500);
    expect(tween.flash.value).toBeNull();
    scope.stop();
  });

  it('flashes down when the value decreases', async () => {
    const { source, tween, scope } = setup();
    source.value = 5;
    await nextTick();
    await nextTick();
    expect(tween.flashClass.value).toBe('fl-dn');
    scope.stop();
  });

  it('snaps with no flash under reduced motion', async () => {
    const { source, tween, scope } = setup({ reducedMotion: true });
    source.value = 99;
    await nextTick();
    expect(tween.displayed.value).toBe(99);
    expect(tween.flash.value).toBeNull();
    scope.stop();
  });

  it('snaps with no flash when the cell is not visible', async () => {
    const active = ref(false);
    const { source, tween, scope } = setup({ active });
    source.value = 42;
    await nextTick();
    expect(tween.displayed.value).toBe(42);
    expect(tween.flash.value).toBeNull();
    scope.stop();
  });

  it('can disable the flash only', async () => {
    const { source, tween, scope } = setup({ flash: false });
    source.value = 30;
    await nextTick();
    await vi.advanceTimersByTimeAsync(500);
    expect(tween.flash.value).toBeNull();
    expect(tween.displayed.value).toBe(30);
    scope.stop();
  });

  it('retargets from the displayed value when the source changes mid-tween', async () => {
    const { source, tween, scope } = setup();
    source.value = 20;
    await nextTick();
    await nextTick();
    await vi.advanceTimersByTimeAsync(150);
    source.value = 0;
    await nextTick();
    await nextTick();
    expect(tween.flash.value).toBe('dn');
    await vi.advanceTimersByTimeAsync(600);
    expect(tween.displayed.value).toBe(0);
    scope.stop();
  });

  it('ignores non-finite values by snapping', async () => {
    const { source, tween, scope } = setup();
    source.value = Number.NaN;
    await nextTick();
    expect(Number.isNaN(tween.displayed.value)).toBe(true);
    expect(tween.flash.value).toBeNull();
    scope.stop();
  });
});
