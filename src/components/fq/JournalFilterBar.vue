<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  AdaptiveSheet,
  Btn,
  FilterChip,
  Menu,
  Popover,
  SearchField,
  SegmentedControl,
} from '@/components/ds';
import type { MenuItem } from '@/components/ds';
import type { ScopeMode } from '@/migration/schema';

import {
  defaultJournalFilters,
  JOURNAL_PERIODS,
  type DepthFilter,
  type JournalFilters,
  type JournalPeriod,
} from './lib/journalPage';

/**
 * The filter bar of the Journal (02 section 3.4, 05 section 2.6): period, Live / Dry / All (the
 * shared FleetScope mode), the always visible "Without replay" chip and the pair. Bots, side, exit
 * reason and DCA depth sit behind one "Filters (n)" button that opens a sheet; an active one stays
 * on the bar as a removable chip with its value, so no filter is silent. Saved views and the export
 * are in the "..." menu. The bar only edits the filters; the page turns them into a query.
 */
const props = defineProps<{
  modelValue: JournalFilters;
  mode: ScopeMode;
  /** Bots the scope offers, for the "Bots" chip. */
  botOptions: Array<{ key: string; name: string; mode: string }>;
  /** Exit reasons seen in the loaded set, with the raw value that filters. */
  reasons: Array<{ value: string; label: string; trades: number }>;
  /** The source gave the DCA depth of closed trades. */
  depthAvailable: boolean;
  /** Exporting the whole filtered set needs the gateway; direct mode exports the page. */
  exportScope: 'all' | 'page';
  exporting?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: JournalFilters];
  'update:mode': [value: ScopeMode];
  exportCsv: [];
}>();

const { t } = useI18n();

function patch(p: Partial<JournalFilters>) {
  emit('update:modelValue', { ...props.modelValue, ...p });
}

// ---- period ----
const periodOptions = computed(() =>
  JOURNAL_PERIODS.map((p) => ({ value: p, label: t(`fq.jr.period.${p}`) })),
);
const rangeOpen = ref(false);
// The range popover hangs under the period control (the segmented control sends no click event)
const periodEl = ref<{ $el: HTMLElement } | null>(null);
const rangeAnchor = computed(() => periodEl.value?.$el ?? null);
function setPeriod(p: JournalPeriod) {
  patch({ period: p });
  if (p === 'range') rangeOpen.value = true;
}
const dayInput = (ms: number | null) =>
  ms === null ? '' : new Date(ms).toISOString().slice(0, 10);
function setRange(end: 'fromMs' | 'toMs', value: string) {
  const ms =
    value === '' ? null : Date.parse(`${value}T${end === 'fromMs' ? '00:00:00' : '23:59:59'}Z`);
  patch({ range: { ...props.modelValue.range, [end]: Number.isFinite(ms) ? ms : null } });
}

// ---- mode ----
const modeOptions = computed(() =>
  (['live', 'dry', 'all'] as ScopeMode[]).map((m) => ({ value: m, label: t(`fq.scope.${m}`) })),
);

// ---- the filters sheet, the "..." menu and the saved views ----
const filtersOpen = ref(false);
const moreOpen = ref(false);
const viewsOpen = ref(false);
const moreAnchor = ref<HTMLElement | null>(null);
function openMore(e: Event) {
  moreAnchor.value = e.currentTarget as HTMLElement;
  moreOpen.value = !moreOpen.value;
}
function onMore(id: string) {
  if (id === 'csv') emit('exportCsv');
  else if (id === 'views') viewsOpen.value = true;
}

const sideOptions = computed(() => [
  { value: 'any', label: t('fq.jr.f.any') },
  { value: 'long', label: t('fq.side.long') },
  { value: 'short', label: t('fq.side.short') },
]);
const reasonOptions = computed(() =>
  props.reasons.map((r) => ({ value: r.value, label: `${r.label} · ${r.trades}` })),
);
const DEPTHS: Array<{ id: string; filter: DepthFilter | null }> = [
  { id: 'any', filter: null },
  { id: 'eq1', filter: { kind: 'eq', n: 1 } },
  { id: 'eq2', filter: { kind: 'eq', n: 2 } },
  { id: 'eq3', filter: { kind: 'eq', n: 3 } },
  { id: 'min4', filter: { kind: 'min', n: 4 } },
  { id: 'min5', filter: { kind: 'min', n: 5 } },
];
function depthId(d: DepthFilter | null): string {
  return d === null ? 'any' : `${d.kind === 'eq' ? 'eq' : 'min'}${d.n}`;
}
function depthLabel(d: DepthFilter | null): string {
  return d === null
    ? t('fq.jr.f.any')
    : d.kind === 'eq'
      ? t('fq.jr.f.depthEq', { n: d.n })
      : t('fq.jr.f.depthMin', { n: d.n });
}
const depthOptions = computed(() =>
  DEPTHS.map((d) => ({ value: d.id, label: depthLabel(d.filter) })),
);

