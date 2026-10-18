import { describe, expect, it } from 'vitest';

import {
  closeOf,
  FOCUS_MARGIN_CANDLES,
  focusWindow,
  FRAME_MAX_CANDLES,
} from '@/components/fq/lib/chartTrades';

const TF = 3_600_000;
const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const at = (hoursAgo: number) => NOW - hoursAgo * TF;

describe('focusWindow: the window that frames a trade after older candles came in', () => {
  it('an open position: from its open less the margin to the last candle', () => {
    const w = focusWindow({
      openTs: at(48),
      firstTs: at(1000),
      lastTs: NOW,
      timeframeMs: TF,
    });
    expect(w).toEqual({ startTs: at(48 + FOCUS_MARGIN_CANDLES), endTs: NOW });
  });

  it('a closed trade of two candles: the margin on both sides, not the whole history', () => {
    const open = at(56);
    const close = open + 2 * TF;
    const w = focusWindow({
      openTs: open,
      closeTs: close,
      firstTs: at(1000),
      lastTs: NOW,
      timeframeMs: TF,
    });
    expect(w).not.toBeNull();
    const candles = (w!.endTs - w!.startTs) / TF;
    // 30 before, 2 of trade, a few after: a window of a few dozen candles out of a thousand
    expect(candles).toBeGreaterThan(30);
    expect(candles).toBeLessThan(60);
    expect(w!.startTs).toBe(open - FOCUS_MARGIN_CANDLES * TF);
    expect(w!.endTs).toBeGreaterThan(close);
  });

  it('is clamped to the loaded candles', () => {
    const w = focusWindow({
      openTs: at(10),
      closeTs: at(1),
      firstTs: at(20),
      lastTs: at(0),
      timeframeMs: TF,
    });
    expect(w!.startTs).toBe(at(20));
    expect(w!.endTs).toBe(at(0));
  });

  it('is given in moments: prefixing candles does not move it', () => {
    const base = { openTs: at(48), lastTs: NOW, timeframeMs: TF };
    const few = focusWindow({ ...base, firstTs: at(100) });
    const many = focusWindow({ ...base, firstTs: at(2000) });
    expect(many).toEqual(few);
  });

  it('gives nothing for an unknown trade, an unknown candle size or a window that is too wide', () => {
    const ok = { openTs: at(48), firstTs: at(1000), lastTs: NOW, timeframeMs: TF };
    expect(focusWindow({ ...ok, openTs: null })).toBeNull();
    expect(focusWindow({ ...ok, firstTs: null })).toBeNull();
    expect(focusWindow({ ...ok, timeframeMs: 0 })).toBeNull();
    expect(focusWindow({ ...ok, openTs: at(FRAME_MAX_CANDLES + 100) })).toBeNull();
    // The caller can allow more (a closed trade is framed up to 3000 candles)
    expect(focusWindow({ ...ok, openTs: at(FRAME_MAX_CANDLES + 100), max: 3000 })).not.toBeNull();
  });

  it('a trade that opened in the last candle still gets a window', () => {
    const w = focusWindow({ openTs: NOW, firstTs: at(500), lastTs: NOW, timeframeMs: TF });
    expect(w).toEqual({ startTs: NOW - FOCUS_MARGIN_CANDLES * TF, endTs: NOW });
  });
});

describe('closeOf', () => {
  const closed = [
    { openTs: 100, closeTs: 200 },
    { openTs: 300, closeTs: 400 },
  ];
  it('finds the close of the trade that opened at that moment', () => {
    expect(closeOf(closed, 300)).toBe(400);
  });
  it('is null for an open position, an unknown open or no closed mark', () => {
    expect(closeOf(closed, 250)).toBeNull();
    expect(closeOf(closed, null)).toBeNull();
    expect(closeOf(undefined, 100)).toBeNull();
  });
});
