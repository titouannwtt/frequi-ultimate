/**
 * Log stream helpers (02 section 3.5, C7). They replace what the old `logConsole` store got wrong
 * (bug B13): the timeout controller was created but never given to the request, so a slow bot held
 * the whole sweep, and the dedup key (bot + timestamp + module + the first 40 characters) merged two
 * different lines that start alike and let a re-sent line through when its text changed.
 */
import type { LogLine } from '@/gateway/types.gen';

export type LogLevel = 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG';

export const LOG_LEVELS: LogLevel[] = ['CRITICAL', 'ERROR', 'WARNING', 'INFO', 'DEBUG'];

const RANK: Record<string, number> = {
  DEBUG: 0,
  INFO: 1,
  WARNING: 2,
  WARN: 2,
  ERROR: 3,
  CRITICAL: 4,
};

/** Severity rank of a level (unknown levels rank as INFO). */
export function levelRank(level: string): number {
  return RANK[level.toUpperCase()] ?? 1;
}

export function normalizeLevel(level: string): LogLevel {
  const up = level.toUpperCase();
  if (up === 'WARN') return 'WARNING';
  return (LOG_LEVELS as string[]).includes(up) ? (up as LogLevel) : 'INFO';
}

/** One displayed line: a gateway line with its origin and a stable identity. */
export interface LogEntry {
  /** Identity for the key and the dedup, see `entryId`. */
  id: string;
  botKey: string | null;
  ts_ms: number;
  level: LogLevel;
  /** First line of the message. */
  message: string;
  /** Traceback or continuation lines, null when the message has one line. */
  detail: string | null;
}

/** Message split at the first newline: the line and its exception. */
export function splitMessage(raw: string): { message: string; detail: string | null } {
  const i = raw.indexOf('\n');
  if (i < 0) return { message: raw, detail: null };
  const detail = raw.slice(i + 1).trim();
  return { message: raw.slice(0, i), detail: detail === '' ? null : detail };
}

/**
 * Base identity of a line: bot, millisecond, level and the WHOLE text. Two lines that differ
 * anywhere in their text never collide (the old key cut the text at 40 characters).
 */
export function baseId(botKey: string | null, line: LogLine): string {
  return `${botKey ?? '*'}|${line.ts_ms}|${line.level.toUpperCase()}|${line.message}`;
}

/**
 * Entries of one batch received together. A genuine repetition (the same text twice in the same
 * millisecond) gets an occurrence suffix so both survive; the same batch received again produces
 * the same ids, which is what lets a refetch be merged without duplicating anything.
 */
export function toEntries(botKey: string | null, lines: readonly LogLine[]): LogEntry[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = baseId(botKey, l);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const { message, detail } = splitMessage(l.message);
    return {
      id: n === 0 ? base : `${base}#${n}`,
      botKey,
      ts_ms: l.ts_ms,
      level: normalizeLevel(l.level),
      message,
      detail,
    };
  });
}

/** Newest first, capped. Entries already present (same id) are kept once. */
export function mergeEntries(
  existing: readonly LogEntry[],
  incoming: readonly LogEntry[],
  cap = 500,
): LogEntry[] {
  const ids = new Set<string>();
  const out: LogEntry[] = [];
  for (const e of [...incoming, ...existing]) {
    if (ids.has(e.id)) continue;
    ids.add(e.id);
    out.push(e);
  }
  out.sort((a, b) => b.ts_ms - a.ts_ms || a.id.localeCompare(b.id));
  return out.length > cap ? out.slice(0, cap) : out;
}

export interface LogFilter {
  /** Lines at this level or worse. */
  level: LogLevel;
  query: string;
  botKey: string | null;
}

export function filterEntries(entries: readonly LogEntry[], f: LogFilter): LogEntry[] {
  const min = levelRank(f.level);
  const q = f.query.trim().toLowerCase();
  return entries.filter(
    (e) =>
      levelRank(e.level) >= min &&
      (f.botKey === null || e.botKey === f.botKey) &&
      (q === '' ||
        e.message.toLowerCase().includes(q) ||
        (e.detail ?? '').toLowerCase().includes(q)),
  );
}

export class TimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`timed out after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Reject after `ms`, whatever the promise does (bug B13: the old timeout was never connected to
 * the request). The late result of the original promise is ignored; the caller must not assume the
 * request was cancelled, only that it stopped waiting for it.
 */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
