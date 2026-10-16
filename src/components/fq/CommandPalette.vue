<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { Badge, DsIcon, ModeMark } from '@/components/ds';
import type { DsIconRef } from '@/components/ds';
import { useFocusTrap } from '@/components/ds/lib/useFocusTrap';
import { requestAction } from '@/composables/useActionDialog';
import { useCommandPalette } from '@/composables/useCommandPalette';
import { useShortcuts } from '@/composables/useShortcuts';
import { useTheme } from '@/composables/useTheme';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import type { BotKey, Position } from '@/gateway/types.gen';

import { ACTIONS, buildAction, disabledReasonFor, type ActionId } from './lib/actions';
import { botState } from './lib/bots';
import { pairLabel } from './lib/trades';

export type PaletteGroup = 'goto' | 'bots' | 'pairs' | 'actions' | 'display';
export type PalettePage = 'fleet' | 'bot' | 'charts' | 'journal' | 'tools' | 'settings';

interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  hint?: string;
  icon: DsIconRef;
  mode?: 'live' | 'dry' | 'replay';
  severity?: 'info' | 'warning' | 'critical' | null;
  /** Lower-case words that also match. */
  keywords: string;
  disabledReason?: string;
  run: () => void;
}

/**
 * The command palette (02 section 2.6): Ctrl K or `/`. Groups Go to, Bots (live dot or DRY badge,
 * alert state), Pairs, Actions and Display. An action typed here NEVER sends anything: it opens
 * the confirmation of the bot it names, one bot at a time; there is no grouped command in v1.
 * Without a query only the actions of the current bot are listed.
 */
const props = defineProps<{ currentBotKey?: BotKey | null }>();

const emit = defineEmits<{
  navigate: [page: PalettePage];
  openBot: [botKey: BotKey];
  openPair: [pair: string, botKey: BotKey];
  openTrade: [botKey: BotKey, tradeId: number];
  display: [command: 'view' | 'density' | 'language'];
}>();

const { t } = useI18n();
const palette = useCommandPalette();
const fleet = useFqFleetStore();
const positions = useFqPositionsStore();
const conn = useFqConnectionStore();
const theme = useTheme();

useShortcuts([
  {
    id: 'palette.ctrlk',
    keys: 'k',
    mod: true,
    labelKey: 'fq.shortcut.palette',
    group: 'general',
    run: () => {
      palette.toggle();
    },
  },
  {
    id: 'palette.slash',
    keys: '/',
    labelKey: 'fq.shortcut.palette',
    group: 'general',
    run: () => {
      palette.show();
    },
  },
]);

const query = ref('');
/**
 * The highlighted entry is remembered by id, never by index: the list is rebuilt on every store
 * update, and an index would silently move to another trade or bot when a row above disappears.
 */
const activeId = ref<string | null>(null);
const input = ref<HTMLInputElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const listId = useId();
const open = palette.open;

watch(open, async (o) => {
  if (o) {
    query.value = '';
    activeId.value = flat.value[0]?.id ?? null;
    await nextTick();
    input.value?.focus();
  }
});
useFocusTrap(panel, open, () => input.value);

const GROUP_ORDER: PaletteGroup[] = ['goto', 'bots', 'pairs', 'actions', 'display'];

const PAGES: Array<{ id: PalettePage; icon: DsIconRef }> = [
  { id: 'fleet', icon: 'layout-grid' },
  { id: 'bot', icon: 'bot' },
  { id: 'charts', icon: 'chart-candlestick' },
  { id: 'journal', icon: 'book-open-text' },
  { id: 'tools', icon: 'wrench' },
  { id: 'settings', icon: 'settings' },
];

function reasonOf(botKey: BotKey, position?: Position | null): string | undefined {
  const bot = fleet.bots[botKey];
  const r = disabledReasonFor(
    bot ? botState(bot, Date.now(), conn.status.clockSkewMs) : null,
    { connection: conn.status.state, fromCache: conn.fromCache },
    { orphan: position?.orphan === true },
  );
  return r ? t(`fq.act.disabled.${r}`) : undefined;
}

const BOT_ACTIONS: ActionId[] = ['pause', 'resume', 'reload', 'exitAll', 'stop'];

function actionItem(botKey: BotKey, id: ActionId, position?: Position | null): PaletteItem | null {
  const action = buildAction(id, { position });
  if (!action) return null;
  const name = fleet.bots[botKey]?.identity.name ?? botKey;
  const subject = position ? ` ${pairLabel(position.pair)} #${position.trade_id}` : '';
  return {
    id: `act:${botKey}:${id}:${position?.trade_id ?? ''}`,
    group: 'actions',
    label: `${t(`fq.act.${ACTIONS[id].label}`)}${subject}`,
    hint: name,
    icon: ACTIONS[id].icon,
    mode: fleet.bots[botKey]?.identity.mode,
    keywords: `${id} ${name} ${botKey} ${position?.pair ?? ''}`.toLowerCase(),
    disabledReason: reasonOf(botKey, position),
    // Always the confirmation of the named bot: closing the palette first hands it the focus
    run: () => {
      palette.hide();
      requestAction(botKey, action, { position });
    },
  };
}

