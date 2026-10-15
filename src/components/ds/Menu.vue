<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import DsIcon from './DsIcon.vue';
import Popover from './Popover.vue';
import type { MenuItem } from './types';

/**
 * Action menu. Destructive items are always isolated at the end, after a separator
 * (docs/redesign/02-design.md, section 8), whatever their position in `items`.
 */
const props = defineProps<{
  open: boolean;
  anchor: HTMLElement | null;
  items: MenuItem[];
  label?: string;
  inline?: boolean;
}>();

const emit = defineEmits<{ select: [id: string]; close: [] }>();

const list = ref<HTMLElement | null>(null);

/** Safe items first, then a separator, then the danger items. */
const ordered = computed<MenuItem[]>(() => {
  const safe = props.items.filter((i) => !i.danger);
  const danger = props.items.filter((i) => i.danger);
  if (danger.length === 0) {
    return safe;
  }
  const last = safe[safe.length - 1];
  return [
    ...safe,
    ...(last && last.kind !== 'separator' ? [{ id: '__sep', kind: 'separator' as const }] : []),
    ...danger,
  ];
});

function choose(item: MenuItem) {
  if (item.disabled || item.kind === 'separator' || item.kind === 'heading') {
    return;
  }
  emit('select', item.id);
  emit('close');
}

function buttons(): HTMLElement[] {
  return Array.from(
    list.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ??
      [],
  );
}

function onKeydown(event: KeyboardEvent) {
  const all = buttons();
  const i = all.indexOf(document.activeElement as HTMLElement);
  let next = -1;
  if (event.key === 'ArrowDown') {
    next = (i + 1) % all.length;
  } else if (event.key === 'ArrowUp') {
    next = (i - 1 + all.length) % all.length;
  } else if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = all.length - 1;
  }
  if (next >= 0) {
    event.preventDefault();
    all[next]?.focus();
  }
}

watch(
  () => props.open,
  async (o) => {
    if (o) {
      await nextTick();
      await nextTick();
      buttons()[0]?.focus();
    }
  },
  { flush: 'post' },
);
</script>

<template>
  <Popover
    :open="open"
    :anchor="anchor"
    :label="label"
    role="menu"
    :inline="inline"
    @close="emit('close')"
  >
    <div ref="list" class="menu" @keydown="onKeydown">
      <template v-for="item in ordered" :key="item.id">
        <hr v-if="item.kind === 'separator'" />
        <h4 v-else-if="item.kind === 'heading'">{{ item.label }}</h4>
        <button
          v-else
          type="button"
          role="menuitem"
          class="mi"
          :class="{ danger: item.danger }"
          :aria-disabled="item.disabled || undefined"
          :title="item.disabled ? item.disabledReason : undefined"
          @click="choose(item)"
        >
          <DsIcon v-if="item.icon" :name="item.icon" />
          <span class="lbl">{{ item.label }}</span>
          <span v-if="item.shortcut" class="k">{{ item.shortcut }}</span>
        </button>
      </template>
    </div>
  </Popover>
</template>

<style scoped>
h4 {
  margin: 4px 12px 6px;
  font-size: var(--t-xs);
  color: var(--fg-3);
  font-weight: 600;
}
.mi {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 12px;
  background: none;
  border: 0;
  text-align: left;
  color: var(--fg);
  font: inherit;
  font-size: var(--t-sm);
  cursor: pointer;
}
.mi:hover,
.mi:focus-visible {
  background: var(--bg-2);
}
.mi .lbl {
  flex: 1;
  min-width: 0;
}
.mi .k {
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.mi.danger {
  color: var(--loss);
}
.mi[aria-disabled='true'] {
  opacity: 0.45;
  cursor: not-allowed;
}
hr {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 5px 0;
}
@media (max-width: 599px), (pointer: coarse) {
  .mi {
    min-height: 44px;
  }
}
</style>
