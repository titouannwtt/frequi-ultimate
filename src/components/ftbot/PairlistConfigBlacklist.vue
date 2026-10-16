<script setup lang="ts">
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
const pairlistStore = usePairlistConfigStore();
const copyFromConfig = ref('');

const configNames = computed(() =>
  pairlistStore.savedConfigs.filter((c) => c.name !== pairlistStore.config.name).map((c) => c.name),
);
</script>
<template>
  <Panel toggleable :header="t('fq.pg.legacy.pairlist.blacklist')" collapsed>
    <div class="flex mb-4 items-center gap-2">
      <span class="col-auto">{{ t('fq.pg.legacy.pairlist.copyFrom') }}:</span>
      <Select v-model="copyFromConfig" size="small" class="grow" :options="configNames" />
      <Button
        :title="t('fq.pg.legacy.pairlist.copy')"
        size="small"
        severity="secondary"
        @click="pairlistStore.duplicateBlacklist(copyFromConfig)"
      >
        <template #icon>
          <i-mdi-content-copy />
        </template>
      </Button>
    </div>
    <InputGroup v-for="(item, i) in pairlistStore.config.blacklist" :key="i" class="mb-2" size="sm">
      <InputText v-model="pairlistStore.config.blacklist[i]" size="small" />
      <InputGroupAddon>
        <Button size="small" severity="secondary" @click="pairlistStore.removeFromBlacklist(i)">
          <template #icon>
            <i-mdi-close />
          </template>
        </Button>
      </InputGroupAddon>
    </InputGroup>
    <Button size="small" @click="pairlistStore.addToBlacklist()">{{
      t('fq.pg.legacy.pairlist.add')
    }}</Button>
  </Panel>
</template>
