<script setup lang="ts">
import type { IndicatorConfig, PlotConfig } from '@/types';
import { ChartType, EMPTY_PLOTCONFIG } from '@/types';

const props = withDefaults(
  defineProps<{
    columns: string[];
    isVisible?: boolean;
    focusSubplot?: string;
  }>(),
  { isVisible: false, focusSubplot: '' },
);

const plotStore = usePlotConfigStore();
const botStore = useBotStore();

const plotConfigNameLoc = ref('default');
const selSubPlot = ref('main_plot');
const expandedIndicator = ref<string | null>(null);
const searchQuery = ref('');
const showJsonPanel = ref(false);

watch(() => props.focusSubplot, (name) => {
  if (name && props.isVisible) selSubPlot.value = name;
});
const tempPlotConfig = ref<PlotConfig>();
const tempPlotConfigValid = ref(true);
const jsonCopied = ref(false);

// Undo/redo stack
const undoStack = ref<PlotConfig[]>([]);
const redoStack = ref<PlotConfig[]>([]);
const MAX_UNDO = 20;

function pushUndo() {
  undoStack.value.push(deepClone(plotStore.editablePlotConfig));
  if (undoStack.value.length > MAX_UNDO) undoStack.value.shift();
  redoStack.value = [];
}

function undo() {
  const prev = undoStack.value.pop();
  if (!prev) return;
  redoStack.value.push(deepClone(plotStore.editablePlotConfig));
  plotStore.editablePlotConfig = prev;
}

function redo() {
  const next = redoStack.value.pop();
  if (!next) return;
  undoStack.value.push(deepClone(plotStore.editablePlotConfig));
  plotStore.editablePlotConfig = next;
}

function onKeyDown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  }
}
onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

const isMainPlot = computed(() => selSubPlot.value === 'main_plot');

const currentPlotConfig = computed(() => {
  if (isMainPlot.value) return plotStore.editablePlotConfig.main_plot;
  return plotStore.editablePlotConfig.subplots[selSubPlot.value];
});

const subplots = computed((): string[] => [
  'main_plot',
  ...Object.keys(plotStore.editablePlotConfig.subplots),
]);

const indicators = computed(() => {
  if (!currentPlotConfig.value) return [];
  return Object.entries(currentPlotConfig.value).map(([name, config]) => ({
    name,
    config,
    available: props.columns.includes(name),
  }));
});

const usedIndicatorNames = computed(() => {
  const names = new Set<string>();
  for (const key of Object.keys(plotStore.editablePlotConfig.main_plot)) names.add(key);
  for (const subplot of Object.values(plotStore.editablePlotConfig.subplots)) {
    for (const key of Object.keys(subplot)) names.add(key);
  }
  return names;
});

const filteredAvailableColumns = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  return props.columns
    .filter((c) => {
      if (!q) return true;
      return c.toLowerCase().includes(q);
    })
    .map((c) => ({
      name: c,
      alreadyUsed: usedIndicatorNames.value.has(c),
    }));
});

const fillToOptions = computed(() => {
  return props.columns.filter((c) => {
    if (!currentPlotConfig.value) return false;
    return Object.keys(currentPlotConfig.value).includes(c) || props.columns.includes(c);
  });
});

// Indicator configuration
function updateIndicatorProp(
  indicatorName: string,
  prop: keyof IndicatorConfig,
  value: string | number | undefined,
) {
  pushUndo();
  const config = currentPlotConfig.value;
  if (!config || !config[indicatorName]) return;
  if (value === undefined || value === '') {
    delete config[indicatorName][prop];
  } else {
    (config[indicatorName] as Record<string, unknown>)[prop] = value;
  }
  plotStore.editablePlotConfig = { ...plotStore.editablePlotConfig };
}

function addIndicator(name: string) {
  pushUndo();
  const config: IndicatorConfig = { color: randomColor(), type: ChartType.line };
  if (isMainPlot.value) {
    plotStore.editablePlotConfig.main_plot[name] = config;
  } else if (plotStore.editablePlotConfig.subplots[selSubPlot.value]) {
    plotStore.editablePlotConfig.subplots[selSubPlot.value]![name] = config;
  }
  plotStore.editablePlotConfig = { ...plotStore.editablePlotConfig };
  expandedIndicator.value = name;
  searchQuery.value = '';
}

