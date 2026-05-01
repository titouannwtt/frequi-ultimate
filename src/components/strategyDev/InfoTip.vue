<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    text: string;
    position?: 'top' | 'bottom' | 'left' | 'right';
    width?: string;
  }>(),
  { position: 'bottom', width: '280px' },
);

const visible = ref(false);
</script>

<template>
  <span
    class="infotip"
    @mouseenter="visible = true"
    @mouseleave="visible = false"
  >
    <i-mdi-information-outline class="infotip-icon" />
    <Transition name="infotip-pop">
      <div
        v-if="visible"
        class="infotip-bubble"
        :class="`infotip-bubble--${position}`"
        :style="{ width }"
      >
        {{ text }}
      </div>
    </Transition>
  </span>
</template>

<style scoped>
.infotip {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: help;
}

.infotip-icon {
  width: 14px;
  height: 14px;
  color: var(--sd-overlay);
  opacity: 0.7;
  transition: opacity 0.15s, color 0.15s;
}
.infotip:hover .infotip-icon {
  opacity: 1;
  color: var(--sd-info);
}

.infotip-bubble {
  position: absolute;
  z-index: 50;
  padding: 10px 12px;
  background: var(--sd-mantle);
  border: 1px solid var(--sd-border);
  border-radius: var(--sd-radius-md);
  box-shadow: var(--sd-shadow-lg);
  font-size: var(--sd-text-xs);
  color: var(--sd-subtext);
  line-height: 1.5;
  white-space: normal;
  pointer-events: none;
}

.infotip-bubble--top {
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
}
.infotip-bubble--bottom {
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
}
.infotip-bubble--left {
  right: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
}
.infotip-bubble--right {
  left: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
}

.infotip-pop-enter-active {
  transition: opacity 150ms ease, transform 150ms ease;
}
.infotip-pop-leave-active {
  transition: opacity 100ms ease;
}
.infotip-pop-enter-from {
  opacity: 0;
}
.infotip-pop-leave-to {
  opacity: 0;
}
</style>
