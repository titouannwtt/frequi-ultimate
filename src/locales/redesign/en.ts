/**
 * Messages of the redesigned UI, merged under the `fq` namespace (docs/redesign/02-design.md, section 16).
 * French is the reference for the owner; English must define exactly the same keys
 * (tests/unit/redesignLocales.spec.ts). No em dash, no hard-coded string in components.
 */
export default {
  nav: {
    fleet: 'Fleet',
    bot: 'Bot',
    charts: 'Charts',
    journal: 'Journal',
    tools: 'Tools',
    settings: 'Settings',
  },
  attention: {
    title: 'Needs attention',
    active: 'Active',
    acknowledged: 'Acknowledged',
    silenced: 'Silenced',
    events: 'Events',
    sinceLastVisit: 'Since your last visit',
    markSeen: 'Mark as seen',
    allClear: 'All clear',
  },
  kpi: {
    equityOpen: 'Equity incl. open',
    equityRealized: 'Realized equity',
    drawdownOpen: 'Drawdown incl. open',
    pnlOpen: 'Open P&L',
    realizedToday: 'Realized today',
    excluded: '{n} excluded',
    excludingReplay: 'Excluding replay',
  },
  status: {
    stale: 'Stale',
    offline: 'Offline',
    starting: 'Starting',
    stopped: 'Stopped',
    sessionExpired: 'Session expired',
    reconnect: 'Reconnect',
  },
  action: {
    pauseEntries: 'Pause entries',
    resumeEntries: 'Resume entries',
    reload: 'Reload',
    exitMarket: 'Exit at market…',
    addToPosition: 'Add to position…',
    exitAll: 'Exit all…',
    holdToExitLive: 'Hold to exit with real money',
    targetBot: 'Target bot',
    sentOnce: 'Sent once, never retried automatically. Logged.',
  },
  result: {
    sent: 'Sent',
    filled: 'Filled',
    needsChecking: 'Needs checking',
    rejected: 'Rejected by bot',
  },
  freshness: {
    dataFrom: 'Data from {n} min ago',
    frozenAt: 'Values frozen at {time}',
  },
  connection: {
    direct: 'Direct mode',
    gateway: 'Gateway',
    degraded: 'Degraded',
    connecting: 'Connecting',
    unavailableDirect: 'Unavailable in direct mode',
  },
  reconcile: {
    orphan: 'Orphan position',
    reconcile: 'Reconcile (preview)',
  },
  origin: {
    unknown: 'unknown',
    since: 'since {date}',
    manual: 'manual',
  },
  side: {
    long: 'Long',
    short: 'Short',
    longLetter: 'L',
    shortLetter: 'S',
  },
  theme: {
    system: 'System',
    dark: 'Dark',
    light: 'Light',
    cycle: 'Theme: {mode}. Click to change.',
  },
};
