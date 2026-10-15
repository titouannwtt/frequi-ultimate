import { describe, expect, it, vi } from 'vitest';
import {
  COUNTER_MS,
  DURATIONS,
  HOLD_MS,
  easeOutCubic,
  motionDuration,
  runTween,
} from '../../src/utils/motion';

/** Manual frame clock: each tick() advances time and runs the queued callback. */
function clock() {
  let time = 0;
  let next = 1;
  const queue = new Map<number, () => void>();
  return {
    now: () => time,
    raf: (cb: (t: number) => void) => {
      const id = next++;
      queue.set(id, () => cb(time));
      return id;
    },
    cancelRaf: (id: number) => {
      queue.delete(id);
    },
    tick(ms: number) {
      time += ms;
      const pending = [...queue.entries()];
      queue.clear();
      pending.forEach(([, fn]) => fn());
    },
    pending: () => queue.size,
  };
}

describe('motion constants', () => {
  it('follows the spec', () => {
    expect(DURATIONS).toEqual({ instant: 80, fast: 140, base: 200, slow: 320, flash: 900 });
    expect(COUNTER_MS).toBe(420);
    expect(HOLD_MS).toBe(1000);
  });

  it('collapses UI durations under reduced motion', () => {
    expect(motionDuration(320, true)).toBe(1);
    expect(motionDuration(320, false)).toBe(320);
  });
});

describe('runTween', () => {
  it('eases to the target and ends exactly on it', () => {
    const c = clock();
    const frames: number[] = [];
    runTween({ from: 0, to: 100, duration: 400, onFrame: (v) => frames.push(v), ...c });
    c.tick(0);
    c.tick(100);
    c.tick(300);
    expect(frames[0]).toBe(0);
    expect(frames[1]).toBeCloseTo(100 * easeOutCubic(0.25));
    expect(frames[1]).toBeGreaterThan(25);
    expect(frames.at(-1)).toBe(100);
    expect(c.pending()).toBe(0);
  });

  it('supports a decreasing value', () => {
    const c = clock();
    const frames: number[] = [];
    runTween({ from: 10, to: -5, duration: 100, onFrame: (v) => frames.push(v), ...c });
    c.tick(50);
    c.tick(50);
    expect(frames.at(-1)).toBe(-5);
    expect(Math.min(...frames)).toBeGreaterThanOrEqual(-5);
  });

  it('stops emitting frames once cancelled', () => {
    const c = clock();
    const onFrame = vi.fn();
    const cancel = runTween({ from: 0, to: 1, duration: 400, onFrame, ...c });
    c.tick(100);
    cancel();
    onFrame.mockClear();
    c.tick(100);
    expect(onFrame).not.toHaveBeenCalled();
  });
});
