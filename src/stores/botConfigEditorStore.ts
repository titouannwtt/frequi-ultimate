import { useDataSource } from '@/composables/useDataSource';
import { requestAction } from '@/composables/useActionDialog';
import type {
  BotConfigResponse,
  ConfigListResponse,
  ConfigSchemaField,
  EditorValidationResult,
} from '@/types';

/**
 * Store backing the per-bot config editor modal. Targets a *specific* bot by its key (never the
 * "current bot"), reads its merged config + entry file, and writes overrides back to that bot's
 * own entry file via the fork's /stratdev/editor endpoints.
 *
 * Every call goes through the active data source (`proxy`), so it works behind the gateway
 * (whitelisted passthrough, audited, bot name in `X-Confirm-Bot` for the write) and in direct
 * mode alike, with no dependency on the legacy stores.
 */
export const useBotConfigEditorStore = defineStore('botConfigEditor', () => {
  const data = useDataSource();

  const visible = ref(false);
  const botKey = ref('');
  const name = ref('');
  /** 'live' bots get the write warning of the modal. */
  const mode = ref<string>('');
  const loading = ref(false);
  const saving = ref(false);
  /** null = ok, 'unsupported' = backend lacks the editor endpoints, else error detail. */
  const loadError = ref<string | null>(null);
  const saveError = ref<string | null>(null);

  const botConfig = ref<BotConfigResponse | null>(null);
  const schemaFields = ref<ConfigSchemaField[]>([]);
  const strategies = ref<string[]>([]);

  function botName() {
    return name.value || botKey.value;
  }

  function source() {
    const s = data.source.value;
    if (!s) throw new Error('data source not started');
    return s;
  }

  function isNotFound(e: unknown): boolean {
    const err = e as { status?: number | null; message?: string };
    return err?.status === 404 || /\b404\b/.test(err?.message ?? '');
  }

  function detailOf(e: unknown): string {
    const err = e as { message?: string };
    return err?.message ?? 'error';
  }

  async function open(key: string, botDisplayName: string, botMode = '') {
    botKey.value = key;
    name.value = botDisplayName;
    mode.value = botMode;
    visible.value = true;
    await load();
  }

  async function load() {
    loading.value = true;
    loadError.value = null;
    saveError.value = null;
    botConfig.value = null;
    try {
      const s = source();
      botConfig.value = await s.proxy<BotConfigResponse>(
        botKey.value,
        'GET',
        '/stratdev/editor/bot-config',
      );

      // Best-effort: schema catalog for the "add a parameter" picker.
      try {
        schemaFields.value = await s.proxy<ConfigSchemaField[]>(
          botKey.value,
          'GET',
          '/stratdev/editor/config-fields',
        );
      } catch {
        schemaFields.value = [];
      }
      // Best-effort: strategy list for the dropdown. Use /stratdev/configs (no mode
      // gating) rather than /strategies, which is webserver-mode-only and 404s on a live bot.
      try {
        const r = await s.proxy<ConfigListResponse>(botKey.value, 'GET', '/stratdev/configs');
        strategies.value = r.strategies ?? [];
      } catch {
        strategies.value = [];
      }
    } catch (e) {
      loadError.value = isNotFound(e) ? 'unsupported' : detailOf(e);
    } finally {
      loading.value = false;
    }
  }

  async function validateContent(content: string): Promise<EditorValidationResult | null> {
    try {
      return await source().proxy<EditorValidationResult>(
        botKey.value,
        'POST',
        '/stratdev/editor/validate',
        { content, language: 'json' },
      );
    } catch {
      return null;
    }
  }

  /**
   * Write the new entry-file content. Returns true on success. Sent once, never retried.
   * `typedName` is the bot name the user typed back at the review step (`X-Confirm-Bot`).
   */
  async function save(content: string, typedName: string): Promise<boolean> {
    if (!botConfig.value) return false;
    saving.value = true;
    saveError.value = null;
    try {
      await source().proxy(
        botKey.value,
        'POST',
        '/stratdev/editor/file',
        { path: botConfig.value.entry_file, content },
        { confirmBot: typedName },
      );
      return true;
    } catch (e) {
      saveError.value = detailOf(e);
      return false;
    } finally {
      saving.value = false;
    }
  }

  /**
   * "Reload now" and "Stop" after a save go through the one confirmation dialog of the app, for
   * THIS bot: the modal closes first so the dialog is not hidden behind it.
   */
  function reloadBot(): void {
    const key = botKey.value;
    close();
    requestAction(key, { kind: 'reload_config' });
  }

  function stopBot(): void {
    const key = botKey.value;
    close();
    requestAction(key, { kind: 'stop' });
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
    botKey,
    mode,
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
