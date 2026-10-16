#!/usr/bin/env bash
# Type check with a ratchet: the legacy pages still carry type errors that are fixed page by page,
# so the gate fails when the error count goes ABOVE the committed budget, and asks for the budget
# to be lowered when the count went below it. No error is ever allowed in the new layers.
#
#   scripts/check-typecheck.sh            run vue-tsc and compare
#   scripts/check-typecheck.sh --update   rewrite scripts/typecheck-budget.txt with the current count
set -euo pipefail

cd "$(dirname "$0")/.."
budget_file=scripts/typecheck-budget.txt
# Directories written for the redesign: zero tolerance.
clean_paths='^(src/gateway|src/datasource|src/migration|src/components/ds|src/components/fq)/'

out=$(mktemp)
trap 'rm -f "$out"' EXIT
./node_modules/.bin/vue-tsc --build --noEmit >"$out" 2>&1 || true

total=$(grep -c 'error TS' "$out" || true)
strict=$(grep 'error TS' "$out" | grep -Ec "$clean_paths" || true)

if [ "${1:-}" = "--update" ]; then
  echo "$total" >"$budget_file"
  echo "typecheck budget set to $total"
  exit 0
fi

budget=$(tr -d '[:space:]' <"$budget_file")
echo "vue-tsc: $total errors (budget $budget), $strict in the redesign layers"

if [ "$strict" -gt 0 ]; then
  echo "::error::type errors in the redesign layers:"
  grep 'error TS' "$out" | grep -E "$clean_paths" | head -50
  exit 1
fi
if [ "$total" -gt "$budget" ]; then
  echo "::error::$total type errors, above the budget of $budget. New errors:"
  grep 'error TS' "$out" | head -100
  exit 1
fi
if [ "$total" -lt "$budget" ]; then
  echo "::notice::the count dropped from $budget to $total: run scripts/check-typecheck.sh --update and commit the new budget"
fi
