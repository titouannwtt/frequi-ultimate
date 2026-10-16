import { describe, expect, it } from 'vitest';

import { subplotLabel, indicatorLabel } from '@/utils/indicatorLabel';

describe('indicatorLabel', () => {
  it('names the usual indicators in plain French', () => {
    expect(indicatorLabel('rsi_14').label).toBe('RSI 14, élan du prix');
    expect(indicatorLabel('rsi_84').short).toBe('RSI 84');
    expect(indicatorLabel('rsi').label).toBe('RSI, élan du prix');
    expect(indicatorLabel('ema_200').label).toBe('Moyenne 200');
    expect(indicatorLabel('sma_50').label).toBe('Moyenne simple 50');
    expect(indicatorLabel('vwap').label).toBe('VWAP');
    expect(indicatorLabel('bb_lowerband').label).toBe('Bollinger bas');
    expect(indicatorLabel('macdsignal').label).toBe('MACD, signal');
    expect(indicatorLabel('adx_14').label).toBe('ADX 14, force de la tendance');
  });

  it('understands the prefixes of the strategies of the fleet', () => {
    expect(indicatorLabel('I-vwap_low').label).toBe('VWAP bas');
    expect(indicatorLabel('I-vwap').label).toBe('VWAP');
    expect(indicatorLabel('C-rsi').label).toBe('RSI, repère de signal');
  });

  it('keeps the raw name and a reading hint for what it recognises', () => {
    const l = indicatorLabel('rsi_14');
    expect(l.raw).toBe('rsi_14');
    expect(l.known).toBe(true);
    expect(l.explain).toContain('70');
  });

  it('keeps an unknown name as it is, never guesses', () => {
    for (const name of ['my_secret_signal', 'rsi_fast', 'ema_', 'vwap_foo', 'zscore_20', '']) {
      const l = indicatorLabel(name);
      expect(l).toEqual({ raw: name, label: name, short: name, explain: null, known: false });
    }
  });

  it('speaks English on request', () => {
    expect(indicatorLabel('rsi_14', 'en').label).toBe('RSI 14, price momentum');
    expect(indicatorLabel('ema_200', 'en').label).toBe('Average 200');
    expect(indicatorLabel('I-vwap_low', 'en').label).toBe('VWAP low');
  });

  it('titles a group of series by its only series, else by its own name', () => {
    expect(subplotLabel('RSI', ['rsi_14']).label).toBe('RSI 14, élan du prix');
    expect(subplotLabel('MACD', ['macd', 'macdsignal', 'macdhist']).short).toBe('MACD');
    expect(subplotLabel('Mon groupe', ['a', 'b']).label).toBe('Mon groupe');
  });
});
