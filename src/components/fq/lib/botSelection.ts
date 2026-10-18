/**
 * The bots ticked on the Fleet (the "Bots N/M" list). Pure rules, tested without a component.
 *
 * What is stored is the bots that were UNticked, not the ticked ones: a bot that appears later is
 * ticked by default, and "everything ticked" is the empty list. The selection is read per mode (a
 * bot of another mode keeps its state while the scope shows only one mode).
 */
import type { ScopeRef } from '@/datasource/types';
import type { BotKey, BotMode } from '@/gateway/types.gen';

/** The ticked bots among `universe` (the bots of the scope's mode), order kept. */
export function selectedAmong(
  universe: readonly BotKey[],
  excluded: ReadonlySet<BotKey>,
): BotKey[] {
  return universe.filter((k) => !excluded.has(k));
}

/**
 * The new list of unticked bots once `selected` is what is ticked among `universe`. Bots outside
 * `universe` keep their state; keys the fleet no longer knows are forgotten (`known`, when the
 * fleet is loaded).
 */
export function withSelection(
  excluded: readonly BotKey[],
  universe: readonly BotKey[],
  selected: ReadonlySet<BotKey>,
  known?: ReadonlySet<BotKey>,
): BotKey[] {
  const inUniverse = new Set(universe);
  const kept = excluded.filter((k) => !inUniverse.has(k) && (!known || known.has(k)));
  return [...kept, ...universe.filter((k) => !selected.has(k))];
}

/** One bot ticked or unticked. */
export function withBotToggled(excluded: readonly BotKey[], botKey: BotKey, on: boolean): BotKey[] {
  const rest = excluded.filter((k) => k !== botKey);
  return on ? rest : [...rest, botKey];
}

/**
 * The reference the figures (profit curve, risk, drawdown) are asked for, for one trading mode:
 * the whole fleet of that mode when every bot of it is ticked (the gateway answers faster and
 * counts bots that have no history yet), otherwise the explicit list. Live and dry are never in
 * the same list: a curve is one mode at a time.
 */
export function figuresScope(
  ref: ScopeRef,
  mode: BotMode,
  modeOf: (k: BotKey) => BotMode | null,
  fleetOfMode: readonly BotKey[],
): ScopeRef {
  if (ref.kind !== 'bots') return ref;
  const keys = ref.botKeys.filter((k) => modeOf(k) === mode);
  if (keys.length > 0 && keys.length === fleetOfMode.length) return { kind: 'fleet' };
  return { kind: 'bots', botKeys: keys };
}

/** "3/12" for the button: the ticked bots over the bots of the mode. */
export function selectionLabel(selected: number, total: number): string {
  return `${selected}/${total}`;
}

/** Whether the ticked bots are exactly the members of a group (the group chip is then active). */
export function isExactly(
  selected: readonly BotKey[],
  members: readonly BotKey[],
  universe: readonly BotKey[],
): boolean {
  const inUniverse = new Set(universe);
  const want = members.filter((k) => inUniverse.has(k));
  if (want.length === 0 || want.length !== selected.length) return false;
  const have = new Set(selected);
  return want.every((k) => have.has(k));
}