const moreItems = computed<MenuItem[]>(() => [
  { id: 'views', label: t('fq.jr.views.title'), icon: 'bookmark' },
  {
    id: 'csv',
    label: t(props.exportScope === 'all' ? 'fq.jr.export.csvAll' : 'fq.jr.export.csvPage'),
    icon: 'download',
  },
  ...(props.exportScope === 'page'
    ? [{ id: '__note', kind: 'heading' as const, label: t('fq.jr.export.directNote') }]
    : []),
]);

const botQuery = ref('');
const botList = computed(() => {
  const q = botQuery.value.trim().toLowerCase();
  return props.botOptions.filter((b) => !q || b.name.toLowerCase().includes(q));
});
function toggleBot(key: string) {
  const cur = props.modelValue.bots;
  patch({ bots: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] });
}

// ---- chip values ----
const sideValue = computed(() =>
  props.modelValue.side ? t(`fq.side.${props.modelValue.side}`) : null,
);
const reasonValue = computed(() => {
  const v = props.modelValue.exitReason;
  if (v === null) return null;
  return props.reasons.find((r) => r.value === v)?.label ?? v;
});

const depthValue = computed(() =>
  props.modelValue.depth ? depthLabel(props.modelValue.depth) : null,
);
/** Filters hidden behind the button: the number says how many are on. */
const activeCount = computed(
  () =>
    (props.modelValue.bots.length > 0 ? 1 : 0) +
    (sideValue.value ? 1 : 0) +
    (reasonValue.value ? 1 : 0) +
    (depthValue.value ? 1 : 0),
);
function clearAll() {
  patch({ bots: [], side: null, exitReason: null, depth: null });
}

// ---- saved views (this device) ----
interface SavedView {
  id: string;
  name: string;
  filters: JournalFilters;
}
const views = useLocalStorage<SavedView[]>('fqu2.journal.views', []);
const viewName = ref('');
function saveView() {
  const name = viewName.value.trim();
  if (!name) return;
  views.value = [
    ...views.value.filter((v) => v.name !== name),
    { id: `v-${Date.now().toString(36)}`, name, filters: { ...props.modelValue } },
  ];
  viewName.value = '';
}
function applyView(v: SavedView) {
  emit('update:modelValue', { ...defaultJournalFilters(), ...v.filters });
  viewsOpen.value = false;
}
function dropView(id: string) {
  views.value = views.value.filter((v) => v.id !== id);
}
</script>

