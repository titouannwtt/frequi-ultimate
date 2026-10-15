<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const { mode, cycle } = useTheme();

withDefaults(defineProps<{ showText?: boolean }>(), { showText: false });

const label = computed(() => t(`fq.theme.${mode.value}`));
</script>

<template>
  <Button
    variant="link"
    :title="t('fq.theme.cycle', { mode: label })"
    :aria-label="t('fq.theme.cycle', { mode: label })"
    class="text-surface-200"
    :label="showText ? label : ''"
    @click="cycle"
  >
    <template #icon>
      <i-lucide-monitor v-if="mode === 'system'" class="ico" />
      <i-lucide-moon v-else-if="mode === 'dark'" class="ico" />
      <i-lucide-sun v-else class="ico" />
    </template>
  </Button>
</template>
