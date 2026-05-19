# Contributing to FreqUI Ultimate

Thanks for your interest. This dashboard is the companion to [freqtrade-ultimate](https://github.com/titouannwtt/freqtrade-ultimate) and ships with 50+ enhanced components, fleet comparison, market context, and strategy dev UI.

## What we accept

- **Bug fixes** on fork-specific components (anything under `src/components/ftbot/`, `src/views/*Custom.vue`, `src/components/strategyDev/`, fork-specific stores in `src/stores/`).
- **New widgets / popovers / cards** that fit the glassmorphism design system.
- **Performance improvements** (chart rendering, large bot lists, store reactivity).
- **i18n contributions** in `src/locales/` (currently 6 languages — translations welcome).
- **Documentation improvements** in `README.md` or `CHANGELOG_FORK.md`.

## What we don't accept

- Removing the glassmorphism design system without prior discussion.
- Dependencies we can avoid. Discuss in an issue first.
- Features that are clearly upstream-suitable. Send those to [freqtrade/frequi](https://github.com/freqtrade/frequi).

## Workflow

1. **Open an issue first** for any non-trivial change.
2. **Fork → branch → PR**. Name your branch descriptively: `feat/<topic>`, `fix/<topic>`.
3. **One topic per PR**.
4. **Run locally before pushing**:
   ```bash
   pnpm install
   pnpm typecheck
   pnpm lint
   pnpm build
   ```
5. **Update i18n** if you add user-facing strings — at minimum English and French.

## Commit messages

- Imperative mood, lowercase prefix (`feat:`, `fix:`, `docs:`, `refactor:`, `style:`, `test:`, `ci:`).
- Reference the issue: `feat(BotComparisonList): add CSV export (#42)`.
- No trailer blocks, no AI-generated co-author lines.

## Code style

- Vue 3 composition API with `<script setup>`.
- TypeScript on new code.
- TailwindCSS for styling — minimize bespoke CSS.
- Pinia for state — use existing stores (`botComparison`, `ftbotwrapper`, `layout`, `settings`) before creating new ones.
- Charts via ECharts (not Chart.js or other).

## Design system

- **Glassmorphism**: backdrop-blur, semi-transparent backgrounds (`bg-white/5`, `bg-black/20`).
- **Color accents**: orange for warnings/risk, green for profit, red for drawdown.
- **Popovers**: use the `UnifiedPopover` component, not custom tooltips.
- **Icons**: Material Design Icons (`I-Mdi-*`).

## Questions

Open a [GitHub Discussion](https://github.com/titouannwtt/frequi-ultimate/discussions) or join the [Freqtrade France](https://buymeacoffee.com/freqtrade_france) community.

— Mouton 🐑 \| Freqtrade France
