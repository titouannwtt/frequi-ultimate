<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  code: string;
  language?: string;
  maxHeight?: string;
}>();

// ── State ──
const copied = ref(false);
const fontSize = ref(13);
const highlightedLines = ref<Set<number>>(new Set());
const searchOpen = ref(false);
const searchQuery = ref('');
const searchMatchIndex = ref(0);
const searchInputRef = ref<HTMLInputElement | null>(null);
const codeScrollRef = ref<HTMLElement | null>(null);
const foldedRanges = ref<Set<number>>(new Set());

// ── Copy ──
async function copyCode() {
  try {
    await navigator.clipboard.writeText(props.code);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = props.code;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}

// ── Font size ──
function changeFontSize(delta: number) {
  fontSize.value = Math.max(10, Math.min(20, fontSize.value + delta));
}

// ── Line highlight ──
function toggleLineHighlight(lineNum: number) {
  const s = new Set(highlightedLines.value);
  if (s.has(lineNum)) s.delete(lineNum);
  else s.add(lineNum);
  highlightedLines.value = s;
}

// ── Tokenizer ──
interface Token {
  text: string;
  cls: string;
}

const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
  'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
  'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
  'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
  'try', 'while', 'with', 'yield',
]);

const PY_BUILTINS = new Set([
  'abs', 'all', 'any', 'bin', 'bool', 'bytes', 'callable', 'chr',
  'classmethod', 'compile', 'complex', 'dict', 'dir', 'divmod',
  'enumerate', 'eval', 'exec', 'filter', 'float', 'format', 'frozenset',
  'getattr', 'globals', 'hasattr', 'hash', 'hex', 'id', 'input', 'int',
  'isinstance', 'issubclass', 'iter', 'len', 'list', 'locals', 'map',
  'max', 'min', 'next', 'object', 'oct', 'open', 'ord', 'pow', 'print',
  'property', 'range', 'repr', 'reversed', 'round', 'set', 'setattr',
  'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super', 'tuple',
  'type', 'vars', 'zip', 'self',
]);

function tokenizePython(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    if (line[i] === '#') {
      tokens.push({ text: line.slice(i), cls: 'tk-comment' });
      break;
    }

    if (line[i] === '@' && (i === 0 || /\s/.test(line[i - 1]))) {
      const m = line.slice(i).match(/^@[\w.]+/);
      if (m) {
        tokens.push({ text: m[0], cls: 'tk-decorator' });
        i += m[0].length;
        continue;
      }
    }

    if (line.slice(i, i + 3) === '"""' || line.slice(i, i + 3) === "'''") {
      const q = line.slice(i, i + 3);
      const end = line.indexOf(q, i + 3);
      if (end >= 0) {
        tokens.push({ text: line.slice(i, end + 3), cls: 'tk-string' });
        i = end + 3;
      } else {
        tokens.push({ text: line.slice(i), cls: 'tk-string' });
        break;
      }
      continue;
    }

    if (line[i] === '"' || line[i] === "'" ||
        ((line[i] === 'f' || line[i] === 'r' || line[i] === 'b') &&
         (line[i + 1] === '"' || line[i + 1] === "'"))) {
      let start = i;
      if (line[i] !== '"' && line[i] !== "'") i++;
      const q = line[i];
      i++;
      while (i < line.length && line[i] !== q) {
        if (line[i] === '\\') i++;
        i++;
      }
      if (i < line.length) i++;
      tokens.push({ text: line.slice(start, i), cls: 'tk-string' });
      continue;
    }

    if (/[0-9]/.test(line[i]) || (line[i] === '.' && i + 1 < line.length && /[0-9]/.test(line[i + 1]))) {
      const m = line.slice(i).match(/^(0[xXoObB][\da-fA-F_]+|[\d_]*\.?[\d_]+([eE][+-]?\d+)?)/);
      if (m) {
        tokens.push({ text: m[0], cls: 'tk-number' });
        i += m[0].length;
        continue;
      }
    }

    if (/[a-zA-Z_]/.test(line[i])) {
      const m = line.slice(i).match(/^[a-zA-Z_]\w*/);
      if (m) {
        const word = m[0];
        if (PY_KEYWORDS.has(word)) {
          tokens.push({ text: word, cls: 'tk-keyword' });
        } else if (PY_BUILTINS.has(word)) {
          tokens.push({ text: word, cls: 'tk-builtin' });
        } else {
          tokens.push({ text: word, cls: '' });
        }
        i += word.length;
        continue;
      }
    }

    if ('+-*/%=<>!&|^~:'.includes(line[i])) {
      const m = line.slice(i).match(/^(==|!=|<=|>=|->|<<|>>|\*\*|\/\/|[+\-*/%=<>!&|^~:])/);
      if (m) {
        tokens.push({ text: m[0], cls: 'tk-operator' });
        i += m[0].length;
        continue;
      }
    }

    if ('()[]{},.;'.includes(line[i])) {
      tokens.push({ text: line[i], cls: 'tk-punct' });
      i++;
      continue;
    }

    tokens.push({ text: line[i], cls: '' });
    i++;
  }

  return tokens;
}

