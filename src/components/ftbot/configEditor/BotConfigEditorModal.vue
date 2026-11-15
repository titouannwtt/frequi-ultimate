<script setup lang="ts">
import type { CatalogField, ConfigFieldOption, ConfigSchemaField, EditorDiagnostic } from '@/types';
import { CONFIG_CATALOG, CATALOG_BY_PATH, CATALOG_PATHS } from '@/utils/configEditorCatalog';
import {
  deepGet,
  hasPath,
  deepSet,
  deepDelete,
  clone,
  diffConfig,
} from '@/utils/configEditorObject';
import { showAlert } from '@/utils/alerts';
import ConfigFieldRow from './ConfigFieldRow.vue';
import ConfigPairlistEditor from './ConfigPairlistEditor.vue';
import CodeEditor from '@/components/strategyDev/CodeEditor.vue';
import { useI18n } from 'vue-i18n';
import type { Component } from 'vue';
// Tab icons must be imported explicitly: unplugin-icons only auto-resolves icons used
// as static template tags, not dynamic `<component :is>` references.
import IMdiCashMultiple from '~icons/mdi/cash-multiple';
import IMdiCog from '~icons/mdi/cog';
import IMdiShieldAlert from '~icons/mdi/shield-alert';
import IMdiFormatListChecks from '~icons/mdi/format-list-checks';
import IMdiTag from '~icons/mdi/tag';
import IMdiFormatListBulleted from '~icons/mdi/format-list-bulleted';
import IMdiBell from '~icons/mdi/bell';
import IMdiLock from '~icons/mdi/lock';
import IMdiPlusBox from '~icons/mdi/plus-box';
import IMdiCodeJson from '~icons/mdi/code-json';

const store = useBotConfigEditorStore();
const { t, te } = useI18n();

const SCALAR_WIDGETS = new Set(['integer', 'number', 'text', 'toggle', 'select']);

type Dict = Record<string, unknown>;
const draft = ref<Dict>({});
const originalOwn = ref<Dict>({});
const activeTab = ref<string>('capital');
const rawText = ref('');
const rawError = ref<string | null>(null);
const serverDiagnostics = ref<EditorDiagnostic[]>([]);
const strategyOverrides = ref<Set<string>>(new Set());
const addedPaths = ref<string[]>([]);
const addSearch = ref('');
const postSaveVisible = ref(false);
const savedRestartNeeded = ref(false);
/** True when the entry file failed to load — editing/saving is blocked to avoid overwrites. */
const loadIncomplete = ref(false);

const merged = computed<Dict>(() => (store.botConfig?.merged as Dict) ?? {});
const entryEditable = computed(() => store.botConfig?.entry_editable ?? false);

let _validateTimer: ReturnType<typeof setTimeout> | null = null;
let _rawTimer: ReturnType<typeof setTimeout> | null = null;

function parseEntryContent(text: string): Dict | null {
  try {
    const o = JSON.parse(text);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Dict) : null;
  } catch {
    return null;
  }
}

// ── Init when bot config is (re)loaded ──
watch(
  () => store.botConfig,
  (cfg) => {
    if (!cfg) return;
    // Resolve the entry-file object robustly: prefer parsed `own`, then the raw
    // entry_content. If both are empty while the bot clearly has a config, flag the
    // load as incomplete and block saving — never overwrite the file with an empty draft.
    let own = cfg.own && Object.keys(cfg.own).length ? (cfg.own as Dict) : null;
    if (!own && cfg.entry_content) own = parseEntryContent(cfg.entry_content);
    loadIncomplete.value = !own && Object.keys((cfg.merged as Dict) ?? {}).length > 3;
    const base = own ?? {};
    originalOwn.value = clone(base);
    draft.value = clone(base);
    strategyOverrides.value = new Set();
    addedPaths.value = [];
    rawError.value = null;
    serverDiagnostics.value = [];
    activeTab.value = CONFIG_CATALOG[0].id;
    // Pre-mark strategy-sourced fields already overridden in the file.
    for (const f of CONFIG_CATALOG.flatMap((s) => s.fields)) {
      if (f.strategySourced && hasPath(draft.value, f.path)) {
        strategyOverrides.value.add(f.path);
      }
    }
    initRoiRows();
  },
  { immediate: true },
);

