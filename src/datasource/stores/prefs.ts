import { defineStore } from 'pinia';
import { ref } from 'vue';

import {
  defaultGatewayPrefs,
  defaultSettings,
  type FqSettings,
  type GatewayPrefs,
  type MigrationRecord,
  type SettingsSection,
} from '@/migration/schema';
import { runMigration, type MigrationEnv } from '@/migration/migrate';
import {
  loadGatewayPrefs,
  newDeviceId,
  saveGatewayPrefs,
  saveSettings,
  type KeyValueStorage,
} from '@/migration/storage';

/**
 * Preferences of the redesigned UI, persisted in `fqu2.settings` (versioned) and
 * `fqu2.gateway`. `init()` runs the migration of the old keys first. A section edited through
 * `update()` is remembered as touched so that a later migration replay never overwrites it.
 */
export const useFqPrefsStore = defineStore('fqPrefs', () => {
  const settings = ref<FqSettings>(defaultSettings());
  const gateway = ref<GatewayPrefs>(defaultGatewayPrefs());
  const migration = ref<MigrationRecord | null>(null);
  const ready = ref(false);
  let storage: KeyValueStorage | null = null;
  /** Local revision, bumped at every edit: the sync to the gateway keys on it. */
  const rev = ref(0);

  function init(env: MigrationEnv): void {
    storage = env.storage;
    const outcome = runMigration(env);
    settings.value = outcome.settings;
    migration.value = outcome.record;
    gateway.value = loadGatewayPrefs(storage);
    if (!gateway.value.deviceId) {
      gateway.value.deviceId = newDeviceId();
      saveGatewayPrefs(storage, gateway.value);
    }
    ready.value = true;
  }

  /** Replace a section of the settings, mark it touched and persist. */
  function update<S extends SettingsSection>(section: S, value: FqSettings[S]): void {
    const s = settings.value;
    (s as Record<string, unknown>)[section] = value;
    if (!s.touched.includes(section)) {
      s.touched.push(section);
    }
    rev.value += 1;
    if (storage) saveSettings(storage, s);
  }

  /** Same as `update` for changes that come from the gateway (not an edit by the user). */
  function applyRemote<S extends SettingsSection>(section: S, value: FqSettings[S]): void {
    (settings.value as Record<string, unknown>)[section] = value;
    if (storage) saveSettings(storage, settings.value);
  }

  function updateGateway(patch: Partial<GatewayPrefs>): void {
    gateway.value = { ...gateway.value, ...patch };
    if (storage) saveGatewayPrefs(storage, gateway.value);
  }

  return { settings, gateway, migration, ready, rev, init, update, applyRemote, updateGateway };
});
