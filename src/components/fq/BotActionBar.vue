<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core';
import { computed, ref } from 'vue';

import { Btn, DsIcon, IconBtn } from '@/components/ds';
import type { BotKey, Position } from '@/gateway/types.gen';

import BotActionMenu from './BotActionMenu.vue';
import {
  ACTIONS,
  HEADER_DANGER,
  HEADER_VISIBLE,
  type ActionContextKind,
  type ActionId,
} from './lib/actions';
import { useBotActions } from './lib/useBotActions';

/**
 * The actions of a bot on one surface (02 sections 3.1, 3.2, 8 and 11.4). The surfaces differ
 * only in layout and all go through the same `useBotActions` and the same confirmation:
 * - `header`: Pause entries, Reload, Config, a "..." menu (Resume, Forced entry, Replay, then
 *   apart "Stop the bot..."), 18 px of space, then "Exit all..." (the only danger-outline of the
 *   header). On a phone: four 64 px tiles, and the sensitive actions in a folded section;
 * - `sensitive`: only that folded section (phone), for the foot of the page;
 * - `row`: one neutral "Exit..." button (icon only in a narrow panel) and the "..." menu, shown
 *   on hover, focus or selection and always on touch;
 * - `drawer`: the sticky foot, "Exit at market..." (danger-outline) and "Add to position...";
 * - `palette`: every action as a list.
 * An action in flight shows `aria-busy` on every surface (same lock key); a click on a busy
 * button only says "already running".
 */
const props = withDefaults(
  defineProps<{
    botKey: BotKey;
    context: ActionContextKind;
    position?: Position | null;
    /** Share of the position chosen in the drawer foot (0 to 1), carried to the confirmation. */
    fraction?: number;
    /** Narrow panel: the row button shows an icon only. */
    iconOnly?: boolean;
    /**
     * Header on a phone: leave the folded sensitive section out, the page shows it at the foot
     * (`context="sensitive"`), far from the everyday actions.
     */
    splitSensitive?: boolean;
  }>(),
  { position: null, iconOnly: false, splitSensitive: false },
);

const emit = defineEmits<{
  navigate: [id: ActionId];
  locked: [id: ActionId];
  /** Row context: the table owns the single menu and opens it on this anchor. */
  openMenu: [anchor: HTMLElement];
}>();

const acts = useBotActions(
  () => props.botKey,
  () => props.position,
);
const phone = useMediaQuery('(max-width: 599px)');

const menuOpen = ref(false);
const menuAnchor = ref<HTMLElement | null>(null);
function toggleMenu(e: MouseEvent) {
  menuAnchor.value = e.currentTarget as HTMLElement;
  menuOpen.value = !menuOpen.value;
}

function fire(id: ActionId) {
  if (acts.busy(id)) {
    // A second trigger of an action in flight: the lock says so, nothing opens
    emit('locked', id);
    return;
  }
  if (ACTIONS[id].mutation) {
    acts.trigger(id, { fraction: props.fraction });
  } else {
    emit('navigate', id);
  }
}

const label = (id: ActionId) => acts.t(`fq.act.${ACTIONS[id].label}`);
const exitId = computed<ActionId>(() => 'exit');

const paletteIds = computed<ActionId[]>(() =>
  (Object.keys(ACTIONS) as ActionId[]).filter((id) =>
    props.position
      ? true
      : !['exit', 'add', 'cancelOrder', 'reloadTrade', 'deleteTrade'].includes(id),
  ),
);
</script>

