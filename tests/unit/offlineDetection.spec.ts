import { describe, expect, it } from 'vitest';

import {
  OFFLINE_AFTER_CONSECUTIVE_FAILURES,
  createOfflineDetector,
  isTransportFailure,
} from '@/composables/api';

describe('isTransportFailure', () => {
  it('counts a 500 — the bot broke while answering', () => {
    expect(isTransportFailure({ response: { status: 500 } })).toBe(true);
  });

  it('counts a dead network', () => {
    expect(isTransportFailure({ message: 'Network Error' })).toBe(true);
  });

  it('counts a timeout, which axios reports as ECONNABORTED and never as Network Error', () => {
    // Regression: timeouts were invisible, so a bot too slow to be usable read as healthy.
    expect(isTransportFailure({ code: 'ECONNABORTED' })).toBe(true);
    expect(isTransportFailure({ message: 'timeout of 20000ms exceeded' })).toBe(true);
  });

  it('ignores a 4xx — the bot is alive and said no', () => {
    expect(isTransportFailure({ response: { status: 404 } })).toBe(false);
    expect(isTransportFailure({ response: { status: 401 } })).toBe(false);
    expect(isTransportFailure({ response: { status: 422 } })).toBe(false);
  });

  it('ignores an error carrying nothing conclusive', () => {
    expect(isTransportFailure({})).toBe(false);
  });
});

describe('createOfflineDetector', () => {
  it('tolerates failures below the threshold', () => {
    // The bug this fixes: ONE failed request used to hide a healthy bot from the comparator.
    const d = createOfflineDetector(3);
    expect(d.onFailure()).toBe(false);
    expect(d.onFailure()).toBe(false);
  });

  it('declares offline once the streak reaches the threshold', () => {
    const d = createOfflineDetector(3);
    d.onFailure();
    d.onFailure();
    expect(d.onFailure()).toBe(true);
  });

  it('resets on any success, so isolated hiccups never accumulate', () => {
    const d = createOfflineDetector(3);
    d.onFailure();
    d.onFailure();
    d.onSuccess();
    expect(d.failures).toBe(0);
    expect(d.onFailure()).toBe(false);
  });

  it('keeps reporting offline while a genuinely dead bot keeps failing', () => {
    const d = createOfflineDetector(3);
    for (let i = 0; i < 3; i++) d.onFailure();
    expect(d.onFailure()).toBe(true);
    expect(d.onFailure()).toBe(true);
  });

  it('defaults to the shared threshold', () => {
    const d = createOfflineDetector();
    for (let i = 1; i < OFFLINE_AFTER_CONSECUTIVE_FAILURES; i++) {
      expect(d.onFailure()).toBe(false);
    }
    expect(d.onFailure()).toBe(true);
  });
});
