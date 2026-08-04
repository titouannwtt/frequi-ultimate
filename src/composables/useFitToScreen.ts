/**
 * Fit-to-screen toggle for wide data tables.
 *
 * When enabled the table switches to a fixed layout spanning exactly the
 * available width: columns share the space, cells truncate with an ellipsis and
 * the horizontal scrollbar disappears while vertical scrolling is preserved.
 * The styling lives in `src/styles/fit-screen.css` (global, unscoped so it can
 * override PrimeVue); this composable only owns the persisted state.
 *
 * @param key Stable per-widget id — each table remembers its own setting.
 */
export function useFitToScreen(key: string) {
  const storageKey = `ft_fit_screen_${key}`;
  const fitToScreen = ref<boolean>(localStorage.getItem(storageKey) === 'true');

  function toggleFitToScreen() {
    fitToScreen.value = !fitToScreen.value;
    try {
      localStorage.setItem(storageKey, String(fitToScreen.value));
    } catch {
      /* localStorage unavailable — keep the in-memory value */
    }
  }

  return { fitToScreen, toggleFitToScreen };
}
