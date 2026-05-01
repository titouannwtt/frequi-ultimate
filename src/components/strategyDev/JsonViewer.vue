<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  data: Record<string, unknown> | unknown[] | unknown;
  maxDepth?: number;
  root?: boolean;
}>();

const { t } = useI18n();
const copied = ref(false);

const jsonString = computed(() => {
  try {
    return JSON.stringify(props.data, null, 2);
  } catch {
    return String(props.data);
  }
});

async function copyJson() {
  await navigator.clipboard.writeText(jsonString.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}

function colorClass(val: unknown): string {
  if (val === null) return 'text-gray-400';
  if (typeof val === 'boolean') return 'text-orange-400';
  if (typeof val === 'number') return 'text-blue-400';
  if (typeof val === 'string') return 'text-green-400';
  return '';
}

function formatValue(val: unknown): string {
  if (val === null) return 'null';
  if (typeof val === 'string') return `"${val}"`;
  return String(val);
}

const entries = computed(() => {
  if (typeof props.data !== 'object' || props.data === null) return [];
  if (Array.isArray(props.data)) {
    return props.data.map((v, i) => ({ key: String(i), value: v }));
  }
  return Object.entries(props.data as Record<string, unknown>).map(([k, v]) => ({
    key: k,
    value: v,
  }));
});

function isExpandable(val: unknown): boolean {
  return typeof val === 'object' && val !== null;
}

const expandedKeys = ref<Set<string>>(new Set());

function toggle(key: string) {
  if (expandedKeys.value.has(key)) {
    expandedKeys.value.delete(key);
  } else {
    expandedKeys.value.add(key);
  }
}
</script>

<template>
  <div>
    <div v-if="root !== false" class="flex justify-end mb-1">
      <Button
        :label="copied ? t('strategyDev.copied') : t('strategyDev.copyJson')"
        :severity="copied ? 'success' : 'secondary'"
        size="small"
        variant="text"
        @click="copyJson"
      >
        <template #icon>
          <i-mdi-check v-if="copied" class="w-3 h-3" />
          <i-mdi-content-copy v-else class="w-3 h-3" />
        </template>
      </Button>
    </div>

    <div class="font-mono text-sm leading-5">
      <div v-for="entry in entries" :key="entry.key">
        <template v-if="isExpandable(entry.value)">
          <button
            class="flex items-start gap-1 cursor-pointer hover:bg-surface-200 dark:hover:bg-surface-700 rounded px-1 w-full text-left"
            @click="toggle(entry.key)"
          >
            <i-mdi-chevron-right
              v-if="!expandedKeys.has(entry.key)"
              class="w-3 h-3 mt-0.5 shrink-0"
            />
            <i-mdi-chevron-down v-else class="w-3 h-3 mt-0.5 shrink-0" />
            <span class="text-purple-400">"{{ entry.key }}"</span>
            <span class="text-surface-400">:</span>
            <span v-if="!expandedKeys.has(entry.key)" class="text-surface-400 truncate">
              {{ Array.isArray(entry.value) ? `[${(entry.value as unknown[]).length}]` : '{...}' }}
            </span>
          </button>
          <div
            v-if="expandedKeys.has(entry.key)"
            class="ml-4 border-l border-surface-300 dark:border-surface-600 pl-2"
          >
            <JsonViewer :data="entry.value as Record<string, unknown>" :root="false" />
          </div>
        </template>
        <template v-else>
          <div class="px-1 ml-4 flex">
            <span class="text-purple-400">"{{ entry.key }}"</span>
            <span class="text-surface-400">:&nbsp;</span>
            <span :class="colorClass(entry.value)">{{ formatValue(entry.value) }}</span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