// ── Value resolution ──
function effectiveValue(path: string): unknown {
  if (hasPath(draft.value, path)) return deepGet(draft.value, path);
  return deepGet(merged.value, path);
}

function fieldSource(field: CatalogField): 'own' | 'inherited' | 'strategy' | 'default' {
  if (hasPath(draft.value, field.path)) return 'own';
  if (field.strategySourced) return 'strategy';
  if (deepGet(merged.value, field.path) !== undefined) return 'inherited';
  return 'default';
}

function isEditable(field: CatalogField): boolean {
  if (field.locked) return false;
  if (field.strategySourced) return strategyOverrides.value.has(field.path);
  return entryEditable.value;
}

function optionsFor(field: CatalogField): ConfigFieldOption[] | undefined {
  if (field.path === 'strategy') return store.strategies.map((s) => ({ value: s }));
  return field.options;
}

/** Strategy field falls back to a free-text input when no strategy list is available. */
function resolvedField(field: CatalogField): CatalogField {
  if (field.path === 'strategy' && store.strategies.length === 0) {
    return { ...field, widget: 'text' };
  }
  return field;
}

function schemaDefault(path: string): unknown {
  const sf = store.schemaFields.find((f) => f.path === path);
  if (sf?.default !== undefined) return sf.default;
  return undefined;
}

// ── Mutations ──
function setValue(path: string, value: unknown) {
  if (value === undefined) deepDelete(draft.value, path);
  else deepSet(draft.value, path, value);
}
function resetValue(path: string) {
  deepDelete(draft.value, path);
}
function toggleOverride(field: CatalogField, on: boolean) {
  if (on) {
    strategyOverrides.value.add(field.path);
    if (!hasPath(draft.value, field.path)) {
      const seed = deepGet(merged.value, field.path) ?? schemaDefault(field.path);
      if (seed !== undefined) deepSet(draft.value, field.path, clone(seed));
    }
  } else {
    strategyOverrides.value.delete(field.path);
    deepDelete(draft.value, field.path);
  }
  if (field.path === 'minimal_roi') initRoiRows();
}

// ── taglist (newline-separated string arrays) ──
function tagText(path: string): string {
  const v = effectiveValue(path);
  return Array.isArray(v) ? v.join('\n') : '';
}
function setTags(path: string, text: string) {
  const arr = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  setValue(path, arr.length ? arr : undefined);
}

// ── minimal_roi editor (local id-keyed rows, decoupled from the object form so add /
// remove / edit are robust against duplicate or colliding "minutes" keys) ──
interface RoiRow {
  id: number;
  minutes: number;
  ratio: number;
}
const roiRows = ref<RoiRow[]>([]);
let _roiSeq = 0;
function initRoiRows() {
  const v = effectiveValue('minimal_roi');
  roiRows.value =
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.entries(v as Record<string, number>)
          .map(([m, r]) => ({ id: _roiSeq++, minutes: Number(m), ratio: Number(r) }))
          .sort((a, b) => a.minutes - b.minutes)
      : [];
}
function serializeRoi() {
  const obj: Record<string, number> = {};
  for (const r of [...roiRows.value].sort((a, b) => a.minutes - b.minutes)) {
    obj[String(r.minutes)] = Number(r.ratio);
  }
  setValue('minimal_roi', obj);
}
function setRoiMinutes(id: number, minutes: number) {
  const row = roiRows.value.find((r) => r.id === id);
  if (row) {
    row.minutes = minutes;
    serializeRoi();
  }
}
function setRoiRatio(id: number, ratio: number) {
  const row = roiRows.value.find((r) => r.id === id);
  if (row) {
    row.ratio = ratio;
    serializeRoi();
  }
}
function addRoi() {
  const nextMin = roiRows.value.length ? Math.max(...roiRows.value.map((r) => r.minutes)) + 30 : 0;
  roiRows.value.push({ id: _roiSeq++, minutes: nextMin, ratio: 0 });
  serializeRoi();
}
function removeRoi(id: number) {
  roiRows.value = roiRows.value.filter((r) => r.id !== id);
  serializeRoi();
}