<template>
  <div class="jfb" role="toolbar" :aria-label="t('fq.jr.filters')" data-testid="journal-filters">
    <SegmentedControl
      ref="periodEl"
      class="period"
      :model-value="modelValue.period"
      :options="periodOptions"
      size="sm"
      :label="t('fq.jr.period.label')"
      data-testid="jf-period"
      @update:model-value="(p) => setPeriod(p as JournalPeriod)"
    />
    <Popover
      :open="rangeOpen"
      :anchor="rangeAnchor"
      :label="t('fq.jr.period.range')"
      @close="rangeOpen = false"
    >
      <div class="range">
        <label
          >{{ t('fq.jr.period.from') }}
          <input
            type="date"
            :value="dayInput(modelValue.range.fromMs)"
            @input="(e) => setRange('fromMs', (e.target as HTMLInputElement).value)"
        /></label>
        <label
          >{{ t('fq.jr.period.to') }}
          <input
            type="date"
            :value="dayInput(modelValue.range.toMs)"
            @input="(e) => setRange('toMs', (e.target as HTMLInputElement).value)"
        /></label>
      </div>
    </Popover>
    <SegmentedControl
      :model-value="mode"
      :options="modeOptions"
      size="sm"
      :label="t('fq.scope.modeLabel')"
      data-testid="jf-mode"
      @update:model-value="(m) => emit('update:mode', m as ScopeMode)"
    />
    <FilterChip
      :label="t('fq.jr.f.noReplay')"
      icon="rewind"
      :active="modelValue.sansReplay"
      removable
      :title="t('fq.jr.f.noReplayTip')"
      data-testid="jf-noreplay"
      @toggle="patch({ sansReplay: !modelValue.sansReplay })"
      @remove="patch({ sansReplay: false })"
    />

    <SearchField
      class="pair"
      :model-value="modelValue.pair"
      :placeholder="t('fq.jr.f.pair')"
      @update:model-value="(v) => patch({ pair: v })"
    />

    <Btn
      size="sm"
      icon="list-filter"
      class="fbtn"
      :class="{ on: activeCount > 0 }"
      data-testid="jf-filters"
      @click="filtersOpen = true"
      >{{ activeCount > 0 ? t('fq.jr.fs.buttonN', { n: activeCount }) : t('fq.jr.fs.button') }}</Btn
    >
    <FilterChip
      v-if="modelValue.bots.length > 0"
      :label="t('fq.jr.f.botsN', { n: modelValue.bots.length })"
      icon="bot"
      active
      removable
      data-testid="jf-bots"
      @toggle="filtersOpen = true"
      @remove="patch({ bots: [] })"
    />
    <FilterChip
      v-if="sideValue"
      :label="t('fq.jr.f.withValue', { label: t('fq.jr.f.side'), value: sideValue })"
      active
      removable
      data-testid="jf-side"
      @toggle="filtersOpen = true"
      @remove="patch({ side: null })"
    />
    <FilterChip
      v-if="reasonValue"
      :label="t('fq.jr.f.withValue', { label: t('fq.jr.f.reason'), value: reasonValue })"
      active
      removable
      data-testid="jf-reason"
      @toggle="filtersOpen = true"
      @remove="patch({ exitReason: null })"
    />
    <FilterChip
      v-if="depthValue"
      :label="t('fq.jr.f.withValue', { label: t('fq.jr.f.depth'), value: depthValue })"
      active
      removable
      data-testid="jf-depth"
      @toggle="filtersOpen = true"
      @remove="patch({ depth: null })"
    />

    <Btn
      size="sm"
      variant="ghost"
      icon="ellipsis"
      class="more"
      :busy="exporting"
      :aria-label="t('fq.jr.more')"
      :title="t('fq.jr.more')"
      aria-haspopup="menu"
      :aria-expanded="moreOpen"
      data-testid="jf-more"
      @click="openMore"
    />

    <Menu
      :open="moreOpen"
      :anchor="moreAnchor"
      :items="moreItems"
      :label="t('fq.jr.more')"
      @select="onMore"
      @close="moreOpen = false"
    />
    <Popover
      :open="viewsOpen"
      :anchor="moreAnchor"
      :label="t('fq.jr.views.title')"
      @close="viewsOpen = false"
    >
      <div class="views" data-testid="jf-view-list">
        <p v-if="views.length === 0" class="note">{{ t('fq.jr.views.none') }}</p>
        <div v-for="v in views" :key="v.id" class="vw">
          <button type="button" class="vn" @click="applyView(v)">{{ v.name }}</button>
          <Btn
            size="xs"
            variant="ghost"
            icon="trash-2"
            :aria-label="t('fq.jr.views.remove')"
            :title="t('fq.jr.views.remove')"
            @click="dropView(v.id)"
          />
        </div>
        <form class="save" @submit.prevent="saveView">
          <input
            v-model="viewName"
            :placeholder="t('fq.jr.views.name')"
            :aria-label="t('fq.jr.views.name')"
          />
          <Btn size="sm" type="submit" :disabled="viewName.trim() === ''">{{
            t('fq.jr.views.save')
          }}</Btn>
        </form>
      </div>
    </Popover>

    <AdaptiveSheet :open="filtersOpen" :title="t('fq.jr.fs.title')" @close="filtersOpen = false">
      <div class="fs" data-testid="jf-sheet">
        <section class="fsec">
          <h3>{{ t('fq.jr.f.bots') }}</h3>
          <SearchField v-model="botQuery" :placeholder="t('fq.jr.f.botSearch')" />
          <div class="botpick" data-testid="jf-bot-list">
            <label v-for="b in botList" :key="b.key" class="bp">
              <input
                type="checkbox"
                :checked="modelValue.bots.includes(b.key)"
                @change="toggleBot(b.key)"
              />
              <span>{{ b.name }}</span>
            </label>
            <p v-if="botList.length === 0" class="note">{{ t('fq.jr.f.noBots') }}</p>
          </div>
        </section>
        <section class="fsec">
          <h3>{{ t('fq.jr.f.side') }}</h3>
          <SegmentedControl
            :model-value="modelValue.side ?? 'any'"
            :options="sideOptions"
            size="sm"
            :label="t('fq.jr.f.side')"
            data-testid="jf-side-pick"
            @update:model-value="
              (v) => patch({ side: v === 'any' ? null : (v as 'long' | 'short') })
            "
          />
        </section>
        <section class="fsec">
          <h3>{{ t('fq.jr.f.reason') }}</h3>
          <select
            class="sel"
            :value="modelValue.exitReason ?? ''"
            :aria-label="t('fq.jr.f.reason')"
            data-testid="jf-reason-pick"
            @change="(e) => patch({ exitReason: (e.target as HTMLSelectElement).value || null })"
          >
            <option value="">{{ t('fq.jr.f.any') }}</option>
            <option v-for="r in reasonOptions" :key="r.value" :value="r.value">
              {{ r.label }}
            </option>
          </select>
        </section>
        <section class="fsec">
          <h3>{{ t('fq.jr.f.depth') }}</h3>
          <select
            class="sel"
            :value="depthId(modelValue.depth)"
            :disabled="!depthAvailable"
            :aria-label="t('fq.jr.f.depth')"
            data-testid="jf-depth-pick"
            @change="
              (e) =>
                patch({
                  depth:
                    DEPTHS.find((d) => d.id === (e.target as HTMLSelectElement).value)?.filter ??
                    null,
                })
            "
          >
            <option v-for="d in depthOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
          <p v-if="!depthAvailable" class="note">{{ t('fq.jr.f.depthMissing') }}</p>
        </section>
      </div>
      <template #footer>
        <div class="ff">
          <Btn variant="ghost" :disabled="activeCount === 0" @click="clearAll">{{
            t('fq.jr.fs.clear')
          }}</Btn>
          <Btn variant="primary" data-testid="jf-sheet-done" @click="filtersOpen = false">{{
            t('fq.jr.fs.done')
          }}</Btn>
        </div>
      </template>
    </AdaptiveSheet>
  </div>
