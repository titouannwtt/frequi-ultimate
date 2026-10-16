/**
 * useConfigExport — Export/Import all FreqUI user configuration.
 *
 * Security features:
 * - Layout/auth separation: tokens excluded by default
 * - XSalsa20-Poly1305 encryption via tweetnacl (works over HTTP)
 * - SHA-512 integrity hash to detect tampering
 * - Expiration warning (>7 days)
 * - Preview before apply
 */

import nacl from 'tweetnacl';

const LAYOUT_KEYS = [
  'ftUISettings',
  'ftUIColorSettings',
  'ftLayoutSettings',
  'ftPlotConfig',
  'ftBotComparison',
  'ftUIChartSettings',
  'ftPairlistConfig',
  'ftSelectedBot',
  'ft_locale',
  'enhancedOpenTradeColumns',
  'enhancedClosedTradeColumns',
  'enhancedOpenTradeColumnOrder',
  'enhancedClosedTradeColumnOrder',
  'ft_benchmarks_enabled',
  'ft_market_overview_settings',
  'ft_profit_goal',
];

const AUTH_KEYS = ['ftAuthLoginInfo'];

/**
 * Keys of the redesigned UI (format v3). `fqu2.gateway` is not copied as is: it holds the session
 * of this device, which never leaves it; only the address and the source mode are exported.
 * `fqu2.migration`, `fqu2.sync` and `fqu2.lastVisit` are caches of this device.
 */
export const FQU2_KEYS = [
  'fqu2.settings',
  'fqu2.density',
  'fqu2.journal.views',
  'fqu2.fleetView',
  'fqu2.charts.rsi',
  'fqu2.cvd',
  'fqu2.motion',
];
const GATEWAY_KEY = 'fqu2.gateway';

const ALL_KEYS = [...LAYOUT_KEYS, ...AUTH_KEYS, ...FQU2_KEYS, GATEWAY_KEY];

interface ConfigPayload {
  integrity: string;
  data: Record<string, string>;
}

interface FreqUIConfigV2 {
  version: 2 | 3;
  exportedAt: string;
  includesAuth: boolean;
  encrypted?: boolean;
  integrity?: string;
  data?: Record<string, string>;
  salt?: string;
  nonce?: string;
  ciphertext?: string;
}

interface FreqUIConfigV1 {
  version: 1;
  exportedAt: string;
  data: Record<string, string>;
}

type FreqUIConfig = FreqUIConfigV1 | FreqUIConfigV2;

export interface ConfigPreview {
  exportedAt: string;
  ageInDays: number;
  isExpired: boolean;
  includesAuth: boolean;
  encrypted: boolean;
  settingsCount: number;
  botCount: number;
  integrityValid: boolean | null;
  version: number;
}

// ── Crypto helpers (pure JS via tweetnacl) ──

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeUTF8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function decodeUTF8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function deriveKey(password: string, salt: Uint8Array): Uint8Array {
  const pwBytes = encodeUTF8(password);
  const combined = new Uint8Array(pwBytes.length + salt.length);
  combined.set(pwBytes);
  combined.set(salt, pwBytes.length);
  let hash = nacl.hash(combined);
  for (let i = 0; i < 10_000; i++) {
    hash = nacl.hash(hash);
  }
  return hash.slice(0, nacl.secretbox.keyLength);
}

function hashIntegrity(data: string): string {
  const hash = nacl.hash(encodeUTF8(data));
  let hex = '';
  for (let i = 0; i < hash.length; i++) {
    hex += hash[i].toString(16).padStart(2, '0');
  }
  return 'sha512:' + hex;
}

function encrypt(
  plaintext: string,
  password: string,
): { salt: string; nonce: string; ciphertext: string } {
  const salt = nacl.randomBytes(16);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const key = deriveKey(password, salt);
  const box = nacl.secretbox(encodeUTF8(plaintext), nonce, key);
  return {
    salt: toBase64(salt),
    nonce: toBase64(nonce),
    ciphertext: toBase64(box),
  };
}

