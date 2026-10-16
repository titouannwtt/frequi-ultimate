/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures and decoded wire frames */
/**
 * Runs the shared test vectors (`gateway/fixtures/vectors/*.json`) against the TypeScript ports in
 * `src/datasource`. The Rust runner (`cargo test -p fg-core --test vectors`) executes the very same
 * files, so a vector is the executable contract between `fg-core` and the browser direct mode.
 *
 * The runner is exhaustive on both sides:
 * - every function named by a vector file must have a TypeScript implementation registered here, or
 *   be listed in GATEWAY_ONLY with the reason;
 * - every registered implementation must be referenced by the code that is supposed to use it
 *   (DirectSource for the calculations, GatewaySource for the protocol client side), so a port that
 *   nothing calls cannot pass for coverage.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { AlertTypeId, BotAlertContext, DrawdownInput, Upsert } from '@/gateway/types.gen';
import {
  AlertBook,
  alertView,
  computeDrawdown,
  computeFreshness,
  defaultAlertRulesConfig,
  effectiveRulesFor,
  evaluateBot,
  exposure,
  medianDurationMs,
  mergeHistories,
  normalizeExitReason,
  normalizeTsMs,
  openWorstAbs,
  parseAvgDurationMs,
  parseDateMs,
  parsePair,
  percentileValue,
  periodCutoffMs,
  pnlPeriods,
  startingCapital,
  sumFresh,
  sumStartingCapital,
  tradeTotals,
  walletTotals,
  whitelistMarket,
  ALERT_TYPE_IDS,
} from '@/datasource/calc';
import { StateHub } from '@/datasource/hub';
import {
  applyUpsert,
  formatChannel,
  parseChannel,
  SeqTracker,
  type Collections,
} from '@/datasource/protocol';

// Vitest runs from the repository root.
const VECTORS_DIR = resolve(process.cwd(), 'gateway/fixtures/vectors');
const DATASOURCE_DIR = resolve(process.cwd(), 'src/datasource');

type Json = any;

interface VectorFile {
  function: string;
  defaults?: Json;
  cases: { name: string; input: Json; expected: Json }[];
}

type Side = 'direct' | 'gateway';

interface Impl {
  /** Which half of the data layer is supposed to call the port. */
  usedBy: Side;
  /** Exported symbols that must be referenced from the code of that half. */
  symbols: string[];
  /**
   * The port is an internal step of another one that DirectSource calls (for example
   * `openWorstAbs` inside `computeDrawdown`): that caller must be referenced by the direct mode,
   * and the port must really be used inside the file that defines the caller.
   */
  via?: { caller: string; file: string };
  run: (input: Json, defaults: Json) => Json;
}

/** Vector functions that only exist on the server. */
const GATEWAY_ONLY: Record<string, string> = {
  'duration.percentile_rank':
    'ranks a position among ALL the closed trades of the bot; the direct mode only holds a partial history and shows no percentile (02 section 10.4)',
  'duration.anomaly_pct':
    'builds on the percentile rank: unavailable in direct mode for the same reason, the gateway computes it from the full closed history',
  'duration.level':
    'amber/critical level of the percentile label, which the direct mode does not show (02 section 10.4)',
  'protocol.buffer_resume':
    'server-side ring buffer of the last 512 deltas: the browser only tracks sequence numbers (protocol.seq_script)',
};

const dexesOf = (input: Json): string[] | undefined => input.dexes;

function overlay(base: Json, over: Json): Json {
  return { ...(base ?? {}), ...(over ?? {}) };
}

function rulesFrom(input: Json) {
  const cfg = defaultAlertRulesConfig();
  const enabled: AlertTypeId[] = input.enabled;
  const thresholds: Record<string, number> = input.thresholds ?? {};
  const forS: Record<string, number> = input.for_s ?? {};
  for (const t of ALERT_TYPE_IDS) {
    const e = { ...cfg.global[t]! };
    e.enabled = enabled.includes(t);
    if (thresholds[t] !== undefined) e.threshold = thresholds[t];
    if (forS[t] !== undefined) e.forS = forS[t];
    cfg.global[t] = e;
  }
  return effectiveRulesFor(cfg, 'vector');
}

