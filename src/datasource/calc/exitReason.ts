/**
 * Exit reason normalisation. Port of `fg-core::calc::exit_reason`.
 *
 * freqtrade stores free-form `exit_reason` strings: built-in values (`roi`, `stop_loss`,
 * `trailing_stop_loss`, `exit_signal`, `force_exit`, `liquidation`...) plus whatever a strategy
 * returns from `custom_exit`. The old UI classified them with substring tests, which made
 * `trailing_stop_loss` green and matched "sl" inside unrelated words (bug B21). Here the reason
 * is split into tokens and classified by priority. A null or empty reason is `unknown`: shown as
 * "inconnu" and counted apart, never replaced by a guess.
 */
import type { ExitClass, ExitKind, ExitReason } from '@/gateway/types.gen';

const KIND_CLASS: Record<ExitKind, ExitClass> = {
  roi: 'profit',
  take_profit: 'profit',
  stop_loss: 'protective',
  trailing_stop: 'protective',
  liquidation: 'protective',
  emergency_exit: 'protective',
  exit_signal: 'signal',
  force_exit: 'manual',
  external: 'external',
  custom: 'other',
  unknown: 'unknown',
};

export function exitKindClass(kind: ExitKind): ExitClass {
  return KIND_CLASS[kind];
}

function isTakeProfitToken(t: string): boolean {
  return t === 'takeprofit' || t === 'profit' || t === 'tp' || /^tp\d+$/.test(t);
}

function classify(raw: string): ExitKind {
  // ASCII-only lowercase and ASCII alphanumeric tokens, like the Rust implementation.
  const lower = raw.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const tokens = lower.split(/[^a-z0-9]/).filter((t) => t !== '');
  if (
    tokens.length === 0 ||
    (tokens.length === 1 && ['none', 'null', 'nan', 'unknown'].includes(tokens[0]))
  ) {
    return 'unknown';
  }
  const has = (w: string) => tokens.includes(w);
  const starts = (p: string) => tokens.some((t) => t.startsWith(p));
  const adjacent = (a: string, b: string) =>
    tokens.some((t, i) => i + 1 < tokens.length && t === a && tokens[i + 1] === b);

  if (starts('liquidat')) return 'liquidation';
  if (starts('external') || has('orphan')) return 'external';
  if (starts('force')) return 'force_exit';
  if (has('emergency')) return 'emergency_exit';
  if (has('trailing')) return 'trailing_stop';
  if (has('stoploss') || has('stop') || has('sl') || adjacent('stop', 'loss')) return 'stop_loss';
  if (has('roi')) return 'roi';
  if (tokens.some(isTakeProfitToken) || adjacent('take', 'profit')) return 'take_profit';
  if (has('signal')) return 'exit_signal';
  return 'custom';
}

/** Normalise a raw `exit_reason` (null, empty and "none" all mean unknown). */
export function normalizeExitReason(raw: string | null | undefined): ExitReason {
  const trimmed = (raw ?? '').trim();
  const kind = classify(trimmed);
  return { raw: kind === 'unknown' ? '' : trimmed, kind, class: KIND_CLASS[kind] };
}
