#!/usr/bin/env bash
# Deploy a FreqUI build into the directory a freqtrade bot serves the UI from
# (<freqtrade>/freqtrade/rpc/api_server/ui/installed), with a backup and a rollback.
#
#   deploy-ui.sh --target DIR (--dist DIR | --build) [--version V] [--url URL] [--keep N] [--dry-run]
#   deploy-ui.sh --target DIR --rollback [--backup DIR] [--url URL] [--exact] [--dry-run]
#
# The bot reads the directory on every request, so nothing is restarted: no bot, no gateway.
#
# Deploy, in order:
#   1. backup:  cp -a TARGET TARGET.bak.<UTC timestamp>  (a real copy, never hard links);
#   2. assets:  every file of the build except index.html and *.map is copied next to the old ones
#               (additive: the hashed files of the previous build stay, so an open tab keeps working),
#               each through a temporary name and an atomic mv;
#   3. entry:   index.html is written as index.html.new.<pid> then moved over index.html (atomic),
#               then .uiversion (the marker read by the bot's GET /ui_version);
#   4. verify:  index.html equals the build's, every asset it references exists, and with --url
#               GET / answers 200 with the same index.html and GET /ui_version returns the marker.
#               When a check fails the previous index.html and .uiversion are restored at once.
# Running it again with the same build changes nothing ("already deployed").
#
# Rollback restores the files of the latest backup (or --backup DIR) that differ, index.html last,
# and leaves the newer hashed assets in place (harmless; --exact removes them). It does not delete
# the backup, so it can be repeated.
#
# Options
#   --target DIR   the "installed" directory to update (required, never guessed)
#   --dist DIR     a finished build (the dist/ directory, or an unzipped release asset)
#   --build        run `pnpm install --frozen-lockfile` and `pnpm build` in the repository first
#   --version V    marker written to .uiversion (default: DIST/.uiversion, else the package.json
#                  version plus the git commit when --build)
#   --url URL      base URL the target is served on, for example http://127.0.0.1:9400
#   --keep N       keep the N newest backups made by this script (installed.bak.<UTC stamp>) after a
#                  verified deploy (default 5, 0 = keep all); other installed.bak.* copies are left alone
#   --with-maps    also copy the *.map files (left out by default: 60 MB of source maps)
#   --dry-run      print what would be done, change nothing
set -euo pipefail

usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit "${1:-2}"; }
die() { echo "deploy-ui: $*" >&2; exit 1; }
log() { echo "deploy-ui: $*"; }

target="" dist="" build=0 version="" url="" keep=5 maps=0 dry=0 rollback=0 exact=0 backup=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target) target=${2:?}; shift 2 ;;
    --dist) dist=${2:?}; shift 2 ;;
    --build) build=1; shift ;;
    --version) version=${2:?}; shift 2 ;;
    --url) url=${2:?}; shift 2 ;;
    --keep) keep=${2:?}; shift 2 ;;
    --with-maps) maps=1; shift ;;
    --dry-run) dry=1; shift ;;
    --rollback) rollback=1; shift ;;
    --backup) backup=${2:?}; shift 2 ;;
    --exact) exact=1; shift ;;
    -h|--help) usage 0 ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
done

[ -n "$target" ] || { echo "--target is required" >&2; usage; }
[ -d "$target" ] || die "target $target is not a directory"
target=$(cd "$target" && pwd -P)
case "$keep" in ''|*[!0-9]*) die "--keep expects a number" ;; esac

# Serialise concurrent runs on the same target.
lockfile="${TMPDIR:-/tmp}/deploy-ui-$(printf '%s' "$target" | cksum | cut -d' ' -f1).lock"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$lockfile"
  flock -n 9 || die "another deploy-ui is running on $target"
fi

sha() { sha256sum "$1" | cut -d' ' -f1; }

# Atomic file replacement: copy to a temporary name in the same directory, then mv.
put() { # put SRC DEST
  local src=$1 dest=$2 tmp
  tmp="$dest.new.$$"
  mkdir -p "$(dirname "$dest")"
  cp -p "$src" "$tmp"
  mv -f "$tmp" "$dest"
}

http_code() { curl -s -o /dev/null -m 10 -w '%{http_code}' "$1" || true; }

