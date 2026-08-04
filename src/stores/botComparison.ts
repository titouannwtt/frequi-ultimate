import type {
  AlertConfigV2,
  AlertSettingConfig,
  AlertTypeDefinition,
  BotGroup,
  CustomTag,
} from '@/types/botComparison';

// ── Tag ordering ──
const ALL_TAG_IDS = ['status', 'tradingMode', 'market', 'exchange', 'stakeCurrency', 'port'] as const;
type TagId = (typeof ALL_TAG_IDS)[number];

// ── Bot tag visibility ──
interface BotTagVisibility {
  status: boolean;
  tradingMode: boolean;
  market: boolean;
  exchange: boolean;
  stakeCurrency: boolean;
  port: boolean;
  onlineSince: boolean;
}

// ── Filter state ──
interface BotFilters {
  status: { live: boolean; dry: boolean; offline: boolean };
  exchanges: Record<string, boolean>;
  currencies: Record<string, boolean>;
  tradingMode: Record<string, boolean>;
  customTags: Record<string, boolean>;
}

// ── Sort state ──
type SortDirection = 'asc' | 'desc';

interface ActiveSort {
  field: string;
  direction: SortDirection;
}

// ── Alert definitions (constant, not persisted) ──
export const ALERT_TYPES: AlertTypeDefinition[] = [
  { id: 'positionLoss', category: 'position', labelKey: 'botComparison.alertPositionLoss', descriptionKey: 'botComparison.alertPositionLossDesc', icon: 'i-mdi-trending-down', severity: 'warning', defaultEnabled: true, hasThreshold: true, thresholdMin: -100, thresholdMax: -1, thresholdDefault: -10, thresholdUnit: '%', thresholdStep: 1 },
  { id: 'positionStuck', category: 'position', labelKey: 'botComparison.alertPositionStuck', descriptionKey: 'botComparison.alertPositionStuckDesc', icon: 'i-mdi-timer-sand', severity: 'warning', defaultEnabled: false, hasThreshold: true, thresholdMin: 1.5, thresholdMax: 10, thresholdDefault: 3, thresholdUnit: 'x', thresholdStep: 0.5 },
  { id: 'nearLiquidation', category: 'position', labelKey: 'botComparison.alertNearLiquidation', descriptionKey: 'botComparison.alertNearLiquidationDesc', icon: 'i-mdi-skull-crossbones', severity: 'critical', defaultEnabled: true, hasThreshold: true, thresholdMin: 5, thresholdMax: 50, thresholdDefault: 15, thresholdUnit: '%', thresholdStep: 1 },
  { id: 'logErrors', category: 'log', labelKey: 'botComparison.alertLogErrors', descriptionKey: 'botComparison.alertLogErrorsDesc', icon: 'i-mdi-alert-octagon', severity: 'critical', defaultEnabled: true },
  { id: 'orderFailed', category: 'log', labelKey: 'botComparison.alertOrderFailed', descriptionKey: 'botComparison.alertOrderFailedDesc', icon: 'i-mdi-close-circle', severity: 'critical', defaultEnabled: true },
  { id: 'insufficientFunds', category: 'log', labelKey: 'botComparison.alertInsufficientFunds', descriptionKey: 'botComparison.alertInsufficientFundsDesc', icon: 'i-mdi-cash-remove', severity: 'warning', defaultEnabled: true },
  { id: 'exchangeError', category: 'log', labelKey: 'botComparison.alertExchangeError', descriptionKey: 'botComparison.alertExchangeErrorDesc', icon: 'i-mdi-cloud-off-outline', severity: 'warning', defaultEnabled: false },
  { id: 'walletMismatch', category: 'log', labelKey: 'botComparison.alertWalletMismatch', descriptionKey: 'botComparison.alertWalletMismatchDesc', icon: 'i-mdi-wallet-bifold', severity: 'critical', defaultEnabled: true },
  { id: 'noTradeActivity', category: 'activity', labelKey: 'botComparison.alertNoTradeActivity', descriptionKey: 'botComparison.alertNoTradeActivityDesc', icon: 'i-mdi-sleep', severity: 'info', defaultEnabled: false, hasThreshold: true, thresholdMin: 1, thresholdMax: 168, thresholdDefault: 24, thresholdUnit: 'h', thresholdStep: 1 },
  { id: 'botOffline', category: 'activity', labelKey: 'botComparison.alertBotOffline', descriptionKey: 'botComparison.alertBotOfflineDesc', icon: 'i-mdi-power-plug-off', severity: 'critical', defaultEnabled: true },
  { id: 'highDrawdown', category: 'system', labelKey: 'botComparison.alertHighDrawdown', descriptionKey: 'botComparison.alertHighDrawdownDesc', icon: 'i-mdi-chart-line-variant', severity: 'warning', defaultEnabled: false, hasThreshold: true, thresholdMin: -50, thresholdMax: -5, thresholdDefault: -15, thresholdUnit: '%', thresholdStep: 1 },
  { id: 'capacityFull', category: 'system', labelKey: 'botComparison.alertCapacityFull', descriptionKey: 'botComparison.alertCapacityFullDesc', icon: 'i-mdi-gauge-full', severity: 'info', defaultEnabled: false },
  { id: 'allFundsExposed', category: 'position', labelKey: 'botComparison.alertAllFundsExposed', descriptionKey: 'botComparison.alertAllFundsExposedDesc', icon: 'i-mdi-cash-lock', severity: 'warning', defaultEnabled: true },
  { id: 'liquidationBeforeStoploss', category: 'position', labelKey: 'botComparison.alertLiquidationBeforeStoploss', descriptionKey: 'botComparison.alertLiquidationBeforeStoplossDesc', icon: 'i-mdi-shield-alert', severity: 'critical', defaultEnabled: true },
];

