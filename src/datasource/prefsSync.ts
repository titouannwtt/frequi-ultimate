/**
 * Preferences shared between devices through the gateway (05 `GET/PUT /prefs`, owner decision: the
 * same columns, groups and tags on the phone and on the desktop). Only in gateway mode; in direct
 * mode nothing leaves the browser.
 *
 * One versioned document per user. Each synced section (`SYNCED_SECTIONS`) is merged on its own
 * with a three-way rule against the last state this device saw (`base`, a hash per section):
 *
 * - changed here only: pushed; changed remotely only: adopted;
 * - changed on both sides: the gateway wins (it is the arbiter), the local copy is overwritten;
 * - a write carries `If-Match` (the version it read); a conflict (409) reads again and merges again.
 *
 * Sections that are per device (locale, selected bot, scope, UI toggles) never leave the device.
 * The document also carries `groups` (`{id: [bot_key]}`), derived from `fleet.groups`: the gateway
 * reads it to resolve group scopes (`scope=group:<id>`).
 */
import { hashString } from '@/migration/hash';
import {
  defaultSettings,
  SYNCED_SECTIONS,
  type FqSettings,
  type SettingsSection,
} from '@/migration/schema';
import type { KeyValueStorage } from '@/migration/storage';

export const SYNC_KEY = 'fqu2.sync';
const DOC_VERSION = 1;
const MAX_ATTEMPTS = 3;

export interface RemotePrefs {
  version: number;
  data: unknown;
}

/** The two calls the gateway offers on the global document. */
export interface PrefsRemote {
  /** `null` when no document exists yet. */
  get(): Promise<RemotePrefs | null>;
  /** `ifMatch: null` creates the document; a conflict throws an error with `conflict: true`. */
  put(data: unknown, ifMatch: number | null): Promise<{ version: number }>;
}

export interface SyncState {
  /** Version of the remote document at the last exchange. */
  version: number | null;
  /** Hash of each synced section as last seen identical on both sides. */
  base: Partial<Record<SettingsSection, string>>;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export interface PrefsPort {
  settings: () => FqSettings;
  /** Applies a section that comes from the gateway (not counted as a local edit). */
  applyRemote: <S extends SettingsSection>(section: S, value: FqSettings[S]) => void;
}

export interface PrefsSyncDeps {
  remote: PrefsRemote;
  prefs: PrefsPort;
  storage: KeyValueStorage;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  debounceMs?: number;
  onStatus?: (s: SyncStatus) => void;
}

/** JSON with sorted keys: two equal values hash the same whatever the order they were built in. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

export function sectionHash(value: unknown): string {
  return hashString(canonical(value));
}

export function isConflict(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    ((e as { conflict?: boolean }).conflict === true ||
      (e as { code?: string }).code === 'state_mismatch')
  );
}

export function buildDoc(settings: FqSettings): Record<string, unknown> {
  const sections: Record<string, unknown> = {};
  for (const s of SYNCED_SECTIONS) sections[s] = settings[s];
  const groups: Record<string, string[]> = {};
  for (const g of settings.fleet.groups) groups[g.id] = [...g.botKeys];
  return { v: DOC_VERSION, settings: sections, groups };
}

function remoteSections(data: unknown): Partial<Record<SettingsSection, unknown>> | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { v?: unknown; settings?: unknown };
  if (d.v !== DOC_VERSION || !d.settings || typeof d.settings !== 'object') return null;
  return d.settings as Partial<Record<SettingsSection, unknown>>;
}

export interface MergeResult {
  /** Sections to write into the local settings. */
  adopt: Array<[SettingsSection, unknown]>;
  /** The remote document must be written (a section changed here, or it is missing there). */
  push: boolean;
  base: SyncState['base'];
}

