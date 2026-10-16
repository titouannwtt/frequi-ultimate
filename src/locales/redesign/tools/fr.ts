/** Messages français des composites des Outils (`fq.reconw.*`, `fq.stress.*`). Mêmes clés que ./en.ts. */
export default {
  reconw: {
    title: 'Résoudre {coin} sur le wallet',
    via: 'La requête passe par le bot {bot}',
    pickSlice: 'Tranche à fermer',
    trade: 'Trade',
    sliceAmount: 'Quantité de la tranche',
    sliceStake: 'Marge de la tranche',
    request: 'Requête qui sera envoyée',
    typeCoin: 'Saisissez {coin} pour confirmer',
    typeFirst: 'Saisissez d’abord le nom du coin',
    once: 'La requête est envoyée une seule fois. Un délai dépassé n’est pas rejoué : relisez le wallet avant de réessayer.',
    action: {
      close_unowned: 'Fermer la position du wallet qu’aucun bot ne possède',
      delete_phantom: 'Supprimer le trade fantôme de la base de son bot',
      close_minority: 'Fermer la tranche minoritaire du coin',
    },
    warn: {
      close_unowned:
        'Un ordre au marché ferme toute la position sur l’exchange, avec de l’argent réel. Aucune base de bot n’est modifiée.',
      delete_phantom:
        'Le trade est retiré de la base de son bot car le wallet ne détient rien pour lui. Aucun ordre n’est envoyé.',
      close_minority:
        'Un ordre au marché ferme cette tranche sur l’exchange, avec de l’argent réel, et le trade de son bot est clos avec elle.',
    },
    hold: {
      close_unowned: 'Maintenir pour fermer la position',
      delete_phantom: 'Maintenir pour supprimer le trade',
      close_minority: 'Maintenir pour fermer la tranche',
    },
    result: {
      accepted: 'Transmis au bot',
      rejected: 'Refusé par le bot, rien n’a été fait',
      unknown: 'Pas de réponse à temps : l’issue est inconnue',
      unauthorized: 'Session expirée, rien n’a été envoyé',
      in_progress: 'La même requête est déjà en cours',
      failed: 'La requête a échoué',
    },
    next: {
      accepted: 'Le wallet est relu pour vérifier le résultat.',
      rejected: 'Relisez le wallet avant de réessayer.',
      unknown: 'Ne la répétez pas : relisez le wallet et regardez d’abord les positions.',
      unauthorized: 'Reconnectez-vous depuis les réglages, puis recommencez.',
      in_progress: 'Attendez la fin de la première.',
      failed: 'On ne sait rien de l’issue. Relisez le wallet avant de réessayer.',
    },
  },
  stress: {
    title: 'Stress test',
    shock: 'Variation de tous les prix',
    allPrices: 'Tous les prix varient du même pourcentage',
    empty: 'Aucune position à tester',
    emptyHint: 'Aucune position ouverte dans ce mode de trading.',
    delta: 'Variation du résultat',
    deltaSub: 'sur {n} positions',
    liquidated: 'Liquidées',
    liquidatedSub: 'sur {n} positions',
    marginLost: 'Marge perdue',
    pair: 'Paire',
    bot: 'Bot',
    price: 'Prix après variation',
    liq: 'Liquidation',
    deltaCol: 'Variation',
    na: 'n/d',
    liquidatedBadge: 'Liquidée',
    more: '{n} positions de plus',
    untested:
      '{n} positions n’ont pas pu être testées entièrement (pas de prix ou pas de prix de liquidation).',
    byMarket: 'Exposition par marché',
    market: 'Marché',
    positions: 'Positions',
    mk: {
      crypto: 'Crypto',
      xyz_stocks: 'Actions HIP-3',
      xyz_indices: 'Indices HIP-3',
      xyz_commodities: 'Matières premières HIP-3',
      hip3_other: 'Autres HIP-3',
      mixed: 'Mixte',
    },
    limits:
      'Le modèle est simple : un pourcentage pour tous les prix, le prix de liquidation donné par l’exchange, toute la marge perdue en cas de liquidation. Le funding, les frais, le glissement et une marge qui bouge ne sont pas modélisés.',
  },
};
