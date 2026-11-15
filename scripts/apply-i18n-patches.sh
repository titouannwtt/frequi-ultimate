#!/usr/bin/env bash
# =============================================================================
# apply-i18n-patches.sh
# Re-apply i18n translation patches after merging from upstream.
#
# Usage:
#   1. Merge upstream:
#        git fetch upstream
#        git merge upstream/main
#   2. Resolve any non-i18n conflicts, then run this script:
#        bash scripts/apply-i18n-patches.sh
#   3. The script applies each patch with --3way (allows git merge conflict
#      resolution). Review any failures listed at the end.
#   4. After all patches applied, review with `git diff` then commit.
#
# Regenerating patches (after making new i18n changes):
#   git diff upstream/main -- src/components/ftbot/TradeList.vue > patches/i18n/TradeList.patch
#   (repeat for each file, or use the regenerate mode below)
#
# Regenerate all patches at once:
#   bash scripts/apply-i18n-patches.sh --regenerate
#
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PATCH_DIR="$REPO_DIR/patches/i18n"

# Files covered by i18n-only patches (Cosmetique entries from CHANGELOG_FORK.md)
I18N_FILES=(
  "src/components/ftbot/TradeList.vue"
  "src/components/ftbot/TradeDetail.vue"
  "src/components/ftbot/BotStatus.vue"
  "src/components/ftbot/BotControls.vue"
  "src/components/ftbot/BotPerformance.vue"
  "src/components/ftbot/ForceEntryForm.vue"
  "src/components/ftbot/ForceExitForm.vue"
  "src/components/ftbot/BacktestRun.vue"
  "src/components/ftbot/BacktestResultAnalysis.vue"
  "src/components/ftbot/BacktestResultPeriodBreakdown.vue"
  "src/components/ftbot/BacktestResultTablePer.vue"
  "src/components/ftbot/BacktestResultChart.vue"
  "src/components/ftbot/PairListLive.vue"
  "src/components/ftbot/BotBalance.vue"
  "src/components/ftbot/DownloadDataMain.vue"
  "src/components/ftbot/PairLockList.vue"
  "src/components/ftbot/ReloadControl.vue"
  "src/components/ftbot/StrategySelect.vue"
  "src/components/ftbot/TradeActionsPopover.vue"
  "src/components/charts/CandleChart.vue"
  "src/components/charts/SingleCandleChartContainer.vue"
  "src/components/charts/PlotConfigurator.vue"
  "src/views/BacktestingView.vue"
  "src/views/ChartsView.vue"
  "src/views/LogView.vue"
)

# --- Regenerate mode ---
if [[ "${1:-}" == "--regenerate" ]]; then
  echo "=== Regenerating i18n patches from current diff against upstream/main ==="
  mkdir -p "$PATCH_DIR"
  for filepath in "${I18N_FILES[@]}"; do
    patchname="$(basename "$filepath" .vue).patch"
    git -C "$REPO_DIR" diff upstream/main -- "$filepath" > "$PATCH_DIR/$patchname"
    lines=$(wc -l < "$PATCH_DIR/$patchname")
    if [[ "$lines" -eq 0 ]]; then
      echo "  SKIP  $patchname (no diff)"
      rm -f "$PATCH_DIR/$patchname"
    else
      echo "  OK    $patchname ($lines lines)"
    fi
  done
  echo "Done. Patches in $PATCH_DIR"
  exit 0
fi

# --- Apply mode ---
echo "=== Applying i18n patches from $PATCH_DIR ==="
echo ""

cd "$REPO_DIR"

succeeded=()
failed=()
skipped=()

for filepath in "${I18N_FILES[@]}"; do
  patchname="$(basename "$filepath" .vue).patch"
  patchfile="$PATCH_DIR/$patchname"

  if [[ ! -f "$patchfile" ]]; then
    skipped+=("$patchname (file not found)")
    continue
  fi

  if [[ ! -s "$patchfile" ]]; then
    skipped+=("$patchname (empty patch)")
    continue
  fi

  # Check if patch is already applied (all hunks already present)
  if git apply --check --reverse "$patchfile" 2>/dev/null; then
    skipped+=("$patchname (already applied)")
    continue
  fi

  # Apply with --3way for conflict resolution support
  if git apply --3way "$patchfile" 2>/dev/null; then
    succeeded+=("$patchname")
    echo "  OK    $patchname"
  else
    failed+=("$patchname -> $filepath")
    echo "  FAIL  $patchname"
  fi
done

echo ""
echo "=== Summary ==="
echo "  Applied:  ${#succeeded[@]}"
echo "  Skipped:  ${#skipped[@]}"
echo "  Failed:   ${#failed[@]}"

if [[ ${#skipped[@]} -gt 0 ]]; then
  echo ""
  echo "Skipped patches:"
  for s in "${skipped[@]}"; do
    echo "  - $s"
  done
fi

if [[ ${#failed[@]} -gt 0 ]]; then
  echo ""
  echo "Failed patches (resolve manually):"
  for f in "${failed[@]}"; do
    echo "  - $f"
  done
  echo ""
  echo "To resolve a failed patch manually:"
  echo "  1. git apply --3way patches/i18n/<name>.patch"
  echo "  2. Fix conflicts in the file (look for <<<<<<< markers)"
  echo "  3. git add <file>"
  exit 1
fi

echo ""
echo "All patches applied successfully. Review with 'git diff --staged' then commit."
