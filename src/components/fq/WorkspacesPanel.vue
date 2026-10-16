<script setup lang="ts">
import { computed, ref } from 'vue';
import { useLocalStorage } from '@vueuse/core';
import { useI18n } from 'vue-i18n';

import { Badge, Btn, FormRow } from '@/components/ds';
import { useScope } from '@/composables/useScope';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { ColumnPreset, Workspace } from '@/migration/schema';

import {
  customizedColumns,
  defaultScopeBlock,
  FLEET_VIEW_KEY,
  JOURNAL_VIEWS_KEY,
  WORKSPACES,
  withoutColumns,
} from './lib/workspaces';

/**
 * Settings > Workspaces (02 section 3.6, 6): what the interface remembers about its layout, each
 * with its own reset. The three workspaces only remember which one is active (the zones of the
 * Fleet page follow it), so their reset puts the scope back to live and Surveillance; the table
 * columns, the table-or-map choice and the saved Journal views are reset one by one. A reset asks
 * for a second click, then says it was done.
 */
const { t } = useI18n();
const prefs = useFqPrefsStore();
const scope = useScope();
const fleetView = useLocalStorage<string | null>(FLEET_VIEW_KEY, null);
const journalViews = useLocalStorage<unknown[]>(JOURNAL_VIEWS_KEY, []);

const armed = ref<string | null>(null);
const done = ref<string | null>(null);

const columns = computed(() => customizedColumns(prefs.settings.columns));
const workspace = computed<Workspace>(() => prefs.settings.scope.workspace);

function ask(id: string, run: () => void) {
  if (armed.value !== id) {
    armed.value = id;
    done.value = null;
    return;
  }
  run();
  armed.value = null;
  done.value = id;
}

const resetScope = () => {
  prefs.update('scope', defaultScopeBlock());
  scope.reset();
};
const resetColumns = (p: ColumnPreset | 'all') =>
  prefs.update('columns', withoutColumns(prefs.settings.columns, p));
const resetFleetView = () => {
  fleetView.value = null;
};
const resetJournalViews = () => {
  journalViews.value = [];
};
</script>

<template>
  <div class="wp" data-testid="workspaces-panel">
    <FormRow :label="t('fq.pg.settings.ws.active')" :hint="t('fq.pg.settings.ws.activeHint')">
      <Badge kind="info" :label="t(`fq.scope.ws.${workspace}`)" />
    </FormRow>
    <FormRow
      v-for="w in WORKSPACES"
      :key="w"
      :label="t(`fq.scope.ws.${w}`)"
      :hint="t(`fq.pg.settings.ws.desc.${w}`)"
    >
      <Btn
        size="sm"
        :variant="armed === `ws-${w}` ? 'danger' : 'secondary'"
        :data-reset="`ws-${w}`"
        @click="ask(`ws-${w}`, resetScope)"
        >{{ armed === `ws-${w}` ? t('fq.pg.settings.confirm') : t('fq.pg.settings.reset') }}</Btn
      >
      <span v-if="done === `ws-${w}`" class="ok">{{ t('fq.pg.settings.done') }}</span>
    </FormRow>

    <h3>{{ t('fq.pg.settings.ws.saved') }}</h3>
    <FormRow
      :label="t('fq.pg.settings.ws.columns')"
      :hint="
        columns.length > 0
          ? t('fq.pg.settings.ws.columnsSome', { list: columns.map((c) => t(`fq.pg.settings.ws.preset.${c}`)).join(', ') })
          : t('fq.pg.settings.ws.columnsNone')
      "
    >
      <Btn
        size="sm"
        :disabled="columns.length === 0"
        :variant="armed === 'cols-all' ? 'danger' : 'secondary'"
        data-reset="cols-all"
        @click="ask('cols-all', () => resetColumns('all'))"
        >{{ armed === 'cols-all' ? t('fq.pg.settings.confirm') : t('fq.pg.settings.ws.resetAll') }}</Btn
      >
      <span v-if="done === 'cols-all'" class="ok">{{ t('fq.pg.settings.done') }}</span>
    </FormRow>
    <FormRow
      v-for="p in columns"
      :key="p"
      :label="t(`fq.pg.settings.ws.preset.${p}`)"
    >
      <Btn
        size="sm"
        :variant="armed === `cols-${p}` ? 'danger' : 'secondary'"
        :data-reset="`cols-${p}`"
        @click="ask(`cols-${p}`, () => resetColumns(p))"
        >{{ armed === `cols-${p}` ? t('fq.pg.settings.confirm') : t('fq.pg.settings.reset') }}</Btn
      >
    </FormRow>
    <FormRow :label="t('fq.pg.settings.ws.fleetView')" :hint="t('fq.pg.settings.ws.fleetViewHint')">
      <Btn
        size="sm"
        :disabled="fleetView === null"
        :variant="armed === 'fleet-view' ? 'danger' : 'secondary'"
        data-reset="fleet-view"
        @click="ask('fleet-view', resetFleetView)"
        >{{ armed === 'fleet-view' ? t('fq.pg.settings.confirm') : t('fq.pg.settings.reset') }}</Btn
      >
      <span v-if="done === 'fleet-view'" class="ok">{{ t('fq.pg.settings.done') }}</span>
    </FormRow>
    <FormRow
      :label="t('fq.pg.settings.ws.journalViews')"
      :hint="t('fq.pg.settings.ws.journalViewsHint', { n: journalViews.length })"
    >
      <Btn
        size="sm"
        :disabled="journalViews.length === 0"
        :variant="armed === 'journal-views' ? 'danger' : 'secondary'"
        data-reset="journal-views"
        @click="ask('journal-views', resetJournalViews)"
        >{{ armed === 'journal-views' ? t('fq.pg.settings.confirm') : t('fq.pg.settings.reset') }}</Btn
      >
      <span v-if="done === 'journal-views'" class="ok">{{ t('fq.pg.settings.done') }}</span>
    </FormRow>
  </div>
</template>

<style scoped>
h3 {
  margin: var(--s3) 0 0;
  font-size: var(--t-md);
  font-weight: 600;
  color: var(--fg-2);
}
.ok {
  color: var(--profit);
  font-size: var(--t-sm);
}
</style>
