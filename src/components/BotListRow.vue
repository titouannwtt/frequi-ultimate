<script setup lang="ts">
import type { BotDescriptor } from '@/types';

const props = defineProps<{
  bot: BotDescriptor;
  editing?: boolean;
  draggable?: boolean;
  small?: boolean;
}>();
defineEmits<{ select: []; edit: []; editLogin: []; saved: []; cancelled: [] }>();

const botStore = useBotStore();
const isSelected = computed(() => props.bot.botId === botStore.selectedBot);
const isLoggedIn = computed(() => botStore.botStores[props.bot.botId]?.isBotLoggedIn);
</script>

<template>
  <li
    :title="`${bot.botId} - ${bot.botName} - ${bot.botUrl}${isLoggedIn ? '' : ' - Login info expired!'}`"
    class="flex items-start p-2.5 gap-1.5 transition-colors cursor-pointer"
    :class="
      isSelected
        ? 'bg-primary-100 dark:bg-primary-900/40 border-l-2 border-primary'
        : 'border-l-2 border-transparent hover:bg-surface-100 dark:hover:bg-surface-800/60'
    "
    @click="$emit('select')"
  >
    <i-mdi-reorder-horizontal
      v-if="draggable && !editing"
      class="handle cursor-grab me-1 mt-1 opacity-30 hover:opacity-80 shrink-0"
      @click.stop
    />

    <BotRename v-if="editing" :bot="bot" @saved="$emit('saved')" @cancelled="$emit('cancelled')" />
    <BotEntry
      v-else
      :bot="bot"
      :no-buttons="small"
      @edit="$emit('edit')"
      @edit-login="$emit('editLogin')"
    />
  </li>
</template>
