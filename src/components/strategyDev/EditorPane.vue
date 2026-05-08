<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const editorStore = useEditorStore();
const codeEditorRef = ref<InstanceType<typeof CodeEditor> | null>(null);
const showDiagnostics = ref(false);

const emit = defineEmits<{
  'use-config': [path: string];
}>();

const errorCount = computed(
  () => editorStore.diagnostics.filter((d) => d.severity === 'error').length,
);
const warningCount = computed(
  () => editorStore.diagnostics.filter((d) => d.severity === 'warning').length,
);

const cursorDisplay = computed(() => {
  const pos = codeEditorRef.value?.cursorPos;
  if (!pos) return 'Ln 1, Col 1';
  return `Ln ${pos.line}, Col ${pos.col}`;
});

function handleContentChange(value: string) {
  editorStore.updateContent(value);
}

function handleSave() {
  editorStore.saveActiveFile();
}

function handleUseConfig() {
  if (editorStore.activeFile) {
    emit('use-config', editorStore.activeFile.path);
  }
}

function goToLine(line: number) {
  codeEditorRef.value?.goToLine(line);
  showDiagnostics.value = false;
}

onMounted(() => {
  editorStore.fetchSchema();
  editorStore.fetchStrategyHints();
});
</script>

<template>
  <div class="editor-pane">
    <!-- Tab bar -->
    <div class="editor-tabs">
      <button
        v-for="(file, idx) in editorStore.openFiles"
        :key="file.path"
        class="editor-tab"
        :class="{ 'editor-tab--active': idx === editorStore.activeIndex }"
        @click="editorStore.activeIndex = idx"
      >
        <i-mdi-code-json v-if="file.language === 'json'" class="editor-tab-lang-icon" />
        <i-mdi-language-python v-else class="editor-tab-lang-icon" />
        <span class="editor-tab-label">{{ file.label }}</span>
        <span v-if="file.content !== file.originalContent" class="editor-tab-dirty">●</span>
        <button class="editor-tab-close" @click.stop="editorStore.closeFile(idx)">
          <i-mdi-close class="editor-tab-close-icon" />
        </button>
      </button>
      <div class="editor-tabs-spacer" />
      <button class="editor-close-all" @click="editorStore.closeAll()">
        <i-mdi-close class="w-4 h-4" />
      </button>
    </div>

    <!-- Editor -->
    <div class="editor-body">
      <CodeEditor
        v-if="editorStore.activeFile"
        ref="codeEditorRef"
        :model-value="editorStore.activeFile.content"
        :language="editorStore.activeFile.language"
        :readonly="false"
        :diagnostics="editorStore.diagnostics"
        :filename="editorStore.activeFile.path"
        @update:model-value="handleContentChange"
        @save="handleSave"
      />
    </div>

    <!-- Status bar -->
    <div class="editor-statusbar">
      <button
        class="editor-statusbar-diagnostics"
        :class="{
          'editor-statusbar-diagnostics--error': errorCount > 0,
          'editor-statusbar-diagnostics--warning': warningCount > 0 && errorCount === 0,
        }"
        @click="showDiagnostics = !showDiagnostics"
      >
        <template v-if="errorCount > 0">
          <i-mdi-close-circle class="editor-statusbar-icon" />
          {{ errorCount }}
        </template>
        <template v-if="warningCount > 0">
          <i-mdi-alert class="editor-statusbar-icon" />
          {{ warningCount }}
        </template>
        <template v-if="errorCount === 0 && warningCount === 0">
          <i-mdi-check-circle class="editor-statusbar-icon editor-statusbar-icon--ok" />
        </template>
      </button>

      <span class="editor-statusbar-cursor">{{ cursorDisplay }}</span>
      <span class="editor-statusbar-lang">{{ editorStore.activeFile?.language?.toUpperCase() }}</span>

      <div class="editor-statusbar-actions">
        <button
          v-if="editorStore.isDirty"
          class="editor-action-btn"
          :disabled="editorStore.saving"
          @click="handleSave"
        >
          <i-mdi-content-save v-if="!editorStore.saving" class="editor-action-icon" />
          <i-mdi-loading v-else class="editor-action-icon editor-action-icon--spin" />
          {{ t('strategyDev.editorSave') }}
        </button>
        <button
          v-if="editorStore.activeFile?.language === 'json'"
          class="editor-action-btn editor-action-btn--primary"
          @click="handleUseConfig"
        >
          {{ t('strategyDev.editorUseConfig') }}
        </button>
      </div>
    </div>

    <!-- Diagnostics panel -->
    <Transition name="editor-diag">
      <div v-if="showDiagnostics && editorStore.diagnostics.length" class="editor-diagnostics">
        <div
          v-for="(d, i) in editorStore.diagnostics"
          :key="i"
          class="editor-diag-item"
          :class="`editor-diag-item--${d.severity}`"
          @click="goToLine(d.line)"
        >
          <i-mdi-close-circle v-if="d.severity === 'error'" class="editor-diag-icon editor-diag-icon--error" />
          <i-mdi-alert v-else-if="d.severity === 'warning'" class="editor-diag-icon editor-diag-icon--warning" />
          <i-mdi-information v-else class="editor-diag-icon editor-diag-icon--info" />
          <span class="editor-diag-loc">L{{ d.line }}</span>
          <span class="editor-diag-msg">{{ d.message }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.editor-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--sd-crust);
}

