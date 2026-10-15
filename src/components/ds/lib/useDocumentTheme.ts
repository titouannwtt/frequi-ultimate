import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { ResolvedTheme } from '@/utils/theme';

function read(): ResolvedTheme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/** Resolved theme read from `data-theme` on <html>, kept in sync without needing a store. */
export function useDocumentTheme() {
  const theme = ref<ResolvedTheme>(typeof document === 'undefined' ? 'dark' : read());
  let observer: MutationObserver | undefined;
  onMounted(() => {
    theme.value = read();
    observer = new MutationObserver(() => {
      theme.value = read();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  });
  onBeforeUnmount(() => observer?.disconnect());
  return theme;
}
