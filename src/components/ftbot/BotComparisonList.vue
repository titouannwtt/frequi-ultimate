<script setup lang="ts">
import type { ComparisonTableItems, ColumnDefinition, BotGroup, CustomTag, AlertTypeDefinition, AlertConfigV2, AlertSettingConfig, DetectedAlert } from '@/types';
import type Popover from 'primevue/popover';
import { useI18n } from 'vue-i18n';
import { useExchangeRates } from '@/composables/exchangeRates';
import { useBotComparisonStore, ALERT_TYPES, ALERT_CATEGORIES } from '@/stores/botComparison';
import type { BotTagVisibility, BotFilters, ActiveSort, SortDirection, TagId } from '@/stores/botComparison';
import { useAlertDetection } from '@/composables/useAlertDetection';
import { trackMouse, fakeEventAtMouse, fakeEvent, delayedHide, cancelDelayedHide, cleanupAllTimeouts } from '@/composables/usePopoverHover';
import { computePosition, flip, shift, offset, arrow as arrowMiddleware } from '@floating-ui/dom';

const { t } = useI18n();
const botStore = useBotStore();
const compStore = useBotComparisonStore();

// Migrate legacy localStorage data on first load
compStore.migrateFromLocalStorage();
const { convert, getRate, hasRates, isLoading: ratesLoading, fetchError: ratesFetchError, lastFetchTime: ratesLastFetchTime } = useExchangeRates();
const {
  allBotAlerts, totalAlertCount, isBotAlertEnabled,
  hasBotAlert, getBotAlertCount, getMaxSeverity, hasBotOfflineAlert,
  getAlertTooltip: _getAlertTooltip, getAlertTypeIcon, enabledAlertCount,
} = useAlertDetection();
function getAlertTooltip(alertId: string) { return _getAlertTooltip(alertId, t); }

// Ensure all bot stake currencies are tracked
const allStakeCurrencies = computed(() => {
  const currencies = new Set<string>();
  for (const [, state] of Object.entries(botStore.allBotState)) {
    if (state?.stake_currency) currencies.add(state.stake_currency as string);
  }
  return [...currencies];
});

// Human-readable "time ago" for rates
const ratesUpdatedAgo = computed(() => {
  if (!ratesLastFetchTime.value) return '';
  const diff = Date.now() - ratesLastFetchTime.value;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '< 1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
});
const columnPopover = ref<InstanceType<typeof Popover>>();

// --- Info popover state ---
const hoveredBotId = ref<string | null>(null);
const infoPopover = ref<InstanceType<typeof Popover>>();

const hoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

// --- Hover popover system ---
// Close all popovers when mouse leaves the browser window
onMounted(() => {
  document.addEventListener('mouseleave', closeAllPopovers);
});
onUnmounted(() => {
  document.removeEventListener('mouseleave', closeAllPopovers);
  cleanupAllTimeouts();
});

// Close all info popovers (only one should be open at a time)
function closeAllPopovers() {
  infoPopover.value?.hide();
  hoveredBotId.value = null;
  exchangeInfoPopover.value?.hide();
  hoveredExchange.value = null;
  currencyInfoPopover.value?.hide();
  hoveredCurrency.value = null;
  openProfitPopover.value?.hide();
  hoveredOpenProfitBotId.value = null;
  closedProfitPopover.value?.hide();
  hoveredClosedProfitBotId.value = null;
  tradesPopover.value?.hide();
  hoveredTradesBotId.value = null;
  winLossPopover.value?.hide();
  hoveredWinLossBotId.value = null;
  balancePopover.value?.hide();
  hoveredBalanceBotId.value = null;
  periodProfitPopover.value?.hide();
  hoveredPeriodProfitBotId.value = null;
  summaryOpenPopover.value?.hide();
  summaryOpenVisible.value = false;
  summaryClosedPopover.value?.hide();
  summaryClosedVisible.value = false;
  summaryTradesPopover.value?.hide();
  summaryTradesVisible.value = false;
  summaryBalancePopover.value?.hide();
  summaryBalanceVisible.value = false;
  summaryWinLossPopover.value?.hide();
  summaryWinLossVisible.value = false;
  summaryPeriodPopover.value?.hide();
  summaryPeriodVisible.value = false;
  groupOpenPopover.value?.hide();
  groupOpenVisible.value = false;
  groupOpenBotIds.value = [];
  groupClosedPopover.value?.hide();
  groupClosedVisible.value = false;
  groupClosedBotIds.value = [];
  tagPickerPopover.value?.hide();
  tagPickerBotId.value = null;
  alertHoverPopover.value?.hide();
  alertHoverBotId.value = null;
}

// Popovers anchor to the hovered element (shows to the right with arrow)
const hoveredExchange = ref<string | null>(null);
const exchangeInfoPopover = ref<InstanceType<typeof Popover>>();
const exchangeHoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

const hoveredCurrency = ref<string | null>(null);
const currencyInfoPopover = ref<InstanceType<typeof Popover>>();
const currencyHoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

// Popover utilities imported from usePopoverHover composable
// (trackMouse, fakeEventAtMouse, fakeEvent, delayedHide, cancelDelayedHide, cleanupAllTimeouts)

/** Show a PrimeVue Popover anchored to a real DOM element, then reposition with Floating UI */
function showAtTarget(popover: { show: (event: Event) => void; $el?: HTMLElement } | undefined, target: HTMLElement) {
  if (!popover) return;
  popover.show({ currentTarget: target } as unknown as Event);
  // Immediately hide the panel visually while Floating UI calculates position
  // This prevents the flash of the panel at PrimeVue's default position
  nextTick(() => {
    const panel = findPopoverPanel(popover);
    if (panel) {
      panel.style.opacity = '0';
      panel.style.transition = 'none';
    }
    // Give PrimeVue one frame to finalize the panel dimensions
    requestAnimationFrame(async () => {
      await repositionPrimePopover(target, popover);
      // Now reveal with a smooth fade
      if (panel) {
        panel.style.transition = 'opacity 0.1s ease-out';
        panel.style.opacity = '1';
      }
    });
  });
}

/** Z-index counter for stacking popovers — each new popover gets a higher z-index */
let popoverZCounter = 1200;

/** Find the PrimeVue popover panel DOM element */
function findPopoverPanel(popoverInstance: any): HTMLElement | null {
  if (popoverInstance?.container) return popoverInstance.container;
  if (popoverInstance?.$el) return popoverInstance.$el;
  // Fallback: last visible .p-popover in DOM
  const panels = document.querySelectorAll<HTMLElement>('.p-popover');
  for (let i = panels.length - 1; i >= 0; i--) {
    if (panels[i].offsetParent !== null) return panels[i];
  }
  return null;
}

/** Ensure a popover panel has an arrow element, create if missing */
function ensureArrowElement(panel: HTMLElement): HTMLElement {
  let arrow = panel.querySelector<HTMLElement>('.ft-popover-arrow');
  if (!arrow) {
    arrow = document.createElement('div');
    arrow.className = 'ft-popover-arrow';
    Object.assign(arrow.style, {
      position: 'absolute',
      width: '8px',
      height: '8px',
      background: 'inherit',
      borderLeft: '1px solid rgba(255,255,255,0.08)',
      borderTop: '1px solid rgba(255,255,255,0.08)',
      borderRight: 'none',
      borderBottom: 'none',
      zIndex: '-1',
    });
    panel.appendChild(arrow);
  }
  return arrow;
}

/** Reposition a PrimeVue Popover using Floating UI with arrow */
async function repositionPrimePopover(
  reference: HTMLElement,
  popoverInstance: any,
) {
  const panel = findPopoverPanel(popoverInstance);
  if (!panel || !reference) return;

  const arrowEl = ensureArrowElement(panel);

  const result = await computePosition(reference, panel, {
    placement: 'right-start',
    middleware: [
      offset(10),
      flip({
        fallbackPlacements: ['left-start', 'bottom-start', 'top-start'],
        padding: 8,
      }),
      shift({ padding: 8 }),
      arrowMiddleware({ element: arrowEl, padding: 8 }),
    ],
  });

  // Position the panel with incrementing z-index so sub-popovers stack above parents
  popoverZCounter++;
  Object.assign(panel.style, {
    position: 'fixed',
    left: `${Math.round(result.x)}px`,
    top: `${Math.round(result.y)}px`,
    margin: '0',
    transform: 'none',
    zIndex: String(popoverZCounter),
  });

  // Position + rotate the arrow
  const side = result.placement.split('-')[0]!;
  const staticSide: Record<string, string> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };
  const rotation: Record<string, string> = { top: '225deg', right: '315deg', bottom: '45deg', left: '135deg' };
  const { x: ax, y: ay } = result.middlewareData.arrow ?? {};

  Object.assign(arrowEl.style, {
    left: ax != null ? `${ax}px` : '',
    top: ay != null ? `${ay}px` : '',
    right: '',
    bottom: '',
    [staticSide[side] ?? 'bottom']: '-5px',
    transform: `rotate(${rotation[side] ?? '45deg'})`,
  });
}

// --- Bot info popover ---
function hideInfoPopover() {
  if (hoverTimeout.value) { clearTimeout(hoverTimeout.value); hoverTimeout.value = null; }
  delayedHide(infoPopover.value, () => { hoveredBotId.value = null; });
}

function startHoverInfo(event: MouseEvent, botId: string) {
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  cancelDelayedHide();
  if (hoverTimeout.value) clearTimeout(hoverTimeout.value);
  // If already showing for a different bot, reposition immediately
  if (hoveredBotId.value && hoveredBotId.value !== botId) {
    hoveredBotId.value = botId;
    infoPopover.value?.hide();
    showAtTarget(infoPopover.value, target);
    return;
  }
  hoverTimeout.value = setTimeout(() => {
    // Close other popovers but not this one
    exchangeInfoPopover.value?.hide();
    currencyInfoPopover.value?.hide();
    openProfitPopover.value?.hide();
    closedProfitPopover.value?.hide();
    tradesPopover.value?.hide();
    winLossPopover.value?.hide();
    balancePopover.value?.hide();
    periodProfitPopover.value?.hide();
    hoveredBotId.value = botId;
    showAtTarget(infoPopover.value, target);
  }, 400);
}

function showInfoPopover(event: MouseEvent, botId: string) {
  // Instant show (for info icon click)
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  // Close other popovers
  exchangeInfoPopover.value?.hide();
  currencyInfoPopover.value?.hide();
  openProfitPopover.value?.hide();
  closedProfitPopover.value?.hide();
  tradesPopover.value?.hide();
  winLossPopover.value?.hide();
  balancePopover.value?.hide();
  periodProfitPopover.value?.hide();
  cancelDelayedHide();
  hoveredBotId.value = botId;
  showAtTarget(infoPopover.value, target);
}

function cancelHoverInfo() {
  if (hoverTimeout.value) { clearTimeout(hoverTimeout.value); hoverTimeout.value = null; }
  delayedHide(infoPopover.value, () => { hoveredBotId.value = null; });
}

function cancelHoverInfoKeepPopover() {
  cancelDelayedHide();
  if (hoverTimeout.value) { clearTimeout(hoverTimeout.value); hoverTimeout.value = null; }
}

// --- Exchange info popover ---
function startExchangeHover(event: MouseEvent, exchange: string) {
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  cancelDelayedHide();
  if (exchangeHoverTimeout.value) clearTimeout(exchangeHoverTimeout.value);
  exchangeHoverTimeout.value = setTimeout(() => {
    closeAllPopovers();
    hoveredExchange.value = exchange;
    showAtTarget(exchangeInfoPopover.value, target);
  }, 400);
}

function cancelExchangeHover() {
  if (exchangeHoverTimeout.value) { clearTimeout(exchangeHoverTimeout.value); exchangeHoverTimeout.value = null; }
  delayedHide(exchangeInfoPopover.value, () => { hoveredExchange.value = null; });
}

function cancelExchangeHoverKeepPopover() {
  cancelDelayedHide();
  if (exchangeHoverTimeout.value) { clearTimeout(exchangeHoverTimeout.value); exchangeHoverTimeout.value = null; }
}

// --- Currency info popover ---
function startCurrencyHover(event: MouseEvent, currency: string) {
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  cancelDelayedHide();
  if (currencyHoverTimeout.value) clearTimeout(currencyHoverTimeout.value);
  currencyHoverTimeout.value = setTimeout(() => {
    closeAllPopovers();
    hoveredCurrency.value = currency;
    showAtTarget(currencyInfoPopover.value, target);
  }, 400);
}

function cancelCurrencyHover() {
  if (currencyHoverTimeout.value) { clearTimeout(currencyHoverTimeout.value); currencyHoverTimeout.value = null; }
  delayedHide(currencyInfoPopover.value, () => { hoveredCurrency.value = null; });
}

function cancelCurrencyHoverKeepPopover() {
  cancelDelayedHide();
  if (currencyHoverTimeout.value) { clearTimeout(currencyHoverTimeout.value); currencyHoverTimeout.value = null; }
}

// --- Open Profit popover ---
const hoveredOpenProfitBotId = ref<string | null>(null);
const openProfitPopover = ref<InstanceType<typeof Popover>>();
const openProfitHoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

function startOpenProfitHover(event: MouseEvent, botId: string) {
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  cancelDelayedHide();
  // Reposition if switching between bots in same column
  if (hoveredOpenProfitBotId.value && hoveredOpenProfitBotId.value !== botId) {
    hoveredOpenProfitBotId.value = botId;
    openProfitPopover.value?.hide();
    showAtTarget(openProfitPopover.value, target);
    return;
  }
  if (openProfitHoverTimeout.value) clearTimeout(openProfitHoverTimeout.value);
  openProfitHoverTimeout.value = setTimeout(() => {
    closeAllPopovers();
    hoveredOpenProfitBotId.value = botId;
    showAtTarget(openProfitPopover.value, target);
  }, 400);
}

function cancelOpenProfitHover() {
  if (openProfitHoverTimeout.value) { clearTimeout(openProfitHoverTimeout.value); openProfitHoverTimeout.value = null; }
  delayedHide(openProfitPopover.value, () => { hoveredOpenProfitBotId.value = null; });
}

function cancelOpenProfitHoverKeepPopover() {
  cancelDelayedHide();
  if (openProfitHoverTimeout.value) { clearTimeout(openProfitHoverTimeout.value); openProfitHoverTimeout.value = null; }
}

// --- Closed Profit popover ---
const hoveredClosedProfitBotId = ref<string | null>(null);
const closedProfitPopover = ref<InstanceType<typeof Popover>>();
const closedProfitHoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

function startClosedProfitHover(event: MouseEvent, botId: string) {
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  cancelDelayedHide();
  // Reposition if switching between bots in same column
  if (hoveredClosedProfitBotId.value && hoveredClosedProfitBotId.value !== botId) {
    hoveredClosedProfitBotId.value = botId;
    closedProfitPopover.value?.hide();
    showAtTarget(closedProfitPopover.value, target);
    return;
  }
  if (closedProfitHoverTimeout.value) clearTimeout(closedProfitHoverTimeout.value);
  closedProfitHoverTimeout.value = setTimeout(() => {
    closeAllPopovers();
    hoveredClosedProfitBotId.value = botId;
    showAtTarget(closedProfitPopover.value, target);
  }, 400);
}

function cancelClosedProfitHover() {
  if (closedProfitHoverTimeout.value) { clearTimeout(closedProfitHoverTimeout.value); closedProfitHoverTimeout.value = null; }
  delayedHide(closedProfitPopover.value, () => { hoveredClosedProfitBotId.value = null; });
}

function cancelClosedProfitHoverKeepPopover() {
  cancelDelayedHide();
  if (closedProfitHoverTimeout.value) { clearTimeout(closedProfitHoverTimeout.value); closedProfitHoverTimeout.value = null; }
}

// --- Trades popover ---
const hoveredTradesBotId = ref<string | null>(null);
const tradesPopover = ref<InstanceType<typeof Popover>>();
const tradesHoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

function startTradesHover(event: MouseEvent, botId: string) {
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  cancelDelayedHide();
  // Reposition if switching between bots in same column
  if (hoveredTradesBotId.value && hoveredTradesBotId.value !== botId) {
    hoveredTradesBotId.value = botId;
    tradesPopover.value?.hide();
    showAtTarget(tradesPopover.value, target);
    return;
  }
  if (tradesHoverTimeout.value) clearTimeout(tradesHoverTimeout.value);
  tradesHoverTimeout.value = setTimeout(() => {
    closeAllPopovers();
    hoveredTradesBotId.value = botId;
    showAtTarget(tradesPopover.value, target);
  }, 400);
}

function cancelTradesHover() {
  if (tradesHoverTimeout.value) { clearTimeout(tradesHoverTimeout.value); tradesHoverTimeout.value = null; }
  delayedHide(tradesPopover.value, () => { hoveredTradesBotId.value = null; });
}

function cancelTradesHoverKeepPopover() {
  cancelDelayedHide();
  if (tradesHoverTimeout.value) { clearTimeout(tradesHoverTimeout.value); tradesHoverTimeout.value = null; }
}

// --- Win/Loss popover ---
const hoveredWinLossBotId = ref<string | null>(null);
const winLossPopover = ref<InstanceType<typeof Popover>>();
const winLossHoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

function startWinLossHover(event: MouseEvent, botId: string) {
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  cancelDelayedHide();
  // Reposition if switching between bots in same column
  if (hoveredWinLossBotId.value && hoveredWinLossBotId.value !== botId) {
    hoveredWinLossBotId.value = botId;
    winLossPopover.value?.hide();
    showAtTarget(winLossPopover.value, target);
    return;
  }
  if (winLossHoverTimeout.value) clearTimeout(winLossHoverTimeout.value);
  winLossHoverTimeout.value = setTimeout(() => {
    closeAllPopovers();
    hoveredWinLossBotId.value = botId;
    showAtTarget(winLossPopover.value, target);
  }, 400);
}

function cancelWinLossHover() {
  if (winLossHoverTimeout.value) { clearTimeout(winLossHoverTimeout.value); winLossHoverTimeout.value = null; }
  delayedHide(winLossPopover.value, () => { hoveredWinLossBotId.value = null; });
}

function cancelWinLossHoverKeepPopover() {
  cancelDelayedHide();
  if (winLossHoverTimeout.value) { clearTimeout(winLossHoverTimeout.value); winLossHoverTimeout.value = null; }
}

// --- Balance popover ---
const hoveredBalanceBotId = ref<string | null>(null);
const balancePopover = ref<InstanceType<typeof Popover>>();
const balanceHoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

function startBalanceHover(event: MouseEvent, botId: string) {
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  cancelDelayedHide();
  // Reposition if switching between bots in same column
  if (hoveredBalanceBotId.value && hoveredBalanceBotId.value !== botId) {
    hoveredBalanceBotId.value = botId;
    balancePopover.value?.hide();
    showAtTarget(balancePopover.value, target);
    return;
  }
  if (balanceHoverTimeout.value) clearTimeout(balanceHoverTimeout.value);
  balanceHoverTimeout.value = setTimeout(() => {
    closeAllPopovers();
    hoveredBalanceBotId.value = botId;
    showAtTarget(balancePopover.value, target);
  }, 400);
}

function cancelBalanceHover() {
  if (balanceHoverTimeout.value) { clearTimeout(balanceHoverTimeout.value); balanceHoverTimeout.value = null; }
  delayedHide(balancePopover.value, () => { hoveredBalanceBotId.value = null; });
}

function cancelBalanceHoverKeepPopover() {
  cancelDelayedHide();
  if (balanceHoverTimeout.value) { clearTimeout(balanceHoverTimeout.value); balanceHoverTimeout.value = null; }
}

// --- Period Profit popover (shared for weekly and monthly) ---
const hoveredPeriodProfitBotId = ref<string | null>(null);
const periodProfitPopover = ref<InstanceType<typeof Popover>>();
const periodProfitHoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

function startPeriodProfitHover(event: MouseEvent, botId: string) {
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  cancelDelayedHide();
  // Reposition if switching between bots in same column
  if (hoveredPeriodProfitBotId.value && hoveredPeriodProfitBotId.value !== botId) {
    hoveredPeriodProfitBotId.value = botId;
    periodProfitPopover.value?.hide();
    showAtTarget(periodProfitPopover.value, target);
    return;
  }
  if (periodProfitHoverTimeout.value) clearTimeout(periodProfitHoverTimeout.value);
  periodProfitHoverTimeout.value = setTimeout(() => {
    closeAllPopovers();
    hoveredPeriodProfitBotId.value = botId;
    showAtTarget(periodProfitPopover.value, target);
  }, 400);
}

function cancelPeriodProfitHover() {
  if (periodProfitHoverTimeout.value) { clearTimeout(periodProfitHoverTimeout.value); periodProfitHoverTimeout.value = null; }
  delayedHide(periodProfitPopover.value, () => { hoveredPeriodProfitBotId.value = null; });
}

function cancelPeriodProfitHoverKeepPopover() {
  cancelDelayedHide();
  if (periodProfitHoverTimeout.value) { clearTimeout(periodProfitHoverTimeout.value); periodProfitHoverTimeout.value = null; }
}

// --- Summary Open Profit popover ---
const summaryOpenPopover = ref<InstanceType<typeof Popover>>();
const summaryOpenHoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const summaryOpenVisible = ref(false);

function startSummaryOpenHover(event: MouseEvent) {
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  cancelDelayedHide();
  if (summaryOpenHoverTimeout.value) clearTimeout(summaryOpenHoverTimeout.value);
  summaryOpenHoverTimeout.value = setTimeout(() => {
    closeAllPopovers();
    summaryOpenVisible.value = true;
    showAtTarget(summaryOpenPopover.value, target);
  }, 400);
}

function cancelSummaryOpenHover() {
  if (summaryOpenHoverTimeout.value) { clearTimeout(summaryOpenHoverTimeout.value); summaryOpenHoverTimeout.value = null; }
  delayedHide(summaryOpenPopover.value, () => { summaryOpenVisible.value = false; });
}