// ── Diff ──
const changes = computed(() =>
  diffConfig(originalOwn.value, draft.value).map((c) => {
    const cat = CATALOG_BY_PATH[c.path];
    return {
      ...c,
      label: cat && te(cat.labelKey) ? t(cat.labelKey) : c.path,
      restartRequired: cat?.restartRequired ?? false,
    };
  }),
);

// ── Validation ──
function validateField(field: CatalogField, value: unknown): string | null {
  const empty = value === undefined || value === null || value === '';
  if (field.required && empty && !hasPath(merged.value, field.path)) {
    return t('configEditor.errRequired');
  }
  if (empty) return null;
  if (field.unlimitedValue !== undefined && value === field.unlimitedValue) return null;
  if (field.widget === 'integer' || field.widget === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) return t('configEditor.errNumber');
    if (field.widget === 'integer' && !Number.isInteger(value)) return t('configEditor.errInteger');
    if (field.min !== undefined && value < field.min)
      return t('configEditor.errMin', { min: field.min });
    if (field.max !== undefined && value > field.max)
      return t('configEditor.errMax', { max: field.max });
  }
  if (field.pattern && typeof value === 'string' && !new RegExp(field.pattern).test(value)) {
    return t('configEditor.errPattern');
  }
  return null;
}

const fieldErrors = computed<Record<string, string>>(() => {
  const errs: Record<string, string> = {};
  for (const f of CONFIG_CATALOG.flatMap((s) => s.fields)) {
    if (f.locked) continue;
    // Only validate fields the user actually controls (overridden here or required).
    if (!hasPath(draft.value, f.path) && !f.required) continue;
    const e = validateField(f, effectiveValue(f.path));
    if (e) errs[f.path] = e;
  }
  // Cross-field: max_open_trades and stake_amount cannot both be unlimited.
  if (effectiveValue('max_open_trades') === -1 && effectiveValue('stake_amount') === 'unlimited') {
    errs['max_open_trades'] = t('configEditor.errBothUnlimited');
    errs['stake_amount'] = t('configEditor.errBothUnlimited');
  }
  return errs;
});
const hasClientErrors = computed(() => Object.keys(fieldErrors.value).length > 0);

// ── Raw JSON tab sync ──
watch(activeTab, (tab) => {
  if (tab === 'raw') {
    rawText.value = JSON.stringify(draft.value, null, 4);
    rawError.value = null;
  } else if (tab === 'risk') {
    // Resync ROI rows from the draft (covers edits made in the raw JSON tab).
    initRoiRows();
  }
});
function onRawChange(v: string) {
  rawText.value = v;
  if (_rawTimer) clearTimeout(_rawTimer);
  _rawTimer = setTimeout(() => {
    try {
      const parsed = JSON.parse(v);
      draft.value = parsed;
      rawError.value = null;
    } catch (e) {
      rawError.value = (e as Error).message;
    }
  }, 400);
}

// ── Server-side schema validation (warnings) ──
watch(
  draft,
  () => {
    if (_validateTimer) clearTimeout(_validateTimer);
    _validateTimer = setTimeout(async () => {
      const res = await store.validateContent(JSON.stringify(draft.value));
      serverDiagnostics.value = res?.errors ?? [];
    }, 700);
  },
  { deep: true },
);

