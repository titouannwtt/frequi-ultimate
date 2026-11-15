<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const botStore = useBotStore();
const autoRefreshLoc = computed({
  get() {
    return botStore.globalAutoRefresh;
  },
  set(newValue: boolean) {
    botStore.setGlobalAutoRefresh(newValue);
  },
});
</script>

<template>
  <div class="flex items-center ms-2">
    <BaseCheckbox v-model="autoRefreshLoc" size="small" :title="t('general.autoRefresh')" />
    <Button
      class="m-1"
      severity="contrast"
      variant="outlined"
      size="small"
      :title="t('general.autoRefreshAll')"
      @click="botStore.allRefreshFull"
    >
      <template #icon>
        <i-mdi-refresh />
      </template>
    </Button>
  </div>
</template>
