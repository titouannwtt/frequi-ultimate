<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import DsIcon from './DsIcon.vue';
import { useFocusTrap } from './lib/useFocusTrap';

/**
 * Right drawer (480 px) on desktop and tablet, bottom sheet under 600 px
 * (docs/redesign/02-design.md, section 5.1). Closes on Escape, on the scrim and on the cross;
 * never by swiping, so a drag can not trigger or cancel an action by accident. Focus is trapped
 * while open and restored to the opener on close.
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    /** Only `right` exists: the side of the desktop drawer. */
    side?: 'right';
    /** Breakpoint under which the sheet comes from the bottom. */
    breakpoint?: number;
    /** Render in place instead of in <body> (previews, tests). */
    inline?: boolean;
    /** Close on the scrim; some sheets with a form turn it off. */
    scrimClose?: boolean;
  }>(),
  { side: 'right', breakpoint: 600, scrimClose: true },
);

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const titleId = useId();

const viewportWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth);
function onResize() {
  viewportWidth.value = window.innerWidth;
}
onMounted(() => {
  onResize();
  window.addEventListener('resize', onResize, { passive: true });
});

/** Which presentation is in use: the drawer on desktop, the bottom sheet on a phone. */
const mode = computed<'drawer' | 'sheet'>(() =>
  viewportWidth.value < props.breakpoint ? 'sheet' : 'drawer',
);

const panel = ref<HTMLElement | null>(null);
const open = computed(() => props.open);
useFocusTrap(panel, open);

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) {
    event.stopPropagation();
    emit('close');
  }
}

let scrollLocked = false;
watch(
  open,
  (isOpen) => {
    if (typeof document === 'undefined') {
      return;
    }
    if (isOpen) {
      document.addEventListener('keydown', onKeydown);
      document.body.style.overflow = 'hidden';
      scrollLocked = true;
    } else {
      release();
    }
  },
  { immediate: true },
);

function release() {
  document.removeEventListener('keydown', onKeydown);
  if (scrollLocked) {
    document.body.style.overflow = '';
    scrollLocked = false;
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  release();
});
</script>

<template>
  <Teleport to="body" :disabled="inline">
    <Transition name="fq-fade">
      <div v-if="open" class="scrim" aria-hidden="true" @click="scrimClose && emit('close')"></div>
    </Transition>
    <Transition :name="mode === 'sheet' ? 'fq-sheet-up' : 'fq-sheet-right'">
      <aside
        v-if="open"
        ref="panel"
        class="sheet fq-portal"
        :class="mode === 'sheet' ? 'is-sheet' : 'is-drawer'"
        :data-mode="mode"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
      >
        <div v-if="mode === 'sheet'" class="grab" aria-hidden="true"></div>
        <header class="sh-h">
          <h2 :id="titleId">{{ title }}</h2>
          <slot name="header" />
          <button
            type="button"
            class="x"
            :aria-label="t('fq.ds.close')"
            :title="t('fq.ds.close')"
            @click="emit('close')"
          >
            <DsIcon name="x" />
          </button>
        </header>
        <div class="sh-b"><slot /></div>
        <footer v-if="$slots.footer" class="sh-f"><slot name="footer" /></footer>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  background: var(--scrim);
  z-index: calc(var(--z-base, 0) + 60);
}
.sheet {
  position: fixed;
  z-index: calc(var(--z-base, 0) + 61);
  background: var(--bg-1);
  color: var(--fg);
  box-shadow: var(--shadow-float);
  display: flex;
  flex-direction: column;
  font-family: var(--font-ui);
  font-size: var(--t-md);
}
.sheet.is-drawer {
  top: 0;
  right: 0;
  bottom: 0;
  width: min(480px, 100vw);
}
.sheet.is-sheet {
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  max-height: 92vh;
  border-radius: var(--r-4) var(--r-4) 0 0;
  padding-bottom: env(safe-area-inset-bottom);
}
.grab {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--line-2);
  margin: 8px auto 0;
  flex: none;
}
.sh-h {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px var(--s3);
  border-bottom: 1px solid var(--line);
  flex: none;
}
h2 {
  margin: 0;
  font-size: var(--t-lg);
  font-weight: 700;
  flex: 1;
  min-width: 0;
}
.x {
  width: 32px;
  height: 32px;
  display: inline-grid;
  place-items: center;
  border-radius: var(--r-2);
  border: 0;
  background: none;
  color: var(--fg-2);
  cursor: pointer;
}
.x:hover {
  background: var(--bg-2);
  color: var(--fg);
}
@media (max-width: 599px), (pointer: coarse) {
  .x {
    width: 44px;
    height: 44px;
  }
}
.sh-b {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.sh-f {
  flex: none;
  border-top: 1px solid var(--line);
  padding: var(--s3);
  background: var(--bg-1);
}

.fq-fade-enter-active,
.fq-fade-leave-active {
  transition: opacity var(--d-base) var(--e-out);
}
.fq-fade-enter-from,
.fq-fade-leave-to {
  opacity: 0;
}
.fq-sheet-right-enter-active,
.fq-sheet-right-leave-active,
.fq-sheet-up-enter-active,
.fq-sheet-up-leave-active {
  transition: transform var(--d-slow) var(--e-out);
}
.fq-sheet-right-enter-from,
.fq-sheet-right-leave-to {
  transform: translateX(104%);
}
.fq-sheet-up-enter-from,
.fq-sheet-up-leave-to {
  transform: translateY(104%);
}
</style>