function tokenizeJson(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    if (/\s/.test(line[i])) {
      let start = i;
      while (i < line.length && /\s/.test(line[i])) i++;
      tokens.push({ text: line.slice(start, i), cls: '' });
      continue;
    }

    if (line[i] === '"') {
      let start = i;
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\') i++;
        i++;
      }
      if (i < line.length) i++;
      const text = line.slice(start, i);
      let j = i;
      while (j < line.length && /\s/.test(line[j])) j++;
      const isKey = line[j] === ':';
      tokens.push({ text, cls: isKey ? 'tk-json-key' : 'tk-string' });
      continue;
    }

    if (/[-0-9]/.test(line[i])) {
      const m = line.slice(i).match(/^-?[\d.]+([eE][+-]?\d+)?/);
      if (m) {
        tokens.push({ text: m[0], cls: 'tk-number' });
        i += m[0].length;
        continue;
      }
    }

    if (line.slice(i, i + 4) === 'true' || line.slice(i, i + 5) === 'false') {
      const m = line.slice(i).match(/^(true|false)/);
      if (m) {
        tokens.push({ text: m[0], cls: 'tk-keyword' });
        i += m[0].length;
        continue;
      }
    }
    if (line.slice(i, i + 4) === 'null') {
      tokens.push({ text: 'null', cls: 'tk-null' });
      i += 4;
      continue;
    }

    if ('{}[],:'.includes(line[i])) {
      tokens.push({ text: line[i], cls: 'tk-punct' });
      i++;
      continue;
    }

    tokens.push({ text: line[i], cls: '' });
    i++;
  }

  return tokens;
}

// ── Lines & tokens ──
const rawLines = computed(() => props.code.split('\n'));

const tokenizedLines = computed(() => {
  const lang = props.language ?? 'text';
  return rawLines.value.map((line) => {
    if (lang === 'python') return tokenizePython(line);
    if (lang === 'json') return tokenizeJson(line);
    return [{ text: line, cls: '' }] as Token[];
  });
});

const lineCount = computed(() => tokenizedLines.value.length);
const gutterWidth = computed(() => Math.max(3, String(lineCount.value).length + 1));

// ── Folding (Python: def/class blocks, JSON: { } blocks) ──
interface FoldRange {
  start: number;
  end: number;
}

const foldableRanges = computed<FoldRange[]>(() => {
  const lang = props.language ?? 'text';
  const lines = rawLines.value;
  const ranges: FoldRange[] = [];

  if (lang === 'python') {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (/^(def |class |if |elif |else:|for |while |try:|except |finally:|with |async def |async for |async with )/.test(trimmed)) {
        const indent = lines[i].length - trimmed.length;
        let end = i + 1;
        while (end < lines.length) {
          const nextTrimmed = lines[end].trimStart();
          if (nextTrimmed.length === 0) { end++; continue; }
          const nextIndent = lines[end].length - nextTrimmed.length;
          if (nextIndent <= indent) break;
          end++;
        }
        if (end > i + 1) {
          ranges.push({ start: i, end: end - 1 });
        }
      }
    }
  } else if (lang === 'json') {
    const stack: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.endsWith('{') || trimmed.endsWith('[')) {
        stack.push(i);
      }
      if ((trimmed.startsWith('}') || trimmed.startsWith(']')) && stack.length > 0) {
        const start = stack.pop()!;
        if (i > start + 1) {
          ranges.push({ start, end: i });
        }
      }
    }
  }

  return ranges;
});

