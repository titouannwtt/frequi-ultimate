// Deep get/set/delete by dotted path + structural diff, for the config editor.
// Operates on plain JSON-like objects (the parsed config).

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepGet(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (isDict(o) ? o[k] : undefined), obj);
}

export function hasPath(obj: unknown, path: string): boolean {
  const keys = path.split('.');
  let cur: unknown = obj;
  for (const k of keys) {
    if (!isDict(cur) || !(k in cur)) return false;
    cur = cur[k];
  }
  return true;
}

export function deepSet(obj: Dict, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur: Dict = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!isDict(cur[k])) cur[k] = {};
    cur = cur[k] as Dict;
  }
  cur[keys[keys.length - 1]] = value;
}

/** Delete a path and prune any parent objects left empty. */
export function deepDelete(obj: Dict, path: string): void {
  const keys = path.split('.');
  const chain: Dict[] = [obj];
  let cur: Dict = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = cur[keys[i]];
    if (!isDict(next)) return;
    cur = next;
    chain.push(cur);
  }
  delete cur[keys[keys.length - 1]];
  for (let i = chain.length - 1; i > 0; i--) {
    if (Object.keys(chain[i]).length === 0) {
      delete chain[i - 1][keys[i - 1]];
    } else {
      break;
    }
  }
}

export function clone<T>(value: T): T {
  // JSON round-trip: config data is pure JSON, and this avoids any structuredClone
  // availability/throw issues across browsers (a clone failure must never leave the
  // draft empty — that previously risked overwriting the file with a near-empty config).
  return value == null ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export interface ConfigDiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}

/** Recursive diff; arrays and primitives are compared as leaves via JSON. */
export function diffConfig(before: unknown, after: unknown, prefix = ''): ConfigDiffEntry[] {
  const out: ConfigDiffEntry[] = [];
  const b = isDict(before) ? before : {};
  const a = isDict(after) ? after : {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const k of keys) {
    const p = prefix ? `${prefix}.${k}` : k;
    const bv = b[k];
    const av = a[k];
    if (isDict(bv) && isDict(av)) {
      out.push(...diffConfig(bv, av, p));
    } else if (JSON.stringify(bv) !== JSON.stringify(av)) {
      out.push({ path: p, before: bv, after: av });
    }
  }
  return out;
}
