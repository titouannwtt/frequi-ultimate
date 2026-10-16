/**
 * Messages of the redesigned pages (Fleet, Bot, Tools, temporary pages), merged under the `fq`
 * namespace as `pg`. Same keys as ./fr.ts. No em dash.
 */
import charts from './charts.en';
import tools from './tools.en';
import settings from './settings.en';
import legacy from './legacy.en';

export default {
  pg: {
    charts,
    tools,
    settings,
    legacy,
    notFound: {
      title: 'Page not found',
      hint: 'This address leads nowhere. The old addresses of FreqUI still work: check the one you followed.',
      fleet: 'Back to the fleet',
    },
    toolsHint: {
      diagnostic: 'Timeline and 429s per bot, request budget, cache.',
      reconciliation: 'Wallet against bots: a preview before any fix.',
      risk: 'Stress test and detailed wallet risk.',
      logs: 'Logs of every bot, filtered by level.',
      strategyDev: 'Editor, validation and analysis of strategies (Python).',
      backtest: 'Backtests and results (Python).',
      downloadData: 'Download historical candles (Python).',
      pairlistConfig: 'Configure and evaluate the pairlist (Python).',
      replay: 'Replay the live loop in dry (per bot).',
      volume: 'Compare volumes between pairs.',
    },
    fleet: {
      table: 'Fleet',
      tableMeta: '{n} bot · {online} online | {n} bots · {online} online',
      view: { label: 'View', table: 'Table', map: 'Map' },
      sort: {
        label: 'Sort',
        attention: 'Attention first',
        latent: 'Open P&L',
        name: 'Name',
      },
      positions: 'Open positions',
      positionsMeta: '{n} · worst first',
      positionsMetaPartial: '{n} read of {total} · worst first',
      positionsAwaiting: 'positions being read',
      equity: 'Capital',
      tabs: { equity: 'Capital', leaderboard: 'Leaderboard', calendar: 'Calendar' },
      lbPeriod: { '1d': '1 d', '7d': '7 d', '30d': '30 d', total: 'Total' },
      risk: 'Wallet risk',
      riskMeta: 'computed at the shared wallet level',
    },
    bot: {
      pairs: 'Pairs',
      chart: 'Chart',
      timeframe: 'Timeframe',
      openCharts: 'Open in Charts',
      noPair: 'Pick a pair or a position.',
      openJournal: 'See in the Journal',
      perfPairs: 'P&L by pair',
      perfPartial: 'Partial history: only what this tab has loaded.',
      drawer: 'Position',
      noPosition: 'No open position. The bot is waiting for a signal.',
      tradeClosed: 'This trade is closed.',
      notFound: 'Bot not found: {key}',
      notFoundHint: 'This bot is not (or no longer) in the fleet of this device.',
      tabs: {
        positions: 'Positions',
        history: 'History',
        performance: 'Performance',
        pairs: 'Pairs and locks',
        logs: 'Logs',
        config: 'Config',
      },
      config: {
        strategy: 'Strategy',
        exchange: 'Exchange',
        market: 'Market',
        stake: 'Stake currency',
        mode: 'Mode',
        port: 'Port',
        maxTrades: 'Max open positions',
        edit: 'Edit the configuration…',
        editHint:
          'Opens the configuration file of this bot. The changes are reviewed before anything is written, and nothing is applied until the bot is reloaded.',
      },
    },
  },
};
