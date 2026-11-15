<script setup lang="ts">
import type { Lock } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const botStore = useBotStore();

function removePairLock(item: Lock) {
  console.log(item);
  if (item.id !== undefined) {
    botStore.activeBot.deleteLock(item.id);
  } else {
    showAlert('This Freqtrade version does not support deleting locks.');
  }
}
</script>

<template>
  <div>
    <div class="mb-2">
      <label class="me-auto text-xl">{{ t('pairLocks.title') }}</label>
      <Button class="float-end" severity="secondary" @click="botStore.activeBot.getLocks">
        <template #icon>
          <i-mdi-refresh />
        </template>
      </Button>
    </div>
    <div>
      <DataTable
        size="small"
        :value="botStore.activeBot.activeLocks"
        scrollable
        scroll-height="flex"
      >
        <Column field="pair" :header="t('pairLocks.pair')" sortable>
          <template #body="{ data }">
            <span class="font-semibold text-xs">{{ data.pair }}</span>
          </template>
        </Column>
        <Column field="lock_end_timestamp" :header="t('pairLocks.until')" sortable>
          <template #body="{ data }">
            <span class="font-mono text-xs text-surface-500">
              {{ timestampms(data.lock_end_timestamp) }}
            </span>
          </template>
        </Column>
        <Column field="reason" :header="t('pairLocks.reason')">
          <template #body="{ data }">
            <span
              class="inline-block px-1.5 py-0.5 rounded text-xs font-mono bg-amber-500/10 text-amber-500 dark:text-amber-400"
            >
              {{ data.reason }}
            </span>
          </template>
        </Column>
        <Column field="actions" :header="t('pairLocks.actions')">
          <template #body="{ data }">
            <Button
              size="small"
              severity="danger"
              text
              rounded
              :title="t('pairLocks.deleteLock')"
              @click="removePairLock(data as Lock)"
            >
              <template #icon>
                <i-mdi-delete />
              </template>
            </Button>
          </template>
        </Column>
      </DataTable>
    </div>
  </div>
</template>
