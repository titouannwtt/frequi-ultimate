<script setup lang="ts">
import { computed } from 'vue';

interface ParamStab {
  values: number[];
  mean: number;
  std: number;
  median: number;
  std_over_range: number;
  stable: boolean;
  unstable: boolean;
}

const props = defineProps<{ data: Record<string, ParamStab> }>();

const rows = computed(() =>
  Object.entries(props.data)
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => a.std_over_range - b.std_over_range),
);
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg overflow-hidden">
    <h4 class="text-sm font-semibold p-3 pb-0">Parameter Stability</h4>
    <div class="overflow-auto max-h-96">
      <table class="w-full text-sm">
        <thead class="bg-surface-900/50 sticky top-0">
          <tr>
            <th class="text-left px-3 py-2 text-xs text-surface-400 uppercase">Parameter</th>
            <th class="text-right px-3 py-2 text-xs text-surface-400 uppercase">Median</th>
            <th class="text-right px-3 py-2 text-xs text-surface-400 uppercase">Std</th>
            <th class="text-right px-3 py-2 text-xs text-surface-400 uppercase">Std/Range</th>
            <th class="text-center px-3 py-2 text-xs text-surface-400 uppercase">Status</th>
            <th class="px-3 py-2 text-xs text-surface-400 uppercase">Values</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in rows"
            :key="r.name"
            class="border-t border-surface-700 hover:bg-surface-700/30"
          >
            <td class="px-3 py-2 font-mono text-blue-400 text-xs">{{ r.name }}</td>
            <td class="px-3 py-2 text-right tabular-nums">{{ r.median.toFixed(4) }}</td>
            <td class="px-3 py-2 text-right tabular-nums">{{ r.std.toFixed(4) }}</td>
            <td
              class="px-3 py-2 text-right tabular-nums"
              :class="
                r.stable ? 'text-green-400' : r.unstable ? 'text-red-400' : 'text-amber-400'
              "
            >
              {{ r.std_over_range.toFixed(4) }}
            </td>
            <td class="px-3 py-2 text-center">
              <span
                class="text-xs px-2 py-0.5 rounded-full"
                :class="
                  r.stable
                    ? 'bg-green-900/30 text-green-400'
                    : r.unstable
                      ? 'bg-red-900/30 text-red-400'
                      : 'bg-amber-900/30 text-amber-400'
                "
              >
                {{ r.stable ? 'Stable' : r.unstable ? 'Unstable' : 'Mixed' }}
              </span>
            </td>
            <td class="px-3 py-2 text-xs text-surface-400 font-mono">
              {{ r.values.map((v) => v.toFixed(2)).join(', ') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
