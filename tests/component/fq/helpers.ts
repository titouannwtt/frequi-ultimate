import { mount, type ComponentMountingOptions } from '@vue/test-utils';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { vi } from 'vitest';
import type { Component } from 'vue';

import {
  FIXTURE_NOW,
  fakeSource,
  makeFixture,
  resetStores,
  seedStores,
  type FakeSource,
  type FleetFixture,
} from '../../../src/components/fq/fixtures';
import { resetActionDialog } from '../../../src/composables/useActionDialog';
import { resetBotActionState } from '../../../src/composables/useBotAction';
import { useCommandPalette } from '../../../src/composables/useCommandPalette';
import { useInflightLock } from '../../../src/composables/useInflightLock';
import { useToaster } from '../../../src/composables/useToaster';
import i18n from '../../../src/locales';

let pinia: Pinia;
const mounted: Array<{ unmount: () => void }> = [];

/** Mount a composite with the real messages and the shared pinia of the test. */
export function mountFq<T extends Component>(
  component: T,
  options: ComponentMountingOptions<T> = {} as ComponentMountingOptions<T>,
) {
  const wrapper = mount(component, {
    ...options,
    global: {
      ...(options.global ?? {}),
      plugins: [pinia, i18n, ...(options.global?.plugins ?? [])],
    },
  } as ComponentMountingOptions<T>);
  mounted.push(wrapper);
  return wrapper;
}

export function setFqLocale(lang: 'fr' | 'en') {
  i18n.global.locale.value = lang;
}

export interface FqWorld {
  fixture: FleetFixture;
  fake: FakeSource;
}

/**
 * Fresh pinia, fresh module state (in-flight locks, open dialog, toasts), the fixture fleet in the
 * stores and a fake source. The clock is frozen at the fixture "now" (the digest freshness of the
 * fixtures depends on it); timers are faked so a 1 s hold is advanced by hand. Nothing here can
 * reach a real bot: the only `act` is the fake one.
 */
export function setupWorld(n = 40): FqWorld {
  pinia = createPinia();
  setActivePinia(pinia);
  resetBotActionState();
  resetActionDialog();
  useInflightLock().releaseAll();
  useToaster().clear();
  useCommandPalette().hide();
  setFqLocale('en');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  vi.setSystemTime(FIXTURE_NOW);
  const fixture = makeFixture(n);
  resetStores();
  seedStores(fixture);
  return { fixture, fake: fakeSource(fixture) };
}

export function teardownWorld() {
  // Unmount first: shared module state (palette, dialog) would otherwise drive dead instances
  for (const w of mounted.splice(0)) w.unmount();
  vi.useRealTimers();
  document.body.innerHTML = '';
}

/** Hold a HoldButton for its 1 s (pointer), advancing the faked clock. */
export async function holdFor(
  button: { trigger: (e: string, o?: object) => Promise<unknown> },
  ms: number,
  settle = true,
) {
  await button.trigger('pointerdown', { button: 0 });
  vi.advanceTimersByTime(ms);
  if (settle) await vi.advanceTimersByTimeAsync(0);
}
