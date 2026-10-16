<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { Btn, FilterChip, Menu, Popover, SearchField, SegmentedControl } from '@/components/ds';
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
 * The filter bar of the Journal (02 section 3.4): period, Live / Dry / All (the shared FleetScope
 * mode), the always visible "Without replay" chip, bots, side, exit reason, DCA depth, pair, saved
 * views and the export. An active filter is a solid chip with its value: no filter is silent. The
 * bar only edits the filters; the page turns them into a query.
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
const rangeAnchor = ref<HTMLElement | null>(null);
function setPeriod(p: JournalPeriod, e?: Event) {
  patch({ period: p });
  if (p === 'range') {
    rangeAnchor.value = ((e?.currentTarget as HTMLElement | null) ?? rangeAnchor.value) as HTMLElement | null;
    rangeOpen.value = true;
  }
}
const dayInput = (ms: number | null) => (ms === null ? '' : new Date(ms).toISOString().slice(0, 10));
function setRange(end: 'fromMs' | 'toMs', value: string) {
  const ms =
    value === ''
      ? null
      : Date.parse(`${value}T${end === 'fromMs' ? '00:00:00' : '23:59:59'}Z`);
  patch({ range: { ...props.modelValue.range, [end]: Number.isFinite(ms) ? ms : null } });
}

// ---- mode ----
const modeOptions = computed(() =>
  (['live', 'dry', 'all'] as ScopeMode[]).map((m) => ({ value: m, label: t(`fq.scope.${m}`) })),
);

// ---- menus: one at a time ----
type MenuId = 'side' | 'reason' | 'depth' | 'export' | 'views' | 'bots';
const open = ref<MenuId | null>(null);
const anchor = ref<HTMLElement | null>(null);
function toggle(id: MenuId, e: Event) {
  // The cross of a chip removes the filter; it does not open its menu
  if ((e.target as HTMLElement).closest?.('.x')) return;
  const el = e.currentTarget as HTMLElement;
  if (open.value === id) {
    open.value = null;
    return;
  }
  anchor.value = el;
  open.value = id;
}

const sideItems = computed<MenuItem[]>(() => [
  { id: 'any', label: t('fq.jr.f.any'), icon: props.modelValue.side === null ? 'check' : undefined },
  { id: 'long', label: t('fq.side.long'), icon: props.modelValue.side === 'long' ? 'check' : undefined },
  { id: 'short', label: t('fq.side.short'), icon: props.modelValue.side === 'short' ? 'check' : undefined },
]);
const reasonItems = computed<MenuItem[]>(() => [
  { id: '__any', label: t('fq.jr.f.any'), icon: props.modelValue.exitReason === null ? 'check' : undefined },
  ...props.reasons.map((r) => ({
    id: r.value,
    label: `${r.label} · ${r.trades}`,
    icon: props.modelValue.exitReason === r.value ? ('check' as const) : undefined,
  })),
]);
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
const depthItems = computed<MenuItem[]>(() =>
  DEPTHS.map((d) => ({
    id: d.id,
    label: depthLabel(d.filter),
    icon: depthId(props.modelValue.depth) === d.id ? ('check' as const) : undefined,
  })),
);

