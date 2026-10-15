import { onBeforeUnmount, onMounted, type Ref } from 'vue';

/**
 * Edge fade on a horizontally scrolling row (docs/redesign/02-design.md, section 8): sets
 * `data-fade` to `l`, `r` or `lr` from the scroll position; the mask itself lives in
 * styles/base.css.
 */
export function useEdgeFade(el: Ref<HTMLElement | null>) {
  function update() {
    const node = el.value;
    if (!node) {
      return;
    }
    const max = node.scrollWidth - node.clientWidth;
    if (max <= 1) {
      node.removeAttribute('data-fade');
      return;
    }
    const fade = (node.scrollLeft > 2 ? 'l' : '') + (node.scrollLeft < max - 2 ? 'r' : '');
    if (fade) {
      node.setAttribute('data-fade', fade);
    } else {
      node.removeAttribute('data-fade');
    }
  }

  let observer: ResizeObserver | undefined;
  onMounted(() => {
    const node = el.value;
    if (!node) {
      return;
    }
    node.addEventListener('scroll', update, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update);
      observer.observe(node);
    }
    update();
  });
  onBeforeUnmount(() => {
    el.value?.removeEventListener('scroll', update);
    observer?.disconnect();
  });
  return { update };
}