function cancelSummaryOpenHoverKeepPopover() {
  cancelDelayedHide();
  if (summaryOpenHoverTimeout.value) { clearTimeout(summaryOpenHoverTimeout.value); summaryOpenHoverTimeout.value = null; }
}

// --- Summary Closed Profit popover ---
const summaryClosedPopover = ref<InstanceType<typeof Popover>>();
const summaryClosedHoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const summaryClosedVisible = ref(false);

function startSummaryClosedHover(event: MouseEvent) {
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  cancelDelayedHide();
  if (summaryClosedHoverTimeout.value) clearTimeout(summaryClosedHoverTimeout.value);
  summaryClosedHoverTimeout.value = setTimeout(() => {
    closeAllPopovers();
    summaryClosedVisible.value = true;
    showAtTarget(summaryClosedPopover.value, target);
  }, 400);
}

function cancelSummaryClosedHover() {
  if (summaryClosedHoverTimeout.value) { clearTimeout(summaryClosedHoverTimeout.value); summaryClosedHoverTimeout.value = null; }
  delayedHide(summaryClosedPopover.value, () => { summaryClosedVisible.value = false; });
}

function cancelSummaryClosedHoverKeepPopover() {
  cancelDelayedHide();
  if (summaryClosedHoverTimeout.value) { clearTimeout(summaryClosedHoverTimeout.value); summaryClosedHoverTimeout.value = null; }
}

// --- Summary Trades popover ---
const summaryTradesPopover = ref<InstanceType<typeof Popover>>();
const summaryTradesHoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const summaryTradesVisible = ref(false);

function startSummaryTradesHover(event: MouseEvent) {
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  cancelDelayedHide();
  if (summaryTradesHoverTimeout.value) clearTimeout(summaryTradesHoverTimeout.value);
  summaryTradesHoverTimeout.value = setTimeout(() => {
    closeAllPopovers();
    summaryTradesVisible.value = true;
    showAtTarget(summaryTradesPopover.value, target);
  }, 400);
}

function cancelSummaryTradesHover() {
  if (summaryTradesHoverTimeout.value) { clearTimeout(summaryTradesHoverTimeout.value); summaryTradesHoverTimeout.value = null; }
  delayedHide(summaryTradesPopover.value, () => { summaryTradesVisible.value = false; });
}

function cancelSummaryTradesHoverKeepPopover() {
  cancelDelayedHide();
  if (summaryTradesHoverTimeout.value) { clearTimeout(summaryTradesHoverTimeout.value); summaryTradesHoverTimeout.value = null; }
}

// --- Summary Balance popover ---
const summaryBalancePopover = ref<InstanceType<typeof Popover>>();
const summaryBalanceHoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const summaryBalanceVisible = ref(false);

function startSummaryBalanceHover(event: MouseEvent) {
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  cancelDelayedHide();
  if (summaryBalanceHoverTimeout.value) clearTimeout(summaryBalanceHoverTimeout.value);
  summaryBalanceHoverTimeout.value = setTimeout(() => {
    closeAllPopovers();
    summaryBalanceVisible.value = true;
    showAtTarget(summaryBalancePopover.value, target);
  }, 400);
}

function cancelSummaryBalanceHover() {
  if (summaryBalanceHoverTimeout.value) { clearTimeout(summaryBalanceHoverTimeout.value); summaryBalanceHoverTimeout.value = null; }
  delayedHide(summaryBalancePopover.value, () => { summaryBalanceVisible.value = false; });
}

function cancelSummaryBalanceHoverKeepPopover() {
  cancelDelayedHide();
  if (summaryBalanceHoverTimeout.value) { clearTimeout(summaryBalanceHoverTimeout.value); summaryBalanceHoverTimeout.value = null; }
}

// --- Summary W/L popover ---
const summaryWinLossPopover = ref<InstanceType<typeof Popover>>();
const summaryWinLossHoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const summaryWinLossVisible = ref(false);

function startSummaryWinLossHover(event: MouseEvent) {
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  cancelDelayedHide();
  if (summaryWinLossHoverTimeout.value) clearTimeout(summaryWinLossHoverTimeout.value);
  summaryWinLossHoverTimeout.value = setTimeout(() => {
    closeAllPopovers();
    summaryWinLossVisible.value = true;
    showAtTarget(summaryWinLossPopover.value, target);
  }, 400);
}

function cancelSummaryWinLossHover() {
  if (summaryWinLossHoverTimeout.value) { clearTimeout(summaryWinLossHoverTimeout.value); summaryWinLossHoverTimeout.value = null; }
  delayedHide(summaryWinLossPopover.value, () => { summaryWinLossVisible.value = false; });
}

function cancelSummaryWinLossHoverKeepPopover() {
  cancelDelayedHide();
  if (summaryWinLossHoverTimeout.value) { clearTimeout(summaryWinLossHoverTimeout.value); summaryWinLossHoverTimeout.value = null; }
}

// --- Summary Period Profit popover (for monthly/yearly) ---
const summaryPeriodPopover = ref<InstanceType<typeof Popover>>();
const summaryPeriodHoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const summaryPeriodVisible = ref(false);
const summaryPeriodMode = ref<'monthly' | 'yearly'>('monthly');

function startSummaryPeriodHover(event: MouseEvent, mode: 'monthly' | 'yearly') {
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  cancelDelayedHide();
  if (summaryPeriodHoverTimeout.value) clearTimeout(summaryPeriodHoverTimeout.value);
  summaryPeriodHoverTimeout.value = setTimeout(() => {
    closeAllPopovers();
    summaryPeriodMode.value = mode;
    summaryPeriodVisible.value = true;
    showAtTarget(summaryPeriodPopover.value, target);
  }, 400);
}

function cancelSummaryPeriodHover() {
  if (summaryPeriodHoverTimeout.value) { clearTimeout(summaryPeriodHoverTimeout.value); summaryPeriodHoverTimeout.value = null; }
  delayedHide(summaryPeriodPopover.value, () => { summaryPeriodVisible.value = false; });
}

function cancelSummaryPeriodHoverKeepPopover() {
  cancelDelayedHide();
  if (summaryPeriodHoverTimeout.value) { clearTimeout(summaryPeriodHoverTimeout.value); summaryPeriodHoverTimeout.value = null; }
}

// --- Currency selector for Summary row ---
const defaultCurrency = computed(() => {
  const currencies: Record<string, number> = {};
  for (const state of Object.values(botStore.allBotState)) {
    const cur = (state as any)?.stake_currency;
    if (cur) currencies[cur] = (currencies[cur] || 0) + 1;
  }
  const sorted = Object.entries(currencies).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || 'USDC';
});
const selectedSummaryCurrency = computed({
  get: () => compStore.summaryCurrency === 'auto' ? defaultCurrency.value : compStore.summaryCurrency,
  set: (val: string) => compStore.setSummaryCurrency(val),
});

const summaryUniqueCurrencies = computed<string[]>(() => {
  const currencies = new Set<string>();
  for (const bot of botStore.selectedBots) {
    const cur = botStore.allBotState[bot.botId]?.stake_currency;
    if (cur) currencies.add(cur as string);
  }
  return Array.from(currencies);
});

// --- Group Open Profit popover ---
const groupOpenPopover = ref<InstanceType<typeof Popover>>();
const groupOpenHoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const groupOpenVisible = ref(false);
const groupOpenBotIds = ref<string[]>([]);

function startGroupOpenHover(event: MouseEvent, groupBotIds: string[]) {
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  cancelDelayedHide();
  if (groupOpenHoverTimeout.value) clearTimeout(groupOpenHoverTimeout.value);
  groupOpenHoverTimeout.value = setTimeout(() => {
    closeAllPopovers();
    groupOpenBotIds.value = groupBotIds;
    groupOpenVisible.value = true;
    showAtTarget(groupOpenPopover.value, target);
  }, 400);
}

function cancelGroupOpenHover() {
  if (groupOpenHoverTimeout.value) { clearTimeout(groupOpenHoverTimeout.value); groupOpenHoverTimeout.value = null; }
  delayedHide(groupOpenPopover.value, () => { groupOpenVisible.value = false; groupOpenBotIds.value = []; });
}

function cancelGroupOpenHoverKeepPopover() {
  cancelDelayedHide();
  if (groupOpenHoverTimeout.value) { clearTimeout(groupOpenHoverTimeout.value); groupOpenHoverTimeout.value = null; }
}

// --- Group Closed Profit popover ---
const groupClosedPopover = ref<InstanceType<typeof Popover>>();
const groupClosedHoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
const groupClosedVisible = ref(false);
const groupClosedBotIds = ref<string[]>([]);

function startGroupClosedHover(event: MouseEvent, groupBotIds: string[]) {
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  cancelDelayedHide();
  if (groupClosedHoverTimeout.value) clearTimeout(groupClosedHoverTimeout.value);
  groupClosedHoverTimeout.value = setTimeout(() => {
    closeAllPopovers();
    groupClosedBotIds.value = groupBotIds;
    groupClosedVisible.value = true;
    showAtTarget(groupClosedPopover.value, target);
  }, 400);
}

function cancelGroupClosedHover() {
  if (groupClosedHoverTimeout.value) { clearTimeout(groupClosedHoverTimeout.value); groupClosedHoverTimeout.value = null; }
  delayedHide(groupClosedPopover.value, () => { groupClosedVisible.value = false; groupClosedBotIds.value = []; });
}

function cancelGroupClosedHoverKeepPopover() {
  cancelDelayedHide();
  if (groupClosedHoverTimeout.value) { clearTimeout(groupClosedHoverTimeout.value); groupClosedHoverTimeout.value = null; }
}

// Helper to get bot IDs for a group
function getGroupBotIds(groupId: string | undefined): string[] {
  if (!groupId) return [];
  const group = botGroups.value.find(g => g.id === groupId);
  return group ? group.botIds : [];
}

function getRowClass(data: ComparisonTableItems) {
  if (data.isGroupRow) {
    const group = botGroups.value.find(g => g.id === data.groupId);
    if (group && group.botIds.every(id => !botStore.botStores[id]?.isSelected)) {
      return 'bot-row-unselected';
    }
    return 'bot-row-group';
  }
  if (data.botId && !botStore.botStores[data.botId]?.isSelected) {
    return 'bot-row-unselected';
  }
  return 'bot-row-selected';
}

const hoveredProfit = computed(() => {
  if (!hoveredBotId.value) return undefined;
  return botStore.allProfit[hoveredBotId.value];
});

const hoveredBotIsOffline = computed(() => {
  if (!hoveredBotId.value) return false;
  return botStore.botStores[hoveredBotId.value]?.isBotOnline === false;
});

const hoveredBotState = computed(() => {
  if (!hoveredBotId.value) return undefined;
  return botStore.allBotState[hoveredBotId.value];
});

const hoveredBotPort = computed(() => {
  if (!hoveredBotId.value) return undefined;
  const desc = botStore.availableBots[hoveredBotId.value];
  if (desc?.botUrl) {
    try {
      const p = new URL(desc.botUrl).port;
      if (p) return parseInt(p, 10);
    } catch {
      // ignore
    }
  }
  return undefined;
});

function formatBotStartDate(tsMs: number | undefined): string {
  if (!tsMs) return 'N/A';
  return timestampms(tsMs);
}

function getBotOnlineSince(botId: string): string {
  const profit = botStore.allProfit[botId];
  if (!profit?.bot_start_timestamp) return '';
  return humanizeDuration(profit.bot_start_timestamp);
}

function getBotStartDate(botId: string): string {
  const profit = botStore.allProfit[botId];
  if (!profit?.bot_start_timestamp) return '';
  return new Date(profit.bot_start_timestamp).toLocaleDateString();
}

// --- Column definitions ---
const allColumns: ColumnDefinition[] = [
  { id: 'botName', labelKey: 'botComparison.botName', icon: 'i-mdi-robot', default: true, removable: false },
  { id: 'status', labelKey: 'botComparison.statusLabel', icon: 'i-mdi-circle', default: false, removable: true },
  { id: 'exchange', labelKey: 'botComparison.exchange', icon: 'i-mdi-swap-horizontal', default: false, removable: true },
  { id: 'trades', labelKey: 'botComparison.trades', icon: 'i-mdi-chart-box', default: true, removable: true },
  { id: 'openProfit', labelKey: 'botComparison.openProfit', icon: 'i-mdi-trending-up', default: true, removable: true },
  { id: 'closedProfit', labelKey: 'botComparison.closedProfit', icon: 'i-mdi-cash-check', default: true, removable: true },
  { id: 'balance', labelKey: 'botComparison.balance', icon: 'i-mdi-wallet', default: true, removable: true },
  { id: 'winLoss', labelKey: 'botComparison.winLoss', icon: 'i-mdi-trophy', default: true, removable: true },
  { id: 'stakeAmount', labelKey: 'botComparison.stakeAmount', icon: 'i-mdi-cash', default: false, removable: true },
  { id: 'port', labelKey: 'botComparison.port', icon: 'i-mdi-lan', default: false, removable: true },
  { id: 'strategy', labelKey: 'botComparison.strategy', icon: 'i-mdi-cog', default: false, removable: true },
  {
    id: 'stakeCurrency',
    labelKey: 'botComparison.stakeCurrencyLabel', icon: 'i-mdi-currency-usd',
    default: false,
    removable: true,
  },
  {
    id: 'monthlyProfit',
    labelKey: 'botComparison.monthlyProfit', icon: 'i-mdi-calendar-month',
    default: false,
    removable: true,
  },
  {
    id: 'yearlyProfit',
    labelKey: 'botComparison.yearlyProfit', icon: 'i-mdi-calendar',
    default: false,
    removable: true,
  },
];

// Initialize columns in the store (merges new defaults, handles first load)
compStore.initColumns(
  allColumns.map((c) => c.id),
  allColumns.filter((c) => c.default).map((c) => c.id),
);

const visibleColumnIds = computed({
  get: () => compStore.visibleColumnIds,
  set: (val: string[]) => { compStore.visibleColumnIds = val; },
});

function isColumnVisible(id: string): boolean {
  return visibleColumnIds.value.includes(id);
}

function hideColumn(id: string) {
  const col = allColumns.find((c) => c.id === id);
  if (col && !col.removable) return;
  visibleColumnIds.value = visibleColumnIds.value.filter((c) => c !== id);
}

function toggleColumn(id: string) {
  if (visibleColumnIds.value.includes(id)) {
    hideColumn(id);
  } else {
    // Insert respecting the current columnOrder
    const ordered = columnOrder.value.filter(
      (cId) => visibleColumnIds.value.includes(cId) || cId === id,
    );
    visibleColumnIds.value = ordered;
  }
}

function resetColumns() {
  visibleColumnIds.value = allColumns.filter((c) => c.default).map((c) => c.id);
  columnOrder.value = allColumns.map((c) => c.id);
}

function showColumnPopover(event: MouseEvent) {
  columnPopover.value?.toggle(event);
}

// --- Bot tag visibility (from store) ---
const botTagVisibility = computed({
  get: () => compStore.botTagVisibility,
  set: (val: BotTagVisibility) => { compStore.botTagVisibility = val; },
});

// --- Custom Tags (from store) ---
const customTags = computed({
  get: () => compStore.customTags,
  set: (val: CustomTag[]) => { compStore.customTags = val; },
});
const botCustomTags = computed({
  get: () => compStore.botCustomTags,
  set: (val: Record<string, string[]>) => { compStore.botCustomTags = val; },
});

const tagPickerPopover = ref<InstanceType<typeof Popover>>();
const tagPickerBotId = ref<string | null>(null);
const newTagName = ref('');
const newTagColor = ref('#3b82f6');
const editingTagId = ref<string | null>(null);
const editTagName = ref('');
const editTagColor = ref('');

const tagColors = [
  '#3b82f6', '#22c55e', '#ef4444', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
  '#14b8a6', '#6366f1', '#84cc16', '#a855f7',
];

function getBotCustomTags(botId: string): string[] {
  return botCustomTags.value[botId] || [];
}

function getCustomTag(tagId: string): CustomTag | undefined {
  return customTags.value.find(t => t.id === tagId);
}

function toggleBotTag(botId: string, tagId: string) {
  if (!botCustomTags.value[botId]) botCustomTags.value[botId] = [];
  const idx = botCustomTags.value[botId].indexOf(tagId);
  if (idx >= 0) botCustomTags.value[botId].splice(idx, 1);
  else botCustomTags.value[botId].push(tagId);
}

function createCustomTag(name: string, color: string) {
  // Check if a tag with same name and color already exists
  const existing = customTags.value.find(
    t => t.name.toLowerCase() === name.toLowerCase() && t.color === color
  );
  const id = existing ? existing.id : `tag_${Date.now()}`;
  if (!existing) {
    customTags.value.push({ id, name, color });
  }
  // Auto-assign to current bot
  if (tagPickerBotId.value) {
    const botTags = getBotCustomTags(tagPickerBotId.value);
    if (!botTags.includes(id)) {
      toggleBotTag(tagPickerBotId.value, id);
    }
  }
  newTagName.value = '';
  newTagColor.value = '#3b82f6';
  return id;
}

function deleteCustomTag(tagId: string) {
  customTags.value = customTags.value.filter(t => t.id !== tagId);
  for (const botId of Object.keys(botCustomTags.value)) {
    botCustomTags.value[botId] = botCustomTags.value[botId].filter(id => id !== tagId);
  }
}

function startEditTag(tagId: string) {
  const tag = getCustomTag(tagId);
  if (!tag) return;
  editingTagId.value = tagId;
  editTagName.value = tag.name;
  editTagColor.value = tag.color;
}

function saveEditTag() {
  if (!editingTagId.value) return;
  const tag = customTags.value.find(t => t.id === editingTagId.value);
  if (tag) {
    tag.name = editTagName.value;
    tag.color = editTagColor.value;
  }
  editingTagId.value = null;
}

function cancelEditTag() {
  editingTagId.value = null;
}

function showTagPicker(event: MouseEvent, botId: string) {
  tagPickerBotId.value = botId;
  editingTagId.value = null;
  tagPickerPopover.value?.toggle(event);
}

function selectBotsByCustomTag(tagId: string) {
  for (const [botId, bot] of Object.entries(botStore.botStores)) {
    const botTags = botCustomTags.value[botId] || [];
    bot.isSelected = botTags.includes(tagId);
  }
}

function getCustomTagBotCount(tagId: string): number {
  let count = 0;
  for (const tags of Object.values(botCustomTags.value)) {
    if (tags.includes(tagId)) count++;
  }
  return count;
}

// --- Tag ordering (from store) ---
const ALL_TAG_IDS = ['status', 'tradingMode', 'exchange', 'stakeCurrency', 'port'] as const;

const tagLabels: Record<TagId, string> = {
  status: 'botComparison.tagStatus',
  tradingMode: 'botComparison.tagTradingMode',
  exchange: 'botComparison.tagExchange',
  stakeCurrency: 'botComparison.tagCurrency',
  port: 'botComparison.tagPort',
};

compStore.ensureTagOrder();

const tagOrder = computed({
  get: () => compStore.tagOrder,
  set: (val: TagId[]) => { compStore.tagOrder = val; },
});

const orderedVisibleTags = computed<TagId[]>(() => compStore.orderedVisibleTags);

let draggedTagId = '';

function onTagDragStart(event: DragEvent, tagId: string) {
  draggedTagId = tagId;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
}

