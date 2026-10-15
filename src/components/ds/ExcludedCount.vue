<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import DsIcon from './DsIcon.vue';
import Popover from './Popover.vue';
import type { BotRef } from './types';

/**
 * "N excluded" next to a total: a stale or offline bot is never summed, and the list of the
 * excluded bots opens on click (docs/redesign/02-design.md, sections 10.1 and 12).
 */
defineProps<{ bots: BotRef[]; inline?: boolean }>();

const emit = defineEmits<{ select: [bot: BotRef] }>();

const { t } = useI18n();
const open = ref(false);
const anchor = ref<HTMLElement | null>(null);
</script>

<template>
  <span v-if="bots.length > 0" class="excl-wrap">
    <button
      ref="anchor"
      type="button"
      class="excl"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="open = !open"
    >
      <DsIcon name="triangle-alert" :size="13" />
      {{ t('fq.kpi.excluded', { n: bots.length }) }}
    </button>
    <Popover
      :open="open"
      :anchor="anchor"
      :label="t('fq.ds.excludedTitle', { n: bots.length })"
      :inline="inline"
      @close="open = false"
    >
      <h4>{{ t('fq.ds.excludedTitle', { n: bots.length }) }}</h4>
      <button
        v-for="bot in bots"
        :key="bot.key"
        type="button"
        class="mi"
        @click="
          emit('select', bot);
          open = false;
        "
      >
        <span class="nm">{{ bot.name }}</span>
        <span v-if="bot.reason" class="k">{{ bot.reason }}</span>
      </button>
      <hr />
      <p class="note">{{ t('fq.ds.excludedNote') }}</p>
    </Popover>
  </span>
</template>

<style scoped>
.excl {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--warn);
  font-family: var(--font-ui);
  font-size: var(--t-xs);
  border: 0;
  background: none;
  padding: 0;
  text-decoration: underline dotted;
  text-underline-offset: 2px;
  cursor: pointer;
  white-space: nowrap;
  position: relative;
}
h4 {
  margin: 4px 12px 6px;
  font-size: var(--t-xs);
  color: var(--fg-3);
  font-weight: 600;
}
.mi {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 12px;
  background: none;
  border: 0;
  text-align: left;
  color: var(--fg);
  font: inherit;
  font-size: var(--t-sm);
  cursor: pointer;
}
.mi:hover {
  background: var(--bg-2);
}
.nm {
  flex: 1;
  min-width: 0;
}
.k {
  color: var(--fg-3);
  font-size: var(--t-xs);
}
hr {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 5px 0;
}
.note {
  margin: 0;
  padding: 4px 12px;
  color: var(--fg-3);
  font-size: var(--t-xs);
}
@media (max-width: 599px), (pointer: coarse) {
  /* 44 px touch target around the small inline counter */
  .excl::before {
    content: '';
    position: absolute;
    inset: -14px -6px;
  }
  .mi {
    min-height: 44px;
  }
}
</style>
