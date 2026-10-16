import { vi } from 'vitest';

/**
 * happy-dom has no canvas: a real ECharts instance throws when it paints. The specs replace
 * `echarts/core` `init` with this recorder, which keeps the options and the dispose calls, so the
 * tests check what the components hand to the chart and that every instance is released.
 */
export interface FakeChart {
  el: HTMLElement;
  theme: string;
  options: Array<Record<string, unknown>>;
  disposed: boolean;
  handlers: Map<string, (ev: unknown) => void>;
  setOption: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  dispatchAction: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  isDisposed: () => boolean;
  /** Latest option handed to `setOption`. */
  last: () => Record<string, unknown>;
}

export const charts: FakeChart[] = [];

export function fakeInit(el: HTMLElement, theme: string): FakeChart {
  const c: FakeChart = {
    el,
    theme,
    options: [],
    disposed: false,
    handlers: new Map(),
    setOption: vi.fn((o: Record<string, unknown>) => {
      c.options.push(o);
    }),
    dispose: vi.fn(() => {
      c.disposed = true;
    }),
    resize: vi.fn(),
    dispatchAction: vi.fn(),
    on: vi.fn((name: string, fn: (ev: unknown) => void) => {
      c.handlers.set(name, fn);
    }),
    off: vi.fn((name: string) => {
      c.handlers.delete(name);
    }),
    isDisposed: () => c.disposed,
    last: () => c.options[c.options.length - 1] ?? {},
  };
  charts.push(c);
  return c;
}

export const liveCharts = (): FakeChart[] => charts.filter((c) => !c.disposed);
export const resetCharts = (): void => {
  charts.length = 0;
};
