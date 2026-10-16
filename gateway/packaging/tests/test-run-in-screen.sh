#!/usr/bin/env bash
# Rehearse run-in-screen.sh with a stub binary (never the real gateway, never a real port of the
# fleet): the idempotence must follow the gateway, not the existence of the screen session (B111).
#
# Exit code 0 when every check passed. Needs GNU screen; every session it opens is closed.
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
script=$here/../run-in-screen.sh
command -v screen >/dev/null || { echo "screen not installed: skipped"; exit 0; }
work=$(mktemp -d)
session=fgtest$$
cleanup() {
  screen -S "$session" -X quit >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

# A free high port, only to be printed by the stub's check-config.
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
cat >"$work/fgstub" <<STUB
#!/usr/bin/env bash
case "\$1" in
  check-config) echo "listen      : 127.0.0.1:$port"; exit 0 ;;
  run) if [ -n "\${STUB_EXIT:-}" ]; then exit "\$STUB_EXIT"; fi; exec sleep 20 ;;
esac
STUB
chmod +x "$work/fgstub"
export FG_BIN=$work/fgstub FG_SESSION=$session FG_DATA_DIR=$work/data FG_CONFIG="" HOME=$work

pass=0
check() { # check DESCRIPTION COMMAND...
  local what=$1; shift
  if "$@" >/dev/null 2>&1; then pass=$((pass + 1)); echo "ok   $what"; else echo "FAIL $what" >&2; exit 1; fi
}

# ---- a gateway that stops at once: the session lingers at its prompt, nothing runs
export STUB_EXIT=2
check "start reports the immediate stop (exit 5)" bash -c "[ \$(\"$script\" >/dev/null 2>&1; echo \$?) = 5 ]"
check "the session is still there" bash -c "screen -ls | grep -Eq '[0-9]+\\.$session[[:space:]]'"
check "a second start does not claim it is running (exit 6)" bash -c "[ \$(\"$script\" >/dev/null 2>&1; echo \$?) = 6 ]"
check "--status says it is not running" bash -c "[ \$(\"$script\" --status >/dev/null 2>&1; echo \$?) != 0 ]"
screen -S "$session" -X quit >/dev/null 2>&1
sleep 1

# ---- a gateway that runs: starting twice is a no-op and --status agrees
unset STUB_EXIT
check "start runs the gateway" bash -c "[ \$(\"$script\" >/dev/null 2>&1; echo \$?) = 0 ]"
check "a second start is a no-op (exit 0)" bash -c "\"$script\" | grep -q 'nothing to do'"
check "--status says it runs" "$script" --status
screen -S "$session" -X quit >/dev/null 2>&1
sleep 1
check "the session is closed at the end" bash -c "! screen -ls | grep -Eq '[0-9]+\\.$session[[:space:]]'"

echo "all $pass checks passed"
