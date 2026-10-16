<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { Btn, EmptyState, Skeleton } from '@/components/ds';
import { requestAction, toastRefusal, useActionDialog } from '@/composables/useActionDialog';
import { useSourceQuery } from '@/composables/useSourceQuery';
import type { DataSource } from '@/datasource/types';
import type { BotKey } from '@/gateway/types.gen';

import { withTimeout } from './lib/logs';

/**
 * Pairlist of one bot (02 section 3.2, tab "Pairs and locks"): the pairlist methods and the
 * pipeline (how many pairs each handler leaves), the whitelist, and the blacklist, which is
 * editable. Reads go through the data source; adding or removing a pair never writes by itself, it
 * asks the one confirmation dialog for THIS bot (live level on a live bot) and reads the list
 * again when that dialog closes.
 */
const props = withDefaults(
  defineProps<{
    botKey: BotKey;
    /** A source to use instead of the active one (previews, tests). */
    source?: DataSource | null;
    timeoutMs?: number;
    /** Whitelist pairs shown before "show all". */
    previewLimit?: number;
  }>(),
  { source: null, timeoutMs: 10_000, previewLimit: 40 },
);

interface PipelineStep {
  handler: string;
  count_after?: number;
}
interface WhitelistAnswer {
  method?: string[];
  whitelist?: string[];
  pipeline?: PipelineStep[];
  total_market_pairs?: number;
}
interface BlacklistAnswer {
  blacklist?: string[];
}

const { t } = useI18n();
const dialog = useActionDialog();

function read<T>(path: string) {
  return (source: DataSource) =>
    withTimeout(
      source.proxy<T>(props.botKey, 'GET', path, undefined, { timeoutMs: props.timeoutMs }),
      props.timeoutMs,
    );
}
const white = useSourceQuery<WhitelistAnswer>(
  read<WhitelistAnswer>('/whitelist'),
  () => `${props.botKey}|whitelist`,
  { refreshMs: 60_000, source: () => props.source },
);
const black = useSourceQuery<BlacklistAnswer>(
  read<BlacklistAnswer>('/blacklist'),
  () => `${props.botKey}|blacklist`,
  { refreshMs: 60_000, source: () => props.source },
);

const methods = computed(() => white.data.value?.method ?? []);
const pipeline = computed(() => white.data.value?.pipeline ?? []);
const whitelist = computed(() => white.data.value?.whitelist ?? []);
const blacklist = computed(() => black.data.value?.blacklist ?? []);
const showAll = ref(false);
const shownWhitelist = computed(() =>
  showAll.value ? whitelist.value : whitelist.value.slice(0, props.previewLimit),
);
const loading = computed(
  () =>
    (white.loading.value && white.data.value === null) ||
    (black.loading.value && black.data.value === null),
);

const draft = ref('');
const pairs = computed(() =>
  draft.value
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => p !== ''),
);

function add() {
  if (pairs.value.length === 0) return;
  toastRefusal(requestAction(props.botKey, { kind: 'blacklist_add', pairs: pairs.value }));
}
function remove(pair: string) {
  toastRefusal(requestAction(props.botKey, { kind: 'blacklist_remove', pairs: [pair] }));
}

// The dialog closes once the answer is known: read the lists again, whatever the outcome
watch(
  () => dialog.current.value,
  (now, before) => {
    if (now !== null || !before || before.botKey !== props.botKey) return;
    if (before.action.kind === 'blacklist_add' || before.action.kind === 'blacklist_remove') {
      draft.value = '';
      void black.reload();
      void white.reload();
    }
  },
);
</script>

<template>
  <section class="pl" data-testid="pairlist-panel">
    <Skeleton v-if="loading" shape="row" :count="3" />
    <template v-else>
      <p v-if="white.error.value && !white.data.value" class="note warn" data-testid="pl-error">
        {{ t('fq.pairlist.error') }}
      </p>

      <h4>{{ t('fq.pairlist.methods') }}</h4>
      <ul v-if="methods.length" class="chips" data-testid="pl-methods">
        <li v-for="(m, i) in methods" :key="`${i}-${m}`" class="chip">
          {{ m }}
          <span v-if="pipeline[i]?.count_after !== undefined" class="num sub">
            {{ t('fq.pairlist.after', { n: pipeline[i]?.count_after }) }}
          </span>
        </li>
      </ul>
      <p v-else class="note">{{ t('fq.pairlist.noMethods') }}</p>
      <p v-if="white.data.value?.total_market_pairs" class="note">
        {{ t('fq.pairlist.market', { n: white.data.value.total_market_pairs }) }}
      </p>

      <h4>{{ t('fq.pairlist.whitelist', { n: whitelist.length }) }}</h4>
      <ul v-if="whitelist.length" class="chips" data-testid="pl-whitelist">
        <li v-for="p in shownWhitelist" :key="p" class="chip">{{ p }}</li>
      </ul>
      <EmptyState v-else icon="layers" :title="t('fq.pairlist.noWhitelist')" />
      <p v-if="whitelist.length > previewLimit" class="note">
        <button type="button" class="link" @click="showAll = !showAll">
          {{
            showAll
              ? t('fq.pairlist.showLess')
              : t('fq.pairlist.showAll', { n: whitelist.length - previewLimit })
          }}
        </button>
      </p>

      <h4>{{ t('fq.pairlist.blacklist', { n: blacklist.length }) }}</h4>
      <p class="note">{{ t('fq.pairlist.blacklistHint') }}</p>
      <ul v-if="blacklist.length" class="chips" data-testid="pl-blacklist">
        <li v-for="p in blacklist" :key="p" class="chip">
          {{ p }}
          <Btn
            size="xs"
            variant="ghost"
            :aria-label="t('fq.pairlist.remove', { pair: p })"
            data-testid="pl-remove"
            @click="remove(p)"
            >{{ t('fq.pairlist.removeShort') }}</Btn
          >
        </li>
      </ul>
      <p v-else class="note" data-testid="pl-blacklist-empty">{{ t('fq.pairlist.noBlacklist') }}</p>

      <form class="add" @submit.prevent="add">
        <input
          v-model="draft"
          type="text"
          class="in"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('fq.pairlist.addPlaceholder')"
          :aria-label="t('fq.pairlist.addLabel')"
          data-testid="pl-input"
        />
        <Btn
          type="submit"
          size="sm"
          icon="plus"
          :disabled="pairs.length === 0"
          data-testid="pl-add"
          >{{ t('fq.pairlist.add') }}</Btn
        >
      </form>
    </template>
  </section>
</template>

<style scoped>
.pl {
  padding: var(--s3);
  min-width: 0;
}
h4 {
  margin: var(--s3) 0 var(--s1);
  font-size: var(--t-md);
}
h4:first-child {
  margin-top: 0;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: var(--r-1);
  font-size: var(--t-xs);
  max-width: 100%;
  overflow-wrap: anywhere;
}
.sub {
  color: var(--fg-3);
}
.note {
  margin: var(--s1) 0;
  color: var(--fg-3);
  font-size: var(--t-xs);
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
.add {
  display: flex;
  gap: var(--s2);
  margin-top: var(--s2);
}
.in {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 var(--s2);
  background: var(--bg-2);
  color: var(--fg);
  border: 1px solid var(--line);
  border-radius: var(--r-1);
  font: inherit;
  font-size: var(--t-sm);
}
@media (max-width: 599px), (pointer: coarse) {
  .in {
    height: 44px;
  }
}
</style>
