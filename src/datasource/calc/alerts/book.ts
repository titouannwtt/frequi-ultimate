/**
 * Alert lifecycle: hysteresis, deduplication, acknowledgement, silences, re-alert. Port of
 * `fg-core::alerts::book`.
 *
 * - Deduplication is on `(type_id, bot_key, subject)`. The message is not part of the key (it used
 *   to be, so a counter in the text created a new alert at every refresh, bug B27).
 * - Hysteresis: a condition becomes `firing` after its `for` delay (0 for critical ones) and is
 *   `resolved` after two consecutive evaluations without it. A condition that disappears before
 *   firing is dropped silently.
 * - Acknowledgement holds until resolution. An acknowledged alert comes back (re-alert) when its
 *   severity rises or when its value worsens by the rule's `re_alert_step`.
 * - Silence mutes a rule, a bot or a subject until a date. A silence never hides the alert from the
 *   book, it only flags it, so the UI can list it under "silenced".
 * - A rule that could not be evaluated (stale data) leaves its alerts untouched.
 *
 * In direct mode this book lives in the open tab only: no 24/7 evaluation, no ack shared between
 * devices (02 section 10.4).
 */
import type {
  Alert,
  AlertTransition,
  AlertTypeId,
  AlertView,
  Condition,
  Evaluation,
  Severity,
  Silence,
  TransitionKind,
} from '@/gateway/types.gen';
import type { AlertSummary } from '@/gateway/types.gen';

import { ALERT_TYPE_IDS, ruleMeta, SEVERITY_RANK } from './rules';

/** Evaluations without the condition before a firing alert resolves. */
export const RESOLVE_AFTER_MISSES = 2;

interface Ack {
  at_ms: number;
  session: string | null;
  severity: Severity;
  value: number | null;
}

/** An alert plus its bookkeeping. */
export interface Tracked {
  alert: Alert;
  for_ms: number;
  misses: number;
  ack: Ack | null;
}

/** Serializable state of a book. */
export interface BookState {
  tracked: Tracked[];
  silences: Silence[];
  next_silence: number;
}

export class BookError extends Error {
  constructor(public readonly code: 'unknown_alert' | 'silence_in_past' | 'unknown_silence') {
    super(code);
    this.name = 'BookError';
  }
}

/** Display state of a firing alert at `nowMs`; null for pending or resolved alerts. */
export function alertView(a: Alert, nowMs: number): AlertView | null {
  if (a.state !== 'firing') {
    return null;
  }
  if (a.silenced_until_ms != null && a.silenced_until_ms > nowMs) {
    return 'silenced';
  }
  return a.acked_at_ms != null ? 'acked' : 'active';
}

const typeRank = (t: AlertTypeId) => ALERT_TYPE_IDS.indexOf(t);

