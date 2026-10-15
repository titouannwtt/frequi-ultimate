<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { Btn, FilterChip, Menu, SearchField, SegmentedControl } from '@/components/ds';
import type { MenuItem } from '@/components/ds';
import { useEdgeFade } from '@/components/ds/lib/useEdgeFade';
import { useScope, modeAllows } from '@/composables/useScope';
import { useShortcuts } from '@/composables/useShortcuts';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { ScopeMode, Workspace } from '@/migration/schema';

/**
 * The scope bar shared by every fleet view and kept between pages (02 sections 3.1 and 5.2):
 * Live / Dry / All, search, groups, tags, "needs attention" and the workspace. The state lives in
 * `useScope()`, not here, so the selection survives a change of page. An active filter is always
 * a solid chip: no filter is silent.
 */
const { t } = useI18n();
const scope = useScope();
const prefs = useFqPrefsStore();
const fleet = useFqFleetStore();

const root = ref<HTMLElement | null>(null);
const chips = ref<HTMLElement | null>(null);
useEdgeFade(chips);

const modeOptions = computed(() => [
  { value: 'live' as ScopeMode, label: t('fq.scope.live') },
  { value: 'dry' as ScopeMode, label: t('fq.scope.dry') },
  { value: 'all' as ScopeMode, label: t('fq.scope.all') },
]);

/** Dry bots hidden by the live mode: said out loud, never silent. */
const hiddenDry = computed(() =>
  scope.mode.value === 'live' ? fleet.list.filter((b) => b.identity.mode === 'dry').length : 0,
);

const inMode = computed(() => fleet.list.filter((b) => modeAllows(b, scope.mode.value)));
const attentionCount = computed(() => inMode.value.filter((b) => b.alerts.count > 0).length);

const groupChips = computed(() =>
  prefs.settings.fleet.groups.map((g) => ({
    id: g.id,
    name: g.name,
    count: inMode.value.filter((b) => g.botKeys.includes(b.bot_key)).length,
  })),
);
const tagChips = computed(() =>
  prefs.settings.fleet.customTags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    count: inMode.value.filter((b) =>
      (prefs.settings.fleet.botCustomTags[b.bot_key] ?? []).includes(tag.id),
    ).length,
  })),
);

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

const workspaces = computed(() => [
  { value: 'surveillance' as Workspace, label: t('fq.scope.ws.surveillance') },
  { value: 'incident' as Workspace, label: t('fq.scope.ws.incident') },
  { value: 'analysis' as Workspace, label: t('fq.scope.ws.analysis') },
]);

// From 1440 px the workspaces are a segment; under it they fold into one menu button
const wide = useMediaQuery('(min-width: 1440px)');
const wsAnchor = ref<HTMLElement | null>(null);
const wsOpen = ref(false);
const wsItems = computed<MenuItem[]>(() => [
  ...workspaces.value.map((w) => ({ id: w.value, label: w.label })),
  { id: '__sep', kind: 'separator' as const },
  { id: 'customize', label: t('fq.scope.ws.customize') },
]);
const wsLabel = computed(
  () => workspaces.value.find((w) => w.value === scope.workspace.value)?.label ?? '',
);
const emit = defineEmits<{ customize: [] }>();
function toggleWs(e: MouseEvent) {
  wsAnchor.value = e.currentTarget as HTMLElement;
  wsOpen.value = !wsOpen.value;
}
function onWsSelect(id: string) {
  if (id === 'customize') emit('customize');
  else scope.workspace.value = id as Workspace;
}

function focusSearch() {
  root.value?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
}
useShortcuts([
  {
    id: 'scope.focusSearch',
    keys: 'f',
    labelKey: 'fq.shortcut.focusSearch',
    group: 'list',
    run: () => focusSearch(),
  },
]);
defineExpose({ focusSearch });
</script>

<template>
  <div ref="root" class="scope" role="search" :aria-label="t('fq.scope.label')">
    <SegmentedControl
      :options="modeOptions"
      :model-value="scope.mode.value"
      size="sm"
      :label="t('fq.scope.modeLabel')"
      @update:model-value="scope.mode.value = $event"
    />
    <span v-if="hiddenDry > 0" class="hidden-dry">{{
      t('fq.scope.dryHidden', { n: hiddenDry })
    }}</span>
    <SearchField
      class="q"
      :model-value="scope.filters.query"
      :placeholder="t('fq.scope.search')"
      shortcut="F"
      @update:model-value="scope.filters.query = $event"
    />
    <div ref="chips" class="chips">
      <FilterChip
        v-for="g in groupChips"
        :key="g.id"
        :label="g.name"
        :count="g.count"
        :active="scope.filters.groups.includes(g.id)"
        @toggle="scope.filters.groups = toggle(scope.filters.groups, g.id)"
      />
      <FilterChip
        v-for="tg in tagChips"
        :key="tg.id"
        :label="tg.name"
        :count="tg.count"
        :active="scope.filters.tags.includes(tg.id)"
        @toggle="scope.filters.tags = toggle(scope.filters.tags, tg.id)"
      />
      <FilterChip
        :label="t('fq.scope.attention')"
        icon="triangle-alert"
        :count="attentionCount"
        :active="scope.filters.attentionOnly"
        @toggle="scope.filters.attentionOnly = !scope.filters.attentionOnly"
      />
    </div>
    <div class="ws">
      <span v-if="wide" class="ws-l">{{ t('fq.scope.ws.label') }}</span>
      <SegmentedControl
        v-if="wide"
        :options="workspaces"
        :model-value="scope.workspace.value"
        size="sm"
        :label="t('fq.scope.ws.label')"
        @update:model-value="scope.workspace.value = $event"
      />
      <template v-else>
        <Btn size="sm" icon="chevron-down" :aria-expanded="wsOpen" @click="toggleWs">
          {{ wsLabel }}
        </Btn>
        <Menu
          :open="wsOpen"
          :anchor="wsAnchor"
          :items="wsItems"
          :label="t('fq.scope.ws.label')"
          @select="onWsSelect"
          @close="wsOpen = false"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.scope {
  display: flex;
  align-items: center;
  gap: var(--gut);
  min-height: 40px;
  padding: 4px var(--s3);
  border-bottom: 1px solid var(--line);
  background: var(--bg);
  min-width: 0;
}
.q {
  width: clamp(180px, 22vw, 280px);
  flex: none;
}
.hidden-dry {
  font-size: var(--t-xs);
  color: var(--fg-3);
  white-space: nowrap;
}
.chips {
  display: flex;
  align-items: center;
  gap: var(--gut);
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.chips::-webkit-scrollbar {
  display: none;
}
.ws {
  display: flex;
  align-items: center;
  gap: var(--gut);
  margin-left: auto;
  flex: none;
}
.ws-l {
  font-size: var(--t-xs);
  color: var(--fg-3);
}
@media (max-width: 599px) {
  .scope {
    flex-wrap: wrap;
    padding: var(--s2);
  }
  .q {
    width: 100%;
    flex: 1 1 100%;
    order: 2;
  }
  .chips {
    flex: 1 1 100%;
    order: 3;
  }
  .ws {
    display: none;
  }
}
</style>