function removeIndicator(name: string) {
  pushUndo();
  if (isMainPlot.value) {
    delete plotStore.editablePlotConfig.main_plot[name];
  } else {
    delete plotStore.editablePlotConfig.subplots[selSubPlot.value]?.[name];
  }
  plotStore.editablePlotConfig = { ...plotStore.editablePlotConfig };
  if (expandedIndicator.value === name) expandedIndicator.value = null;
}

function addSubplot(name: string) {
  if (!name.trim()) return;
  pushUndo();
  plotStore.editablePlotConfig.subplots = {
    ...plotStore.editablePlotConfig.subplots,
    [name]: {},
  };
  selSubPlot.value = name;
}

function deleteSubplot(name: string) {
  pushUndo();
  delete plotStore.editablePlotConfig.subplots[name];
  plotStore.editablePlotConfig = { ...plotStore.editablePlotConfig };
  selSubPlot.value = subplots.value[subplots.value.length - 1] ?? 'main_plot';
}

function renameSubplot(oldName: string, newName: string) {
  if (!newName.trim() || oldName === newName) return;
  pushUndo();
  const old = plotStore.editablePlotConfig.subplots[oldName];
  if (old) plotStore.editablePlotConfig.subplots[newName] = old;
  delete plotStore.editablePlotConfig.subplots[oldName];
  selSubPlot.value = newName;
}

function loadPlotConfig() {
  const existingConf = plotStore.customPlotConfigs[plotStore.plotConfigName];
  if (existingConf) plotStore.editablePlotConfig = deepClone(existingConf);
}

async function loadPlotConfigFromStrategy() {
  if (botStore.activeBot.isWebserverMode && !botStore.activeBot.strategy?.strategy) {
    showAlert(`No strategy selected.`);
    return;
  }
  try {
    const config = await botStore.activeBot.getStrategyPlotConfig();
    if (config) {
      pushUndo();
      plotStore.editablePlotConfig = config;
    }
  } catch {
    showAlert('Failed to load plot config from strategy.');
  }
}

function savePlotConfig() {
  plotStore.saveCustomPlotConfig(plotConfigNameLoc.value, plotStore.editablePlotConfig);
}

async function copyJsonToClipboard() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(plotStore.editablePlotConfig, null, 2));
    jsonCopied.value = true;
    setTimeout(() => { jsonCopied.value = false; }, 2000);
  } catch { /* ignore */ }
}

function importJson() {
  if (tempPlotConfig.value && tempPlotConfigValid.value) {
    pushUndo();
    plotStore.editablePlotConfig = tempPlotConfig.value;
    showJsonPanel.value = false;
  }
}

const plotConfigJson = computed({
  get: () => JSON.stringify(plotStore.editablePlotConfig, null, 2),
  set: (val: string) => {
    try {
      tempPlotConfig.value = JSON.parse(val);
      tempPlotConfigValid.value = true;
    } catch {
      tempPlotConfigValid.value = false;
    }
  },
});

// Plot options
const showTagsInTooltips = computed({
  get: () => plotStore.editablePlotConfig.options?.showTags ?? true,
  set: (v: boolean) => {
    if (!plotStore.editablePlotConfig.options) plotStore.editablePlotConfig.options = {};
    plotStore.editablePlotConfig.options.showTags = v;
  },
});
const markAreaZIndex = computed({
  get: () => plotStore.editablePlotConfig.options?.markAreaZIndex ?? 1,
  set: (v: number) => {
    if (!plotStore.editablePlotConfig.options) plotStore.editablePlotConfig.options = {};
    plotStore.editablePlotConfig.options.markAreaZIndex = v;
  },
});

const newSubplotName = ref('');

// Template system
const { plotTemplateNames, applyPlotTemplate, getTemplateContent } = usePlotTemplates();
const showTemplates = ref(false);

function applyTemplate(templateName: string) {
  pushUndo();
  plotStore.editablePlotConfig = {
    ...applyPlotTemplate(templateName, plotStore.editablePlotConfig),
  };
  showTemplates.value = false;
}