function onTagDragOver(event: DragEvent) {
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function onTagDrop(_event: DragEvent, targetId: string) {
  if (!draggedTagId || draggedTagId === targetId) return;
  const order = [...tagOrder.value];
  const fromIdx = order.indexOf(draggedTagId as TagId);
  const toIdx = order.indexOf(targetId as TagId);
  if (fromIdx === -1 || toIdx === -1) return;
  order.splice(fromIdx, 1);
  order.splice(toIdx, 0, draggedTagId as TagId);
  tagOrder.value = order;
  draggedTagId = '';
}

// --- Sort state (from store) ---
const sortFields = [
  { id: 'custom', labelKey: 'botComparison.sortCustom' },
  { id: 'name', labelKey: 'botComparison.sortByName' },
  { id: 'startDate', labelKey: 'botComparison.sortByStartDate' },
  { id: 'profit', labelKey: 'botComparison.sortByProfit' },
  { id: 'balance', labelKey: 'botComparison.sortByBalance' },
  { id: 'currency', labelKey: 'botComparison.sortByCurrency' },
  { id: 'exchange', labelKey: 'botComparison.sortByExchange' },
  { id: 'status', labelKey: 'botComparison.sortByStatus' },
  { id: 'strategy', labelKey: 'botComparison.sortByStrategy' },
  { id: 'weekly', labelKey: 'botComparison.sortByWeekly' },
  { id: 'monthly', labelKey: 'botComparison.sortByMonthly' },
  { id: 'drawdown', labelKey: 'botComparison.sortByDrawdown' },
  { id: 'winrate', labelKey: 'botComparison.sortByWinrate' },
  { id: 'tradeCount', labelKey: 'botComparison.sortByTradeCount' },
  { id: 'openPositions', labelKey: 'botComparison.sortByOpenPositions' },
];

const activeSort = computed({
  get: () => compStore.activeSort,
  set: (val: ActiveSort | null) => { compStore.activeSort = val; },
});

function cycleSortField(fieldId: string) {
  if (fieldId === 'custom') {
    // Custom sort only toggles on/off (always 'asc' = use botOrder)
    if (activeSort.value?.field === 'custom') {
      activeSort.value = null;
    } else {
      activeSort.value = { field: 'custom', direction: 'asc' };
    }
    return;
  }
  if (!activeSort.value || activeSort.value.field !== fieldId) {
    activeSort.value = { field: fieldId, direction: 'asc' };
  } else if (activeSort.value.direction === 'asc') {
    activeSort.value = { field: fieldId, direction: 'desc' };
  } else {
    activeSort.value = null;
  }
}

function getSortDirection(fieldId: string): SortDirection | null {
  if (activeSort.value?.field === fieldId) return activeSort.value.direction;
  return null;
}

// --- Filter state (from store) ---
compStore.ensureFilterFields();

const botFilters = computed({
  get: () => compStore.botFilters,
  set: (val: BotFilters) => { compStore.botFilters = val; },
});

// Scan all bots to populate filter options
const allExchanges = computed(() => {
  const exchanges: Record<string, number> = {};
  Object.entries(botStore.allBotState).forEach(([, state]) => {
    const ex = state?.exchange?.toLowerCase() || '';
    if (ex) exchanges[ex] = (exchanges[ex] || 0) + 1;
  });
  return exchanges;
});

const allCurrencies = computed(() => {
  const currencies: Record<string, number> = {};
  Object.entries(botStore.allBotState).forEach(([, state]) => {
    const cur = state?.stake_currency || '';
    if (cur) currencies[cur] = (currencies[cur] || 0) + 1;
  });
  return currencies;
});

const allTradingModes = computed(() => {
  const modes: Record<string, number> = {};
  Object.entries(botStore.allBotState).forEach(([, state]) => {
    const mode = (state?.trading_mode as string)?.toLowerCase() || 'spot';
    modes[mode] = (modes[mode] || 0) + 1;
  });
  return modes;
});

// Ensure new exchanges/currencies/tradingModes default to true
watch(allTradingModes, (modes) => {
  for (const key of Object.keys(modes)) {
    if (botFilters.value.tradingMode[key] === undefined) {
      botFilters.value.tradingMode[key] = true;
    }
  }
}, { immediate: true });

watch(allExchanges, (ex) => {
  for (const key of Object.keys(ex)) {
    if (botFilters.value.exchanges[key] === undefined) {
      botFilters.value.exchanges[key] = true;
    }
  }
}, { immediate: true });

watch(allCurrencies, (cur) => {
  for (const key of Object.keys(cur)) {
    if (botFilters.value.currencies[key] === undefined) {
      botFilters.value.currencies[key] = true;
    }
  }
}, { immediate: true });

// Auto-add new custom tags to filters with default true
watch(customTags, (tags) => {
  for (const tag of tags) {
    if (botFilters.value.customTags[tag.id] === undefined) {
      botFilters.value.customTags[tag.id] = true;
    }
  }
  // Clean up deleted tags
  for (const id of Object.keys(botFilters.value.customTags)) {
    if (!tags.some(t => t.id === id)) {
      delete botFilters.value.customTags[id];
    }
  }
}, { immediate: true, deep: true });

// Status counts
const statusCounts = computed(() => {
  let live = 0, dry = 0, offline = 0;
  Object.entries(botStore.botStores).forEach(([, store]) => {
    if (!store.isBotOnline) offline++;
    else if (botStore.allBotState[store.botId]?.dry_run) dry++;
    else live++;
  });
  return { live, dry, offline };
});

function getBotStatus(botId: string): 'live' | 'dry' | 'offline' {
  const store = botStore.botStores[botId];
  if (!store?.isBotOnline) return 'offline';
  return botStore.allBotState[botId]?.dry_run ? 'dry' : 'live';
}

function isBotVisibleByFilter(botId: string): boolean {
  const status = getBotStatus(botId);
  if (!botFilters.value.status[status]) return false;
  const exchange = botStore.allBotState[botId]?.exchange?.toLowerCase() || '';
  if (exchange && botFilters.value.exchanges[exchange] === false) return false;
  const currency = botStore.allBotState[botId]?.stake_currency || '';
  if (currency && botFilters.value.currencies[currency] === false) return false;
  const tradingMode = ((botStore.allBotState[botId]?.trading_mode as string) || 'spot').toLowerCase();
  if (tradingMode && botFilters.value.tradingMode[tradingMode] === false) return false;
  // Custom tag filter: if any custom tag filter is unchecked, hide bots with that tag
  // A bot with no tags is visible unless all tags are unchecked
  const botTags = botCustomTags.value[botId] || [];
  const activeTagFilters = Object.entries(botFilters.value.customTags);
  const anyTagFilterDisabled = activeTagFilters.some(([, v]) => !v);
  if (anyTagFilterDisabled && botTags.length > 0) {
    // Bot must have at least one enabled tag to be visible
    const hasEnabledTag = botTags.some(tagId => botFilters.value.customTags[tagId] !== false);
    if (!hasEnabledTag) return false;
  }
  return true;
}

function isTagActive(tagType: string, value: string): boolean {
  if (tagType === 'stakeCurrency') {
    if (Object.values(botFilters.value.currencies).every(v => v)) return true;
    return botFilters.value.currencies[value] !== false;
  }
  if (tagType === 'exchange') {
    if (Object.values(botFilters.value.exchanges).every(v => v)) return true;
    return botFilters.value.exchanges[value.toLowerCase()] !== false;
  }
  if (tagType === 'status') {
    const allStatus = Object.values(botFilters.value.status).every(v => v);
    if (allStatus) return true;
    if (value === 'live') return botFilters.value.status.live;
    if (value === 'dry') return botFilters.value.status.dry;
    if (value === 'offline') return botFilters.value.status.offline;
  }
  if (tagType === 'tradingMode') {
    if (Object.values(botFilters.value.tradingMode).every(v => v)) return true;
    return botFilters.value.tradingMode[value.toLowerCase()] !== false;
  }
  return true;
}

const hiddenBotCount = computed(() => {
  let count = 0;
  Object.keys(botStore.botStores).forEach((botId) => {
    if (!isBotVisibleByFilter(botId)) count++;
  });
  return count;
});

function filterByTradingMode(mode: string) {
  for (const key of Object.keys(botFilters.value.tradingMode)) {
    botFilters.value.tradingMode[key] = (key.toLowerCase() === mode.toLowerCase());
  }
  closeAllPopovers();
}

function filterByCurrency(currency: string) {
  for (const key of Object.keys(botFilters.value.currencies)) {
    botFilters.value.currencies[key] = (key === currency);
  }
  closeAllPopovers();
}

function resetAllFilters() {
  botFilters.value.status = { live: true, dry: true, offline: true };
  for (const key of Object.keys(botFilters.value.exchanges)) {
    botFilters.value.exchanges[key] = true;
  }
  for (const key of Object.keys(botFilters.value.currencies)) {
    botFilters.value.currencies[key] = true;
  }
  for (const key of Object.keys(botFilters.value.tradingMode)) {
    botFilters.value.tradingMode[key] = true;
  }
  for (const key of Object.keys(botFilters.value.customTags)) {
    botFilters.value.customTags[key] = true;
  }
}

// Sync bot selection with filters: hidden bots are always deselected
// Also runs on initial load (immediate: true) to deselect bots hidden by persisted filters
function applyFilterSelection() {
  Object.keys(botStore.botStores).forEach((botId) => {
    if (!isBotVisibleByFilter(botId)) {
      botStore.botStores[botId].isSelected = false;
    }
  });
}
watch(botFilters, applyFilterSelection, { deep: true, immediate: true });

const sortPopover = ref<InstanceType<typeof Popover>>();
const filterPopover = ref<InstanceType<typeof Popover>>();

function showSortPopover(event: MouseEvent) {
  sortPopover.value?.toggle(event);
}

function showFilterPopover(event: MouseEvent) {
  filterPopover.value?.toggle(event);
}

// --- Alerts popover ---
const alertsPopover = ref<InstanceType<typeof Popover>>();
function showAlertsPopover(event: MouseEvent) {
  alertsPopover.value?.toggle(event);
}

// --- Groups popover ---
const groupsPopover = ref<InstanceType<typeof Popover>>();
function showGroupsPopover(event: MouseEvent) {
  groupsPopover.value?.toggle(event);
}

// --- CSV Export ---
function exportCSV() {
  const headers = visibleOrderedColumns.value.map((c) => t(c.labelKey));
  const rows = tableItems.value
    .filter((item) => item.botId && !item.isGroupRow)
    .map((item) => {
      return visibleOrderedColumns.value.map((col) => {
        switch (col.id) {
          case 'botName': return item.botName;
          case 'status': return item.isOnline ? 'Online' : 'Offline';
          case 'exchange': return item.exchange || '';
          case 'trades': return item.trades || '';
          case 'openProfit': return item.profitOpen?.toFixed(2) || '0';
          case 'closedProfit': return item.profitClosed?.toFixed(2) || '0';
          case 'balance': return item.balance?.toFixed(2) || '0';
          case 'winLoss': return `${item.wins}/${item.losses}`;
          case 'stakeAmount': return item.stakeAmount || '';
          case 'port': return item.port?.toString() || '';
          case 'strategy': return item.strategy || '';
          case 'stakeCurrency': return item.stakeCurrency || '';
          case 'monthlyProfit': return item.monthlyProfit?.toFixed(2) || '0';
          case 'yearlyProfit': return item.yearlyProfit?.toFixed(2) || '0';
          default: return '';
        }
      });
    });
  const summaryItem = tableItems.value.find((i) => !i.botId && !i.isGroupRow);
  if (summaryItem) {
    const summaryRow = visibleOrderedColumns.value.map((col) => {
      switch (col.id) {
        case 'botName': return 'Summary';
        case 'openProfit': return summaryItem.profitOpen?.toFixed(2) || '0';
        case 'closedProfit': return summaryItem.profitClosed?.toFixed(2) || '0';
        case 'balance': return summaryItem.balance?.toFixed(2) || '0';
        case 'winLoss': return `${summaryItem.wins}/${summaryItem.losses}`;
        case 'trades': return summaryItem.trades || '';
        case 'monthlyProfit': return summaryItem.monthlyProfit?.toFixed(2) || '0';
        case 'yearlyProfit': return summaryItem.yearlyProfit?.toFixed(2) || '0';
        default: return '';
      }
    });
    rows.push(summaryRow);
  }
  const escapeField = (f: string) => {
    if (f.includes(',') || f.includes('"') || f.includes('\n')) {
      return `"${f.replace(/"/g, '""')}"`;
    }
    return f;
  };
  const csv = [headers.map(escapeField).join(','), ...rows.map((r) => r.map(escapeField).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bot_comparison_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Keyboard shortcuts ---
function handleKeyboard(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.key === 'Escape') {
    closeAllPopovers();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
    e.preventDefault();
    const visibleBots = tableItems.value.filter((i) => i.botId && !i.isGroupRow);
    const allSelected = visibleBots.every((i) => botStore.botStores[i.botId!]?.isSelected);
    visibleBots.forEach((i) => {
      if (botStore.botStores[i.botId!]) {
        botStore.botStores[i.botId!].isSelected = !allSelected;
      }
    });
    return;
  }
  const num = parseInt(e.key);
  if (num >= 1 && num <= 9) {
    const visibleBots = tableItems.value.filter((i) => i.botId && !i.isGroupRow);
    if (num <= visibleBots.length) {
      const botId = visibleBots[num - 1].botId!;
      if (botStore.botStores[botId]) {
        botStore.botStores[botId].isSelected = !botStore.botStores[botId].isSelected;
      }
    }
    return;
  }
  if (e.key === 'f' || e.key === 'F') {
    filterPopover.value?.toggle({ currentTarget: document.body } as unknown as Event);
    return;
  }
  if (e.key === 's' || e.key === 'S') {
    sortPopover.value?.toggle({ currentTarget: document.body } as unknown as Event);
    return;
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeyboard);
});
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyboard);
});

defineExpose({ showColumnPopover, showSortPopover, showFilterPopover, showAlertsPopover, showGroupsPopover, exportCSV });

// --- Column ordering (from store) ---
const columnOrder = computed({
  get: () => compStore.columnOrder,
  set: (val: string[]) => { compStore.columnOrder = val; },
});

const orderedColumns = computed(() => {
  return columnOrder.value
    .map((id) => allColumns.find((c) => c.id === id))
    .filter((c): c is ColumnDefinition => c !== undefined);
});

const visibleOrderedColumns = computed(() => {
  return columnOrder.value
    .filter((id) => visibleColumnIds.value.includes(id))
    .map((id) => allColumns.find((c) => c.id === id))
    .filter((c): c is ColumnDefinition => c !== undefined);
});

let draggedColumnId = '';
const dragOverColumnId = ref<string | null>(null);

function onDragStart(event: DragEvent, colId: string) {
  draggedColumnId = colId;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
}

function onDragOver(event: DragEvent, colId: string) {
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
  if (draggedColumnId && colId !== draggedColumnId) {
    dragOverColumnId.value = colId;
  }
}

function onDragLeaveColumn() {
  dragOverColumnId.value = null;
}

function onDrop(_event: DragEvent, targetId: string) {
  dragOverColumnId.value = null;
  if (!draggedColumnId || draggedColumnId === targetId) return;
  const order = [...columnOrder.value];
  const fromIdx = order.indexOf(draggedColumnId);
  const toIdx = order.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  order.splice(fromIdx, 1);
  order.splice(toIdx, 0, draggedColumnId);
  columnOrder.value = order;
  draggedColumnId = '';
}

// --- Helpers ---
function humanizeDuration(timestampMs: number): string {
  if (!timestampMs) return '';
  const diffMs = Date.now() - timestampMs;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t('time.lessThanMinute');
  if (diffMin < 60) return t('time.minutes', diffMin);
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return t('time.hours', diffHours);
  const diffDays = Math.floor(diffHours / 24);
  return t('time.days', diffDays);
}

// Currency brand colors (bg, text)
const currencyStyles: Record<string, { bg: string; text: string }> = {
  // Stablecoins
  USDC: { bg: '#2775ca', text: '#fff' },
  USDT: { bg: '#009393', text: '#fff' },
  BUSD: { bg: '#f0b90b', text: '#000' },
  DAI: { bg: '#f5ac37', text: '#000' },
  TUSD: { bg: '#002868', text: '#fff' },
  FDUSD: { bg: '#20b26c', text: '#fff' },
  // Major tokens
  BTC: { bg: '#f7931a', text: '#fff' },
  ETH: { bg: '#627eea', text: '#fff' },
  SOL: { bg: '#9945ff', text: '#fff' },
  BNB: { bg: '#f0b90b', text: '#000' },
  XRP: { bg: '#23292f', text: '#fff' },
  ADA: { bg: '#0033ad', text: '#fff' },
  DOGE: { bg: '#c2a633', text: '#fff' },
  AVAX: { bg: '#e84142', text: '#fff' },
  DOT: { bg: '#e6007a', text: '#fff' },
  MATIC: { bg: '#8247e5', text: '#fff' },
  POL: { bg: '#8247e5', text: '#fff' },
  LINK: { bg: '#2a5ada', text: '#fff' },
  HYPE: { bg: '#0b0e17', text: '#00e87e' },
  NEAR: { bg: '#000', text: '#fff' },
  ATOM: { bg: '#2e3148', text: '#a7b4cd' },
  ARB: { bg: '#213147', text: '#28a0f0' },
  OP: { bg: '#ff0420', text: '#fff' },
  SUI: { bg: '#4da2ff', text: '#fff' },
  APT: { bg: '#000', text: '#06d6a0' },
  TRX: { bg: '#eb0029', text: '#fff' },
  EUR: { bg: '#003399', text: '#ffcc00' },
};

function getCurrencyStyle(currency: string): { background: string; color: string } | null {
  const style = currencyStyles[currency?.toUpperCase()];
  if (style) return { background: style.bg, color: style.text };
  return null;
}

// Exchange brand colors (bg, text)
const exchangeStyles: Record<string, { bg: string; text: string }> = {
  hyperliquid: { bg: '#0b0e17', text: '#00e87e' },
  binance: { bg: '#1e2026', text: '#f0b90b' },
  kraken: { bg: '#1b0d3e', text: '#7b61ff' },
  gateio: { bg: '#171a29', text: '#2ea8ff' },
  bybit: { bg: '#181c25', text: '#f7a600' },
  okx: { bg: '#121212', text: '#ffffff' },
  myokx: { bg: '#121212', text: '#ffffff' },
  bitget: { bg: '#1b1d28', text: '#00c9a7' },
  htx: { bg: '#1a1e2e', text: '#2b8af7' },
  kucoin: { bg: '#0b2e1e', text: '#23af5f' },
  bitmart: { bg: '#1a1f2e', text: '#00b8d9' },
  bingx: { bg: '#1c2030', text: '#2d8cf0' },
  bitvavo: { bg: '#0d1b2a', text: '#4d9de0' },
};

function getExchangeStyle(exchange: string): { background: string; color: string } {
  const style = exchangeStyles[exchange?.toLowerCase()];
  if (style) return { background: style.bg, color: style.text };
  return { background: 'var(--p-surface-700)', color: 'var(--p-surface-200)' };
}

function capitalizeExchange(exchange: string): string {
  if (!exchange) return '';
  return exchange.charAt(0).toUpperCase() + exchange.slice(1);
}

function calculatePeriodProfit(
  profitStats: import('@/types').ProfitStats | undefined,
  periodDays: number,
): { abs: number; ratio: number; compoundAbs?: number } | undefined {
  if (!profitStats) return undefined;
  const first = profitStats.first_trade_timestamp;
  const latest = profitStats.latest_trade_timestamp;
  if (!first || !latest) return undefined;
  const daysDiff = (latest - first) / (1000 * 60 * 60 * 24);
  if (daysDiff < 1) return undefined;
  const periods = daysDiff / periodDays;
  const abs = profitStats.profit_closed_coin / periods;
  // Use profit_closed_ratio (vs starting capital) per period
  const ratio = profitStats.profit_closed_ratio
    ? profitStats.profit_closed_ratio / periods
    : 0;

  // Compound projection (snowball effect for stake_amount: "unlimited")
  // If profit_closed_ratio is available, we can compute daily growth rate
  let compoundAbs: number | undefined;
  if (profitStats.profit_closed_ratio && profitStats.profit_closed_ratio > 0 && daysDiff > 0) {
    // capital_initial = profit / ratio
    const capitalInitial = profitStats.profit_closed_coin / profitStats.profit_closed_ratio;
    if (capitalInitial > 0) {
      const capitalFinal = capitalInitial + profitStats.profit_closed_coin;
      // Daily compound rate
      const dailyRate = Math.pow(capitalFinal / capitalInitial, 1 / daysDiff) - 1;
      // Projected compound profit over periodDays
      compoundAbs = capitalInitial * (Math.pow(1 + dailyRate, periodDays) - 1);
    }
  }

  return { abs, ratio, compoundAbs };
}

function calculateWeeklyProfit(
  profitStats: import('@/types').ProfitStats | undefined,
): number | undefined {
  return calculatePeriodProfit(profitStats, 7)?.abs;
}

function calculateMonthlyProfit(
  profitStats: import('@/types').ProfitStats | undefined,
): number | undefined {
  return calculatePeriodProfit(profitStats, 30)?.abs;
}

function calculateWeeklyProfitData(
  profitStats: import('@/types').ProfitStats | undefined,
) {
  return calculatePeriodProfit(profitStats, 7);
}

function calculateMonthlyProfitData(
  profitStats: import('@/types').ProfitStats | undefined,
) {
  return calculatePeriodProfit(profitStats, 30);
}

function parseTradesPercent(trades: string): number {
  const parts = trades.split('/').map((s) => s.trim());
  const open = parseInt(parts[0], 10);
  const max = parseInt(parts[1], 10);
  if (isNaN(open) || isNaN(max) || max <= 0) return 0;
  return Math.min((open / max) * 100, 100);
}

const allToggled = computed<boolean>({
  get: () => {
    // Only check visible (non-filtered) bots
    return Object.entries(botStore.botStores).every(([id, bot]) => {
      if (!isBotVisibleByFilter(id)) return true; // Skip hidden bots
      return bot.isSelected;
    });
  },
  set: (val) => {
    for (const [id, bot] of Object.entries(botStore.botStores)) {
      if (isBotVisibleByFilter(id)) {
        bot.isSelected = val;
      }
      // Hidden bots stay deselected
    }
  },
});

// --- Inline bot rename ---
const editingBotId = ref<string | null>(null);
const editingName = ref('');

function startRename(botId: string, currentName: string) {
  editingBotId.value = botId;
  editingName.value = currentName;
}

function saveRename() {
  if (editingBotId.value && editingName.value.trim()) {
    botStore.updateBot(editingBotId.value, { botName: editingName.value.trim() });
  }
  editingBotId.value = null;
}

function cancelRename() {
  editingBotId.value = null;
}

// --- Group toggle (only toggles bots within this group) ---
function isGroupAllSelected(groupId: string): boolean {
  const group = botGroups.value.find(g => g.id === groupId);
  if (!group) return false;
  return group.botIds.every(id => botStore.botStores[id]?.isSelected);
}

function toggleGroup(groupId: string) {
  const group = botGroups.value.find(g => g.id === groupId);
  if (!group) return;
  const allSelected = group.botIds.every(id => botStore.botStores[id]?.isSelected);
  group.botIds.forEach(id => {
    if (botStore.botStores[id]) {
      botStore.botStores[id].isSelected = !allSelected;
    }
  });
}

// --- Inline group rename ---
const editingGroupId = ref<string | null>(null);
const editingGroupName = ref('');

function startGroupRename(groupId: string, currentName: string) {
  editingGroupId.value = groupId;
  editingGroupName.value = currentName;
}

function saveGroupRename() {
  if (editingGroupId.value && editingGroupName.value.trim()) {
    const group = botGroups.value.find(g => g.id === editingGroupId.value);
    if (group) group.name = editingGroupName.value.trim();
  }
  editingGroupId.value = null;
}

function cancelGroupRename() {
  editingGroupId.value = null;
}

// --- Group icon picker ---
const groupIcons = [
  // Original
  '📁', '🤖', '📈', '📉', '💰', '⚡', '🔥', '🌙', '☀️', '🎯', '🛡️', '⚠️', '🟢', '🔴', '🔵', '⭐', '💎', '🦊', '🐂', '🐻',
  // Crypto & trading
  '₿', '🪙', '💲', '🏦', '📊', '🎰', '🚀', '🌕', '💸', '🤑',
  // Crypto culture / memes
  '🐕', '🐸', '🦍', '🐳', '🦈', '🐋', '🌐', '⛓️', '🔗', '🗝️',
  // Directional / market
  '🎢', '🏆', '🥇', '🥈', '🥉', '💪', '🧠', '👑',
];
const iconPickerTarget = ref<{ type: 'group' | 'bot'; id: string } | null>(null);
const iconPickerPopover = ref<InstanceType<typeof Popover>>();

