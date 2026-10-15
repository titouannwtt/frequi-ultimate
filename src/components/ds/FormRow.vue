<script setup lang="ts">
import { useId } from 'vue';

defineProps<{
  label: string;
  hint?: string;
}>();

const id = useId();
</script>

<template>
  <div
    class="frow"
    role="group"
    :aria-labelledby="`${id}-l`"
    :aria-describedby="hint ? `${id}-h` : undefined"
  >
    <div class="txt">
      <span :id="`${id}-l`" class="l">{{ label }}</span>
      <span v-if="hint" :id="`${id}-h`" class="h">{{ hint }}</span>
    </div>
    <div class="ctl"><slot /></div>
  </div>
</template>

<style scoped>
.frow {
  display: flex;
  align-items: center;
  gap: var(--s4);
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
  font-family: var(--font-ui);
}
.txt {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}
.l {
  font-size: var(--t-md);
  font-weight: 500;
}
.h {
  font-size: var(--t-xs);
  color: var(--fg-3);
}
.ctl {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s2);
  max-width: 55%;
}
@media (max-width: 599px) {
  .frow {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }
  .ctl {
    max-width: none;
  }
}
</style>