// Watchers
watch(selSubPlot, () => { expandedIndicator.value = null; });

watch(() => plotStore.plotConfigName, () => {
  expandedIndicator.value = null;
  plotConfigNameLoc.value = plotStore.plotConfigName;
});

let savedSnapshot: PlotConfig | null = null;

watch(() => props.isVisible, () => {
  if (props.isVisible) {
    savedSnapshot = deepClone(plotStore.customPlotConfigs[plotStore.plotConfigName] ?? EMPTY_PLOTCONFIG);
    plotStore.editablePlotConfig = deepClone(savedSnapshot);
    plotStore.isEditing = true;
    plotConfigNameLoc.value = plotStore.plotConfigName;
    undoStack.value = [];
    redoStack.value = [];
    if (props.focusSubplot) {
      nextTick(() => { selSubPlot.value = props.focusSubplot; });
    }
  } else {
    plotStore.isEditing = false;
    if (savedSnapshot) {
      plotStore.editablePlotConfig = deepClone(savedSnapshot);
      savedSnapshot = null;
    }
  }
}, { immediate: true });

const graphTypes = Object.keys(ChartType) as (keyof typeof ChartType)[];
</script>

<template>
  <div v-if="columns" class="pc-root">
    <!-- ═══ HEADER: Config name + actions ═══ -->
    <div class="pc-header">
      <PlotConfigSelect allow-edit />
      <div class="pc-header-actions">
        <button
          class="pc-btn-icon"
          :disabled="undoStack.length === 0"
          title="Annuler (Ctrl+Z)"
          @click="undo"
        >
          <i-mdi-undo class="w-4 h-4" />
        </button>
        <button
          class="pc-btn-icon"
          :disabled="redoStack.length === 0"
          title="Rétablir (Ctrl+Shift+Z)"
          @click="redo"
        >
          <i-mdi-redo class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- ═══ TWO-PANEL LAYOUT ═══ -->
    <div class="pc-panels">
      <!-- LEFT: Subplot tree + indicators -->
      <div class="pc-left">
        <!-- Subplot tabs -->
        <div class="pc-subplot-tabs">
          <button
            v-for="sp in subplots"
            :key="sp"
            class="pc-subplot-tab"
            :class="{ active: selSubPlot === sp }"
            @click="selSubPlot = sp"
          >
            <span class="pc-subplot-name">{{ sp === 'main_plot' ? 'Main' : sp }}</span>
            <button
              v-if="sp !== 'main_plot'"
              class="pc-subplot-delete"
              title="Supprimer"
              @click.stop="deleteSubplot(sp)"
            >
              <i-mdi-close class="w-3 h-3" />
            </button>
          </button>
          <!-- Add subplot -->
          <div class="pc-add-subplot">
            <input
              v-model="newSubplotName"
              class="pc-add-subplot-input"
              placeholder="+ Subplot"
              @keydown.enter="addSubplot(newSubplotName); newSubplotName = ''"
            />
          </div>
        </div>

        <!-- Indicator list (accordion) -->
        <div class="pc-indicator-list">
          <div v-if="indicators.length === 0" class="pc-empty">
            Aucun indicateur
          </div>

          <div
            v-for="ind in indicators"
            :key="ind.name"
            class="pc-indicator-item"
            :class="{ expanded: expandedIndicator === ind.name, unavailable: !ind.available }"
          >
            <!-- Indicator header row -->
            <div
              class="pc-indicator-header"
              @click="expandedIndicator = expandedIndicator === ind.name ? null : ind.name"
            >
              <span
                class="pc-indicator-dot"
                :style="{ backgroundColor: ind.config.color || '#888' }"
              />
              <span class="pc-indicator-name">
                {{ ind.name }}
                <span v-if="!ind.available" class="pc-unavailable-badge">indisponible</span>
              </span>
              <span class="pc-indicator-type">{{ ind.config.type || 'line' }}</span>
              <button
                class="pc-indicator-remove"
                title="Retirer"
                @click.stop="removeIndicator(ind.name)"
              >
                <i-mdi-close class="w-3.5 h-3.5" />
              </button>
            </div>

            <!-- Expanded config panel -->
            <Transition name="accordion">
              <div v-if="expandedIndicator === ind.name" class="pc-indicator-config">
                <div class="pc-config-row">
                  <label class="pc-config-label">Type</label>
                  <Select
                    :model-value="ind.config.type || 'line'"
                    :options="graphTypes"
                    size="small"
                    class="pc-config-input"
                    @update:model-value="(v: string) => updateIndicatorProp(ind.name, 'type', v)"
                  />
                </div>
                <div class="pc-config-row">
                  <label class="pc-config-label">Couleur</label>
                  <div class="pc-color-group">
                    <ColorPicker
                      :model-value="ind.config.color || '#888888'"
                      class="pc-color-picker"
                      @update:model-value="(v: string) => updateIndicatorProp(ind.name, 'color', v.startsWith('#') ? v : '#' + v)"
                    />
                    <InputText
                      :model-value="ind.config.color || '#888888'"
                      size="small"
                      class="pc-color-input"
                      @update:model-value="(v: string | undefined) => updateIndicatorProp(ind.name, 'color', v ?? '')"
                    />
                    <button
                      class="pc-btn-icon pc-btn-dice"
                      title="Couleur aléatoire"
                      @click="updateIndicatorProp(ind.name, 'color', randomColor())"
                    >
                      <i-mdi-dice-multiple class="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div v-if="(ind.config.type || 'line') === 'line'" class="pc-config-row">
                  <label class="pc-config-label">Remplir vers</label>
                  <Select
                    :model-value="ind.config.fill_to || ''"
                    :options="['', ...fillToOptions]"
                    size="small"
                    class="pc-config-input"
                    filter
                    placeholder="Aucun"
                    @update:model-value="(v: string) => updateIndicatorProp(ind.name, 'fill_to', v || undefined)"
                  />
                </div>
                <div v-if="ind.config.type === 'scatter'" class="pc-config-row">
                  <label class="pc-config-label">Taille symbole</label>
                  <InputNumber
                    :model-value="ind.config.scatterSymbolSize ?? 3"
                    :min="1"
                    :max="30"
                    size="small"
                    show-buttons
                    button-layout="horizontal"
                    class="pc-config-input"
                    @update:model-value="(v: number) => updateIndicatorProp(ind.name, 'scatterSymbolSize', v)"
                  />
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <!-- Search + add indicator -->
        <div class="pc-search-add">
          <div class="pc-search-wrapper">
            <i-mdi-magnify class="w-3.5 h-3.5 pc-search-icon" />
            <input
              v-model="searchQuery"
              class="pc-search-input"
              placeholder="Rechercher un indicateur..."
            />
          </div>
          <div v-if="searchQuery" class="pc-search-results">
            <div
              v-for="col in filteredAvailableColumns.slice(0, 20)"
              :key="col.name"
              class="pc-search-result"
              :class="{ used: col.alreadyUsed }"
              @click="!col.alreadyUsed && addIndicator(col.name)"
            >
              <span>{{ col.name }}</span>
              <span v-if="col.alreadyUsed" class="pc-used-badge">ajouté</span>
              <i-mdi-plus v-else class="w-3.5 h-3.5 pc-add-icon" />
            </div>
            <div v-if="filteredAvailableColumns.length === 0" class="pc-search-empty">
              Aucun résultat
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT: Actions + options -->
      <div class="pc-right">
        <!-- Quick actions -->
        <div class="pc-section">
          <div class="pc-section-title">Actions</div>
          <div class="pc-action-grid">
            <button class="pc-action-btn" @click="loadPlotConfigFromStrategy"
              :disabled="(botStore.activeBot.isWebserverMode && !botStore.activeBot.botFeatures.plotConfigFromServer) || !botStore.activeBot.isBotOnline"
            >
              <i-mdi-strategy class="w-4 h-4" />
              <span>Depuis stratégie</span>
            </button>
            <button class="pc-action-btn" @click="showTemplates = !showTemplates">
              <i-mdi-file-document-outline class="w-4 h-4" />
              <span>Templates</span>
            </button>
            <button class="pc-action-btn" @click="loadPlotConfig">
              <i-mdi-restore class="w-4 h-4" />
              <span>Réinitialiser</span>
            </button>
            <button class="pc-action-btn primary" @click="savePlotConfig">
              <i-mdi-content-save class="w-4 h-4" />
              <span>Sauvegarder</span>
            </button>
          </div>
        </div>

        <!-- Templates panel -->
        <Transition name="accordion">
          <div v-if="showTemplates" class="pc-section">
            <div class="pc-section-title">Templates disponibles</div>
            <div class="pc-template-grid">
              <button
                v-for="tpl in plotTemplateNames"
                :key="tpl"
                class="pc-template-btn"
                @click="applyTemplate(tpl)"
              >
                <i-mdi-chart-line class="w-3.5 h-3.5" />
                {{ tpl }}
              </button>
            </div>
          </div>
        </Transition>

        <!-- Options -->
        <div class="pc-section">
          <div class="pc-section-title">Options</div>
          <label class="pc-toggle">
            <input
              type="checkbox"
              :checked="showTagsInTooltips"
              @change="showTagsInTooltips = ($event.target as HTMLInputElement).checked"
            />
            <span>Tags dans les tooltips</span>
          </label>
          <div class="pc-config-row">
            <label class="pc-config-label">Z-Index Mark Area</label>
            <InputNumber v-model="markAreaZIndex" size="small" class="pc-config-input-sm" />
          </div>
        </div>

        <!-- Import/Export -->
        <div class="pc-section">
          <div class="pc-section-title">Import / Export</div>
          <div class="pc-export-actions">
            <button class="pc-action-btn" @click="copyJsonToClipboard">
              <i-mdi-content-copy class="w-4 h-4" />
              <span>{{ jsonCopied ? 'Copié !' : 'Copier JSON' }}</span>
            </button>
            <button class="pc-action-btn" @click="showJsonPanel = !showJsonPanel">
              <i-mdi-code-json class="w-4 h-4" />
              <span>{{ showJsonPanel ? 'Masquer' : 'Importer JSON' }}</span>
            </button>
          </div>
          <Transition name="accordion">
            <div v-if="showJsonPanel" class="pc-json-panel">
              <Textarea
                v-model="plotConfigJson"
                class="pc-json-textarea"
                :class="{ invalid: !tempPlotConfigValid }"
                size="small"
              />
              <button
                class="pc-action-btn primary"
                :disabled="!tempPlotConfigValid"
                @click="importJson"
              >
                <i-mdi-import class="w-4 h-4" />
                <span>Appliquer</span>
              </button>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pc-root {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.8125rem;
}

