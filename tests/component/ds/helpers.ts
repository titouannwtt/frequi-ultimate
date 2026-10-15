import { mount, type ComponentMountingOptions } from '@vue/test-utils';
import type { Component } from 'vue';
import i18n from '../../../src/locales';

/** Mount a primitive with the real FR/EN messages (English unless `setLocale` was called). */
export function mountDs<T extends Component>(
  component: T,
  options: ComponentMountingOptions<T> = {} as ComponentMountingOptions<T>,
) {
  return mount(component, {
    ...options,
    global: { ...(options.global ?? {}), plugins: [i18n, ...(options.global?.plugins ?? [])] },
  } as ComponentMountingOptions<T>);
}

export function setLocale(lang: 'fr' | 'en') {
  i18n.global.locale.value = lang;
}

/** Stub matchMedia so `prefers-reduced-motion: reduce` matches (or not). */
export function stubReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