<template>
  <!-- Header of the Bot page, desktop -->
  <div
    v-if="context === 'header' && !phone"
    class="bar header"
    role="group"
    :aria-label="acts.t('fq.act.menuLabel')"
  >
    <Btn
      v-for="id in HEADER_VISIBLE"
      :key="id"
      size="sm"
      :icon="ACTIONS[id].icon"
      :disabled="acts.disabled(id)"
      :disabled-reason="acts.reasonText.value"
      :lock-key="acts.lockKey(id)"
      :data-action="id"
      @click="fire(id)"
      @locked="emit('locked', id)"
    >
      {{ label(id) }}
    </Btn>
    <IconBtn icon="ellipsis" :label="acts.t('fq.act.more')" @click="toggleMenu" />
    <span class="gap" aria-hidden="true"></span>
    <Btn
      variant="danger-outline"
      size="sm"
      :icon="ACTIONS[HEADER_DANGER].icon"
      :disabled="acts.disabled(HEADER_DANGER)"
      :disabled-reason="acts.reasonText.value"
      :lock-key="acts.lockKey(HEADER_DANGER)"
      :data-action="HEADER_DANGER"
      @click="fire(HEADER_DANGER)"
      @locked="emit('locked', HEADER_DANGER)"
    >
      {{ label(HEADER_DANGER) }}
    </Btn>
    <BotActionMenu
      context="header"
      :bot-key="botKey"
      :open="menuOpen"
      :anchor="menuAnchor"
      @navigate="(id) => emit('navigate', id)"
      @close="menuOpen = false"
    />
  </div>

  <!-- Header of the Bot page, phone: tiles of 64 px, sensitive actions folded far away -->
  <div v-else-if="context === 'header'" class="phone">
    <div class="tiles" role="group" :aria-label="acts.t('fq.act.menuLabel')">
      <button
        v-for="id in HEADER_VISIBLE"
        :key="id"
        type="button"
        class="tile"
        :aria-disabled="acts.disabled(id) || undefined"
        :aria-busy="acts.busy(id) || undefined"
        :title="acts.disabled(id) ? acts.reasonText.value : undefined"
        :data-action="id"
        @click="acts.disabled(id) ? undefined : fire(id)"
      >
        <DsIcon :name="ACTIONS[id].icon" :size="20" />
        <span>{{ label(id) }}</span>
      </button>
      <button type="button" class="tile" :data-action="'more'" @click="toggleMenu">
        <DsIcon name="ellipsis" :size="20" />
        <span>{{ acts.t('fq.act.more') }}</span>
      </button>
    </div>
    <details v-if="!splitSensitive" class="sens">
      <summary>{{ acts.t('fq.act.sensitive') }}</summary>
      <div class="sens-body">
        <Btn
          variant="danger-outline"
          size="lg"
          :icon="ACTIONS[HEADER_DANGER].icon"
          :disabled="acts.disabled(HEADER_DANGER)"
          :disabled-reason="acts.reasonText.value"
          :lock-key="acts.lockKey(HEADER_DANGER)"
          :data-action="HEADER_DANGER"
          @click="fire(HEADER_DANGER)"
        >
          {{ label(HEADER_DANGER) }}
        </Btn>
        <Btn
          variant="danger-outline"
          size="lg"
          :icon="ACTIONS.stop.icon"
          :disabled="acts.disabled('stop')"
          :disabled-reason="acts.reasonText.value"
          :lock-key="acts.lockKey('stop')"
          data-action="stop"
          @click="fire('stop')"
        >
          {{ label('stop') }}
        </Btn>
      </div>
    </details>
    <BotActionMenu
      context="header"
      :bot-key="botKey"
      :open="menuOpen"
      :anchor="menuAnchor"
      @navigate="(id) => emit('navigate', id)"
      @close="menuOpen = false"
    />
  </div>

  <!-- Foot of the Bot page, phone: the sensitive actions alone, away from the everyday ones -->
  <div v-else-if="context === 'sensitive'" class="phone">
    <details class="sens" data-testid="sensitive-actions">
      <summary>{{ acts.t('fq.act.sensitive') }}</summary>
      <div class="sens-body">
        <Btn
          variant="danger-outline"
          size="lg"
          :icon="ACTIONS[HEADER_DANGER].icon"
          :disabled="acts.disabled(HEADER_DANGER)"
          :disabled-reason="acts.reasonText.value"
          :lock-key="acts.lockKey(HEADER_DANGER)"
          :data-action="HEADER_DANGER"
          @click="fire(HEADER_DANGER)"
        >
          {{ label(HEADER_DANGER) }}
        </Btn>
        <Btn
          variant="danger-outline"
          size="lg"
          :icon="ACTIONS.stop.icon"
          :disabled="acts.disabled('stop')"
          :disabled-reason="acts.reasonText.value"
          :lock-key="acts.lockKey('stop')"
          data-action="stop"
          @click="fire('stop')"
        >
          {{ label('stop') }}
        </Btn>
      </div>
    </details>
  </div>

  <!-- A table row: one neutral exit button and the menu -->
  <div v-else-if="context === 'row'" class="bar row">
    <template v-if="position && !position.orphan">
      <IconBtn
        v-if="iconOnly"
        icon="log-out"
        :label="label(exitId)"
        size="sm"
        :disabled="acts.disabled(exitId)"
        :data-action="exitId"
        :aria-busy="acts.busy(exitId) || undefined"
        @click.stop="fire(exitId)"
      />
      <Btn
        v-else
        size="xs"
        icon="log-out"
        :disabled="acts.disabled(exitId)"
        :disabled-reason="acts.reasonText.value"
        :lock-key="acts.lockKey(exitId)"
        :data-action="exitId"
        @click.stop="fire(exitId)"
        @locked="emit('locked', exitId)"
      >
        {{ label(exitId) }}
      </Btn>
    </template>
    <Btn
      v-else-if="position?.orphan"
      size="xs"
      icon="git-compare-arrows"
      data-action="reconcile"
      @click.stop="emit('navigate', 'reconcile')"
    >
      {{ label('reconcile') }}
    </Btn>
    <IconBtn
      icon="ellipsis"
      :label="acts.t('fq.act.more')"
      size="sm"
      data-action="menu"
      @click.stop="(e: MouseEvent) => emit('openMenu', e.currentTarget as HTMLElement)"
    />
  </div>

  <!-- Sticky foot of the trade drawer -->
  <div v-else-if="context === 'drawer'" class="bar drawer">
    <template v-if="position && !position.orphan">
      <Btn
        variant="danger-outline"
        size="lg"
        icon="log-out"
        class="grow"
        :disabled="acts.disabled('exit')"
        :disabled-reason="acts.reasonText.value"
        :lock-key="acts.lockKey('exit')"
        data-action="exit"
        @click="fire('exit')"
        @locked="emit('locked', 'exit')"
      >
        {{ label('exit') }}
      </Btn>
      <Btn
        size="lg"
        icon="plus"
        class="grow"
        :disabled="acts.disabled('add')"
        :disabled-reason="acts.reasonText.value"
        :lock-key="acts.lockKey('add')"
        data-action="add"
        @click="fire('add')"
        @locked="emit('locked', 'add')"
      >
        {{ label('add') }}
      </Btn>
    </template>
    <Btn
      v-else
      size="lg"
      icon="git-compare-arrows"
      class="grow"
      data-action="reconcile"
      @click="emit('navigate', 'reconcile')"
    >
      {{ label('reconcile') }}
    </Btn>
  </div>

  <!-- The palette: every action of the bot as a list -->
  <ul v-else class="list" role="menu">
    <li v-for="id in paletteIds" :key="id" role="none">
      <button
        type="button"
        role="menuitem"
        class="li"
        :aria-disabled="acts.disabled(id) || undefined"
        :aria-busy="acts.busy(id) || undefined"
        :title="acts.disabled(id) ? acts.reasonText.value : undefined"
        :data-action="id"
        @click="acts.disabled(id) ? undefined : fire(id)"
      >
        <DsIcon :name="ACTIONS[id].icon" />
        {{ label(id) }}
      </button>
    </li>
  </ul>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
}
.header .gap {
  width: 18px;
}
.row {
  justify-content: center;
  /* Visible on hover, focus and selection; always on touch (02 section 8) */
  opacity: 0;
  transition: opacity var(--d-instant);
}
:global(tr:hover) .row,
:global(tr:focus-within) .row,
:global(tr.sel) .row,
:global(.card:hover) .row,
:global(.card:focus-within) .row {
  opacity: 1;
}
@media (pointer: coarse), (max-width: 599px) {
  .row {
    opacity: 1;
  }
}
.drawer {
  width: 100%;
  /* At 390 px the two large buttons do not fit side by side: wrap instead of overflowing */
  flex-wrap: wrap;
}
.grow {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--gut);
}
.tile {
  height: 64px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 4px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-2);
  background: var(--bg-2);
  color: var(--fg);
  font: 500 var(--t-xs) var(--font-ui);
  cursor: pointer;
}
.tile[aria-disabled='true'] {
  opacity: 0.45;
  cursor: not-allowed;
}
.tile[aria-busy='true'] {
  cursor: progress;
  opacity: 0.6;
}
.sens {
  margin-top: var(--s3);
  border: 1px dashed var(--line-2);
  border-radius: var(--r-2);
  padding: 0 var(--s3);
}
.sens summary {
  min-height: 44px;
  display: flex;
  align-items: center;
  color: var(--fg-3);
  font-size: var(--t-sm);
  cursor: pointer;
}
.sens-body {
  display: grid;
  gap: var(--s2);
  padding-bottom: var(--s3);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.li {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 36px;
  padding: 0 12px;
  background: none;
  border: 0;
  color: var(--fg);
  font: inherit;
  font-size: var(--t-sm);
  cursor: pointer;
  text-align: left;
}
.li:hover {
  background: var(--bg-2);
}
.li[aria-disabled='true'] {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
