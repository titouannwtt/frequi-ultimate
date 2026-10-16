/**
 * Messages des pages de la refonte (Flotte, Bot, Outils, pages provisoires), fusionnés dans
 * l'espace `fq` sous `pg`. Mêmes clés que ./en.ts. Pas de tiret cadratin ; espace insécable avant
 * `:`, `?`, `!` ; espace fine insécable avant `%`.
 */
export default {
  pg: {
    placeholder: {
      title: '{name} : page en construction',
      hint: "Cette page arrive dans une prochaine étape de la refonte. Le reste de l'application fonctionne.",
      unknown: 'Page « {name} » introuvable',
    },
    toolsHint: {
      diagnostic: 'Timeline et 429 par bot, budget de requêtes, cache.',
      reconciliation: 'Wallet contre bots : aperçu avant toute correction.',
      risk: 'Stress test et risque détaillé du wallet.',
      logs: 'Journaux de tous les bots, filtrés par niveau.',
      strategyDev: 'Éditeur, validation et analyse des stratégies (Python).',
      backtest: 'Backtests et résultats (Python).',
      downloadData: 'Télécharger les bougies historiques (Python).',
      pairlistConfig: 'Configurer et évaluer la pairlist (Python).',
      replay: 'Rejouer la boucle live en dry (par bot).',
      volume: 'Comparer les volumes entre paires.',
    },
    fleet: {
      table: 'Flotte',
      tableMeta: '{n} bots · {online} en ligne',
      view: { label: 'Affichage', table: 'Table', map: 'Carte' },
      sort: {
        label: 'Tri',
        attention: "Attention d'abord",
        latent: 'Latent',
        name: 'Nom',
      },
      positions: 'Positions ouvertes',
      positionsMeta: '{n} · pires en premier',
      equity: 'Équité',
      tabs: { equity: 'Équité', leaderboard: 'Classement', calendar: 'Calendrier' },
      lbPeriod: { '1d': '1 j', '7d': '7 j', '30d': '30 j', total: 'Total' },
      risk: 'Risque wallet',
      riskMeta: 'calculé au niveau du wallet partagé',
    },
    bot: {
      pairs: 'Paires',
      chart: 'Graphique',
      timeframe: 'Unité de temps',
      openCharts: 'Ouvrir dans Graphiques',
      noPair: 'Choisissez une paire ou une position.',
      openJournal: 'Voir dans le Journal',
      perfPairs: 'P&L par paire',
      perfPartial: 'Historique partiel : seulement ce que cet onglet a chargé.',
      drawer: 'Position',
      noPosition: 'Aucune position ouverte. Le bot attend un signal.',
      notFound: 'Bot introuvable : {key}',
      notFoundHint: "Ce bot n'est pas (ou plus) dans la flotte de cet appareil.",
      tabs: {
        positions: 'Positions',
        history: 'Historique',
        performance: 'Performance',
        pairs: 'Paires et verrous',
        logs: 'Logs',
        config: 'Config',
      },
      config: {
        strategy: 'Stratégie',
        exchange: 'Exchange',
        market: 'Marché',
        stake: 'Devise de mise',
        mode: 'Mode',
        port: 'Port',
        maxTrades: 'Positions ouvertes max.',
        editLater: "L'édition avec revue du diff arrive avec la page Réglages.",
      },
    },
  },
};
