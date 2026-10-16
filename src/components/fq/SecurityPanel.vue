<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { ActionToast, Badge, FormRow } from '@/components/ds';
import type { ToastKind } from '@/components/ds';

/**
 * Settings > Action security (02 section 3.6, 5 and 11): the levels of confirmation and what each
 * one asks, the length of the hold (shown, not editable: one value for everyone, 1 s), and a
 * sample of every outcome an action can have, in the words the toasts use. Nothing here sends
 * anything; the samples are fixed text.
 */
const { t } = useI18n();

const LEVELS = ['reduce', 'dry', 'live', 'destructive'] as const;

interface Sample {
  id: string;
  kind: ToastKind;
  title: string;
  body: string;
  meta?: string;
}
const samples = computed<Sample[]>(() => [
  {
    id: 'accepted',
    kind: 'sent',
    title: t('fq.result.sent'),
    body: `${t('fq.pg.settings.sec.sampleBot')} · ${t('fq.result.acceptedAwaitFill')}`,
  },
  {
    id: 'filled',
    kind: 'ok',
    title: t('fq.result.filled'),
    body: t('fq.pg.settings.sec.sampleFilled'),
  },
  {
    id: 'unknown',
    kind: 'verify',
    title: t('fq.result.needsChecking'),
    body: t('fq.result.unknownBody'),
  },
  {
    id: 'rejected',
    kind: 'err',
    title: t('fq.result.rejected'),
    body: t('fq.result.nothingExecuted'),
  },
  {
    id: 'mismatch',
    kind: 'err',
    title: t('fq.result.mismatchTitle'),
    body: t('fq.result.mismatchBody'),
  },
  {
    id: 'inProgress',
    kind: 'verify',
    title: t('fq.result.inProgressTitle'),
    body: t('fq.result.inProgressBody'),
  },
  {
    id: 'session',
    kind: 'err',
    title: t('fq.result.sessionTitle'),
    body: t('fq.result.noReplay'),
  },
]);
</script>

<template>
  <div class="sp" data-testid="security-panel">
    <div class="wrap">
      <table>
        <thead>
          <tr>
            <th class="l">{{ t('fq.pg.settings.sec.level') }}</th>
            <th class="l">{{ t('fq.pg.settings.sec.gesture') }}</th>
            <th class="l">{{ t('fq.pg.settings.sec.applies') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in LEVELS" :key="l" :data-level="l">
            <td class="l">
              <Badge
                :kind="
                  l === 'destructive'
                    ? 'live'
                    : l === 'live'
                      ? 'live'
                      : l === 'dry'
                        ? 'dry'
                        : 'neutral'
                "
                :label="t(`fq.pg.settings.sec.lv.${l}`)"
              />
            </td>
            <td class="l">{{ t(`fq.pg.settings.sec.gest.${l}`) }}</td>
            <td class="l mut">{{ t(`fq.pg.settings.sec.what.${l}`) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <FormRow :label="t('fq.pg.settings.sec.hold')" :hint="t('fq.pg.settings.sec.holdHint')">
      <Badge kind="neutral" label="1 s" />
      <span class="mut">{{ t('fq.pg.settings.sec.fixed') }}</span>
    </FormRow>

    <h3>{{ t('fq.pg.settings.sec.outcomes') }}</h3>
    <p class="mut">{{ t('fq.pg.settings.sec.outcomesHint') }}</p>
    <div class="samples">
      <ActionToast
        v-for="s in samples"
        :key="s.id"
        :kind="s.kind"
        :title="s.title"
        :body="s.body"
        :data-sample="s.id"
        role="group"
        :aria-label="s.title"
      />
    </div>
  </div>
</template>

<style scoped>
.sp {
  display: grid;
  gap: var(--s2);
  min-width: 0;
}
.wrap {
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--t-sm);
}
th {
  height: 30px;
  padding: 0 8px;
  color: var(--fg-3);
  font-weight: 500;
  font-size: var(--t-xs);
}
td {
  padding: 8px;
  vertical-align: top;
  border-top: 1px solid var(--line);
}
.l {
  text-align: left;
}
.mut {
  color: var(--fg-3);
  font-size: var(--t-xs);
  margin: 0;
}
h3 {
  margin: var(--s2) 0 0;
  font-size: var(--t-md);
  font-weight: 600;
  color: var(--fg-2);
}
.samples :deep(.x) {
  display: none;
}
.samples {
  display: grid;
  gap: var(--s2);
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}
</style>