/* ═══ Header ═══ */
.pc-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.pc-header > :first-child {
  flex: 1;
}
.pc-header-actions {
  display: flex;
  gap: 0.25rem;
}

/* ═══ Two-panel layout ═══ */
.pc-panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  min-height: 300px;
}
@media (max-width: 640px) {
  .pc-panels { grid-template-columns: 1fr; }
}

.pc-left, .pc-right {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  overflow: hidden;
}

/* ═══ Subplot tabs ═══ */
.pc-subplot-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.pc-subplot-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: transparent;
  font-size: 0.6875rem;
  font-weight: 500;
  cursor: pointer;
  color: rgba(0, 0, 0, 0.6);
  transition: all 0.15s;
}
.ft-dark-theme .pc-subplot-tab {
  border-color: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.5);
}
.pc-subplot-tab.active {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.3);
  color: rgb(79, 70, 229);
}
.ft-dark-theme .pc-subplot-tab.active {
  background: rgba(99, 102, 241, 0.15);
  color: rgb(165, 180, 252);
}

.pc-subplot-delete {
  display: flex;
  align-items: center;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  opacity: 0.5;
  padding: 0;
}
.pc-subplot-delete:hover { opacity: 1; color: #ef5350; }

.pc-subplot-name { white-space: nowrap; }

.pc-add-subplot {
  display: flex;
}
.pc-add-subplot-input {
  width: 80px;
  padding: 0.25rem 0.5rem;
  border: 1px dashed rgba(0, 0, 0, 0.12);
  border-radius: 0.375rem;
  background: transparent;
  font-size: 0.6875rem;
  color: inherit;
  outline: none;
}
.pc-add-subplot-input:focus {
  border-color: rgba(99, 102, 241, 0.4);
}
.ft-dark-theme .pc-add-subplot-input {
  border-color: rgba(255, 255, 255, 0.1);
}

/* ═══ Indicator list ═══ */
.pc-indicator-list {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  max-height: 250px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 0.375rem;
}
.ft-dark-theme .pc-indicator-list {
  border-color: rgba(255, 255, 255, 0.06);
}

.pc-empty {
  padding: 1rem;
  text-align: center;
  color: rgba(0, 0, 0, 0.3);
  font-size: 0.75rem;
}
.ft-dark-theme .pc-empty { color: rgba(255, 255, 255, 0.25); }

.pc-indicator-item {
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
}
.pc-indicator-item:last-child { border-bottom: none; }
.ft-dark-theme .pc-indicator-item {
  border-bottom-color: rgba(255, 255, 255, 0.04);
}
.pc-indicator-item.unavailable { opacity: 0.5; }

.pc-indicator-header {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.5rem;
  cursor: pointer;
  transition: background 0.1s;
}
.pc-indicator-header:hover {
  background: rgba(0, 0, 0, 0.03);
}
.ft-dark-theme .pc-indicator-header:hover {
  background: rgba(255, 255, 255, 0.03);
}
.pc-indicator-item.expanded .pc-indicator-header {
  background: rgba(99, 102, 241, 0.05);
}

.pc-indicator-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  flex-shrink: 0;
}

