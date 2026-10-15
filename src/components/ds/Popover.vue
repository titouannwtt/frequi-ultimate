<script setup lang="ts">
import { autoUpdate, computePosition, flip, offset, shift, type Placement } from '@floating-ui/dom';
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

/**
 * Light floating panel anchored to an element (excluded bots list, menus). Positioned with
 * floating-ui (flip and shift keep it inside the viewport); closes on Escape and on an outside
 * click, and gives the focus back to the anchor.
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    anchor: HTMLElement | null;
    placement?: Placement;
    /** Accessible name of the panel. */
    label?: string;
    role?: 'dialog' | 'menu' | 'listbox';
    inline?: boolean;
  }>(),
  { placement: 'bottom-start', role: 'dialog' },
);

const emit = defineEmits<{ close: [] }>();

const panel = ref<HTMLElement | null>(null);
const pos = ref({ x: 0, y: 0 });
let stopAuto: (() => void) | undefined;

async function place() {
  if (!props.anchor || !panel.value) {
    return;
  }
  const { x, y } = await computePosition(props.anchor, panel.value, {
    placement: props.placement,
    strategy: 'fixed',
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  pos.value = { x, y };
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    emit('close');
    props.anchor?.focus?.();
  }
}

function onPointerdown(event: PointerEvent) {
  const target = event.target as Node;
  if (panel.value?.contains(target) || props.anchor?.contains(target)) {
    return;
  }
  emit('close');
}

function detach() {
  stopAuto?.();
  stopAuto = undefined;
  document.removeEventListener('keydown', onKeydown, true);
  document.removeEventListener('pointerdown', onPointerdown, true);
}

watch(
  () => props.open,
  async (isOpen) => {
    detach();
    if (!isOpen) {
      return;
    }
    await nextTick();
    if (props.anchor && panel.value) {
      stopAuto = autoUpdate(props.anchor, panel.value, place);
    }
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('pointerdown', onPointerdown, true);
    panel.value?.focus({ preventScroll: true });
  },
  { immediate: true, flush: 'post' },
);

onBeforeUnmount(detach);
</script>

<template>
  <Teleport to="body" :disabled="inline">
    <Transition name="fq-pop">
      <div
        v-if="open"
        ref="panel"
        class="pop fq-portal"
        :role="role"
        :aria-label="label"
        tabindex="-1"
        :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
      >
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.pop {
  position: fixed;
  z-index: calc(var(--z-base, 0) + 85);
  min-width: 220px;
  max-width: 320px;
  background: var(--bg-1);
  color: var(--fg);
  border-radius: var(--r-2);
  box-shadow: var(--shadow-float);
  padding: 6px 0;
  font-family: var(--font-ui);
  font-size: var(--t-sm);
  outline: none;
}
.fq-pop-enter-active,
.fq-pop-leave-active {
  transition:
    opacity var(--d-fast) var(--e-out),
    transform var(--d-fast) var(--e-out);
}
.fq-pop-enter-from,
.fq-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
