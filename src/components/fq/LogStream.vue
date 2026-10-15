<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { Btn, DsIcon, EmptyState, SearchField, SegmentedControl, Skeleton } from '@/components/ds';
import type { SegmentOption } from '@/components/ds';
import { useDataSource } from '@/composables/useDataSource';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import { createFrameBatcher } from '@/datasource/stores/apply';
import type { ChannelUpdate, DataSource } from '@/datasource/types';
import type { BotKey, LogLine } from '@/gateway/types.gen';

import {
  filterEntries,
  mergeEntries,
  toEntries,
  withTimeout,
  type LogEntry,
  type LogLevel,
} from './lib/logs';
import { formatClockSeconds, formatDateTime } from './lib/time';

/**
 * One log component, two layouts (02 section 4.1 C7): `compact` (the drawer of the status bar and
 * the Bot tab: the last lines, no controls) and `page` (Tools > Logs: level, search, bot, "older").
 * Filters are sent to the source, the stream is merged by line identity, and every request has a
 * real deadline (bug B13: the old store built a timeout it never connected to the request, and
 * keyed lines on the first 40 characters). Without a bot the stream is the errors of all bots.
 */
const props = withDefaults(
  defineProps<{
    mode?: 'compact' | 'page';
    /** Logs of this bot; none: the errors of the whole fleet, merged. */
    bot?: BotKey | null;
    level?: LogLevel;
    /** Lines shown in compact mode. */
    limit?: number;
    /** A source to use instead of the active one (previews, tests). */
    source?: DataSource | null;
    /** Deadline of a request, ms. */
    timeoutMs?: number;
  }>(),
  { mode: 'compact', bot: null, level: 'ERROR', limit: 8, timeoutMs: 8_000 },
);

const emit = defineEmits<{ 'update:bot': [botKey: BotKey | null]; openBot: [botKey: BotKey] }>();

const { t, locale } = useI18n();
const data = useDataSource();
const fleet = useFqFleetStore();
const conn = useFqConnectionStore();
const prefs = useFqPrefsStore();

const activeSource = computed<DataSource | null>(() => props.source ?? data.source.value);
const entries = shallowRef<LogEntry[]>([]);
const pending = shallowRef<LogEntry[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const unavailable = ref<string | null>(null);
const nextCursor = ref<string | null>(null);
const paused = ref(false);
const query = ref('');
const levelFilter = ref<LogLevel>(props.level);
const botFilter = ref<BotKey | null>(props.bot);
const expanded = ref<Set<string>>(new Set());
let token = 0;
let unsubscribe: (() => void) | null = null;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const isPage = computed(() => props.mode === 'page');
const botKey = computed<BotKey | null>(() => (isPage.value ? botFilter.value : props.bot));
/** Without a bot only the errors exist (one merged channel): the level cannot go lower. */
const levelFloor = computed<LogLevel>(() => (botKey.value === null ? 'ERROR' : levelFilter.value));

const levelOptions = computed<SegmentOption<LogLevel>[]>(() =>
  (['ERROR', 'WARNING', 'INFO', 'DEBUG'] as LogLevel[]).map((l) => ({
    value: l,
    label: t(`fq.logs.level.${l}`),
    disabled: botKey.value === null && l !== 'ERROR',
  })),
);

const visible = computed(() => {
  const filtered = filterEntries(entries.value, {
    level: levelFloor.value,
    query: query.value,
    botKey: null,
  });
  return isPage.value ? filtered.slice(0, 300) : filtered.slice(0, props.limit);
});

function take(lines: readonly LogLine[], key: BotKey | null): LogEntry[] {
  return toEntries(key, lines);
}

const batcher = createFrameBatcher<LogEntry>((batch) => {
  if (paused.value) {
    pending.value = mergeEntries(pending.value, batch);
  } else {
    entries.value = mergeEntries(entries.value, batch);
  }
});

function onUpdate(key: BotKey | null, u: ChannelUpdate['logs']) {
  if (u.kind === 'unavailable') {
    unavailable.value = u.reason;
    return;
  }
  unavailable.value = null;
  if (u.kind === 'reset') return;
  // The channel carries one line at a time: identity comes from the text, not from the position
  take([u.item], key).forEach((e) => batcher.push(e));
}

async function load(more = false): Promise<void> {
  const source = activeSource.value;
  const mine = ++token;
  if (!source) return;
  loading.value = true;
  try {
    const page = await withTimeout(
      source.query.logs({
        botKey: botKey.value ?? undefined,
        q: query.value.trim() || undefined,
        cursor: more ? nextCursor.value : null,
        limit: isPage.value ? 200 : props.limit * 4,
      }),
      props.timeoutMs,
    );
    if (mine !== token) return;
    const fresh = take(page.items, botKey.value);
    entries.value = mergeEntries(more ? entries.value : [], fresh);
    nextCursor.value = page.nextCursor;
    error.value = null;
  } catch (e) {
    if (mine !== token) return;
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (mine === token) loading.value = false;
  }
}

function subscribe() {
  unsubscribe?.();
  unsubscribe = null;
  const source = activeSource.value;
  if (!source) return;
  const key = botKey.value;
  unsubscribe = source.subscribe('logs', { botKey: key }, (u) => onUpdate(key, u));
}

function restart() {
  entries.value = [];
  pending.value = [];
  nextCursor.value = null;
  expanded.value = new Set();
  void load();
  subscribe();
}

watch(() => [activeSource.value, botKey.value], restart, { immediate: true });
// The level is a floor applied here (a source may read `level` as an exact match and drop
// CRITICAL lines); the text search goes to the source, debounced for the typing
watch(query, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void load(), 300);
});
watch(
  () => props.bot,
  (b) => {
    botFilter.value = b;
  },
);
watch(
  () => props.level,
  (l) => {
    levelFilter.value = l;
  },
);