export const ALERT_CATEGORIES: { id: string; labelKey: string }[] = [
  { id: 'position', labelKey: 'botComparison.alertCategoryPosition' },
  { id: 'log', labelKey: 'botComparison.alertCategoryLog' },
  { id: 'activity', labelKey: 'botComparison.alertCategoryActivity' },
  { id: 'system', labelKey: 'botComparison.alertCategorySystem' },
];

function defaultAlertConfig(): AlertConfigV2 {
  const global: Record<string, AlertSettingConfig> = {};
  for (const at of ALERT_TYPES) {
    global[at.id] = { enabled: at.defaultEnabled, threshold: at.thresholdDefault, includeLeverage: false };
  }
  return { global, perBotEnabled: {} };
}

function defaultBotTagVisibility(): BotTagVisibility {
  return { status: true, tradingMode: true, market: true, exchange: true, stakeCurrency: true, port: true, onlineSince: true };
}

function defaultBotFilters(): BotFilters {
  return { status: { live: true, dry: true, offline: true }, exchanges: {}, currencies: {}, tradingMode: {}, customTags: {} };
}

export const useBotComparisonStore = defineStore('botComparison', {
  state: () => ({
    // ── Summary currency ──
    summaryCurrency: 'auto' as string,

    // ── Columns ──
    visibleColumnIds: [] as string[],
    columnOrder: [] as string[],

    // ── Tags ──
    botTagVisibility: defaultBotTagVisibility() as BotTagVisibility,
    tagOrder: [...ALL_TAG_IDS] as TagId[],
    customTags: [] as CustomTag[],
    botCustomTags: {} as Record<string, string[]>,

    // ── Sort ──
    activeSort: null as ActiveSort | null,

    // ── Filters ──
    botFilters: defaultBotFilters() as BotFilters,

    // ── Bot order ──
    botOrder: [] as string[],

    // ── Alerts ──
    alertConfig: defaultAlertConfig() as AlertConfigV2,

    // ── Groups ──
    botGroups: [] as BotGroup[],

    // ── Notifications ──
    browserNotificationsEnabled: false,
    notificationTypes: {
      positionLoss: true,
      botOffline: true,
      logErrors: true,
    },
  }),

  getters: {
    orderedVisibleTags(state): TagId[] {
      return state.tagOrder.filter((id) => state.botTagVisibility[id as keyof BotTagVisibility]);
    },
  },

  actions: {
    // ── Summary currency ──
    setSummaryCurrency(val: string) {
      this.summaryCurrency = val;
    },

    // ── Columns ──
    initColumns(allColumnIds: string[], defaultColumnIds: string[]) {
      // Only init if empty (first load)
      if (this.visibleColumnIds.length === 0) {
        this.visibleColumnIds = defaultColumnIds;
      } else {
        // Only add columns that are genuinely new (not in columnOrder yet).
        // If a column is in columnOrder but not visibleColumnIds, the user removed it.
        for (const id of defaultColumnIds) {
          if (!this.visibleColumnIds.includes(id) && !this.columnOrder.includes(id)) {
            const lastIdx = Math.max(
              ...defaultColumnIds.map((d) => this.visibleColumnIds.indexOf(d)).filter((i) => i >= 0),
              0,
            );
            this.visibleColumnIds.splice(lastIdx + 1, 0, id);
          }
        }
      }
      if (this.columnOrder.length === 0) {
        this.columnOrder = allColumnIds;
      } else {
        // Merge new columns at their natural position — right after the nearest
        // preceding column that already exists in the user's order — instead of
        // appending to the end. Keeps e.g. profitCurrent next to closedProfit.
        const missing = allColumnIds.filter((id) => !this.columnOrder.includes(id));
        for (const id of missing) {
          const idxInAll = allColumnIds.indexOf(id);
          let insertAt = this.columnOrder.length;
          for (let i = idxInAll - 1; i >= 0; i--) {
            const prevPos = this.columnOrder.indexOf(allColumnIds[i]!);
            if (prevPos >= 0) {
              insertAt = prevPos + 1;
              break;
            }
          }
          this.columnOrder.splice(insertAt, 0, id);
        }
        // Remove stale columns
        this.columnOrder = this.columnOrder.filter((id) => allColumnIds.includes(id));
      }
    },

    resetColumns() {
      this.visibleColumnIds = [];
      this.columnOrder = [];
    },

    // ── Tags ──
    ensureTagOrder() {
      const valid = this.tagOrder.filter((id) => ALL_TAG_IDS.includes(id));
      const missing = ALL_TAG_IDS.filter((id) => !valid.includes(id as TagId));
      if (missing.length > 0) {
        this.tagOrder = [...valid, ...missing] as TagId[];
      }
      // Heal persisted visibility maps that predate newly-added tags (a missing
      // key reads as undefined → the tag would silently stay hidden forever).
      const defVis = defaultBotTagVisibility();
      for (const key of Object.keys(defVis) as (keyof BotTagVisibility)[]) {
        if (this.botTagVisibility[key] === undefined) {
          this.botTagVisibility[key] = defVis[key];
        }
      }
    },

    // ── Alerts ──
    resetAlertConfig() {
      this.alertConfig = defaultAlertConfig();
    },

    getGlobalAlertSetting(alertId: string): AlertSettingConfig {
      return this.alertConfig.global[alertId] || { enabled: false };
    },

    setGlobalAlertEnabled(alertId: string, enabled: boolean) {
      if (!this.alertConfig.global[alertId]) {
        const at = ALERT_TYPES.find((a) => a.id === alertId);
        this.alertConfig.global[alertId] = { enabled, threshold: at?.thresholdDefault };
      } else {
        this.alertConfig.global[alertId].enabled = enabled;
      }
    },

    // ── Filters ──
    ensureFilterFields() {
      if (!this.botFilters.tradingMode) this.botFilters.tradingMode = {};
      if (!this.botFilters.customTags) this.botFilters.customTags = {};
    },

    // ── Groups / Folders ──
    // Shared between the comparison table and the "Available bots" list so a bot's
    // folder membership stays consistent across both views (single source of truth).
    createGroup(name: string, icon = ''): BotGroup | undefined {
      const trimmed = name.trim();
      if (!trimmed) return undefined;
      const group: BotGroup = {
        id: `group_${Date.now()}`,
        name: trimmed,
        icon: icon.trim(),
        collapsed: false,
        botIds: [],
      };
      this.botGroups.push(group);
      return group;
    },
    deleteGroup(groupId: string) {
      this.botGroups = this.botGroups.filter((g) => g.id !== groupId);
    },
    renameGroup(groupId: string, name: string, icon?: string) {
      const group = this.botGroups.find((g) => g.id === groupId);
      if (!group) return;
      const trimmed = name.trim();
      if (trimmed) group.name = trimmed;
      if (icon !== undefined) group.icon = icon.trim();
    },
    toggleGroupCollapse(groupId: string) {
      const group = this.botGroups.find((g) => g.id === groupId);
      if (group) group.collapsed = !group.collapsed;
    },
    addBotToGroup(botId: string, groupId: string) {
      // A bot belongs to at most one group — remove from any other first.
      for (const g of this.botGroups) {
        g.botIds = g.botIds.filter((id) => id !== botId);
      }
      const group = this.botGroups.find((g) => g.id === groupId);
      if (group && !group.botIds.includes(botId)) {
        group.botIds.push(botId);
      }
    },
    removeBotFromGroup(botId: string) {
      for (const g of this.botGroups) {
        g.botIds = g.botIds.filter((id) => id !== botId);
      }
    },
    getBotGroupId(botId: string): string | undefined {
      return this.botGroups.find((g) => g.botIds.includes(botId))?.id;
    },
    getGroupForBot(botId: string): BotGroup | undefined {
      return this.botGroups.find((g) => g.botIds.includes(botId));
    },

    // ── Migration from old localStorage keys ──
    migrateFromLocalStorage() {
      // Only migrate if the new store key doesn't exist yet
      if (localStorage.getItem('ftBotComparison')) return;

      const OLD_KEYS = {
        summaryCurrency: 'ft_summary_currency',
        visibleColumnIds: 'ft_comparison_columns',
        botTagVisibility: 'ft_bot_tags',
        customTags: 'ft_custom_tags',
        botCustomTags: 'ft_bot_custom_tags',
        tagOrder: 'ft_bot_tag_order',
        activeSort: 'ft_bot_sort',
        botFilters: 'ft_bot_filters',
        columnOrder: 'ft_comparison_column_order',
        botOrder: 'ft_bot_order',
        alertConfig: 'ft_bot_alerts_v2',
        botGroups: 'ft_bot_groups',
        browserNotificationsEnabled: 'ft_notifications_enabled',
        notificationTypes: 'ft_notification_types',
      };

      let migrated = false;

      // String value
      const cur = localStorage.getItem(OLD_KEYS.summaryCurrency);
      if (cur) { this.summaryCurrency = cur; migrated = true; }

      // Boolean stored as string
      const notifEnabled = localStorage.getItem(OLD_KEYS.browserNotificationsEnabled);
      if (notifEnabled) { this.browserNotificationsEnabled = notifEnabled === 'true'; migrated = true; }

      // JSON values
      const jsonMappings: [keyof typeof OLD_KEYS, string][] = [
        ['visibleColumnIds', OLD_KEYS.visibleColumnIds],
        ['botTagVisibility', OLD_KEYS.botTagVisibility],
        ['customTags', OLD_KEYS.customTags],
        ['botCustomTags', OLD_KEYS.botCustomTags],
        ['tagOrder', OLD_KEYS.tagOrder],
        ['activeSort', OLD_KEYS.activeSort],
        ['botFilters', OLD_KEYS.botFilters],
        ['columnOrder', OLD_KEYS.columnOrder],
        ['botOrder', OLD_KEYS.botOrder],
        ['alertConfig', OLD_KEYS.alertConfig],
        ['botGroups', OLD_KEYS.botGroups],
        ['notificationTypes', OLD_KEYS.notificationTypes],
      ];

      for (const [field, key] of jsonMappings) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            (this as any)[field] = JSON.parse(raw);
            migrated = true;
          } catch { /* ignore malformed data */ }
        }
      }

      if (migrated) {
        // Merge defaults for alert config (new alert types)
        const def = defaultAlertConfig();
        for (const at of ALERT_TYPES) {
          if (!this.alertConfig.global[at.id]) {
            this.alertConfig.global[at.id] = def.global[at.id];
          }
        }
        this.ensureFilterFields();

        // Clean up old keys
        for (const key of Object.values(OLD_KEYS)) {
          localStorage.removeItem(key);
        }
        console.log('[botComparison] Migrated from legacy localStorage keys');
      }
    },
  },

  persist: {
    key: 'ftBotComparison',
  },
});

// ── Re-export types for consumers ──
export type { BotTagVisibility, BotFilters, ActiveSort, SortDirection, TagId };

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useBotComparisonStore, import.meta.hot));
}
