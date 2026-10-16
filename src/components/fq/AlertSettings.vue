<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { Badge, Banner, FormRow, Skeleton, Switch } from '@/components/ds';
import { useDataSource } from '@/composables/useDataSource';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { AlertRulesConfig, AlertTypeId, Severity } from '@/gateway/types.gen';
import { defaultAlertRulesConfig } from '@/datasource/calc/alerts/rules';

import {
  byCategory,
  clampThreshold,
  ruleRows,
  withBotEnabled,
  withRule,
} from './lib/alertSettings';

/**
 * Settings > Alerts (02 section 3.6, 4): the 14 rules with their switch, threshold and severity,
 * and the bots whose alerts are muted. This is the way to the configuration that the old popover
 * never offered (bug B7: it had no trigger). A change is saved at once, through the source (the
 * gateway shares it between devices; in direct mode it stays on this browser). Browser
 * notifications need a secure context: over plain HTTP the browser refuses them, and it says so.
 */
const { t } = useI18n();
const data = useDataSource();
const prefs = useFqPrefsStore();
const fleet = useFqFleetStore();

const cfg = ref<AlertRulesConfig | null>(null);
const error = ref<string | null>(null);
const saving = ref(false);

async function load() {
  const source = data.source.value;
  if (!source) return;
  try {
    cfg.value = await source.alerts.rules();
    error.value = null;
  } catch (e) {
    cfg.value = defaultAlertRulesConfig();
    error.value = e instanceof Error ? e.message : String(e);
  }
}
onMounted(load);
watch(data.source, load);

async function save(next: AlertRulesConfig) {
  const source = data.source.value;
  if (!source) return;
  const previous = cfg.value;
  cfg.value = next;
  saving.value = true;
  try {
    await source.alerts.setRules(next);
    error.value = null;
  } catch (e) {
    cfg.value = previous;
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    saving.value = false;
  }
}

const groups = computed(() => (cfg.value ? byCategory(ruleRows(cfg.value)) : []));
const SEV: Record<Severity, 'info' | 'warn' | 'crit'> = { info: 'info', warning: 'warn', critical: 'crit' };

function toggle(id: AlertTypeId, enabled: boolean) {
  if (cfg.value) void save(withRule(cfg.value, id, { enabled }));
}
function setThreshold(id: AlertTypeId, raw: string) {
  if (!cfg.value) return;
  const v = clampThreshold(raw, id);
  if (v !== null) void save(withRule(cfg.value, id, { threshold: v }));
}
function reset() {
  if (!cfg.value) return;
  // Switches and thresholds go back to the catalog; the muted bots and per-bot overrides stay
  void save({
    ...defaultAlertRulesConfig(),
    perBotEnabled: cfg.value.perBotEnabled,
    perBot: cfg.value.perBot,
  });
}

const bots = computed(() =>
  fleet.list
    .slice()
    .sort((a, b) =>
      a.identity.name.localeCompare(b.identity.name, undefined, { numeric: true, sensitivity: 'base' }),
    ),
);
const muted = (key: string) => cfg.value?.perBotEnabled[key] === false;
function setBot(key: string, enabled: boolean) {
  if (cfg.value) void save(withBotEnabled(cfg.value, key, enabled));
}

// ---- browser notifications ----
const secure = typeof window !== 'undefined' && window.isSecureContext === true;
const supported = typeof Notification !== 'undefined';
const canNotify = secure && supported;
const browser = computed(() => prefs.settings.alerts.notifications.browser);
async function setBrowser(on: boolean) {
  if (on && canNotify && Notification.permission === 'default') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') return;
  }
  if (on && canNotify && Notification.permission === 'denied') return;
  prefs.update('alerts', {
    ...prefs.settings.alerts,
    notifications: { ...prefs.settings.alerts.notifications, browser: on },
  });
}
</script>

