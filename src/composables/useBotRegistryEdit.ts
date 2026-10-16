import { readLoginInfos, useLoginInfo } from '@/composables/loginInfo';
import { nextUiId, type BotForm } from '@/components/fq/lib/registryEdit';

/**
 * The writes of the bot registry (Settings > Bots): they land in `ftAuthLoginInfo`, the storage
 * the legacy pages and the data layer share, so a bot added here is known to both. Ids are
 * `ftbot.N`, never renumbered. The password is only used for the login call and is not stored.
 */
export function useBotRegistryEdit() {
  /** Log in and register a new bot; returns its `ftbot.N` id. Rejects when the login fails. */
  async function addBot(form: BotForm): Promise<string> {
    const id = nextUiId(Object.keys(readLoginInfos()));
    const all = Object.values(readLoginInfos());
    const sortId = all.reduce((m, e) => Math.max(m, e?.sortId ?? 0), 0) + 1;
    await useLoginInfo(id).login({
      botName: form.name.trim(),
      url: form.url.trim().replace(/\/+$/, ''),
      username: form.username.trim(),
      password: form.password,
    });
    useLoginInfo(id).updateBot({ sortId });
    return id;
  }

  /** Log in again on an existing entry (expired session, new password, new address). */
  async function relogin(uiId: string, form: BotForm): Promise<void> {
    await useLoginInfo(uiId).login({
      botName: form.name.trim(),
      url: form.url.trim().replace(/\/+$/, ''),
      username: form.username.trim(),
      password: form.password,
    });
  }

  function rename(uiId: string, name: string): void {
    useLoginInfo(uiId).updateBot({ botName: name.trim() });
  }

  function remove(uiId: string): void {
    useLoginInfo(uiId).logout();
  }

  return { addBot, relogin, rename, remove };
}
