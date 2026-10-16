/**
 * Pure helpers of the bot registry editor (Settings > Bots): the next `ftbot.N` id, the address of
 * a bot found on the host, and the checks of the add form. Nothing here touches the storage.
 */

export interface BotForm {
  name: string;
  url: string;
  username: string;
  password: string;
}

export type BotFormError = 'name' | 'url' | 'username' | 'password' | 'duplicate';

/** The next free `ftbot.N`: above every stored index, so an id is never reused or renumbered. */
export function nextUiId(existing: Iterable<string>): string {
  let max = 0;
  const taken = new Set<string>();
  for (const id of existing) {
    taken.add(id);
    const m = /^ftbot\.(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let n = max + 1;
  while (taken.has(`ftbot.${n}`)) n += 1;
  return `ftbot.${n}`;
}

/** Address of a bot found on the host, from the page address and the port it listens on. */
export function discoveredUrl(port: number | null, loc: { protocol: string; hostname: string }) {
  if (port === null || !Number.isFinite(port)) return '';
  const host = loc.hostname.includes(':') ? `[${loc.hostname}]` : loc.hostname;
  return `${loc.protocol}//${host}:${port}`;
}

const normalizeUrl = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase();

/** First problem of the form, or null. `others` are the addresses already registered. */
export function validateBotForm(
  f: BotForm,
  opts: { editing: boolean; others: string[] },
): BotFormError | null {
  if (f.name.trim() === '') return 'name';
  if (!/^https?:\/\/[^\s/]+/i.test(f.url.trim())) return 'url';
  if (f.username.trim() === '') return 'username';
  if (f.password === '') return 'password';
  if (!opts.editing && opts.others.map(normalizeUrl).includes(normalizeUrl(f.url))) {
    return 'duplicate';
  }
  return null;
}
