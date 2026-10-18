import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { ResolvedTheme } from '@/utils/theme';

function read(): ResolvedTheme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function readCvd(): boolean {
  return document.documentElement.getAttribute('data-cvd') === '1';
}

function readLang(): string {
  return document.documentElement.lang || 'en';
}

/**
 * Resolved theme, colour-blind palette flag and language read from `data-theme`, `data-cvd` and
 * `lang` on <html>, kept in sync without needing a store.
 */
export function useDocumentAppearance() {
  const isBrowser = typeof document !== 'undefined';
  const theme = ref<ResolvedTheme>(isBrowser ? read() : 'dark');
  const cvd = ref(isBrowser ? readCvd() : false);
  const lang = ref(isBrowser ? readLang() : 'en');
  let observer: MutationObserver | undefined;
  onMounted(() => {
    theme.value = read();
    cvd.value = readCvd();
    lang.value = readLang();
    observer = new MutationObserver(() => {
      theme.value = read();
      cvd.value = readCvd();
      lang.value = readLang();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-cvd', 'lang'],
    });
  });
  onBeforeUnmount(() => observer?.disconnect());
  return { theme, cvd, lang };
}

/** Resolved theme only. */
export function useDocumentTheme() {
  return useDocumentAppearance().theme;
}
