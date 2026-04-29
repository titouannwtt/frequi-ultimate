<script setup lang="ts">
import type { BotDescriptor } from '@/types';
import type MessageBox from './general/MessageBox.vue';
const msgBox = ref<typeof MessageBox>();

const props = defineProps<{
  bot: BotDescriptor;
  noButtons?: boolean;
}>();
defineEmits<{ edit: []; editLogin: [] }>();
const botStore = useBotStore();

function confirmRemoveBot() {
  botStore.removeBot(props.bot.botId);
}

function removeBotQuestion() {
  msgBox.value?.show({
    title: 'Logout confirmation',
    message: `Really remove (logout) from ${props.bot.botName} (${props.bot.botId})?`,
    accept: () => {
      confirmRemoveBot();
    },
  });
}

const selectedBotStore = computed<BotSubStore>(() => {
  return botStore.botStores[props.bot.botId]!;
});

const autoRefreshLoc = computed({
  get() {
    return selectedBotStore.value.autoRefresh;
  },
  set(newValue) {
    selectedBotStore.value.setAutoRefresh(newValue);
  },
});
</script>

<template>
  <div v-if="bot" class="flex items-center justify-between w-full">
    <span class="me-2">{{ bot.botName || bot.botId }}</span>

    <div class="flex items-center gap-2">
      <div class="flex items-center">
        <ToggleSwitch v-model="autoRefreshLoc" class="mr-2" />
        <div
          v-if="selectedBotStore.isBotLoggedIn"
          :title="
            selectedBotStore.isBotStarting
              ? $t('general.starting')
              : selectedBotStore.isBotOnline
                ? $t('general.online')
                : $t('general.offline')
          "
        >
          <i-mdi-circle
            v-if="!selectedBotStore.isBotStarting"
            class="mx-1"
            :class="selectedBotStore.isBotOnline ? 'text-green-500' : 'text-red-500'"
          />
          <i-mdi-loading
            v-else
            class="mx-1 text-amber-500 animate-spin"
          />
        </div>
        <div v-else title="Login info expired, please login again.">
          <i-mdi-cancel class="text-red-500 mx-1" />
        </div>
      </div>

      <div v-if="!noButtons" class="flex items-center gap-1">
        <Button
          v-if="selectedBotStore.isBotLoggedIn"
          size="small"
          severity="secondary"
          title="Edit bot"
          @click="$emit('edit')"
        >
          <i-mdi-pencil />
        </Button>
        <Button
          v-else
          size="small"
          severity="secondary"
          title="Login again"
          @click="$emit('editLogin')"
        >
          <i-mdi-login />
        </Button>
        <Button size="small" severity="secondary" title="Delete bot" @click="removeBotQuestion">
          <i-mdi-delete />
        </Button>
      </div>
    </div>
    <MessageBox ref="msgBox" />
  </div>
</template>
