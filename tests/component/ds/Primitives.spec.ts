import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import Banner from '../../../src/components/ds/Banner.vue';
import Btn from '../../../src/components/ds/Btn.vue';
import ConnectionPill from '../../../src/components/ds/ConnectionPill.vue';
import DataTable from '../../../src/components/ds/DataTable.vue';
import HoldButton from '../../../src/components/ds/HoldButton.vue';
import DirectionChip from '../../../src/components/ds/DirectionChip.vue';
import DcaPips from '../../../src/components/ds/DcaPips.vue';
import ExcludedCount from '../../../src/components/ds/ExcludedCount.vue';
import IconBtn from '../../../src/components/ds/IconBtn.vue';
import Menu from '../../../src/components/ds/Menu.vue';
import ModeMark from '../../../src/components/ds/ModeMark.vue';
import Pane from '../../../src/components/ds/Pane.vue';
import SegmentedControl from '../../../src/components/ds/SegmentedControl.vue';
import SplitBar from '../../../src/components/ds/SplitBar.vue';
import Switch from '../../../src/components/ds/Switch.vue';
import Toaster from '../../../src/components/ds/Toaster.vue';
import { useInflightLock } from '../../../src/composables/useInflightLock';
import { useToaster } from '../../../src/composables/useToaster';
import { mountDs } from './helpers';

describe('Boolean props that must stay undefined when absent', () => {
  it('IconBtn has no aria-pressed unless it is a toggle', () => {
    const plain = mountDs(IconBtn, { props: { icon: 'settings', label: 'Settings' } });
    expect(plain.attributes('aria-pressed')).toBeUndefined();
    const toggle = mountDs(IconBtn, { props: { icon: 'pause', label: 'Pause', pressed: false } });
    expect(toggle.attributes('aria-pressed')).toBe('false');
  });

  it('DataTable virtualises on row count unless forced', () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ id: i }));
    const cols = [{ id: 'id', label: 'Id' }];
    const auto = mountDs(DataTable, {
      props: { columns: cols, rows, rowKey: 'id', rowHeight: 30 },
    });
    expect(auto.classes()).toContain('virtual');
    const off = mountDs(DataTable, {
      props: { columns: cols, rows, rowKey: 'id', virtual: false },
    });
    expect(off.classes()).not.toContain('virtual');
  });
});