function runBookScript(input: Json): Json {
  const book = new AlertBook();
  const results: Json[] = [];
  for (const step of input.steps) {
    const now: number = step.now_ms;
    let transitions: ReturnType<AlertBook['evaluateBot']> = [];
    switch (step.op) {
      case 'evaluate':
        transitions = book.evaluateBot(now, step.bot_key, {
          conditions: step.conditions,
          evaluated: step.evaluated,
          disabled: step.disabled ?? [],
        });
        break;
      case 'ack': {
        const found = book
          .alerts(now)
          .find(
            (a) =>
              a.type_id === step.type_id &&
              a.bot_key === (step.bot_key ?? null) &&
              a.subject === (step.subject ?? null),
          );
        if (!found) throw new Error('alert to ack not found');
        book.ack(found.id, step.session ?? null, now);
        break;
      }
      case 'silence':
        book.silence(
          step.type_id ?? null,
          step.bot_key ?? null,
          step.subject ?? null,
          step.until_ms,
          now,
        );
        break;
      case 'snapshot':
        break;
      default:
        throw new Error(`unknown op ${step.op}`);
    }
    results.push({
      transitions: transitions.map((t) => ({
        kind: t.kind,
        type_id: t.alert.type_id,
        bot_key: t.alert.bot_key,
        subject: t.alert.subject,
        silenced: t.alert.silenced_until_ms !== null,
      })),
      active: book.alerts(now).map((a) => ({
        type_id: a.type_id,
        bot_key: a.bot_key,
        subject: a.subject,
        severity: a.severity,
        view: alertView(a, now),
      })),
      bell: book.bellCount(now),
    });
  }
  // A book must also survive persistence between steps.
  const lastNow = input.steps.at(-1)?.now_ms ?? 0;
  const reloaded = AlertBook.fromState(JSON.parse(JSON.stringify(book.toState())));
  expect(reloaded.alerts(lastNow)).toEqual(book.alerts(lastNow));
  return results;
}

