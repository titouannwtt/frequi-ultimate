/** Reading and writing of the `fqu2.*` keys. The old keys are never written from here. */
import {
  defaultGatewayPrefs,
  defaultSettings,
  GATEWAY_KEY,
  MIGRATION_KEY,
  SETTINGS_KEY,
  SETTINGS_VERSION,
  type FqSettings,
  type GatewayPrefs,
  type MigrationRecord,
} from './schema';
import { upgradeSettings } from './upgrade';

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep merge of `over` onto `base`: arrays and scalars of `over` replace, objects merge. */
function mergeDeep<T>(base: T, over: unknown): T {
  if (!isObject(base) || !isObject(over)) {
    return (over === undefined ? base : over) as T;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = k in out ? mergeDeep(out[k], v) : v;
  }
  return out as T;
}

function readJson(storage: KeyValueStorage, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Settings from storage, completed with the defaults of this version so that a key added later
 * never breaks an older document. A document of another version, or a corrupt one, is ignored.
 */
export function loadSettings(storage: KeyValueStorage): FqSettings | null {
  const raw = readJson(storage, SETTINGS_KEY);
  if (!isObject(raw) || raw.v !== SETTINGS_VERSION) {
    return null;
  }
  // The revision is read before the merge: the defaults carry the current one
  const storedRev = typeof raw.columnDefaultsRev === 'number' ? raw.columnDefaultsRev : 0;
  return upgradeSettings(mergeDeep(defaultSettings(), raw), storedRev);
}

export function saveSettings(storage: KeyValueStorage, settings: FqSettings): void {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Quota or private mode: preferences last for the session only.
  }
}

export function loadGatewayPrefs(storage: KeyValueStorage): GatewayPrefs {
  const raw = readJson(storage, GATEWAY_KEY);
  return mergeDeep(defaultGatewayPrefs(), isObject(raw) ? raw : {});
}

export function saveGatewayPrefs(storage: KeyValueStorage, prefs: GatewayPrefs): void {
  try {
    storage.setItem(GATEWAY_KEY, JSON.stringify(prefs));
  } catch {
    // see saveSettings
  }
}

export function loadMigrationRecord(storage: KeyValueStorage): MigrationRecord | null {
  const raw = readJson(storage, MIGRATION_KEY);
  return isObject(raw) && isObject(raw.sourceHashes) ? (raw as unknown as MigrationRecord) : null;
}

export function saveMigrationRecord(storage: KeyValueStorage, record: MigrationRecord): void {
  try {
    storage.setItem(MIGRATION_KEY, JSON.stringify(record));
  } catch {
    // see saveSettings
  }
}

/** A random device id, `d-` followed by 8 hex digits. Not secret, not predictable. */
export function newDeviceId(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `d-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
