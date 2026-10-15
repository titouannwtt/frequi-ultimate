<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { EmptyState } from '@/components/ds';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqEventsStore } from '@/datasource/stores/events';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import type { BotKey, EventKind } from '@/gateway/types.gen';

import EventRow from './EventRow.vue';

/**
 * The event feed, newest first (02 section 13.1): real events of the bots (fills, exits, alerts,
 * restarts) and the actions taken from the UI. In direct mode only the events seen by this tab
 * exist, and it says so.
 */
const props = withDefaults(defineProps<{ kinds?: EventKind[]; bot?: BotKey; limit?: number }>(), {
  limit: 100,
});

const { t } = useI18n();
const events = useFqEventsStore();
const fleet = useFqFleetStore();
const conn = useFqConnectionStore();

const list = computed(() => {
  const kinds = props.kinds ? new Set(props.kinds) : null;
  return events.events
    .filter(
      (e) => (kinds ? kinds.has(e.kind) : true) && (props.bot ? e.bot_key === props.bot : true),
    )
    .slice(0, props.limit);
});
const nameOf = (key: string | null) => (key ? (fleet.bots[key]?.identity.name ?? null) : null);
const modeOf = (key: string | null) => (key ? (fleet.bots[key]?.identity.mode ?? null) : null);
</script>

<template>
  <div class="feed">
    <p v-if="conn.kind === 'direct'" class="note">{{ t('fq.events.directNote') }}</p>
    <p v-if="events.unavailable" class="note">{{ t('fq.connection.unavailableDirect') }}</p>
    <ul v-if="list.length > 0" class="list">
      <EventRow
        v-for="(e, i) in list"
        :key="`${e.ts_ms}-${e.kind}-${e.bot_key}-${e.trade_id}-${i}`"
        :event="e"
        :bot-name="nameOf(e.bot_key)"
        :bot-mode="modeOf(e.bot_key)"
      />
    </ul>
    <EmptyState
      v-else
      icon="activity"
      :title="t('fq.events.empty')"
      :hint="t('fq.events.emptyHint')"
    />
  </div>
</template>

<style scoped>
.list {
  margin: 0;
  padding: 0;
}
.note {
  margin: 0;
  padding: 6px var(--s3);
  color: var(--fg-3);
  font-size: var(--t-xs);
  border-bottom: 1px solid var(--line);
}
</style>
