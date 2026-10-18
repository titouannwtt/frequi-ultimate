<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { Btn, FilterChip, ModeMark, PnlValue, Popover, SearchField } from '@/components/ds';
import { matchesQuery, useScope } from '@/composables/useScope';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { BotKey } from '@/gateway/types.gen';

import { isExactly, selectionLabel } from './lib/botSelection';

/**
 * The "Bots N/M" button of the Fleet and the list it opens: one line per bot to tick or untick
 * (name, mode, what its open positions gain or lose now), a search, "All" / "None" and the groups
 * as a quick way to keep one group. What is ticked counts in every figure of the page (the four
 * figures, the profit curve, the table of bots, the positions to watch, the risk); live and dry
 * keep their own figures. The button shows how many are ticked and stands out as soon as one is
 * not, so a narrowed page never looks like the whole fleet.
 */
const { t } = useI18n();
const scope = useScope();
const prefs = useFqPrefsStore();

const anchor = ref<HTMLElement | null>(null);
const open = ref(false);
const query = ref('');

function toggleOpen(e: MouseEvent) {
  anchor.value = e.currentTarget as HTMLElement;
  open.value = !open.value;
  if (!open.value) query.value = '';
}
function close() {
  open.value = false;
  query.value = '';
}

const total = computed(() => scope.pickable.value.length);
const ticked = computed(() => new Set<BotKey>(scope.selectedKeys.value));
const label = computed(() => selectionLabel(ticked.value.size, total.value));

const rows = computed(() =>
  scope.pickable.value
    .filter((b) => matchesQuery(b, query.value))
    .map((b) => ({
      key: b.bot_key,
      name: b.identity.name,
      mode: b.identity.mode,
      latent: b.metrics.open_profit_abs ?? null,
      on: ticked.value.has(b.bot_key),
    }))
    .sort((a, b) => a.name.localeCompare(b.name)),
);

const groups = computed(() =>
  prefs.settings.fleet.groups
    .map((g) => {
      const members = g.botKeys.filter((k) => scope.pickable.value.some((b) => b.bot_key === k));
      return {
        id: g.id,
        name: g.name,
        members,
        active: isExactly(
          scope.selectedKeys.value,
          g.botKeys,
          scope.pickable.value.map((b) => b.bot_key),
        ),
      };
    })
    .filter((g) => g.members.length > 0),
);

/** A group chip keeps that group alone; pressed again it ticks everything. */
function onGroup(g: { members: BotKey[]; active: boolean }) {
  if (g.active) scope.selectAll();
  else scope.setSelected(g.members);
}

const narrowed = computed(() => scope.narrowed.value);
</script>

<template>
  <div class="bs">
    <Btn
      class="bsbtn"
      :variant="narrowed ? 'secondary' : 'ghost'"
      size="sm"
      icon="bot"
      :aria-expanded="open"
      :title="t('fq.pg.fleet.pick.hint')"
      data-testid="fleet-bots-toggle"
      @click="toggleOpen"
    >
      {{ t('fq.pg.fleet.pick.button') }}
      <span class="n num" :class="{ on: narrowed }" data-testid="fleet-bots-count">{{
        label
      }}</span>
    </Btn>

    <Popover
      :open="open"
      :anchor="anchor"
      :label="t('fq.pg.fleet.pick.title')"
      placement="bottom-start"
      @close="close"
    >
      <div class="list" data-testid="fleet-bots-list">
        <p class="hint">{{ t('fq.pg.fleet.pick.hint') }}</p>
        <SearchField
          class="q"
          :model-value="query"
          :placeholder="t('fq.pg.fleet.pick.search')"
          @update:model-value="query = $event"
        />
        <div class="quick">
          <Btn size="xs" variant="ghost" data-testid="fleet-bots-all" @click="scope.selectAll()">{{
            t('fq.pg.fleet.pick.all')
          }}</Btn>
          <Btn
            size="xs"
            variant="ghost"
            data-testid="fleet-bots-none"
            @click="scope.selectNone()"
            >{{ t('fq.pg.fleet.pick.none') }}</Btn
          >
          <span class="count" role="status">{{
            t('fq.pg.fleet.pick.active', { n: ticked.size, total }, ticked.size)
          }}</span>
        </div>
        <div v-if="groups.length > 0" class="groups" :aria-label="t('fq.pg.fleet.pick.groups')">
          <FilterChip
            v-for="g in groups"
            :key="g.id"
            :label="g.name"
            :count="g.members.length"
            :active="g.active"
            :title="t('fq.pg.fleet.pick.only')"
            @toggle="onGroup(g)"
          />
        </div>
        <ul class="rows" role="group" :aria-label="t('fq.pg.fleet.pick.title')">
          <li v-for="r in rows" :key="r.key">
            <label class="row" :data-testid="`fleet-bot-row-${r.key}`">
              <input
                type="checkbox"
                :checked="r.on"
                :aria-label="t('fq.pg.fleet.pick.row', { name: r.name })"
                @change="scope.toggleBot(r.key, ($event.target as HTMLInputElement).checked)"
              />
              <span class="name">{{ r.name }}</span>
              <ModeMark :mode="r.mode" />
              <span class="pnl" :title="t('fq.pg.fleet.pick.latent')">
                <PnlValue :value="r.latent" :decimals="2" :unknown="r.latent === null" />
              </span>
            </label>
          </li>
        </ul>
        <p v-if="total === 0" class="empty">{{ t('fq.pg.fleet.pick.empty') }}</p>
        <p v-else-if="rows.length === 0" class="empty">{{ t('fq.pg.fleet.pick.noMatch') }}</p>
      </div>
    </Popover>
  </div>
</template>

<style scoped>
.bs {
  display: inline-flex;
  flex: none;
}
.n {
  color: var(--fg-3);
  margin-left: 4px;
}
.n.on {
  color: var(--warn);
  font-weight: 600;
}
.list {
  display: grid;
  gap: var(--s2);
  width: min(320px, calc(100vw - 24px));
  padding: 0 var(--s2);
  box-sizing: border-box;
}
.hint {
  margin: 0;
  padding: 0 var(--s1);
  font-size: var(--t-xs);
  color: var(--fg-3);
}
.q {
  width: 100%;
}
.quick {
  display: flex;
  align-items: center;
  gap: var(--s1);
}
.count {
  margin-left: auto;
  font-size: var(--t-xs);
  color: var(--fg-3);
}
.groups {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gut);
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: min(360px, 50vh);
  overflow-y: auto;
}
.row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--s2);
  min-height: 32px;
  padding: 2px var(--s1);
  border-radius: var(--r-1);
  cursor: pointer;
}
.row:hover {
  background: var(--bg-2);
}
.row input {
  accent-color: var(--accent);
  width: 16px;
  height: 16px;
  margin: 0;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pnl {
  min-width: 64px;
  text-align: right;
  font-size: var(--t-sm);
}
.empty {
  margin: 0;
  padding: var(--s2);
  text-align: center;
  color: var(--fg-3);
}
@media (max-width: 599px), (pointer: coarse) {
  .bsbtn {
    min-height: 44px;
  }
  .row {
    min-height: 44px;
  }
  .row input {
    width: 20px;
    height: 20px;
  }
}
</style>
