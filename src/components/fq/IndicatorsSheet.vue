<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { AdaptiveSheet, DsIcon, EmptyState, Switch } from '@/components/ds';
import { useFqPrefsStore } from '@/datasource/stores/prefs';

import {
  plotTemplateNames,
  resolvePlotChoice,
  STRATEGY_PRESET,
  TEMPLATE_PREFIX,
} from './lib/chartsPage';

/**
 * The indicators of the Charts page (02 section 3.3): the plot of the context bot's strategy, the
 * presets migrated from the old `ftPlotConfig`, and the built-in templates (Bollinger bands, RSI,
 * MACD) layered on top of the strategy's. The choice is a preference (`plot`), synchronised with
 * the other devices; nothing is written to a bot.
 */
defineProps<{ open: boolean; inline?: boolean }>();
const rsi = defineModel<boolean>('rsi', { default: true });
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const prefs = useFqPrefsStore();

const current = computed(() => prefs.settings.plot?.plotConfigName ?? STRATEGY_PRESET);
const choice = computed(() =>
  resolvePlotChoice(current.value, prefs.settings.plot?.customPlotConfigs),
);
const customNames = computed(() =>
  Object.keys(prefs.settings.plot?.customPlotConfigs ?? {}).sort(),
);
const templates = computed(() => plotTemplateNames());

function isOn(name: string): boolean {
  if (name === STRATEGY_PRESET) return choice.value.kind === 'strategy';
  if (name.startsWith(TEMPLATE_PREFIX)) {
    return choice.value.kind === 'template' && `${TEMPLATE_PREFIX}${choice.value.name}` === name;
  }
  return choice.value.kind === 'custom' && choice.value.name === name;
}

function pick(name: string) {
  prefs.update('plot', {
    customPlotConfigs: prefs.settings.plot?.customPlotConfigs ?? {},
    plotConfigName: name,
  });
}
</script>

<template>
  <AdaptiveSheet
    :open="open"
    :title="t('fq.pg.charts.ind.title')"
    :inline="inline"
    @close="emit('close')"
  >
    <div class="ind" data-testid="indicators-sheet">
      <section>
        <h4>{{ t('fq.pg.charts.ind.base') }}</h4>
        <button
          type="button"
          role="radio"
          class="opt"
          :aria-checked="isOn(STRATEGY_PRESET)"
          @click="pick(STRATEGY_PRESET)"
        >
          <DsIcon v-if="isOn(STRATEGY_PRESET)" name="check" :size="15" />
          <span class="gap" v-else />
          <b>{{ t('fq.pg.charts.ind.strategy') }}</b>
          <small>{{ t('fq.pg.charts.ind.strategyHint') }}</small>
        </button>
      </section>

      <section>
        <h4>{{ t('fq.pg.charts.ind.mine') }}</h4>
        <EmptyState
          v-if="customNames.length === 0"
          icon="info"
          :title="t('fq.pg.charts.ind.noneMine')"
        />
        <button
          v-for="n in customNames"
          :key="n"
          type="button"
          role="radio"
          class="opt"
          :aria-checked="isOn(n)"
          @click="pick(n)"
        >
          <DsIcon v-if="isOn(n)" name="check" :size="15" />
          <span class="gap" v-else />
          <b>{{ n }}</b>
        </button>
        <p class="hint">{{ t('fq.pg.charts.ind.mineHint') }}</p>
      </section>

      <section>
        <h4>{{ t('fq.pg.charts.ind.templates') }}</h4>
        <button
          v-for="n in templates"
          :key="n"
          type="button"
          role="radio"
          class="opt"
          :aria-checked="isOn(TEMPLATE_PREFIX + n)"
          @click="pick(TEMPLATE_PREFIX + n)"
        >
          <DsIcon v-if="isOn(TEMPLATE_PREFIX + n)" name="check" :size="15" />
          <span class="gap" v-else />
          <b>{{ n }}</b>
          <small>{{ t('fq.pg.charts.ind.onTop') }}</small>
        </button>
      </section>

      <section class="row">
        <Switch v-model="rsi" :label="t('fq.pg.charts.ind.rsi')" />
      </section>
    </div>
  </AdaptiveSheet>
</template>

<style scoped>
.ind {
  display: grid;
  gap: var(--s4);
  padding: var(--s3);
  text-align: left;
}
h4 {
  margin: 0 0 var(--s1);
  font-size: var(--t-xs);
  color: var(--fg-3);
  font-weight: 600;
}
.opt {
  display: grid;
  grid-template-columns: 16px auto 1fr;
  align-items: center;
  gap: var(--s2);
  width: 100%;
  min-height: 44px;
  padding: 6px var(--s2);
  border: 0;
  border-bottom: 1px solid var(--line);
  background: none;
  color: var(--fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.opt:hover {
  background: var(--bg-2);
}
.opt[aria-checked='true'] {
  background: var(--accent-w);
}
.opt small {
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.gap {
  width: 14px;
}
.hint {
  margin: var(--s1) 0 0;
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.row {
  padding-top: var(--s2);
}
</style>
