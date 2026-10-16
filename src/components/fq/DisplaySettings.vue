<script setup lang="ts">
import { computed } from 'vue';
import { useLocalStorage } from '@vueuse/core';
import { useI18n } from 'vue-i18n';

import { FormRow, SegmentedControl, Switch } from '@/components/ds';
import type { SegmentOption } from '@/components/ds';
import { useDisplayPrefs, type MotionPref } from '@/composables/useDisplayPrefs';
import { useTheme } from '@/composables/useTheme';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { Tz } from '@/gateway/types.gen';
import { loadLanguage } from '@/locales';
import type { Locale } from '@/migration/schema';
import type { ThemeMode } from '@/types';

/**
 * Settings > Display (02 section 3.6, 3): language, theme, density, the time zone that cuts the
 * days of the P&L, the colour-blind palette, reduced motion and the defaults of the charts. Each
 * control applies at once. The options that belong to the preferences (language, time zone, charts)
 * are saved with them and, for the zone, shared between devices through the gateway; theme,
 * density, palette and motion stay on this device.
 */
type Density = 'compact' | 'comfortable';

const { t, locale } = useI18n();
const prefs = useFqPrefsStore();
const theme = useTheme();
const settingsStore = useSettingsStore();
const { cvd, motion } = useDisplayPrefs();
const density = useLocalStorage<Density>('fqu2.density', 'compact');

const langs = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
] satisfies SegmentOption<Locale>[];
const themes = computed<SegmentOption<ThemeMode>[]>(() => [
  { value: 'dark', label: t('fq.theme.dark') },
  { value: 'light', label: t('fq.theme.light') },
  { value: 'system', label: t('fq.theme.system') },
]);
const densities = computed<SegmentOption<Density>[]>(() => [
  { value: 'compact', label: t('fq.pg.settings.disp.compact') },
  { value: 'comfortable', label: t('fq.pg.settings.disp.comfortable') },
]);
const zones = computed<SegmentOption<Tz>[]>(() => [
  { value: 'Europe/Paris', label: t('fq.pg.settings.disp.paris') },
  { value: 'UTC', label: 'UTC' },
]);
const sides = computed<SegmentOption<'left' | 'right'>[]>(() => [
  { value: 'left', label: t('fq.pg.settings.disp.left') },
  { value: 'right', label: t('fq.pg.settings.disp.right') },
]);
const counts = [100, 250, 500, 1000].map((n) => ({ value: n, label: String(n) }));

function setLocale(l: Locale) {
  void loadLanguage(l);
  prefs.update('locale', l);
}
function setZone(tz: Tz) {
  prefs.update('tz', tz);
  // The legacy pages cut their days with their own setting
  settingsStore.timezone = tz;
}
function setUi<K extends keyof typeof prefs.settings.ui>(key: K, value: (typeof prefs.settings.ui)[K]) {
  prefs.update('ui', { ...prefs.settings.ui, [key]: value });
}
const reduce = computed({
  get: () => motion.value === 'reduce',
  set: (v: boolean) => (motion.value = (v ? 'reduce' : 'system') as MotionPref),
});
</script>

<template>
  <div class="dp" data-testid="display-settings">
    <FormRow :label="t('fq.pg.settings.disp.language')">
      <SegmentedControl
        :model-value="locale as Locale"
        :options="langs"
        size="sm"
        :label="t('fq.pg.settings.disp.language')"
        @update:model-value="setLocale"
      />
    </FormRow>
    <FormRow :label="t('fq.pg.settings.disp.theme')">
      <SegmentedControl
        :model-value="theme.mode.value"
        :options="themes"
        size="sm"
        :label="t('fq.pg.settings.disp.theme')"
        @update:model-value="(m) => theme.setMode(m)"
      />
    </FormRow>
    <FormRow :label="t('fq.pg.settings.disp.density')" :hint="t('fq.pg.settings.disp.densityHint')">
      <SegmentedControl
        v-model="density"
        :options="densities"
        size="sm"
        :label="t('fq.pg.settings.disp.density')"
      />
    </FormRow>
    <FormRow :label="t('fq.pg.settings.disp.tz')" :hint="t('fq.pg.settings.disp.tzHint')">
      <SegmentedControl
        :model-value="prefs.settings.tz"
        :options="zones"
        size="sm"
        :label="t('fq.pg.settings.disp.tz')"
        @update:model-value="setZone"
      />
    </FormRow>
    <FormRow :label="t('fq.pg.settings.disp.cvd')" :hint="t('fq.pg.settings.disp.cvdHint')">
      <Switch v-model="cvd" hide-label :label="t('fq.pg.settings.disp.cvd')" data-testid="set-cvd" />
    </FormRow>
    <FormRow :label="t('fq.pg.settings.disp.motion')" :hint="t('fq.pg.settings.disp.motionHint')">
      <Switch v-model="reduce" hide-label :label="t('fq.pg.settings.disp.motion')" data-testid="set-motion" />
    </FormRow>

    <h3>{{ t('fq.pg.settings.disp.charts') }}</h3>
    <FormRow :label="t('fq.pg.settings.disp.ha')" :hint="t('fq.pg.settings.disp.haHint')">
      <Switch
        hide-label
        :model-value="prefs.settings.ui.useHeikinAshiCandles"
        :label="t('fq.pg.settings.disp.ha')"
        @update:model-value="(v) => setUi('useHeikinAshiCandles', v)"
      />
    </FormRow>
    <FormRow :label="t('fq.pg.settings.disp.labelSide')">
      <SegmentedControl
        :model-value="prefs.settings.ui.chartLabelSide"
        :options="sides"
        size="sm"
        :label="t('fq.pg.settings.disp.labelSide')"
        @update:model-value="(v) => setUi('chartLabelSide', v)"
      />
    </FormRow>
    <FormRow :label="t('fq.pg.settings.disp.candles')" :hint="t('fq.pg.settings.disp.candlesHint')">
      <SegmentedControl
        :model-value="prefs.settings.ui.chartDefaultCandleCount"
        :options="counts"
        size="sm"
        :label="t('fq.pg.settings.disp.candles')"
        @update:model-value="(v) => setUi('chartDefaultCandleCount', v)"
      />
    </FormRow>
  </div>
</template>

<style scoped>
h3 {
  margin: var(--s3) 0 0;
  padding-top: var(--s2);
  font-size: var(--t-md);
  font-weight: 600;
  color: var(--fg-2);
}
</style>