/** Option ordering of Rust: None < Some, strings by code unit. */
function cmpOpt(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

interface Key {
  type_id: AlertTypeId;
  bot_key: string | null;
  subject: string | null;
}

function cmpKey(a: Key, b: Key): number {
  return (
    typeRank(a.type_id) - typeRank(b.type_id) ||
    cmpOpt(a.bot_key, b.bot_key) ||
    cmpOpt(a.subject, b.subject)
  );
}

const keyId = (k: Key) => JSON.stringify([k.type_id, k.bot_key, k.subject]);

/**
 * Stable id for one episode, new when the alert fires again after having resolved. The gateway
 * hashes the same fields with blake3; ids never travel between the two modes, so a plain readable
 * string is enough here.
 */
export function alertId(
  typeId: AlertTypeId,
  botKey: string | null,
  subject: string | null,
  sinceMs: number,
): string {
  return `${typeId}|${botKey ?? ''}|${subject ?? ''}|${sinceMs}`;
}

function silenceMatches(s: Silence, a: Alert): boolean {
  return (
    (s.type_id == null || s.type_id === a.type_id) &&
    (s.bot_key == null || s.bot_key === a.bot_key) &&
    (s.subject == null || s.subject === a.subject)
  );
}

function decorate(a: Alert, silences: readonly Silence[], nowMs: number): Alert {
  let until: number | null = null;
  for (const s of silences) {
    if (s.until_ms > nowMs && silenceMatches(s, a)) {
      until = until === null ? s.until_ms : Math.max(until, s.until_ms);
    }
  }
  return { ...a, silenced_until_ms: until };
}

/**
 * Whether an alert is worse than when it was acknowledged: a higher severity, or a value that
 * moved by at least the rule's re-alert step in the bad direction.
 */
function worsened(ack: Ack, a: Alert): boolean {
  if (SEVERITY_RANK[a.severity] > SEVERITY_RANK[ack.severity]) {
    return true;
  }
  const meta = ruleMeta(a.type_id);
  if (meta.re_alert_step != null && ack.value != null && a.value != null) {
    return meta.direction === 'higher_is_worse'
      ? a.value - ack.value >= meta.re_alert_step
      : ack.value - a.value >= meta.re_alert_step;
  }
  return false;
}

/** The set of alerts of the fleet. */
export class AlertBook {
  private tracked = new Map<string, Tracked>();
  private silences: Silence[] = [];
  private nextSilence = 0;

  static fromState(state: BookState): AlertBook {
    const b = new AlertBook();
    for (const t of state.tracked) {
      const copy = structuredClone(t);
      // A state saved before the pair existed has no such key
      copy.alert.pair ??= null;
      b.tracked.set(keyId(t.alert), copy);
    }
    b.silences = structuredClone(state.silences);
    b.nextSilence = state.next_silence;
    return b;
  }

  toState(): BookState {
    return {
      tracked: [...this.sortedTracked()].map((t) => structuredClone(t)),
      silences: structuredClone(this.silences),
      next_silence: this.nextSilence,
    };
  }

  private sortedTracked(): Tracked[] {
    return [...this.tracked.values()].sort((a, b) => cmpKey(a.alert, b.alert));
  }

  /** Fold the evaluation of one bot into the book. */
  evaluateBot(nowMs: number, botKey: string, ev: Evaluation): AlertTransition[] {
    const out: AlertTransition[] = [];
    const seen = new Set<string>();
    for (const c of ev.conditions) {
      const key: Key = { type_id: c.type_id, bot_key: botKey, subject: c.subject };
      seen.add(keyId(key));
      this.applyCondition(nowMs, key, c, out);
    }
    // Existing alerts of this bot that were not reported this time, in key order.
    const keys = this.sortedTracked()
      .map((t) => t.alert)
      .filter((a) => a.bot_key === botKey && !seen.has(keyId(a)));
    for (const a of keys) {
      const key: Key = { type_id: a.type_id, bot_key: a.bot_key, subject: a.subject };
      if (ev.disabled.includes(key.type_id)) {
        this.dropAlert(nowMs, key, out);
      } else if (ev.evaluated.includes(key.type_id)) {
        const t = this.tracked.get(keyId(key));
        if (!t) continue;
        t.misses = Math.min(t.misses + 1, 255);
        const gone = t.alert.state === 'firing' ? t.misses >= RESOLVE_AFTER_MISSES : true;
        if (gone) {
          this.dropAlert(nowMs, key, out);
        }
      }
      // Not evaluated (stale data): left untouched.
    }
    return out;
  }

  /**
   * Fold a wallet-level condition (no bot) into the book. Call with `cond` null to record an
   * evaluation without the condition.
   */
  evaluateWallet(
    nowMs: number,
    typeId: AlertTypeId,
    subject: string | null,
    cond: Condition | null,
  ): AlertTransition[] {
    const out: AlertTransition[] = [];
    const key: Key = { type_id: typeId, bot_key: null, subject };
    if (cond) {
      this.applyCondition(nowMs, key, cond, out);
    } else {
      const t = this.tracked.get(keyId(key));
      if (t) {
        t.misses = Math.min(t.misses + 1, 255);
        if (t.alert.state !== 'firing' || t.misses >= RESOLVE_AFTER_MISSES) {
          this.dropAlert(nowMs, key, out);
        }
      }
    }
    return out;
  }

  private applyCondition(nowMs: number, key: Key, c: Condition, out: AlertTransition[]): void {
    const id = keyId(key);
    let entry = this.tracked.get(id);
    if (!entry) {
      entry = {
        alert: {
          id: alertId(key.type_id, key.bot_key, key.subject, nowMs),
          type_id: key.type_id,
          bot_key: key.bot_key,
          subject: key.subject,
          pair: c.pair ?? null,
          severity: c.severity,
          value: c.value,
          threshold: c.threshold,
          since_ms: nowMs,
          last_seen_ms: nowMs,
          state: 'pending',
          acked_at_ms: null,
          acked_by_session: null,
          silenced_until_ms: null,
          detail: c.detail,
        },
        for_ms: c.for_ms,
        misses: 0,
        ack: null,
      };
      this.tracked.set(id, entry);
    }
    const prevSeverity = entry.alert.severity;
    entry.misses = 0;
    entry.for_ms = c.for_ms;
    entry.alert.severity = c.severity;
    entry.alert.value = c.value;
    entry.alert.threshold = c.threshold;
    entry.alert.detail = c.detail;
    entry.alert.pair = c.pair ?? null;
    entry.alert.last_seen_ms = nowMs;

    let kind: TransitionKind | null = null;
    if (entry.alert.state === 'pending') {
      if (nowMs - entry.alert.since_ms >= entry.for_ms) {
        entry.alert.state = 'firing';
        kind = 'raised';
      }
    } else if (entry.alert.state === 'firing') {
      if (entry.ack) {
        if (worsened(entry.ack, entry.alert)) {
          entry.ack = null;
          entry.alert.acked_at_ms = null;
          entry.alert.acked_by_session = null;
          kind = 're_alerted';
        }
      } else if (SEVERITY_RANK[c.severity] > SEVERITY_RANK[prevSeverity]) {
        kind = 'escalated';
      }
    }
    if (kind) {
      out.push({ kind, alert: decorate(entry.alert, this.silences, nowMs) });
    }
  }

  private dropAlert(nowMs: number, key: Key, out: AlertTransition[]): void {
    const id = keyId(key);
    const t = this.tracked.get(id);
    if (!t) return;
    this.tracked.delete(id);
    if (t.alert.state === 'firing') {
      t.alert.state = 'resolved';
      t.alert.last_seen_ms = nowMs;
      out.push({ kind: 'resolved', alert: decorate(t.alert, this.silences, nowMs) });
    }
  }

  /** Acknowledge an alert by id. Holds until the alert resolves (or worsens, see module docs). */
  ack(alertIdValue: string, session: string | null, nowMs: number): void {
    const t = [...this.tracked.values()].find((x) => x.alert.id === alertIdValue);
    if (!t) {
      throw new BookError('unknown_alert');
    }
    t.ack = { at_ms: nowMs, session, severity: t.alert.severity, value: t.alert.value };
    t.alert.acked_at_ms = nowMs;
    t.alert.acked_by_session = session;
  }

  /** Mute alerts matching the given fields until `untilMs`. Returns the silence id. */
  silence(
    typeId: AlertTypeId | null,
    botKey: string | null,
    subject: string | null,
    untilMs: number,
    nowMs: number,
  ): string {
    if (untilMs <= nowMs) {
      throw new BookError('silence_in_past');
    }
    this.nextSilence += 1;
    const id = `s${this.nextSilence}`;
    this.silences.push({ id, type_id: typeId, bot_key: botKey, subject, until_ms: untilMs });
    return id;
  }

  unsilence(id: string): void {
    const before = this.silences.length;
    this.silences = this.silences.filter((s) => s.id !== id);
    if (this.silences.length === before) {
      throw new BookError('unknown_silence');
    }
  }

  /** Drop expired silences. */
  prune(nowMs: number): void {
    this.silences = this.silences.filter((s) => s.until_ms > nowMs);
  }

  getSilences(): readonly Silence[] {
    return this.silences;
  }

  /**
   * Firing alerts in a deterministic order: worst first, then oldest, then catalog order of the
   * rule, bot key and subject, with their silence resolved at `nowMs`.
   */
  alerts(nowMs: number): Alert[] {
    return [...this.tracked.values()]
      .filter((t) => t.alert.state === 'firing')
      .map((t) => decorate(t.alert, this.silences, nowMs))
      .sort(
        (a, b) =>
          SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
          a.since_ms - b.since_ms ||
          typeRank(a.type_id) - typeRank(b.type_id) ||
          cmpOpt(a.bot_key, b.bot_key) ||
          cmpOpt(a.subject, b.subject),
      );
  }

  /**
   * Count and worst severity of the active alerts (firing, neither acknowledged nor silenced) of a
   * bot, or of the whole fleet when `botKey` is null.
   */
  summary(botKey: string | null, nowMs: number): AlertSummary {
    const s: AlertSummary = { count: 0, max_severity: null };
    for (const a of this.alerts(nowMs)) {
      if (botKey !== null && a.bot_key !== botKey) continue;
      if (alertView(a, nowMs) === 'active') {
        s.count += 1;
        s.max_severity =
          s.max_severity === null || SEVERITY_RANK[a.severity] > SEVERITY_RANK[s.max_severity]
            ? a.severity
            : s.max_severity;
      }
    }
    return s;
  }

  /** Number shown on the bell: active critical and warning alerts (information does not count). */
  bellCount(nowMs: number): number {
    return this.alerts(nowMs).filter(
      (a) => alertView(a, nowMs) === 'active' && SEVERITY_RANK[a.severity] >= SEVERITY_RANK.warning,
    ).length;
  }
}
