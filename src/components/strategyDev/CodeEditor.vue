<script setup lang="ts">
import { monaco } from '@/utils/monacoWorker';
import type { EditorDiagnostic } from '@/types';

const props = withDefaults(defineProps<{
  modelValue: string;
  language: 'json' | 'python';
  readonly?: boolean;
  diagnostics?: EditorDiagnostic[];
  filename?: string;
}>(), {
  readonly: false,
  diagnostics: () => [],
  filename: '',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  save: [];
  'cursor-change': [pos: { line: number; col: number }];
}>();

const containerRef = ref<HTMLElement>();
const cursorPos = ref({ line: 1, col: 1 });
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let ignoreNextChange = false;

const catppuccinTheme: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6c7086', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'cba6f7' },
    { token: 'string', foreground: 'a6e3a1' },
    { token: 'number', foreground: 'fab387' },
    { token: 'type', foreground: 'f9e2af' },
    { token: 'delimiter', foreground: '9399b2' },
    { token: 'identifier', foreground: 'cdd6f4' },
    { token: 'variable', foreground: 'cdd6f4' },
    { token: 'operator', foreground: '89dceb' },
    { token: 'decorator', foreground: 'f5c2e7' },
    { token: 'function', foreground: '89b4fa' },
    { token: 'string.key.json', foreground: '89b4fa' },
    { token: 'string.value.json', foreground: 'a6e3a1' },
    { token: 'keyword.json', foreground: 'fab387' },
  ],
  colors: {
    'editor.background': '#1e1e2e',
    'editor.foreground': '#cdd6f4',
    'editor.lineHighlightBackground': '#313244',
    'editor.selectionBackground': '#45475a',
    'editor.inactiveSelectionBackground': '#313244',
    'editorCursor.foreground': '#f5e0dc',
    'editorLineNumber.foreground': '#585b70',
    'editorLineNumber.activeForeground': '#a6adc8',
    'editor.selectionHighlightBackground': '#45475a50',
    'editorIndentGuide.background': '#31324480',
    'editorIndentGuide.activeBackground': '#45475a',
    'editorBracketMatch.background': '#45475a60',
    'editorBracketMatch.border': '#89b4fa40',
    'editorGutter.background': '#181825',
    'editorWidget.background': '#1e1e2e',
    'editorWidget.border': '#45475a',
    'editorSuggestWidget.background': '#1e1e2e',
    'editorSuggestWidget.border': '#45475a',
    'editorSuggestWidget.selectedBackground': '#313244',
    'editorSuggestWidget.highlightForeground': '#89b4fa',
    'editorHoverWidget.background': '#1e1e2e',
    'editorHoverWidget.border': '#45475a',
    'minimap.background': '#181825',
    'scrollbar.shadow': '#11111b',
    'scrollbarSlider.background': '#45475a40',
    'scrollbarSlider.hoverBackground': '#45475a80',
    'scrollbarSlider.activeBackground': '#585b70',
  },
};

function initEditor() {
  if (!containerRef.value) return;

  monaco.editor.defineTheme('catppuccin-mocha', catppuccinTheme);

  editor = monaco.editor.create(containerRef.value, {
    value: props.modelValue,
    language: props.language,
    theme: 'catppuccin-mocha',
    readOnly: props.readonly,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
    fontLigatures: true,
    minimap: { enabled: true, maxColumn: 80 },
    lineNumbers: 'on',
    renderLineHighlight: 'all',
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    tabSize: props.language === 'python' ? 4 : 2,
    automaticLayout: true,
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    suggest: {
      showKeywords: true,
      showSnippets: true,
      showFunctions: true,
      showVariables: true,
    },
    padding: { top: 8, bottom: 8 },
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    roundedSelection: true,
    renderWhitespace: 'selection',
    folding: true,
    foldingStrategy: 'indentation',
    overviewRulerLanes: 2,
  });

  editor.onDidChangeModelContent(() => {
    if (ignoreNextChange) {
      ignoreNextChange = false;
      return;
    }
    emit('update:modelValue', editor!.getValue());
  });

  editor.onDidChangeCursorPosition((e) => {
    cursorPos.value = { line: e.position.lineNumber, col: e.position.column };
    emit('cursor-change', cursorPos.value);
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    emit('save');
  });
}

watch(() => props.modelValue, (newVal) => {
  if (editor && editor.getValue() !== newVal) {
    ignoreNextChange = true;
    editor.setValue(newVal);
  }
});

watch(() => props.language, (lang) => {
  if (editor) {
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, lang);
    }
    editor.updateOptions({
      tabSize: lang === 'python' ? 4 : 2,
    });
  }
});

watch(() => props.readonly, (ro) => {
  editor?.updateOptions({ readOnly: ro });
});

watch(() => props.diagnostics, (diags) => {
  if (!editor) return;
  const model = editor.getModel();
  if (!model) return;

  const markers: monaco.editor.IMarkerData[] = (diags || []).map((d) => ({
    severity: d.severity === 'error'
      ? monaco.MarkerSeverity.Error
      : d.severity === 'warning'
        ? monaco.MarkerSeverity.Warning
        : monaco.MarkerSeverity.Info,
    message: d.message,
    startLineNumber: d.line,
    startColumn: d.column,
    endLineNumber: d.line,
    endColumn: d.column + 1,
  }));

  monaco.editor.setModelMarkers(model, 'editor-validation', markers);
}, { deep: true });

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  nextTick(() => {
    initEditor();
    setTimeout(() => editor?.layout(), 50);

    if (containerRef.value) {
      resizeObserver = new ResizeObserver(() => editor?.layout());
      resizeObserver.observe(containerRef.value);
    }
  });
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  editor?.dispose();
  editor = null;
});

function focus() {
  editor?.focus();
}

function layout() {
  editor?.layout();
}

function goToLine(line: number) {
  editor?.revealLineInCenter(line);
  editor?.setPosition({ lineNumber: line, column: 1 });
  editor?.focus();
}

defineExpose({ focus, layout, goToLine, cursorPos });
</script>

<template>
  <div ref="containerRef" class="code-editor-container" />
</template>

<style scoped>
.code-editor-container {
  position: absolute;
  inset: 0;
  min-height: 200px;
  border-radius: var(--sd-radius-sm);
  overflow: hidden;
}
</style>