// ── "Add a parameter" picker ──
function synthField(sf: ConfigSchemaField): CatalogField {
  let widget: CatalogField['widget'] = 'text';
  if (sf.enum) widget = 'select';
  else if (sf.type === 'boolean') widget = 'toggle';
  else if (sf.type === 'integer') widget = 'integer';
  else if (sf.type === 'number') widget = 'number';
  return {
    path: sf.path,
    labelKey: '',
    widget,
    options: sf.enum?.map((v) => ({ value: v })),
    min: sf.minimum,
    max: sf.maximum,
  };
}
const addableFields = computed(() => {
  const term = addSearch.value.trim().toLowerCase();
  return store.schemaFields
    .filter((f) => !CATALOG_PATHS.has(f.path))
    .filter((f) => !addedPaths.value.includes(f.path))
    .filter((f) => f.type && ['boolean', 'integer', 'number', 'string'].includes(f.type))
    .filter((f) => !hasPath(draft.value, f.path))
    .filter(
      (f) =>
        !term ||
        f.path.toLowerCase().includes(term) ||
        (f.description ?? '').toLowerCase().includes(term),
    )
    .slice(0, 60);
});
function addFieldFromSchema(sf: ConfigSchemaField) {
  const def = sf.default ?? (sf.type === 'boolean' ? false : sf.type === 'string' ? '' : 0);
  deepSet(draft.value, sf.path, def);
  addedPaths.value.push(sf.path);
}
function removeAddedField(path: string) {
  deepDelete(draft.value, path);
  addedPaths.value = addedPaths.value.filter((p) => p !== path);
}
const addedFieldDefs = computed(() =>
  addedPaths.value.map((p) => {
    const sf = store.schemaFields.find((f) => f.path === p);
    return {
      path: p,
      field: sf ? synthField(sf) : ({ path: p, labelKey: '', widget: 'text' } as CatalogField),
      description: sf?.description,
    };
  }),
);

// ── Save flow ──
const saveDisabled = computed(
  () =>
    !entryEditable.value ||
    loadIncomplete.value ||
    hasClientErrors.value ||
    !!rawError.value ||
    changes.value.length === 0 ||
    store.saving,
);

async function doSave() {
  const content =
    activeTab.value === 'raw' && !rawError.value
      ? rawText.value
      : JSON.stringify(draft.value, null, 4);
  const ok = await store.save(content);
  if (ok) {
    savedRestartNeeded.value = changes.value.some((c) => c.restartRequired);
    originalOwn.value = clone(draft.value);
    postSaveVisible.value = true;
    showAlert(t('configEditor.savedTo', { file: store.botConfig?.entry_file }), 'success');
  } else {
    showAlert(t('configEditor.saveFailed', { detail: store.saveError ?? '' }), 'error');
  }
}

async function reloadNow() {
  await store.reloadBot();
  showAlert(t('configEditor.reloadTriggered'), 'success');
  postSaveVisible.value = false;
  store.close();
}
async function stopNow() {
  await store.stopBot();
  showAlert(t('configEditor.stopTriggered'), 'success');
  postSaveVisible.value = false;
  store.close();
}

const sectionIcons: Record<string, Component> = {
  capital: IMdiCashMultiple,
  trading: IMdiCog,
  risk: IMdiShieldAlert,
  orders: IMdiFormatListChecks,
  pricing: IMdiTag,
  pairlists: IMdiFormatListBulleted,
  notifications: IMdiBell,
  system: IMdiLock,
  add: IMdiPlusBox,
  raw: IMdiCodeJson,
};
const tabs = computed(() => [
  ...CONFIG_CATALOG.map((s) => ({ id: s.id, label: t(s.labelKey), icon: sectionIcons[s.id] })),
  { id: 'add', label: t('configEditor.sections.add'), icon: sectionIcons.add },
  { id: 'raw', label: t('configEditor.sections.raw'), icon: sectionIcons.raw },
]);
const activeSection = computed(() => CONFIG_CATALOG.find((s) => s.id === activeTab.value));