function getFoldRangeAt(lineIdx: number): FoldRange | undefined {
  return foldableRanges.value.find((r) => r.start === lineIdx);
}

function isFolded(lineIdx: number): boolean {
  return foldedRanges.value.has(lineIdx);
}

function isHiddenByFold(lineIdx: number): boolean {
  for (const start of foldedRanges.value) {
    const range = foldableRanges.value.find((r) => r.start === start);
    if (range && lineIdx > range.start && lineIdx <= range.end) return true;
  }
  return false;
}

function toggleFold(lineIdx: number) {
  const s = new Set(foldedRanges.value);
  if (s.has(lineIdx)) s.delete(lineIdx);
  else s.add(lineIdx);
  foldedRanges.value = s;
}

function foldAll() {
  foldedRanges.value = new Set(foldableRanges.value.map((r) => r.start));
}

function unfoldAll() {
  foldedRanges.value = new Set();
}

function getFoldedLineCount(lineIdx: number): number {
  const range = foldableRanges.value.find((r) => r.start === lineIdx);
  return range ? range.end - range.start : 0;
}

// ── Search ──
interface SearchMatch {
  lineIdx: number;
  startCol: number;
  endCol: number;
}

const searchMatches = computed<SearchMatch[]>(() => {
  const q = searchQuery.value;
  if (!q) return [];
  const matches: SearchMatch[] = [];
  const lowerQ = q.toLowerCase();
  for (let i = 0; i < rawLines.value.length; i++) {
    const line = rawLines.value[i].toLowerCase();
    let pos = 0;
    while (pos < line.length) {
      const idx = line.indexOf(lowerQ, pos);
      if (idx < 0) break;
      matches.push({ lineIdx: i, startCol: idx, endCol: idx + q.length });
      pos = idx + 1;
    }
  }
  return matches;
});

const searchMatchCount = computed(() => searchMatches.value.length);

function openSearch() {
  searchOpen.value = true;
  nextTick(() => searchInputRef.value?.focus());
}

function closeSearch() {
  searchOpen.value = false;
  searchQuery.value = '';
  searchMatchIndex.value = 0;
}

function nextMatch() {
  if (searchMatchCount.value === 0) return;
  searchMatchIndex.value = (searchMatchIndex.value + 1) % searchMatchCount.value;
  scrollToMatch();
}

function prevMatch() {
  if (searchMatchCount.value === 0) return;
  searchMatchIndex.value = (searchMatchIndex.value - 1 + searchMatchCount.value) % searchMatchCount.value;
  scrollToMatch();
}

function scrollToMatch() {
  const match = searchMatches.value[searchMatchIndex.value];
  if (!match || !codeScrollRef.value) return;
  const row = codeScrollRef.value.querySelector(`[data-line="${match.lineIdx}"]`);
  row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function onSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) prevMatch();
    else nextMatch();
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    closeSearch();
  }
}

watch(searchQuery, () => {
  searchMatchIndex.value = 0;
  if (searchMatches.value.length > 0) {
    nextTick(() => scrollToMatch());
  }
});

// ── Keyboard shortcut ──
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    const el = codeScrollRef.value?.closest('.code-viewer');
    if (el) {
      e.preventDefault();
      openSearch();
    }
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onUnmounted(() => document.removeEventListener('keydown', onKeydown));

// ── Visible lines (respecting folds) ──
interface VisibleLine {
  lineIdx: number;
  tokens: Token[];
  isFoldStart: boolean;
  foldedCount: number;
}

