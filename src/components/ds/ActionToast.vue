<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import DsIcon from './DsIcon.vue';
import type { ToastAction, ToastKind } from './types';

const props = defineProps<{
  kind: ToastKind;
  title: string;
  body?: string;
  meta?: string;
  actions?: ToastAction[];
}>();

const emit = defineEmits<{ action: [id: string]; close: [] }>();

const { t } = useI18n();

const ICONS = { sent: 'send', ok: 'circle-check', verify: 'circle-help', err: 'circle-x' } as const;
const icon = computed(() => ICONS[props.kind]);
</script>

<template>
  <div class="toast" :class="kind" :role="kind === 'err' ? 'alert' : 'status'">
    <DsIcon :name="icon" :size="15" />
    <b>{{ title }}</b>
    <button type="button" class="x" :aria-label="t('fq.ds.close')" @click="emit('close')">
      <DsIcon name="x" :size="13" />
    </button>
    <div v-if="body" class="tb">{{ body }}</div>
    <div v-if="meta" class="meta">{{ meta }}</div>
    <div v-if="actions?.length" class="ta">
      <button
        v-for="a in actions"
        :key="a.id"
        type="button"
        class="act"
        @click="emit('action', a.id)"
      >
        {{ a.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.toast {
  background: var(--bg-1);
  color: var(--fg);
  border-radius: var(--r-2);
  box-shadow: var(--shadow-float);
  padding: 10px 12px 10px 14px;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  gap: 2px 9px;
  position: relative;
  overflow: hidden;
  font-family: var(--font-ui);
  font-size: var(--t-sm);
}
.toast::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--fg-3);
}
.sent::before {
  background: var(--info);
}
.ok::before {
  background: var(--profit);
}
.verify::before {
  background: var(--warn);
}
.err::before {
  background: var(--crit);
}
.sent > :first-child {
  color: var(--info);
}
.ok > :first-child {
  color: var(--profit);
}
.verify > :first-child {
  color: var(--warn);
}
.err > :first-child {
  color: var(--crit);
}
b {
  font-weight: 600;
}
.tb {
  grid-column: 2 / 4;
  color: var(--fg-2);
}
.meta {
  grid-column: 2 / 4;
  font: 500 var(--t-xs) var(--font-num);
  color: var(--fg-3);
  margin-top: 2px;
}
.ta {
  grid-column: 2 / 4;
  display: flex;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.act {
  height: 26px;
  padding: 0 8px;
  border-radius: var(--r-2);
  border: 1px solid var(--line-2);
  background: var(--bg-2);
  color: var(--fg);
  font: inherit;
  font-size: var(--t-xs);
  cursor: pointer;
}
.act:hover {
  background: var(--bg-3);
}
.x {
  background: none;
  border: 0;
  color: var(--fg-3);
  padding: 0;
  cursor: pointer;
  display: inline-grid;
  place-items: center;
}
@media (max-width: 599px), (pointer: coarse) {
  .act {
    height: 44px;
  }
  .x {
    width: 44px;
    height: 44px;
    margin: -12px -12px 0 0;
  }
}
</style>
