/**
 * Generic hover-popover composable extracted from BotComparisonList.
 * Handles: mouse tracking, delayed show/hide, fake anchor positioning.
 */
import type Popover from 'primevue/popover';

// Shared mouse tracker (module-level, all instances share)
let lastMouseX = 0;
let lastMouseY = 0;

export function trackMouse(event: MouseEvent) {
  lastMouseX = event.clientX;
  lastMouseY = event.clientY;
}

// Tracked timeouts and DOM elements for cleanup
const allFakeAnchors = new Set<ReturnType<typeof setTimeout>>();
const allFakeElements = new Set<HTMLElement>();
const allHideDelays = new Set<ReturnType<typeof setTimeout>>();

export function fakeEventAtMouse(): Event {
  const anchor = document.createElement('div');
  anchor.style.cssText = `position:fixed;left:${lastMouseX}px;top:${lastMouseY}px;width:1px;height:1px;pointer-events:none`;
  document.body.appendChild(anchor);
  allFakeElements.add(anchor);
  const id = setTimeout(() => {
    anchor.remove();
    allFakeAnchors.delete(id);
    allFakeElements.delete(anchor);
  }, 200);
  allFakeAnchors.add(id);
  return { currentTarget: anchor } as unknown as Event;
}

export function fakeEvent(el: HTMLElement): Event {
  return { currentTarget: el } as unknown as Event;
}

export function delayedHide(popover: { hide: () => void } | undefined, clearFn: () => void) {
  const id = setTimeout(() => {
    allHideDelays.delete(id);
    popover?.hide();
    clearFn();
  }, 150);
  allHideDelays.add(id);
}

export function cancelDelayedHide() {
  for (const id of allHideDelays) {
    clearTimeout(id);
  }
  allHideDelays.clear();
}

export function cleanupAllTimeouts() {
  for (const id of allHideDelays) {
    clearTimeout(id);
  }
  allHideDelays.clear();
  for (const id of allFakeAnchors) {
    clearTimeout(id);
  }
  allFakeAnchors.clear();
  // Remove any orphaned anchor elements from DOM
  for (const el of allFakeElements) {
    el.remove();
  }
  allFakeElements.clear();
}

/**
 * Creates a hover-popover binding for a single popover instance.
 * Returns refs and functions to manage hover → show → leave → delayed hide.
 */
export function usePopoverHover<T = string>(delay = 400) {
  const popoverRef = ref<InstanceType<typeof Popover>>();
  const hoveredValue = ref<T | null>(null) as Ref<T | null>;
  const hoverTimeout = ref<ReturnType<typeof setTimeout> | null>(null);

  function startHover(event: MouseEvent, value: T, closeOthers?: () => void) {
    trackMouse(event);
    cancelDelayedHide();
    if (hoverTimeout.value) clearTimeout(hoverTimeout.value);

    if (hoveredValue.value && hoveredValue.value !== value) {
      hoveredValue.value = value;
      nextTick(() => popoverRef.value?.show(fakeEventAtMouse()));
      return;
    }

    hoverTimeout.value = setTimeout(() => {
      closeOthers?.();
      hoveredValue.value = value;
      nextTick(() => popoverRef.value?.show(fakeEventAtMouse()));
    }, delay);
  }

  function cancelHover() {
    if (hoverTimeout.value) {
      clearTimeout(hoverTimeout.value);
      hoverTimeout.value = null;
    }
    delayedHide(popoverRef.value, () => {
      hoveredValue.value = null;
    });
  }

  function keepPopover() {
    cancelDelayedHide();
    if (hoverTimeout.value) {
      clearTimeout(hoverTimeout.value);
      hoverTimeout.value = null;
    }
  }

  function hide() {
    if (hoverTimeout.value) {
      clearTimeout(hoverTimeout.value);
      hoverTimeout.value = null;
    }
    delayedHide(popoverRef.value, () => {
      hoveredValue.value = null;
    });
  }

  return {
    popoverRef,
    hoveredValue,
    startHover,
    cancelHover,
    keepPopover,
    hide,
  };
}
