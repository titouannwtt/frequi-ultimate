<script setup lang="ts">
import type { BotDescriptor } from '@/types';
import type MessageBox from './general/MessageBox.vue';
import humanizeDuration from 'humanize-duration';

const msgBox = ref<typeof MessageBox>();
const folderPopover = ref();
const newFolderName = ref('');

const props = defineProps<{
  bot: BotDescriptor;
  noButtons?: boolean;
}>();
defineEmits<{ edit: []; editLogin: [] }>();

const botStore = useBotStore();
const compStore = useBotComparisonStore();

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

// ── Folder / group membership ──
const currentGroup = computed(() => compStore.getGroupForBot(props.bot.botId));

function openFolderMenu(event: Event) {
  folderPopover.value?.toggle(event);
}
function moveToFolder(groupId: string) {
  compStore.addBotToGroup(props.bot.botId, groupId);
  folderPopover.value?.hide();
}
function removeFromFolder() {
  compStore.removeBotFromGroup(props.bot.botId);
  folderPopover.value?.hide();
}
function createAndMove() {
  const group = compStore.createGroup(newFolderName.value);
  if (group) {
    compStore.addBotToGroup(props.bot.botId, group.id);
  }
  newFolderName.value = '';
  folderPopover.value?.hide();
}

// ── Meta line: uptime + port ──
const onlineSince = computed(() => {
  const ts = botStore.allProfit[props.bot.botId]?.bot_start_timestamp;
  if (!ts) return '';
  return humanizeDuration(Date.now() - ts, { largest: 1, round: true });
});
const port = computed(() => {
  try {
    return new URL(props.bot.botUrl).port || '';
  } catch {
    return '';
  }
});

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
</script>

<template>
  <div v-if="bot" class="flex items-start justify-between w-full gap-2">
    <!-- Identity + tags -->
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2 min-w-0">
        <span v-if="bot.botIcon" class="text-lg leading-none shrink-0">{{ bot.botIcon }}</span>
        <span class="truncate">{{ bot.botName || bot.botId }}</span>
      </div>

      <BotTagBadges :bot-id="bot.botId" class="mt-1.5" />

      <!-- Folder chip + uptime + port -->
      <div class="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-1.5 text-[0.7rem]">
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 transition-colors cursor-pointer"
          :class="
            currentGroup
              ? 'bg-surface-200 dark:bg-surface-700 hover:bg-surface-300 dark:hover:bg-surface-600'
              : 'opacity-50 hover:opacity-90 border border-dashed border-surface-400'
          "
          :title="$t('botList.changeFolder')"
          @click.stop="openFolderMenu"
        >
          <span v-if="currentGroup">{{ currentGroup.icon || '📁' }}</span>
          <i-mdi-folder-outline v-else class="text-[0.8rem]" />
          <span class="truncate max-w-[140px]">{{
            currentGroup ? currentGroup.name : $t('botList.noFolder')
          }}</span>
        </button>

        <span v-if="onlineSince" class="opacity-50">{{
          $t('botList.onlineSince', { duration: onlineSince })
        }}</span>
        <span v-if="port" class="opacity-40 font-mono">:{{ port }}</span>
      </div>
    </div>

    <!-- Actions -->
    <div v-if="!noButtons" class="flex items-center gap-1 shrink-0">
      <ToggleSwitch v-model="autoRefreshLoc" :title="$t('botList.autoRefresh')" class="me-1" />
      <Button
        size="small"
        severity="secondary"
        :title="$t('botList.changeFolder')"
        @click.stop="openFolderMenu"
      >
        <i-mdi-folder-move-outline />
      </Button>
      <Button
        v-if="selectedBotStore.isBotLoggedIn"
        size="small"
        severity="secondary"
        title="Edit bot"
        @click.stop="$emit('edit')"
      >
        <i-mdi-pencil />
      </Button>
      <Button
        v-else
        size="small"
        severity="secondary"
        title="Login again"
        @click.stop="$emit('editLogin')"
      >
        <i-mdi-login />
      </Button>
      <Button size="small" severity="secondary" title="Delete bot" @click.stop="removeBotQuestion">
        <i-mdi-delete />
      </Button>
    </div>

    <!-- Folder selection popover -->
    <Popover ref="folderPopover">
      <div class="flex flex-col gap-0.5 min-w-[210px]" @click.stop>
        <div class="text-xs font-semibold opacity-70 px-2 py-1">
          {{ $t('botList.moveToFolder') }}
        </div>
        <button
          v-for="g in compStore.botGroups"
          :key="g.id"
          type="button"
          class="flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-surface-200 dark:hover:bg-surface-700 cursor-pointer text-left"
          :class="{ 'bg-surface-200 dark:bg-surface-700 font-semibold': g.id === currentGroup?.id }"
          @click="moveToFolder(g.id)"
        >
          <span>{{ g.icon || '📁' }}</span>
          <span class="truncate flex-1">{{ g.name }}</span>
          <i-mdi-check v-if="g.id === currentGroup?.id" class="text-primary shrink-0" />
        </button>
        <div v-if="compStore.botGroups.length === 0" class="px-2 py-1 text-xs opacity-50">
          {{ $t('botList.noFoldersYet') }}
        </div>

        <button
          v-if="currentGroup"
          type="button"
          class="flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm text-red-500 hover:bg-surface-200 dark:hover:bg-surface-700 cursor-pointer text-left"
          @click="removeFromFolder"
        >
          <i-mdi-folder-remove-outline />
          <span>{{ $t('botList.removeFromFolder') }}</span>
        </button>

        <Divider class="my-1!" />
        <form class="flex gap-1 px-1 pb-1" @submit.prevent="createAndMove">
          <InputText
            v-model="newFolderName"
            size="small"
            class="w-full"
            :placeholder="$t('botList.newFolderName')"
          />
          <Button
            type="submit"
            size="small"
            severity="secondary"
            :title="$t('botList.createFolder')"
          >
            <i-mdi-plus />
          </Button>
        </form>
      </div>
    </Popover>

    <MessageBox ref="msgBox" />
  </div>
</template>