const visibleLines = computed<VisibleLine[]>(() => {
  const result: VisibleLine[] = [];
  for (let i = 0; i < tokenizedLines.value.length; i++) {
    if (isHiddenByFold(i)) continue;
    const foldRange = getFoldRangeAt(i);
    const folded = isFolded(i);
    result.push({
      lineIdx: i,
      tokens: tokenizedLines.value[i],
      isFoldStart: !!foldRange,
      foldedCount: folded ? getFoldedLineCount(i) : 0,
    });
  }
  return result;
});

// ── Search highlight rendering ──
function getLineMatchRanges(lineIdx: number): { start: number; end: number; active: boolean }[] {
  if (!searchQuery.value) return [];
  const ranges: { start: number; end: number; active: boolean }[] = [];
  let globalIdx = 0;
  for (const m of searchMatches.value) {
    if (m.lineIdx === lineIdx) {
      ranges.push({
        start: m.startCol,
        end: m.endCol,
        active: globalIdx === searchMatchIndex.value,
      });
    }
    globalIdx++;
  }
  return ranges;
}

function hasSearchMatch(lineIdx: number): boolean {
  return searchMatches.value.some((m) => m.lineIdx === lineIdx);
}
</script>

<template>
  <div class="code-viewer">
    <!-- Toolbar -->
    <div class="cv-toolbar">
      <div class="cv-toolbar-left">
        <span class="cv-lang">{{ language ?? 'text' }}</span>
        <span class="cv-lines">{{ t('strategyDev.cvLines', { n: lineCount }) }}</span>
      </div>
      <div class="cv-toolbar-right">
        <!-- Font size -->
        <div class="cv-font-controls">
          <button class="cv-btn-icon" :title="t('strategyDev.cvFontSmaller')" @click="changeFontSize(-1)">
            <i-mdi-format-font-size-decrease class="w-3.5 h-3.5" />
          </button>
          <span class="cv-font-size">{{ fontSize }}px</span>
          <button class="cv-btn-icon" :title="t('strategyDev.cvFontLarger')" @click="changeFontSize(1)">
            <i-mdi-format-font-size-increase class="w-3.5 h-3.5" />
          </button>
        </div>

        <!-- Fold controls -->
        <div v-if="foldableRanges.length > 0" class="cv-fold-controls">
          <button class="cv-btn-icon" :title="t('strategyDev.cvFoldAll')" @click="foldAll">
            <i-mdi-unfold-less-horizontal class="w-3.5 h-3.5" />
          </button>
          <button class="cv-btn-icon" :title="t('strategyDev.cvUnfoldAll')" @click="unfoldAll">
            <i-mdi-unfold-more-horizontal class="w-3.5 h-3.5" />
          </button>
        </div>

        <!-- Search toggle -->
        <button class="cv-btn-icon" :title="t('strategyDev.cvSearch')" @click="openSearch">
          <i-mdi-magnify class="w-3.5 h-3.5" />
        </button>

        <!-- Copy -->
        <button class="cv-btn-copy" :class="{ copied }" @click="copyCode">
          <i-mdi-check v-if="copied" class="w-3.5 h-3.5" />
          <i-mdi-content-copy v-else class="w-3.5 h-3.5" />
          {{ copied ? t('strategyDev.cvCopied') : t('strategyDev.cvCopy') }}
        </button>
      </div>
    </div>

    <!-- Search bar -->
    <Transition name="cv-search">
      <div v-if="searchOpen" class="cv-search-bar">
        <div class="cv-search-input-wrap">
          <i-mdi-magnify class="w-3.5 h-3.5 cv-search-icon" />
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            class="cv-search-input"
            :placeholder="t('strategyDev.cvSearchPlaceholder')"
            spellcheck="false"
            @keydown="onSearchKeydown"
          />
          <span v-if="searchQuery" class="cv-search-count">
            {{ searchMatchCount > 0 ? `${searchMatchIndex + 1}/${searchMatchCount}` : t('strategyDev.cvNoResults') }}
          </span>
        </div>
        <button class="cv-btn-icon" :disabled="searchMatchCount === 0" @click="prevMatch">
          <i-mdi-chevron-up class="w-3.5 h-3.5" />
        </button>
        <button class="cv-btn-icon" :disabled="searchMatchCount === 0" @click="nextMatch">
          <i-mdi-chevron-down class="w-3.5 h-3.5" />
        </button>
        <button class="cv-btn-icon" @click="closeSearch">
          <i-mdi-close class="w-3.5 h-3.5" />
        </button>
      </div>
    </Transition>

    <!-- Code area -->
    <div ref="codeScrollRef" class="cv-scroll" :style="{ maxHeight: maxHeight ?? '60vh' }">
      <table class="cv-table" :style="{ fontSize: fontSize + 'px' }">
        <tbody>
          <tr
            v-for="vl in visibleLines"
            :key="vl.lineIdx"
            class="cv-line"
            :class="{
              'cv-line--highlighted': highlightedLines.has(vl.lineIdx),
              'cv-line--search-match': hasSearchMatch(vl.lineIdx),
            }"
            :data-line="vl.lineIdx"
          >
            <!-- Gutter -->
            <td class="cv-gutter" :style="{ width: (gutterWidth + 2) + 'ch' }">
              <!-- Fold button -->
              <span
                v-if="vl.isFoldStart"
                class="cv-fold-btn"
                :class="{ 'cv-fold-btn--folded': isFolded(vl.lineIdx) }"
                @click.stop="toggleFold(vl.lineIdx)"
              >
                <i-mdi-chevron-down v-if="!isFolded(vl.lineIdx)" class="w-3 h-3" />
                <i-mdi-chevron-right v-else class="w-3 h-3" />
              </span>
              <span
                class="cv-line-num"
                @click="toggleLineHighlight(vl.lineIdx)"
              >
                {{ vl.lineIdx + 1 }}
              </span>
            </td>

            <!-- Content -->
            <td class="cv-content">
              <template v-if="getLineMatchRanges(vl.lineIdx).length > 0">
                <CodeLineWithSearch
                  :tokens="vl.tokens"
                  :matches="getLineMatchRanges(vl.lineIdx)"
                  :line-text="rawLines[vl.lineIdx]"
                />
              </template>
              <template v-else>
                <span v-for="(tok, j) in vl.tokens" :key="j" :class="tok.cls">{{ tok.text }}</span>
              </template>

              <!-- Fold indicator -->
              <span v-if="vl.foldedCount > 0" class="cv-fold-indicator">
                ⋯ {{ vl.foldedCount }} {{ t('strategyDev.cvFoldedLines') }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.code-viewer {
  border-radius: var(--sd-radius-md);
  overflow: hidden;
  border: 1px solid var(--sd-border-subtle);
  background: #1e1e2e;
}

/* ── Toolbar ── */
.cv-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: #181825;
  border-bottom: 1px solid #313244;
  font-size: 11px;
  gap: 8px;
}

