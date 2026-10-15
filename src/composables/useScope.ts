import { computed, reactive } from 'vue';

import type { BotKey, BotRow } from '@/gateway/types.gen';
import type { ScopeMode, Workspace } from '@/migration/schema';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { ScopeRef } from '@/datasource/types';

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

export function useScope() {
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

  const bots = computed<BotRow[]>(() => {
    const botTags = prefs.settings.fleet.botCustomTags;
    return fleet.list.filter((b) => {
      if (!modeAllows(b, mode.value)) return false;
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

  function selectBot(botKey: BotKey | null): void {
    prefs.update('selectedBot', botKey);
  }

  function reset(): void {
    filters.query = '';
    filters.groups = [];
    filters.tags = [];
    filters.attentionOnly = false;
  }

  return { mode, workspace, filters, bots, botKeys, scopeRef, selectBot, reset };
}
