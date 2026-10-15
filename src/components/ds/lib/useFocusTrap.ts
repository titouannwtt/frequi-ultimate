import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Focus trap for dialogs and sheets (docs/redesign/02-design.md, section 17): Tab and Shift+Tab
 * cycle inside the container, the first focusable element (or the one returned by `initialFocus`)
 * receives the focus on open, and the previously focused element gets it back on close.
 */
export function useFocusTrap(
  container: Ref<HTMLElement | null>,
  active: Ref<boolean>,
  initialFocus?: () => HTMLElement | null | undefined,
) {
  let previous: HTMLElement | null = null;

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab' || !container.value) {
      return;
    }
    const items = focusableIn(container.value);
    if (items.length === 0) {
      e.preventDefault();
      container.value.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const current = document.activeElement;
    if (e.shiftKey && (current === first || !container.value.contains(current))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (current === last || !container.value.contains(current))) {
      e.preventDefault();
      first.focus();
    }
  }

  function release() {
    document.removeEventListener('keydown', onKeydown, true);
    if (previous && document.contains(previous)) {
      previous.focus();
    }
    previous = null;
  }

  watch(
    active,
    async (on) => {
      if (on) {
        previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        await nextTick();
        const target =
          initialFocus?.() ?? (container.value ? focusableIn(container.value)[0] : null);
        (target ?? container.value)?.focus();
        document.addEventListener('keydown', onKeydown, true);
      } else {
        release();
      }
    },
    { immediate: true, flush: 'post' },
  );

  onBeforeUnmount(() => {
    if (active.value) {
      release();
    }
  });
}