describe('Btn', () => {
  beforeEach(() => useInflightLock().releaseAll());

  it('emits click, ignores clicks when disabled or busy', async () => {
    const wrapper = mountDs(Btn, { slots: { default: 'Go' } });
    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
    await wrapper.setProps({ disabled: true, disabledReason: 'Offline' });
    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
    expect(wrapper.attributes('title')).toBe('Offline');
    await wrapper.setProps({ disabled: false, busy: true });
    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
    expect(wrapper.attributes('aria-busy')).toBe('true');
  });

  it('acquireLock takes the lock once and every surface with the key becomes busy', async () => {
    const a = mountDs(Btn, {
      props: { lockKey: 'bot1:stopbuy:', acquireLock: true },
      slots: { default: 'A' },
    });
    const b = mountDs(Btn, { props: { lockKey: 'bot1:stopbuy:' }, slots: { default: 'B' } });
    await a.trigger('click');
    expect(a.emitted('click')).toHaveLength(1);
    await nextTick();
    expect(b.attributes('aria-busy')).toBe('true');
    await b.trigger('click');
    expect(b.emitted('click')).toBeUndefined();
    expect(b.emitted('locked')).toEqual([['bot1:stopbuy:']]);
    useInflightLock().release('bot1:stopbuy:');
    await nextTick();
    expect(b.attributes('aria-busy')).toBeUndefined();
  });

  it('a lockKey alone only observes the lock: it never takes it on click', async () => {
    const lock = useInflightLock();
    const row = mountDs(Btn, {
      props: { lockKey: 'bot1:forceexit:7' },
      slots: { default: 'Exit' },
    });
    await row.trigger('click');
    expect(row.emitted('click')).toHaveLength(1);
    expect(lock.isLocked('bot1:forceexit:7')).toBe(false);
    // Taken by the real trigger (a HoldButton or the action owner): the row button shows it
    lock.acquire('bot1:forceexit:7');
    await nextTick();
    expect(row.attributes('aria-busy')).toBe('true');
    await row.trigger('click');
    expect(row.emitted('click')).toHaveLength(1);
    expect(row.emitted('locked')).toEqual([['bot1:forceexit:7']]);
  });

  it('a row button and the HoldButton of its dialog can share one key', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      const lock = useInflightLock();
      const key = 'bot1:forceexit:7';
      const row = mountDs(Btn, { props: { lockKey: key }, slots: { default: 'Exit' } });
      const hold = mountDs(HoldButton, { props: { label: 'Hold', lockKey: key } });
      // Opening the dialog (the click) leaves the key free, even if the dialog is then cancelled
      await row.trigger('click');
      expect(lock.isLocked(key)).toBe(false);
      await hold.get('button').trigger('pointerdown', { button: 0 });
      vi.advanceTimersByTime(1000);
      expect(hold.emitted('complete')).toHaveLength(1);
      expect(lock.isLocked(key)).toBe(true);
      await nextTick();
      expect(row.attributes('aria-busy')).toBe('true');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('DirectionChip and ModeMark never rely on colour alone', () => {
  it('writes the arrow, the letter and the leverage', () => {
    const long = mountDs(DirectionChip, { props: { side: 'long', leverage: 3 } });
    expect(long.text()).toContain('L');
    expect(long.text()).toContain('×3');
    expect(long.find('svg').exists()).toBe(true);
    expect(long.attributes('aria-label')).toBe('Long x3');
    const short = mountDs(DirectionChip, { props: { side: 'short' } });
    expect(short.text()).toContain('S');
    expect(short.find('svg').exists()).toBe(true);
    expect(mountDs(DirectionChip, { props: { side: 'both' } }).text()).toContain('L·S');
  });

  it('shows a dot for real money in tables and the full badge in headers', () => {
    const dot = mountDs(ModeMark, { props: { mode: 'live' } });
    expect(dot.find('.livemark').exists()).toBe(true);
    expect(dot.attributes('aria-label')).toBe('Live');
    expect(mountDs(ModeMark, { props: { mode: 'live', full: true } }).text()).toBe('Live');
    expect(mountDs(ModeMark, { props: { mode: 'dry' } }).text()).toBe('Dry');
  });
});

describe('DcaPips and SplitBar', () => {
  it('marks the last filled order amber from the 4th fill on', () => {
    const three = mountDs(DcaPips, { props: { filled: 3, max: 6 } });
    expect(three.findAll('i.last')).toHaveLength(0);
    const five = mountDs(DcaPips, { props: { filled: 5, max: 6 } });
    expect(five.findAll('i.last')).toHaveLength(1);
    expect(five.findAll('i')[4].classes()).toContain('last');
    expect(five.findAll('i.e')).toHaveLength(1);
    expect(five.attributes('aria-label')).toBe('5 of 6 orders filled');
  });

  it('splits long and short by ratio and describes it', () => {
    const wrapper = mountDs(SplitBar, { props: { long: 3, short: 1 } });
    expect(wrapper.attributes('aria-label')).toBe('Long 75%, Short 25%');
    expect(mountDs(SplitBar, { props: { long: 0, short: 0 } }).findAll('span')).toHaveLength(0);
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
    { value: 'c', label: 'C', disabled: true },
  ];

  it('is a radio group that emits the new value, not the current one', async () => {
    const wrapper = mountDs(SegmentedControl, { props: { options, modelValue: 'a' } });
    expect(wrapper.attributes('role')).toBe('radiogroup');
    const radios = wrapper.findAll('[role="radio"]');
    expect(radios[0].attributes('aria-checked')).toBe('true');
    await radios[0].trigger('click');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    await radios[1].trigger('click');
    await radios[2].trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([['b']]);
  });

  it('moves with the arrow keys over enabled options', async () => {
    const wrapper = mountDs(SegmentedControl, { props: { options, modelValue: 'a' } });
    await wrapper.trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('update:modelValue')![0]).toEqual(['b']);
  });
});

describe('Switch', () => {
  it('toggles and exposes role=switch', async () => {
    const wrapper = mountDs(Switch, { props: { modelValue: false, label: 'Notify' } });
    const btn = wrapper.get('[role="switch"]');
    expect(btn.attributes('aria-checked')).toBe('false');
    await btn.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]]);
    await wrapper.setProps({ disabled: true });
    await btn.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
  });
});