function resume() {
  paused.value = false;
  entries.value = mergeEntries(entries.value, pending.value);
  pending.value = [];
}

onBeforeUnmount(() => {
  token += 1;
  clearTimeout(searchTimer);
  unsubscribe?.();
  unsubscribe = null;
});

const nameOf = (k: BotKey | null) => (k ? (fleet.bots[k]?.identity.name ?? k) : null);
const botOptions = computed(() => [
  { key: '', name: t('fq.logs.allBots') },
  ...fleet.list
    .filter((b) => b.identity.mode !== 'replay')
    .map((b) => ({ key: b.bot_key, name: b.identity.name }))
    .sort((a, b) => a.name.localeCompare(b.name)),
]);

function onBot(ev: Event) {
  const v = (ev.target as HTMLSelectElement).value;
  const next = v === '' ? null : v;
  botFilter.value = next;
  emit('update:bot', next);
}

function stamp(ms: number): string {
  const tz = prefs.settings.tz;
  return isPage.value
    ? `${formatDateTime(ms, tz, locale.value).slice(0, 5)} ${formatClockSeconds(ms, tz)}`
    : formatClockSeconds(ms, tz);
}

function toggle(id: string) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

const empty = computed(() => !loading.value && visible.value.length === 0);
</script>

<template>
  <div class="ls" :class="mode" data-testid="log-stream" :data-mode="mode">
    <div v-if="isPage" class="bar">
      <SegmentedControl
        :model-value="levelFilter"
        :options="levelOptions"
        size="sm"
        :label="t('fq.logs.levelLabel')"
        @update:model-value="(v) => (levelFilter = v)"
      />
      <select
        v-if="!bot"
        class="sel"
        :value="botFilter ?? ''"
        :aria-label="t('fq.logs.botLabel')"
        @change="onBot"
      >
        <option v-for="o in botOptions" :key="o.key" :value="o.key">{{ o.name }}</option>
      </select>
      <SearchField v-model="query" :placeholder="t('fq.logs.search')" class="srch" />
      <Btn
        size="sm"
        variant="ghost"
        :icon="paused ? 'play' : 'pause'"
        :aria-pressed="paused"
        @click="paused ? resume() : (paused = true)"
      >
        {{ paused ? t('fq.logs.resume', { n: pending.length }) : t('fq.logs.pause') }}
      </Btn>
    </div>

    <p v-if="botKey === null" class="note" data-testid="log-errors-only">
      {{ t('fq.logs.errorsOnly') }}
    </p>
    <p v-if="conn.kind === 'direct'" class="note">{{ t('fq.logs.directNote') }}</p>
    <p v-if="unavailable" class="note warn">{{ t('fq.connection.unavailableDirect') }}</p>
    <p v-if="error" class="note warn" role="alert" data-testid="log-error">
      {{ t('fq.logs.error') }} · {{ error }}
      <button type="button" class="link" @click="load()">{{ t('fq.result.retry') }}</button>
    </p>

    <Skeleton v-if="loading && entries.length === 0" shape="line" :count="isPage ? 8 : 4" />
    <ul v-else-if="visible.length > 0" class="lines" :aria-label="t('fq.logs.title')">
      <li v-for="e in visible" :key="e.id" class="ln" :class="e.level.toLowerCase()">
        <time class="ts num">{{ stamp(e.ts_ms) }}</time>
        <span class="lv" :title="e.level">{{ t(`fq.logs.short.${e.level}`) }}</span>
        <button
          v-if="e.botKey && !bot"
          type="button"
          class="bn"
          :title="nameOf(e.botKey) ?? ''"
          @click="emit('openBot', e.botKey)"
        >
          {{ nameOf(e.botKey) }}
        </button>
        <span class="msg">
          {{ e.message }}
          <button
            v-if="e.detail"
            type="button"
            class="more"
            :aria-expanded="expanded.has(e.id)"
            @click="toggle(e.id)"
          >
            <DsIcon :name="expanded.has(e.id) ? 'chevron-up' : 'chevron-down'" :size="13" />
            {{ t('fq.logs.trace') }}
          </button>
          <pre v-if="e.detail && expanded.has(e.id)" class="trace">{{ e.detail }}</pre>
        </span>
      </li>
    </ul>
    <EmptyState
      v-else-if="empty"
      icon="terminal"
      :title="t('fq.logs.empty')"
      :hint="botKey === null ? t('fq.logs.emptyErrors') : t('fq.logs.emptyHint')"
    />

    <div v-if="isPage && nextCursor" class="older">
      <Btn size="sm" :busy="loading" @click="load(true)">{{ t('fq.logs.older') }}</Btn>
    </div>
    <span class="sr" aria-live="polite">{{
      pending.length > 0 ? t('fq.logs.pending', { n: pending.length }) : ''
    }}</span>
  </div>
