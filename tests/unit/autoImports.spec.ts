import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The generated declaration file is versioned. A module removed by a clean-up must not stay in
// it: a dangling `import('./x')` hides the use of a name that no longer exists (type check passes,
// the page fails at run time, as the zoom helpers of the backtest charts did).
const SRC = join(__dirname, '..', '..', 'src');

function resolves(rel: string): boolean {
  const base = join(SRC, rel);
  return ['', '.ts', '.vue', '.tsx', '/index.ts'].some((ext) => existsSync(base + ext));
}

describe('auto-imports.d.ts', () => {
  it('only points to modules that exist', () => {
    const text = readFileSync(join(SRC, 'auto-imports.d.ts'), 'utf8');
    const missing = new Set<string>();
    for (const m of text.matchAll(/import\('(\.\/[^']+)'\)/g)) {
      if (!resolves(m[1]!.slice(2))) missing.add(m[1]!);
    }
    expect([...missing]).toEqual([]);
  });
});
