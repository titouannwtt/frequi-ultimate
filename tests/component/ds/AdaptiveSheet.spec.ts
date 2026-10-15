import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import AdaptiveSheet from '../../../src/components/ds/AdaptiveSheet.vue';
import { mountDs } from './helpers';

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

describe('AdaptiveSheet', () => {
  afterEach(() => {
    setWidth(1440);
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  const mountSheet = (props: Record<string, unknown> = {}) =>
    mountDs(AdaptiveSheet, {
      props: { open: true, title: 'TAO #1180', inline: true, ...props },
      slots: {
        default: '<button id="inside">Inside</button>',
        footer: '<button id="foot">Foot</button>',
      },
      attachTo: document.body,
    });

  it('is a right drawer on desktop and a bottom sheet under 600 px', async () => {
    setWidth(1440);
    const wrapper = mountSheet();
    await nextTick();
    expect(wrapper.get('aside').attributes('data-mode')).toBe('drawer');
    // The CSS selects on these classes: the bottom-sheet rules must not leak into the drawer
    expect(wrapper.get('aside').classes()).toContain('is-drawer');
    expect(wrapper.get('aside').classes()).not.toContain('is-sheet');
    expect(wrapper.find('.grab').exists()).toBe(false);

    setWidth(390);
    await nextTick();
    expect(wrapper.get('aside').attributes('data-mode')).toBe('sheet');
    expect(wrapper.get('aside').classes()).toContain('is-sheet');
    expect(wrapper.find('.grab').exists()).toBe(true);

    setWidth(599);
    await nextTick();
    expect(wrapper.get('aside').attributes('data-mode')).toBe('sheet');
    setWidth(600);
    await nextTick();
    expect(wrapper.get('aside').attributes('data-mode')).toBe('drawer');
    wrapper.unmount();
  });

  it('starts as a bottom sheet on a narrow viewport', async () => {
    setWidth(390);
    const wrapper = mountSheet();
    await nextTick();
    expect(wrapper.get('aside').attributes('data-mode')).toBe('sheet');
    wrapper.unmount();
  });

  it('renders nothing when closed', () => {
    const wrapper = mountSheet({ open: false });
    expect(wrapper.find('aside').exists()).toBe(false);
    expect(wrapper.find('.scrim').exists()).toBe(false);
    wrapper.unmount();
  });

  it('exposes dialog semantics with the title as its name', () => {
    const wrapper = mountSheet();
    const aside = wrapper.get('aside');
    expect(aside.attributes('role')).toBe('dialog');
    expect(aside.attributes('aria-modal')).toBe('true');
    const labelledby = aside.attributes('aria-labelledby')!;
    expect(wrapper.get(`[id="${labelledby}"]`).text()).toBe('TAO #1180');
    wrapper.unmount();
  });

  it('closes on Escape, on the scrim and on the cross', async () => {
    const wrapper = mountSheet();
    await nextTick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toHaveLength(1);
    await wrapper.get('.scrim').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(2);
    await wrapper.get('.x').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(3);
    wrapper.unmount();
  });

  it('can keep the scrim from closing the sheet', async () => {
    const wrapper = mountSheet({ scrimClose: false });
    await wrapper.get('.scrim').trigger('click');
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();
  });

  it('does not react to Escape while closed', async () => {
    const wrapper = mountSheet({ open: false });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toBeUndefined();
    wrapper.unmount();
  });

  it('moves the focus inside, traps Tab, and restores the focus on close', async () => {
    const opener = document.createElement('button');
    opener.id = 'opener';
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const wrapper = mountSheet({ open: false });
    await wrapper.setProps({ open: true });
    await nextTick();
    await nextTick();
    const aside = wrapper.get('aside').element;
    expect(aside.contains(document.activeElement)).toBe(true);

    // Tab from the last focusable element wraps to the first
    const foot = wrapper.get('#foot').element as HTMLElement;
    foot.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(wrapper.get('.x').element);

    // Shift+Tab from the first wraps to the last
    const back = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(back);
    expect(document.activeElement).toBe(foot);

    await wrapper.setProps({ open: false });
    await nextTick();
    expect(document.activeElement).toBe(opener);
    wrapper.unmount();
  });

  it('locks the page scroll while open and releases it after', async () => {
    const wrapper = mountSheet({ open: false });
    expect(document.body.style.overflow).toBe('');
    await wrapper.setProps({ open: true });
    expect(document.body.style.overflow).toBe('hidden');
    await wrapper.setProps({ open: false });
    expect(document.body.style.overflow).toBe('');
    wrapper.unmount();
  });
});