.pc-indicator-name {
  flex: 1;
  font-weight: 500;
  font-size: 0.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pc-unavailable-badge {
  font-size: 0.5625rem;
  font-weight: 600;
  color: #ef5350;
  background: rgba(239, 83, 80, 0.1);
  padding: 0 0.25rem;
  border-radius: 0.1875rem;
  margin-left: 0.25rem;
}

.pc-indicator-type {
  font-size: 0.625rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.3);
  text-transform: uppercase;
}
.ft-dark-theme .pc-indicator-type { color: rgba(255, 255, 255, 0.25); }

.pc-indicator-remove {
  display: flex;
  align-items: center;
  background: none;
  border: none;
  color: rgba(0, 0, 0, 0.3);
  cursor: pointer;
  padding: 0.125rem;
  border-radius: 0.25rem;
  transition: all 0.15s;
}
.pc-indicator-remove:hover {
  color: #ef5350;
  background: rgba(239, 83, 80, 0.08);
}
.ft-dark-theme .pc-indicator-remove { color: rgba(255, 255, 255, 0.25); }

/* ═══ Indicator config (expanded) ═══ */
.pc-indicator-config {
  padding: 0.5rem;
  background: rgba(0, 0, 0, 0.015);
  border-top: 1px solid rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.ft-dark-theme .pc-indicator-config {
  background: rgba(255, 255, 255, 0.015);
  border-top-color: rgba(255, 255, 255, 0.04);
}

.pc-config-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.pc-config-label {
  font-size: 0.6875rem;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.5);
  min-width: 5rem;
  flex-shrink: 0;
}
.ft-dark-theme .pc-config-label { color: rgba(255, 255, 255, 0.45); }

