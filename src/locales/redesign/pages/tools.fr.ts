/** Messages français des pages Outils (`fq.pg.tools.*`). Mêmes clés que tools.en.ts. */
export default {
  tag: { python: 'Python', perBot: 'par bot' },
  refresh: 'Actualiser',
  bot: 'Bot',
  mode: 'Mode de trading',
  reconciliation: {
    sub: 'Le wallet contre les bases des bots. Lu au plus une fois par minute ; une correction demande un aperçu, le nom du coin et un maintien de 1 s.',
    tooSoon: 'Le prochain balayage est possible dans {s} s',
    err: {
      noBot: 'Aucun bot ne répond : le wallet ne peut pas être lu.',
      source: 'Aucune source de données n’est connectée : le wallet ne peut pas être lu.',
      noServing:
        'Aucun bot n’a pu donner la réconciliation. Elle est servie par les bots qui exécutent l’outillage de flotte.',
      timeout:
        'Le balayage du wallet n’a pas répondu à temps. L’exchange est peut-être limité : aucun nouveau balayage ne part tout seul.',
      resting:
        'Le dernier balayage vient d’échouer. Le wallet est laissé au repos pour ne pas surcharger l’exchange : nouvel essai possible dans {s} s.',
      failed:
        'Le balayage du wallet a échoué. Réessayez dans un instant ; chaque essai interroge l’exchange.',
    },
  },
  diagnostic: {
    sub: 'La santé de la flotte, puis les requêtes d’un bot : les 429 et les backoffs n’existent que par bot.',
    fleet: 'Flotte',
    timeline: 'Timeline des requêtes',
    timelineHint: 'Prise sur le bot choisi ici, par ses propres métriques.',
  },
  risk: {
    sub: 'L’exposition du wallet en détail, et un stress test contre les vrais prix de liquidation.',
  },
  logs: { sub: 'Logs d’un bot ou erreurs de tous, filtrés par le serveur.' },
  volume: {
    sub: 'Volume échangé des paires d’un bot dans le temps. La réponse est gardée cinq minutes.',
  },
  replay: {
    sub: 'Rejoue la boucle live sur l’historique dans la base d’un bot dry. Effacer la base d’abord demande le nom du bot.',
    state: 'Replay',
    running: 'En cours, {p} %',
    seeded: 'Semé',
    idle: 'Jamais lancé',
    open: 'Ouvrir le replay',
    none: 'Aucun bot dry',
    noneHint: 'Le replay n’écrit que dans la base d’un bot dry.',
  },
};
