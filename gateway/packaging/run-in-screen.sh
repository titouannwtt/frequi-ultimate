#!/usr/bin/env bash
# Start frequi-gateway in a detached GNU screen session named "frequi-gateway".
#
#   packaging/run-in-screen.sh            start (idempotent: nothing happens if the gateway runs)
#   packaging/run-in-screen.sh --status   say whether the gateway, the session and the port are up
#
# Stop it the same way as a bot: `screen -x frequi-gateway`, then Ctrl+C (clean shutdown, the
# WebSockets are closed with code 1001). Never `kill` it from outside.
#
# What it does, in this order:
#   1. when a session of that name already exists: exit 0 if the gateway runs in it, exit 6 if the
#      session is only waiting at its "Press Enter" prompt after the gateway stopped (the reason
#      is printed; close the session with `screen -S frequi-gateway -X quit`, then start again);
#   2. reads the configuration with `check-config` (exit 3 when it is invalid, nothing starts);
#   3. refuses to start when the listen port is already taken by anything else (exit 4);
#   4. creates the data directory (mode 700) and starts `frequi-gateway run` inside the session,
#      restarted after a crash (5 s later), not after a configuration error or a clean stop.
#
# Environment (all optional):
#   FG_BIN        binary          (default: ~/.local/bin/frequi-gateway, else the PATH)
#   FG_CONFIG     configuration   (default: ~/.config/frequi-gateway/config.toml; none = defaults)
#   FG_SECRETS    secrets file    (default: secrets.toml next to the configuration, mode 600)
#   FG_DATA_DIR   state directory (default: ~/.local/share/frequi-gateway); the file
#                 .run-in-screen.<session> in it says whether the gateway runs in the session
#   FG_SESSION    screen session  (default: frequi-gateway)
#   Any FG_SECTION__KEY override of the configuration is passed through (FG_SERVER__LISTEN...).
set -uo pipefail

SESSION=${FG_SESSION:-frequi-gateway}
CONFIG=${FG_CONFIG:-$HOME/.config/frequi-gateway/config.toml}
DATA_DIR=${FG_DATA_DIR:-$HOME/.local/share/frequi-gateway}
# storage.data_dir, for check-config and for the service (an explicit FG_STORAGE__DATA_DIR wins).
export FG_STORAGE__DATA_DIR=${FG_STORAGE__DATA_DIR:-$DATA_DIR}

find_bin() {
  if [ -n "${FG_BIN:-}" ]; then
    printf '%s\n' "$FG_BIN"
  elif [ -x "$HOME/.local/bin/frequi-gateway" ]; then
    printf '%s\n' "$HOME/.local/bin/frequi-gateway"
  else
    command -v frequi-gateway || true
  fi
}

BIN=$(find_bin)
if [ -z "$BIN" ] || [ ! -x "$BIN" ]; then
  echo "frequi-gateway binary not found (set FG_BIN, or install it to ~/.local/bin)" >&2
  exit 3
fi

config_args=()
if [ -f "$CONFIG" ]; then
  config_args+=(--config "$CONFIG")
  [ -n "${FG_SECRETS:-}" ] && config_args+=(--secrets "$FG_SECRETS")
elif [ -n "${FG_CONFIG:-}" ]; then
  echo "configuration file $CONFIG not found" >&2
  exit 3
fi

# What the restart loop wrote about itself: "running" while the gateway is supervised, "stopped:
# <why>" once the loop ended (the session then only waits for Enter). No file (a session from an
# older version of this script): cannot tell, so it counts as running.
PHASE_FILE=$FG_STORAGE__DATA_DIR/.run-in-screen.$SESSION
phase() { cat "$PHASE_FILE" 2>/dev/null || echo running; }
gateway_running() { session_up && [ "$(phase | cut -c1-7)" != stopped ]; }

session_up() {
  # `screen -ls` lists "<pid>.<name>"; match the whole name.
  screen -ls 2>/dev/null | grep -Eq "[0-9]+\.${SESSION}[[:space:]]"
}

