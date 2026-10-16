import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import fqEn from '../../src/locales/redesign/en';
import fqFr from '../../src/locales/redesign/fr';

/**
 * Every message key the composites ask for exists in French and English: a missing key would show
 * its raw path ("fq.act.exit") on screen, on a screen that moves real money. Dynamic keys
 * (`fq.act.${id}`) are checked by prefix: the prefix must hold messages.
 */
type Tree = { [key: string]: string | Tree };
function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`),
  );
}
const en = new Set(flatten(fqEn as unknown as Tree).map((k) => `fq.${k}`));
const fr = new Set(flatten(fqFr as unknown as Tree).map((k) => `fq.${k}`));
// The redesign tree is merged under `fq`: accept both shapes of the root
const rootedEn = [...en].some((k) => k.startsWith('fq.fq.'))
  ? new Set([...en].map((k) => k.slice(3)))
  : en;
const rootedFr = [...fr].some((k) => k.startsWith('fq.fq.'))
  ? new Set([...fr].map((k) => k.slice(3)))
  : fr;

const SRC = resolve(__dirname, '../../src');
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(vue|ts)$/.test(name) && !p.includes('/locales/')) out.push(p);
  }
  return out;
}

const files = [
  ...walk(join(SRC, 'components/fq')),
  ...walk(join(SRC, 'views/ds')),
  ...walk(join(SRC, 'views/fq')),
  ...[
    'useActionDialog',
    'useCommandPalette',
    'useLastVisit',
    'useScopeDetail',
    'useBotAction',
    'useReconciliation',
    'useBotRegistryEdit',
    'useJournal',
  ].map((n) => join(SRC, `composables/${n}.ts`)),
];

const staticKeys = new Map<string, string>();
const dynamicPrefixes = new Map<string, string>();
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/(['"`])(fq\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\1/g)) {
    staticKeys.set(m[2]!, f);
  }
  for (const m of text.matchAll(/`(fq\.[A-Za-z0-9_.]*?)\$\{/g)) dynamicPrefixes.set(m[1]!, f);
  // Keys written without the fq. prefix by helpers (`t('result.sent')` in useBotAction)
}

describe('message keys used by the composites', () => {
  it('found something to check', () => {
    expect(staticKeys.size).toBeGreaterThan(100);
    expect(dynamicPrefixes.size).toBeGreaterThan(5);
  });

  it('every static key exists in English and in French', () => {
    const missing = [...staticKeys.entries()]
      .filter(([k]) => !rootedEn.has(k) || !rootedFr.has(k))
      .map(([k, f]) => `${k} (${f.replace(SRC, 'src')})`);
    expect(missing).toEqual([]);
  });

  it('every dynamic prefix holds messages in both languages', () => {
    const empty = [...dynamicPrefixes.entries()]
      .filter(
        ([p]) =>
          ![...rootedEn].some((k) => k.startsWith(p)) ||
          ![...rootedFr].some((k) => k.startsWith(p)),
      )
      .map(([p, f]) => `${p} (${f.replace(SRC, 'src')})`);
    expect(empty).toEqual([]);
  });

  it('the action labels, dialog titles and disabled reasons cover every id', async () => {
    const { ACTIONS } = await import('../../src/components/fq/lib/actions');
    for (const def of Object.values(ACTIONS)) {
      expect(rootedEn.has(`fq.act.${def.label}`), def.id).toBe(true);
      expect(rootedFr.has(`fq.act.${def.label}`), def.id).toBe(true);
    }
    for (const reason of [
      'offline',
      'authExpired',
      'starting',
      'stopped',
      'connecting',
      'cache',
      'orphan',
      'unknownBot',
      'target',
    ]) {
      expect(rootedEn.has(`fq.act.disabled.${reason}`), reason).toBe(true);
      expect(rootedFr.has(`fq.act.disabled.${reason}`), reason).toBe(true);
    }
    for (const kind of [
      'exit',
      'exitAll',
      'forceentry',
      'stop',
      'stopbuy',
      'start',
      'reload_config',
      'reload_trade',
      'delete_trade',
    ]) {
      expect(rootedEn.has(`fq.dialog.title.${kind}`), kind).toBe(true);
    }
  });
});