describe('Pane', () => {
  const body = '<p class="body">values</p>';

  it('shows the content when ready, with no banner', () => {
    const wrapper = mountDs(Pane, {
      props: { title: 'P', state: 'ready' },
      slots: { default: body },
    });
    expect(wrapper.find('.body').exists()).toBe(true);
    expect(wrapper.find('.err').exists()).toBe(false);
  });

  it('keeps the last values on an error and marks them stale with the cause', () => {
    const wrapper = mountDs(Pane, {
      props: { title: 'P', state: 'error', errorMessage: 'timeout 20 s' },
      slots: { default: body },
    });
    expect(wrapper.find('.body').exists()).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).toContain('timeout 20 s');
    expect(wrapper.get('[role="alert"]').text()).toContain('last known values');
    expect(wrapper.find('.pb').classes()).toContain('marked');
  });

  it('replaces the content on an error only when there is nothing to keep', () => {
    const wrapper = mountDs(Pane, {
      props: { title: 'P', state: 'error', hasData: false, errorMessage: '500' },
      slots: { default: body },
    });
    expect(wrapper.find('.body').exists()).toBe(false);
  });

  it('shows skeletons while loading, an empty state, and the unavailable reason', () => {
    const loading = mountDs(Pane, {
      props: { title: 'P', state: 'loading' },
      slots: { default: body },
    });
    expect(loading.find('.body').exists()).toBe(false);
    expect(loading.find('.skeleton').exists()).toBe(true);
    expect(loading.attributes('aria-busy')).toBe('true');
    const empty = mountDs(Pane, {
      props: { title: 'P', state: 'empty', emptyTitle: 'No position' },
    });
    expect(empty.text()).toContain('No position');
    const unavailable = mountDs(Pane, {
      props: { title: 'P', state: 'unavailable', unavailableReason: 'Needs the gateway.' },
      slots: { default: body },
    });
    expect(unavailable.text()).toContain('Unavailable in direct mode');
    expect(unavailable.text()).toContain('Needs the gateway.');
    expect(unavailable.find('.body').exists()).toBe(false);
  });

  it('turns itself stale, keeping the values, when its data gets too old', () => {
    const wrapper = mountDs(Pane, {
      props: {
        title: 'P',
        state: 'ready',
        freshness: { asOfMs: Date.now() - 30 * 60_000, staleAfterMs: 360_000 },
      },
      slots: { default: body },
    });
    expect(wrapper.classes()).toContain('st-stale');
    expect(wrapper.find('.body').exists()).toBe(true);
  });
});

describe('Menu', () => {
  it('isolates danger items at the end, after a separator', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const wrapper = mountDs(Menu, {
      props: {
        open: true,
        anchor,
        inline: true,
        items: [
          { id: 'del', label: 'Delete', danger: true },
          { id: 'pause', label: 'Pause' },
          { id: 'reload', label: 'Reload' },
        ],
      },
      attachTo: document.body,
    });
    const ids = Array.from(wrapper.element.ownerDocument.querySelectorAll('.menu > *')).map((el) =>
      el.tagName === 'HR' ? '--' : el.textContent?.trim(),
    );
    expect(ids).toEqual(['Pause', 'Reload', '--', 'Delete']);
    wrapper.unmount();
  });

  it('emits select with the id and closes; a disabled item does nothing', async () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const wrapper = mountDs(Menu, {
      props: {
        open: true,
        anchor,
        inline: true,
        items: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B', disabled: true },
        ],
      },
      attachTo: document.body,
    });
    const items = wrapper.findAll('[role="menuitem"]');
    await items[1].trigger('click');
    expect(wrapper.emitted('select')).toBeUndefined();
    await items[0].trigger('click');
    expect(wrapper.emitted('select')).toEqual([['a']]);
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });
});

