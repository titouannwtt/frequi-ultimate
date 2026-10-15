<script setup lang="ts">
import { computed } from 'vue';
import DsIcon from './DsIcon.vue';
import type { BannerKind, DsIconRef } from './types';

const props = defineProps<{
  kind: BannerKind;
  /** Label of the action button (Reconnect, Probe now). */
  action?: string;
}>();

const emit = defineEmits<{ action: [] }>();

const ICONS: Record<BannerKind, DsIconRef> = {
  cache: 'history',
  connecting: 'loader',
  degraded: 'triangle-alert',
  direct: 'cable',
  offline: 'wifi-off',
  auth: 'key-round',
  starting: 'loader',
  stopped: 'square',
};
const icon = computed(() => ICONS[props.kind]);
// Offline and auth need to be noticed; the others are information
const role = computed(() =>
  props.kind === 'offline' || props.kind === 'auth' ? 'alert' : 'status',
);
</script>

<template>
  <div class="banner" :class="kind" :role="role">
    <DsIcon :name="icon" />
    <span class="grow"><slot /></span>
    <button v-if="action" type="button" class="btn" @click="emit('action')">{{ action }}</button>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: 7px var(--s3);
  font-family: var(--font-ui);
  font-size: var(--t-sm);
  border-bottom: 1px solid var(--line);
  background: var(--bg-2);
  color: var(--fg-2);
  flex: none;
  animation: fq-slide-down var(--d-slow) var(--e-out);
}
.banner :deep(b) {
  color: var(--fg);
  font-weight: 600;
}
.grow {
  min-width: 0;
  flex: 1 1 220px;
}
.direct {
  background: var(--warn-w);
  border-bottom-color: color-mix(in srgb, var(--warn) 35%, transparent);
}
.direct > :first-child,
.degraded > :first-child,
.auth > :first-child {
  color: var(--warn);
}
.offline {
  background: var(--crit-w);
  border-bottom-color: color-mix(in srgb, var(--crit) 35%, transparent);
}
.offline > :first-child {
  color: var(--crit);
}
.cache > :first-child,
.connecting > :first-child,
.starting > :first-child {
  color: var(--info);
}
.degraded,
.auth {
  background: var(--warn-w);
}
.btn {
  margin-left: auto;
  height: 26px;
  padding: 0 8px;
  border-radius: var(--r-2);
  border: 1px solid var(--line-2);
  background: var(--bg-2);
  color: var(--fg);
  font: inherit;
  font-size: var(--t-sm);
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.btn:hover {
  background: var(--bg-3);
}
@media (max-width: 599px) {
  .banner {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .btn {
    margin-left: 23px;
    height: 36px;
  }
}
</style>