// ── Documentation links (official freqtrade docs) ──
const DOC_BASE = 'https://www.freqtrade.io/en/stable';
const SECTION_DOCS: Record<string, string> = {
  capital: `${DOC_BASE}/configuration/#dynamic-stake-amount`,
  trading: `${DOC_BASE}/configuration/`,
  risk: `${DOC_BASE}/stoploss/`,
  orders: `${DOC_BASE}/configuration/#understand-order_types`,
  pricing: `${DOC_BASE}/configuration/#prices-used-for-orders`,
  pairlists: `${DOC_BASE}/plugins/#pairlists`,
  notifications: `${DOC_BASE}/telegram-usage/`,
  system: `${DOC_BASE}/configuration/`,
};
const FIELD_DOCS: Record<string, string> = {
  minimal_roi: `${DOC_BASE}/configuration/#understand-minimal_roi`,
  stoploss: `${DOC_BASE}/stoploss/`,
  trailing_stop: `${DOC_BASE}/stoploss/#trailing-stop-loss`,
  trailing_stop_positive: `${DOC_BASE}/stoploss/#trailing-stop-loss`,
  trailing_stop_positive_offset: `${DOC_BASE}/stoploss/#trailing-stop-loss`,
  trailing_only_offset_is_reached: `${DOC_BASE}/stoploss/#trailing-stop-loss`,
  'order_time_in_force.entry': `${DOC_BASE}/configuration/#understand-order_time_in_force`,
  'order_time_in_force.exit': `${DOC_BASE}/configuration/#understand-order_time_in_force`,
  strategy: `${DOC_BASE}/strategy-customization/`,
  trading_mode: `${DOC_BASE}/leverage/`,
  margin_mode: `${DOC_BASE}/leverage/`,
  fiat_display_currency: `${DOC_BASE}/configuration/#what-values-can-be-used-for-fiat_display_currency`,
};
function docUrlFor(path: string, sectionId?: string): string {
  return (
    FIELD_DOCS[path] ??
    (sectionId ? SECTION_DOCS[sectionId] : undefined) ??
    `${DOC_BASE}/configuration/`
  );
}
</script>