const items = computed<PaletteItem[]>(() => {
  const q = query.value.trim().toLowerCase();
  const out: PaletteItem[] = [];

  for (const p of PAGES) {
    out.push({
      id: `goto:${p.id}`,
      group: 'goto',
      label: t(`fq.nav.${p.id}`),
      icon: p.icon,
      keywords: p.id,
      run: () => emit('navigate', p.id),
    });
  }
  for (const b of fleet.list) {
    out.push({
      id: `bot:${b.bot_key}`,
      group: 'bots',
      label: b.identity.name,
      hint: b.identity.strategy ?? undefined,
      icon: 'bot',
      mode: b.identity.mode,
      severity: b.alerts.count > 0 ? b.alerts.max_severity : null,
      keywords:
        `${b.bot_key} ${b.identity.strategy ?? ''} ${b.identity.exchange ?? ''}`.toLowerCase(),
      run: () => emit('openBot', b.bot_key),
    });
  }
  const seen = new Set<string>();
  for (const p of positions.list) {
    const k = `${p.bot_key}|${p.pair}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      id: `pair:${k}`,
      group: 'pairs',
      label: pairLabel(p.pair),
      hint: fleet.bots[p.bot_key]?.identity.name ?? p.bot_key,
      icon: 'chart-candlestick',
      mode: fleet.bots[p.bot_key]?.identity.mode,
      keywords: `${p.pair} ${p.bot_key}`.toLowerCase(),
      run: () => emit('openPair', p.pair, p.bot_key),
    });
  }

  // Actions: the named bot's confirmation, never a grouped command
  if (q.length >= 2) {
    for (const b of fleet.list) {
      for (const id of BOT_ACTIONS) {
        const it = actionItem(b.bot_key, id);
        if (it) out.push(it);
      }
    }
    for (const p of positions.list) {
      if (p.orphan) continue;
      for (const id of ['exit', 'add'] as ActionId[]) {
        const it = actionItem(p.bot_key, id, p);
        if (it) out.push(it);
      }
    }
  } else if (props.currentBotKey) {
    for (const id of BOT_ACTIONS) {
      const it = actionItem(props.currentBotKey, id);
      if (it) out.push(it);
    }
  }

  out.push(
    {
      id: 'display:theme',
      group: 'display',
      label: t('fq.palette.theme'),
      icon: 'moon',
      keywords: 'theme dark light',
      run: () => theme.cycle(),
    },
    {
      id: 'display:view',
      group: 'display',
      label: t('fq.palette.view'),
      icon: 'layout-grid',
      keywords: 'map table carte',
      run: () => emit('display', 'view'),
    },
    {
      id: 'display:density',
      group: 'display',
      label: t('fq.palette.density'),
      icon: 'layers',
      keywords: 'density',
      run: () => emit('display', 'density'),
    },
    {
      id: 'display:language',
      group: 'display',
      label: t('fq.palette.language'),
      icon: 'settings',
      keywords: 'language langue',
      run: () => emit('display', 'language'),
    },
  );

  // Without a query the pairs are too many to list: they appear when typing
  if (!q) return out.filter((i) => i.group !== 'pairs').slice(0, 60);
  const words = q.split(/\s+/);
  const scored = out
    .map((it) => {
      const hay = `${it.label} ${it.hint ?? ''} ${it.keywords}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return null;
      const starts = it.label.toLowerCase().startsWith(words[0]!) ? 0 : 1;
      return { it, starts };
    })
    .filter((x): x is { it: PaletteItem; starts: number } => x !== null);
  scored.sort(
    (a, b) =>
      GROUP_ORDER.indexOf(a.it.group) - GROUP_ORDER.indexOf(b.it.group) || a.starts - b.starts,
  );
  return scored.slice(0, 40).map((x) => x.it);
});

const grouped = computed(() =>
  GROUP_ORDER.map((g) => ({ group: g, items: items.value.filter((i) => i.group === g) })).filter(
    (g) => g.items.length > 0,
  ),
);
const flat = computed(() => grouped.value.flatMap((g) => g.items));

const active = computed(() =>
  activeId.value === null ? -1 : flat.value.findIndex((i) => i.id === activeId.value),
);

watch(query, () => (activeId.value = flat.value[0]?.id ?? null));
// The highlighted entry vanished (position closed, bot gone): clear the selection instead of
// moving it, so Enter can never run something else than what the user had chosen
watch(flat, (list) => {
  if (activeId.value !== null && !list.some((i) => i.id === activeId.value)) {
    activeId.value = null;
  }
});

