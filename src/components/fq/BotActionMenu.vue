<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { Menu } from '@/components/ds';
import type { MenuItem } from '@/components/ds';
import { ageMs } from '@/components/ds/lib/freshness';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import type { BotKey, Position } from '@/gateway/types.gen';

import {
  drawerActionIds,
  HEADER_MORE,
  HEADER_SENSITIVE,
  rowActionIds,
  ACTIONS,
  type ActionContextKind,
  type ActionId,
} from './lib/actions';
import { useBotActions } from './lib/useBotActions';

/**
 * Menu of the actions of a bot (02 section 5.2). The destructive items are isolated at the end by
 * the Menu itself. In the header of the Bot page (the "More" menu) the everyday actions come
 * first, then the port, the exchange and the age of the data, then the sensitive actions
 * ("Exit all...", "Stop the bot...") under their own heading. A mutation opens the confirmation
 * of THIS bot and trade; a navigation is emitted. One menu is mounted per table or header and
 * moved from row to row (never one popover per row, 02 section 14).
 */
const props = withDefaults(
  defineProps<{
    botKey: BotKey;
    context: ActionContextKind;
    position?: Position | null;
    open: boolean;
    anchor: HTMLElement | null;
    inline?: boolean;
  }>(),
  { position: null },
);

const emit = defineEmits<{ navigate: [id: ActionId]; close: [] }>();

const acts = useBotActions(
  () => props.botKey,
  () => props.position,
);

const { t } = useI18n();
const fmt = useFormat();
const conn = useFqConnectionStore();
const clock = useNowMs();

const ids = computed<ActionId[]>(() => {
  switch (props.context) {
    case 'row':
      return rowActionIds(props.position?.orphan === true);
    case 'drawer':
      return drawerActionIds(props.position?.orphan === true);
    case 'header':
      return [...HEADER_MORE, ...HEADER_SENSITIVE];
    case 'palette':
      return (Object.keys(ACTIONS) as ActionId[]).filter((id) =>
        props.position
          ? true
          : !['exit', 'add', 'cancelOrder', 'reloadTrade', 'deleteTrade'].includes(id),
      );
    default:
      return [];
  }
});

/** Plain-words labels of the "More" menu (the shared labels stay short for the buttons). */
const HEADER_LABELS: Partial<Record<ActionId, string>> = {
  reload: 'fq.pg.bot.menu.reload',
  config: 'fq.pg.bot.menu.config',
};

/** Port, exchange and age of the data of the bot: what the header no longer carries. */
const info = computed(() => {
  const b = acts.bot.value;
  if (!b) return '';
  const parts: string[] = [];
  if (b.identity.port !== null) parts.push(t('fq.header.port', { port: b.identity.port }));
  if (b.identity.exchange) parts.push(b.identity.exchange);
  if (b.freshness.state) {
    const age = ageMs(b.freshness.state.as_of_ms, clock.value, conn.status.clockSkewMs);
    parts.push(t('fq.pg.bot.menu.age', { age: fmt.age(age) }));
  }
  return parts.join(' · ');
});

const items = computed<MenuItem[]>(() => {
  const own = ids.value.map((id) => {
    const item = acts.menuItem(id);
    const key = props.context === 'header' ? HEADER_LABELS[id] : undefined;
    return key ? { ...item, label: t(key) } : item;
  });
  if (props.context !== 'header') return own;
  const safe = own.filter((i) => !i.danger);
  const danger = own.filter((i) => i.danger);
  return [
    ...safe,
    ...(info.value
      ? [
          { id: '__info', kind: 'heading' as const, label: t('fq.pg.bot.menu.info') },
          { id: '__info-text', kind: 'text' as const, label: info.value },
        ]
      : []),
    // A heading flagged `danger` stays with the destructive items, after the separator
    {
      id: '__sensitive',
      kind: 'heading' as const,
      danger: true,
      label: t('fq.pg.bot.menu.sensitive'),
    },
    ...danger,
  ];
});

function onSelect(id: string) {
  const action = id as ActionId;
  if (ACTIONS[action].mutation) {
    acts.trigger(action);
  } else {
    emit('navigate', action);
  }
}
</script>

<template>
  <Menu
    :open="open"
    :anchor="anchor"
    :items="items"
    :label="acts.t('fq.act.menuLabel')"
    :inline="inline"
    @select="onSelect"
    @close="emit('close')"
  />
</template>
