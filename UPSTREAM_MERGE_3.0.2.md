# Upstream merge tracking — FreqUI `3.0.2`

> Automated tracking note. The local fork is currently at `0.8.0` (forked from upstream `2.2.5`).
> Upstream released **`3.0.0` on 2026-05-31**, then `3.0.1` (2026-06-01) and `3.0.2` (2026-06-02).

## Highlights from upstream `3.0.x`

- **MAJOR: Nuxt UI framework migration** (`3.0.0`) — replaces BootstrapVue with `@nuxt/ui` + Reka UI components. Comprehensive UI rework throughout the app.
- **Improved chart tooltip** — better overview/legibility on candle and indicator hover.
- **Echarts → `6.1.0`**, **Vite → `8.0.13`**, **eslint → `10.4.0`**, **playwright → `1.60.0`**, **vitest → `4.1.6`**.
- **CI bumps**: node 26, pnpm 11.4, nginx 1.31.1.
- **`3.0.1`** — fixes echarts axis-limit calculation in non-English locales.
- **`3.0.2`** — fixes entry/exit signal tooltip display.

## Merge status: **NEEDS HUMAN REVIEW — this is a major migration**

A trial merge (`git merge 3.0.2`) produces **52 conflicted files**, spanning every layer of the app: dashboard, bot comparison, charts, trade list, dialogs, stores, styles, and CI. Many of these files are heavily customized by this fork.

A safe path forward is **NOT** a straight merge — it is a deliberate, file-by-file rebase of the fork's customizations onto upstream's new Nuxt UI base.

### Headline integration risks

| Area | Files | Why |
|------|-------|-----|
| **Bot comparison view** (fork-defining feature) | `BotComparisonList.vue`, `BotProfit.vue`, `BotBalance.vue`, `BotPerformance.vue`, `BotStatus.vue`, `BotEntry.vue`, `BotList.vue`, `BotControls.vue` | Fork's multi-bot dashboard is built here. Upstream's 3.0 rework will require re-porting custom columns (Current Profit, Max Drawdown, Available Funds, Host badge, …). |
| **Dashboard layout / persistence** | `DraggableContainer.vue`, `stores/layout.ts`, `stores/ftbotwrapper.ts` | Fork has dashboard zoom, persisted layout, lazy-mounted widgets, polling fan-out trim. |
| **Charts** | `CandleChart.vue`, `CandleChartContainer.vue`, `SingleCandleChartContainer.vue`, `PlotConfigurator.vue`, `WalletHistoryChart.vue` | Fork has Dry/Live colour coding (Dry green, Live blue), advanced pair selector, strategy-indicator loader, price-axis label, crosshair. |
| **Trade list / details** | `TradeList.vue`, `TradeDetail.vue`, `TradeActionsPopover.vue`, `CustomTradeList.vue` | Fork has leverage column, time-period filter, neutral-grey zero-profit rendering, enriched widgets, **trade-duration clamp ≥ 0**. |
| **Views** | `BacktestingView.vue`, `ChartsView.vue`, `TradingView.vue` | Hand-merge required. |
| **Navbar / app shell** | `App.vue`, `NavBar.vue`, `views/HomeView.vue` (auto-merged), `views/DashboardView.vue` (auto-merged), `views/LoginView.vue` (auto-merged) | Fork added the navbar version badge (from `package.json`), Dry Replay modal entry, boot splash. |
| **Stores** | `stores/ftbot.ts`, `stores/ftbotwrapper.ts`, `stores/layout.ts` | Fork added bot-config-editor backend wiring, withdrawal-aware starting capital, multi-bot fleet glue. |
| **Pairlist / strategy / dialogs** | `PairListLive.vue`, `PairLockList.vue`, `PairlistConfigurator.vue`, `StrategySelect.vue`, `ForceEntryForm.vue`, `ForceExitForm.vue`, `DownloadDataMain.vue`, `BacktestRun.vue`, `BacktestResultAnalysis.vue`, `BacktestResultPeriodBreakdown.vue`, `BacktestResultTablePer.vue`, `PeriodBreakdown.vue`, `ReloadControl.vue` | Component-level customizations need to be ported into upstream's new shells. |
| **Styles** | `src/styles/tailwind.css` | Fork has custom theme + Dry/Live colour tokens. |
| **Build / CI** | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vite.config.ts`, `index.html`, `Dockerfile`, `docker/Dockerfile`, `.github/workflows/*`, `.github/dependabot.yml`, `src/main.ts`, `src/auto-imports.d.ts` | Generally accept upstream, then re-apply any fork-only deps (e.g. reka-ui add). |

### Suggested merge procedure

```bash
git fetch upstream --tags
git merge 3.0.2 --no-edit

# 1. Build / CI / generated files: accept upstream
git checkout --theirs \
    .github/dependabot.yml .github/workflows/ci.yml .github/workflows/docker.yml \
    .github/workflows/zizmor_action.yml Dockerfile docker/Dockerfile \
    index.html pnpm-workspace.yaml vite.config.ts src/main.ts src/auto-imports.d.ts

# 2. package.json + lockfile: hand-merge (keep "version", any fork-only deps)
$EDITOR package.json
pnpm install        # regenerate pnpm-lock.yaml

# 3. UI components: file-by-file hand merge.
#    Rule of thumb: accept upstream's new Nuxt UI shell, then port fork-specific
#    columns/widgets/colour logic into it.
$EDITOR src/components/**/*.vue src/views/*.vue src/stores/*.ts src/styles/tailwind.css

# 4. Sanity checks
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
```

### Sanity checks after merge

```bash
# Fork-defining features must still exist:
grep -r "max-drawdown\|maxDrawdown\|MaxDrawdown" src/components/ftbot/
grep -r "Current Profit\|currentProfit\|profit_courant" src/components/ftbot/
grep -r "Available Funds\|availableFunds" src/components/ftbot/
grep -r "Host badge\|isHost" src/components/ftbot/
grep -r "Dry Replay\|DryReplay" src/components/ftbot/
grep -r "boot splash\|BootSplash" src/
grep "isDry" src/components/charts/CandleChart.vue   # Dry/Live colour coding
```

### Note on the version transition

This fork uses an independent semver track (`0.x.y`). Upstream's transition to `3.0` is purely cosmetic for our versioning — there is no obligation to renumber. The next fork release after this merge can stay on the `0.x` track or jump to align with upstream's `3.x` — maintainer's choice.
