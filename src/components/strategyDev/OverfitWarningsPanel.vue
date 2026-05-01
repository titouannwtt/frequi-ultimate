<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

interface OverfitWarning {
  severity: string;
  warning_type: string;
  title_en: string;
  title_fr: string;
  detail_en: string;
  detail_fr: string;
  actions_en: string[];
  actions_fr: string[];
  values: Record<string, unknown>;
}

defineProps<{ warnings: OverfitWarning[] }>();
const { locale } = useI18n();

const isFr = computed(() => locale.value.startsWith('fr'));

function getTitle(w: OverfitWarning) {
  return isFr.value ? w.title_fr : w.title_en;
}
function getDetail(w: OverfitWarning) {
  return isFr.value ? w.detail_fr : w.detail_en;
}
function getActions(w: OverfitWarning) {
  return isFr.value ? w.actions_fr : w.actions_en;
}

function severityClasses(s: string) {
  if (s === 'high') return 'border-red-500/40 bg-red-900/20 text-red-300';
  if (s === 'medium') return 'border-amber-500/40 bg-amber-900/20 text-amber-300';
  return 'border-blue-500/40 bg-blue-900/20 text-blue-300';
}

function severityIcon(s: string) {
  if (s === 'high') return '\uD83D\uDD34';
  if (s === 'medium') return '\uD83D\uDFE1';
  return '\uD83D\uDD35';
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      v-for="(w, i) in warnings"
      :key="i"
      class="rounded-lg border p-4"
      :class="severityClasses(w.severity)"
    >
      <div class="flex items-start gap-2">
        <span class="text-lg">{{ severityIcon(w.severity) }}</span>
        <div class="flex-1">
          <h4 class="font-semibold text-sm">{{ getTitle(w) }}</h4>
          <p class="text-sm opacity-80 mt-1">{{ getDetail(w) }}</p>
          <div v-if="w.values" class="flex flex-wrap gap-1.5 mt-2">
            <span
              v-for="(val, key) in w.values"
              :key="String(key)"
              class="text-sm px-2 py-0.5 rounded-full bg-surface-700/50 text-surface-300"
            >
              {{ key }}: {{ val }}
            </span>
          </div>
          <ul class="mt-2 space-y-1">
            <li
              v-for="(action, j) in getActions(w)"
              :key="j"
              class="text-sm opacity-70 flex items-start gap-1"
            >
              <span class="mt-0.5">&rarr;</span>
              <span>{{ action }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