function showIconPicker(event: MouseEvent, groupId: string) {
  iconPickerTarget.value = { type: 'group', id: groupId };
  iconPickerPopover.value?.toggle(event);
}

function showBotIconPicker(event: MouseEvent, botId: string) {
  iconPickerTarget.value = { type: 'bot', id: botId };
  iconPickerPopover.value?.toggle(event);
}

function setIcon(icon: string) {
  const target = iconPickerTarget.value;
  if (!target) return;
  if (target.type === 'group') {
    const group = botGroups.value.find(g => g.id === target.id);
    if (group) group.icon = icon;
  } else {
    botStore.updateBot(target.id, { botIcon: icon });
  }
  iconPickerPopover.value?.hide();
  iconPickerTarget.value = null;
}

function clearIcon() {
  const target = iconPickerTarget.value;
  if (!target) return;
  if (target.type === 'bot') {
    botStore.updateBot(target.id, { botIcon: '' });
  } else {
    const group = botGroups.value.find(g => g.id === target.id);
    if (group) group.icon = '📁';
  }
  iconPickerPopover.value?.hide();
  iconPickerTarget.value = null;
}

// --- Inline group creation from header ---
function createGroupInline() {
  const id = `group_${Date.now()}`;
  const name = `Group ${botGroups.value.length + 1}`;
  botGroups.value.push({
    id,
    name,
    icon: '📁',
    collapsed: false,
    botIds: [],
  });
  // Start rename immediately
  nextTick(() => startGroupRename(id, name));
}

// --- Group row edit popover ---
const groupEditPopover = ref<InstanceType<typeof Popover>>();
const groupEditTargetId = ref<string | null>(null);
const groupEditName = ref('');

function showGroupEditPopover(event: MouseEvent, groupId: string) {
  const group = botGroups.value.find(g => g.id === groupId);
  if (!group) return;
  groupEditTargetId.value = groupId;
  groupEditName.value = group.name;
  groupEditPopover.value?.toggle(event);
}

function saveGroupEditName() {
  if (groupEditTargetId.value && groupEditName.value.trim()) {
    const group = botGroups.value.find(g => g.id === groupEditTargetId.value);
    if (group) group.name = groupEditName.value.trim();
  }
}

function removeGroupEditBot(botId: string) {
  if (!groupEditTargetId.value) return;
  const group = botGroups.value.find(g => g.id === groupEditTargetId.value);
  if (group) {
    group.botIds = group.botIds.filter(id => id !== botId);
  }
}

function addGroupEditBot(botId: string) {
  if (!groupEditTargetId.value || !botId) return;
  // Remove from any other group first
  for (const g of botGroups.value) {
    g.botIds = g.botIds.filter(id => id !== botId);
  }
  const group = botGroups.value.find(g => g.id === groupEditTargetId.value);
  if (group && !group.botIds.includes(botId)) {
    group.botIds.push(botId);
  }
}

function getBotGroupName(botId: string): string | null {
  for (const g of botGroups.value) {
    if (g.botIds.includes(botId)) return g.name;
  }
  return null;
}

// --- Group drag & drop reorder ---
let draggedGroupId = '';

function onGroupDragStart(event: DragEvent, groupId: string) {
  draggedGroupId = groupId;
  draggedRowBotId = ''; // Clear any bot drag
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
}

