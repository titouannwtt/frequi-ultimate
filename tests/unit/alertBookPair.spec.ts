import { describe, expect, it } from 'vitest';

import { AlertBook } from '@/datasource/calc';
import type { Evaluation } from '@/gateway/types.gen';

const NOW = 1_800_000_000_000;

const evaluation = (pair: string | null): Evaluation => ({
  conditions: [
    {
      type_id: 'nearLiquidation',
      subject: '310',
      pair,
      severity: 'critical',
      value: 12.8,
      threshold: 15,
      detail: null,
      for_ms: 0,
    },
  ],
  evaluated: ['nearLiquidation'],
  disabled: [],
});

describe('AlertBook pair', () => {
  it('keeps the trade id as the key and carries the pair of the position', () => {
    const book = new AlertBook();
    book.evaluateBot(NOW, 'local:9400', evaluation('SKY/USDC:USDC'));
    book.evaluateBot(NOW + 5_000, 'local:9400', evaluation('SKY/USDC:USDC'));
    const alerts = book.alerts(NOW + 5_000);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ subject: '310', pair: 'SKY/USDC:USDC' });
  });

  it('reads a saved state that predates the pair as a null pair', () => {
    const book = new AlertBook();
    book.evaluateBot(NOW, 'local:9400', evaluation('SKY/USDC:USDC'));
    const state = book.toState();
    delete (state.tracked[0]!.alert as { pair?: string | null }).pair;
    expect(AlertBook.fromState(state).alerts(NOW)[0]!.pair).toBeNull();
  });
});
