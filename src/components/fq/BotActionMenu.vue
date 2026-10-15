<script setup lang="ts">
import { computed } from 'vue';

import { Menu } from '@/components/ds';
import type { MenuItem } from '@/components/ds';
import type { BotKey, Position } from '@/gateway/types.gen';

import {
  drawerActionIds,
  HEADER_DANGER,
  HEADER_MORE,
  rowActionIds,
  ACTIONS,
  type ActionContextKind,
  type ActionId,
} from './lib/actions';
import { useBotActions } from './lib/useBotActions';

/**
 * Menu of the actions of a bot (02 section 5.2). The destructive items are isolated at the end by
 * the Menu itself. A mutation opens the confirmation of THIS bot and trade; a navigation is
 * emitted. One menu is mounted per table or header and moved from row to row (never one popover
 * per row, 02 section 14).
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

const ids = computed<ActionId[]>(() => {
  switch (props.context) {
    case 'row':
      return rowActionIds(props.position?.orphan === true);
    case 'drawer':
      return drawerActionIds(props.position?.orphan === true);
    case 'header':
      return [...HEADER_MORE, HEADER_DANGER];
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

const items = computed<MenuItem[]>(() => ids.value.map((id) => acts.menuItem(id)));

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
