import { ref } from 'vue';

const open = ref(false);

/** Open state of the command palette (Ctrl K), shared by the shell button and the shortcut. */
export function useCommandPalette() {
  return {
    open,
    show: () => (open.value = true),
    hide: () => (open.value = false),
    toggle: () => (open.value = !open.value),
  };
}
