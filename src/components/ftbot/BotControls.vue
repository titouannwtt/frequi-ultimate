forceexit
<script setup lang="ts">
import type { MsgBoxObject } from '@/components/general/MessageBox.vue';
import type MessageBox from '@/components/general/MessageBox.vue';

import type { ForceExitPayload } from '@/types';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import ForceEntryForm from './ForceEntryForm.vue';

const { t } = useI18n();
const router = useRouter();
const botStore = useBotStore();
const forceEnter = ref<boolean>(false);
const msgBox = ref<typeof MessageBox>();

const isRunning = computed((): boolean => {
  return botStore.activeBot.botState?.state === 'running';
});

const handleStopBot = () => {
  const msg: MsgBoxObject = {
    title: t('controls.stopBot'),
    message: t('controls.stopBotConfirm'),
    accept: () => {
      botStore.activeBot.stopBot();
    },
  };
  msgBox.value?.show(msg);
};

const handleStopBuy = () => {
  const msg: MsgBoxObject = {
    title: t('controls.pauseStopEntering'),
    message: t('controls.pause'),
    accept: () => {
      botStore.activeBot.stopBuy();
    },
  };
  msgBox.value?.show(msg);
};

const handleReloadConfig = () => {
  const msg: MsgBoxObject = {
    title: t('controls.reload'),
    message: t('controls.reloadConfirm'),
    accept: () => {
      console.log('reload...');
      botStore.activeBot.reloadConfig();
    },
  };
  msgBox.value?.show(msg);
};

const handleForceExit = () => {
  const msg: MsgBoxObject = {
    title: t('controls.forceExitAll'),
    message: t('controls.forceExitAllConfirm'),
    accept: () => {
      const payload: ForceExitPayload = {
        tradeid: 'all',
      };
      botStore.activeBot.forceexit(payload);
    },
  };
  msgBox.value?.show(msg);
};

function goToLogs() {
  const botId = botStore.selectedBot;
  router.push({ path: '/logs', query: { bot: botId } });
}
</script>

<template>
  <div class="bot-controls">
    <!-- Primary actions -->
    <div class="bc-group bc-primary">
      <button
        class="bc-btn bc-start"
        :disabled="!botStore.activeBot.isTrading || isRunning"
        :title="t('controls.startTrading')"
        @click="botStore.activeBot.startBot()"
      >
        <i-mdi-play class="bc-icon" />
        <span class="bc-label">Start</span>
      </button>
      <button
        class="bc-btn bc-stop"
        :disabled="!botStore.activeBot.isTrading || !isRunning"
        :title="t('controls.stopTrading')"
        @click="handleStopBot()"
      >
        <i-mdi-stop class="bc-icon" />
        <span class="bc-label">Stop</span>
      </button>
      <button
        class="bc-btn bc-pause"
        :disabled="!botStore.activeBot.isTrading || !isRunning"
        :title="t('controls.pause')"
        @click="handleStopBuy()"
      >
        <i-mdi-pause class="bc-icon" />
        <span class="bc-label">Pause</span>
      </button>
    </div>

    <!-- Secondary actions -->
    <div class="bc-sep" />
    <div class="bc-group bc-secondary">
      <button
        class="bc-btn bc-reload"
        :disabled="!botStore.activeBot.isTrading"
        :title="t('controls.reloadConfig')"
        @click="handleReloadConfig()"
      >
        <i-mdi-reload class="bc-icon" />
        <span class="bc-label">Config</span>
      </button>
      <button
        v-if="botStore.activeBot.botState && botStore.activeBot.botState.force_entry_enable"
        class="bc-btn bc-entry"
        :disabled="!botStore.activeBot.isTrading || !isRunning"
        :title="t('controls.forceEnter')"
        @click="forceEnter = true"
      >
        <i-mdi-plus-box-multiple-outline class="bc-icon" />
        <span class="bc-label">Entrée</span>
      </button>
      <button class="bc-btn bc-logs" :title="'Voir les logs'" @click="goToLogs()">
        <i-mdi-text-box-outline class="bc-icon" />
        <span class="bc-label">Logs</span>
      </button>
    </div>

    <!-- Danger zone -->
    <div class="bc-sep" />
    <div class="bc-group bc-danger">
      <button
        class="bc-btn bc-force-exit"
        :disabled="!botStore.activeBot.isTrading"
        :title="t('controls.forceExitAll')"
        @click="handleForceExit()"
      >
        <i-mdi-close-box-multiple class="bc-icon" />
        <span class="bc-label">Exit all</span>
      </button>
    </div>

    <ForceEntryForm v-model="forceEnter" :pair="botStore.activeBot.selectedPair" />
    <MessageBox ref="msgBox" />
  </div>
