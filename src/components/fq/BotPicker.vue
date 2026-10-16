<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { Btn, Menu } from '@/components/ds';
import type { MenuItem } from '@/components/ds';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import type { BotKey, BotMode } from '@/gateway/types.gen';

/**
 * One bot chosen from the fleet, for the pages that work on a single bot (Tools > Diagnostic,
 * Volume, Replay). Bots are grouped by mode and sorted by name; `modes` narrows the list.
 */
const props = withDefaults(
  defineProps<{
    modelValue: BotKey | null;
    modes?: BotMode[];
    label?: string;
  }>(),
  { modes: () => ['live', 'dry'] },
);
const emit = defineEmits<{ 'update:modelValue': [botKey: BotKey] }>();

const { t } = useI18n();
const fleet = useFqFleetStore();

const anchor = ref<HTMLElement | null>(null);
const open = ref(false);
const items = computed<MenuItem[]>(() => {
  const out: MenuItem[] = [];
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  for (const mode of props.modes) {
    const bots = fleet.list
      .filter((b) => b.identity.mode === mode)
      .sort((a, b) => collator.compare(a.identity.name, b.identity.name));
    if (bots.length === 0) continue;
    if (props.modes.length > 1) {
      out.push({ id: `__h-${mode}`, kind: 'heading', label: t(`fq.scope.${mode}`) });
    }
    for (const b of bots) out.push({ id: b.bot_key, label: b.identity.name });
  }
  return out;
});
const name = computed(() =>
  props.modelValue ? (fleet.bots[props.modelValue]?.identity.name ?? props.modelValue) : null,
);

function toggle(e: MouseEvent) {
  anchor.value = e.currentTarget as HTMLElement;
  open.value = !open.value;
}
</script>

<template>
  <span class="bp">
    <Btn
      size="sm"
      icon="bot"
      :aria-expanded="open"
      aria-haspopup="menu"
      data-testid="bot-picker"
      @click="toggle"
    >
      <span class="lab">{{ label ?? t('fq.pg.tools.bot') }}</span>
      <b>{{ name ?? t('fq.ds.dash') }}</b>
    </Btn>
    <Menu
      :open="open"
      :anchor="anchor"
      :items="items"
      :label="label ?? t('fq.pg.tools.bot')"
      @select="(k) => emit('update:modelValue', k)"
      @close="open = false"
    />
  </span>
</template>

<style scoped>
.lab {
  color: var(--fg-3);
  margin-right: 6px;
}
</style>