.pc-config-input { flex: 1; min-width: 0; }
.pc-config-input-sm { width: 5rem; }

.pc-color-group {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex: 1;
}
.pc-color-picker { flex-shrink: 0; }
.pc-color-input { flex: 1; min-width: 0; }

/* ═══ Search + add ═══ */
.pc-search-add {
  position: relative;
}
.pc-search-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}
.pc-search-icon {
  position: absolute;
  left: 0.5rem;
  color: rgba(0, 0, 0, 0.3);
  pointer-events: none;
}
.ft-dark-theme .pc-search-icon { color: rgba(255, 255, 255, 0.25); }

.pc-search-input {
  width: 100%;
  padding: 0.375rem 0.5rem 0.375rem 1.75rem;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 0.375rem;
  background: transparent;
  font-size: 0.75rem;
  color: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.pc-search-input:focus {
  border-color: rgba(99, 102, 241, 0.4);
}
.ft-dark-theme .pc-search-input {
  border-color: rgba(255, 255, 255, 0.08);
}

.pc-search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 20;
  max-height: 180px;
  overflow-y: auto;
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 0.375rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  margin-top: 0.25rem;
}
.ft-dark-theme .pc-search-results {
  background: #1a1a2e;
  border-color: rgba(255, 255, 255, 0.1);
}