const exportItems = computed<MenuItem[]>(() => [
  {
    id: 'csv',
    label: t(props.exportScope === 'all' ? 'fq.jr.export.csvAll' : 'fq.jr.export.csvPage'),
    icon: 'file-text',
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
  open.value = null;
}
function dropView(id: string) {
  views.value = views.value.filter((v) => v.id !== id);
}
</script>

<template>
  <div class="jfb" role="toolbar" :aria-label="t('fq.jr.filters')" data-testid="journal-filters">
    <SegmentedControl
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

    <span class="cw" @click="toggle('bots', $event)">
      <FilterChip
        :label="
          modelValue.bots.length > 0
            ? t('fq.jr.f.botsN', { n: modelValue.bots.length })
            : t('fq.jr.f.bots')
        "
        icon="bot"
        :active="modelValue.bots.length > 0"
        :removable="modelValue.bots.length > 0"
        data-testid="jf-bots"
        @remove="patch({ bots: [] })"
      />
    </span>
    <span class="cw" @click="toggle('side', $event)">
      <FilterChip
        :label="sideValue ? t('fq.jr.f.withValue', { label: t('fq.jr.f.side'), value: sideValue }) : t('fq.jr.f.side')"
        :active="sideValue !== null"
        :removable="sideValue !== null"
        data-testid="jf-side"
        @remove="patch({ side: null })"
      />
    </span>
    <span class="cw" @click="toggle('reason', $event)">
      <FilterChip
        :label="reasonValue ? t('fq.jr.f.withValue', { label: t('fq.jr.f.reason'), value: reasonValue }) : t('fq.jr.f.reason')"
        :active="reasonValue !== null"
        :removable="reasonValue !== null"
        data-testid="jf-reason"
        @remove="patch({ exitReason: null })"
      />
    </span>
    <span
      class="cw"
      :title="depthAvailable ? undefined : t('fq.jr.f.depthMissing')"
      @click="depthAvailable && toggle('depth', $event)"
    >
      <FilterChip
        :label="
          modelValue.depth
            ? t('fq.jr.f.withValue', { label: t('fq.jr.f.depth'), value: depthLabel(modelValue.depth) })
            : t('fq.jr.f.depth')
        "
        :active="modelValue.depth !== null"
        :removable="modelValue.depth !== null"
        :class="{ off: !depthAvailable }"
        data-testid="jf-depth"
        @remove="patch({ depth: null })"
      />
    </span>
    <SearchField
      class="pair"
      :model-value="modelValue.pair"
      :placeholder="t('fq.jr.f.pair')"
      @update:model-value="(v) => patch({ pair: v })"
    />

    <span class="right">
      <Btn size="sm" variant="ghost" icon="bookmark" data-testid="jf-views" @click="toggle('views', $event)">{{
        t('fq.jr.views.title')
      }}</Btn>
      <Btn
        size="sm"
        icon="download"
        :busy="exporting"
        data-testid="jf-export"
        @click="toggle('export', $event)"
        >{{ t('fq.jr.export.title') }}</Btn
      >
    </span>

    <Menu
      :open="open === 'side'"
      :anchor="anchor"
      :items="sideItems"
      :label="t('fq.jr.f.side')"
      @select="(id) => patch({ side: id === 'any' ? null : (id as 'long' | 'short') })"
      @close="open = null"
    />
    <Menu
      :open="open === 'reason'"
      :anchor="anchor"
      :items="reasonItems"
      :label="t('fq.jr.f.reason')"
      @select="(id) => patch({ exitReason: id === '__any' ? null : id })"
      @close="open = null"
    />
    <Menu
      :open="open === 'depth'"
      :anchor="anchor"
      :items="depthItems"
      :label="t('fq.jr.f.depth')"
      @select="(id) => patch({ depth: DEPTHS.find((d) => d.id === id)?.filter ?? null })"
      @close="open = null"
    />
    <Menu
      :open="open === 'export'"
      :anchor="anchor"
      :items="exportItems"
      :label="t('fq.jr.export.title')"
      @select="(id) => id === 'csv' && emit('exportCsv')"
      @close="open = null"
    />
    <Popover :open="open === 'bots'" :anchor="anchor" :label="t('fq.jr.f.bots')" @close="open = null">
      <div class="botpick" data-testid="jf-bot-list">
        <SearchField v-model="botQuery" :placeholder="t('fq.jr.f.botSearch')" />
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
    </Popover>
    <Popover :open="open === 'views'" :anchor="anchor" :label="t('fq.jr.views.title')" @close="open = null">
      <div class="views" data-testid="jf-view-list">
        <p v-if="views.length === 0" class="note">{{ t('fq.jr.views.none') }}</p>
        <div v-for="v in views" :key="v.id" class="vw">
          <button type="button" class="vn" @click="applyView(v)">{{ v.name }}</button>
          <Btn size="xs" variant="ghost" icon="trash-2" :title="t('fq.jr.views.remove')" @click="dropView(v.id)" />
        </div>
        <form class="save" @submit.prevent="saveView">
          <input v-model="viewName" :placeholder="t('fq.jr.views.name')" :aria-label="t('fq.jr.views.name')" />
          <Btn size="sm" type="submit" :disabled="viewName.trim() === ''">{{ t('fq.jr.views.save') }}</Btn>
        </form>
      </div>
    </Popover>
  </div>
</template>

<style scoped>
.jfb {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px var(--s3);
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  overflow-x: auto;
  scrollbar-width: none;
}
.jfb::-webkit-scrollbar {
  display: none;
}
.jfb > :deep(*) {
  flex: none;
}
.cw {
  display: inline-flex;
}
.off {
  opacity: 0.5;
}
.pair {
  width: 160px;
}
.right {
  margin-left: auto;
  display: flex;
  gap: 6px;
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
.botpick,
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
  min-height: 32px;
  font-size: var(--t-sm);
  cursor: pointer;
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