describe('ExcludedCount', () => {
  it('renders nothing for an empty list and a counted button otherwise', () => {
    expect(
      mountDs(ExcludedCount, { props: { bots: [] } })
        .find('button')
        .exists(),
    ).toBe(false);
    const wrapper = mountDs(ExcludedCount, {
      props: {
        bots: [
          { key: 'a', name: 'bot_a' },
          { key: 'b', name: 'bot_b' },
        ],
      },
    });
    expect(wrapper.get('button').text()).toBe('2 excluded');
    expect(wrapper.get('button').attributes('aria-haspopup')).toBe('dialog');
  });
});

describe('Banner and ConnectionPill', () => {
  it('announces offline and auth as alerts, the others as status', () => {
    expect(mountDs(Banner, { props: { kind: 'offline' } }).attributes('role')).toBe('alert');
    expect(mountDs(Banner, { props: { kind: 'auth' } }).attributes('role')).toBe('alert');
    expect(mountDs(Banner, { props: { kind: 'cache' } }).attributes('role')).toBe('status');
  });

  it('emits the banner action', async () => {
    const wrapper = mountDs(Banner, { props: { kind: 'auth', action: 'Reconnect' } });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('action')).toHaveLength(1);
  });

  it('labels each connection state', () => {
    const label = (props: Record<string, unknown>) =>
      mountDs(ConnectionPill, { props: props as never })
        .get('.lbl')
        .text();
    expect(label({ kind: 'gateway', state: 'live', latencyMs: 38 })).toBe('Gateway 38 ms');
    expect(label({ kind: 'gateway', state: 'connecting' })).toBe('Connecting');
    expect(label({ kind: 'gateway', state: 'degraded' })).toBe('Degraded');
    expect(label({ kind: 'gateway', state: 'offline', frozenAt: '14:32:08' })).toBe(
      'Offline · frozen 14:32:08',
    );
    expect(label({ kind: 'direct', state: 'live' })).toBe('Direct');
  });

  it('keeps the button semantics and announces the state from a separate live region', () => {
    const wrapper = mountDs(ConnectionPill, {
      props: { kind: 'gateway', state: 'live', latencyMs: 38 },
    });
    const button = wrapper.get('button');
    expect(button.attributes('role')).toBeUndefined();
    expect(button.attributes('aria-live')).toBeUndefined();
    const status = wrapper.get('[role="status"]');
    expect(status.attributes('aria-live')).toBe('polite');
    expect(status.element.closest('button')).toBeNull();
    // The latency changes on every tick and must not be announced
    expect(status.text()).toBe('Gateway');
  });

  it('emits click from the button', async () => {
    const wrapper = mountDs(ConnectionPill, { props: { kind: 'gateway', state: 'live' } });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });
});

describe('Toaster', () => {
  beforeEach(() => useToaster().clear());

  it('renders queued toasts, closes them, and keeps errors until closed', async () => {
    const wrapper = mountDs(Toaster, { props: { inline: true }, attachTo: document.body });
    const toaster = useToaster();
    toaster.push({ kind: 'err', title: 'Rejected', body: 'confirm_trade_exit' });
    toaster.push({ kind: 'sent', title: 'Sent' });
    await nextTick();
    const toasts = wrapper.findAll('.toast');
    expect(toasts).toHaveLength(2);
    expect(toasts[0].attributes('role')).toBe('alert');
    expect(toasts[1].attributes('role')).toBe('status');
    await toasts[0].get('.x').trigger('click');
    await nextTick();
    expect(wrapper.findAll('.toast')).toHaveLength(1);
    wrapper.unmount();
  });

  it('fades a success after its ttl', async () => {
    const toaster = useToaster();
    const id = toaster.push({ kind: 'ok', title: 'Filled', ttl: 20 });
    expect(toaster.toasts.value.some((t) => t.id === id)).toBe(true);
    await new Promise((r) => setTimeout(r, 40));
    expect(toaster.toasts.value.some((t) => t.id === id)).toBe(false);
  });
});
