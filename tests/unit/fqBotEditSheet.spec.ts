import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import BotEditSheet from '@/components/fq/BotEditSheet.vue';
import i18n from '@/locales';

function mountSheet(over: Record<string, unknown> = {}) {
  return mount(BotEditSheet, {
    props: {
      open: true,
      mode: 'add',
      initial: { name: '', url: 'http://127.0.0.1:3021', username: '' },
      busy: false,
      error: null,
      others: [],
      ...over,
    },
    global: { plugins: [i18n], stubs: { Teleport: true } },
    attachTo: document.body,
  });
}

describe('BotEditSheet', () => {
  it('flags nothing on a form nobody has touched, and the submit stays disabled', () => {
    const w = mountSheet();
    expect(w.find('[role="alert"]').exists()).toBe(false);
    expect(w.find('[data-testid="bot-submit"]').attributes('aria-disabled')).toBe('true');
    w.unmount();
  });

  it('checks the form from the first edit: the missing fields are named', async () => {
    const w = mountSheet();
    const name = w.findAll('input')[0]!;
    await name.setValue('Bot');
    await nextTick();
    // The name is given; the username is the first thing still missing
    expect(w.find('[role="alert"]').text()).toMatch(/username/i);
    expect(w.find('[data-testid="bot-submit"]').attributes('aria-disabled')).toBe('true');
    w.unmount();
  });

  it('is submittable once complete, and sends the form with the password', async () => {
    const w = mountSheet();
    const inputs = w.findAll('input');
    await inputs[0]!.setValue('Bot');
    await inputs[2]!.setValue('user');
    await inputs[3]!.setValue('secret');
    expect(w.find('[data-testid="bot-submit"]').attributes('aria-disabled')).toBeUndefined();
    await w.find('form').trigger('submit');
    const sent = w.emitted('submit')![0]![0] as Record<string, string>;
    expect(sent).toMatchObject({ name: 'Bot', username: 'user', password: 'secret' });
    w.unmount();
  });
});