const IMPLS: Record<string, Impl> = {
  'time.normalize_ts_ms': {
    usedBy: 'direct',
    symbols: ['normalizeTsMs'],
    run: (i) => normalizeTsMs(i),
  },
  'time.parse_date_ms': { usedBy: 'direct', symbols: ['parseDateMs'], run: (i) => parseDateMs(i) },
  'drawdown.compute': {
    usedBy: 'direct',
    symbols: ['computeDrawdown'],
    run: (i) => computeDrawdown(i as DrawdownInput),
  },
  'drawdown.open_worst_abs': {
    usedBy: 'direct',
    symbols: ['openWorstAbs'],
    via: { caller: 'computeDrawdown', file: 'calc/drawdown.ts' },
    run: (i) => openWorstAbs(i),
  },
  'drawdown.merge_histories': {
    usedBy: 'direct',
    symbols: ['mergeHistories'],
    run: (i) => mergeHistories(i),
  },
  'periods.cutoff': {
    usedBy: 'direct',
    symbols: ['periodCutoffMs'],
    run: (i) => periodCutoffMs(i.key, i.now_ms, i.tz),
  },
  'periods.pnl_periods': {
    usedBy: 'direct',
    symbols: ['pnlPeriods'],
    run: (i) => pnlPeriods(i.trades, i.unit, i.tz, i.now_ms, i.n),
  },
  'capital.starting_capital': {
    usedBy: 'direct',
    symbols: ['startingCapital'],
    run: (i) => startingCapital(i),
  },
  'capital.sum_starting_capital': {
    usedBy: 'direct',
    symbols: ['sumStartingCapital'],
    run: (i) => sumStartingCapital(i),
  },
  'capital.wallet_totals': {
    usedBy: 'direct',
    symbols: ['walletTotals'],
    run: (i) => walletTotals(i),
  },
  'duration.median_duration_ms': {
    usedBy: 'direct',
    symbols: ['medianDurationMs'],
    run: (i) => medianDurationMs(i),
  },
  'duration.percentile_value': {
    usedBy: 'direct',
    symbols: ['percentileValue'],
    via: { caller: 'medianDurationMs', file: 'calc/duration.ts' },
    run: (i) => percentileValue(i.values, i.p),
  },
  'duration.parse_avg_duration_ms': {
    usedBy: 'direct',
    symbols: ['parseAvgDurationMs'],
    run: (i) => parseAvgDurationMs(i),
  },
  'hip3.parse_pair': {
    usedBy: 'direct',
    symbols: ['parsePair'],
    run: (i) => parsePair(i.pair, dexesOf(i)),
  },
  'hip3.whitelist_market': {
    usedBy: 'direct',
    symbols: ['whitelistMarket'],
    run: (i) => whitelistMarket(i.whitelist, dexesOf(i)),
  },
  'exit_reason.normalize': {
    usedBy: 'direct',
    symbols: ['normalizeExitReason'],
    run: (i) => normalizeExitReason(i),
  },
  'exposure.exposure': { usedBy: 'direct', symbols: ['exposure'], run: (i) => exposure(i) },
  'stats.trade_totals': {
    usedBy: 'direct',
    symbols: ['tradeTotals'],
    via: { caller: 'pageTradeRows', file: 'calc/tradePage.ts' },
    run: (i) => tradeTotals(i),
  },
  'freshness.compute': {
    usedBy: 'direct',
    symbols: ['computeFreshness'],
    run: (i) =>
      computeFreshness(i.source, i.as_of_ms, i.now_ms, i.cadence_ms ?? 0, i.has_positions ?? false),
  },
  'freshness.sum_fresh': {
    usedBy: 'direct',
    symbols: ['sumFresh'],
    via: { caller: 'scopeTotalsByMode', file: 'calc/scopeTotals.ts' },
    run: (i) => sumFresh(i),
  },
  'alerts.evaluate_bot': {
    usedBy: 'direct',
    symbols: ['evaluateBot'],
    run: (i, defaults) => {
      const ctx = overlay(defaults.ctx, i.ctx) as BotAlertContext;
      const out = evaluateBot(rulesFrom(i), ctx);
      // `evaluated` and `disabled` are sets: compare them as sorted lists.
      return {
        ...out,
        evaluated: [...out.evaluated].sort(),
        disabled: [...out.disabled].sort(),
      };
    },
  },
  'alerts.book_script': { usedBy: 'direct', symbols: ['AlertBook'], run: (i) => runBookScript(i) },
  'protocol.channel_parse': {
    usedBy: 'gateway',
    symbols: ['parseChannel', 'formatChannel'],
    run: (i) => {
      const r = parseChannel(i);
      return r.ok ? { channel: formatChannel(r.channel) } : { error: r.error };
    },
  },
  'protocol.seq_script': {
    usedBy: 'gateway',
    symbols: ['SeqTracker'],
    run: (i) => {
      const t = new SeqTracker();
      if (typeof i.baseline === 'number') t.reset(i.baseline);
      const verdicts = (i.observe as number[]).map((s) => t.observe(s));
      return { verdicts, last: t.last };
    },
  },
  'protocol.diff': {
    usedBy: 'direct',
    symbols: ['StateHub'],
    run: (i) => {
      const name: string = i.collection;
      const hub = new StateHub([name], () => 1);
      const client: Collections = {};
      hub.subscribe((u) => {
        if (u.kind === 'unavailable') return;
        if (u.kind === 'snapshot') client[name] = {};
        applyUpsert(client, u.upsert as Upsert, u.remove);
      });
      const states: Json[] = [];
      const changed: boolean[] = [];
      for (const step of i.steps) {
        changed.push(hub.set(name, step));
        states.push(structuredClone(client[name] ?? {}));
      }
      return { states, changed };
    },
  },
  'protocol.apply': {
    usedBy: 'gateway',
    symbols: ['applyUpsert'],
    run: (i) => {
      const state: Collections = {};
      for (const f of i.frames) {
        applyUpsert(state, f.upsert as Upsert | undefined, f.remove);
      }
      return state;
    },
  },
};

