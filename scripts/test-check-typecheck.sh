#!/usr/bin/env bash
# Rehearse check-typecheck.sh with a fake vue-tsc: a crash must never count as "0 errors" (B112).
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/scripts" "$work/node_modules/.bin"
cp "$here/check-typecheck.sh" "$work/scripts/"
echo 3 >"$work/scripts/typecheck-budget.txt"
run() { (cd "$work" && bash scripts/check-typecheck.sh "$@"); }
fake() { printf '#!/usr/bin/env bash\n%s\n' "$1" >"$work/node_modules/.bin/vue-tsc"; chmod +x "$work/node_modules/.bin/vue-tsc"; }

pass=0
check() { # check DESCRIPTION EXPECTED_EXIT COMMAND...
  local what=$1 want=$2; shift 2
  "$@" >"$work/log" 2>&1
  local got=$?
  if [ "$got" = "$want" ]; then pass=$((pass + 1)); echo "ok   $what"; else echo "FAIL $what (exit $got, wanted $want)" >&2; cat "$work/log" >&2; exit 1; fi
}

fake 'echo "src/views/A.vue(1,1): error TS2322: x"; echo "src/views/B.vue(1,1): error TS2322: y"; exit 2'
check "errors within the budget pass" 0 run
fake 'echo "src/views/A.vue(1,1): error TS2322: x"; for i in 1 2 3 4; do echo "src/views/B.vue(1,1): error TS2322: y"; done; exit 2'
check "errors above the budget fail" 1 run
fake 'echo "src/gateway/a.ts(1,1): error TS2322: x"; exit 2'
check "an error in a redesign layer fails" 1 run
fake 'exit 0'
check "a clean run passes" 0 run
fake 'echo "FATAL ERROR: heap out of memory"; exit 134'
check "an out-of-memory crash fails" 1 run
fake 'echo "vue-tsc: command not found"; exit 127'
check "a missing binary fails" 1 run
fake 'echo "something broke"; exit 1'
check "exit 1 with no diagnostic fails" 1 run
fake 'echo "FATAL ERROR"; exit 134'
check "--update does not record a crash as zero" 1 run --update
if [ "$(tr -d '[:space:]' <"$work/scripts/typecheck-budget.txt")" = 3 ]; then
  pass=$((pass + 1)); echo "ok   the budget file is untouched"
else
  echo "FAIL budget rewritten" >&2; exit 1
fi

echo "all $pass checks passed"
