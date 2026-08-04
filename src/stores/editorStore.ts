import type {
  EditorConfigSchema,
  EditorDiagnostic,
  EditorFileContent,
  EditorSaveResponse,
  EditorStrategyHints,
  EditorValidationResult,
} from '@/types';

export interface EditorFile {
  path: string;
  language: 'json' | 'python';
  content: string;
  originalContent: string;
  isCustom: boolean;
  label: string;
}

export const useEditorStore = defineStore('editor', () => {
  const botStore = useBotStore();

  const isOpen = ref(false);
  const openFiles = ref<EditorFile[]>([]);
  const activeIndex = ref(0);
  const saving = ref(false);
  const diagnostics = ref<EditorDiagnostic[]>([]);
  const schema = ref<EditorConfigSchema | null>(null);
  const strategyHints = ref<EditorStrategyHints | null>(null);

  let _validateTimer: ReturnType<typeof setTimeout> | null = null;

  function getApi() {
    const loginInfo = useLoginInfo(botStore.selectedBot);
    return useApi(loginInfo, botStore.selectedBot).api;
  }

  const activeFile = computed(() => openFiles.value[activeIndex.value] ?? null);
  const isDirty = computed(() =>
    activeFile.value ? activeFile.value.content !== activeFile.value.originalContent : false,
  );

  async function openFile(filePath: string, language: 'json' | 'python', createCustomCopy = false) {
    const existingIdx = openFiles.value.findIndex((f) => f.path === filePath);
    if (existingIdx >= 0 && !createCustomCopy) {
      activeIndex.value = existingIdx;
      isOpen.value = true;
      return;
    }

    try {
      const api = getApi();
      const { data } = await api.get<EditorFileContent>('/stratdev/editor/file', {
        params: { file_path: filePath },
      });

      if (createCustomCopy) {
        const { data: saved } = await api.post<EditorSaveResponse>('/stratdev/editor/file', {
          path: filePath,
          content: data.content,
          create_custom: true,
        });

        const file: EditorFile = {
          path: saved.path,
          language,
          content: data.content,
          originalContent: data.content,
          isCustom: true,
          label: customLabel(saved.path),
        };
        openFiles.value.push(file);
        activeIndex.value = openFiles.value.length - 1;
      } else {
        const file: EditorFile = {
          path: filePath,
          language,
          content: data.content,
          originalContent: data.content,
          isCustom: data.is_custom,
          label: fileLabel(filePath, data.is_custom),
        };
        openFiles.value.push(file);
        activeIndex.value = openFiles.value.length - 1;
      }

      isOpen.value = true;
      scheduleValidation();
    } catch (e: any) {
      console.error('Failed to open file', e);
    }
  }

  function updateContent(content: string) {
    if (activeFile.value) {
      activeFile.value.content = content;
      scheduleValidation();
    }
  }

  async function saveActiveFile() {
    const file = activeFile.value;
    if (!file) return;
    saving.value = true;
    try {
      const api = getApi();
      const { data } = await api.post<EditorSaveResponse>('/stratdev/editor/file', {
        path: file.path,
        content: file.content,
      });
      file.originalContent = file.content;
      file.path = data.path;
      file.isCustom = data.is_custom;
    } catch (e: any) {
      console.error('Failed to save file', e);
    } finally {
      saving.value = false;
    }
  }

  function scheduleValidation() {
    if (_validateTimer) clearTimeout(_validateTimer);
    _validateTimer = setTimeout(async () => {
      const file = activeFile.value;
      if (!file) return;
      try {
        const api = getApi();
        const { data } = await api.post<EditorValidationResult>('/stratdev/editor/validate', {
          content: file.content,
          language: file.language,
        });
        diagnostics.value = data.errors;
      } catch {
        // silent
      }
    }, 600);
  }

  async function fetchSchema() {
    if (schema.value) return;
    try {
      const api = getApi();
      const { data } = await api.get<EditorConfigSchema>('/stratdev/editor/schema');
      schema.value = data;
    } catch {
      // silent
    }
  }

  async function fetchStrategyHints() {
    if (strategyHints.value) return;
    try {
      const api = getApi();
      const { data } = await api.get<EditorStrategyHints>('/stratdev/editor/strategy-hints');
      strategyHints.value = data;
    } catch {
      // silent
    }
  }

  function closeFile(index: number) {
    openFiles.value.splice(index, 1);
    if (activeIndex.value >= openFiles.value.length) {
      activeIndex.value = Math.max(0, openFiles.value.length - 1);
    }
    if (openFiles.value.length === 0) {
      isOpen.value = false;
      diagnostics.value = [];
    }
  }

  function closeAll() {
    openFiles.value = [];
    activeIndex.value = 0;
    isOpen.value = false;
    diagnostics.value = [];
  }

  function fileLabel(path: string, isCustom: boolean): string {
    if (isCustom) return customLabel(path);
    const parts = path.split('/');
    return parts[parts.length - 1];
  }

  function customLabel(path: string): string {
    const match = path.match(/custom_config_(\d+)/);
    return match ? `Custom #${match[1]}` : path.split('/').pop() || path;
  }

  function $reset() {
    closeAll();
    schema.value = null;
    strategyHints.value = null;
    saving.value = false;
  }

  return {
    isOpen,
    openFiles,
    activeIndex,
    activeFile,
    isDirty,
    saving,
    diagnostics,
    schema,
    strategyHints,
    openFile,
    updateContent,
    saveActiveFile,
    fetchSchema,
    fetchStrategyHints,
    closeFile,
    closeAll,
    $reset,
  };
});
