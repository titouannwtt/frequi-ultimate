import { computed, reactive } from 'vue';

import type { BotKey, BotMode, BotRow } from '@/gateway/types.gen';
import type { ScopeMode, Workspace } from '@/migration/schema';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { ScopeRef } from '@/datasource/types';
import {
  figuresScope,
  selectedAmong,
  withBotToggled,
  withSelection,
} from '@/components/fq/lib/botSelection';

/**
 * The FleetScope shared by every page (02 section 3.1): trading mode, search, groups, tags,
 * "needs attention" and workspace. Module level on purpose, so the selection survives navigation
 * between Fleet, Bot and Journal. Mode and workspace are also kept in the preferences (they come
 * back after a reload); the filters of the moment are not.
 */
const filters = reactive({
  query: '',
  groups: [] as string[],
  tags: [] as string[],
  attentionOnly: false,
});

export function matchesQuery(bot: BotRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    bot.identity.name,
    bot.bot_key,
    bot.identity.strategy ?? '',
    bot.identity.exchange ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

/** Live and dry are never added together; replay never belongs to a fleet scope. */
export function modeAllows(bot: BotRow, mode: ScopeMode): boolean {
  const m = bot.identity.mode;
  if (mode === 'all') return m === 'live' || m === 'dry';
  return m === mode;
}

export interface UseScopeOptions {
  /**
   * Apply the bots ticked in the "Bots N/M" list (default). The Journal turns it off: it has its
   * own bot filter, and a hidden selection would narrow it without saying so.
   */
  selection?: boolean;
}

export function useScope(options: UseScopeOptions = {}) {
  const applySelection = options.selection !== false;
  const prefs = useFqPrefsStore();
  const fleet = useFqFleetStore();

  const mode = computed<ScopeMode>({
    get: () => prefs.settings.scope.mode,
    set: (v) => prefs.update('scope', { ...prefs.settings.scope, mode: v }),
  });
  const workspace = computed<Workspace>({
    get: () => prefs.settings.scope.workspace,
    set: (v) => prefs.update('scope', { ...prefs.settings.scope, workspace: v }),
  });

  const groupKeys = computed<Set<BotKey> | null>(() => {
    if (filters.groups.length === 0) return null;
    const keys = new Set<BotKey>();
    for (const g of prefs.settings.fleet.groups) {
      if (filters.groups.includes(g.id)) g.botKeys.forEach((k) => keys.add(k));
    }
    return keys;
  });

  // ---- the bots ticked ("Bots N/M"): the exceptions are stored, see botSelection.ts ----
  const excluded = computed(() => new Set<BotKey>(prefs.settings.scope.excluded ?? []));
  /** The bots the list offers: those of the trading mode. */
  const pickable = computed<BotRow[]>(() => fleet.list.filter((b) => modeAllows(b, mode.value)));
  const pickableKeys = computed<BotKey[]>(() => pickable.value.map((b) => b.bot_key));
  const selectedKeys = computed<BotKey[]>(() => selectedAmong(pickableKeys.value, excluded.value));
  /** Some bot of the mode is unticked. */
  const narrowed = computed(
    () => applySelection && selectedKeys.value.length < pickable.value.length,
  );

  function saveExcluded(next: BotKey[]): void {
    prefs.update('scope', { ...prefs.settings.scope, excluded: next });
  }
  /** Tick exactly `keys` among the bots of the mode. */
  function setSelected(keys: Iterable<BotKey>): void {
    const known = fleet.loaded ? new Set(fleet.list.map((b) => b.bot_key)) : undefined;
    saveExcluded(
      withSelection(prefs.settings.scope.excluded ?? [], pickableKeys.value, new Set(keys), known),
    );
  }
  function toggleBot(botKey: BotKey, on: boolean): void {
    saveExcluded(withBotToggled(prefs.settings.scope.excluded ?? [], botKey, on));
  }
  const selectAll = () => setSelected(pickableKeys.value);
  const selectNone = () => setSelected([]);

  const bots = computed<BotRow[]>(() => {
    const botTags = prefs.settings.fleet.botCustomTags;
    return fleet.list.filter((b) => {
      if (!modeAllows(b, mode.value)) return false;
      if (applySelection && excluded.value.has(b.bot_key)) return false;
      if (!matchesQuery(b, filters.query)) return false;
      if (groupKeys.value && !groupKeys.value.has(b.bot_key)) return false;
      if (filters.tags.length > 0) {
        const mine = botTags[b.bot_key] ?? [];
        if (!filters.tags.every((t) => mine.includes(t))) return false;
      }
      if (filters.attentionOnly && b.alerts.count === 0) return false;
      return true;
    });
  });

  const botKeys = computed<BotKey[]>(() => bots.value.map((b) => b.bot_key));

  /** Reference sent to the queries: the selected bot, a single group, or the whole fleet. */
  const scopeRef = computed<ScopeRef>(() => {
    const sel = prefs.settings.selectedBot;
    if (sel) return { kind: 'bot', botKey: sel };
    if (filters.groups.length === 1) return { kind: 'group', id: filters.groups[0]! };
    return { kind: 'fleet' };
  });

  /**
   * Scope of the fleet views (KPI strip, curve, risk): the bots ticked and, when groups are
   * filtered, those of the group. A single group alone is that group, the whole fleet when nothing
   * narrows it, an explicit list otherwise. Unlike `scopeRef` it ignores the last selected bot.
   */
  const fleetScopeRef = computed<ScopeRef>(() => {
    if (narrowed.value) {
      const keys = selectedKeys.value.filter((k) => !groupKeys.value || groupKeys.value.has(k));
      return { kind: 'bots', botKeys: keys };
    }
    return filters.groups.length === 1
      ? { kind: 'group', id: filters.groups[0]! }
      : { kind: 'fleet' };
  });

  /**
   * The same scope for the figures of one trading mode (a curve or a drawdown never mixes live and
   * dry): the whole mode when every bot of it is ticked, the ticked ones of that mode otherwise.
   */
  function figuresScopeRef(figuresMode: BotMode): ScopeRef {
    return figuresScope(
      fleetScopeRef.value,
      figuresMode,
      (k) => fleet.bots[k]?.identity.mode ?? null,
      fleet.list.filter((b) => b.identity.mode === figuresMode).map((b) => b.bot_key),
    );
  }

  function selectBot(botKey: BotKey | null): void {
    prefs.update('selectedBot', botKey);
  }

  function reset(): void {
    filters.query = '';
    filters.groups = [];
    filters.tags = [];
    filters.attentionOnly = false;
  }

  return {
    mode,
    workspace,
    filters,
    bots,
    botKeys,
    scopeRef,
    fleetScopeRef,
    figuresScopeRef,
    pickable,
    selectedKeys,
    narrowed,
    setSelected,
    toggleBot,
    selectAll,
    selectNone,
    selectBot,
    reset,
  };
}
