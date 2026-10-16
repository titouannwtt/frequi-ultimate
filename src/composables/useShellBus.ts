import { ref } from 'vue';

const healthOpen = ref(false);
const logsOpen = ref(false);
/** Bot whose logs the drawer shows (null: the errors of the whole fleet). */
const logsBot = ref<string | null>(null);
const helpOpen = ref(false);
/** Incremented when the bell is pressed: the Fleet page focuses the "needs attention" rail. */
const attentionTick = ref(0);
/** Incremented by the palette command "switch table / map": the Fleet page toggles its view. */
const viewTick = ref(0);

/**
 * What the shell asks the page or the app to open: the health sheet, the logs drawer, the
 * shortcut help and the attention rail (02 section 2.3). Module level so the status bar, the
 * palette and the pages share one state without prop drilling through the shell.
 */
export function useShellBus() {
  return {
    healthOpen,
    logsOpen,
    logsBot,
    helpOpen,
    attentionTick,
    viewTick,
    focusAttention: () => (attentionTick.value += 1),
    toggleView: () => (viewTick.value += 1),
  };
}
