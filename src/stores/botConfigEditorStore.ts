import type {
  BotConfigResponse,
  ConfigListResponse,
  ConfigSchemaField,
  EditorValidationResult,
} from '@/types';

/**
 * Store backing the per-bot config editor modal. Targets a *specific* bot by id
 * (not the active bot), reads its merged config + entry file, and writes overrides
 * back to that bot's own entry file via the fork's /stratdev/editor endpoints.
 */
export const useBotConfigEditorStore = defineStore('botConfigEditor', () => {
  const botStore = useBotStore();

  const visible = ref(false);
  const botId = ref('');
  const loading = ref(false);
  const saving = ref(false);
  /** null = ok, 'unsupported' = backend lacks the editor endpoints, else error detail. */
  const loadError = ref<string | null>(null);
  const saveError = ref<string | null>(null);

  const botConfig = ref<BotConfigResponse | null>(null);
  const schemaFields = ref<ConfigSchemaField[]>([]);
  const strategies = ref<string[]>([]);

  function getApi(id: string) {
    const loginInfo = useLoginInfo(id);
    return useApi(loginInfo, id).api;
  }

  function botName() {
    return botStore.availableBots[botId.value]?.botName ?? botId.value;
  }

  async function open(id: string) {
    botId.value = id;
    visible.value = true;
    await load();
  }

  async function load() {
    loading.value = true;
    loadError.value = null;
    saveError.value = null;
    botConfig.value = null;
    try {
      const api = getApi(botId.value);
      const { data } = await api.get<BotConfigResponse>('/stratdev/editor/bot-config');
      botConfig.value = data;

      // Best-effort: schema catalog for the "add a parameter" picker.
      try {
        const r = await api.get<ConfigSchemaField[]>('/stratdev/editor/config-fields');
        schemaFields.value = r.data;
      } catch {
        schemaFields.value = [];
      }
      // Best-effort: strategy list for the dropdown. Use /stratdev/configs (no mode
      // gating) rather than /strategies, which is webserver-mode-only and 404s on a live bot.
      try {
        const r = await api.get<ConfigListResponse>('/stratdev/configs');
        strategies.value = r.data.strategies ?? [];
      } catch {
        strategies.value = [];
      }
    } catch (e) {
      const err = e as {
        response?: { status?: number; data?: { detail?: string } };
        message?: string;
      };
      loadError.value =
        err?.response?.status === 404
          ? 'unsupported'
          : (err?.response?.data?.detail ?? err?.message ?? 'error');
    } finally {
      loading.value = false;
    }
  }

  async function validateContent(content: string): Promise<EditorValidationResult | null> {
    try {
      const api = getApi(botId.value);
      const { data } = await api.post<EditorValidationResult>('/stratdev/editor/validate', {
        content,
        language: 'json',
      });
      return data;
    } catch {
      return null;
    }
  }

  /** Write the new entry-file content. Returns true on success. */
  async function save(content: string): Promise<boolean> {
    if (!botConfig.value) return false;
    saving.value = true;
    saveError.value = null;
    try {
      const api = getApi(botId.value);
      await api.post('/stratdev/editor/file', {
        path: botConfig.value.entry_file,
        content,
      });
      return true;
    } catch (e) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      saveError.value = err?.response?.data?.detail ?? err?.message ?? 'error';
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function reloadBot(): Promise<void> {
    await botStore.botStores[botId.value]?.reloadConfig();
  }

  async function stopBot(): Promise<void> {
    await botStore.botStores[botId.value]?.stopBot();
  }

  function close() {
    visible.value = false;
    botConfig.value = null;
    schemaFields.value = [];
    strategies.value = [];
    loadError.value = null;
    saveError.value = null;
  }

  return {
    visible,
    botId,
    loading,
    saving,
    loadError,
    saveError,
    botConfig,
    schemaFields,
    strategies,
    botName,
    open,
    load,
    validateContent,
    save,
    reloadBot,
    stopBot,
    close,
  };
});