/** `expected` must be contained in `actual`: same contract as the Rust runner. */
function subset(expected: Json, actual: Json, path: string, errors: string[]): void {
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
      errors.push(`${path}: ${JSON.stringify(actual)} is not an object`);
      return;
    }
    for (const [k, ev] of Object.entries(expected)) {
      if (!(k in actual)) {
        errors.push(`${path}.${k}: missing (expected ${JSON.stringify(ev)})`);
      } else {
        subset(ev, actual[k], `${path}.${k}`, errors);
      }
    }
  } else if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      errors.push(
        `${path}: length ${Array.isArray(actual) ? actual.length : '?'} != expected ${expected.length}`,
      );
      return;
    }
    expected.forEach((ev, i) => subset(ev, actual[i], `${path}[${i}]`, errors));
  } else if (typeof expected === 'number' && typeof actual === 'number') {
    if (Math.abs(expected - actual) > 1e-9 * Math.max(Math.abs(expected), 1)) {
      errors.push(`${path}: ${actual} != expected ${expected}`);
    }
  } else if (expected !== actual) {
    errors.push(`${path}: ${JSON.stringify(actual)} != expected ${JSON.stringify(expected)}`);
  }
}

function loadVectors(): { file: string; v: VectorFile }[] {
  return readdirSync(VECTORS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({
      file,
      v: JSON.parse(readFileSync(`${VECTORS_DIR}/${file}`, 'utf8')) as VectorFile,
    }));
}

function sourceOf(dir: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|vue)$/.test(e.name)) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(dir);
  return out.join('\n');
}

const vectors = loadVectors();

describe('shared vectors: coverage of the TypeScript ports', () => {
  it('finds the vector files', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(29);
    expect(vectors.reduce((n, { v }) => n + v.cases.length, 0)).toBeGreaterThanOrEqual(250);
  });

  it('has an implementation (or a stated gateway-only reason) for every vector function', () => {
    const missing = vectors
      .map(({ v }) => v.function)
      .filter((f) => !(f in IMPLS) && !(f in GATEWAY_ONLY));
    expect(missing).toEqual([]);
  });

  it('does not keep an implementation or a gateway-only entry for a function without vectors', () => {
    const covered = new Set(vectors.map(({ v }) => v.function));
    expect(Object.keys(IMPLS).filter((f) => !covered.has(f))).toEqual([]);
    expect(Object.keys(GATEWAY_ONLY).filter((f) => !covered.has(f))).toEqual([]);
    expect(Object.keys(GATEWAY_ONLY).filter((f) => f in IMPLS)).toEqual([]);
  });

  it('only lists as gateway-only what has a stated reason', () => {
    for (const reason of Object.values(GATEWAY_ONLY)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it('has every port referenced by the code that is supposed to use it', () => {
    const direct = sourceOf(`${DATASOURCE_DIR}/direct`);
    const gateway = sourceOf(`${DATASOURCE_DIR}/gateway`);
    const unused: string[] = [];
    for (const [fn, impl] of Object.entries(IMPLS)) {
      const haystack = impl.usedBy === 'direct' ? direct : gateway;
      for (const symbol of impl.symbols) {
        if (impl.via) {
          const { caller, file } = impl.via;
          const inner = readFileSync(`${DATASOURCE_DIR}/${file}`, 'utf8');
          const uses = inner.match(new RegExp(`\\b${symbol}\\b`, 'g'))?.length ?? 0;
          // Defined once, then called at least once from the file of its caller.
          if (!new RegExp(`\\b${caller}\\b`).test(haystack) || uses < 2) {
            unused.push(`${fn}: ${symbol} is not reached through ${caller} from ${impl.usedBy}`);
          }
        } else if (!new RegExp(`\\b${symbol}\\b`).test(haystack)) {
          unused.push(`${fn}: ${symbol} is not used by ${impl.usedBy}`);
        }
      }
    }
    expect(unused).toEqual([]);
  });
});

describe.each(vectors.filter(({ v }) => v.function in IMPLS))('vectors $file', ({ v }) => {
  const impl = IMPLS[v.function];
  it.each(v.cases)(`${v.function}: $name`, (c) => {
    const actual = JSON.parse(
      JSON.stringify(impl.run(structuredClone(c.input), v.defaults ?? {}) ?? null),
    );
    const errors: string[] = [];
    subset(c.expected, actual, '$', errors);
    expect(errors).toEqual([]);
  });
});
