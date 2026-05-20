<script setup lang="ts">
import LoginModal from '@/components/LoginModal.vue';

import type { AuthStorageWithBotId, BotDescriptor } from '@/types';
import type { BotGroup } from '@/types/botComparison';
import { useSortable } from '@vueuse/integrations/useSortable';
import { useBotListSort, BOT_SORT_MODES } from '@/composables/useBotListSort';

defineProps<{
  small?: boolean;
}>();

const botStore = useBotStore();
const compStore = useBotComparisonStore();
const { sortMode, sortBots, isManualSort } = useBotListSort();

const editingBots = ref<string[]>([]);
const loginModal = ref<typeof LoginModal>();
const sortContainer = ref<HTMLElement | null>(null);

// ── Toolbar state ──
const search = ref('');
const groupView = useStorage('ftBotListGrouped', false);
const quickFilter = ref<'all' | 'live' | 'dry' | 'offline'>('all');

// ── Folder inline edit state ──
const editingGroupId = ref<string | null>(null);
const editGroupName = ref('');
const showNewFolder = ref(false);
const newFolderName = ref('');

// ── Status helpers ──
function botStatus(botId: string): 'live' | 'dry' | 'offline' {
  const sub = botStore.botStores[botId];
  if (!sub?.isBotOnline) return 'offline';
  return botStore.allBotState[botId]?.dry_run ? 'dry' : 'live';
}

const baseBots = computed<BotDescriptor[]>(() => botStore.availableBotsSorted);

const statusCounts = computed(() => {
  const c = { live: 0, dry: 0, offline: 0 };
  for (const b of baseBots.value) c[botStatus(b.botId)]++;
  return c;
});

const filteredBots = computed<BotDescriptor[]>(() => {
  const q = search.value.trim().toLowerCase();
  return baseBots.value.filter((b) => {
    if (quickFilter.value !== 'all' && botStatus(b.botId) !== quickFilter.value) return false;
    if (q && !`${b.botName} ${b.botId} ${b.botUrl}`.toLowerCase().includes(q)) return false;
    return true;
  });
});

const flatBots = computed<BotDescriptor[]>(() => sortBots(filteredBots.value));

// Drag-reorder only makes sense in manual sort, ungrouped, unfiltered view.
const dragEnabled = computed(
  () =>
    isManualSort.value &&
    !groupView.value &&
    search.value.trim() === '' &&
    quickFilter.value === 'all',
);

interface BotSection {
  key: string;
  group: BotGroup | null;
  bots: BotDescriptor[];
}
const groupedSections = computed<BotSection[]>(() => {
  const bots = flatBots.value;
  const sections: BotSection[] = compStore.botGroups.map((g) => ({
    key: g.id,
    group: g,
    bots: bots.filter((b) => g.botIds.includes(b.botId)),
  }));
  const ungrouped = bots.filter((b) => !compStore.getBotGroupId(b.botId));
  if (ungrouped.length > 0) {
    sections.push({ key: '__ungrouped__', group: null, bots: ungrouped });
  }
  return sections;
});

useSortable(sortContainer, flatBots, {
  handle: '.handle',
  onUpdate: (e) => {
    if (e.oldIndex === undefined || e.newIndex === undefined) {
      return;
    }
    const oldBotId = flatBots.value[e.oldIndex]?.botId;
    const newBotId = flatBots.value[e.newIndex]?.botId;
    if (oldBotId && newBotId) {
      botStore.updateBot(oldBotId, { sortId: e.newIndex });
      botStore.updateBot(newBotId, { sortId: e.oldIndex });
    }
  },
});

// ── Bot rename ──
function editBot(botId: string) {
  if (!editingBots.value.includes(botId)) {
    editingBots.value.push(botId);
  }
}
function editBotLogin(botId: string) {
  const bot = botStore.botStores[botId];
  if (!bot) {
    console.error('Bot not found');
    return;
  }
  const loginInfo: AuthStorageWithBotId = {
    ...bot.getLoginInfo(),
    botId,
  };
  loginModal.value?.openLoginModal(loginInfo);
}
function stopEditBot(botId: string) {
  const idx = editingBots.value.indexOf(botId);
  if (idx !== -1) editingBots.value.splice(idx, 1);
}