.cv-toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cv-toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cv-lang {
  color: #89b4fa;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.cv-lines {
  color: #6c7086;
}

.cv-btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: #6c7086;
  cursor: pointer;
  transition: all 0.15s;
}
.cv-btn-icon:hover {
  background: #313244;
  color: #cdd6f4;
}
.cv-btn-icon:disabled {
  opacity: 0.3;
  cursor: default;
}

.cv-font-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  border-right: 1px solid #313244;
  padding-right: 6px;
}

.cv-font-size {
  color: #6c7086;
  font-size: 10px;
  font-family: var(--sd-font-mono);
  min-width: 30px;
  text-align: center;
}

.cv-fold-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  border-right: 1px solid #313244;
  padding-right: 6px;
}

.cv-btn-copy {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid #45475a;
  background: transparent;
  color: #a6adc8;
  cursor: pointer;
  font-size: 10px;
  transition: all 0.15s;
}
.cv-btn-copy:hover {
  background: #313244;
  color: #cdd6f4;
}
.cv-btn-copy.copied {
  border-color: #a6e3a1;
  color: #a6e3a1;
}

/* ── Search bar ── */
.cv-search-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: #181825;
  border-bottom: 1px solid #313244;
}

.cv-search-input-wrap {
  display: flex;
  align-items: center;
  flex: 1;
  background: #1e1e2e;
  border: 1px solid #45475a;
  border-radius: 4px;
  padding: 0 8px;
  gap: 6px;
}