<template>
  <Dialog
    v-model:visible="store.visible"
    modal
    maximizable
    :header="t('configEditor.title')"
    :style="{ width: '60rem' }"
    :pt="{ content: { class: 'p-0' } }"
    @hide="store.close()"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <i-mdi-tune-vertical class="text-primary-400" />
        <div class="flex flex-col">
          <span class="font-semibold">{{ t('configEditor.title') }} — {{ store.botName() }}</span>
          <span v-if="store.botConfig" class="text-xs text-surface-400 font-mono">
            {{ store.botConfig.entry_file }}
          </span>
        </div>
      </div>
    </template>

    <!-- Loading / error states -->
    <div v-if="store.loading" class="p-10 text-center text-surface-400">
      <i-mdi-loading class="animate-spin text-3xl" />
      <p class="mt-2 text-sm">{{ t('configEditor.loading') }}</p>
    </div>
    <div v-else-if="store.loadError === 'unsupported'" class="p-8 text-center">
      <i-mdi-alert-circle-outline class="text-4xl text-amber-400" />
      <p class="mt-3 font-medium">{{ t('configEditor.unsupportedTitle') }}</p>
      <p class="text-sm text-surface-400 mt-1">{{ t('configEditor.unsupportedMsg') }}</p>
    </div>
    <div v-else-if="store.loadError" class="p-8 text-center text-red-400">
      <i-mdi-alert class="text-4xl" />
      <p class="mt-2 text-sm">{{ store.loadError }}</p>
    </div>

    <div v-else-if="store.botConfig" class="flex flex-col" style="min-height: 60vh">
      <!-- read-only banner -->
      <div
        v-if="!entryEditable"
        class="bg-amber-500/10 text-amber-300 text-xs px-4 py-2 flex items-center gap-2"
      >
        <i-mdi-lock /> {{ t('configEditor.readOnlyFile') }}
      </div>
      <div
        v-if="loadIncomplete"
        class="bg-red-500/10 text-red-300 text-xs px-4 py-2 flex items-center gap-2"
      >
        <i-mdi-alert /> {{ t('configEditor.loadIncomplete') }}
      </div>

      <!-- Tab bar (pinned so it stays reachable even when the JSON editor scrolls) -->
      <div
        class="sticky top-0 z-20 shrink-0 flex gap-1 px-3 pt-3 border-b border-surface-200 dark:border-surface-700 overflow-x-auto bg-surface-0 dark:bg-surface-900"
      >
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-lg whitespace-nowrap cursor-pointer transition-colors"
          :class="
            activeTab === tab.id
              ? 'bg-surface-100 dark:bg-surface-800 text-primary-400 font-medium border-b-2 border-primary-400'
              : 'text-surface-500 hover:text-surface-300'
          "
          @click="activeTab = tab.id"
        >
          <component :is="tab.icon" />
          {{ tab.label }}
        </button>
      </div>

      <!-- Tab content -->
      <div class="flex-1 overflow-y-auto px-4 py-2" style="max-height: 60vh">
        <!-- Standard sections -->
        <template v-if="activeSection">
          <div v-for="field in activeSection.fields" :key="field.path">
            <!-- scalar widgets -->
            <ConfigFieldRow
              v-if="SCALAR_WIDGETS.has(field.widget)"
              :field="resolvedField(field)"
              :value="effectiveValue(field.path)"
              :source="fieldSource(field)"
              :editable="isEditable(field)"
              :override-enabled="strategyOverrides.has(field.path)"
              :error="fieldErrors[field.path]"
              :options="optionsFor(field)"
              :doc-url="docUrlFor(field.path, activeSection.id)"
              @update="(v) => setValue(field.path, v)"
              @reset="resetValue(field.path)"
              @toggle-override="(v) => toggleOverride(field, v)"
            />

            <!-- pairlist -->
            <div
              v-else-if="field.widget === 'pairlist'"
              class="py-3 border-b border-surface-200/60 dark:border-surface-700/60"
            >
              <div class="flex items-center gap-1.5 mb-2">
                <span class="text-sm font-medium"
                  >{{ t(field.labelKey)
                  }}<span v-if="field.required" class="text-red-400">&nbsp;*</span></span
                >
                <span
                  class="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-500/15 text-surface-400"
                  >{{
                    fieldSource(field) === 'own'
                      ? t('configEditor.source.own')
                      : t('configEditor.source.inherited')
                  }}</span
                >
                <a
                  :href="docUrlFor(field.path, 'pairlists')"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-surface-400 hover:text-primary-400 cursor-pointer"
                  :title="t('configEditor.help')"
                >
                  <i-mdi-help-circle-outline class="text-xs" />
                </a>
              </div>
              <ConfigPairlistEditor
                :model-value="effectiveValue(field.path)"
                :editable="entryEditable"
                @update:model-value="(v) => setValue(field.path, v)"
              />
            </div>

            <!-- taglist (pair white/blacklist) -->
            <div
              v-else-if="field.widget === 'taglist'"
              class="py-3 border-b border-surface-200/60 dark:border-surface-700/60"
            >
              <div class="flex items-center gap-1.5 mb-1">
                <span class="text-sm font-medium">{{ t(field.labelKey) }}</span>
                <span
                  class="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-500/15 text-surface-400"
                  >{{
                    fieldSource(field) === 'own'
                      ? t('configEditor.source.own')
                      : t('configEditor.source.inherited')
                  }}</span
                >
                <span class="text-xs text-surface-400"
                  >({{
                    Array.isArray(effectiveValue(field.path))
                      ? (effectiveValue(field.path) as unknown[]).length
                      : 0
                  }})</span
                >
                <a
                  :href="docUrlFor(field.path, 'pairlists')"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-surface-400 hover:text-primary-400 cursor-pointer"
                  :title="t('configEditor.help')"
                >
                  <i-mdi-help-circle-outline class="text-xs" />
                </a>
              </div>
              <Textarea
                :model-value="tagText(field.path)"
                :disabled="!entryEditable"
                rows="6"
                class="w-full font-mono text-xs"
                :placeholder="t('configEditor.tagPlaceholder')"
                @update:model-value="(v: string) => setTags(field.path, v)"
              />
            </div>

            <!-- minimal_roi -->
            <div
              v-else-if="field.widget === 'roi'"
              class="py-3 border-b border-surface-200/60 dark:border-surface-700/60"
            >
              <div class="flex items-center gap-1.5 mb-2">
                <span class="text-sm font-medium"
                  >{{ t(field.labelKey)
                  }}<span v-if="field.required" class="text-red-400">&nbsp;*</span></span
                >
                <span
                  class="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-300"
                  >{{
                    fieldSource(field) === 'own'
                      ? t('configEditor.source.own')
                      : t('configEditor.source.strategy')
                  }}</span
                >
                <a
                  :href="docUrlFor(field.path, 'risk')"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-surface-400 hover:text-primary-400 cursor-pointer"
                  :title="t('configEditor.help')"
                >
                  <i-mdi-help-circle-outline class="text-xs" />
                </a>
                <label
                  class="flex items-center gap-1.5 ml-2 text-xs text-purple-300 cursor-pointer"
                >
                  <ToggleSwitch
                    :model-value="strategyOverrides.has(field.path)"
                    @update:model-value="(v) => toggleOverride(field, v as boolean)"
                  />
                  {{ t('configEditor.overrideFromConfig') }}
                </label>
              </div>
              <div v-if="isEditable(field)" class="flex flex-col gap-1">
                <div v-for="row in roiRows" :key="row.id" class="flex items-center gap-2">
                  <InputNumber
                    :model-value="row.minutes"
                    :min="0"
                    :max-fraction-digits="0"
                    size="small"
                    class="w-28"
                    suffix=" min"
                    @update:model-value="(v: number) => setRoiMinutes(row.id, v ?? 0)"
                  />
                  <span class="text-surface-400">→</span>
                  <InputNumber
                    :model-value="row.ratio"
                    :min="0"
                    :max-fraction-digits="4"
                    :step="0.01"
                    size="small"
                    class="w-32"
                    @update:model-value="(v: number) => setRoiRatio(row.id, v ?? 0)"
                  />
                  <button
                    class="p-1 text-red-400 hover:text-red-500 cursor-pointer"
                    @click="removeRoi(row.id)"
                  >
                    <i-mdi-close />
                  </button>
                </div>
                <button
                  class="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 mt-1 w-fit cursor-pointer"
                  @click="addRoi"
                >
                  <i-mdi-plus /> {{ t('configEditor.addRoi') }}
                </button>
              </div>
              <pre
                v-else
                class="text-xs text-surface-400 font-mono bg-surface-100 dark:bg-surface-800 rounded p-2 overflow-x-auto"
                >{{ JSON.stringify(effectiveValue(field.path) ?? {}, null, 2) }}</pre
              >
            </div>
          </div>
        </template>

        <!-- Add a parameter -->
        <template v-else-if="activeTab === 'add'">
          <p class="text-xs text-surface-400 my-2">{{ t('configEditor.addIntro') }}</p>
          <div
            v-if="addedFieldDefs.length"
            class="mb-3 rounded-lg border border-primary-500/30 bg-primary-500/5 p-2"
          >
            <p class="text-xs font-medium text-primary-300 mb-1">
              {{ t('configEditor.addedFields') }}
            </p>
            <div v-for="def in addedFieldDefs" :key="def.path" class="flex items-start gap-2">
              <ConfigFieldRow
                class="flex-1"
                :field="def.field"
                :value="effectiveValue(def.path)"
                source="own"
                :editable="entryEditable"
                :label="def.path"
                :description="def.description"
                :doc-url="docUrlFor(def.path)"
                @update="(v) => setValue(def.path, v)"
              />
              <button
                class="p-1 mt-3 text-red-400 hover:text-red-500 cursor-pointer"
                :title="t('configEditor.removeParam')"
                @click="removeAddedField(def.path)"
              >
                <i-mdi-trash-can-outline />
              </button>
            </div>
          </div>
          <InputText
            v-model="addSearch"
            :placeholder="t('configEditor.searchParam')"
            class="w-full mb-2"
            size="small"
          />
          <div class="flex flex-col divide-y divide-surface-200/60 dark:divide-surface-700/60">
            <button
              v-for="f in addableFields"
              :key="f.path"
              class="flex items-start justify-between gap-3 py-2 px-1 text-left hover:bg-surface-100 dark:hover:bg-surface-800 rounded cursor-pointer"
              @click="addFieldFromSchema(f)"
            >
              <div class="min-w-0">
                <p class="text-sm font-mono">{{ f.path }}</p>
                <p v-if="f.description" class="text-xs text-surface-400 truncate">
                  {{ f.description }}
                </p>
              </div>
              <span class="text-[10px] text-surface-500 shrink-0 mt-1"
                >{{ f.type }}<i-mdi-plus class="inline ml-1 text-primary-400"
              /></span>
            </button>
          </div>
        </template>

        <!-- Raw JSON -->
        <template v-else-if="activeTab === 'raw'">
          <p class="text-xs text-surface-400 my-2">
            {{ t('configEditor.rawIntro', { file: store.botConfig.entry_file }) }}
          </p>
          <p v-if="rawError" class="text-xs text-red-400 mb-1">{{ rawError }}</p>
          <div
            class="h-[50vh] border border-surface-200 dark:border-surface-700 rounded overflow-hidden"
          >
            <CodeEditor
              :model-value="rawText"
              language="json"
              :diagnostics="serverDiagnostics"
              @update:model-value="onRawChange"
            />
          </div>
        </template>
      </div>

      <!-- Server warnings -->
      <div
        v-if="serverDiagnostics.length"
        class="px-4 py-1.5 border-t border-surface-200 dark:border-surface-700 text-xs text-amber-300 flex items-center gap-2"
      >
        <i-mdi-alert-outline />
        {{ t('configEditor.schemaWarnings', { n: serverDiagnostics.length }) }}
        <span class="text-surface-400 truncate">{{ serverDiagnostics[0].message }}</span>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between w-full gap-3">
        <div class="text-xs text-surface-400 truncate">
          <span v-if="changes.length" class="text-primary-300 font-medium">
            {{ t('configEditor.nChanges', { n: changes.length }) }}
          </span>
          <span v-else>{{ t('configEditor.noChanges') }}</span>
          <span v-if="changes.some((c) => c.restartRequired)" class="text-orange-300 ml-2">
            <i-mdi-restart class="inline" /> {{ t('configEditor.restartNeeded') }}
          </span>
        </div>
        <div class="flex gap-2">
          <Button severity="secondary" size="small" @click="store.close()">
            {{ t('configEditor.cancel') }}
          </Button>
          <Button
            severity="primary"
            size="small"
            :disabled="saveDisabled"
            :loading="store.saving"
            @click="doSave"
          >
            <i-mdi-content-save class="mr-1" /> {{ t('configEditor.save') }}
          </Button>
        </div>
      </div>
    </template>
  </Dialog>

  <!-- Post-save action dialog -->
  <Dialog
    v-model:visible="postSaveVisible"
    modal
    :header="t('configEditor.savedTitle')"
    :style="{ width: '26rem' }"
  >
    <div class="flex flex-col gap-2">
      <p class="text-sm">{{ t('configEditor.savedMsg') }}</p>
      <div
        v-if="savedRestartNeeded"
        class="bg-orange-500/10 text-orange-300 text-xs rounded p-2 flex items-start gap-2"
      >
        <i-mdi-restart class="mt-0.5 shrink-0" /> {{ t('configEditor.savedRestartMsg') }}
      </div>
      <p class="text-xs text-surface-400">{{ t('configEditor.savedChoose') }}</p>
    </div>
    <template #footer>
      <div class="flex flex-col gap-2 w-full">
        <Button
          :severity="savedRestartNeeded ? 'secondary' : 'primary'"
          size="small"
          class="w-full"
          @click="reloadNow"
        >
          <i-mdi-refresh class="mr-1" /> {{ t('configEditor.reloadNow') }}
        </Button>
        <Button
          :severity="savedRestartNeeded ? 'danger' : 'secondary'"
          size="small"
          class="w-full"
          @click="stopNow"
        >
          <i-mdi-stop class="mr-1" /> {{ t('configEditor.stopNow') }}
        </Button>
        <Button
          severity="secondary"
          text
          size="small"
          class="w-full"
          @click="postSaveVisible = false"
        >
          {{ t('configEditor.later') }}
        </Button>
      </div>
    </template>
  </Dialog>
</template>
