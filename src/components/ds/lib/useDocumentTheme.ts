import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { ResolvedTheme } from '@/utils/theme';

function read(): ResolvedTheme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function readCvd(): boolean {
  return document.documentElement.getAttribute('data-cvd') === '1';
}

/**
 * Resolved theme and colour-blind palette flag read from `data-theme` and `data-cvd` on <html>,
 * kept in sync without needing a store.
 */
export function useDocumentAppearance() {
  const isBrowser = typeof document !== 'undefined';
  const theme = ref<ResolvedTheme>(isBrowser ? read() : 'dark');
  const cvd = ref(isBrowser ? readCvd() : false);
  let observer: MutationObserver | undefined;
  onMounted(() => {
    theme.value = read();
    cvd.value = readCvd();
    observer = new MutationObserver(() => {
      theme.value = read();
      cvd.value = readCvd();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-cvd'],
    });
  });
  onBeforeUnmount(() => observer?.disconnect());
  return { theme, cvd };
}

/** Resolved theme only. */
export function useDocumentTheme() {
  return useDocumentAppearance().theme;
}
