# Plan de mise à jour upstream FreqUI v3.0.x

> Auto-généré le 2026-06-09. Ce document récapitule les changements upstream à intégrer dans `frequi-fork`.

## Releases upstream non encore intégrées

| Tag | Date | Type | Résumé |
|---|---|---|---|
| `2.2.4` | 2026-04-30 | patch | Bumps dépendances (actions GH, deps mineurs) |
| `2.2.5` | 2026-05-02 | patch | Fix axes de zoom |
| **`3.0.0`** | 2026-05-29 | **MAJEUR** | **Migration framework UI : PrimeUI → Nuxt UI 4.x** |
| `3.0.1` | 2026-06-01 | patch | Fix charts en navigateurs non-anglais |
| `3.0.2` | 2026-06-02 | patch | Fix tooltip entry/exit non affiché |

La branche `claude/gallant-mayer-nudqir` est basée sur un commit upstream d'avril 2026 (juste après `2.2.3`).
Divergence : **410 commits upstream non intégrés** ; **135 commits fork** par-dessus la base.

## Impact sur le code fork — critique

Le passage `3.0.0` est une **migration de framework UI complète**. Côté fork, nous avons développé une **surcouche PrimeUI massive** entièrement incompatible avec Nuxt UI 4.x :

- Toute la suite « bot comparison » (`BotComparisonList.vue`, store `botComparison.ts`, types associés)
- Le dashboard custom (`DashboardViewCustom.vue`, widgets lazy-mount, viewport gating, profile-comparison widget…)
- La refonte « Available Bots » (panel HomeView avec tags / folders / sorting)
- Le selector chart `PairSelectorAdvanced`, la modal dry-run replay, le boot splash
- Les améliorations navbar (left-click reliability, RouterLink slot, brand refresh « frequi-ultimate »)
- Le SettingsViewCustom, les graphiques wallet history, le config-editor par bot

**Test merge sec** (`git merge upstream/main --no-commit`) : **53 fichiers en conflit**, dont fichiers stratégiques :

```
package.json, pnpm-lock.yaml, vite.config.ts, src/main.ts, src/App.vue,
src/stores/{ftbot,ftbotwrapper,layout,settings}.ts,
src/views/{Trading,Charts,Backtesting}View.vue,
src/components/layout/NavBar.vue, src/styles/tailwind.css,
+ ~40 composants .vue dans src/components/{ftbot,charts,layout,…}
```

Et **428 fichiers modifiés non en conflit** (refactors upstream sur composants où le fork n'a rien touché).

## Stratégie d'intégration recommandée

❌ **À éviter** : merge brut. Les composants PrimeUI custom n'ont pas d'équivalent direct Nuxt UI, et la migration upstream a déplacé/renommé des dizaines de fichiers.

✅ **Approche progressive en 4 phases** :

### Phase 0 — Geler le fork (avant tout merge)
1. Tagger la version stable actuelle : `git tag pre-v3-merge-2026-06-09`
2. Bundler un build de production : `pnpm build && tar -czf frequi-pre-v3.tar.gz dist/`
3. Documenter la version actuelle dans `CHANGELOG_FORK.md`

### Phase 1 — Cherry-pick des patches 2.2.4 + 2.2.5 (low-risk)
- Récupère les fixes axes-zoom et bumps deps mineurs.
- Risque très faible, conflits attendus : 0–5.
- Pas de migration framework dans cette phase.

### Phase 2 — Branche de spike `spike/nuxtui-migration`
- Partir de **upstream/main** (pas du fork).
- Re-porter une à une les **features fork majeures** sur la base Nuxt UI :
  1. `botComparison.ts` store + `BotComparisonList.vue` (réécriture composants PrimeUI → Nuxt UI)
  2. `DashboardViewCustom.vue` + widgets lazy-mount
  3. HomeView redesign (Available Bots panel)
  4. `PairSelectorAdvanced` + chart context buttons
  5. Dry-run replay modal + boot splash
  6. NavBar fixes + branding « frequi-ultimate »
  7. SettingsViewCustom + config-editor par bot
- Tests E2E Playwright à adapter à Nuxt UI (data-test attrs déplacés/renommés).

### Phase 3 — Validation manuelle approfondie
- Tester chaque vue : Trading, Charts, Backtesting, Dashboard, BotComparison, Home, Settings
- Tester sur tous les modes : dry, live, replay
- Vérifier mobile (la migration `3.0.0` a impacté beaucoup de layouts mobiles)
- Vérifier i18n non-anglais (régression 3.0.1)

### Phase 4 — Merge final et bump version
- Bump fork version `0.8.0` → `1.0.0` (cohérent avec breaking change upstream `3.0.0`)
- Mettre à jour `CHANGELOG_FORK.md` + `README.md`
- Mettre à jour `LLMS.txt` si présent

## Estimation effort

- Phase 1 : ~30 min (sûr et rapide)
- Phase 2 : **plusieurs jours-semaines** selon temps disponible (réécriture composants UI)
- Phase 3 : 1-2 jours de tests manuels
- Phase 4 : ~1h

## Décisions à prendre

1. **Garder PrimeUI ou migrer vers Nuxt UI ?**
   - Si on garde PrimeUI : on rejette définitivement les commits upstream `3.0.x` et on cherry-pick à la main les fixes non liés au framework. Le fork s'écarte définitivement de upstream.
   - Si on migre : suivre Phases 1-4 ci-dessus.
2. **Version v3.x devient-elle la base ou on reste sur 2.2.x ?**
3. **Le branding `frequi-ultimate` reste-t-il ?** Plusieurs fichiers UI le référencent (navbar, README, package metadata).

## Commandes utiles

```bash
# Voir tous les commits upstream à intégrer
git log claude/gallant-mayer-nudqir..upstream/main --oneline

# Voir les fichiers modifiés upstream uniquement (pas de conflit)
git diff --name-only main upstream/main

# Voir les fichiers en conflit potentiel
git merge upstream/main --no-commit --no-ff
# (puis `git merge --abort` après inspection)

# Cherry-picker un fix précis sans merge
git cherry-pick <sha>
```

---

Ce document est destiné à servir de base de discussion. Il ne propose pas de code à merger, mais un plan d'action structuré pour intégrer la version `3.0.x` upstream de FreqUI.
