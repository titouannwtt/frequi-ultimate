<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { Btn, FilterChip, Menu, SearchField, SegmentedControl } from '@/components/ds';
import type { MenuItem } from '@/components/ds';
import { useEdgeFade } from '@/components/ds/lib/useEdgeFade';
import { useScope, modeAllows } from '@/composables/useScope';
import { useShortcuts } from '@/composables/useShortcuts';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { ScopeMode, Workspace } from '@/migration/schema';

import FleetBotSelect from './FleetBotSelect.vue';

/**
 * The scope controls of the Fleet (docs/redesign/05-friendly-plan.md, L4): Live / Dry / All (the
 * dry segment carries the number of dry bots, so nothing is hidden silently), a "Filter" button
 * that opens the search, the group and tag chips and, only when a bot is in alert, the "In alert"
 * chip, and the page layout (Monitoring, Incident, Analysis) in a menu. The state lives in
 * `useScope()`, not here, so the selection survives a change of page. An active filter is always
 * visible: the row stays open and the button counts it. The "Bots N/M" button beside the mode opens
 * the list of bots to tick (FleetBotSelect); it too stands out as soon as a bot is unticked.
 */
const { t } = useI18n();
const scope = useScope();
const prefs = useFqPrefsStore();
const fleet = useFqFleetStore();

const root = ref<HTMLElement | null>(null);
const chips = ref<HTMLElement | null>(null);
useEdgeFade(chips);

const dryCount = computed(() => fleet.list.filter((b) => b.identity.mode === 'dry').length);
const modeOptions = computed(() => [
  { value: 'live' as ScopeMode, label: t('fq.scope.live') },
  {
    value: 'dry' as ScopeMode,
    label: t('fq.scope.dry'),
    ...(dryCount.value > 0 ? { count: dryCount.value } : {}),
  },
  { value: 'all' as ScopeMode, label: t('fq.scope.all') },
]);

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

// ---- filters: closed at rest, open while one is active ----
const filterOpen = ref(false);
const activeFilters = computed(
  () =>
    (scope.filters.query.trim() ? 1 : 0) +
    scope.filters.groups.length +
    scope.filters.tags.length +
    (scope.filters.attentionOnly ? 1 : 0),
);
const showFilters = computed(() => filterOpen.value || activeFilters.value > 0);
function toggleFilters() {
  if (activeFilters.value > 0) {
    scope.reset();
    filterOpen.value = false;
  } else {
    filterOpen.value = !filterOpen.value;
  }
}

const workspaces = computed(() => [
  { value: 'surveillance' as Workspace, label: t('fq.scope.ws.surveillance') },
  { value: 'incident' as Workspace, label: t('fq.scope.ws.incident') },
  { value: 'analysis' as Workspace, label: t('fq.scope.ws.analysis') },
]);

const wsAnchor = ref<HTMLElement | null>(null);
const wsOpen = ref(false);
const wsItems = computed<MenuItem[]>(() =>
  workspaces.value.map((w) => ({
    id: w.value,
    label: w.label,
    ...(scope.workspace.value === w.value ? { icon: 'check' as const } : {}),
  })),
);
function toggleWs(e: MouseEvent) {
  wsAnchor.value = e.currentTarget as HTMLElement;
  wsOpen.value = !wsOpen.value;
}
function onWsSelect(id: string) {
  scope.workspace.value = id as Workspace;
}

function focusSearch() {
  filterOpen.value = true;
  void nextTick(() => root.value?.querySelector<HTMLInputElement>('input[type="search"]')?.focus());
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
    <div class="bar">
      <SegmentedControl
        :options="modeOptions"
        :model-value="scope.mode.value"
        :label="t('fq.scope.modeLabel')"
        @update:model-value="scope.mode.value = $event"
      />
      <FleetBotSelect />
      <Btn
        class="fbtn"
        variant="ghost"
        size="sm"
        :icon="activeFilters > 0 ? 'x' : 'list-filter'"
        :aria-expanded="showFilters"
        data-testid="fleet-filter-toggle"
        @click="toggleFilters"
      >
        {{ t('fq.pg.fleet.filter.button')
        }}<span v-if="activeFilters > 0" class="n num"> {{ activeFilters }}</span>
      </Btn>
      <span class="sp"></span>
      <div class="ws">
        <Btn
          size="sm"
          variant="ghost"
          icon="layout-grid"
          :aria-expanded="wsOpen"
          :title="t('fq.pg.fleet.workspace.hint')"
          data-testid="fleet-workspace"
          @click="toggleWs"
        >
          {{ t('fq.pg.fleet.workspace.button') }}
        </Btn>
        <Menu
          :open="wsOpen"
          :anchor="wsAnchor"
          :items="wsItems"
          :label="t('fq.scope.ws.label')"
          @select="onWsSelect"
          @close="wsOpen = false"
        />
      </div>
    </div>
    <div v-if="showFilters" class="filters" :aria-label="t('fq.pg.fleet.filter.label')">
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
          v-if="attentionCount > 0 || scope.filters.attentionOnly"
          :label="t('fq.scope.attention')"
          icon="triangle-alert"
          :count="attentionCount"
          :active="scope.filters.attentionOnly"
          @toggle="scope.filters.attentionOnly = !scope.filters.attentionOnly"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.scope {
  display: grid;
  gap: var(--s2);
  min-width: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: var(--s2);
  min-width: 0;
}
.sp {
  flex: 1;
}
.n {
  color: var(--fg-3);
}
.filters {
  display: flex;
  align-items: center;
  gap: var(--gut);
  min-width: 0;
}
.q {
  width: clamp(180px, 22vw, 280px);
  flex: none;
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
  flex: none;
}
@media (max-width: 599px), (pointer: coarse) {
  .fbtn {
    min-height: 44px;
  }
}
@media (max-width: 599px) {
  /* The mode, the bots and the filter share the row while they fit, and wrap rather than push the
     page sideways (the layout menu is a wide-screen control: hidden below) */
  .bar {
    flex-wrap: wrap;
  }
  .filters {
    flex-wrap: wrap;
  }
  .q {
    width: 100%;
    flex: 1 1 100%;
  }
  .chips {
    flex: 1 1 100%;
  }
  .ws {
    display: none;
  }
}
</style>
