<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import { Badge, Btn, EmptyState, StatusDot } from '@/components/ds';
import ToolFrame from '@/components/fq/ToolFrame.vue';
import DryReplayModal from '@/components/ftbot/DryReplayModal.vue';
import { useDataSource } from '@/composables/useDataSource';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import type { BotKey } from '@/gateway/types.gen';

/**
 * Tools > Dry replay (02 sections 2.2 and 11): replays the live loop on history into the database
 * of ONE dry bot. The form is the legacy modal, kept; what is new here is the way in (the dry
 * bots of the fleet, with the state of their replay) and that wiping the database first needs the
 * bot name typed back. It runs on the legacy stores, so this route starts them.
 */
const { t } = useI18n();
const route = useRoute();
const data = useDataSource();
const fleet = useFqFleetStore();
const replay = useReplayStore();
const botStore = useBotStore();

const dry = computed(() =>
  fleet.list
    .filter((b) => b.identity.mode === 'dry')
    .slice()
    .sort((a, b) => a.identity.name.localeCompare(b.identity.name, undefined, { numeric: true })),
);

function uiIdOf(key: BotKey): string | null {
  const id = data.source.value?.registry.uiIdOf(key) ?? null;
  return id && id in botStore.botStores ? id : null;
}
function statusOf(key: BotKey) {
  const id = uiIdOf(key);
  return id ? (replay.statusByBot[id] ?? null) : null;
}
function seeded(key: BotKey): boolean {
  const id = uiIdOf(key);
  return id ? replay.seededByBot[id] === true : false;
}
function open(key: BotKey) {
  const id = uiIdOf(key);
  if (id) void replay.open(id);
}

onMounted(() => {
  const wanted = typeof route.query.bot === 'string' ? (route.query.bot as BotKey) : null;
  if (wanted && dry.value.some((b) => b.bot_key === wanted)) open(wanted);
});
</script>

<template>
  <ToolFrame :title="t('fq.tools.replay')" :subtitle="t('fq.pg.tools.replay.sub')" :tags="['python', 'perBot']">
    <div v-if="dry.length > 0" class="wrap">
      <table data-testid="replay-bots">
        <thead>
          <tr>
            <th class="l">{{ t('fq.pg.tools.bot') }}</th>
            <th class="l">{{ t('fq.pg.tools.replay.state') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in dry" :key="b.bot_key">
            <td class="l">
              <StatusDot :state="b.state.status" /> {{ b.identity.name }}
              <Badge kind="dry" />
            </td>
            <td class="l mut">
              <template v-if="statusOf(b.bot_key)?.running">
                {{ t('fq.pg.tools.replay.running', { p: Math.round((statusOf(b.bot_key)?.progress ?? 0) * 100) }) }}
              </template>
              <template v-else-if="seeded(b.bot_key)">{{ t('fq.pg.tools.replay.seeded') }}</template>
              <template v-else>{{ t('fq.pg.tools.replay.idle') }}</template>
            </td>
            <td>
              <Btn size="xs" :disabled="!uiIdOf(b.bot_key)" :data-bot="b.bot_key" @click="open(b.bot_key)">{{
                t('fq.pg.tools.replay.open')
              }}</Btn>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <EmptyState
      v-else
      icon="rewind"
      :title="t('fq.pg.tools.replay.none')"
      :hint="t('fq.pg.tools.replay.noneHint')"
    />
    <DryReplayModal />
  </ToolFrame>
</template>

<style scoped>
.wrap {
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  background: var(--bg-1);
  overflow: auto;
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
}
td {
  height: 34px;
  padding: 0 8px;
  text-align: right;
  border-top: 1px solid var(--line);
}
.l {
  text-align: left;
}
.mut {
  color: var(--fg-3);
}
</style>