function decrypt(ciphertext: string, salt: string, nonce: string, password: string): string {
  const key = deriveKey(password, fromBase64(salt));
  const plain = nacl.secretbox.open(fromBase64(ciphertext), fromBase64(nonce), key);
  if (!plain) throw new Error('WRONG_PASSWORD');
  return decodeUTF8(plain);
}

// ── Export ──

/** What an export holds: the layout keys, the `fqu2.*` keys, and the logins when asked for. */
export function collectExportData(
  includeAuth: boolean,
  storage: Pick<Storage, 'getItem'> = localStorage,
): Record<string, string> {
  const keys = [...LAYOUT_KEYS, ...FQU2_KEYS, ...(includeAuth ? AUTH_KEYS : [])];
  const data: Record<string, string> = {};
  for (const key of keys) {
    const value = storage.getItem(key);
    if (value !== null) {
      data[key] = value;
    }
  }
  // Address and mode of the gateway, never its session or the device id
  const gw = storage.getItem(GATEWAY_KEY);
  if (gw !== null) {
    try {
      const parsed = JSON.parse(gw) as { url?: unknown; mode?: unknown };
      data[GATEWAY_KEY] = JSON.stringify({
        ...(typeof parsed.url === 'string' ? { url: parsed.url } : {}),
        ...(typeof parsed.mode === 'string' ? { mode: parsed.mode } : {}),
      });
    } catch {
      /* unreadable: left out */
    }
  }
  return data;
}

/**
 * Writes the keys of an export back. `fqu2.gateway` is merged into what this device already has,
 * so its session and device id survive; any other key of the list replaces the stored one.
 * Returns the number of keys written.
 */
export function applyImportData(
  data: Record<string, string>,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): number {
  let written = 0;
  for (const [key, value] of Object.entries(data)) {
    if (!ALL_KEYS.includes(key)) continue;
    if (key === GATEWAY_KEY) {
      try {
        const incoming = JSON.parse(value) as { url?: unknown; mode?: unknown };
        const current = JSON.parse(storage.getItem(GATEWAY_KEY) ?? '{}') as Record<string, unknown>;
        storage.setItem(
          GATEWAY_KEY,
          JSON.stringify({
            ...current,
            ...(typeof incoming.url === 'string' ? { url: incoming.url } : {}),
            ...(typeof incoming.mode === 'string' ? { mode: incoming.mode } : {}),
          }),
        );
        written++;
      } catch {
        /* unreadable: left out */
      }
      continue;
    }
    storage.setItem(key, value);
    written++;
  }
  return written;
}

