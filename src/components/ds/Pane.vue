<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AgeBadge from './AgeBadge.vue';
import DsIcon from './DsIcon.vue';
import EmptyState from './EmptyState.vue';
import { ageMs, isStale } from './lib/freshness';
import { useNowMs } from './lib/useNowMs';
import Skeleton from './Skeleton.vue';
import type { DsIconRef, FreshnessInfo, PaneState } from './types';

/**
 * Widget shell (WidgetShell): header, tools, and the six states of a panel
 * (docs/redesign/02-design.md, section 10.1). On an error or when stale it keeps the last values
 * on screen, marked stale, and adds the cause; it never goes blank.
 */
const props = withDefaults(
  defineProps<{
    title: string;
    icon?: DsIconRef;
    meta?: string;
    freshness?: FreshnessInfo;
    state?: PaneState;
    /** Why the panel is unavailable (direct mode, missing endpoint). */
    unavailableReason?: string;
    /** Cause of the error (timeout, 401, 5xx), shown above the kept values. */
    errorMessage?: string;
    /** False when there is nothing to keep on screen: an error then replaces the content. */
    hasData?: boolean;
    emptyTitle?: string;
    emptyHint?: string;
    emptyIcon?: DsIconRef;
    /** Skeleton rows while loading. */
    skeletonShape?: 'line' | 'kpi' | 'row';
    /** Add padding around the body. */
    padded?: boolean;
  }>(),
  { state: 'ready', hasData: true, skeletonShape: 'row' },
);

const { t } = useI18n();
const clock = useNowMs();

const timeStale = computed(
  () =>
    props.freshness !== undefined &&
    isStale(
      ageMs(props.freshness.asOfMs, clock.value, props.freshness.clockSkewMs ?? 0),
      props.freshness.staleAfterMs,
    ),
);

/** A ready panel whose data got older than its threshold is rendered as stale. */
const effective = computed<PaneState>(() =>
  props.state === 'ready' && timeStale.value ? 'stale' : props.state,
);

const keepsContent = computed(
  () =>
    effective.value === 'ready' ||
    effective.value === 'stale' ||
    (effective.value === 'error' && props.hasData),
);
const marked = computed(() => effective.value === 'stale' || effective.value === 'error');
</script>

<template>
  <section
    class="pane"
    :class="[`st-${effective}`]"
    :aria-busy="effective === 'loading' || undefined"
  >
    <header class="ph">
      <h2>
        <DsIcon v-if="icon" :name="icon" />
        {{ title }}
      </h2>
      <span v-if="meta" class="meta">{{ meta }}</span>
      <AgeBadge
        v-if="freshness"
        :as-of-ms="freshness.asOfMs"
        :stale-after-ms="freshness.staleAfterMs"
        :clock-skew-ms="freshness.clockSkewMs"
      />
      <div v-if="$slots.tools" class="tools"><slot name="tools" /></div>
    </header>
    <div class="pb" :class="{ pad: padded, marked }">
      <div v-if="effective === 'error'" class="err" role="alert">
        <DsIcon name="triangle-alert" :size="13" />
        <span>
          {{ t('fq.ds.pane.error') }}
          <template v-if="errorMessage">&middot; {{ errorMessage }}</template>
          <template v-if="hasData">&middot; {{ t('fq.ds.pane.lastValues') }}</template>
        </span>
      </div>
      <div v-else-if="effective === 'stale'" class="err stale" role="status">
        <DsIcon name="history" :size="13" />
        <span>{{ t('fq.ds.pane.stale') }}</span>
      </div>
      <slot v-if="keepsContent" />
      <div v-else-if="effective === 'loading'" class="loading">
        <slot name="skeleton"><Skeleton :shape="skeletonShape" :count="4" /></slot>
        <span class="sr">{{ t('fq.ds.loading') }}</span>
      </div>
      <slot v-else-if="effective === 'empty'" name="empty">
        <EmptyState
          :icon="emptyIcon ?? 'info'"
          :title="emptyTitle ?? t('fq.ds.pane.empty')"
          :hint="emptyHint"
        />
      </slot>
      <EmptyState
        v-else-if="effective === 'unavailable'"
        icon="cable"
        :title="t('fq.connection.unavailableDirect')"
        :hint="unavailableReason"
      />
      <EmptyState
        v-else-if="effective === 'error'"
        icon="triangle-alert"
        :title="t('fq.ds.pane.error')"
        :hint="errorMessage"
      />
    </div>
  </section>
</template>

<style scoped>
.pane {
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  container-type: inline-size;
}
.ph {
  display: flex;
  align-items: center;
  gap: var(--s2);
  min-height: 38px;
  padding: 4px var(--s2) 4px var(--s3);
  border-bottom: 1px solid var(--line);
  flex: none;
}
h2 {
  margin: 0;
  font-size: var(--t-md);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}
h2 :deep(.ico) {
  color: var(--fg-3);
}
.meta {
  color: var(--fg-3);
  font-size: var(--t-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tools {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}
.pb {
  flex: 1;
  min-height: 0;
  overflow: auto;
  position: relative;
}
.pb.pad {
  padding: var(--s3);
}
/* Kept values of a stale or failed panel: amber hatch and neutral figures */
.pb.marked {
  background-image: var(--stale-hatch);
}
.pb.marked :deep(.up),
.pb.marked :deep(.down) {
  color: var(--fg-3);
}
.err {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px var(--s3);
  font-size: var(--t-xs);
  color: var(--warn);
  background: var(--warn-w);
  border-bottom: 1px solid var(--line);
}
.loading {
  padding: var(--s3);
}
@media (max-width: 599px) {
  .meta {
    display: none;
  }
}
</style>