.cv-search-input-wrap:focus-within {
  border-color: #89b4fa;
}

.cv-search-icon {
  color: #6c7086;
  flex-shrink: 0;
}

.cv-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #cdd6f4;
  font-size: 12px;
  font-family: var(--sd-font-mono);
  padding: 4px 0;
}

.cv-search-count {
  color: #6c7086;
  font-size: 10px;
  font-family: var(--sd-font-mono);
  white-space: nowrap;
}

.cv-search-enter-active { transition: opacity 0.15s, transform 0.15s; }
.cv-search-leave-active { transition: opacity 0.1s; }
.cv-search-enter-from { opacity: 0; transform: translateY(-4px); }
.cv-search-leave-to { opacity: 0; }

/* ── Code area ── */
.cv-scroll {
  overflow: auto;
}

.cv-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace;
  line-height: 1.55;
}

.cv-line {
  transition: background 0.1s;
}
.cv-line:hover {
  background: rgba(49, 50, 68, 0.5);
}
.cv-line--highlighted {
  background: rgba(137, 180, 250, 0.08) !important;
}
.cv-line--highlighted .cv-gutter {
  color: #89b4fa !important;
}
.cv-line--search-match {
  background: rgba(249, 226, 175, 0.04);
}

/* ── Gutter ── */
.cv-gutter {
  text-align: right;
  padding: 0 4px 0 4px;
  color: #45475a;
  user-select: none;
  white-space: nowrap;
  vertical-align: top;
  border-right: 1px solid #313244;
  position: relative;
}

.cv-line-num {
  cursor: pointer;
  padding: 0 4px;
}
.cv-line-num:hover {
  color: #89b4fa;
}

/* ── Fold button ── */
.cv-fold-btn {
  position: absolute;
  left: 2px;
  top: 50%;
  transform: translateY(-50%);
  cursor: pointer;
  color: #6c7086;
  display: flex;
  align-items: center;
  opacity: 0;
  transition: opacity 0.15s;
}
.cv-line:hover .cv-fold-btn,
.cv-fold-btn--folded {
  opacity: 1;
}
.cv-fold-btn:hover {
  color: #cdd6f4;
}

.cv-fold-indicator {
  display: inline-block;
  margin-left: 8px;
  padding: 0 6px;
  background: #313244;
  border-radius: 3px;
  color: #6c7086;
  font-size: 0.8em;
  font-style: italic;
  cursor: default;
}

/* ── Content ── */
.cv-content {
  padding: 0 12px;
  white-space: pre;
  color: #cdd6f4;
  text-align: left;
}

/* ── Syntax tokens — Catppuccin Mocha ── */
:deep(.tk-keyword) { color: #cba6f7; font-weight: 500; }
:deep(.tk-builtin) { color: #f9e2af; }
:deep(.tk-string) { color: #a6e3a1; }
:deep(.tk-comment) { color: #6c7086; font-style: italic; }
:deep(.tk-number) { color: #fab387; }
:deep(.tk-decorator) { color: #f5c2e7; }
:deep(.tk-operator) { color: #89dceb; }
:deep(.tk-punct) { color: #6c7086; }
:deep(.tk-json-key) { color: #89b4fa; }
:deep(.tk-null) { color: #f38ba8; font-style: italic; }

/* ── Search highlights ── */
:deep(.cv-search-hl) {
  background: rgba(249, 226, 175, 0.25);
  border-radius: 2px;
  padding: 0 1px;
}
:deep(.cv-search-hl--active) {
  background: rgba(249, 226, 175, 0.5);
  outline: 1px solid #f9e2af;
}
</style>
