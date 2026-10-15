<script setup lang="ts">
import { useToaster } from '@/composables/useToaster';
import ActionToast from './ActionToast.vue';

defineProps<{ inline?: boolean }>();
const emit = defineEmits<{ action: [toastId: number, actionId: string] }>();

const { toasts, dismiss } = useToaster();
</script>

<template>
  <Teleport to="body" :disabled="inline">
    <TransitionGroup
      name="fq-toast"
      tag="div"
      class="toasts"
      aria-live="polite"
      aria-relevant="additions"
    >
      <ActionToast
        v-for="toast in toasts"
        :key="toast.id"
        :kind="toast.kind"
        :title="toast.title"
        :body="toast.body"
        :meta="toast.meta"
        :actions="toast.actions"
        @action="(id) => emit('action', toast.id, id)"
        @close="dismiss(toast.id)"
      />
    </TransitionGroup>
  </Teleport>
</template>

<style scoped>
.toasts {
  position: fixed;
  z-index: calc(var(--z-base, 0) + 90);
  right: 12px;
  bottom: 36px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(380px, calc(100vw - 24px));
  pointer-events: none;
}
.toasts > * {
  pointer-events: auto;
}
@media (max-width: 1023px) {
  .toasts {
    left: 12px;
    right: 12px;
    width: auto;
    bottom: calc(70px + env(safe-area-inset-bottom));
  }
}
.fq-toast-enter-active,
.fq-toast-leave-active {
  transition:
    opacity var(--d-base) var(--e-out),
    transform var(--d-base) var(--e-out);
}
.fq-toast-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}
.fq-toast-leave-to {
  opacity: 0;
  transform: translateX(16px);
}
</style>