function onGroupDrop(targetGroupId: string) {
  if (!draggedGroupId || draggedGroupId === targetGroupId) return;
  const groups = [...botGroups.value];
  const fromIdx = groups.findIndex(g => g.id === draggedGroupId);
  const toIdx = groups.findIndex(g => g.id === targetGroupId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [moved] = groups.splice(fromIdx, 1);
  groups.splice(toIdx, 0, moved);
  botGroups.value = groups;
  draggedGroupId = '';
}

// --- Bot row reorder (from store) ---
const botOrder = computed({
  get: () => compStore.botOrder,
  set: (val: string[]) => { compStore.botOrder = val; },
});

let draggedRowBotId = '';

function onRowDragStart(event: DragEvent, botId: string) {
  draggedRowBotId = botId;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
}

function onRowDrop(targetId: string) {
  // Handle group reorder (group dropped on group)
  if (draggedGroupId && !draggedRowBotId) {
    onGroupDrop(targetId);
    return;
  }
  if (!draggedRowBotId || draggedRowBotId === targetId) return;
  // Check if target is a group row - add bot to that group
  const targetItem = tableItems.value.find(i =>
    i.isGroupRow && i.groupId === targetId
  );
  if (targetItem?.isGroupRow && draggedRowBotId) {
    const group = botGroups.value.find(g => g.id === targetId);
    if (group && !group.botIds.includes(draggedRowBotId)) {
      // Remove from other groups first
      botGroups.value.forEach(g => {
        g.botIds = g.botIds.filter(id => id !== draggedRowBotId);
      });
      group.botIds.push(draggedRowBotId);
    }
    draggedRowBotId = '';
    return;
  }
  // Normal bot reorder logic
  const currentIds = tableItems.value.filter(i => i.botId).map(i => i.botId!);
  const order = botOrder.value.length > 0 ? [...botOrder.value] : currentIds;
  // Ensure all bots are in the order
  for (const id of currentIds) {
    if (!order.includes(id)) order.push(id);
  }
  const fromIdx = order.indexOf(draggedRowBotId);
  const toIdx = order.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  order.splice(fromIdx, 1);
  order.splice(toIdx, 0, draggedRowBotId);
  botOrder.value = order;
  // Switch to custom sort, then check if the new order matches any sort criteria
  activeSort.value = { field: 'custom', direction: 'asc' };
  nextTick(() => {
    const matchedSort = detectMatchingSort(tableItems.value.filter(i => i.botId));
    if (matchedSort) {
      activeSort.value = matchedSort;
    }
  });
  draggedRowBotId = '';
}

// Move bot up/down in the order
function moveBotUp(botId: string) {
  const currentIds = tableItems.value.filter(i => i.botId && !i.isGroupRow).map(i => i.botId!);
  const order = botOrder.value.length > 0 ? [...botOrder.value] : currentIds;
  for (const id of currentIds) { if (!order.includes(id)) order.push(id); }
  const idx = order.indexOf(botId);
  if (idx <= 0) return;
  [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
  botOrder.value = order;
  activeSort.value = { field: 'custom', direction: 'asc' };
}

function moveBotDown(botId: string) {
  const currentIds = tableItems.value.filter(i => i.botId && !i.isGroupRow).map(i => i.botId!);
  const order = botOrder.value.length > 0 ? [...botOrder.value] : currentIds;
  for (const id of currentIds) { if (!order.includes(id)) order.push(id); }
  const idx = order.indexOf(botId);
  if (idx < 0 || idx >= order.length - 1) return;
  [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
  botOrder.value = order;
  activeSort.value = { field: 'custom', direction: 'asc' };
}

function moveGroupUp(groupId: string) {
  const idx = botGroups.value.findIndex(g => g.id === groupId);
  if (idx <= 0) return;
  const groups = [...botGroups.value];
  [groups[idx - 1], groups[idx]] = [groups[idx], groups[idx - 1]];
  botGroups.value = groups;
}

function moveGroupDown(groupId: string) {
  const idx = botGroups.value.findIndex(g => g.id === groupId);
  if (idx < 0 || idx >= botGroups.value.length - 1) return;
  const groups = [...botGroups.value];
  [groups[idx], groups[idx + 1]] = [groups[idx + 1], groups[idx]];
  botGroups.value = groups;
}

// Smart detection: check if current order matches any sort criteria
function comparatorForField(items: ComparisonTableItems[], field: string, direction: SortDirection): ComparisonTableItems[] {
  const dir = direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    if (!a.botId || !b.botId) return 0;
    let cmp = 0;
    switch (field) {
      case 'name':
        cmp = (a.botName || '').localeCompare(b.botName || '');
        break;
      case 'startDate': {
        const aTs = botStore.allProfit[a.botId]?.bot_start_timestamp ?? 0;
        const bTs = botStore.allProfit[b.botId]?.bot_start_timestamp ?? 0;
        cmp = aTs - bTs;
        break;
      }
      case 'profit':
        cmp = (a.profitClosed ?? 0) - (b.profitClosed ?? 0);
        break;
      case 'balance':
        cmp = (a.balance ?? 0) - (b.balance ?? 0);
        break;
      case 'currency':
        cmp = (a.stakeCurrency || '').localeCompare(b.stakeCurrency || '');
        break;
      case 'exchange':
        cmp = (a.exchange || '').localeCompare(b.exchange || '');
        break;
      case 'status': {
        const statusOrder = { live: 0, dry: 1, offline: 2 };
        const aStatus = a.botId ? getBotStatus(a.botId) : 'offline';
        const bStatus = b.botId ? getBotStatus(b.botId) : 'offline';
        cmp = statusOrder[aStatus] - statusOrder[bStatus];
        break;
      }
      case 'strategy':
        cmp = (a.strategy || '').localeCompare(b.strategy || '');
        break;
      case 'weekly':
        cmp = (a.weeklyProfit ?? 0) - (b.weeklyProfit ?? 0);
        break;
      case 'monthly':
        cmp = (a.monthlyProfit ?? 0) - (b.monthlyProfit ?? 0);
        break;
      case 'drawdown': {
        const aDD = botStore.allProfit[a.botId]?.max_drawdown ?? 0;
        const bDD = botStore.allProfit[b.botId]?.max_drawdown ?? 0;
        cmp = aDD - bDD;
        break;
      }
      case 'winrate': {
        const aTotal = (a.wins ?? 0) + (a.losses ?? 0);
        const bTotal = (b.wins ?? 0) + (b.losses ?? 0);
        const aWr = aTotal > 0 ? (a.wins ?? 0) / aTotal : 0;
        const bWr = bTotal > 0 ? (b.wins ?? 0) / bTotal : 0;
        cmp = aWr - bWr;
        break;
      }
      case 'tradeCount': {
        const aTotal = (a.wins ?? 0) + (a.losses ?? 0);
        const bTotal = (b.wins ?? 0) + (b.losses ?? 0);
        cmp = aTotal - bTotal;
        break;
      }
      case 'openPositions': {
        const parseOpen = (trades: string | undefined) => {
          if (!trades) return 0;
          const parts = trades.split('/').map((s) => s.trim());
          return parseInt(parts[0], 10) || 0;
        };
        cmp = parseOpen(a.trades) - parseOpen(b.trades);
        break;
      }
    }
    return cmp * dir;
  });
}

function detectMatchingSort(items: ComparisonTableItems[]): ActiveSort | null {
  for (const sortDef of sortFields) {
    if (sortDef.id === 'custom') continue;
    // Check ascending
    const ascSorted = comparatorForField(items, sortDef.id, 'asc');
    if (items.every((item, i) => item.botId === ascSorted[i].botId)) {
      return { field: sortDef.id, direction: 'asc' };
    }
    // Check descending
    const descSorted = comparatorForField(items, sortDef.id, 'desc');
    if (items.every((item, i) => item.botId === descSorted[i].botId)) {
      return { field: sortDef.id, direction: 'desc' };
    }
  }
  return null;
}

function onColumnReorder(event: { dragIndex: number; dropIndex: number }) {
  const cols = [...visibleOrderedColumns.value];
  const [moved] = cols.splice(event.dragIndex, 1);
  cols.splice(event.dropIndex, 0, moved);
  // Update columnOrder to reflect the new order
  const newOrder = cols.map(c => c.id);
  // Keep hidden columns in their relative positions
  const hidden = columnOrder.value.filter(id => !visibleColumnIds.value.includes(id));
  columnOrder.value = [...newOrder, ...hidden];
}

const tableItems = computed<ComparisonTableItems[]>(() => {
  const val: ComparisonTableItems[] = [];
  const summary: ComparisonTableItems = {
    botId: undefined,
    botName: 'Summary',
    profitClosed: 0,
    profitClosedRatio: undefined,
    profitOpen: 0,
    profitOpenRatio: undefined,
    stakeCurrency: 'USDT',
    wins: 0,
    losses: 0,
    balance: 0,
    balanceAppendix: '',
    summaryTradesCount: 0,
    summaryTradesMax: 0,
    monthlyProfit: 0,
    yearlyProfit: 0,
    perCurrencyBalances: {},
    perCurrencyProfitOpen: {},
    perCurrencyProfitClosed: {},
    perCurrencyMonthlyProfit: {},
    perCurrencyYearlyProfit: {},
    isMultiCurrency: false,
  };
  Object.entries(botStore.allProfit).forEach(([k, v]) => {
    const thisBotStore = botStore.botStores[k];
    if (!thisBotStore) return;

    const allOpenTrades = botStore.allOpenTrades[k];
    if (!allOpenTrades) return;
    const allStakes = allOpenTrades.reduce((a, b) => a + b.stake_amount, 0);
    const profitOpenRatio =
      allOpenTrades.reduce(
        (a, b) => a + (b.total_profit_ratio ?? b.profit_ratio ?? 0) * b.stake_amount,
        0,
      ) / allStakes;
    const profitOpen = allOpenTrades.reduce(
      (a, b) => a + (b.total_profit_abs ?? b.profit_abs ?? 0),
      0,
    );

    // Extract port from botUrl
    let port: number | undefined;
    const botDescriptor = botStore.availableBots[k];
    if (botDescriptor?.botUrl) {
      try {
        const urlPort = new URL(botDescriptor.botUrl).port;
        if (urlPort) port = parseInt(urlPort, 10);
      } catch {
        // ignore invalid URL
      }
    }

    val.push({
      botId: k,
      botName: thisBotStore.uiBotName || thisBotStore.botId,
      botIcon: thisBotStore.uiBotIcon || '',
      trades: `${botStore.allOpenTradeCount[k]} / ${
        (botStore.allBotState[k]?.max_open_trades ?? 0) > 0
          ? botStore.allBotState[k]?.max_open_trades
          : '∞'
      }`,
      profitClosed: v?.profit_closed_coin ?? 0,
      profitClosedRatio: v?.profit_closed_ratio || 0,
      capitalWithdrawal: v?.capital_withdrawal ?? 0,
      stakeCurrency: botStore.allBotState[k]?.stake_currency || '',
      profitOpenRatio,
      profitOpen,
      wins: v?.winning_trades ?? 0,
      losses: v?.losing_trades ?? 0,
      balance: botStore.allBalance[k]?.total_bot ?? botStore.allBalance[k]?.total ?? 0,
      stakeCurrencyDecimals: botStore.allBotState[k]?.stake_currency_decimals || 3,
      isDryRun: botStore.allBotState[k]?.dry_run,
      isOnline: botStore.botStores[k]?.isBotOnline,
      lastSeenOnline: botStore.botStores[k]?.lastSeenOnline ?? 0,
      exchange: botStore.allBotState[k]?.exchange || '',
      balanceAppendix: botStore.allBotState[k]?.dry_run ? '(dry)' : '',
      stakeAmount: botStore.allBotState[k]?.stake_amount || '',
      port,
      strategy: botStore.allBotState[k]?.strategy || '',
      tradingMode: (botStore.allBotState[k]?.trading_mode as string) || 'spot',
      yearlyProfit: calculatePeriodProfit(v, 365)?.abs,
      monthlyProfit: calculateMonthlyProfit(v),
    });
    if (v?.profit_closed_coin !== undefined) {
      if (thisBotStore.isSelected) {
        const cur = botStore.allBotState[k]?.stake_currency || 'USDT';
        summary.profitClosed += v.profit_closed_coin;
        summary.profitOpen += profitOpen;
        summary.wins += v.winning_trades;
        summary.losses += v.losing_trades;

        // Trades count
        const openCount = botStore.allOpenTradeCount[k] ?? 0;
        const maxTrades = (botStore.allBotState[k]?.max_open_trades as number) ?? 0;
        summary.summaryTradesCount! += openCount;
        if (maxTrades > 0) {
          summary.summaryTradesMax! += maxTrades;
        }

        // Monthly profit
        const mp = calculateMonthlyProfit(v);
        if (mp !== undefined) {
          summary.monthlyProfit = (summary.monthlyProfit ?? 0) + mp;
          summary.perCurrencyMonthlyProfit![cur] = (summary.perCurrencyMonthlyProfit![cur] ?? 0) + mp;
        }

        // Yearly profit
        const yp = calculatePeriodProfit(v, 365)?.abs;
        if (yp !== undefined) {
          summary.yearlyProfit = (summary.yearlyProfit ?? 0) + yp;
          summary.perCurrencyYearlyProfit![cur] = (summary.perCurrencyYearlyProfit![cur] ?? 0) + yp;
        }

        // Per-currency profit tracking
        summary.perCurrencyProfitOpen![cur] = (summary.perCurrencyProfitOpen![cur] ?? 0) + profitOpen;
        summary.perCurrencyProfitClosed![cur] = (summary.perCurrencyProfitClosed![cur] ?? 0) + v.profit_closed_coin;

        // Balance (always accumulate per-currency)
        const botBal = botStore.allBalance[k]?.total_bot ?? botStore.allBalance[k]?.total ?? 0;
        summary.perCurrencyBalances![cur] = (summary.perCurrencyBalances![cur] ?? 0) + botBal;

        if (botStore.allSelectedBotsSameStake) {
          summary.balance += botBal;
          summary.stakeCurrencyDecimals = botStore.allBotState[k]?.stake_currency_decimals || 3;
          if (botStore.allSelectedBotsSameState) {
            summary.balanceAppendix = botStore.allBotState[k]?.dry_run ? '(dry)' : '(live)';
          } else {
            summary.balanceAppendix = '(mixed dry and live)';
          }
        }
        summary.stakeCurrency = cur;
      }
    }
  });
  // Finalize summary row data
  summary.trades = `${summary.summaryTradesCount} positions`;
  const currencyKeys = Object.keys(summary.perCurrencyBalances ?? {});
  summary.isMultiCurrency = currencyKeys.length > 1;
  if (summary.isMultiCurrency) {
    // Multi-currency: sum balance per currency for display
    summary.balance = 0; // cannot sum different currencies
  }

  // Exchange rate conversion for summary row
  if (selectedSummaryCurrency.value && selectedSummaryCurrency.value !== 'auto' && hasRates.value) {
    const target = selectedSummaryCurrency.value;
    let totalProfitClosed = 0;
    let totalProfitOpen = 0;
    let totalBalance = 0;
    let totalMonthly = 0;
    let totalYearly = 0;
    let allConverted = true;

    for (const item of val) {
      if (!item.botId) continue;
      // Only include selected bots in summary
      const thisBotStore = botStore.botStores[item.botId];
      if (!thisBotStore?.isSelected) continue;

      const from = item.stakeCurrency;
      const convClosed = convert(item.profitClosed ?? 0, from, target);
      const convOpen = convert(item.profitOpen ?? 0, from, target);
      const convBalance = convert(item.balance ?? 0, from, target);
      const convMonthly = item.monthlyProfit !== undefined ? convert(item.monthlyProfit, from, target) : 0;
      const convYearly = item.yearlyProfit !== undefined ? convert(item.yearlyProfit, from, target) : 0;

      if (convClosed !== null) totalProfitClosed += convClosed; else allConverted = false;
      if (convOpen !== null) totalProfitOpen += convOpen; else allConverted = false;
      if (convBalance !== null) totalBalance += convBalance; else allConverted = false;
      if (convMonthly !== null) totalMonthly += convMonthly; else allConverted = false;
      if (convYearly !== null) totalYearly += convYearly; else allConverted = false;
    }

    if (allConverted) {
      summary.profitClosed = totalProfitClosed;
      summary.profitOpen = totalProfitOpen;
      summary.balance = totalBalance;
      summary.monthlyProfit = totalMonthly;
      summary.yearlyProfit = totalYearly;
      summary.stakeCurrency = target;
      summary.isMultiCurrency = false;
      summary.isConverted = true;
    }
  }

  // Apply filters - remove hidden bots
  const filtered = val.filter((item) => {
    if (!item.botId) return true;
    return isBotVisibleByFilter(item.botId);
  });

  // Sort bot rows based on active sort or custom order
  if (activeSort.value) {
    const dir = activeSort.value.direction === 'asc' ? 1 : -1;
    const field = activeSort.value.field;
    filtered.sort((a, b) => {
      if (!a.botId || !b.botId) return 0;
      let cmp = 0;
      switch (field) {
        case 'custom': {
          const aIdx = a.botId ? botOrder.value.indexOf(a.botId) : -1;
          const bIdx = b.botId ? botOrder.value.indexOf(b.botId) : -1;
          cmp = (aIdx === -1 ? 9999 : aIdx) - (bIdx === -1 ? 9999 : bIdx);
          break;
        }
        case 'name':
          cmp = (a.botName || '').localeCompare(b.botName || '');
          break;
        case 'startDate': {
          const aTs = botStore.allProfit[a.botId]?.bot_start_timestamp ?? 0;
          const bTs = botStore.allProfit[b.botId]?.bot_start_timestamp ?? 0;
          cmp = aTs - bTs;
          break;
        }
        case 'profit':
          cmp = (a.profitClosed ?? 0) - (b.profitClosed ?? 0);
          break;
        case 'balance':
          cmp = (a.balance ?? 0) - (b.balance ?? 0);
          break;
        case 'currency':
          cmp = (a.stakeCurrency || '').localeCompare(b.stakeCurrency || '');
          break;
        case 'exchange':
          cmp = (a.exchange || '').localeCompare(b.exchange || '');
          break;
        case 'status': {
          const statusOrder = { live: 0, dry: 1, offline: 2 };
          const aStatus = a.botId ? getBotStatus(a.botId) : 'offline';
          const bStatus = b.botId ? getBotStatus(b.botId) : 'offline';
          cmp = statusOrder[aStatus] - statusOrder[bStatus];
          break;
        }
        case 'strategy':
          cmp = (a.strategy || '').localeCompare(b.strategy || '');
          break;
        case 'weekly':
          cmp = (a.weeklyProfit ?? 0) - (b.weeklyProfit ?? 0);
          break;
        case 'monthly':
          cmp = (a.monthlyProfit ?? 0) - (b.monthlyProfit ?? 0);
          break;
        case 'drawdown': {
          const aDD = botStore.allProfit[a.botId]?.max_drawdown ?? 0;
          const bDD = botStore.allProfit[b.botId]?.max_drawdown ?? 0;
          cmp = aDD - bDD;
          break;
        }
        case 'winrate': {
          const aTotal = (a.wins ?? 0) + (a.losses ?? 0);
          const bTotal = (b.wins ?? 0) + (b.losses ?? 0);
          const aWr = aTotal > 0 ? (a.wins ?? 0) / aTotal : 0;
          const bWr = bTotal > 0 ? (b.wins ?? 0) / bTotal : 0;
          cmp = aWr - bWr;
          break;
        }
        case 'tradeCount': {
          const aTotal = (a.wins ?? 0) + (a.losses ?? 0);
          const bTotal = (b.wins ?? 0) + (b.losses ?? 0);
          cmp = aTotal - bTotal;
          break;
        }
        case 'openPositions': {
          const parseOpen = (trades: string | undefined) => {
            if (!trades) return 0;
            const parts = trades.split('/').map((s) => s.trim());
            return parseInt(parts[0], 10) || 0;
          };
          cmp = parseOpen(a.trades) - parseOpen(b.trades);
          break;
        }
      }
      return cmp * dir;
    });
  } else if (botOrder.value.length > 0) {
    filtered.sort((a, b) => {
      const aIdx = a.botId ? botOrder.value.indexOf(a.botId) : -1;
      const bIdx = b.botId ? botOrder.value.indexOf(b.botId) : -1;
      const aPos = aIdx === -1 ? 9999 : aIdx;
      const bPos = bIdx === -1 ? 9999 : bIdx;
      return aPos - bPos;
    });
  }
  // --- Bot Groups: organize by groups ---
  const groupedResult: ComparisonTableItems[] = [];

  // Ungrouped bots first
  const groupedBotIds = new Set(botGroups.value.flatMap((g) => g.botIds));
  const ungrouped = filtered.filter((item) => item.botId && !groupedBotIds.has(item.botId));
  groupedResult.push(...ungrouped);

  // Then each group
  for (const group of botGroups.value) {
    const memberItems = filtered.filter((item) => item.botId && group.botIds.includes(item.botId));
    // Hide groups whose bots are all filtered out, but show truly empty groups
    if (group.botIds.length > 0 && memberItems.length === 0) continue;
    // Group header row
    const groupSummary: ComparisonTableItems = {
      botId: undefined,
      botName: group.name,
      profitClosed: memberItems.reduce((s, i) => s + (i.profitClosed ?? 0), 0),
      profitOpen: memberItems.reduce((s, i) => s + (i.profitOpen ?? 0), 0),
      profitOpenRatio: undefined,
      profitClosedRatio: undefined,
      stakeCurrency: memberItems[0]?.stakeCurrency || summary.stakeCurrency || '',
      wins: memberItems.reduce((s, i) => s + (i.wins ?? 0), 0),
      losses: memberItems.reduce((s, i) => s + (i.losses ?? 0), 0),
      balance: memberItems.reduce((s, i) => s + (i.balance ?? 0), 0),
      balanceAppendix: '',
      isGroupRow: true,
      groupId: group.id,
      groupIcon: group.icon,
      groupCollapsed: group.collapsed,
      groupBotCount: memberItems.length,
    };
    groupedResult.push(groupSummary);
    if (!group.collapsed) {
      groupedResult.push(...memberItems);
    }
  }

  groupedResult.push(summary);
  return groupedResult;
});

// ===== Feature 1: Sparklines =====
function getSparklineData(botId: string): number[] {
  const trades = botStore.botStores[botId]?.trades || [];
  if (trades.length === 0) return [];
  const now = Date.now();
  const days = 7;
  const dailyProfit = new Array(days).fill(0);
  for (const trade of trades) {
    if (!trade.close_date) continue;
    const closeDate = new Date(trade.close_date).getTime();
    const daysAgo = Math.floor((now - closeDate) / (1000 * 60 * 60 * 24));
    if (daysAgo >= 0 && daysAgo < days) {
      dailyProfit[days - 1 - daysAgo] += trade.profit_abs ?? 0;
    }
  }
  return dailyProfit;
}

function sparklinePath(data: number[], width: number, height: number): string {
  if (data.length < 2) return '';
  const max = Math.max(...data.map(Math.abs), 0.001);
  const mid = height / 2;
  const stepX = width / (data.length - 1);
  return data.map((v, i) => `${i * stepX},${mid - (v / max) * (mid - 1)}`).join(' ');
}

function sparklineSum(data: number[]): number {
  return data.reduce((a, b) => a + b, 0);
}

// ===== Feature 2: Alert System V2 — config accessors (detection logic in useAlertDetection) =====
const alertConfigV2 = computed({
  get: () => compStore.alertConfig,
  set: (val: AlertConfigV2) => { compStore.alertConfig = val; },
});

function resetAlertConfig() { compStore.resetAlertConfig(); }
function getGlobalAlertSetting(alertId: string): AlertSettingConfig { return compStore.getGlobalAlertSetting(alertId); }
function setGlobalAlertEnabled(alertId: string, enabled: boolean) { compStore.setGlobalAlertEnabled(alertId, enabled); }

function setGlobalAlertThreshold(alertId: string, value: number) {
  if (alertConfigV2.value.global[alertId]) alertConfigV2.value.global[alertId].threshold = value;
}
function setGlobalAlertLeverage(alertId: string, value: boolean) {
  if (alertConfigV2.value.global[alertId]) alertConfigV2.value.global[alertId].includeLeverage = value;
}
function setBotAlertEnabled(botId: string, enabled: boolean) {
  alertConfigV2.value.perBotEnabled[botId] = enabled;
}

// Alert hover popover
const alertHoverPopover = ref<InstanceType<typeof Popover>>();
const alertHoverBotId = ref<string | null>(null);
const alertHoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

function startAlertHover(event: MouseEvent, botId: string) {
  trackMouse(event);
  const target = event.currentTarget as HTMLElement;
  cancelDelayedHide();
  // Close ALL other popovers first (only one popover visible at a time)
  closeAllPopovers();
  if (alertHoverTimeout.value) clearTimeout(alertHoverTimeout.value);
  alertHoverTimeout.value = setTimeout(() => {
    alertHoverBotId.value = botId;
    showAtTarget(alertHoverPopover.value, target);
  }, 300);
}
function cancelAlertHover() {
  if (alertHoverTimeout.value) { clearTimeout(alertHoverTimeout.value); alertHoverTimeout.value = null; }
  delayedHide(alertHoverPopover.value, () => { alertHoverBotId.value = null; });
}
function cancelAlertHoverKeepPopover() {
  cancelDelayedHide();
  if (alertHoverTimeout.value) { clearTimeout(alertHoverTimeout.value); alertHoverTimeout.value = null; }
}

// ===== Feature 3: Bot Groups (from store) =====
const botGroups = computed({
  get: () => compStore.botGroups,
  set: (val: BotGroup[]) => { compStore.botGroups = val; },
});

const newGroupName = ref('');
const newGroupIcon = ref('');

function createGroup() {
  const name = newGroupName.value.trim();
  if (!name) return;
  const id = `group_${Date.now()}`;
  botGroups.value.push({
    id,
    name,
    icon: newGroupIcon.value.trim() || '',
    collapsed: false,
    botIds: [],
  });
  newGroupName.value = '';
  newGroupIcon.value = '';
}

function deleteGroup(groupId: string) {
  botGroups.value = botGroups.value.filter((g) => g.id !== groupId);
}

function toggleGroupCollapse(groupId: string) {
  const group = botGroups.value.find((g) => g.id === groupId);
  if (group) group.collapsed = !group.collapsed;
}

function addBotToGroup(botId: string, groupId: string) {
  // Remove from any other group first
  for (const g of botGroups.value) {
    g.botIds = g.botIds.filter((id) => id !== botId);
  }
  const group = botGroups.value.find((g) => g.id === groupId);
  if (group && !group.botIds.includes(botId)) {
    group.botIds.push(botId);
  }
}

function removeBotFromGroup(botId: string) {
  for (const g of botGroups.value) {
    g.botIds = g.botIds.filter((id) => id !== botId);
  }
}

function getBotGroupId(botId: string): string | undefined {
  for (const g of botGroups.value) {
    if (g.botIds.includes(botId)) return g.id;
  }
  return undefined;
}

// Bots available for group management (all visible bots)
const allBotIds = computed(() => Object.keys(botStore.botStores));

const allVisibleBotIds = computed(() => {
  return Object.keys(botStore.botStores).filter((id) => isBotVisibleByFilter(id));
});

// Correlation detection: find pairs open on multiple selected bots simultaneously
const correlatedPairs = computed(() => {
  const pairMap: Record<string, string[]> = {};
  for (const [botId, trades] of Object.entries(botStore.allOpenTrades)) {
    if (!botStore.botStores[botId]?.isSelected) continue;
    for (const trade of trades || []) {
      const pair = trade.pair;
      if (!pairMap[pair]) pairMap[pair] = [];
      pairMap[pair].push(botId);
    }
  }
  return Object.entries(pairMap).filter(([, bots]) => bots.length > 1);
});
</script>

<template>
  <div>
    <Popover ref="columnPopover" class="p-3" style="min-width: 220px">
      <div class="flex justify-between items-center mb-2">
        <h4 class="font-bold text-sm">{{ t('botComparison.columnSettings') }}</h4>
        <button
          class="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-600 cursor-pointer"
          :title="t('botComparison.resetColumns')"
          @click="resetColumns"
        >
          <i-mdi-refresh class="text-sm" />
        </button>
      </div>
      <div class="space-y-0.5">
        <div
          v-for="col in orderedColumns"
          :key="col.id"
          class="flex items-center gap-2 p-1 rounded text-sm relative"
          :class="col.removable ? 'cursor-grab hover:bg-surface-100 dark:hover:bg-surface-700' : ''"
          :draggable="col.removable"
          @dragstart="onDragStart($event, col.id)"
          @dragover.prevent="onDragOver($event, col.id)"
          @dragleave="onDragLeaveColumn()"
          @drop="onDrop($event, col.id)"
        >
          <div
            v-if="dragOverColumnId === col.id && draggedColumnId"
            class="absolute left-0 right-0 -top-px h-0.5 bg-blue-500 rounded-full z-10"
          />
          <i-mdi-drag-vertical v-if="col.removable" class="text-xs opacity-40" />
          <BaseCheckbox
            :model-value="isColumnVisible(col.id)"
            :disabled="!col.removable"
            @update:model-value="toggleColumn(col.id)"
          >
            {{ t(col.labelKey) }}
          </BaseCheckbox>
        </div>
      </div>
      <!-- Bot tags section -->
      <div class="mt-3 pt-3 border-t border-surface-300 dark:border-surface-600">
        <div class="flex items-center gap-1 mb-2">
          <i-mdi-tag-outline class="text-sm opacity-60" />
          <h4 class="font-bold text-sm">{{ t('botComparison.botTags') }}</h4>
        </div>
        <div class="space-y-0.5">
          <div
            v-for="tagId in tagOrder"
            :key="tagId"
            class="flex items-center gap-2 p-1 rounded text-sm cursor-grab hover:bg-surface-100 dark:hover:bg-surface-700"
            draggable="true"
            @dragstart="onTagDragStart($event, tagId)"
            @dragover.prevent="onTagDragOver($event)"
            @drop="onTagDrop($event, tagId)"
          >
            <i-mdi-drag-vertical class="text-xs opacity-40" />
            <BaseCheckbox v-model="botTagVisibility[tagId]">
              {{ t(tagLabels[tagId]) }}
            </BaseCheckbox>
          </div>
        </div>
      </div>
      <!-- Visibility section -->
      <div class="mt-3 pt-3 border-t border-surface-300 dark:border-surface-600">
        <div class="flex items-center gap-1 mb-2">
          <i-mdi-eye-outline class="text-sm opacity-60" />
          <h4 class="font-bold text-sm">{{ t('botComparison.visibility') }}</h4>
        </div>
        <div class="space-y-0.5">
          <BaseCheckbox v-model="botTagVisibility.onlineSince" class="text-sm p-1">
            {{ t('botComparison.showOnlineSince') }}
          </BaseCheckbox>
        </div>
      </div>

    </Popover>

    <!-- Sort popover -->
    <Popover ref="sortPopover" class="p-3" style="min-width: 260px; max-height: 80vh; overflow-y: auto">
      <div class="flex justify-between items-center mb-2">
        <div class="flex items-center gap-1">
          <i-mdi-sort-variant class="text-sm opacity-60" />
          <h4 class="font-bold text-sm">{{ t('botComparison.sortBy') }}</h4>
        </div>
        <button
          class="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-600 cursor-pointer"
          :title="t('botComparison.resetSort')"
          @click="activeSort = null"
        >
          <i-mdi-refresh class="text-sm" />
        </button>
      </div>
      <div class="space-y-0.5">
        <div
          v-for="sf in sortFields"
          :key="sf.id"
          class="flex items-center justify-between p-1 rounded text-sm cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-700"
          @click="cycleSortField(sf.id)"
        >
          <span class="flex items-center gap-1.5">
            <i-mdi-gesture-swipe v-if="sf.id === 'custom'" class="text-xs opacity-50" />
            {{ t(sf.labelKey) }}
          </span>
          <span class="flex items-center gap-1 min-w-[20px] justify-center">
            <template v-if="sf.id === 'custom'">
              <i-mdi-gesture-swipe v-if="getSortDirection(sf.id) === 'asc'" class="text-blue-500" />
              <i-mdi-minus v-else class="opacity-20" />
            </template>
            <template v-else>
              <i-mdi-arrow-up v-if="getSortDirection(sf.id) === 'asc'" class="text-blue-500" />
              <i-mdi-arrow-down v-else-if="getSortDirection(sf.id) === 'desc'" class="text-blue-500" />
              <i-mdi-minus v-else class="opacity-20" />
            </template>
          </span>
        </div>
      </div>
    </Popover>

    <!-- Filter popover -->
    <Popover ref="filterPopover" class="p-3" style="min-width: 260px; max-height: 80vh; overflow-y: auto">
      <div class="flex justify-between items-center mb-2">
        <div class="flex items-center gap-1">
          <i-mdi-filter-variant class="text-sm opacity-60" />
          <h4 class="font-bold text-sm">{{ t('botComparison.filtersTitle') }}</h4>
        </div>
        <button
          class="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-600 cursor-pointer"
          :title="t('botComparison.resetFilters')"
          @click="resetAllFilters"
        >
          <i-mdi-refresh class="text-sm" />
        </button>
      </div>

      <!-- By Status -->
      <div class="mb-2">
        <div class="text-xs font-semibold opacity-60 mb-1">{{ t('botComparison.byStatus') }}</div>
        <div class="space-y-0.5">
          <div class="flex items-center gap-2 p-1 text-sm">
            <BaseCheckbox v-model="botFilters.status.live">
              Live ({{ statusCounts.live }})
            </BaseCheckbox>
          </div>
          <div class="flex items-center gap-2 p-1 text-sm">
            <BaseCheckbox v-model="botFilters.status.dry">
              Dry ({{ statusCounts.dry }})
            </BaseCheckbox>
          </div>
          <div class="flex items-center gap-2 p-1 text-sm">
            <BaseCheckbox v-model="botFilters.status.offline">
              {{ t('botComparison.offline') }} ({{ statusCounts.offline }})
            </BaseCheckbox>
          </div>
        </div>
      </div>

      <!-- By Exchange -->
      <div v-if="Object.keys(allExchanges).length > 0" class="mb-2">
        <div class="text-xs font-semibold opacity-60 mb-1">{{ t('botComparison.byExchange') }}</div>
        <div class="space-y-0.5">
          <div v-for="(count, ex) in allExchanges" :key="ex" class="flex items-center gap-2 p-1 text-sm">
            <BaseCheckbox v-model="botFilters.exchanges[ex]">
              {{ capitalizeExchange(String(ex)) }} ({{ count }})
            </BaseCheckbox>
          </div>
        </div>
      </div>

      <!-- By Currency -->
      <div v-if="Object.keys(allCurrencies).length > 0" class="mb-2">
        <div class="text-xs font-semibold opacity-60 mb-1">{{ t('botComparison.byCurrency') }}</div>
        <div class="space-y-0.5">
          <div v-for="(count, cur) in allCurrencies" :key="cur" class="flex items-center gap-2 p-1 text-sm">
            <BaseCheckbox v-model="botFilters.currencies[cur]">
              {{ cur }} ({{ count }})
            </BaseCheckbox>
          </div>
        </div>
      </div>

      <!-- By Trading Mode -->
      <div v-if="Object.keys(allTradingModes).length > 0" class="mb-2">
        <div class="text-xs font-semibold opacity-60 mb-1">{{ t('botComparison.byTradingMode') }}</div>
        <div class="space-y-0.5">
          <div v-for="(count, mode) in allTradingModes" :key="mode" class="flex items-center gap-2 p-1 text-sm">
            <BaseCheckbox v-model="botFilters.tradingMode[mode]">
              {{ String(mode) === 'futures' ? 'Futures' : 'Spot' }} ({{ count }})
            </BaseCheckbox>
          </div>
        </div>
      </div>

      <!-- By Custom Tag -->
      <div v-if="customTags.length > 0" class="mb-2">
        <div class="text-xs font-semibold opacity-60 mb-1">{{ t('botComparison.byCustomTag') }}</div>
        <div class="space-y-0.5">
          <div v-for="tag in customTags" :key="tag.id" class="flex items-center gap-2 p-1 text-sm">
            <BaseCheckbox v-model="botFilters.customTags[tag.id]">
              <span
                class="inline-flex items-center rounded-sm text-[0.55rem] font-bold"
                style="padding: 1px 5px; line-height: 1.2"
                :style="{ background: tag.color, color: '#fff' }"
              >{{ tag.name }}</span>
              <span class="opacity-50 text-xs ml-1">({{ getCustomTagBotCount(tag.id) }})</span>
            </BaseCheckbox>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="mt-2 pt-2 border-t border-surface-300 dark:border-surface-600 flex items-center justify-between text-xs opacity-70">
        <span v-if="hiddenBotCount > 0">
          {{ t('botComparison.botsHidden', { count: hiddenBotCount }, hiddenBotCount) }}
        </span>
        <span v-else>{{ t('botComparison.allBotsVisible') }}</span>
        <button
          v-if="hiddenBotCount > 0"
          class="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-600 cursor-pointer"
          :title="t('botComparison.showAllBots')"
          @click="resetAllFilters"
        >
          <i-mdi-eye class="text-sm" />
        </button>
      </div>
    </Popover>

    <!-- Custom Tag Picker Popover -->
    <Popover ref="tagPickerPopover" class="p-3" style="min-width: 240px; max-width: 320px">
      <div class="flex items-center gap-1 mb-2">
        <i-mdi-tag-multiple class="text-sm opacity-60" />
        <h4 class="font-bold text-sm">{{ t('botComparison.customTags') }}</h4>
      </div>

      <!-- Existing tags -->
      <div v-if="customTags.length > 0" class="space-y-1 mb-3">
        <div v-for="tag in customTags" :key="tag.id" class="flex items-center gap-2 text-sm">
          <!-- Edit mode -->
          <template v-if="editingTagId === tag.id">
            <input
              v-model="editTagName"
              class="flex-1 text-xs px-1 py-0.5 rounded border border-surface-300 dark:border-surface-600 bg-transparent"
              @keyup.enter="saveEditTag()"
              @keyup.escape="cancelEditTag()"
            />
            <div class="flex gap-0.5 flex-wrap" style="max-width: 100px">
              <span
                v-for="color in tagColors"
                :key="color"
                class="w-3 h-3 rounded-sm cursor-pointer border"
                :class="editTagColor === color ? 'border-white' : 'border-transparent'"
                :style="{ background: color }"
                @click="editTagColor = color"
              ></span>
            </div>
            <i-mdi-check class="text-xs cursor-pointer text-green-500 hover:text-green-400" @click="saveEditTag()" />
            <i-mdi-close class="text-xs cursor-pointer opacity-50 hover:opacity-100" @click="cancelEditTag()" />
          </template>
          <!-- Normal mode -->
          <template v-else>
            <BaseCheckbox
              :model-value="tagPickerBotId ? getBotCustomTags(tagPickerBotId).includes(tag.id) : false"
              @update:model-value="tagPickerBotId && toggleBotTag(tagPickerBotId, tag.id)"
            >
              <span
                class="inline-flex items-center rounded-sm text-[0.55rem] font-bold"
                style="padding: 1px 5px; line-height: 1.2"
                :style="{ background: tag.color, color: '#fff' }"
              >{{ tag.name }}</span>
            </BaseCheckbox>
            <span class="flex-1"></span>
            <i-mdi-pencil
              class="text-xs cursor-pointer opacity-30 hover:opacity-80"
              :title="t('botComparison.editTag')"
              @click="startEditTag(tag.id)"
            />
            <i-mdi-close
              class="text-xs cursor-pointer opacity-30 hover:opacity-80 text-red-400"
              :title="t('botComparison.deleteTag')"
              @click="deleteCustomTag(tag.id)"
            />
          </template>
        </div>
      </div>

      <!-- Create new tag -->
      <div class="pt-2 border-t border-surface-300 dark:border-surface-600">
        <div class="text-xs font-semibold opacity-60 mb-1">{{ t('botComparison.createTag') }}</div>
        <input
          v-model="newTagName"
          :placeholder="t('botComparison.tagName')"
          class="w-full text-xs px-2 py-1 rounded border border-surface-300 dark:border-surface-600 bg-transparent mb-1.5"
          @keyup.enter="newTagName.trim() && createCustomTag(newTagName.trim(), newTagColor)"
        />
        <div class="flex items-center gap-1 mb-1.5">
          <span class="text-xs opacity-50 mr-1">{{ t('botComparison.tagColor') }}:</span>
          <span
            v-for="color in tagColors"
            :key="color"
            class="w-4 h-4 rounded-sm cursor-pointer border-2 transition-all"
            :class="newTagColor === color ? 'border-white scale-110' : 'border-transparent'"
            :style="{ background: color }"
            @click="newTagColor = color"
          ></span>
        </div>
        <button
          class="w-full text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          :disabled="!newTagName.trim()"
          @click="newTagName.trim() && createCustomTag(newTagName.trim(), newTagColor)"
        >{{ t('botComparison.createTag') }}</button>
      </div>
    </Popover>

    <!-- Bot info popover (shared, single instance) -->

    <Popover ref="infoPopover" class="p-0">
      <div @mouseenter="cancelHoverInfoKeepPopover()" @mouseleave="cancelHoverInfo()">
      <BotInfoCard
        v-if="hoveredBotId"
        :profit="hoveredProfit"
        :bot-state="hoveredBotState as Record<string, unknown>"
        :port="hoveredBotPort"
        :stake-currency="(hoveredBotState?.stake_currency as string)"
        :is-online="hoveredBotId ? botStore.botStores[hoveredBotId]?.isBotOnline : undefined"
        :last-seen-online="hoveredBotId ? botStore.botStores[hoveredBotId]?.lastSeenOnline : undefined"
        :bot-id="hoveredBotId"
      />
      </div>
    </Popover>

    <!-- Exchange info popover -->
    <Popover ref="exchangeInfoPopover" class="p-0">
      <div @mouseenter="cancelExchangeHoverKeepPopover()" @mouseleave="cancelExchangeHover()">
      <ExchangeInfoCard
        v-if="hoveredExchange"
        :exchange="hoveredExchange"
        @filter-trading-mode="filterByTradingMode"
      />
      </div>
    </Popover>

    <!-- Currency info popover -->
    <Popover ref="currencyInfoPopover" class="p-0">
      <div @mouseenter="cancelCurrencyHoverKeepPopover()" @mouseleave="cancelCurrencyHover()">
      <CurrencyInfoCard
        v-if="hoveredCurrency"
        :currency="hoveredCurrency"
        @filter-currency="filterByCurrency"
      />
      </div>
    </Popover>

    <!-- Open Profit popover -->
    <Popover ref="openProfitPopover" class="p-0">
      <div @mouseenter="cancelOpenProfitHoverKeepPopover()" @mouseleave="cancelOpenProfitHover()">
      <OpenProfitCard
        v-if="hoveredOpenProfitBotId"
        :bot-id="hoveredOpenProfitBotId"
        :stake-currency="(botStore.allBotState[hoveredOpenProfitBotId]?.stake_currency as string)"
      />
      </div>
    </Popover>

    <!-- Closed Profit popover -->
    <Popover ref="closedProfitPopover" class="p-0">
      <div @mouseenter="cancelClosedProfitHoverKeepPopover()" @mouseleave="cancelClosedProfitHover()">
      <ClosedProfitCard
        v-if="hoveredClosedProfitBotId"
        :bot-id="hoveredClosedProfitBotId"
        :stake-currency="(botStore.allBotState[hoveredClosedProfitBotId]?.stake_currency as string)"
      />
      </div>
    </Popover>

    <!-- Summary Open Profit popover -->
    <Popover ref="summaryOpenPopover" class="p-0">
      <div @mouseenter="cancelSummaryOpenHoverKeepPopover()" @mouseleave="cancelSummaryOpenHover()">
      <SummaryProfitCard
        v-if="summaryOpenVisible"
        mode="open"
      />
      </div>
    </Popover>

    <!-- Summary Closed Profit popover -->
    <Popover ref="summaryClosedPopover" class="p-0">
      <div @mouseenter="cancelSummaryClosedHoverKeepPopover()" @mouseleave="cancelSummaryClosedHover()">
      <SummaryProfitCard
        v-if="summaryClosedVisible"
        mode="closed"
      />
      </div>
    </Popover>

    <!-- Group Open Profit popover -->
    <Popover ref="groupOpenPopover" class="p-0">
      <div @mouseenter="cancelGroupOpenHoverKeepPopover()" @mouseleave="cancelGroupOpenHover()">
      <SummaryProfitCard
        v-if="groupOpenVisible"
        mode="open"
        :bot-ids="groupOpenBotIds"
      />
      </div>
    </Popover>

    <!-- Group Closed Profit popover -->
    <Popover ref="groupClosedPopover" class="p-0">
      <div @mouseenter="cancelGroupClosedHoverKeepPopover()" @mouseleave="cancelGroupClosedHover()">
      <SummaryProfitCard
        v-if="groupClosedVisible"
        mode="closed"
        :bot-ids="groupClosedBotIds"
      />
      </div>
    </Popover>

    <!-- Trades info popover -->
    <Popover ref="tradesPopover" class="p-0">
      <div @mouseenter="cancelTradesHoverKeepPopover()" @mouseleave="cancelTradesHover()">
      <TradesInfoCard
        v-if="hoveredTradesBotId"
        :bot-id="hoveredTradesBotId"
        :stake-currency="(botStore.allBotState[hoveredTradesBotId]?.stake_currency as string)"
      />
      </div>
    </Popover>

    <!-- Win/Loss popover -->
    <Popover ref="winLossPopover" class="p-0">
      <div @mouseenter="cancelWinLossHoverKeepPopover()" @mouseleave="cancelWinLossHover()">
      <WinLossCard
        v-if="hoveredWinLossBotId"
        :bot-id="hoveredWinLossBotId"
        :stake-currency="(botStore.allBotState[hoveredWinLossBotId]?.stake_currency as string)"
      />
      </div>
    </Popover>

    <!-- Balance popover -->
    <Popover ref="balancePopover" class="p-0">
      <div @mouseenter="cancelBalanceHoverKeepPopover()" @mouseleave="cancelBalanceHover()">
      <BalanceCard
        v-if="hoveredBalanceBotId"
        :bot-id="hoveredBalanceBotId"
        :stake-currency="(botStore.allBotState[hoveredBalanceBotId]?.stake_currency as string)"
      />
      </div>
    </Popover>

    <!-- Period Profit popover -->
    <Popover ref="periodProfitPopover" class="p-0">
      <div @mouseenter="cancelPeriodProfitHoverKeepPopover()" @mouseleave="cancelPeriodProfitHover()">
      <PeriodProfitCard
        v-if="hoveredPeriodProfitBotId"
        :bot-id="hoveredPeriodProfitBotId"
        :stake-currency="(botStore.allBotState[hoveredPeriodProfitBotId]?.stake_currency as string)"
      />
      </div>
    </Popover>

    <!-- Summary Trades popover -->
    <Popover ref="summaryTradesPopover" class="p-0">
      <div @mouseenter="cancelSummaryTradesHoverKeepPopover()" @mouseleave="cancelSummaryTradesHover()">
      <SummaryTradesCard
        v-if="summaryTradesVisible"
      />
      </div>
    </Popover>

    <!-- Summary Balance popover -->
    <Popover ref="summaryBalancePopover" class="p-0">
      <div @mouseenter="cancelSummaryBalanceHoverKeepPopover()" @mouseleave="cancelSummaryBalanceHover()">
      <SummaryBalanceCard
        v-if="summaryBalanceVisible"
      />
      </div>
    </Popover>

    <!-- Summary Win/Loss popover -->
    <Popover ref="summaryWinLossPopover" class="p-0">
      <div @mouseenter="cancelSummaryWinLossHoverKeepPopover()" @mouseleave="cancelSummaryWinLossHover()">
      <SummaryWinLossCard
        v-if="summaryWinLossVisible"
      />
      </div>
    </Popover>

    <!-- Summary Period Profit popover -->
    <Popover ref="summaryPeriodPopover" class="p-0">
      <div @mouseenter="cancelSummaryPeriodHoverKeepPopover()" @mouseleave="cancelSummaryPeriodHover()">
      <div v-if="summaryPeriodVisible" class="glass-card p-4" style="width: 380px">
        <div class="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
          <i-mdi-calendar-month v-if="summaryPeriodMode === 'monthly'" class="text-blue-400" />
          <i-mdi-calendar v-else class="text-green-400" />
          <span class="text-sm font-bold text-gray-100">
            {{ summaryPeriodMode === 'monthly' ? t('botComparison.monthlyProfit') : t('botComparison.yearlyProfit') }} — {{ t('botComparison.all') }}
          </span>
        </div>
        <div class="space-y-1">
          <div
            v-for="[botId, store] in Object.entries(botStore.botStores).filter(([id]) => store => store.isSelected)"
            :key="botId"
          >
          </div>
          <!-- Per-bot breakdown -->
          <template v-for="item in tableItems.filter(i => i.botId)" :key="'period-' + item.botId">
            <div class="flex items-center justify-between py-0.5">
              <span class="text-xs text-gray-300 truncate max-w-[180px]">{{ item.botName }}</span>
              <span class="text-xs font-bold" :class="(summaryPeriodMode === 'monthly' ? (item.monthlyProfit ?? 0) : (item.yearlyProfit ?? 0)) > 0 ? 'text-green-400' : (summaryPeriodMode === 'monthly' ? (item.monthlyProfit ?? 0) : (item.yearlyProfit ?? 0)) < 0 ? 'text-red-400' : 'text-gray-400'">
                {{ formatPriceCurrency(summaryPeriodMode === 'monthly' ? (item.monthlyProfit ?? 0) : (item.yearlyProfit ?? 0), item.stakeCurrency, 2) }}
              </span>
            </div>
          </template>
          <!-- Total -->
          <div class="flex items-center justify-between pt-2 mt-1 border-t border-white/10 font-bold">
            <span class="text-xs text-gray-200">Total</span>
            <span class="text-sm" :class="tableItems.filter(i => !i.botId && !i.isGroupRow)[0]?.[summaryPeriodMode === 'monthly' ? 'monthlyProfit' : 'yearlyProfit'] > 0 ? 'text-green-400' : 'text-red-400'">
              {{ formatPriceCurrency(tableItems.filter(i => !i.botId && !i.isGroupRow)[0]?.[summaryPeriodMode === 'monthly' ? 'monthlyProfit' : 'yearlyProfit'] ?? 0, tableItems.filter(i => !i.botId && !i.isGroupRow)[0]?.stakeCurrency || '', 2) }}
            </span>
          </div>
        </div>
      </div>
      </div>
    </Popover>

    <!-- Icon picker popover -->
    <Popover ref="iconPickerPopover" class="p-2" style="min-width: 280px">
      <div class="grid grid-cols-8 gap-1">
        <span
          v-for="icon in groupIcons"
          :key="icon"
          class="text-center text-lg cursor-pointer p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-600"
          @click="setIcon(icon)"
        >{{ icon }}</span>
      </div>
      <div class="mt-2 pt-2 border-t border-surface-200 dark:border-surface-600 text-center">
        <button
          class="text-xs px-2 py-1 rounded bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 cursor-pointer"
          @click="clearIcon()"
        >
          {{ iconPickerTarget?.type === 'bot' ? t('botComparison.clearIcon') : t('botComparison.resetIcon') }}
        </button>
      </div>
    </Popover>

    <!-- Group edit popover (from pencil on group row) -->
    <Popover ref="groupEditPopover" class="p-0" style="min-width: 280px; max-height: 60vh; overflow-y: auto">
      <div v-if="groupEditTargetId" class="p-3">
        <div class="flex items-center gap-2 mb-2">
          <span
            class="text-base cursor-pointer hover:opacity-70"
            @click.stop="groupEditTargetId && showIconPicker($event, groupEditTargetId)"
          >{{ botGroups.find(g => g.id === groupEditTargetId)?.icon || '📁' }}</span>
          <InputText
            v-model="groupEditName"
            size="small"
            class="w-full text-sm"
            @input="saveGroupEditName()"
          />
        </div>
        <!-- Bots in this group -->
        <div class="text-xs font-semibold opacity-60 mb-1">Bots</div>
        <div class="space-y-0.5 mb-2">
          <div
            v-for="bId in botGroups.find(g => g.id === groupEditTargetId)?.botIds || []"
            :key="bId"
            class="flex items-center justify-between text-xs p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700"
          >
            <span class="truncate max-w-[180px]">{{ botStore.botStores[bId]?.uiBotName || bId }}</span>
            <button
              class="p-0.5 rounded hover:bg-surface-200 dark:hover:bg-surface-600 cursor-pointer"
              @click="removeGroupEditBot(bId)"
            >
              <i-mdi-close class="text-xs opacity-60 hover:text-red-400" />
            </button>
          </div>
          <div v-if="(botGroups.find(g => g.id === groupEditTargetId)?.botIds || []).length === 0" class="text-xs opacity-40 italic p-1">
            No bots in this group
          </div>
        </div>
        <!-- Add bot dropdown -->
        <select
          class="w-full text-xs p-1 rounded border border-surface-300 dark:border-surface-500 bg-surface-50 dark:bg-surface-800"
          @change="(e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) { addGroupEditBot(v); (e.target as HTMLSelectElement).value = ''; } }"
        >
          <option value="">{{ t('botComparison.addToGroup') }}...</option>
          <option
            v-for="bId in allBotIds.filter(id => !(botGroups.find(g => g.id === groupEditTargetId)?.botIds || []).includes(id))"
            :key="bId"
            :value="bId"
          >{{ botStore.botStores[bId]?.uiBotName || bId }}{{ getBotGroupName(bId) ? ` (currently in: ${getBotGroupName(bId)})` : ' (ungrouped)' }}</option>
        </select>
      </div>
    </Popover>

    <!-- Alerts popover V2 -->
    <Popover ref="alertsPopover" class="p-0" style="min-width: 400px; max-width: 460px; max-height: 80vh; overflow-y: auto">
      <div class="p-3">
        <!-- Header -->
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <i-mdi-bell-alert class="text-base opacity-70" />
            <h4 class="font-bold text-sm">{{ t('botComparison.alertsTitle') }}</h4>
          </div>
          <button
            class="text-[0.65rem] px-2 py-0.5 rounded bg-surface-200 dark:bg-surface-600 hover:bg-surface-300 dark:hover:bg-surface-500 cursor-pointer flex items-center gap-1"
            @click="resetAlertConfig()"
          >
            <i-mdi-refresh class="text-xs" />
            {{ t('botComparison.alertsReset') }}
          </button>
        </div>

        <!-- Alert categories -->
        <div v-for="cat in ALERT_CATEGORIES" :key="cat.id" class="mb-2">
          <div class="text-[0.6rem] font-bold uppercase tracking-wider opacity-40 mb-1 px-1">
            {{ t(cat.labelKey) }}
          </div>
          <div class="space-y-1">
            <div
              v-for="alertType in ALERT_TYPES.filter(a => a.category === cat.id)"
              :key="alertType.id"
              class="flex items-center gap-2 px-2 py-1.5 rounded bg-surface-50 dark:bg-surface-700/50"
            >
              <!-- Severity icon -->
              <i-mdi-alert-octagon v-if="alertType.severity === 'critical'" class="text-sm flex-shrink-0 text-red-500" />
              <i-mdi-alert v-else-if="alertType.severity === 'warning'" class="text-sm flex-shrink-0 text-amber-400" />
              <i-mdi-information v-else class="text-sm flex-shrink-0 text-blue-400" />
              <!-- Label + description -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="text-xs font-medium" v-tooltip.right="getAlertTooltip(alertType.id)">{{ t(alertType.labelKey) }}</span>
                  <span class="text-[0.55rem] opacity-40 truncate">{{ t(alertType.descriptionKey) }}</span>
                </div>
                <!-- Threshold slider row -->
                <div v-if="alertType.hasThreshold && getGlobalAlertSetting(alertType.id).enabled" class="flex items-center gap-2 mt-1">
                  <input
                    type="range"
                    :min="alertType.thresholdMin"
                    :max="alertType.thresholdMax"
                    :step="alertType.thresholdStep"
                    :value="getGlobalAlertSetting(alertType.id).threshold ?? alertType.thresholdDefault"
                    class="flex-1 h-2 accent-amber-500"
                    @input="(e: Event) => setGlobalAlertThreshold(alertType.id, parseFloat((e.target as HTMLInputElement).value))"
                  />
                  <span class="text-[0.65rem] font-mono opacity-60 min-w-[36px] text-right">
                    {{ alertType.id === 'noTradeActivity'
                      ? ((getGlobalAlertSetting(alertType.id).threshold ?? alertType.thresholdDefault) >= 48
                        ? Math.floor((getGlobalAlertSetting(alertType.id).threshold ?? alertType.thresholdDefault) / 24) + 'd'
                        : (getGlobalAlertSetting(alertType.id).threshold ?? alertType.thresholdDefault) + 'h')
                      : (getGlobalAlertSetting(alertType.id).threshold ?? alertType.thresholdDefault) + alertType.thresholdUnit }}
                  </span>
                </div>
                <!-- Leverage checkbox for positionLoss -->
              </div>
              <!-- Toggle -->
              <ToggleSwitch
                :model-value="getGlobalAlertSetting(alertType.id).enabled"
                @update:model-value="(v: boolean) => setGlobalAlertEnabled(alertType.id, v)"
              />
            </div>
          </div>
        </div>

        <!-- Per bot section -->
        <div class="mt-3 pt-2 border-t border-surface-300 dark:border-surface-600">
          <div class="text-[0.6rem] font-bold uppercase tracking-wider opacity-40 mb-1.5 px-1">
            {{ t('botComparison.alertPerBot') }}
          </div>
          <div class="space-y-1">
            <div
              v-for="botId in allBotIds"
              :key="'alertbot-' + botId"
              class="flex items-center justify-between w-full px-2 py-1 rounded bg-surface-50 dark:bg-surface-700/50"
            >
              <div class="flex items-center gap-2 min-w-0">
                <span class="text-xs font-medium truncate max-w-[180px]">{{ botStore.botStores[botId]?.uiBotName || botId }}</span>
                <span v-if="getBotAlertCount(botId) > 0" class="text-[0.55rem] font-bold whitespace-nowrap" :class="getMaxSeverity(allBotAlerts[botId] || []) === 'critical' ? 'text-red-400' : getMaxSeverity(allBotAlerts[botId] || []) === 'warning' ? 'text-amber-400' : 'text-blue-400'">
                  {{ t('botComparison.alertActiveCount', { count: getBotAlertCount(botId) }, getBotAlertCount(botId)) }}
                </span>
                <span v-else-if="isBotAlertEnabled(botId)" class="text-[0.55rem] text-green-400 whitespace-nowrap">
                  {{ t('botComparison.noAlerts') }}
                </span>
              </div>
              <ToggleSwitch
                :model-value="isBotAlertEnabled(botId)"
                @update:model-value="(v: boolean) => setBotAlertEnabled(botId, v)"
                class="flex-shrink-0"
              />
            </div>
          </div>
          <div class="mt-2 text-[0.55rem] opacity-40 text-center">
            {{ t('botComparison.alertGlobalApply') }}
          </div>
        </div>
      </div>
    </Popover>

    <!-- Alert detail hover popover (on bot name alert icon) -->
    <Popover ref="alertHoverPopover" class="p-0" style="min-width: 560px; max-width: 580px" @mouseenter="cancelAlertHoverKeepPopover()" @mouseleave="cancelAlertHover()">
      <AlertDetailCard
        v-if="alertHoverBotId && allBotAlerts[alertHoverBotId]?.length"
        :bot-id="alertHoverBotId"
        :alerts="allBotAlerts[alertHoverBotId]"
      />
    </Popover>

    <!-- Groups popover -->
    <Popover ref="groupsPopover" class="p-0" style="min-width: 300px; max-height: 80vh; overflow-y: auto">
      <div class="p-3">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <i-mdi-folder-multiple class="text-base opacity-70" />
            <h4 class="font-bold text-sm">{{ t('botComparison.groupsTitle') }}</h4>
          </div>
          <button
            class="p-1 rounded hover:bg-surface-200 dark:hover:bg-surface-600 cursor-pointer"
            :title="t('botComparison.createGroupInline')"
            @click="createGroupInline()"
          >
            <i-mdi-plus class="text-sm" />
          </button>
        </div>
        <!-- Existing groups -->
        <div class="space-y-2">
          <div
            v-for="group in botGroups"
            :key="group.id"
            class="p-2 rounded bg-surface-100 dark:bg-surface-700"
          >
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center gap-1.5">
                <span
                  class="text-sm cursor-pointer hover:opacity-70"
                  :title="t('botComparison.changeIcon')"
                  @click.stop="showIconPicker($event, group.id)"
                >{{ group.icon || '📁' }}</span>
                <!-- Inline rename in groups popover -->
                <template v-if="editingGroupId === group.id">
                  <form class="flex items-center gap-1" @submit.prevent="saveGroupRename">
                    <InputText
                      v-model="editingGroupName"
                      size="small"
                      class="w-full text-sm"
                      autofocus
                      @blur="saveGroupRename"
                      @keydown.escape.prevent="cancelGroupRename"
                    />
                  </form>
                </template>
                <span
                  v-else
                  class="text-sm font-bold cursor-pointer hover:underline"
                  @click.stop="startGroupRename(group.id, group.name)"
                >{{ group.name }}</span>
                <Badge class="text-[0.55rem]" style="padding: 1px 5px; line-height: 1.2" severity="secondary">
                  {{ group.botIds.length }}
                </Badge>
              </div>
              <div class="flex items-center gap-1">
                <button
                  class="p-0.5 rounded hover:bg-surface-200 dark:hover:bg-surface-600 cursor-pointer"
                  @click="toggleGroupCollapse(group.id)"
                >
                  <i-mdi-chevron-right v-if="group.collapsed" class="text-xs opacity-60" />
                  <i-mdi-chevron-down v-else class="text-xs opacity-60" />
                </button>
                <button
                  class="p-0.5 rounded hover:bg-surface-200 dark:hover:bg-surface-600 cursor-pointer"
                  :title="t('botComparison.deleteGroup')"
                  @click="deleteGroup(group.id)"
                >
                  <i-mdi-delete-outline class="text-xs text-red-400" />
                </button>
              </div>
            </div>
            <!-- Bots in group -->
            <div v-if="!group.collapsed" class="space-y-0.5 mt-1">
              <div v-for="bId in group.botIds" :key="bId" class="flex items-center justify-between text-xs pl-4">
                <span class="truncate max-w-[160px]">{{ botStore.botStores[bId]?.uiBotName || bId }}</span>
                <button
                  class="p-0.5 rounded hover:bg-surface-200 dark:hover:bg-surface-600 cursor-pointer"
                  :title="t('botComparison.removeFromGroup')"
                  @click="removeBotFromGroup(bId)"
                >
                  <i-mdi-close class="text-xs opacity-60" />
                </button>
              </div>
            </div>
            <!-- Add bot to group -->
            <select
              class="mt-1 w-full text-xs p-0.5 rounded border border-surface-300 dark:border-surface-500 bg-surface-50 dark:bg-surface-800"
              @change="(e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) { addBotToGroup(v, group.id); (e.target as HTMLSelectElement).value = ''; } }"
            >
              <option value="">{{ t('botComparison.addToGroup') }}...</option>
              <option
                v-for="bId in allBotIds.filter(id => !group.botIds.includes(id))"
                :key="bId"
                :value="bId"
              >{{ botStore.botStores[bId]?.uiBotName || bId }}{{ getBotGroupName(bId) ? ` (currently in: ${getBotGroupName(bId)})` : ' (ungrouped)' }}</option>
            </select>
          </div>
        </div>
        <!-- Ungrouped bots -->
        <div class="mt-3 pt-2 border-t border-surface-300 dark:border-surface-600">
          <div class="text-xs font-semibold opacity-60 mb-1">{{ t('botComparison.ungroupedBots') }}</div>
          <div class="space-y-0.5">
            <div
              v-for="bId in allBotIds.filter(id => !botGroups.some(g => g.botIds.includes(id)))"
              :key="bId"
              class="flex items-center justify-between text-xs p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700"
            >
              <span class="truncate max-w-[160px]">{{ botStore.botStores[bId]?.uiBotName || bId }}</span>
              <select
                class="text-xs p-0.5 rounded border border-surface-300 dark:border-surface-500 bg-surface-50 dark:bg-surface-800"
                @change="(e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) { addBotToGroup(bId, v); (e.target as HTMLSelectElement).value = ''; } }"
              >
                <option value="">{{ t('botComparison.addToGroup') }}...</option>
                <option
                  v-for="group in botGroups"
                  :key="group.id"
                  :value="group.id"
                >{{ group.icon }} {{ group.name }}</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </Popover>

    <!-- Correlation alerts moved to OpenTradesEnhanced with dismiss per trade ID -->

    <!-- ProfitGoalBar removed -->

    <DataTable
      size="small"
      :value="tableItems"
      :row-class="getRowClass"
      class=""
    >
      <!-- Fixed checkbox column -->
      <Column style="width: 2rem; min-width: 2rem" :reorderable-column="false" frozen>
        <template #body="{ data }">
          <div
            class="flex items-center gap-0.5 px-1"
            @dragover.prevent
            @drop="data.botId ? onRowDrop(data.botId) : ((data as ComparisonTableItems).isGroupRow ? onRowDrop((data as ComparisonTableItems).groupId!) : undefined)"
          >
            <!-- Bot row: move up/down buttons -->
            <div v-if="data.botId" class="flex flex-col items-center -my-1" style="min-width: 16px">
              <i-mdi-chevron-up
                class="opacity-20 hover:opacity-80 cursor-pointer"
                style="font-size: 0.85rem; line-height: 0"
                @click.stop="moveBotUp(data.botId)"
              />
              <i-mdi-chevron-down
                class="opacity-20 hover:opacity-80 cursor-pointer"
                style="font-size: 0.85rem; line-height: 0"
                @click.stop="moveBotDown(data.botId)"
              />
            </div>
            <!-- Group row: move up/down buttons -->
            <div v-else-if="(data as ComparisonTableItems).isGroupRow" class="flex flex-col items-center -my-1" style="min-width: 16px">
              <i-mdi-chevron-up
                class="opacity-20 hover:opacity-80 cursor-pointer"
                style="font-size: 0.85rem; line-height: 0"
                @click.stop="moveGroupUp((data as ComparisonTableItems).groupId!)"
              />
              <i-mdi-chevron-down
                class="opacity-20 hover:opacity-80 cursor-pointer"
                style="font-size: 0.85rem; line-height: 0"
                @click.stop="moveGroupDown((data as ComparisonTableItems).groupId!)"
              />
            </div>
            <BaseCheckbox
              v-if="data.botId && botStore.botCount > 1"
              v-model="botStore.botStores[(data as unknown as ComparisonTableItems).botId!]!.isSelected"
              :title="t('botComparison.showInDashboard')"
            />
            <!-- Group row: checkbox toggles only its own bots -->
            <BaseCheckbox
              v-else-if="(data as ComparisonTableItems).isGroupRow && botStore.botCount > 1"
              :model-value="isGroupAllSelected((data as ComparisonTableItems).groupId!)"
              @update:model-value="toggleGroup((data as ComparisonTableItems).groupId!)"
              :title="t('botComparison.toggleAll')"
            />
            <!-- Summary row: checkbox toggles all bots -->
            <BaseCheckbox
              v-else-if="!data.botId && !(data as ComparisonTableItems).isGroupRow && botStore.botCount > 1"
              v-model="allToggled"
              :title="t('botComparison.toggleAll')"
            />
          </div>
        </template>
      </Column>
      <Column v-for="col in visibleOrderedColumns" :key="col.id" :field="col.id === 'winLoss' ? 'winVsLoss' : (['status', 'exchange', 'openProfit', 'closedProfit', 'stakeCurrency', 'weeklyProfit', 'monthlyProfit'].includes(col.id) ? undefined : col.id)">
        <template #header>
          <div class="col-header-removable group">
            <i-mdi-robot v-if="col.id === 'botName'" class="text-xs opacity-50" />
            <i-mdi-circle v-else-if="col.id === 'status'" class="text-xs opacity-50" />
            <i-mdi-swap-horizontal v-else-if="col.id === 'exchange'" class="text-xs opacity-50" />
            <i-mdi-chart-box v-else-if="col.id === 'trades'" class="text-xs opacity-50" />
            <i-mdi-trending-up v-else-if="col.id === 'openProfit'" class="text-xs opacity-50" />
            <i-mdi-cash-check v-else-if="col.id === 'closedProfit'" class="text-xs opacity-50" />
            <i-mdi-wallet v-else-if="col.id === 'balance'" class="text-xs opacity-50" />
            <i-mdi-trophy v-else-if="col.id === 'winLoss'" class="text-xs opacity-50" />
            <i-mdi-cash v-else-if="col.id === 'stakeAmount'" class="text-xs opacity-50" />
            <i-mdi-lan v-else-if="col.id === 'port'" class="text-xs opacity-50" />
            <i-mdi-cog v-else-if="col.id === 'strategy'" class="text-xs opacity-50" />
            <i-mdi-currency-usd v-else-if="col.id === 'stakeCurrency'" class="text-xs opacity-50" />
            <i-mdi-calendar-month v-else-if="col.id === 'monthlyProfit'" class="text-xs opacity-50" />
            <i-mdi-calendar v-else-if="col.id === 'yearlyProfit'" class="text-xs opacity-50" />
            <span>{{ t(col.labelKey) }}</span>
            <i-mdi-folder-plus
              v-if="col.id === 'botName'"
              class="opacity-40 hover:opacity-80 cursor-pointer ml-1"
              style="font-size: 0.8rem"
              v-tooltip="t('botComparison.createGroupInline')"
              @click.stop="createGroupInline()"
            />
            <i-mdi-close
              class="col-remove-btn"
              :title="t('botComparison.hideColumn')"
              @click.stop="hideColumn(col.id)"
            />
          </div>
        </template>
        <template #body="{ data, field }">
          <div
            @dragover.prevent
            @drop="data.botId ? onRowDrop(data.botId) : ((data as ComparisonTableItems).isGroupRow ? onRowDrop((data as ComparisonTableItems).groupId!) : undefined)"
          >
          <!-- botName -->
          <template v-if="col.id === 'botName'">
            <template v-if="editingBotId === data.botId && data.botId">
              <form class="flex items-center gap-1" @submit.prevent="saveRename">
                <InputText
                  v-model="editingName"
                  size="small"
                  class="w-full text-sm"
                  autofocus
                  @blur="saveRename"
                  @keydown.escape.prevent="cancelRename"
                />
              </form>
            </template>
            <template v-else>
              <!-- Group header row -->
              <div v-if="(data as ComparisonTableItems).isGroupRow" class="flex items-center gap-1.5 font-bold"
                   @dragover.prevent
                   @drop="onRowDrop((data as ComparisonTableItems).groupId!)">
                <span
                  v-if="(data as ComparisonTableItems).groupIcon"
                  class="text-sm cursor-pointer hover:opacity-70"
                  :title="t('botComparison.changeIcon')"
                  @click.stop="showIconPicker($event, (data as ComparisonTableItems).groupId!)"
                >{{ (data as ComparisonTableItems).groupIcon }}</span>
                <i-mdi-folder v-else class="text-sm opacity-60 cursor-pointer hover:opacity-100" :title="t('botComparison.changeIcon')" @click.stop="showIconPicker($event, (data as ComparisonTableItems).groupId!)" />
                <i-mdi-chevron-right v-if="(data as ComparisonTableItems).groupCollapsed" class="text-xs opacity-60 cursor-pointer" @click="toggleGroupCollapse((data as ComparisonTableItems).groupId!)" />
                <i-mdi-chevron-down v-else class="text-xs opacity-60 cursor-pointer" @click="toggleGroupCollapse((data as ComparisonTableItems).groupId!)" />
                <!-- Inline group rename -->
                <template v-if="editingGroupId === (data as ComparisonTableItems).groupId">
                  <form class="flex items-center gap-1" @submit.prevent="saveGroupRename">
                    <InputText
                      v-model="editingGroupName"
                      size="small"
                      class="w-full text-sm"
                      autofocus
                      @blur="saveGroupRename"
                      @keydown.escape.prevent="cancelGroupRename"
                    />
                  </form>
                </template>
                <template v-else>
                  <span class="cursor-pointer hover:underline" @click.stop="startGroupRename((data as ComparisonTableItems).groupId!, data.botName)" @dblclick.stop="toggleGroupCollapse((data as ComparisonTableItems).groupId!)">{{ data.botName }}</span>
                </template>
                <span class="text-xs opacity-50 font-normal ml-1">({{ (data as ComparisonTableItems).groupBotCount }})</span>
                <i-mdi-pencil
                  class="rename-icon row-hover-visible"
                  :title="t('botComparison.editGroup')"
                  @click.stop="showGroupEditPopover($event, (data as ComparisonTableItems).groupId!)"
                />
              </div>
              <!-- Normal bot / summary row -->
              <div v-else class="bot-name-block">
              <div class="inline-flex items-center gap-1">
                <i-mdi-robot-off v-if="data.botId && hasBotOfflineAlert(data.botId)"
                  class="text-red-500 animate-pulse ml-0.5"
                  style="font-size: 0.9rem"
                  @mouseenter="startAlertHover($event, data.botId)"
                  @mouseleave="cancelAlertHover()"
                />
                <span v-else-if="data.botId && hasBotAlert(data.botId)" class="ml-0.5 relative inline-flex items-center"
                  @mouseenter="startAlertHover($event, data.botId)"
                  @mouseleave="cancelAlertHover()"
                >
                  <i-mdi-bell-alert
                    class="animate-pulse"
                    :class="getMaxSeverity(allBotAlerts[data.botId] || []) === 'critical' ? 'text-red-500' : getMaxSeverity(allBotAlerts[data.botId] || []) === 'warning' ? 'text-amber-400' : 'text-blue-400'"
                    style="font-size: 0.85rem"
                  />
                  <span v-if="getBotAlertCount(data.botId) > 1"
                    class="absolute -top-1 -right-2 text-[0.5rem] bg-red-500 text-white rounded-full px-1 leading-tight"
                  >{{ getBotAlertCount(data.botId) }}</span>
                </span>
                <span
                  v-if="data.botId && (data as ComparisonTableItems).botIcon"
                  class="text-sm cursor-pointer hover:opacity-70 mr-0.5"
                  :title="t('botComparison.changeIcon')"
                  @click.stop="showBotIconPicker($event, data.botId)"
                >{{ (data as ComparisonTableItems).botIcon }}</span>
                <i-mdi-robot
                  v-else-if="data.botId"
                  class="text-sm opacity-30 cursor-pointer hover:opacity-100 row-hover-visible mr-0.5"
                  :title="t('botComparison.changeIcon')"
                  @click.stop="data.botId && showBotIconPicker($event, data.botId)"
                />
                <span
                  v-if="data.botId"
                  @mouseenter="startHoverInfo($event, data.botId)"
                  @mouseleave="cancelHoverInfo()"
                >{{ data[field as string] }}</span>
                <span v-else class="font-bold">{{ data[field as string] }}</span>
                <!-- Currency selector for Summary row (with CoinGecko tooltip) -->
                <span
                  v-if="!data.botId && !(data as ComparisonTableItems).isGroupRow && summaryUniqueCurrencies.length > 1"
                  v-tooltip.top="(data as ComparisonTableItems).isConverted ? `${t('summaryTrades.ratesSource')} · ${t('summaryTrades.ratesUpdated', { duration: ratesUpdatedAgo })}` : ''"
                >
                  <select
                    v-model="selectedSummaryCurrency"
                    class="ml-2 text-[0.6rem] bg-transparent border border-surface-400 dark:border-surface-600 rounded px-1 py-0 opacity-70 hover:opacity-100 cursor-pointer"
                    style="max-width: 80px"
                    @click.stop
                  >
                    <option value="auto">{{ t('summaryTrades.allCurrencies') }}</option>
                    <option v-for="cur in summaryUniqueCurrencies" :key="cur" :value="cur">{{ cur }}</option>
                  </select>
                </span>
                <div
                  v-if="!data.botId && !(data as ComparisonTableItems).isGroupRow && ratesFetchError && selectedSummaryCurrency !== 'auto' && summaryUniqueCurrencies.length > 1"
                  class="text-[0.5rem] text-amber-400 opacity-60 ml-2"
                >
                  {{ t('summaryTrades.ratesUnavailable') }}
                </div>
                <!-- Hidden bots filter indicator in Summary row -->
                <span
                  v-if="!data.botId && hiddenBotCount > 0"
                  class="ml-2 text-xs opacity-60 inline-flex items-center gap-1"
                >
                  {{ t('botComparison.botsHiddenByFilters', { count: hiddenBotCount }, hiddenBotCount) }}
                  <i-mdi-eye
                    class="cursor-pointer opacity-60 hover:opacity-100"
                    :title="t('botComparison.showAllBots')"
                    @click.stop="resetAllFilters()"
                  />
                </span>
                <i-mdi-pencil
                  v-if="data.botId"
                  class="rename-icon"
                  :title="t('botComparison.renameBot')"
                  @click.stop="startRename(data.botId, data[field as string])"
                />
              </div>
              <!-- Online since info line -->
              <div
                v-if="botTagVisibility.onlineSince && data.botId && getBotOnlineSince(data.botId)"
                class="flex items-center gap-1 mt-0.5 text-[0.6rem] opacity-40"
              >
                <span>{{ t('botComparison.onlineSince', { duration: getBotOnlineSince(data.botId) }) }}</span>
                <span>|</span>
                <span>{{ getBotStartDate(data.botId) }}</span>
              </div>
              <!-- Tags row under bot name -->
              <div v-if="data.botId && (orderedVisibleTags.length > 0 || getBotCustomTags(data.botId).length > 0)" class="flex flex-wrap gap-1.5 mt-1 opacity-80">
                <template v-for="tagId in orderedVisibleTags" :key="tagId">
                  <!-- Status tag -->
                  <template v-if="tagId === 'status'">
                    <Badge
                      v-if="data.isOnline && data.isDryRun"
                      class="text-[0.55rem] cursor-pointer" style="padding: 1px 5px; line-height: 1.2"
                      :class="{ 'opacity-30': !isTagActive('status', 'dry') }"
                      severity="success"
                      :title="t('botComparison.selectDryBots')"
                      @click="botStore.toggleBotsByState('dry')"
                    >Dry</Badge>
                    <Badge
                      v-else-if="data.isOnline && !data.isDryRun"
                      class="text-[0.55rem] cursor-pointer" style="padding: 1px 5px; line-height: 1.2"
                      :class="{ 'opacity-30': !isTagActive('status', 'live') }"
                      severity="warning"
                      :title="t('botComparison.selectLiveBots')"
                      @click="botStore.toggleBotsByState('live')"
                    >Live</Badge>
                    <Badge
                      v-else-if="data.isOnline === false"
                      class="text-[0.55rem]" style="padding: 1px 5px; line-height: 1.2"
                      :class="{ 'opacity-30': !isTagActive('status', 'offline') }"
                      severity="secondary"
                    >{{ t('botComparison.offline') }}</Badge>
                  </template>
                  <!-- Trading mode tag -->
                  <span
                    v-else-if="tagId === 'tradingMode' && (data as ComparisonTableItems).tradingMode"
                    class="inline-flex items-center rounded-sm text-[0.55rem] font-bold"
                    :class="{ 'opacity-30': !isTagActive('tradingMode', (data as ComparisonTableItems).tradingMode ?? '') }"
                    style="padding: 1px 5px; line-height: 1.2"
                    :style="(data as ComparisonTableItems).tradingMode === 'futures'
                      ? { background: '#1a1a2e', color: '#e94560' }
                      : { background: '#1a2e1a', color: '#4ade80' }"
                    :title="(data as ComparisonTableItems).tradingMode === 'futures'
                      ? 'Futures: supports short, long, and leverage trading'
                      : 'Spot: buy and sell only, no leverage or shorting'"
                  >{{ (data as ComparisonTableItems).tradingMode === 'futures' ? 'Futures' : 'Spot' }}</span>
                  <!-- Exchange tag -->
                  <span
                    v-else-if="tagId === 'exchange' && (data as ComparisonTableItems).exchange"
                    class="inline-flex items-center rounded-sm text-[0.55rem] font-bold cursor-pointer"
                    :class="{ 'opacity-30': !isTagActive('exchange', (data as ComparisonTableItems).exchange ?? '') }"
                    style="padding: 1px 5px; line-height: 1.2"
                    :style="getExchangeStyle((data as ComparisonTableItems).exchange ?? '')"
                    :title="t('botComparison.selectByExchange', { exchange: (data as ComparisonTableItems).exchange })"
                    @click="botStore.toggleBotsByExchange((data as ComparisonTableItems).exchange ?? '')"
                    @mouseenter="startExchangeHover($event, (data as ComparisonTableItems).exchange ?? '')"
                    @mouseleave="cancelExchangeHover()"
                  >{{ capitalizeExchange((data as ComparisonTableItems).exchange ?? '') }}</span>
                  <!-- Currency tag -->
                  <span
                    v-else-if="tagId === 'stakeCurrency' && (data as ComparisonTableItems).stakeCurrency"
                    class="inline-flex items-center px-1 rounded-sm text-[0.55rem] font-bold cursor-pointer"
                    :class="{ 'opacity-30': !isTagActive('stakeCurrency', (data as ComparisonTableItems).stakeCurrency ?? '') }"
                    style="padding: 1px 5px; line-height: 1.2"
                    :style="getCurrencyStyle((data as ComparisonTableItems).stakeCurrency ?? '') || { background: 'var(--p-surface-200)', color: 'var(--p-surface-700)' }"
                    @click="botStore.toggleBotsByStakeCurrency((data as ComparisonTableItems).stakeCurrency ?? '')"
                    @mouseenter="startCurrencyHover($event, (data as ComparisonTableItems).stakeCurrency ?? '')"
                    @mouseleave="cancelCurrencyHover()"
                  >{{ (data as ComparisonTableItems).stakeCurrency }}</span>
                  <!-- Port tag -->
                  <span
                    v-else-if="tagId === 'port' && (data as ComparisonTableItems).port"
                    class="inline-flex items-center px-1 rounded-sm text-[0.55rem]"
                    style="padding: 1px 5px; line-height: 1.2; background: var(--p-surface-200); color: var(--p-surface-500)"
                  >:{{ (data as ComparisonTableItems).port }}</span>
                </template>
                <!-- Custom tags -->
                <span
                  v-for="ctId in getBotCustomTags(data.botId)"
                  :key="ctId"
                  class="inline-flex items-center rounded-sm text-[0.55rem] font-bold cursor-pointer"
                  style="padding: 1px 5px; line-height: 1.2"
                  :style="{ background: getCustomTag(ctId)?.color || '#666', color: '#fff' }"
                  :title="t('botComparison.filterByTag')"
                  @click="selectBotsByCustomTag(ctId)"
                >{{ getCustomTag(ctId)?.name || '' }}</span>
                <!-- Add/edit tag button (visible on row hover) -->
                <span
                  class="inline-flex items-center rounded-sm text-[0.55rem] row-hover-visible cursor-pointer border border-dashed border-gray-500"
                  style="padding: 0px 4px; line-height: 1.2"
                  @click.stop="showTagPicker($event, data.botId)"
                >{{ getBotCustomTags(data.botId).length > 0 ? '✏' : '+' }}</span>
              </div>
              </div><!-- /bot-name-block -->
            </template>
          </template>

          <!-- status -->
          <template v-else-if="col.id === 'status'">
            <Badge
              v-if="!data.botId"
              class="items-center text-slate-200 bg-slate-800 cursor-pointer"
              severity="contrast"
              :title="t('botComparison.selectAllBots')"
              @click="botStore.toggleBotsByState('all')"
            >
              {{ t('botComparison.all') }}
            </Badge>
            <Badge
              v-else-if="data.isOnline && data.isDryRun"
              class="items-center bg-green-800 text-slate-200 cursor-pointer"
              severity="success"
              :title="t('botComparison.selectDryBots')"
              @click="botStore.toggleBotsByState('dry')"
            >
              {{ t('botComparison.dry') }}
            </Badge>
            <Badge
              v-else-if="data.isOnline && !data.isDryRun"
              class="items-center cursor-pointer"
              severity="warning"
              :title="t('botComparison.selectLiveBots')"
              @click="botStore.toggleBotsByState('live')"
            >
              {{ t('botComparison.live') }}
            </Badge>
            <div v-else-if="data.isOnline === false" class="text-center">
              <Badge class="items-center" severity="secondary">
                {{ t('botComparison.offline') }}
              </Badge>
              <div
                v-if="(data as ComparisonTableItems).lastSeenOnline"
                class="text-xs opacity-60 mt-0.5"
              >
                {{
                  t('botComparison.offlineSince', {
                    duration: humanizeDuration(
                      (data as ComparisonTableItems).lastSeenOnline ?? 0,
                    ),
                  })
                }}
              </div>
            </div>
          </template>

          <!-- exchange -->
          <template v-else-if="col.id === 'exchange'">
            <span
              v-if="(data as ComparisonTableItems).exchange && data.botId != undefined"
              class="inline-flex items-center rounded-sm text-xs font-bold cursor-pointer px-2 py-0.5"
              :style="getExchangeStyle((data as ComparisonTableItems).exchange ?? '')"
              :title="t('botComparison.selectByExchange', { exchange: (data as ComparisonTableItems).exchange })"
              @click="botStore.toggleBotsByExchange((data as ComparisonTableItems).exchange ?? '')"
              @mouseenter="startExchangeHover($event, (data as ComparisonTableItems).exchange ?? '')"
              @mouseleave="cancelExchangeHover()"
            >
              {{ capitalizeExchange((data as ComparisonTableItems).exchange ?? '') }}
            </span>
          </template>

          <!-- trades -->
          <template v-else-if="col.id === 'trades'">
            <!-- Summary row: total positions with hover -->
            <div
              v-if="!data.botId && !(data as ComparisonTableItems).isGroupRow && (data as ComparisonTableItems).summaryTradesCount !== undefined"
              class="text-center"
              @mouseenter="startSummaryTradesHover($event)"
              @mouseleave="cancelSummaryTradesHover()"
            >
              <div class="font-bold">{{ (data as ComparisonTableItems).summaryTradesCount }} {{ t('summaryTrades.positions') }}</div>
              <div
                v-if="(data as ComparisonTableItems).summaryTradesMax! > 0"
                class="flex h-1.5 rounded-full overflow-hidden mt-1 bg-surface-300 dark:bg-surface-600"
                style="min-width: 50px"
              >
                <div
                  class="bg-blue-500"
                  :style="{ width: `${Math.min(((data as ComparisonTableItems).summaryTradesCount! / (data as ComparisonTableItems).summaryTradesMax!) * 100, 100)}%` }"
                />
              </div>
            </div>
            <!-- Bot row -->
            <div
              v-else-if="data.trades"
              class="text-center"
              @mouseenter="data.botId ? startTradesHover($event, data.botId) : undefined"
              @mouseleave="data.botId ? cancelTradesHover() : undefined"
            >
              <div>{{ data.trades }}</div>
              <div
                v-if="data.botId && data.trades?.includes('/') && !data.trades?.includes('∞')"
                class="flex h-1.5 rounded-full overflow-hidden mt-1 bg-surface-300 dark:bg-surface-600"
                style="min-width: 50px"
              >
                <div
                  class="bg-blue-500"
                  :style="{ width: `${parseTradesPercent(data.trades)}%` }"
                />
              </div>
            </div>
          </template>

          <!-- openProfit -->
          <template v-else-if="col.id === 'openProfit'">
            <!-- Group header row: hover shows SummaryProfitCard filtered by group -->
            <div
              v-if="(data as ComparisonTableItems).isGroupRow && data.profitOpen"
              @mouseenter="startGroupOpenHover($event, getGroupBotIds((data as ComparisonTableItems).groupId))"
              @mouseleave="cancelGroupOpenHover()"
            >
              <ProfitPill
                :profit-abs="(data as ComparisonTableItems).profitOpen"
                :stake-currency="(data as ComparisonTableItems).stakeCurrency"
              />
            </div>
            <!-- Summary row: hover shows SummaryProfitCard -->
            <div
              v-else-if="data.profitOpen && !data.botId"
              @mouseenter="startSummaryOpenHover($event)"
              @mouseleave="cancelSummaryOpenHover()"
            >
              <div class="inline-flex items-center gap-0.5">
                <span v-if="(data as ComparisonTableItems).isConverted" class="text-xs opacity-50" :title="t('summaryTrades.approximateConversion')">&#8776;</span>
                <ProfitPill
                  :profit-ratio="(data as unknown as ComparisonTableItems).profitOpenRatio"
                  :profit-abs="(data as unknown as ComparisonTableItems).profitOpen"
                  :profit-desc="`${t('botComparison.totalProfit')} ${formatPercent(
                    (data as ComparisonTableItems).profitOpenRatio ?? 0.0,
                  )}`"
                  :stake-currency="(data as ComparisonTableItems).stakeCurrency"
                />
              </div>
              <div v-if="(data as ComparisonTableItems).isConverted && Object.keys((data as ComparisonTableItems).perCurrencyProfitOpen ?? {}).length > 1" class="text-[0.5rem] opacity-40 mt-0.5 leading-tight">
                dont {{ Object.entries((data as ComparisonTableItems).perCurrencyProfitOpen ?? {}).filter(([cur]) => cur !== (data as ComparisonTableItems).stakeCurrency).map(([cur, amt]) => formatPriceCurrency(amt as number, cur, 4)).join(' et ') }}
              </div>
            </div>
            <!-- Bot row: hover shows OpenProfitCard -->
            <div
              v-else-if="data.profitOpen && data.botId"
              @mouseenter="startOpenProfitHover($event, data.botId)"
              @mouseleave="cancelOpenProfitHover()"
            >
              <ProfitPill
                :profit-ratio="(data as unknown as ComparisonTableItems).profitOpenRatio"
                :profit-abs="(data as unknown as ComparisonTableItems).profitOpen"
                :profit-desc="`${t('botComparison.totalProfit')} ${formatPercent(
                  (data as ComparisonTableItems).profitOpenRatio ?? 0.0,
                )}`"
                :stake-currency="(data as ComparisonTableItems).stakeCurrency"
              />
            </div>
          </template>

          <!-- closedProfit -->
          <template v-else-if="col.id === 'closedProfit'">
            <!-- Group header row: hover shows SummaryProfitCard filtered by group -->
            <div
              v-if="(data as ComparisonTableItems).isGroupRow && data.profitClosed"
              @mouseenter="startGroupClosedHover($event, getGroupBotIds((data as ComparisonTableItems).groupId))"
              @mouseleave="cancelGroupClosedHover()"
            >
              <ProfitPill
                :profit-abs="(data as ComparisonTableItems).profitClosed"
                :stake-currency="(data as ComparisonTableItems).stakeCurrency"
              />
            </div>
            <!-- Summary row: hover shows SummaryProfitCard -->
            <div
              v-else-if="data.profitClosed && !data.botId"
              @mouseenter="startSummaryClosedHover($event)"
              @mouseleave="cancelSummaryClosedHover()"
            >
              <div class="inline-flex items-center gap-0.5">
                <span v-if="(data as ComparisonTableItems).isConverted" class="text-xs opacity-50" :title="t('summaryTrades.approximateConversion')">&#8776;</span>
                <ProfitPill
                  :profit-ratio="(data as ComparisonTableItems).profitClosedRatio"
                  :profit-abs="(data as ComparisonTableItems).profitClosed"
                  :stake-currency="(data as unknown as ComparisonTableItems).stakeCurrency"
                />
              </div>
              <div v-if="(data as ComparisonTableItems).isConverted && Object.keys((data as ComparisonTableItems).perCurrencyProfitClosed ?? {}).length > 1" class="text-[0.5rem] opacity-40 mt-0.5 leading-tight">
                dont {{ Object.entries((data as ComparisonTableItems).perCurrencyProfitClosed ?? {}).filter(([cur]) => cur !== (data as ComparisonTableItems).stakeCurrency).map(([cur, amt]) => formatPriceCurrency(amt as number, cur, 4)).join(' et ') }}
              </div>
            </div>
            <!-- Bot row: hover shows ClosedProfitCard -->
            <div
              v-else-if="data.profitClosed && data.botId"
              @mouseenter="startClosedProfitHover($event, data.botId)"
              @mouseleave="cancelClosedProfitHover()"
            >
              <ProfitPill
                :profit-ratio="(data as ComparisonTableItems).profitClosedRatio"
                :profit-abs="(data as ComparisonTableItems).profitClosed"
                :stake-currency="(data as unknown as ComparisonTableItems).stakeCurrency"
              />
              <!-- Sparkline removed -->
            </div>
            <div
              v-if="(data as ComparisonTableItems).capitalWithdrawal && data.botId"
              class="text-xs text-center opacity-70 mt-0.5"
              :title="
                t('botComparison.netAfterWithdrawals', {
                  amount: formatPriceCurrency(
                    (data as ComparisonTableItems).profitClosed -
                      ((data as ComparisonTableItems).capitalWithdrawal ?? 0),
                    (data as ComparisonTableItems).stakeCurrency,
                    2,
                  ),
                })
              "
            >
              {{
                t('botComparison.withdrawnLabel', {
                  amount: formatPriceCurrency(
                    (data as ComparisonTableItems).capitalWithdrawal ?? 0,
                    (data as ComparisonTableItems).stakeCurrency,
                    2,
                  ),
                })
              }}
            </div>
          </template>

          <!-- balance -->
          <template v-else-if="col.id === 'balance'">
            <!-- Summary row: multi-currency or single -->
            <div
              v-if="!data.botId && !(data as ComparisonTableItems).isGroupRow"
              @mouseenter="startSummaryBalanceHover($event)"
              @mouseleave="cancelSummaryBalanceHover()"
            >
              <template v-if="(data as ComparisonTableItems).isMultiCurrency">
                <div v-for="(amt, cur) in (data as ComparisonTableItems).perCurrencyBalances" :key="cur" class="text-sm">
                  <span class="font-bold">{{ formatPrice(amt, 2) }}</span>
                  <span class="text-xs ml-0.5">{{ cur }}</span>
                </div>
                <span class="text-[0.6rem] opacity-50">({{ t('summaryTrades.multiCurrency') }})</span>
              </template>
              <template v-else-if="data.balance">
                <span v-if="(data as ComparisonTableItems).isConverted" class="text-xs opacity-50" :title="t('summaryTrades.approximateConversion')">&#8776; </span>
                <span :title="(data as ComparisonTableItems).stakeCurrency">
                  {{ formatPrice((data as ComparisonTableItems).balance ?? 0, (data as ComparisonTableItems).stakeCurrencyDecimals) }}
                </span>
                <span class="text-sm">{{ ` ${data.stakeCurrency}${data.balanceAppendix}` }}</span>
                <div v-if="(data as ComparisonTableItems).isConverted && Object.keys((data as ComparisonTableItems).perCurrencyBalances ?? {}).length > 1" class="text-[0.5rem] opacity-40 mt-0.5 leading-tight">
                  dont {{ Object.entries((data as ComparisonTableItems).perCurrencyBalances ?? {}).filter(([cur]) => cur !== (data as ComparisonTableItems).stakeCurrency).map(([cur, amt]) => formatPriceCurrency(amt as number, cur, 4)).join(' et ') }}
                </div>
              </template>
            </div>
            <!-- Bot row -->
            <div
              v-else-if="data.balance"
              @mouseenter="data.botId ? startBalanceHover($event, data.botId) : undefined"
              @mouseleave="data.botId ? cancelBalanceHover() : undefined"
            >
              <span :title="(data as ComparisonTableItems).stakeCurrency">
                {{
                  formatPrice(
                    (data as ComparisonTableItems).balance ?? 0,
                    (data as ComparisonTableItems).stakeCurrencyDecimals,
                  )
                }}
              </span>
              <span class="text-sm">{{ ` ${data.stakeCurrency}${data.balanceAppendix}` }}</span>
            </div>
          </template>

          <!-- winLoss -->
          <template v-else-if="col.id === 'winLoss'">
            <div
              v-if="data.losses !== undefined"
              class="text-center"
              @mouseenter="!data.botId && !(data as ComparisonTableItems).isGroupRow ? startSummaryWinLossHover($event) : (data.botId ? startWinLossHover($event, data.botId) : undefined)"
              @mouseleave="!data.botId && !(data as ComparisonTableItems).isGroupRow ? cancelSummaryWinLossHover() : (data.botId ? cancelWinLossHover() : undefined)"
            >
              <div>
                <span class="text-profit">{{ data.wins }}</span> /
                <span class="text-loss">{{ data.losses }}</span>
              </div>
              <div
                v-if="(data.wins + data.losses) > 0"
                class="flex h-1.5 rounded-full overflow-hidden mt-1"
                style="min-width: 50px"
                :title="`${((data.wins / (data.wins + data.losses)) * 100).toFixed(1)}% winrate`"
              >
                <div
                  class="bg-green-500"
                  :style="{ width: `${(data.wins / (data.wins + data.losses)) * 100}%` }"
                />
                <div
                  class="bg-red-500"
                  :style="{ width: `${(data.losses / (data.wins + data.losses)) * 100}%` }"
                />
              </div>
            </div>
          </template>

          <!-- stakeAmount -->
          <template v-else-if="col.id === 'stakeAmount'">
            <span v-if="data.botId !== undefined">{{ (data as ComparisonTableItems).stakeAmount }}</span>
          </template>

          <!-- port -->
          <template v-else-if="col.id === 'port'">
            <span v-if="(data as ComparisonTableItems).port">{{ (data as ComparisonTableItems).port }}</span>
          </template>

          <!-- strategy -->
          <template v-else-if="col.id === 'strategy'">
            <span v-if="data.botId !== undefined" class="text-xs">{{ (data as ComparisonTableItems).strategy }}</span>
          </template>

          <!-- stakeCurrency -->
          <template v-else-if="col.id === 'stakeCurrency'">
            <span
              v-if="(data as ComparisonTableItems).stakeCurrency && data.botId != undefined"
              class="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-bold cursor-pointer border border-transparent hover:border-current"
              :style="getCurrencyStyle((data as ComparisonTableItems).stakeCurrency ?? '') || { background: 'var(--p-surface-200)', color: 'var(--p-surface-700)' }"
              :title="
                t('botComparison.selectByCurrency', {
                  currency: (data as ComparisonTableItems).stakeCurrency,
                })
              "
              @click="
                botStore.toggleBotsByStakeCurrency(
                  (data as ComparisonTableItems).stakeCurrency ?? '',
                )
              "
              @mouseenter="startCurrencyHover($event, (data as ComparisonTableItems).stakeCurrency ?? '')"
              @mouseleave="cancelCurrencyHover()"
            >
              {{ (data as ComparisonTableItems).stakeCurrency }}
            </span>
          </template>

          <!-- yearlyProfit -->
          <template v-else-if="col.id === 'yearlyProfit'">
            <!-- Summary row -->
            <div
              v-if="!data.botId && !(data as ComparisonTableItems).isGroupRow && (data as ComparisonTableItems).yearlyProfit !== undefined"
              @mouseenter="startSummaryPeriodHover($event, 'yearly')"
              @mouseleave="cancelSummaryPeriodHover()"
            >
              <template v-if="(data as ComparisonTableItems).isMultiCurrency">
                <div v-for="(amt, cur) in (data as ComparisonTableItems).perCurrencyYearlyProfit" :key="cur" class="text-sm text-center">
                  <span :class="amt > 0 ? 'text-profit' : amt < 0 ? 'text-loss' : ''">{{ formatPriceCurrency(amt, cur as string, 2) }}</span>
                </div>
              </template>
              <template v-else>
                <div class="text-center font-bold" :class="(data as ComparisonTableItems).yearlyProfit! > 0 ? 'text-profit' : (data as ComparisonTableItems).yearlyProfit! < 0 ? 'text-loss' : ''">
                  <span v-if="(data as ComparisonTableItems).isConverted" class="opacity-50" :title="t('summaryTrades.approximateConversion')">&#8776; </span>
                  {{ formatPriceCurrency((data as ComparisonTableItems).yearlyProfit ?? 0, (data as ComparisonTableItems).stakeCurrency, 2) }}
                </div>
              </template>
            </div>
            <!-- Bot row -->
            <div
              v-else-if="(data as ComparisonTableItems).yearlyProfit !== undefined && data.botId !== undefined"
              @mouseenter="startPeriodProfitHover($event, data.botId)"
              @mouseleave="cancelPeriodProfitHover()"
            >
              <ProfitPill
                :profit-ratio="calculatePeriodProfit(botStore.allProfit[(data as ComparisonTableItems).botId!], 365)?.ratio"
                :stake-currency="(data as ComparisonTableItems).stakeCurrency"
              />
              <div class="text-xs text-center opacity-60 mt-0.5">
                {{ formatPriceCurrency((data as ComparisonTableItems).yearlyProfit ?? 0, (data as ComparisonTableItems).stakeCurrency, 2) }}
              </div>
            </div>
          </template>

          <!-- monthlyProfit -->
          <template v-else-if="col.id === 'monthlyProfit'">
            <!-- Summary row -->
            <div
              v-if="!data.botId && !(data as ComparisonTableItems).isGroupRow && (data as ComparisonTableItems).monthlyProfit !== undefined"
              @mouseenter="startSummaryPeriodHover($event, 'monthly')"
              @mouseleave="cancelSummaryPeriodHover()"
            >
              <template v-if="(data as ComparisonTableItems).isMultiCurrency">
                <div v-for="(amt, cur) in (data as ComparisonTableItems).perCurrencyMonthlyProfit" :key="cur" class="text-sm text-center">
                  <span :class="amt > 0 ? 'text-profit' : amt < 0 ? 'text-loss' : ''">{{ formatPriceCurrency(amt, cur as string, 2) }}</span>
                </div>
              </template>
              <template v-else>
                <div class="text-center font-bold" :class="(data as ComparisonTableItems).monthlyProfit! > 0 ? 'text-profit' : (data as ComparisonTableItems).monthlyProfit! < 0 ? 'text-loss' : ''">
                  <span v-if="(data as ComparisonTableItems).isConverted" class="opacity-50" :title="t('summaryTrades.approximateConversion')">&#8776; </span>
                  {{ formatPriceCurrency((data as ComparisonTableItems).monthlyProfit ?? 0, (data as ComparisonTableItems).stakeCurrency, 2) }}
                </div>
              </template>
            </div>
            <!-- Bot row -->
            <div
              v-else-if="(data as ComparisonTableItems).monthlyProfit !== undefined && data.botId !== undefined"
              @mouseenter="startPeriodProfitHover($event, data.botId)"
              @mouseleave="cancelPeriodProfitHover()"
            >
              <ProfitPill
                :profit-ratio="calculateMonthlyProfitData(botStore.allProfit[(data as ComparisonTableItems).botId!])?.ratio"
                :stake-currency="(data as ComparisonTableItems).stakeCurrency"
              />
              <div class="text-xs text-center opacity-60 mt-0.5">
                {{ formatPriceCurrency((data as ComparisonTableItems).monthlyProfit ?? 0, (data as ComparisonTableItems).stakeCurrency, 2) }}
              </div>
            </div>
          </template>
          </div>
        </template>
      </Column>
    </DataTable>
  </div>
</template>

<style scoped>
.bot-name-block {
  display: inline-block;
}

.col-header-removable {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  white-space: nowrap;
}

.col-remove-btn {
  font-size: 0.65rem;
  opacity: 0;
  cursor: pointer;
  padding: 2px;
  border-radius: 2px;
  transition: opacity 0.15s;
}

.col-remove-btn:hover {
  background-color: var(--p-surface-200);
}

:global(.dark) .col-remove-btn:hover {
  background-color: var(--p-surface-700);
}

.group:hover .col-remove-btn {
  opacity: 0.7;
}

.col-remove-btn:hover {
  opacity: 1 !important;
}

/* Inline rename pencil icon */
.rename-icon {
  font-size: 0.7rem;
  opacity: 0.3;
  cursor: pointer;
  padding: 2px;
  border-radius: 2px;
  transition: opacity 0.15s;
}

.rename-icon:hover {
  opacity: 1;
  background-color: var(--p-surface-200);
}

:global(.dark) .rename-icon:hover {
  background-color: var(--p-surface-700);
}

/* Row backgrounds handled in unscoped style block below */

/* Loading spinner */
.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>

<style>
/* Row background styling - MUST be unscoped to override PrimeVue */
/* Light mode */
.bot-row-selected > td {
  background-color: #f5f5f5 !important;
}
.bot-row-unselected > td {
  background-color: #e8e8e8 !important;
  opacity: 0.45;
}
.bot-row-group > td {
  background-color: #eef2f7 !important;
  border-top: 2px solid #cbd5e1 !important;
}
/* Dark mode */
.ft-dark-theme .bot-row-selected > td {
  background-color: #111318 !important;
}
.ft-dark-theme .bot-row-unselected > td {
  background-color: #0a0b0e !important;
  opacity: 0.45;
}
.ft-dark-theme .bot-row-group > td {
  background-color: #181c24 !important;
  border-top: 2px solid #2d3748 !important;
}

/* Ensure popovers don't overflow viewport */
/* No max-height on info popovers - cards manage their own size */

/* Elements visible only on row hover */
.rename-icon,
.row-hover-visible {
  opacity: 0 !important;
  transition: opacity 0.15s;
}
tr:hover .rename-icon,
tr:hover .row-hover-visible {
  opacity: 0.5 !important;
}
tr:hover .rename-icon:hover,
tr:hover .row-hover-visible:hover {
  opacity: 1 !important;
}

/* Ensure popovers render above all other UI elements */
.p-popover {
  z-index: 9999 !important;
}
</style>