<template>
  <div class="as" data-testid="alert-settings">
    <Banner v-if="error" kind="degraded">{{ t('fq.pg.settings.al.saveFailed', { detail: error }) }}</Banner>
    <p v-if="data.source.value && !data.source.value.alerts.shared" class="note">
      {{ t('fq.alert.notShared') }}
    </p>

    <Skeleton v-if="!cfg" :count="5" />
    <template v-else>
      <div v-for="g in groups" :key="g.category" class="grp">
        <h3>{{ t(`fq.pg.settings.al.cat.${g.category}`) }}</h3>
        <FormRow
          v-for="r in g.rows"
          :key="r.id"
          :label="t(`fq.alert.type.${r.id}`)"
          :hint="r.changed ? t('fq.pg.settings.al.changed') : undefined"
        >
          <Badge :kind="SEV[r.severity]" :label="t(`fq.pg.settings.al.sev.${r.severity}`)" />
          <span v-if="r.spec" class="thr">
            <input
              class="num-in"
              type="number"
              inputmode="decimal"
              :min="r.spec.min"
              :max="r.spec.max"
              :step="r.spec.step"
              :value="r.threshold ?? ''"
              :disabled="!r.enabled"
              :aria-label="t('fq.pg.settings.al.threshold', { name: t(`fq.alert.type.${r.id}`) })"
              :data-rule="r.id"
              @change="(e) => setThreshold(r.id, (e.target as HTMLInputElement).value)"
            />
            <span class="unit">{{ r.spec.unit }}</span>
          </span>
          <Switch
            hide-label
            :model-value="r.enabled"
            :label="t(`fq.alert.type.${r.id}`)"
            :data-rule-switch="r.id"
            @update:model-value="(v) => toggle(r.id, v)"
          />
        </FormRow>
      </div>

      <div class="row">
        <button type="button" class="lnk" data-testid="alerts-reset" @click="reset">
          {{ t('fq.pg.settings.al.reset') }}
        </button>
      </div>

      <details class="bots">
        <summary>{{ t('fq.pg.settings.al.perBot') }}</summary>
        <p class="note">{{ t('fq.pg.settings.al.perBotHint') }}</p>
        <FormRow v-for="b in bots" :key="b.bot_key" :label="b.identity.name">
          <Switch
            hide-label
            :model-value="!muted(b.bot_key)"
            :label="b.identity.name"
            @update:model-value="(v) => setBot(b.bot_key, v)"
          />
        </FormRow>
      </details>
    </template>

    <h3>{{ t('fq.pg.settings.al.notifications') }}</h3>
    <FormRow
      :label="t('fq.pg.settings.al.browser')"
      :hint="canNotify ? t('fq.pg.settings.al.browserHint') : undefined"
    >
      <Switch
        hide-label
        :model-value="browser && canNotify"
        :disabled="!canNotify"
        :label="t('fq.pg.settings.al.browser')"
        data-testid="set-browser-notif"
        @update:model-value="setBrowser"
      />
    </FormRow>
    <p v-if="!canNotify" class="note" data-testid="notif-unavailable">
      {{ secure ? t('fq.pg.settings.al.unsupported') : t('fq.pg.settings.al.insecure') }}
    </p>
  </div>
</template>

<style scoped>
.as {
  display: grid;
  gap: var(--s1);
}
h3 {
  margin: var(--s3) 0 0;
  font-size: var(--t-md);
  font-weight: 600;
  color: var(--fg-2);
}
.note {
  margin: 0;
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.thr {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.num-in {
  width: 72px;
  height: 28px;
  padding: 0 6px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-1);
  background: var(--bg-1);
  color: var(--fg);
  font-family: var(--font-num);
  font-size: var(--t-sm);
  text-align: right;
}
.num-in:disabled {
  color: var(--fg-4);
}
.unit {
  color: var(--fg-3);
  font-size: var(--t-xs);
  min-width: 14px;
}
.row {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--s2);
}
.lnk {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: var(--t-sm);
  cursor: pointer;
}
.bots {
  margin-top: var(--s2);
}
.bots summary {
  cursor: pointer;
  color: var(--fg-2);
  font-size: var(--t-sm);
}
</style>