# Poll the served UI until it matches (the bot may take a moment to see a file, never a restart).
verify_http() { # verify_http EXPECTED_INDEX_SHA EXPECTED_MARKER
  local want_sha=$1 want_marker=$2 body got
  [ -n "$url" ] || return 0
  command -v curl >/dev/null 2>&1 || die "curl is needed for --url"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if [ "$(http_code "$url/")" = 200 ]; then
      got=$(curl -s -m 10 "$url/" | sha256sum | cut -d' ' -f1)
      body=$(curl -s -m 10 "$url/ui_version" || true)
      if [ "$got" = "$want_sha" ] && printf '%s' "$body" | grep -Fq "\"$want_marker\""; then
        log "served: GET / 200, index.html matches, /ui_version = $want_marker"
        return 0
      fi
    fi
    sleep 1
  done
  log "served UI does not match (GET / $(http_code "$url/"), /ui_version: $(curl -s -m 10 "$url/ui_version" || echo unreachable))"
  return 1
}

# Every /assets/... or assets/... file named by index.html must exist under the target.
verify_files() { # verify_files DIR
  local dir=$1 missing=0 ref
  while IFS= read -r ref; do
    ref=${ref#/}
    if [ ! -f "$dir/$ref" ]; then log "missing referenced file: $ref"; missing=1; fi
  done < <(grep -Eo '(src|href)="/?assets/[^"?#]+' "$dir/index.html" | sed 's/^[a-z]*="//' | sort -u)
  return $missing
}

# The backups this script made: installed.bak.<UTC stamp>[.N]. Anything else next to the target
# (a copy made by hand, installed.bak.20260521_084930) is never pruned and never restored by
# --rollback; it is only mentioned.
list_backups() {
  local parent base
  parent=$(dirname "$target"); base=$(basename "$target")
  find "$parent" -maxdepth 1 -type d -name "$base.bak.*" -print0 \
    | while IFS= read -r -d '' d; do
        case "$(basename "$d")" in
          "$base".bak.[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z \
          | "$base".bak.[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z.[0-9]*)
            printf '%s\n' "$d" ;;
        esac
      done | LC_ALL=C sort -V
}

latest_backup() { list_backups | tail -n1; }

note_foreign_backups() {
  local parent base d
  parent=$(dirname "$target"); base=$(basename "$target")
  while IFS= read -r -d '' d; do
    if ! list_backups | grep -Fxq -- "$d"; then log "leaving alone (not made by this script): $d"; fi
  done < <(find "$parent" -maxdepth 1 -type d -name "$base.bak.*" -print0)
}

restore_entry_files() { # restore_entry_files BACKUP : index.html and .uiversion only
  local b=$1 f
  for f in .uiversion index.html; do
    if [ -f "$b/$f" ]; then put "$b/$f" "$target/$f"; fi
  done
}

# ---------------------------------------------------------------- rollback
if [ "$rollback" = 1 ]; then
  [ "$build" = 0 ] || die "--rollback does not take --build"
  b=${backup:-$(latest_backup)}
  [ -n "$b" ] && [ -d "$b" ] || die "no backup found next to $target (expected $target.bak.<YYYYMMDDTHHMMSSZ>, as made by a deploy)"
  [ -f "$b/index.html" ] || die "backup $b has no index.html"
  log "rolling back $target from $b"
  changed=()
  while IFS= read -r -d '' f; do
    rel=${f#"$b"/}
    if [ ! -f "$target/$rel" ] || ! cmp -s "$f" "$target/$rel"; then changed+=("$rel"); fi
  done < <(find "$b" -type f -print0)
  removed=()
  if [ "$exact" = 1 ]; then
    while IFS= read -r -d '' f; do
      rel=${f#"$target"/}
      [ -f "$b/$rel" ] || removed+=("$rel")
    done < <(find "$target" -type f -print0)
  fi
  log "${#changed[@]} file(s) to restore, ${#removed[@]} to remove"
  if [ "$dry" = 1 ]; then
    for rel in ${changed[@]+"${changed[@]}"}; do echo "  restore $rel"; done
    for rel in ${removed[@]+"${removed[@]}"}; do echo "  remove  $rel"; done
    exit 0
  fi
  # Assets and other files first, the entry point last.
  for rel in ${changed[@]+"${changed[@]}"}; do
    case "$rel" in index.html|.uiversion) continue ;; esac
    put "$b/$rel" "$target/$rel"
  done
  restore_entry_files "$b"
  for rel in ${removed[@]+"${removed[@]}"}; do rm -f "$target/$rel"; done
  find "$target" -mindepth 1 -type d -empty -delete 2>/dev/null || true
  marker=$(tr -d '\n' <"$b/.uiversion" 2>/dev/null || true)
  verify_files "$target" || die "rollback left an index.html that references missing files"
  if [ -n "$marker" ]; then
    verify_http "$(sha "$target/index.html")" "$marker" || die "rolled back, but the served UI does not match"
  elif [ -n "$url" ]; then
    [ "$(http_code "$url/")" = 200 ] || die "rolled back, but GET / is not 200"
  fi
  log "rollback done (marker ${marker:-none})"
  exit 0
fi

# ---------------------------------------------------------------- deploy
[ -n "$dist" ] || [ "$build" = 1 ] || { echo "give --dist DIR or --build" >&2; usage; }
repo=$(cd "$(dirname "$0")/../.." && pwd)
if [ "$build" = 1 ]; then
  [ -z "$dist" ] || die "--build and --dist are exclusive"
  [ -f "$repo/package.json" ] || die "--build must be run from a checkout of the repository"
  if [ "$dry" = 1 ]; then
    log "dry run: would build $repo"
  else
    (cd "$repo" && pnpm install --frozen-lockfile && pnpm build)
  fi
  dist=$repo/dist
  if [ -z "$version" ]; then
    pkg=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$repo/package.json" | head -n1)
    commit=$(git -C "$repo" rev-parse --short HEAD 2>/dev/null || echo unknown)
    version="$pkg-$commit"
  fi
fi
if [ "$dry" = 1 ] && [ ! -d "$dist" ]; then
  log "dry run: $dist does not exist yet, nothing more to check"
  exit 0
fi
[ -d "$dist" ] || die "dist $dist is not a directory"
dist=$(cd "$dist" && pwd -P)
[ -f "$dist/index.html" ] || die "dist $dist has no index.html"
[ -d "$dist/assets" ] || die "dist $dist has no assets directory"
[ "$dist" != "$target" ] || die "dist and target are the same directory"
if [ -z "$version" ] && [ -f "$dist/.uiversion" ]; then version=$(tr -d '\n' <"$dist/.uiversion"); fi
[ -n "$version" ] || die "no version: give --version, or a dist with a .uiversion file"
printf '%s' "$version" | grep -Eq '^[A-Za-z0-9._+-]+$' || die "version '$version' has characters other than A-Z a-z 0-9 . _ + -"

new_sha=$(sha "$dist/index.html")
if [ -f "$target/index.html" ] && [ "$(sha "$target/index.html")" = "$new_sha" ] \
  && [ "$(tr -d '\n' <"$target/.uiversion" 2>/dev/null || true)" = "$version" ]; then
  log "already deployed ($version), nothing to do"
  verify_files "$target" || die "deployed index.html references missing files"
  verify_http "$new_sha" "$version" || die "the served UI does not match"
  exit 0
fi

files=()
while IFS= read -r -d '' f; do
  rel=${f#"$dist"/}
  case "$rel" in index.html|.uiversion) continue ;; esac
  if [ "$maps" = 0 ]; then case "$rel" in *.map) continue ;; esac; fi
  files+=("$rel")
done < <(find "$dist" -type f -print0)

stamp=$(date -u +%Y%m%dT%H%M%SZ)
bak="$target.bak.$stamp"
log "target  $target"
log "build   $dist ($version, ${#files[@]} files besides index.html)"
log "backup  $bak"
if [ "$dry" = 1 ]; then
  log "dry run: nothing written"
  exit 0
fi

# Two deploys within one second must not share a backup name (".1" sorts after the bare stamp).
n=0
while [ -e "$bak" ]; do n=$((n + 1)); bak="$target.bak.$stamp.$n"; done
cp -a "$target" "$bak"

previous_marker=$(tr -d '\n' <"$target/.uiversion" 2>/dev/null || true)
fail() {
  log "FAILED: $1"
  log "restoring the previous index.html and .uiversion from $bak"
  restore_entry_files "$bak" || true
  exit 1
}

for rel in "${files[@]}"; do put "$dist/$rel" "$target/$rel"; done
log "assets copied"
put "$dist/index.html" "$target/index.html"
printf '%s' "$version" >"$target/.uiversion.new.$$"
mv -f "$target/.uiversion.new.$$" "$target/.uiversion"

verify_files "$target" || fail "index.html references files that are not in the target"
[ "$(sha "$target/index.html")" = "$new_sha" ] || fail "index.html on disk differs from the build"
verify_http "$new_sha" "$version" || fail "the served UI does not match"

log "deployed $version (previous: ${previous_marker:-none}); rollback: $0 --target $target --rollback"

if [ "$keep" -gt 0 ]; then
  mapfile -t old < <(list_backups | head -n "-$keep")
  for d in ${old[@]+"${old[@]}"}; do log "pruning old backup $d"; rm -rf -- "$d"; done
  note_foreign_backups
fi
