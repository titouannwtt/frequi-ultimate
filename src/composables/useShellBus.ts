import { ref } from 'vue';

const healthOpen = ref(false);
const logsOpen = ref(false);
/** Bot whose logs the drawer shows (null: the errors of the whole fleet). */
const logsBot = ref<string | null>(null);
const helpOpen = ref(false);
/** The alert centre behind the bell: active, acknowledged, silenced alerts and the events. */
const alertsOpen = ref(false);
/** Incremented by the palette command "switch table / map": the Fleet page toggles its view. */
const viewTick = ref(0);

/**
 * What the shell asks the page or the app to open: the health sheet, the logs drawer, the
 * shortcut help and the alert centre (02 section 2.3). Module level so the status bar, the
 * palette and the pages share one state without prop drilling through the shell.
 */
export function useShellBus() {
  return {
    healthOpen,
    logsOpen,
    logsBot,
    helpOpen,
    alertsOpen,
    viewTick,
    toggleView: () => (viewTick.value += 1),
  };
}