</template>

<style scoped>
.bot-controls {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-wrap: wrap;
}

.bc-group {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.bc-sep {
  width: 1px;
  height: 1.5rem;
  background: rgba(0, 0, 0, 0.1);
  margin: 0 0.25rem;
  flex-shrink: 0;
}
.ft-dark-theme .bc-sep {
  background: rgba(255, 255, 255, 0.1);
}

.bc-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.55rem;
  border-radius: 0.375rem;
  border: 1px solid transparent;
  font-size: 0.6875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  background: transparent;
  color: rgba(0, 0, 0, 0.6);
}
.ft-dark-theme .bc-btn {
  color: rgba(255, 255, 255, 0.55);
}

.bc-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.bc-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.bc-icon {
  width: 0.875rem;
  height: 0.875rem;
  flex-shrink: 0;
}

.bc-label {
  line-height: 1;
}

/* ── Start ── */
.bc-start {
  background: rgba(34, 197, 94, 0.08);
  border-color: rgba(34, 197, 94, 0.2);
  color: #16a34a;
}
.ft-dark-theme .bc-start {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.25);
  color: #4ade80;
}
.bc-start:hover:not(:disabled) {
  background: rgba(34, 197, 94, 0.15);
  border-color: rgba(34, 197, 94, 0.35);
}

/* ── Stop ── */
.bc-stop {
  background: rgba(239, 68, 68, 0.06);
  border-color: rgba(239, 68, 68, 0.15);
  color: #dc2626;
}
.ft-dark-theme .bc-stop {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.2);
  color: #f87171;
}
.bc-stop:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.3);
}

/* ── Pause ── */
.bc-pause {
  background: rgba(245, 158, 11, 0.06);
  border-color: rgba(245, 158, 11, 0.15);
  color: #d97706;
}
.ft-dark-theme .bc-pause {
  background: rgba(245, 158, 11, 0.08);
  border-color: rgba(245, 158, 11, 0.2);
  color: #fbbf24;
}
.bc-pause:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.3);
}

/* ── Reload config ── */
.bc-reload {
  background: rgba(99, 102, 241, 0.06);
  border-color: rgba(99, 102, 241, 0.15);
  color: #4f46e5;
}
.ft-dark-theme .bc-reload {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.2);
  color: #a5b4fc;
}
.bc-reload:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.12);
  border-color: rgba(99, 102, 241, 0.3);
}

/* ── Force entry ── */
.bc-entry {
  background: rgba(99, 102, 241, 0.06);
  border-color: rgba(99, 102, 241, 0.15);
  color: #4f46e5;
}
.ft-dark-theme .bc-entry {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.2);
  color: #a5b4fc;
}
.bc-entry:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.12);
  border-color: rgba(99, 102, 241, 0.3);
}

/* ── Logs ── */
.bc-logs {
  background: rgba(107, 114, 128, 0.06);
  border-color: rgba(107, 114, 128, 0.15);
  color: #4b5563;
}
.ft-dark-theme .bc-logs {
  background: rgba(156, 163, 175, 0.08);
  border-color: rgba(156, 163, 175, 0.15);
  color: #9ca3af;
}
.bc-logs:hover:not(:disabled) {
  background: rgba(107, 114, 128, 0.12);
  border-color: rgba(107, 114, 128, 0.3);
}

/* ── Force exit all (danger) ── */
.bc-force-exit {
  background: rgba(239, 68, 68, 0.06);
  border-color: rgba(239, 68, 68, 0.15);
  color: #dc2626;
}
.ft-dark-theme .bc-force-exit {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.2);
  color: #f87171;
}
.bc-force-exit:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.35);
}
</style>