# The port comes from `check-config` so that a FG_SERVER__LISTEN override or the file are both
# honoured. Output looks like "listen      : 0.0.0.0:9399".
listen_port() {
  local out
  out=$("$BIN" check-config "${config_args[@]}" 2>/dev/null) || return 1
  printf '%s\n' "$out" | sed -n 's/^listen *: *//p' | head -n1 | sed 's/.*://'
}

port_taken() {
  local port=$1
  if command -v ss >/dev/null 2>&1; then
    [ -n "$(ss -H -ltn "sport = :$port" 2>/dev/null)" ]
  else
    # Without ss: a TCP connect to the loopback.
    (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null
  fi
}

if [ "${1:-}" = "--status" ]; then
  port=$(listen_port || true)
  if session_up; then echo "session $SESSION: up"; else echo "session $SESSION: down"; fi
  if [ -n "$port" ]; then
    if port_taken "$port"; then echo "port $port: listening"; else echo "port $port: free"; fi
  fi
  if session_up; then echo "gateway: $(phase)"; else echo "gateway: not running"; fi
  gateway_running
  exit $?
fi

# The restart loop that runs inside the screen session (internal entry point).
if [ "${1:-}" = "--inside" ]; then
  shift
  stopping=0
  reason="clean stop"
  trap 'stopping=1' INT TERM
  fast_failures=0
  printf 'running\n' >"$PHASE_FILE"
  while :; do
    started=$(date +%s)
    "$BIN" run "$@"
    code=$?
    uptime=$(( $(date +%s) - started ))
    if [ "$stopping" = 1 ] || [ "$code" -eq 0 ]; then
      echo "frequi-gateway stopped (exit $code)."
      reason="stopped (exit $code)"
      break
    fi
    if [ "$code" -eq 2 ]; then
      # Configuration error: restarting cannot fix it.
      echo "frequi-gateway: invalid configuration (exit 2), not restarting."
      reason="invalid configuration (exit 2)"
      break
    fi
    if [ "$uptime" -lt 30 ]; then fast_failures=$((fast_failures + 1)); else fast_failures=0; fi
    if [ "$fast_failures" -ge 10 ]; then
      echo "frequi-gateway failed $fast_failures times in a row within 30 s, giving up."
      reason="failed $fast_failures times in a row"
      break
    fi
    echo "frequi-gateway exited with $code after ${uptime}s, restarting in 5 s (Ctrl+C to stop)."
    sleep 5
    [ "$stopping" = 1 ] && break
  done
  printf 'stopped: %s\n' "$reason" >"$PHASE_FILE"
  # Keep the output readable: the session closes when Enter is pressed.
  if [ -t 0 ]; then read -r -p "Press Enter to close this session. " _ || true; fi
  exit 0
fi

if session_up; then
  if gateway_running; then
    echo "screen session $SESSION already exists: nothing to do (attach with: screen -x $SESSION)"
    exit 0
  fi
  echo "screen session $SESSION exists but the gateway is not running in it ($(phase))." >&2
  echo "close it with: screen -S $SESSION -X quit   then start again (see the output with: screen -x $SESSION)" >&2
  exit 6
fi

if ! "$BIN" check-config "${config_args[@]}" >/dev/null; then
  echo "invalid configuration, run: $BIN check-config ${config_args[*]}" >&2
  exit 3
fi

port=$(listen_port || true)
if [ -n "$port" ] && port_taken "$port"; then
  echo "port $port is already in use: not starting (another gateway, a bot, or another service)" >&2
  exit 4
fi

umask 077
mkdir -p "$FG_STORAGE__DATA_DIR"
chmod 700 "$FG_STORAGE__DATA_DIR"

# The session inherits the environment of this shell, including every FG_* override.
self=$(readlink -f "$0")

# A session that dies at once, or whose gateway stops at once (binary refused to start), must not
# be reported as started.
rm -f "$PHASE_FILE"
screen -dmS "$SESSION" bash "$self" --inside "${config_args[@]}"
sleep 1
if gateway_running; then
  echo "started screen session $SESSION${port:+ (port $port)}; attach with: screen -x $SESSION"
else
  why="no session"
  if session_up; then why=$(phase); fi
  echo "the gateway stopped right after the start ($why); run the binary by hand to see why:" >&2
  echo "  $BIN run ${config_args[*]}" >&2
  exit 5
fi
