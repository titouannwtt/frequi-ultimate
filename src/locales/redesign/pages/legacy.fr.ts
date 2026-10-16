/** Messages des outils hérités (Backtest, Téléchargement, Pairlist), clés `fq.pg.legacy.*`. Mêmes clés que legacy.en.ts. */
export default {
  noBot: 'Aucun bot enregistré',
  noBotHint: 'Ajoutez un bot dans les Réglages pour utiliser cet outil.',
  silent: '{name} ne répond pas',
  silentHint: 'Cet outil lit le bot directement. Réessayez quand il est en ligne.',
  unavailable: 'Indisponible sur ce bot',
  unavailableHint:
    'Le bot {name} tourne en mode {mode}. Cet outil demande un bot en mode webserver : sur un bot de trading, son API répond 503.',
  use: 'Utiliser {name}',
  timerange: { start: 'Date de début', end: 'Date de fin', label: 'Plage' },
  download: {
    pairPlaceholder: 'Paire',
    timeframePlaceholder: 'Unité de temps',
    fromPairlist: 'Utiliser les paires de la config de pairlist',
    customTimerange: 'Plage de dates personnalisée',
    daysAria: 'Jours à télécharger',
    advanced: 'Options avancées',
    advancedNote:
      'Les options avancées (effacer les données, télécharger les trades, exchange personnalisé) ne sont appliquées que si cette section est ouverte.',
    erase: 'Effacer les données existantes',
    prepend: 'Ajouter les données avant l’existant',
    trades: 'Télécharger les trades au lieu des bougies',
    candleTypes: 'Types de bougies',
    candleTypesHint:
      'Sans type choisi, freqtrade télécharge lui-même les types nécessaires au fonctionnement normal.',
    customExchange: 'Exchange personnalisé',
    start: 'Lancer le téléchargement',
    needPairs: 'Ajoutez au moins une paire et une unité de temps.',
  },
  pairlist: {
    stakeCurrency: 'Devise de mise',
    customExchange: 'Exchange personnalisé',
    mustStartWithGenerator:
      'La première entrée de la pairlist doit être un générateur, comme StaticPairList ou VolumePairList.',
    dragHere: 'Glissez une pairlist ici',
    config: 'Config',
    results: 'Résultats',
    save: 'Enregistrer la configuration',
    evaluate: 'Évaluer',
    evaluateTip: 'Évaluer la pairlist',
    blacklist: 'Blacklist',
    copyFrom: 'Copier depuis',
    copy: 'Copier',
    add: 'Ajouter',
  },
};
