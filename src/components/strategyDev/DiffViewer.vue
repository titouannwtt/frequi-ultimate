<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  saved: string;
  current: string | null;
  hasChanges: boolean;
  savedLabel: string;
  currentLabel: string;
}>();

const { t } = useI18n();

interface DiffLine {
  type: 'context' | 'add' | 'remove';
  lineOld: number | null;
  lineNew: number | null;
  text: string;
}

const diffLines = computed<DiffLine[]>(() => {
  if (props.current === null) {
    return props.saved.split('\n').map((text, i) => ({
      type: 'remove' as const,
      lineOld: i + 1,
      lineNew: null,
      text,
    }));
  }
  if (!props.hasChanges) return [];
  return simpleDiff(props.saved, props.current);
});

function simpleDiff(a: string, b: string): DiffLine[] {
  const linesA = a.split('\n');
  const linesB = b.split('\n');
  const result: DiffLine[] = [];
  const maxLen = Math.max(linesA.length, linesB.length);
  let lineOld = 0;
  let lineNew = 0;

  for (let i = 0; i < maxLen; i++) {
    const la = i < linesA.length ? linesA[i] : undefined;
    const lb = i < linesB.length ? linesB[i] : undefined;

    if (la === lb) {
      lineOld++;
      lineNew++;
      result.push({ type: 'context', lineOld, lineNew, text: la ?? '' });
    } else {
      if (la !== undefined) {
        lineOld++;
        result.push({ type: 'remove', lineOld, lineNew: null, text: la });
      }
      if (lb !== undefined) {
        lineNew++;
        result.push({ type: 'add', lineOld: null, lineNew, text: lb });
      }
    }
  }
  return result;
}
</script>

<template>
  <div>
    <div class="flex items-center gap-2 mb-2 text-sm">
      <Tag :value="savedLabel" severity="danger" class="text-xs" />
      <span class="text-surface-400">vs</span>
      <Tag :value="currentLabel" severity="success" class="text-xs" />
    </div>

    <div v-if="current === null" class="mb-2">
      <Message severity="warn" :closable="false" class="text-xs">
        {{ t('strategyDev.fileDeleted') }}
      </Message>
    </div>

    <div v-else-if="!hasChanges" class="mb-2">
      <Message severity="info" :closable="false" class="text-xs">
        {{ t('strategyDev.noDiff') }}
      </Message>
    </div>

    <div v-if="diffLines.length" class="bg-surface-900 rounded-lg overflow-auto max-h-[60vh]">
      <table class="w-full text-xs font-mono">
        <tbody>
          <tr
            v-for="(line, i) in diffLines"
            :key="i"
            :class="{
              'bg-red-900/30': line.type === 'remove',
              'bg-green-900/30': line.type === 'add',
            }"
          >
            <td
              class="text-right pr-1 pl-2 py-0 text-surface-500 select-none w-1 whitespace-nowrap"
            >
              {{ line.lineOld ?? '' }}
            </td>
            <td class="text-right pr-2 py-0 text-surface-500 select-none w-1 whitespace-nowrap">
              {{ line.lineNew ?? '' }}
            </td>
            <td
              class="px-1 py-0 w-1 select-none"
              :class="{
                'text-red-400': line.type === 'remove',
                'text-green-400': line.type === 'add',
              }"
            >
              {{ line.type === 'remove' ? '-' : line.type === 'add' ? '+' : ' ' }}
            </td>
            <td class="pr-4 py-0 text-surface-200 whitespace-pre">{{ line.text }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