// ── Folder management ──
function toggleCollapse(group: BotGroup) {
  compStore.toggleGroupCollapse(group.id);
}
function startRenameGroup(group: BotGroup) {
  editingGroupId.value = group.id;
  editGroupName.value = group.name;
}
function saveRenameGroup() {
  if (editingGroupId.value) {
    compStore.renameGroup(editingGroupId.value, editGroupName.value);
  }
  editingGroupId.value = null;
}
function deleteFolder(group: BotGroup) {
  compStore.deleteGroup(group.id);
}
function createFolder() {
  if (compStore.createGroup(newFolderName.value)) {
    newFolderName.value = '';
    showNewFolder.value = false;
  }
}
</script>

<template>
  <div class="w-full">
    <!-- ── Header / toolbar ── -->
    <div v-if="!small" class="flex items-center justify-between gap-2 mb-3 flex-wrap">
      <div class="flex items-center gap-2">
        <h3 class="font-bold text-2xl">{{ $t('botList.title') }}</h3>
        <Badge v-if="botStore.botCount" severity="secondary">{{ botStore.botCount }}</Badge>
      </div>

      <div v-if="botStore.botCount > 0" class="flex items-center gap-2 flex-wrap">
        <div v-if="botStore.botCount > 3" class="relative">
          <i-mdi-magnify
            class="absolute left-2 top-1/2 -translate-y-1/2 opacity-50 pointer-events-none"
          />
          <InputText
            v-model="search"
            size="small"
            :placeholder="$t('botList.searchPlaceholder')"
            class="w-40 ps-7!"
          />
        </div>

        <Select v-model="sortMode" :options="BOT_SORT_MODES" size="small" class="min-w-[9rem]">
          <template #value="{ value }">
            <span class="flex items-center gap-1.5">
              <i-mdi-sort class="opacity-70" />{{ $t(`botList.sort.${value}`) }}
            </span>
          </template>
          <template #option="{ option }">{{ $t(`botList.sort.${option}`) }}</template>
        </Select>

        <Button
          size="small"
          severity="secondary"
          :title="groupView ? $t('botList.viewFlat') : $t('botList.viewGrouped')"
          @click="groupView = !groupView"
        >
          <i-mdi-folder-multiple-outline v-if="!groupView" />
          <i-mdi-format-list-bulleted v-else />
        </Button>

        <LoginModal ref="loginModal" :login-text="$t('botList.addBot')" />
      </div>
    </div>

    <!-- ── Empty state ── -->
    <div
      v-if="botStore.botCount === 0 && !small"
      class="flex flex-col items-center justify-center gap-3 py-10 px-4 text-center border border-dashed border-surface-400 rounded-lg"
    >
      <i-mdi-robot-outline class="text-5xl opacity-30" />
      <p class="opacity-70">{{ $t('botList.emptyState') }}</p>
      <LoginModal :login-text="$t('botList.addFirstBot')" />
    </div>

    <!-- ── Quick status filters ── -->
    <div
      v-if="!small && botStore.botCount > 1"
      class="flex items-center gap-2 mb-2 text-xs flex-wrap"
    >
      <button
        v-for="f in ['all', 'live', 'dry', 'offline'] as const"
        :key="f"
        type="button"
        class="px-2 py-0.5 rounded-full border transition-colors cursor-pointer"
        :class="
          quickFilter === f
            ? 'bg-primary text-white border-primary'
            : 'border-surface-400 opacity-70 hover:opacity-100'
        "
        @click="quickFilter = f"
      >
        {{ $t(`botList.filter.${f}`)
        }}<span v-if="f !== 'all'" class="ms-1 opacity-70">{{ statusCounts[f] }}</span>
      </button>
    </div>

    <!-- ── Flat view ── -->
    <ul
      v-if="!groupView || small"
      ref="sortContainer"
      class="flex flex-col divide-y border border-surface-500 rounded-md divide-solid divide-surface-500 overflow-hidden"
    >
      <BotListRow
        v-for="bot in small ? baseBots : flatBots"
        :key="bot.botId"
        :bot="bot"
        :small="small"
        :editing="editingBots.includes(bot.botId)"
        :draggable="dragEnabled"
        @select="botStore.selectBot(bot.botId)"
        @edit="editBot(bot.botId)"
        @edit-login="editBotLogin(bot.botId)"
        @saved="stopEditBot(bot.botId)"
        @cancelled="stopEditBot(bot.botId)"
      />
    </ul>

    <!-- ── Grouped view ── -->
    <div v-else class="flex flex-col gap-3">
      <div v-for="section in groupedSections" :key="section.key">
        <!-- Folder header -->
        <div
          class="flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface-100 dark:bg-surface-800/60 group/fld"
        >
          <button
            v-if="section.group"
            type="button"
            class="cursor-pointer opacity-70 hover:opacity-100"
            @click="toggleCollapse(section.group)"
          >
            <i-mdi-chevron-down v-if="!section.group.collapsed" />
            <i-mdi-chevron-right v-else />
          </button>
          <span>{{ section.group ? section.group.icon || '📁' : '📂' }}</span>

          <template v-if="section.group && editingGroupId === section.group.id">
            <InputText
              v-model="editGroupName"
              size="small"
              class="w-40"
              autofocus
              @keyup.enter="saveRenameGroup"
              @keyup.esc="editingGroupId = null"
            />
            <Button size="small" severity="secondary" title="Save" @click="saveRenameGroup">
              <i-mdi-check />
            </Button>
          </template>
          <span v-else class="font-semibold truncate">
            {{ section.group ? section.group.name : $t('botList.ungrouped') }}
          </span>

          <Badge severity="secondary">{{ section.bots.length }}</Badge>

          <div
            v-if="section.group"
            class="ms-auto flex gap-1 opacity-0 group-hover/fld:opacity-100 transition-opacity"
          >
            <Button
              size="small"
              severity="secondary"
              :title="$t('botList.renameFolder')"
              @click="startRenameGroup(section.group)"
            >
              <i-mdi-pencil />
            </Button>
            <Button
              size="small"
              severity="secondary"
              :title="$t('botList.deleteFolder')"
              @click="deleteFolder(section.group)"
            >
              <i-mdi-delete />
            </Button>
          </div>
        </div>

        <!-- Folder bots -->
        <ul
          v-if="!section.group || !section.group.collapsed"
          class="flex flex-col divide-y border border-surface-500 rounded-md divide-solid divide-surface-500 overflow-hidden mt-1"
        >
          <BotListRow
            v-for="bot in section.bots"
            :key="bot.botId"
            :bot="bot"
            :editing="editingBots.includes(bot.botId)"
            :draggable="false"
            @select="botStore.selectBot(bot.botId)"
            @edit="editBot(bot.botId)"
            @edit-login="editBotLogin(bot.botId)"
            @saved="stopEditBot(bot.botId)"
            @cancelled="stopEditBot(bot.botId)"
          />
          <li v-if="section.bots.length === 0" class="p-3 text-xs opacity-40 text-center">
            {{ $t('botList.emptyFolder') }}
          </li>
        </ul>
      </div>

      <!-- New folder -->
      <form v-if="showNewFolder" class="flex gap-2" @submit.prevent="createFolder">
        <InputText
          v-model="newFolderName"
          size="small"
          class="w-48"
          autofocus
          :placeholder="$t('botList.newFolderName')"
        />
        <Button type="submit" size="small" :title="$t('botList.createFolder')">
          <i-mdi-check />
        </Button>
        <Button size="small" severity="secondary" @click="showNewFolder = false">
          <i-mdi-close />
        </Button>
      </form>
      <Button
        v-else
        size="small"
        severity="secondary"
        class="self-start"
        @click="showNewFolder = true"
      >
        <i-mdi-folder-plus-outline class="me-1" />{{ $t('botList.newFolder') }}
      </Button>
    </div>

    <!-- No results after filtering -->
    <div
      v-if="!small && botStore.botCount > 0 && filteredBots.length === 0"
      class="py-6 text-center text-sm opacity-50"
    >
      {{ $t('botList.noMatches') }}
    </div>
  </div>
</template>
