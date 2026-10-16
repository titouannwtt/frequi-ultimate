<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  Badge,
  Btn,
  DsIcon,
  EmptyState,
  IconBtn,
  ModeMark,
  StatusDot,
  ValueState,
} from '@/components/ds';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { DiscoveredBot, RegistryBot } from '@/datasource/types';
import type { BotKey } from '@/gateway/types.gen';
import type { MigrationRecord } from '@/migration/schema';

import { isHip3Market } from '@/datasource/calc/hip3';
import { migrationView, registryRows, sortRegistry } from './lib/registry';
import { formatDateTime } from './lib/time';

/**
 * The bot registry of the Settings page (02 section 3.6, 1): the migration banner, the bots found
 * on the server that are not registered yet (added in one click), and one table of the registered
 * bots with their state, alias and key, group, market and a "Reconnect" on an expired session. It
 * only asks: adding, editing, reconnecting, importing and exporting are events for the page, and the
 * old `ftbot.N` ids stay aliases of this device.
 */
const props = defineProps<{
  bots: RegistryBot[];
  discovered: DiscoveredBot[];
  migration: MigrationRecord | null;
  nowMs?: number;
}>();

const emit = defineEmits<{
  add: [bots: DiscoveredBot[]];
  addManual: [];
  edit: [botKey: BotKey];
  reconnect: [botKey: BotKey];
  importFile: [];
  exportFile: [];
}>();

const { t, locale } = useI18n();
const fleet = useFqFleetStore();
const prefs = useFqPrefsStore();
const conn = useFqConnectionStore();
const clock = useNowMs();
const now = computed(() => props.nowMs ?? clock.value);

// The "since" line starts with a real space: without it the text reads "en lignedepuis le 17/08"
const rows = computed(() =>
  sortRegistry(
    registryRows(
      props.bots,
      fleet.bots,
      prefs.settings.fleet.groups,
      now.value,
      conn.status.clockSkewMs,
    ),
  ),
);
const mig = computed(() => migrationView(props.migration, props.bots));
const registered = computed(() => new Set(props.bots.map((b) => b.botKey)));
// A discovered bot that got registered meanwhile is not offered again
const toAdd = computed(() => props.discovered.filter((d) => !registered.value.has(d.botKey)));

const STATE_KEYS = {
  online: 'fq.registry.online',
  starting: 'fq.status.starting',
  offline: 'fq.status.offline',
  stopped: 'fq.status.stopped',
  auth_expired: 'fq.status.sessionExpired',
  stale: 'fq.status.stale',
} as const;
function stateText(r: (typeof rows.value)[number]): string {
  return r.state === null ? '' : t(STATE_KEYS[r.state]);
}
const dateOf = (ms: number) => formatDateTime(ms, prefs.settings.tz, locale.value);
</script>

