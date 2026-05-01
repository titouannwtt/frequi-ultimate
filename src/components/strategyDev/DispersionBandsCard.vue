<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

interface BandData {
  min: number;
  median: number;
  max: number;
}

interface DispersionData {
  profit: BandData | null;
  drawdown: BandData | null;
  sharpe: BandData | null;
}

const props = defineProps<{ data: DispersionData }>();

const { t } = useI18n();

type SpreadLevel = 'narrow' | 'moderate' | 'wide';

function getSpreadLevel(band: BandData): SpreadLevel {
  const range = band.max - band.min;
  const medianAbs = Math.abs(band.median);
  if (medianAbs < 0.0001) return 'wide';
  const ratio = range / medianAbs;
  if (ratio < 0.3) return 'narrow';
  if (ratio < 0.6) return 'moderate';
  return 'wide';
}

const spreadColors: Record<SpreadLevel, { bar: string; text: string; bg: string }> = {
  narrow: { bar: '#a6e3a1', text: '#a6e3a1', bg: 'rgba(166, 227, 161, 0.15)' },
  moderate: { bar: '#f9e2af', text: '#f9e2af', bg: 'rgba(249, 226, 175, 0.15)' },
  wide: { bar: '#f38ba8', text: '#f38ba8', bg: 'rgba(243, 139, 168, 0.15)' },
};

interface BandItem {
  label: string;
  band: BandData;
  unit: string;
  spread: SpreadLevel;
  bandLeft: number;
  bandWidth: number;
  medianPos: number;
}

const bands = computed<BandItem[]>(() => {
  const items: BandItem[] = [];
  const entries: { label: string; band: BandData | null; unit: string }[] = [
    { label: t('strategyDev.dispersionProfit'), band: props.data.profit, unit: '%' },
    { label: t('strategyDev.dispersionDrawdown'), band: props.data.drawdown, unit: '%' },
    { label: t('strategyDev.dispersionSharpe'), band: props.data.sharpe, unit: '' },
  ];

  for (const e of entries) {
    if (!e.band) continue;
    const { min, median, max } = e.band;
    const range = max - min;
    const spread = getSpreadLevel(e.band);

    // Scale: add 25% padding on each side for visual breathing room
    const padding = range > 0 ? range * 0.25 : Math.abs(median) * 0.5 || 1;
    const scaleMin = min - padding;
    const scaleMax = max + padding;
    const scaleRange = scaleMax - scaleMin;

    const bandLeft = ((min - scaleMin) / scaleRange) * 100;
    const bandRight = ((max - scaleMin) / scaleRange) * 100;
    const bandWidth = bandRight - bandLeft;
    const medianPos = ((median - scaleMin) / scaleRange) * 100;

    items.push({ label: e.label, band: e.band, unit: e.unit, spread, bandLeft, bandWidth, medianPos });
  }
  return items;
});

const advisoryLevel = computed(() => {
  const spreads = bands.value.map((b) => b.spread);
  if (spreads.some((s) => s === 'wide')) return 'red';
  if (spreads.some((s) => s === 'moderate')) return 'yellow';
  return 'green';
});

const advisoryText = computed(() => {
  if (advisoryLevel.value === 'green')
    return t('strategyDev.dispersionConsistent');
  if (advisoryLevel.value === 'yellow')
    return t('strategyDev.dispersionModerateAdvisory');
  return t('strategyDev.dispersionHighVariance');
});
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-4">
    <h4 class="text-sm font-semibold mb-3 flex items-center gap-2">
      {{ t('strategyDev.dispersionTitle') }}
      <InfoTip :text="t('strategyDev.hintDispersion')" />
    </h4>

    <div class="space-y-5">
      <div v-for="b in bands" :key="b.label">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-sm font-medium text-surface-300">{{ b.label }}</span>
          <span
            class="text-sm px-1.5 py-0.5 rounded"
            :style="{
              color: spreadColors[b.spread].text,
              background: spreadColors[b.spread].bg,
            }"
          >
            {{ t(`strategyDev.dispersion${b.spread.charAt(0).toUpperCase() + b.spread.slice(1)}`) }}
          </span>
        </div>

        <div class="relative h-7 rounded-full" style="background: rgba(255, 255, 255, 0.06)">
          <!-- Min-Max range band -->
          <div
            class="absolute h-full rounded-full"
            :style="{
              left: b.bandLeft + '%',
              width: b.bandWidth + '%',
              backgroundColor: spreadColors[b.spread].bar,
              opacity: 0.25,
            }"
          />
          <!-- Median dot -->
          <div
            class="absolute top-1/2 w-3.5 h-3.5 rounded-full border-2"
            :style="{
              left: b.medianPos + '%',
              transform: 'translate(-50%, -50%)',
              backgroundColor: spreadColors[b.spread].bar,
              borderColor: '#1e1e2e',
            }"
          />
        </div>

        <div class="flex justify-between text-sm mt-1">
          <span class="text-surface-500 tabular-nums"
            >{{ b.band.min.toFixed(2) }}{{ b.unit }}</span
          >
          <span class="font-medium tabular-nums" :style="{ color: spreadColors[b.spread].text }"
            >{{ t('strategyDev.median') }}: {{ b.band.median.toFixed(2) }}{{ b.unit }}</span
          >
          <span class="text-surface-500 tabular-nums"
            >{{ b.band.max.toFixed(2) }}{{ b.unit }}</span
          >
        </div>
      </div>
    </div>

    <div
      class="mt-4 px-3 py-2 rounded text-sm font-medium"
      :style="{
        background:
          advisoryLevel === 'green'
            ? 'rgba(166, 227, 161, 0.12)'
            : advisoryLevel === 'yellow'
              ? 'rgba(249, 226, 175, 0.12)'
              : 'rgba(243, 139, 168, 0.12)',
        color:
          advisoryLevel === 'green'
            ? '#a6e3a1'
            : advisoryLevel === 'yellow'
              ? '#f9e2af'
              : '#f38ba8',
        border: `1px solid ${advisoryLevel === 'green' ? 'rgba(166,227,161,0.3)' : advisoryLevel === 'yellow' ? 'rgba(249,226,175,0.3)' : 'rgba(243,139,168,0.3)'}`,
      }"
    >
      {{ advisoryText }}
    </div>
  </div>
</template>