/* ── Tabs ── */
.editor-tabs {
  display: flex;
  align-items: center;
  background: var(--sd-mantle);
  border-bottom: 1px solid var(--sd-border-subtle);
  overflow-x: auto;
  min-height: 36px;
}

.editor-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px 6px 10px;
  border: none;
  background: none;
  color: var(--sd-overlay);
  font-size: 11px;
  font-family: var(--sd-font-mono);
  cursor: pointer;
  border-right: 1px solid var(--sd-border-subtle);
  transition: all var(--sd-transition-fast);
  white-space: nowrap;
}

.editor-tab:hover {
  background: var(--sd-surface0);
  color: var(--sd-text);
}

.editor-tab--active {
  background: var(--sd-crust);
  color: var(--sd-text);
  border-bottom: 2px solid var(--sd-info);
  margin-bottom: -1px;
}

.editor-tab-lang-icon {
  width: 14px;
  height: 14px;
  opacity: 0.6;
}

.editor-tab-dirty {
  color: var(--sd-peach);
  font-size: 14px;
  line-height: 1;
}

.editor-tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  background: none;
  color: var(--sd-overlay);
  cursor: pointer;
  border-radius: 2px;
  margin-left: 2px;
  opacity: 0;
  transition: opacity var(--sd-transition-fast);
}

.editor-tab:hover .editor-tab-close {
  opacity: 1;
}

.editor-tab-close:hover {
  background: var(--sd-surface1);
  color: var(--sd-text);
}

.editor-tab-close-icon {
  width: 12px;
  height: 12px;
}

.editor-tabs-spacer {
  flex: 1;
}

.editor-close-all {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  color: var(--sd-overlay);
  cursor: pointer;
  transition: color var(--sd-transition-fast);
}

.editor-close-all:hover {
  color: var(--sd-text);
}

/* ── Editor body ── */
.editor-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

/* ── Status bar ── */
.editor-statusbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 3px 10px;
  background: var(--sd-mantle);
  border-top: 1px solid var(--sd-border-subtle);
  font-size: 11px;
  font-family: var(--sd-font-mono);
  color: var(--sd-overlay);
  min-height: 26px;
}

.editor-statusbar-diagnostics {
  display: flex;
  align-items: center;
  gap: 3px;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--sd-overlay);
  font-size: 11px;
  font-family: var(--sd-font-mono);
  padding: 1px 4px;
  border-radius: 3px;
  transition: background var(--sd-transition-fast);
}

.editor-statusbar-diagnostics:hover {
  background: var(--sd-surface0);
}

.editor-statusbar-diagnostics--error {
  color: var(--sd-danger);
}

.editor-statusbar-diagnostics--warning {
  color: var(--sd-warning);
}

.editor-statusbar-icon {
  width: 13px;
  height: 13px;
}

.editor-statusbar-icon--ok {
  color: var(--sd-success);
}

.editor-statusbar-cursor {
  color: var(--sd-subtext);
}

.editor-statusbar-lang {
  color: var(--sd-subtext);
  font-weight: 600;
  font-size: 10px;
}

.editor-statusbar-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}

.editor-action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--sd-border-subtle);
  border-radius: var(--sd-radius-sm);
  background: var(--sd-surface0);
  color: var(--sd-text);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--sd-transition-fast);
}

.editor-action-btn:hover:not(:disabled) {
  background: var(--sd-surface1);
  border-color: var(--sd-border);
}

.editor-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.editor-action-btn--primary {
  background: var(--sd-info);
  color: var(--sd-crust);
  border-color: transparent;
}

.editor-action-btn--primary:hover {
  filter: brightness(1.1);
}

.editor-action-icon {
  width: 12px;
  height: 12px;
}

.editor-action-icon--spin {
  animation: sd-spin 800ms linear infinite;
}

/* ── Diagnostics panel ── */
.editor-diagnostics {
  max-height: 120px;
  overflow-y: auto;
  background: var(--sd-mantle);
  border-top: 1px solid var(--sd-border-subtle);
}

.editor-diag-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  font-size: 11px;
  cursor: pointer;
  transition: background var(--sd-transition-fast);
}

.editor-diag-item:hover {
  background: var(--sd-surface0);
}

.editor-diag-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}

.editor-diag-icon--error { color: var(--sd-danger); }
.editor-diag-icon--warning { color: var(--sd-warning); }
.editor-diag-icon--info { color: var(--sd-info); }

.editor-diag-loc {
  color: var(--sd-overlay);
  font-family: var(--sd-font-mono);
  font-size: 10px;
  min-width: 30px;
}

.editor-diag-msg {
  color: var(--sd-subtext);
  font-family: var(--sd-font-mono);
  font-size: 11px;
}

/* ── Transition ── */
.editor-diag-enter-active { transition: max-height 200ms ease, opacity 200ms ease; }
.editor-diag-leave-active { transition: max-height 150ms ease, opacity 150ms ease; }
.editor-diag-enter-from, .editor-diag-leave-to { max-height: 0; opacity: 0; }
</style>