/** Three-way merge of the synced sections. Pure. */
export function mergeSections(
  local: FqSettings,
  remote: Partial<Record<SettingsSection, unknown>> | null,
  base: SyncState['base'],
): MergeResult {
  const adopt: MergeResult['adopt'] = [];
  const nextBase: SyncState['base'] = { ...base };
  let push = false;
  const defaults = defaultSettings();
  /** Worth sharing: edited in the new UI, or imported from the old one (different from a blank install). */
  const custom = (s: SettingsSection, hash: string) =>
    local.touched.includes(s) || hash !== sectionHash(defaults[s]);
  for (const s of SYNCED_SECTIONS) {
    const localHash = sectionHash(local[s]);
    const hasRemote = remote !== null && remote[s] !== undefined;
    const remoteHash = hasRemote ? sectionHash(remote[s]) : null;
    const known = base[s];
    if (!hasRemote) {
      // Nothing there yet: this device seeds the document, but only with what the user chose.
      if (custom(s, localHash)) push = true;
      nextBase[s] = localHash;
      continue;
    }
    if (remoteHash === localHash) {
      nextBase[s] = localHash;
      continue;
    }
    const localChanged = known === undefined ? custom(s, localHash) : localHash !== known;
    const remoteChanged = known === undefined ? true : remoteHash !== known;
    if (localChanged && !remoteChanged) {
      push = true;
      nextBase[s] = localHash;
    } else {
      // Changed remotely, or on both sides: the gateway wins.
      adopt.push([s, remote[s]]);
      nextBase[s] = remoteHash as string;
    }
  }
  return { adopt, push, base: nextBase };
}

function loadState(storage: KeyValueStorage): SyncState {
  try {
    const raw = storage.getItem(SYNC_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<SyncState>) : null;
    if (v && typeof v === 'object') {
      return { version: typeof v.version === 'number' ? v.version : null, base: v.base ?? {} };
    }
  } catch {
    // Corrupt state: start again from "never synced".
  }
  return { version: null, base: {} };
}

export class PrefsSync {
  private readonly d: PrefsSyncDeps;
  private state: SyncState;
  private timer: unknown = null;
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = false;
  status: SyncStatus = 'idle';

  constructor(deps: PrefsSyncDeps) {
    this.d = deps;
    this.state = loadState(deps.storage);
  }

  private setStatus(s: SyncStatus): void {
    this.status = s;
    this.d.onStatus?.(s);
  }

  private save(): void {
    try {
      this.d.storage.setItem(SYNC_KEY, JSON.stringify(this.state));
    } catch {
      // Without storage the next session merges from "never synced": still correct, only slower.
    }
  }

  /** Read, merge and write what changed. Calls while a sync runs are folded into one more run. */
  sync(): Promise<void> {
    this.stopped = false;
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.again && !this.stopped) {
        this.again = false;
        void this.sync();
      }
    });
    return this.running;
  }

  /** A local edit: write after a short quiet period. */
  schedulePush(): void {
    if (this.stopped) return;
    const clear = this.d.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    const set = this.d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    if (this.timer !== null) clear(this.timer);
    this.timer = set(() => {
      this.timer = null;
      void this.sync();
    }, this.d.debounceMs ?? 1_500);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      (this.d.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
      this.timer = null;
    }
  }

  private async run(): Promise<void> {
    this.setStatus('syncing');
    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const remote = await this.d.remote.get();
        const merged = mergeSections(
          this.d.prefs.settings(),
          remote ? remoteSections(remote.data) : null,
          this.state.base,
        );
        for (const [section, value] of merged.adopt) {
          this.d.prefs.applyRemote(section, value as never);
        }
        const settings = this.d.prefs.settings();
        // The gateway reads `groups` from the document: a document that lacks them is rewritten.
        const needsDoc = remote !== null && remoteSections(remote.data) === null;
        if (merged.push || needsDoc || this.groupsOutdated(remote)) {
          try {
            const res = await this.d.remote.put(buildDoc(settings), remote ? remote.version : null);
            this.state = { version: res.version, base: this.baseOf(settings) };
            this.save();
            this.setStatus('synced');
            return;
          } catch (e) {
            if (isConflict(e) && attempt < MAX_ATTEMPTS - 1) continue;
            throw e;
          }
        }
        this.state = { version: remote ? remote.version : null, base: merged.base };
        this.save();
        this.setStatus('synced');
        return;
      }
    } catch {
      this.setStatus('error');
    }
  }

  private baseOf(settings: FqSettings): SyncState['base'] {
    const base: SyncState['base'] = {};
    for (const s of SYNCED_SECTIONS) base[s] = sectionHash(settings[s]);
    return base;
  }

  private groupsOutdated(remote: RemotePrefs | null): boolean {
    if (!remote || typeof remote.data !== 'object' || remote.data === null) return false;
    const have = (remote.data as { groups?: unknown }).groups;
    const want = buildDoc(this.d.prefs.settings()).groups;
    return canonical(have ?? {}) !== canonical(want);
  }
}
