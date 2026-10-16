import type { RouteLocationRaw, RouteRecordRaw } from 'vue-router';
import { createRouter, createWebHistory } from 'vue-router';

import { readLoginInfos } from '@/composables/loginInfo';
import { botKeyFromApiUrl } from '@/datasource/protocol/identity';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';

import {
  carryQuery,
  LEGACY_BOT_TABS,
  LEGACY_REDIRECTS,
  resolveBotParam,
  type BotLookup,
} from './legacy';

/**
 * Routes of FreqUI Ultimate 2 (docs/redesign/02-design.md, section 2.1). The four first-class
 * pages are Fleet (`/dashboard`), Bot (`/bot/:botKey`), Charts and Journal; Tools and Settings sit
 * behind them. Every path of the old router is kept and redirected to its new home, so a
 * bookmark never ends in a 404. Pages that still run on the legacy stores carry `meta.legacy`:
 * only they start the legacy polling (the redesigned pages read the data layer).
 */

function lookup(): BotLookup {
  const fleet = useFqFleetStore();
  const prefs = useFqPrefsStore();
  const hostname = typeof window === 'undefined' ? '' : window.location.hostname;
  return {
    logins: readLoginInfos(),
    fleetNames: Object.fromEntries(fleet.list.map((b) => [b.bot_key, b.identity.name])),
    aliases: prefs.gateway.aliases,
    selfOrigin: typeof window === 'undefined' ? '' : window.location.origin,
    localHosts: [hostname, 'localhost', '127.0.0.1', '::1'],
  };
}

/** The bot the Bot page opens when the URL names none: last selected, else the first known. */
export function defaultBotKey(): string | null {
  const prefs = useFqPrefsStore();
  const fleet = useFqFleetStore();
  const selected = prefs.settings.selectedBot;
  if (selected) return selected;
  if (fleet.list[0]) return fleet.list[0].bot_key;
  const l = lookup();
  const first = Object.values(l.logins)[0];
  if (!first) return null;
  const url = first.apiUrl || l.selfOrigin;
  return url ? botKeyFromApiUrl(url, l.localHosts) : null;
}

function botTarget(botKey: string | null, query: Record<string, string> = {}): RouteLocationRaw {
  return botKey ? { name: 'bot', params: { botKey }, query } : { path: '/login' };
}

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    redirect: (to) => ({ path: LEGACY_REDIRECTS['/'], query: carryQuery(to.query) }),
  },
  {
    path: '/dashboard',
    name: 'fleet',
    component: () => import('@/views/fq/FleetPage.vue'),
    meta: { page: 'fleet' },
  },
  {
    path: '/bot',
    name: 'bot-default',
    redirect: (to) => botTarget(defaultBotKey(), carryQuery(to.query) as Record<string, string>),
  },
  {
    path: '/bot/:botKey',
    name: 'bot',
    component: () => import('@/views/fq/BotPage.vue'),
    meta: { page: 'bot' },
  },
  {
    path: '/charts',
    name: 'charts',
    component: () => import('@/views/fq/PlaceholderPage.vue'),
    props: { id: 'charts' },
    meta: { page: 'charts' },
  },
  {
    path: '/journal',
    name: 'journal',
    // Legacy page until the Journal of the redesign lands (step 2)
    component: () => import('@/views/TradeJournalView.vue'),
    meta: { page: 'journal', legacy: true },
  },
  {
    path: '/tools',
    name: 'tools',
    component: () => import('@/views/fq/ToolsIndex.vue'),
    meta: { page: 'tools' },
  },
  {
    path: '/tools/logs',
    name: 'tools-logs',
    component: () => import('@/views/LogView.vue'),
    meta: { page: 'tools', legacy: true },
  },
  {
    path: '/tools/strategy-dev',
    name: 'tools-strategy-dev',
    component: () => import('@/views/StrategyDevView.vue'),
    meta: { page: 'tools', legacy: true },
  },
  {
    path: '/tools/backtest',
    name: 'tools-backtest',
    component: () => import('@/views/BacktestingView.vue'),
    meta: { page: 'tools', legacy: true },
  },
  {
    path: '/tools/download-data',
    name: 'tools-download-data',
    component: () => import('@/views/DownloadDataView.vue'),
    meta: { page: 'tools', legacy: true },
  },
  {
    path: '/tools/pairlist-config',
    name: 'tools-pairlist-config',
    component: () => import('@/views/PairlistConfigView.vue'),
    meta: { page: 'tools', legacy: true },
  },
  {
    path: '/tools/:tool',
    name: 'tools-placeholder',
    component: () => import('@/views/fq/PlaceholderPage.vue'),
    props: (to) => ({ id: String(to.params.tool) }),
    meta: { page: 'tools' },
  },
  {
    path: '/settings',
    name: 'settings',
    // Legacy page until the Settings of the redesign lands (step 3)
    component: () => import('@/views/SettingsViewCustom.vue'),
    meta: { page: 'settings', legacy: true },
  },
  {
    path: '/login',
    name: 'login',
    // Legacy page: it is how a bot is registered until Settings > Bots lands (step 3)
    component: () => import('@/views/LoginView.vue'),
    meta: { page: 'settings', legacy: true, allowAnonymous: true },
  },

  // ---- old paths, kept ----
  {
    path: '/trade',
    redirect: (to) => {
      const botKey = resolveBotParam(to.query.bot, lookup()) ?? defaultBotKey();
      return botTarget(botKey, carryQuery(to.query, ['bot']) as Record<string, string>);
    },
  },
  {
    path: '/open_trades',
    redirect: (to) => ({
      path: LEGACY_REDIRECTS['/open_trades'],
      query: { ...carryQuery(to.query), view: 'positions' },
    }),
  },
  ...['/balance', '/pairlist'].map(
    (path): RouteRecordRaw => ({
      path,
      redirect: (to) =>
        botTarget(resolveBotParam(to.query.bot, lookup()) ?? defaultBotKey(), {
          ...(carryQuery(to.query, ['bot']) as Record<string, string>),
          tab: LEGACY_BOT_TABS[path]!,
        }),
    }),
  ),
  ...[
    '/trade_history',
    '/logs',
    '/backtest',
    '/download_data',
    '/pairlist_config',
    '/strategy-dev',
  ].map(
    (path): RouteRecordRaw => ({
      path,
      redirect: (to) => ({ path: LEGACY_REDIRECTS[path]!, query: carryQuery(to.query) }),
    }),
  ),
  {
    path: '/(.*)*',
    name: '404',
    component: () => import('@/views/Error404View.vue'),
    meta: { allowAnonymous: true, page: 'fleet' },
  },
];

// Design system showcase: development builds, or any build opened with ?ds
if (
  import.meta.env.DEV ||
  (typeof location !== 'undefined' && new URLSearchParams(location.search).has('ds'))
) {
  routes.unshift({
    path: '/__ds',
    name: 'Design system',
    component: () => import('@/views/DesignSystemShowcase.vue'),
    meta: {
      allowAnonymous: true,
      // The showcase brings its own shell previews
      bare: true,
    },
  });
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

/** Whether this browser knows any bot (legacy logins) or has a gateway session. */
function hasAnyBot(): boolean {
  if (Object.keys(readLoginInfos()).length > 0) return true;
  return useFqPrefsStore().gateway.session !== null;
}

router.beforeEach((to) => {
  // The legacy polling only starts for the pages that still need it
  if (to.meta?.legacy) initBots();
  if (!to.meta?.allowAnonymous && !hasAnyBot()) {
    // Forward to login if login is required
    return {
      path: '/login',
      query: { redirect: to.fullPath },
    };
  }
  return true;
});

export default router;