.pc-search-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.375rem 0.5rem;
  font-size: 0.75rem;
  cursor: pointer;
  transition: background 0.1s;
}
.pc-search-result:hover { background: rgba(99, 102, 241, 0.06); }
.pc-search-result.used {
  opacity: 0.4;
  cursor: default;
}

.pc-used-badge {
  font-size: 0.5625rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.3);
}
.ft-dark-theme .pc-used-badge { color: rgba(255, 255, 255, 0.25); }

.pc-add-icon { color: rgb(99, 102, 241); }

.pc-search-empty {
  padding: 0.75rem;
  text-align: center;
  color: rgba(0, 0, 0, 0.3);
  font-size: 0.75rem;
}

/* ═══ Right panel: sections ═══ */
.pc-section {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.pc-section-title {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(0, 0, 0, 0.35);
}
.ft-dark-theme .pc-section-title { color: rgba(255, 255, 255, 0.3); }

.pc-action-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.25rem;
}

.pc-action-btn {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.5rem;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 0.375rem;
  background: transparent;
  font-size: 0.6875rem;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.6);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.pc-action-btn:hover {
  background: rgba(0, 0, 0, 0.04);
  border-color: rgba(0, 0, 0, 0.12);
}
.pc-action-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.pc-action-btn.primary {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.2);
  color: rgb(79, 70, 229);
}
.pc-action-btn.primary:hover {
  background: rgba(99, 102, 241, 0.15);
}
.ft-dark-theme .pc-action-btn {
  border-color: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.55);
}
.ft-dark-theme .pc-action-btn:hover {
  background: rgba(255, 255, 255, 0.04);
}
.ft-dark-theme .pc-action-btn.primary {
  background: rgba(99, 102, 241, 0.15);
  color: rgb(165, 180, 252);
}

.pc-export-actions {
  display: flex;
  gap: 0.25rem;
}
.pc-export-actions .pc-action-btn { flex: 1; }

/* ═══ Templates ═══ */
.pc-template-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.pc-template-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 0.375rem;
  background: transparent;
  font-size: 0.6875rem;
  cursor: pointer;
  color: rgba(0, 0, 0, 0.6);
  transition: all 0.15s;
}
.pc-template-btn:hover {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.2);
}
.ft-dark-theme .pc-template-btn {
  border-color: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.55);
}

/* ═══ Toggle ═══ */
.pc-toggle {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  cursor: pointer;
}
.pc-toggle input[type="checkbox"] {
  accent-color: rgb(99, 102, 241);
}

/* ═══ JSON panel ═══ */
.pc-json-panel {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.pc-json-textarea {
  min-height: 150px;
  font-family: monospace;
  font-size: 0.6875rem;
}
.pc-json-textarea.invalid {
  border-color: #ef5350;
}

/* ═══ Button icon ═══ */
.pc-btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 0.375rem;
  border: 1px solid rgba(0, 0, 0, 0.06);
  background: transparent;
  color: rgba(0, 0, 0, 0.4);
  cursor: pointer;
  transition: all 0.15s;
}
.pc-btn-icon:hover {
  background: rgba(0, 0, 0, 0.04);
  color: rgba(0, 0, 0, 0.7);
}
.pc-btn-icon:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}
.ft-dark-theme .pc-btn-icon {
  border-color: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.35);
}
.ft-dark-theme .pc-btn-icon:hover {
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.7);
}

.pc-btn-dice {
  width: 1.5rem;
  height: 1.5rem;
}

/* ═══ Accordion transition ═══ */
.accordion-enter-active,
.accordion-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.accordion-enter-from,
.accordion-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}
.accordion-enter-to,
.accordion-leave-from {
  max-height: 500px;
  opacity: 1;
}
</style>
