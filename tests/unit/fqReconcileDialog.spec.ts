import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ReconcileDialog from '@/components/fq/ReconcileDialog.vue';
import i18n from '@/locales';
import type { FleetviewCoin } from '@/types/fleetview';

const row: FleetviewCoin = {
  coin: 'ARB',
  db_sum: 0,
  on_chain: 12,
  mark_price: 1,
  on_chain_leverage: 2,
  unrealized_pnl: 0,
  status: 'unowned',
  slices: [],
  phantom_candidate: null,
  minority_slices: [],
};

function mountDialog(over: Record<string, unknown> = {}) {
  return mount(ReconcileDialog, {
    props: {
      open: true,
      row,
      viaBot: 'hippo_1',
      busy: false,
      outcome: null,
      failure: null,
      ...over,
    },
    global: { plugins: [i18n], stubs: { Teleport: true } },
    attachTo: document.body,
  });
}

/** Holds the confirmation button for `ms` of fake time. */
async function hold(w: ReturnType<typeof mountDialog>, ms: number) {
  const btn = w.find('button[aria-describedby]').exists()
    ? w.find('button[aria-describedby]')
    : w.findAll('button').at(-1)!;
  await btn.trigger('pointerdown');
  await vi.advanceTimersByTimeAsync(ms);
  await btn.trigger('pointerup');
  await flushPromises();
}

describe('ReconcileDialog (destructive level)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the body exactly as it will be sent', () => {
    const w = mountDialog();
    expect(w.find('[data-testid="recon-dialog"]').exists()).toBe(true);
    expect(w.text()).toContain('"action": "close_unowned"');
    expect(w.text()).toContain('"confirm": true');
    w.unmount();
  });

  it('does not send anything while the coin name is not typed back', async () => {
    const w = mountDialog();
    await hold(w, 1500);
    expect(w.emitted('confirm')).toBeUndefined();
    await w.find('input').setValue('AR');
    await hold(w, 1500);
    expect(w.emitted('confirm')).toBeUndefined();
    w.unmount();
  });

  it('needs the full second of hold, then emits the body once and never again', async () => {
    const w = mountDialog();
    await w.find('input').setValue('arb');
    await hold(w, 400);
    expect(w.emitted('confirm')).toBeUndefined();
    await hold(w, 1000);
    expect(w.emitted('confirm')).toHaveLength(1);
    expect(w.emitted('confirm')![0][0]).toEqual({
      action: 'close_unowned',
      coin: 'ARB',
      confirm: true,
    });
    // A second hold on the same dialog is refused: a new attempt is a new preview.
    await hold(w, 1500);
    expect(w.emitted('confirm')).toHaveLength(1);
    w.unmount();
  });
});
