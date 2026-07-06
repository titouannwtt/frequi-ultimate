# Upstream sync — freqtrade/frequi

Latest observed release: **3.1.0** (2026-06-28)

Prior release: **3.0.2** (2026-06-02)

## Upstream changes since 3.0.2

### New features (visible)

- **Lookahead Analysis UI** — new view and components under
  `src/components/ftbot/LookaheadAnalysis*.vue` and `src/views/LookaheadAnalysisView.vue`
  driven by a new `src/types/analysis.ts`.
- **Recursive Analysis UI** — new view + components
  (`src/components/ftbot/RecursiveAnalysis*.vue`, `src/views/RecursiveAnalysisView.vue`).
- **`FreqAIModelInput` extracted** as a shared component for FreqAI model selection.
- Background job store refactor — job handling moved into `botStore`, navigation
  persistence for background tasks, `clearOnlineBgJobs` endpoint.
- Backtest store settings reordered; Analysis settings persist across navigation.
- Navbar layout adjusted to host the new Analysis entries.
- e2e coverage: `e2e/analysis.spec.ts` + testData fixtures under
  `e2e/testData/analysis/`.

### Chores / deps

- `pnpm` bumped to 11.9.0
- Docker: `node` 26.3.1-alpine → 26.4.0-alpine
- `@nuxt/ui` 4.8.2 → 4.9.0, `reka-ui` 2.9.10 → 2.10.0, `axios` 1.17.0 → 1.18.0
- `@types/node` 25.9.2 → 25.9.3, `happy-dom` 20.10.2 → 20.10.5
- `tailwindcss` bumped
- CI: `zizmorcore/zizmor-action` bumped

## Fork-specific files that likely need review

The fork carries substantial custom UI (fleet widgets, bot comparison editor,
dry-run replay modal, boot splash, per-widget lazy mounting, brand refresh).
Files where the fork has diverged and upstream 3.1.0 also touched code:

- `src/components/layout/NavBar.vue` — upstream added Analysis entries; fork
  reworked navbar layout. Manual merge needed if we want the Analysis entries.
- `src/components/ftbot/BackgroundJobTracking.vue` — upstream refactored around
  the new botStore-backed job tracking.
- `src/components/ftbot/BacktestHistoryLoad.vue`, `BacktestResultSelect.vue`,
  `BacktestRun.vue` — upstream reordered store settings.
- `src/stores/btStore.ts`, `src/stores/ftbot.ts`, `src/stores/ftbotwrapper.ts` —
  upstream refactored background-job handling into stores.
- `src/router/index.ts` — new routes for LookaheadAnalysisView / RecursiveAnalysisView.
- `.github/workflows/ci.yml` — upstream CI changes.

## Files that can be added as-is (no fork conflict expected)

- `src/components/ftbot/LookaheadAnalysis*.vue` (3 new files)
- `src/components/ftbot/RecursiveAnalysis*.vue` (3 new files)
- `src/components/ftbot/FreqAIModelInput.vue`
- `src/views/LookaheadAnalysisView.vue`, `RecursiveAnalysisView.vue`
- `src/types/analysis.ts`
- e2e fixtures under `e2e/testData/analysis/`

## Suggested sync procedure

Because this fork's history is unrelated to upstream (independent snapshot
baseline), `git merge upstream/main` will produce unmanageable conflicts.
Cherry-picking topical commits or copying the new-file bundle over is the
practical path — see the list above.
