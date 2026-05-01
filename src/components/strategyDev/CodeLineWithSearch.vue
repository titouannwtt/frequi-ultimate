<script setup lang="ts">
interface Token {
  text: string;
  cls: string;
}

interface MatchRange {
  start: number;
  end: number;
  active: boolean;
}

const props = defineProps<{
  tokens: Token[];
  matches: MatchRange[];
  lineText: string;
}>();

interface RenderSegment {
  text: string;
  cls: string;
  hlClass: string;
}

const segments = computed<RenderSegment[]>(() => {
  const result: RenderSegment[] = [];
  let charPos = 0;

  for (const tok of props.tokens) {
    const tokStart = charPos;
    const tokEnd = charPos + tok.text.length;
    let pos = tokStart;

    for (const m of props.matches) {
      if (m.end <= tokStart || m.start >= tokEnd) continue;
      const hlStart = Math.max(m.start, tokStart);
      const hlEnd = Math.min(m.end, tokEnd);

      if (hlStart > pos) {
        result.push({ text: tok.text.slice(pos - tokStart, hlStart - tokStart), cls: tok.cls, hlClass: '' });
      }
      result.push({
        text: tok.text.slice(hlStart - tokStart, hlEnd - tokStart),
        cls: tok.cls,
        hlClass: m.active ? 'cv-search-hl cv-search-hl--active' : 'cv-search-hl',
      });
      pos = hlEnd;
    }

    if (pos < tokEnd) {
      result.push({ text: tok.text.slice(pos - tokStart), cls: tok.cls, hlClass: '' });
    }

    charPos = tokEnd;
  }

  return result;
});
</script>

<template>
  <span v-for="(seg, i) in segments" :key="i" :class="[seg.cls, seg.hlClass]">{{ seg.text }}</span>
</template>
