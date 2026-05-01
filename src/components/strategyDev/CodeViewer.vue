<script setup lang="ts">
const props = defineProps<{
  code: string;
  language?: string;
}>();

const copied = ref(false);

async function copyCode() {
  await navigator.clipboard.writeText(props.code);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}

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
    // Comment
    if (line[i] === '#') {
      tokens.push({ text: line.slice(i), cls: 'tk-comment' });
      break;
    }

    // Decorator
    if (line[i] === '@' && (i === 0 || /\s/.test(line[i - 1]))) {
      const m = line.slice(i).match(/^@[\w.]+/);
      if (m) {
        tokens.push({ text: m[0], cls: 'tk-decorator' });
        i += m[0].length;
        continue;
      }
    }

    // Triple-quoted strings
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

    // Strings (single/double, f-strings)
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

    // Numbers
    if (/[0-9]/.test(line[i]) || (line[i] === '.' && i + 1 < line.length && /[0-9]/.test(line[i + 1]))) {
      const m = line.slice(i).match(/^(0[xXoObB][\da-fA-F_]+|[\d_]*\.?[\d_]+([eE][+-]?\d+)?)/);
      if (m) {
        tokens.push({ text: m[0], cls: 'tk-number' });
        i += m[0].length;
        continue;
      }
    }

    // Words (keywords, builtins, identifiers)
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

    // Operators
    if ('+-*/%=<>!&|^~:'.includes(line[i])) {
      const m = line.slice(i).match(/^(==|!=|<=|>=|->|<<|>>|\*\*|\/\/|[+\-*/%=<>!&|^~:])/);
      if (m) {
        tokens.push({ text: m[0], cls: 'tk-operator' });
        i += m[0].length;
        continue;
      }
    }

    // Brackets
    if ('()[]{},.;'.includes(line[i])) {
      tokens.push({ text: line[i], cls: 'tk-punct' });
      i++;
      continue;
    }

    // Whitespace or other
    tokens.push({ text: line[i], cls: '' });
    i++;
  }

  return tokens;
}

function tokenizeJson(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    // Whitespace
    if (/\s/.test(line[i])) {
      let start = i;
      while (i < line.length && /\s/.test(line[i])) i++;
      tokens.push({ text: line.slice(start, i), cls: '' });
      continue;
    }

    // String (check if it's a key by looking ahead for colon)
    if (line[i] === '"') {
      let start = i;
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\') i++;
        i++;
      }
      if (i < line.length) i++;
      const text = line.slice(start, i);
      // Look ahead for colon to determine if key
      let j = i;
      while (j < line.length && /\s/.test(line[j])) j++;
      const isKey = line[j] === ':';
      tokens.push({ text, cls: isKey ? 'tk-json-key' : 'tk-string' });
      continue;
    }

    // Numbers
    if (/[-0-9]/.test(line[i])) {
      const m = line.slice(i).match(/^-?[\d.]+([eE][+-]?\d+)?/);
      if (m) {
        tokens.push({ text: m[0], cls: 'tk-number' });
        i += m[0].length;
        continue;
      }
    }

    // Keywords
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

    // Punctuation
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

const tokenizedLines = computed(() => {
  const lines = props.code.split('\n');
  const lang = props.language ?? 'text';
  return lines.map((line) => {
    if (lang === 'python') return tokenizePython(line);
    if (lang === 'json') return tokenizeJson(line);
    return [{ text: line, cls: '' }] as Token[];
  });
});

const lineCount = computed(() => tokenizedLines.value.length);
const gutterWidth = computed(() => Math.max(3, String(lineCount.value).length + 1));
</script>

<template>
  <div class="code-viewer">
    <div class="code-toolbar">
      <span class="code-lang">{{ language ?? 'text' }}</span>
      <span class="code-lines">{{ lineCount }} lines</span>
      <button class="code-copy" :class="{ copied }" @click="copyCode">
        <i-mdi-check v-if="copied" class="w-3.5 h-3.5" />
        <i-mdi-content-copy v-else class="w-3.5 h-3.5" />
        {{ copied ? 'Copied' : 'Copy' }}
      </button>
    </div>
    <div class="code-scroll">
      <table class="code-table">
        <tbody>
          <tr v-for="(tokens, i) in tokenizedLines" :key="i" class="code-line">
            <td class="code-gutter" :style="{ width: gutterWidth + 'ch' }">
              {{ i + 1 }}
            </td>
            <td class="code-content">
              <span v-for="(tok, j) in tokens" :key="j" :class="tok.cls">{{ tok.text }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.code-viewer {
  border-radius: 0.5rem;
  overflow: hidden;
  border: 1px solid var(--p-surface-700);
  background: #1e1e2e;
}

.code-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 1rem;
  background: #181825;
  border-bottom: 1px solid var(--p-surface-700);
  font-size: 0.75rem;
}

.code-lang {
  color: #89b4fa;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.code-lines {
  color: #6c7086;
  flex: 1;
}

.code-copy {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  border: 1px solid #45475a;
  background: transparent;
  color: #a6adc8;
  cursor: pointer;
  font-size: 0.7rem;
  transition: all 0.15s;
}
.code-copy:hover {
  background: #313244;
  color: #cdd6f4;
}
.code-copy.copied {
  border-color: #a6e3a1;
  color: #a6e3a1;
}

.code-scroll {
  overflow: auto;
  max-height: 60vh;
}

.code-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace;
  font-size: 0.8rem;
  line-height: 1.5;
}

.code-line:hover {
  background: #313244;
}

.code-gutter {
  text-align: right;
  padding: 0 0.75rem 0 0.5rem;
  color: #45475a;
  user-select: none;
  white-space: nowrap;
  vertical-align: top;
  border-right: 1px solid #313244;
}

.code-content {
  padding: 0 1rem;
  white-space: pre;
  color: #cdd6f4;
}

/* Python tokens — Catppuccin Mocha palette */
:deep(.tk-keyword) { color: #cba6f7; font-weight: 500; }
:deep(.tk-builtin) { color: #f9e2af; }
:deep(.tk-string) { color: #a6e3a1; }
:deep(.tk-comment) { color: #6c7086; font-style: italic; }
:deep(.tk-number) { color: #fab387; }
:deep(.tk-decorator) { color: #f5c2e7; }
:deep(.tk-operator) { color: #89dceb; }
:deep(.tk-punct) { color: #6c7086; }

/* JSON tokens */
:deep(.tk-json-key) { color: #89b4fa; }
:deep(.tk-null) { color: #f38ba8; font-style: italic; }
</style>