</template>

<style scoped>
.ls {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  font-size: var(--t-sm);
}
.bar {
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: 6px var(--s3);
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}
.sel {
  height: var(--ctl);
  background: var(--bg-2);
  color: var(--fg);
  border: 1px solid var(--line-2);
  border-radius: var(--r-2);
  font: inherit;
  padding: 0 6px;
  max-width: 200px;
}
.srch {
  flex: 1;
  min-width: 140px;
}
.note {
  margin: 0;
  padding: 5px var(--s3);
  font-size: var(--t-xs);
  color: var(--fg-3);
  border-bottom: 1px solid var(--line);
}
.note.warn {
  color: var(--warn);
}
.link {
  background: none;
  border: 0;
  padding: 0;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}
.lines {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
  min-height: 0;
}
.ln {
  display: grid;
  grid-template-columns: auto auto auto minmax(0, 1fr);
  align-items: baseline;
  gap: 0 var(--s2);
  padding: 4px var(--s3);
  border-bottom: 1px solid var(--line);
}
.compact .ln {
  padding: 3px var(--s3);
}
.ts {
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.num {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
}
.lv {
  font-family: var(--font-num);
  font-size: var(--t-xs);
  font-weight: 600;
  min-width: 2.2em;
}
.ln.error .lv,
.ln.error .msg {
  color: var(--loss);
}
.ln.critical .lv,
.ln.critical .msg {
  color: var(--crit);
}
.ln.warning .lv {
  color: var(--warn);
}
.ln.info .lv {
  color: var(--fg-2);
}
.ln.debug {
  color: var(--fg-3);
}
.bn {
  background: none;
  border: 0;
  padding: 0;
  max-width: 14ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-2);
  font: inherit;
  font-size: var(--t-xs);
  cursor: pointer;
}
.ln:not(:has(.bn)) .msg {
  grid-column: 3 / -1;
}
.msg {
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-num);
  font-size: var(--t-xs);
}
.more {
  background: none;
  border: 0;
  padding: 0 0 0 6px;
  color: var(--accent);
  font: inherit;
  font-size: var(--t-xs);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.trace {
  margin: 4px 0 0;
  padding: 6px 8px;
  background: var(--bg-2);
  border-radius: var(--r-1);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--fg-2);
  max-height: 220px;
  overflow: auto;
}
.older {
  padding: var(--s2) var(--s3);
  display: flex;
  justify-content: center;
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