</template>

<style scoped>
.jfb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px var(--s3);
  background: var(--bg);
  border-bottom: 1px solid var(--line);
}
.jfb > :deep(*) {
  flex: none;
}
.pair {
  width: 160px;
}
.fbtn.on {
  border-color: var(--accent);
  color: var(--accent);
}
.more {
  margin-left: auto;
}
@media (max-width: 599px) {
  /* The period takes its own line, then the mode, the pair and the buttons share the next ones */
  .jfb > :deep(:first-child) {
    max-width: 100%;
  }
  /* The seven periods share the width of the screen instead of scrolling past its edge */
  .period {
    display: flex;
    width: 100%;
  }
  .period :deep(button) {
    flex: 1 1 auto;
    justify-content: center;
    padding: 0 4px;
  }
  .pair {
    flex: 1 1 130px;
    width: auto;
    min-width: 0;
  }
}
.fs {
  display: grid;
  gap: var(--s4);
  padding: var(--s3);
}
.fsec {
  display: grid;
  gap: var(--s2);
  align-content: start;
  min-width: 0;
}
.fsec h3 {
  margin: 0;
  font-size: var(--t-label);
  font-weight: 600;
  color: var(--fg-3);
}
.sel {
  background: var(--bg-2);
  color: var(--fg);
  border: 1px solid var(--line-2);
  border-radius: var(--r-2);
  padding: 0 8px;
  height: var(--ctl);
  min-width: 0;
  font: inherit;
}
.sel:disabled {
  opacity: 0.5;
}
.ff {
  display: flex;
  justify-content: space-between;
  gap: var(--s2);
}
.range {
  display: grid;
  gap: var(--s2);
  padding: var(--s2) var(--s3);
  font-size: var(--t-sm);
}
.range label {
  display: grid;
  gap: 2px;
  color: var(--fg-3);
}
input[type='date'],
.save input {
  background: var(--bg-2);
  color: var(--fg);
  border: 1px solid var(--line-2);
  border-radius: var(--r-2);
  padding: 6px 8px;
  font: inherit;
}
.botpick {
  display: grid;
  gap: 2px;
  max-height: 220px;
  overflow: auto;
}
.views {
  display: grid;
  gap: 2px;
  padding: var(--s2) var(--s3);
  max-height: 320px;
  overflow: auto;
}
.bp {
  display: flex;
  gap: var(--s2);
  align-items: center;
  min-height: 36px;
  font-size: var(--t-sm);
  cursor: pointer;
}
@media (max-width: 599px), (pointer: coarse) {
  .bp {
    min-height: 44px;
  }
}
.vw {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.vn {
  background: none;
  border: 0;
  color: var(--fg);
  font: inherit;
  padding: 6px 0;
  text-align: left;
  cursor: pointer;
}
.vn:hover {
  color: var(--accent);
}
.save {
  display: flex;
  gap: var(--s2);
  padding-top: var(--s2);
}
.save input {
  flex: 1;
  min-width: 0;
}
.note {
  margin: 0;
  padding: var(--s2) var(--s3);
  color: var(--fg-3);
  font-size: var(--t-xs);
}
</style>
