<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { AdaptiveSheet } from '@/components/ds';
import { shortcutRegistry, type Shortcut } from '@/composables/useShortcuts';

/** The help sheet of the keyboard shortcuts (`?`), built from the live registry (02 section 2.6). */
defineProps<{ open: boolean; inline?: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();

const GROUPS: Shortcut['group'][] = ['goto', 'list', 'actions', 'display', 'general'];

function label(s: Shortcut): string {
  const keys = s.keys
    .split(' ')
    .map((k) => (k.length === 1 ? k.toUpperCase() : k))
    .join(' ');
  return `${s.mod ? 'Ctrl ' : ''}${s.alt ? 'Alt ' : ''}${keys}`;
}

const groups = computed(() =>
  GROUPS.map((g) => ({
    id: g,
    items: shortcutRegistry.value.filter((s) => s.group === g),
  })).filter((g) => g.items.length > 0),
);
</script>

<template>
  <AdaptiveSheet
    :open="open"
    :title="t('fq.shortcut.help')"
    :inline="inline"
    @close="emit('close')"
  >
    <div class="help" data-testid="shortcut-help">
      <section v-for="g in groups" :key="g.id">
        <h4>{{ t(`fq.shortcut.group.${g.id}`) }}</h4>
        <dl>
          <template v-for="s in g.items" :key="s.id">
            <dt>
              <kbd>{{ label(s) }}</kbd>
            </dt>
            <dd>{{ t(s.labelKey) }}</dd>
          </template>
        </dl>
      </section>
    </div>
  </AdaptiveSheet>
</template>

<style scoped>
.help {
  padding: var(--s3);
  display: grid;
  gap: var(--s4);
  text-align: left;
}
h4 {
  margin: 0 0 var(--s2);
  font-size: var(--t-md);
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px var(--s3);
  margin: 0;
}
dt {
  white-space: nowrap;
}
dd {
  margin: 0;
  color: var(--fg-2);
  font-size: var(--t-sm);
}
kbd {
  font: 500 var(--t-xs) var(--font-num);
  padding: 1px 6px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-1);
  background: var(--bg-2);
}
</style>