export function exportConfig(options: { includeAuth: boolean; password?: string }): void {
  const data = collectExportData(options.includeAuth);

  const dataJson = JSON.stringify(data);
  const integrity = hashIntegrity(dataJson);

  let config: FreqUIConfigV2;

  if (options.includeAuth && options.password) {
    const payload: ConfigPayload = { integrity, data };
    const enc = encrypt(JSON.stringify(payload), options.password);
    config = {
      version: 3,
      exportedAt: new Date().toISOString(),
      includesAuth: true,
      encrypted: true,
      ...enc,
    };
  } else {
    config = {
      version: 3,
      exportedAt: new Date().toISOString(),
      includesAuth: options.includeAuth,
      integrity,
      data,
    };
  }

  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `frequi-config-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Preview (parse without applying) ──

export function previewConfig(file: File): Promise<ConfigPreview> {
  return file.text().then((text) => {
    const config: FreqUIConfig = JSON.parse(text);

    if (!config.version) {
      throw new Error('INVALID_FORMAT');
    }

    const exportedAt = config.exportedAt;
    const ageMs = Date.now() - new Date(exportedAt).getTime();
    const ageInDays = Math.max(0, Math.floor(ageMs / 86_400_000));

    if (config.version === 1) {
      const v1 = config as FreqUIConfigV1;
      const hasAuth = !!v1.data['ftAuthLoginInfo'];
      let botCount = 0;
      if (hasAuth) {
        try {
          botCount = Object.keys(JSON.parse(v1.data['ftAuthLoginInfo'])).length;
        } catch {
          /* ignore */
        }
      }
      return {
        exportedAt,
        ageInDays,
        isExpired: ageInDays > 7,
        includesAuth: hasAuth,
        encrypted: false,
        settingsCount: Object.keys(v1.data).length,
        botCount,
        integrityValid: null,
        version: 1,
      };
    }

    const v2 = config as FreqUIConfigV2;

    if (v2.encrypted) {
      return {
        exportedAt,
        ageInDays,
        isExpired: ageInDays > 7,
        includesAuth: v2.includesAuth,
        encrypted: true,
        settingsCount: 0,
        botCount: 0,
        integrityValid: null,
        version: v2.version,
      };
    }

    const data = v2.data!;
    const dataJson = JSON.stringify(data);
    const expectedHash = hashIntegrity(dataJson);
    const integrityValid = v2.integrity ? v2.integrity === expectedHash : null;

    let botCount = 0;
    const authData = data['ftAuthLoginInfo'];
    if (authData) {
      try {
        botCount = Object.keys(JSON.parse(authData)).length;
      } catch {
        /* ignore */
      }
    }

    return {
      exportedAt,
      ageInDays,
      isExpired: ageInDays > 7,
      includesAuth: v2.includesAuth,
      encrypted: false,
      settingsCount: Object.keys(data).length,
      botCount,
      integrityValid,
      version: v2.version,
    };
  });
}

// ── Import ──

export function importConfig(
  file: File,
  options?: { password?: string },
): Promise<{ keysRestored: number; botCount: number }> {
  return file.text().then((text) => {
    const config: FreqUIConfig = JSON.parse(text);

    if (!config.version) {
      throw new Error('INVALID_FORMAT');
    }

    let data: Record<string, string>;

    if (config.version === 1) {
      data = (config as FreqUIConfigV1).data;
    } else {
      const v2 = config as FreqUIConfigV2;

      if (v2.encrypted) {
        if (!options?.password) throw new Error('PASSWORD_REQUIRED');
        if (!v2.ciphertext || !v2.salt || !v2.nonce) throw new Error('INVALID_FORMAT');

        let payload: ConfigPayload;
        try {
          const decrypted = decrypt(v2.ciphertext, v2.salt, v2.nonce, options.password);
          payload = JSON.parse(decrypted);
        } catch (err: any) {
          if (err?.message === 'WRONG_PASSWORD') throw err;
          throw new Error('WRONG_PASSWORD', { cause: err });
        }

        const dataJson = JSON.stringify(payload.data);
        const expectedHash = hashIntegrity(dataJson);
        if (payload.integrity !== expectedHash) {
          throw new Error('INTEGRITY_FAILED');
        }
        data = payload.data;
      } else {
        if (v2.integrity) {
          const dataJson = JSON.stringify(v2.data);
          const expectedHash = hashIntegrity(dataJson);
          if (v2.integrity !== expectedHash) {
            throw new Error('INTEGRITY_FAILED');
          }
        }
        data = v2.data!;
      }
    }

    const keysRestored = applyImportData(data);

    let botCount = 0;
    const authData = data['ftAuthLoginInfo'];
    if (authData) {
      try {
        botCount = Object.keys(JSON.parse(authData)).length;
      } catch {
        /* ignore */
      }
    }

    return { keysRestored, botCount };
  });
}

export function hasConfiguredBots(): boolean {
  const authData = localStorage.getItem('ftAuthLoginInfo');
  if (!authData) return false;
  try {
    return Object.keys(JSON.parse(authData)).length > 0;
  } catch {
    return false;
  }
}
