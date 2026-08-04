/**
 * Unified popover management system for trade tables.
 * Uses @floating-ui/dom for robust viewport-aware positioning with flip/shift/arrow.
 */
import type { Trade } from '@/types';
import {
  computePosition,
  flip,
  shift,
  offset,
  arrow as arrowMiddleware,
  autoUpdate,
  type Placement,
} from '@floating-ui/dom';

export type PopoverName =
  | 'tradeDetail'
  | 'chart'
  | 'duration'
  | 'dca'
  | 'typeLeverage'
  | 'exitReason'
  | 'profitStats';

interface PopoverConfig {
  delay: number;
  placement: Placement;
}

const POPOVER_CONFIGS: Record<PopoverName, PopoverConfig> = {
  tradeDetail: { delay: 400, placement: 'right-start' },
  chart: { delay: 400, placement: 'right-start' },
  duration: { delay: 300, placement: 'right-start' },
  dca: { delay: 300, placement: 'right-start' },
  typeLeverage: { delay: 300, placement: 'bottom-start' },
  exitReason: { delay: 300, placement: 'right-start' },
  profitStats: { delay: 300, placement: 'right-start' },
};

export function useTradePopover() {
  const botStore = useBotStore();

  // Active state
  const activePopover = ref<PopoverName | null>(null);
  const activeTrade = ref<Trade | null>(null);
  const activeBotId = ref<string>('');
  const activeTarget = ref<HTMLElement | null>(null);

  // Position output (set by Floating UI)
  const popoverStyle = ref<Record<string, string>>({});
  const arrowStyle = ref<Record<string, string>>({});
  const actualPlacement = ref<string>('right-start');

  // Floating UI auto-update cleanup
  let cleanupAutoUpdate: (() => void) | null = null;

  // Timers
  let showTimeout: ReturnType<typeof setTimeout> | null = null;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  function clearTimers() {
    if (showTimeout) {
      clearTimeout(showTimeout);
      showTimeout = null;
    }
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  }

  /**
   * Update popover position using Floating UI.
   * Called by autoUpdate on scroll/resize/animation.
   */
  async function updatePosition() {
    const reference = activeTarget.value;
    const floating = document.getElementById('trade-popover-floating');
    const arrowEl = document.getElementById('trade-popover-arrow');
    if (!reference || !floating) return;

    const name = activePopover.value;
    const placement = name ? POPOVER_CONFIGS[name].placement : 'right-start';

    const middleware = [
      offset(8),
      flip({ fallbackAxisSideDirection: 'start', padding: 8 }),
      shift({ padding: 8, limiter: { fn: ({ x, y }) => ({ x, y }) } }),
    ];

    if (arrowEl) {
      middleware.push(arrowMiddleware({ element: arrowEl, padding: 8 }));
    }

    const result = await computePosition(reference, floating, {
      placement,
      middleware,
    });

    popoverStyle.value = {
      position: 'fixed',
      left: `${Math.round(result.x)}px`,
      top: `${Math.round(result.y)}px`,
      zIndex: '1100',
    };

    actualPlacement.value = result.placement;

    // Arrow positioning with rotation based on placement side
    if (arrowEl && result.middlewareData.arrow) {
      const { x: ax, y: ay } = result.middlewareData.arrow;
      const side = result.placement.split('-')[0]!;
      const staticSide = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' }[side]!;
      // Rotate the arrow so the visible border-left/border-top corner points toward the reference
      const rotation =
        { top: '225deg', right: '315deg', bottom: '45deg', left: '135deg' }[side] ?? '45deg';
      arrowStyle.value = {
        position: 'absolute',
        left: ax != null ? `${ax}px` : '',
        top: ay != null ? `${ay}px` : '',
        [staticSide]: '-4px',
        transform: `rotate(${rotation})`,
      };
    }
  }

  /**
   * Start autoUpdate (recalculates position on scroll/resize).
   */
  function startAutoUpdate() {
    stopAutoUpdate();
    const reference = activeTarget.value;
    const floating = document.getElementById('trade-popover-floating');
    if (!reference || !floating) return;
    cleanupAutoUpdate = autoUpdate(reference, floating, updatePosition, {
      ancestorScroll: true,
      ancestorResize: true,
      elementResize: true,
    });
  }

  function stopAutoUpdate() {
    if (cleanupAutoUpdate) {
      cleanupAutoUpdate();
      cleanupAutoUpdate = null;
    }
  }

  /**
   * Show a named popover for a trade.
   */
  function show(name: PopoverName, event: MouseEvent, trade: Trade) {
    const target = event.currentTarget as HTMLElement;
    if (!target) return;

    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }

    // Same popover + same trade → do nothing
    if (activePopover.value === name && activeTrade.value?.trade_id === trade.trade_id) return;

    // Switching trade on same popover type → switch immediately
    if (activePopover.value === name) {
      activeTrade.value = trade;
      activeBotId.value = trade.botId || botStore.selectedBot;
      activeTarget.value = target;
      nextTick(updatePosition);
      return;
    }

    if (showTimeout) {
      clearTimeout(showTimeout);
      showTimeout = null;
    }

    const config = POPOVER_CONFIGS[name];
    showTimeout = setTimeout(() => {
      showTimeout = null;
      stopAutoUpdate();
      activePopover.value = name;
      activeTrade.value = trade;
      activeBotId.value = trade.botId || botStore.selectedBot;
      activeTarget.value = target;
      // Wait for DOM render, then position + start auto-update
      nextTick(() => {
        updatePosition();
        startAutoUpdate();
      });
    }, config.delay);
  }

  /**
   * Show a popover for aggregate stats (no specific trade).
   */
  function showStats(name: PopoverName, event: MouseEvent) {
    const target = event.currentTarget as HTMLElement;
    if (!target) return;
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    if (showTimeout) {
      clearTimeout(showTimeout);
      showTimeout = null;
    }

    const config = POPOVER_CONFIGS[name];
    showTimeout = setTimeout(() => {
      showTimeout = null;
      stopAutoUpdate();
      activePopover.value = name;
      activeTrade.value = null;
      activeBotId.value = '';
      activeTarget.value = target;
      nextTick(() => {
        updatePosition();
        startAutoUpdate();
      });
    }, config.delay);
  }

  /**
   * Hide with 200ms grace period.
   */
  function hide() {
    if (showTimeout) {
      clearTimeout(showTimeout);
      showTimeout = null;
    }
    hideTimeout = setTimeout(() => {
      hideTimeout = null;
      stopAutoUpdate();
      activePopover.value = null;
      activeTrade.value = null;
      activeBotId.value = '';
      activeTarget.value = null;
    }, 200);
  }

  function keepAlive() {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    if (showTimeout) {
      clearTimeout(showTimeout);
      showTimeout = null;
    }
  }

  function close() {
    clearTimers();
    stopAutoUpdate();
    activePopover.value = null;
    activeTrade.value = null;
    activeBotId.value = '';
    activeTarget.value = null;
  }

  function reposition() {
    updatePosition();
  }

  function cleanup() {
    clearTimers();
    stopAutoUpdate();
  }

  onUnmounted(cleanup);

  return {
    activePopover: readonly(activePopover),
    activeTrade: readonly(activeTrade),
    activeBotId: readonly(activeBotId),
    popoverStyle: readonly(popoverStyle),
    arrowStyle: readonly(arrowStyle),
    actualPlacement: readonly(actualPlacement),
    show,
    showStats,
    hide,
    keepAlive,
    close,
    reposition,
    cleanup,
  };
}