function choose(item: PaletteItem | undefined) {
  if (!item || item.disabledReason) return;
  if (item.group !== 'actions') palette.hide();
  item.run();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    palette.hide();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeId.value = flat.value[Math.min(flat.value.length - 1, active.value + 1)]?.id ?? null;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeId.value = flat.value[Math.max(0, active.value - 1)]?.id ?? null;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    // No highlighted entry (it vanished): nothing runs
    if (active.value >= 0) choose(flat.value[active.value]);
  }
}

const optionId = (i: number) => `${listId}-${i}`;
const indexOf = (item: PaletteItem) => flat.value.indexOf(item);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="scrim" aria-hidden="true" @click="palette.hide()"></div>
    <div
      v-if="open"
      ref="panel"
      class="pal fq-portal"
      role="dialog"
      aria-modal="true"
      :aria-label="t('fq.palette.label')"
      data-testid="command-palette"
      @keydown="onKeydown"
    >
      <div class="in">
        <DsIcon name="search" />
        <input
          ref="input"
          v-model="query"
          type="text"
          role="combobox"
          :aria-expanded="true"
          :aria-controls="listId"
          :aria-activedescendant="active >= 0 ? optionId(active) : undefined"
          :placeholder="t('fq.palette.placeholder')"
          autocomplete="off"
          spellcheck="false"
        />
        <kbd>Esc</kbd>
      </div>
      <div :id="listId" class="list" role="listbox">
        <template v-for="g in grouped" :key="g.group">
          <h4>{{ t(`fq.palette.group.${g.group}`) }}</h4>
          <button
            v-for="it in g.items"
            :id="optionId(indexOf(it))"
            :key="it.id"
            type="button"
            role="option"
            class="opt"
            :class="{ on: indexOf(it) === active }"
            :aria-selected="indexOf(it) === active"
            :aria-disabled="it.disabledReason ? true : undefined"
            :title="it.disabledReason"
            :data-item="it.id"
            @mousemove="activeId = it.id"
            @click="choose(it)"
          >
            <DsIcon :name="it.icon" />
            <span class="lbl">{{ it.label }}</span>
            <ModeMark v-if="it.mode && it.group !== 'goto'" :mode="it.mode" />
            <Badge
              v-if="it.severity"
              :kind="
                it.severity === 'critical' ? 'crit' : it.severity === 'warning' ? 'warn' : 'info'
              "
              :label="
                t(
                  it.severity === 'critical'
                    ? 'fq.attention.level.critical'
                    : 'fq.attention.level.watch',
                )
              "
            />
            <span v-if="it.hint" class="hint">{{ it.hint }}</span>
            <span v-if="it.group === 'actions'" class="confirm">{{
              t('fq.palette.confirmHint')
            }}</span>
          </button>
        </template>
        <p v-if="flat.length === 0" class="none">{{ t('fq.palette.none') }}</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-base, 0) + 80);
  background: var(--scrim);
}
.pal {
  position: fixed;
  z-index: calc(var(--z-base, 0) + 81);
  left: 50%;
  top: 12vh;
  transform: translateX(-50%);
  width: min(620px, calc(100vw - 24px));
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-1);
  color: var(--fg);
  border-radius: var(--r-3);
  box-shadow: var(--shadow-float);
  font-family: var(--font-ui);
}
.in {
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: 0 var(--s3);
  height: 48px;
  border-bottom: 1px solid var(--line);
  color: var(--fg-3);
}
input {
  flex: 1;
  background: none;
  border: 0;
  outline: none;
  color: var(--fg);
  font: inherit;
  font-size: var(--t-lg);
}
kbd {
  font: 500 10.5px var(--font-num);
  padding: 1px 5px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-1);
}
.list {
  overflow: auto;
  padding: 4px 0 8px;
}
h4 {
  margin: 8px var(--s3) 2px;
  font-size: var(--t-xs);
  color: var(--fg-3);
  font-weight: 600;
  text-transform: var(--th-case);
  letter-spacing: var(--th-track);
}
.opt {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 34px;
  padding: 0 var(--s3);
  background: none;
  border: 0;
  color: var(--fg);
  font: inherit;
  font-size: var(--t-md);
  text-align: left;
  cursor: pointer;
}
.opt.on {
  background: var(--bg-2);
}
.opt[aria-disabled='true'] {
  opacity: 0.45;
  cursor: not-allowed;
}
.lbl {
  min-width: 0;
  overflow-wrap: anywhere;
}
.hint {
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.confirm {
  margin-left: auto;
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.none {
  margin: 0;
  padding: var(--s4);
  text-align: center;
  color: var(--fg-3);
}
@media (max-width: 599px) {
  .pal {
    top: 0;
    left: 0;
    right: 0;
    transform: none;
    width: 100%;
    max-height: 100dvh;
    border-radius: 0;
  }
  .opt {
    min-height: 44px;
  }
}
</style>