<template>
  <div class="reg" data-testid="bot-registry">
    <div v-if="mig" class="ban ok" data-testid="registry-migration">
      <DsIcon name="circle-check" :size="15" />
      <span class="grow">
        <b>{{ t('fq.registry.migrated', { d: dateOf(mig.atMs) }) }}</b>
        {{ t('fq.registry.migratedBody', { n: mig.imported }) }}
        <template v-if="mig.unmapped.length > 0">
          <br /><span class="warn">{{
            t('fq.registry.unmapped', { n: mig.unmapped.length })
          }}</span>
        </template>
        <template v-if="mig.forcedConfirmation">
          <br />{{ t('fq.registry.forcedConfirmation') }}
        </template>
      </span>
    </div>
    <div v-else class="ban" data-testid="registry-no-migration">
      <DsIcon name="info" :size="15" />
      <span class="grow">{{ t('fq.registry.noMigration') }}</span>
    </div>

    <div v-if="toAdd.length > 0" class="ban info" data-testid="registry-discovered">
      <DsIcon name="plug-zap" :size="15" />
      <span class="grow">
        <b>{{ t('fq.registry.discovered', { n: toAdd.length }, toAdd.length) }}</b>
        <span class="ports">
          <span v-for="d in toAdd" :key="d.botKey" class="chip">
            {{ d.name }}<template v-if="d.port !== null"> · {{ d.port }}</template>
            <ModeMark :mode="d.mode" />
            <button type="button" class="one" @click="emit('add', [d])">
              {{ t('fq.registry.add') }}
            </button>
          </span>
        </span>
      </span>
      <Btn v-if="toAdd.length > 1" size="sm" @click="emit('add', toAdd)">{{
        t('fq.registry.addAll')
      }}</Btn>
    </div>

    <div v-if="rows.length > 0" class="wrap">
      <table>
        <thead>
          <tr>
            <th class="l">{{ t('fq.col.bot') }}</th>
            <th class="l c-key">{{ t('fq.registry.aliasKey') }}</th>
            <th class="l c-grp">{{ t('fq.registry.group') }}</th>
            <th class="l">{{ t('fq.col.state') }}</th>
            <th class="l c-tags">{{ t('fq.registry.market') }}</th>
            <th>
              <span class="sr">{{ t('fq.col.actions') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in rows"
            :key="r.botKey"
            :class="r.mode ? `m-${r.mode}` : ''"
            :data-key="r.botKey"
          >
            <td class="l">
              <span class="bot">
                <StatusDot v-if="r.state" :state="r.state" />
                <span class="nm" :title="r.name">{{ r.name }}</span>
                <ModeMark v-if="r.mode" :mode="r.mode" full />
              </span>
            </td>
            <td class="l num mut c-key">{{ r.alias ? `${r.alias} · ` : '' }}{{ r.botKey }}</td>
            <td class="l c-grp">{{ r.group ?? t('fq.fleet.ungrouped') }}</td>
            <td class="l c-state">
              <ValueState
                v-if="r.state === null"
                state="pending"
                :pending-key="`registry/${r.botKey}/state`"
              />
              <template v-else>{{ stateText(r) }}</template>
              <span v-if="r.sinceMs !== null && r.mode === 'dry'" class="mut since">{{
                ` ${t('fq.origin.since', { date: dateOf(r.sinceMs).slice(0, 5) })}`
              }}</span>
            </td>
            <td class="l c-tags">
              <Badge
                v-if="r.market && isHip3Market(r.market)"
                kind="xyz"
                :label="t('fq.registry.hip3')"
              />
              <Badge v-else kind="neutral" :label="t('fq.registry.crypto')" />
            </td>
            <td class="act">
              <Btn
                v-if="r.needsLogin"
                size="xs"
                class="relog"
                @click="emit('reconnect', r.botKey)"
                >{{ t('fq.status.reconnect') }}</Btn
              >
              <IconBtn
                v-else
                icon="settings"
                size="sm"
                :label="t('fq.registry.edit', { name: r.name })"
                @click="emit('edit', r.botKey)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <EmptyState
      v-else
      icon="bot"
      :title="t('fq.registry.empty')"
      :hint="t('fq.registry.emptyHint')"
    />

    <div class="tools">
      <Btn size="sm" icon="plus" @click="emit('addManual')">{{ t('fq.registry.addBot') }}</Btn>
      <Btn size="sm" @click="emit('importFile')">{{ t('fq.registry.import') }}</Btn>
      <Btn size="sm" @click="emit('exportFile')">{{ t('fq.registry.export') }}</Btn>
    </div>
  </div>
</template>

<style scoped>
.reg {
  display: grid;
  gap: var(--s2);
  min-width: 0;
  container-type: inline-size;
}
.ban {
  display: flex;
  align-items: flex-start;
  gap: var(--s2);
  padding: 8px var(--s3);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  background: var(--bg-1);
  font-size: var(--t-sm);
}
.ban.ok > svg {
  color: var(--profit);
}
.ban.info > svg {
  color: var(--info);
}
.grow {
  flex: 1;
  min-width: 0;
}
.warn {
  color: var(--warn);
}
.ports {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-1);
  font-size: var(--t-xs);
}
.one {
  background: none;
  border: 0;
  padding: 0;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}
@media (max-width: 599px), (pointer: coarse) {
  .one {
    min-height: 44px;
    min-width: 44px;
    padding: 0 6px;
  }
}
.wrap {
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  background: var(--bg-1);
  overflow: auto;
  /* The hidden `.sr` label is absolute: without a positioned ancestor it escapes the scroll box
     and widens the whole page (scrollWidth 536 at 390 px) */
  position: relative;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--t-sm);
}
th {
  height: 30px;
  padding: 0 8px;
  color: var(--fg-3);
  font-weight: 500;
  font-size: var(--t-xs);
  text-align: right;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
td {
  height: var(--row);
  padding: 0 8px;
  border-bottom: 1px solid var(--line);
  text-align: right;
}
th.l,
td.l {
  text-align: left;
}
tr:last-child td {
  border-bottom: 0;
}
tr.m-live td:first-child {
  box-shadow: inset 2px 0 0 var(--live);
}
tr.m-dry td:first-child {
  box-shadow: inset 2px 0 0 color-mix(in srgb, var(--dry) 50%, transparent);
}
.bot {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
}
.nm {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 24ch;
  font-weight: 500;
}
.num {
  font-family: var(--font-num);
  font-size: var(--t-xs);
}
.mut {
  color: var(--fg-3);
}
.act {
  white-space: nowrap;
}
.relog {
  border-color: var(--warn);
}
.tools {
  display: flex;
  gap: var(--s2);
  flex-wrap: wrap;
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
/* The state never wraps word by word ("en" / "ligne" on two lines) */
.c-state {
  white-space: nowrap;
}
@container (max-width: 640px) {
  .c-key,
  .c-tags,
  .c-grp {
    display: none;
  }
}
/* A phone: a row is two lines (name, then state) and the edit button on its right, so nothing
   needs a sideways scroll and the button is always reachable */
@container (max-width: 420px) {
  table,
  tbody {
    display: block;
  }
  thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    padding: 6px 0;
    border-bottom: 1px solid var(--line);
  }
  tr:last-child {
    border-bottom: 0;
  }
  td {
    display: block;
    height: auto;
    border-bottom: 0;
    padding: 0 8px;
  }
  tr.m-live,
  tr.m-dry {
    box-shadow: none;
  }
  tr.m-live td:first-child,
  tr.m-dry td:first-child {
    box-shadow: none;
  }
  tr.m-live {
    box-shadow: inset 2px 0 0 var(--live);
  }
  tr.m-dry {
    box-shadow: inset 2px 0 0 color-mix(in srgb, var(--dry) 50%, transparent);
  }
  td:first-child {
    grid-column: 1;
    grid-row: 1;
  }
  td.c-state {
    grid-column: 1;
    grid-row: 2;
    color: var(--fg-2);
    font-size: var(--t-xs);
  }
  td.c-state .mut {
    margin-left: 6px;
  }
  td.act {
    grid-column: 2;
    grid-row: 1 / span 2;
  }
  .nm {
    max-width: 18ch;
  }
}
</style>
