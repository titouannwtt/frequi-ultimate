import type { Ref } from 'vue';

export interface ChartShortcutActions {
  toggleVolume: () => void;
  toggleTrades: () => void;
  toggleSignals: () => void;
  toggleLegend: () => void;
  resetZoom: () => void;
  scrollLeft: () => void;
  scrollRight: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

export function useChartShortcuts(
  actions: ChartShortcutActions,
  enabled: Ref<boolean>,
  containerRef?: Ref<HTMLElement | null>,
) {
  const showHelp = ref(false);

  const shortcuts: { key: string; label: string; action: () => void }[] = [
    { key: 'v', label: 'Volume', action: actions.toggleVolume },
    { key: 't', label: 'Trades', action: actions.toggleTrades },
    { key: 's', label: 'Signaux', action: actions.toggleSignals },
    { key: 'l', label: 'Légende', action: actions.toggleLegend },
    { key: 'r', label: 'Reset zoom', action: actions.resetZoom },
    { key: 'ArrowLeft', label: '← Décaler gauche', action: actions.scrollLeft },
    { key: 'ArrowRight', label: '→ Décaler droite', action: actions.scrollRight },
    { key: '+', label: 'Zoom +', action: actions.zoomIn },
    { key: '-', label: 'Zoom −', action: actions.zoomOut },
  ];

  function onKeyDown(e: KeyboardEvent) {
    if (!enabled.value) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      return;

    if (e.key === 'Escape') {
      showHelp.value = false;
      return;
    }

    const shortcut = shortcuts.find((s) => s.key === e.key);
    if (shortcut) {
      e.preventDefault();
      shortcut.action();
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeyDown);
  });

  onUnmounted(() => {
    window.removeEventListener('keydown', onKeyDown);
  });

  return { showHelp, shortcuts };
}
