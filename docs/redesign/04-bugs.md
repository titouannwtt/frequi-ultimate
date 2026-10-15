# 04 - Registre des bugs

Tout bug rencontré pendant la refonte est consigné ici, avec sa cause, sa correction et le test qui l'empêche de revenir.
Statuts : `corrigé` (avec commit), `corrigé par la refonte` (le code fautif disparaît, le test vise le nouveau code), `ouvert`.

| # | Gravité | Bug | Cause | Statut | Correction / test |
|---|---|---|---|---|---|
| B1 | Critique (argent réel) | Sortie partielle et renfort depuis une vue multi-bots envoyés au bot actif, pas au bot du trade | `ForceExitForm` / `ForceEntryForm` utilisaient `botStore.activeBot` ; le menu du trade stoppe la propagation du clic, la ligne n'est jamais sélectionnée ; `trade_id` n'est unique que par bot | corrigé (`186ff0ff`, déployé en production le 2026-10-15) | `utils/targetBot.ts` + `tests/unit/targetBot.spec.ts` ; le renfort garde le sens de la position ; verrou anti double clic |
| B2 | Critique (argent réel) | La confirmation de forceexit peut être désactivée globalement (`confirmDialog`) | Réglage hérité d'upstream | ouvert : la refonte rend la confirmation obligatoire pour toute action argent réel | |
| B3 | Majeur | Pas de verrou anti double clic sur le dialogue de sortie totale | `forceExitExecuter` sans état d'envoi | ouvert (refonte : `useBotAction`) | |
| B4 | Majeur | Le client HTTP rejoue la requête après un échec de rafraîchissement du token | `composables/api.ts:75-93` | ouvert | |
| B5 | Majeur | L'alerte `noTradeActivity` ne se déclenche jamais | Secondes comparées à des millisecondes | ouvert (moteur d'alertes de la passerelle) | |
| B6 | Majeur | `allFundsExposed` lit un champ absent | | ouvert (moteur d'alertes) | |
| B7 | Mineur | Le popover de configuration des alertes n'a aucun déclencheur | | ouvert (refonte) | |
| B8 | Mineur | Le tri `currentProfit` est inopérant | | ouvert (refonte FleetTable) | |
| B9 | Mineur | Taux EUR jamais chargé | `exchangeRates.ts` | ouvert (conversion supprimée ou faite serveur) | |
| B10 | Majeur | Capital de départ faux sur wallet partagé dans 3 widgets sur 4 | `balance.total` sommé au lieu de `starting_capital` | ouvert (calcul unique côté passerelle) | |
| B11 | Mineur | Pagination de `ClosedTradesEnhanced` cassée | | ouvert (TradeTable) | |
| B12 | Mineur | Événements DCA synthétiques faux dans `ActivityTimeline`, filtres `bot_status` / `alert` morts | | ouvert (EventFeed) | |
| B13 | Mineur | Timeout jamais appliqué dans `logConsole`, dédup fragile | | ouvert (LogStream) | |
| B14 | Mineur | Token WebSocket jamais renouvelé | | ouvert (WS multiplexé de la passerelle) | |
| B15 | Mineur | Gate du graphique dans `TradingView.vue` (~265) | | ouvert | |
| B16 | Mineur | Même libellé pour deux options dans les réglages UI | `SettingsViewCustom.vue` | ouvert | |
| B17 | Mineur | Ids DOM `btn-actions-<trade_id>` dupliqués entre bots | | ouvert (refonte) | |
| B18 | Outillage | 88 erreurs `vue-tsc` sur `main` (RunDetailHeader 14, tradeChartData 6, BotComparisonList 6, locales, ...) | Dette de typage | ouvert : la branche de refonte doit finir à 0 erreur | `pnpm typecheck` |
| B19 | Outillage | 2 tests unitaires en échec sur `main` : `ProfitPill` (« 0.0 profits ») et `getProfitPeriodCutoff` (bornes mois/année) | `ProfitPill.spec.ts` attend la classe `profit-pill` alors que le composant émet `ft-profit-pill` (test périmé) ; `botProfit.spec.ts` échoue sur les bornes calendaires 3 mois (fuseau ou heure d'été) | ouvert | `pnpm test:unit` |
| B20 | Doc | Le README annonce `--ui-version github://...`, que `install-ui` ne sait pas lire | | ouvert | |
| B21 | Mineur | Une prop booléenne absente vaut `false` en Vue : `DataTable.virtual` ne passait jamais en automatique au-dessus de 100 lignes et `IconBtn` posait `aria-pressed="false"` sur chaque bouton, comme s'il était à bascule | Vue convertit une prop `Boolean` non fournie en `false` ; le code testait `=== undefined` | corrigé (primitives `ds`, avant le premier commit) : défaut explicite `undefined` | `tests/component/ds/Primitives.spec.ts` (« Boolean props that must stay undefined when absent »), `DataTable.spec.ts` (fenêtre virtuelle) |
| B22 | Mineur | Les primitives `Badge`, `Tabs`, `Menu`, `Popover`, `Skeleton`, `Switch` portent le nom de composants PrimeVue que les pages héritées importent automatiquement ; `unplugin-vue-components` donne la priorité aux dossiers locaux et aurait remplacé ces composants en silence | Enregistrement automatique de `src/components/**` | corrigé : `src/components/ds` exclu de l'enregistrement automatique (`globsExclude` dans `vite.config.ts` ; l'option `exclude` ne vise que les fichiers transformés), import explicite depuis `@/components/ds` | `tests/unit/dsLib.spec.ts` (« design system auto-registration ») |
