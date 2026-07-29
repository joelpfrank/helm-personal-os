#!/usr/bin/env bash
# Install a private, independent, blank-data Helm on this Mac.
#
# Designed to be driven non-interactively by the Hermes Agent, or run by hand.
# It installs into $HOME/Helm by default, generates its OWN fresh token and
# database on first boot, runs as a loopback-only LaunchAgent, and registers
# its local MCP server with Hermes when `hermes` is present.
#
# Nothing personal from the sender travels in the archive this runs from, and
# nothing here reaches out beyond 127.0.0.1 except `npm ci` fetching packages.
#
# Usage:
#   ./install-helm.sh [--prefix PATH] [--port N] [--upgrade]
#                     [--anthropic-key KEY|FILE] [--dry-run]
#                     [--no-launchagent] [--no-hermes]
#
# Flags:
#   --prefix PATH        install location (default: $HOME/Helm, or $HELM_HOME)
#   --port N             loopback port (default: 8787, or $HELM_PORT)
#   --upgrade            refresh code over an existing install; data/token kept
#   --anthropic-key X    optional API alternative for in-app Chat/coach. X is a
#                        key or a path to a file containing one. Stored chmod-600,
#                        never in the plist. Otherwise local Claude Code auth is used.
#   --dry-run            print the plan and exit; touch nothing (test hook)
#   --no-launchagent     install files but don't load launchd (isolated test)
#   --no-hermes          skip Hermes MCP registration
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"

PREFIX="${HELM_HOME:-$HOME/Helm}"
PORT="${HELM_PORT:-8787}"
LABEL="com.helm.app"
UPGRADE=0
DRY=0
DO_LAUNCHAGENT=1
DO_HERMES=1
ANTHROPIC_KEY_INPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix)         PREFIX="$2"; shift 2 ;;
    --port)           PORT="$2"; shift 2 ;;
    --upgrade)        UPGRADE=1; shift ;;
    --anthropic-key)  ANTHROPIC_KEY_INPUT="$2"; shift 2 ;;
    --dry-run)        DRY=1; shift ;;
    --no-launchagent) DO_LAUNCHAGENT=0; shift ;;
    --no-hermes)      DO_HERMES=0; shift ;;
    -h|--help)        sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "invalid port: $PORT (expected 1-65535)" >&2
  exit 2
fi

TARGET_PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/helm"

say()  { echo "==> $*"; }
plan() { echo "    - $*"; }

# ── Preflight: Node 20+ ────────────────────────────────────────────────────
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ] && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
  NODE_BIN="$(command -v node || true)"
fi
if [ -z "$NODE_BIN" ]; then
  echo "Node.js not found. Install Node 20 or newer, then re-run." >&2
  exit 1
fi
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node 20+ required (found $("$NODE_BIN" -v)). Upgrade Node, then re-run." >&2
  exit 1
fi

# ── Overwrite guard ────────────────────────────────────────────────────────
# An existing install or any real data is sacred: never clobber it without an
# explicit --upgrade. This runs BEFORE any copy/npm/network work.
looks_installed() {
  [ -e "$PREFIX/server/data/dashboard.db" ] || \
  [ -e "$PREFIX/.dashboard-token" ] || \
  [ -e "$PREFIX/package.json" ]
}
if looks_installed && [ "$UPGRADE" -ne 1 ]; then
  echo "Refusing to overwrite existing install/data at: $PREFIX" >&2
  echo "Re-run with --upgrade to refresh code (your data and token are preserved)," >&2
  echo "or choose a different location with --prefix PATH." >&2
  exit 3
fi

DASHBOARD_URL="http://127.0.0.1:$PORT"

# ── Plan ───────────────────────────────────────────────────────────────────
say "Helm install plan"
plan "source archive:   $SRC"
plan "install into:     $PREFIX  (default \$HOME/Helm)"
plan "mode:             $([ "$UPGRADE" -eq 1 ] && echo 'upgrade (keep data + token)' || echo 'fresh (blank data, new token)')"
plan "dependencies:     npm ci"
plan "frontend:         npm run build:web"
plan "service:          $([ "$DO_LAUNCHAGENT" -eq 1 ] && echo "LaunchAgent $LABEL, bound to 127.0.0.1:$PORT" || echo 'skipped (--no-launchagent)')"
plan "health check:     $DASHBOARD_URL/api/health"
plan "Hermes MCP:       $([ "$DO_HERMES" -eq 1 ] && echo 'register when `hermes` is present' || echo 'skipped (--no-hermes)')"
plan "Anthropic key:    $([ -n "$ANTHROPIC_KEY_INPUT" ] && echo 'provided -> chmod-600 file, not in plist' || echo 'none (uses local Claude Code login when available)')"

if [ "$DRY" -eq 1 ]; then
  say "dry-run: no changes made."
  exit 0
fi

# ── Stage dependencies + frontend build before touching the install ─────────
# Native addons (notably better-sqlite3/node-gyp) can split unquoted build
# paths internally. Build in a guaranteed no-space system temp directory so a
# perfectly valid HOME/PREFIX containing spaces or XML characters still works.
# The destination is not changed until npm ci AND the frontend build succeed,
# which also makes failed upgrades non-destructive.
BUILD_ROOT="$(mktemp -d /tmp/helm-install.XXXXXX)"
BUILD_APP="$BUILD_ROOT/Helm"
BUILD_HOME="$BUILD_ROOT/home"
RELEASE_ROOT=""
RELEASE_APP=""
OLD_PREFIX=""
HAD_PREFIX=0
SWAP_COMPLETE=0
SERVICE_WAS_LOADED=0
NEW_SERVICE_LOADED=0
PLIST_EXISTED=0
PLIST_TOUCHED=0
PLIST_BACKUP=""
PLIST_TMP=""

cleanup_install() {
  status=$?
  trap - EXIT HUP INT TERM
  rollback_failed=0

  if [ "$status" -ne 0 ]; then
    # Never let a failed replacement keep running while its files are rolled
    # back or removed. bootout is best-effort because a crashed service may
    # already have unloaded itself.
    if [ "$NEW_SERVICE_LOADED" -eq 1 ]; then
      launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
      NEW_SERVICE_LOADED=0
    fi

    # Restore the old installation. If the rename itself fails, preserve the
    # recovery directory containing the only old data and report its path.
    if [ -n "$OLD_PREFIX" ] && [ -e "$OLD_PREFIX" ]; then
      rm -rf "$PREFIX"
      if mv "$OLD_PREFIX" "$PREFIX"; then
        OLD_PREFIX=""
      else
        rollback_failed=1
        echo "CRITICAL: rollback failed; preserved recovery installation at: $OLD_PREFIX" >&2
      fi
    elif [ "$SWAP_COMPLETE" -eq 1 ] && [ "$HAD_PREFIX" -eq 0 ]; then
      rm -rf "$PREFIX"
    fi

    # Restore the prior LaunchAgent definition atomically, or remove the new
    # one when a failed fresh install had no previous plist.
    if [ "$PLIST_TOUCHED" -eq 1 ]; then
      if [ "$PLIST_EXISTED" -eq 1 ] && [ -f "$PLIST_BACKUP" ]; then
        plist_restore="$TARGET_PLIST.rollback.$$"
        if cp -p "$PLIST_BACKUP" "$plist_restore" && mv "$plist_restore" "$TARGET_PLIST"; then
          :
        else
          rm -f "$plist_restore"
          rollback_failed=1
          echo "CRITICAL: LaunchAgent plist rollback failed; backup preserved at: $PLIST_BACKUP" >&2
        fi
      elif [ "$PLIST_EXISTED" -eq 0 ]; then
        rm -f "$TARGET_PLIST"
      fi
    fi

    # Restart the old service only after its files and plist are back. A failed
    # restart is itself a rollback failure and keeps recovery artifacts.
    if [ "$SERVICE_WAS_LOADED" -eq 1 ] && [ "$rollback_failed" -eq 0 ]; then
      if ! launchctl bootstrap "gui/$UID" "$TARGET_PLIST" >/dev/null 2>&1; then
        rollback_failed=1
        echo "CRITICAL: old Helm service could not be restarted after rollback" >&2
      fi
    fi
  else
    rm -rf "$OLD_PREFIX"
  fi

  rm -f "$PLIST_TMP"
  rm -rf "$BUILD_ROOT"
  if [ "$rollback_failed" -eq 0 ]; then
    rm -rf "$RELEASE_ROOT"
  else
    status=70
    echo "Recovery files were intentionally retained; do not delete them until Helm is restored." >&2
  fi
  exit "$status"
}
trap cleanup_install EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

say "staging source for a verified build"
mkdir -p "$BUILD_APP" "$BUILD_HOME"
rsync -a \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude 'web/dist/' \
  --exclude 'server/data/' \
  --exclude '.dashboard-token' \
  --exclude '.dashboard-password' \
  --exclude '.mcp-http-token' \
  --exclude '.anthropic-key' \
  --exclude '.google-credentials.json' \
  "$SRC/" "$BUILD_APP/"

say "installing dependencies in private staging (npm ci)"
(
  cd "$BUILD_APP"
  HOME="$BUILD_HOME" npm_config_cache="$BUILD_ROOT/npm-cache" npm ci
)

say "building frontend in private staging (npm run build:web)"
(
  cd "$BUILD_APP"
  HOME="$BUILD_HOME" npm_config_cache="$BUILD_ROOT/npm-cache" npm run build:web
)

# ── Prepare a complete sibling release before touching the live prefix ──────
# The release directory is on the target filesystem. Copy/build failures leave
# PREFIX untouched; the final two renames are atomic and cleanup_install rolls
# back the old tree after any later installer failure or signal.
say "preparing atomic release for $PREFIX"
PREFIX_PARENT="$(dirname "$PREFIX")"
mkdir -p "$PREFIX_PARENT"
RELEASE_ROOT="$(mktemp -d "$PREFIX_PARENT/.helm-release.XXXXXX")"
RELEASE_APP="$RELEASE_ROOT/app"
mkdir -p "$RELEASE_APP"
rsync -a "$BUILD_APP/" "$RELEASE_APP/"

if [ "$DO_LAUNCHAGENT" -eq 1 ] && [ -f "$TARGET_PLIST" ]; then
  PLIST_EXISTED=1
  PLIST_BACKUP="$RELEASE_ROOT/previous.plist"
  cp -p "$TARGET_PLIST" "$PLIST_BACKUP"
fi

# Stop the generic service before snapshotting mutable data. Callers using a
# custom service with --no-launchagent must stop it before running --upgrade.
if [ "$DO_LAUNCHAGENT" -eq 1 ] && launchctl print "gui/$UID/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$UID/$LABEL"
  SERVICE_WAS_LOADED=1
fi

if [ -d "$PREFIX/server/data" ]; then
  mkdir -p "$RELEASE_APP/server/data"
  rsync -a "$PREFIX/server/data/" "$RELEASE_APP/server/data/"
fi
for private_file in .dashboard-token .dashboard-password .mcp-http-token .anthropic-key .google-credentials.json; do
  if [ -e "$PREFIX/$private_file" ]; then
    cp -p "$PREFIX/$private_file" "$RELEASE_APP/$private_file"
  fi
done

say "activating verified release -> $PREFIX"
if [ -e "$PREFIX" ]; then
  HAD_PREFIX=1
  OLD_PREFIX="$RELEASE_ROOT/previous"
  mv "$PREFIX" "$OLD_PREFIX"
fi
mv "$RELEASE_APP" "$PREFIX"
SWAP_COMPLETE=1

# ── Optional Anthropic key (kept out of the plist) ─────────────────────────
if [ -n "$ANTHROPIC_KEY_INPUT" ]; then
  say "storing Anthropic key (chmod 600)"
  umask 077
  if [ -f "$ANTHROPIC_KEY_INPUT" ]; then
    tr -d '[:space:]' < "$ANTHROPIC_KEY_INPUT" > "$PREFIX/.anthropic-key"
  else
    printf '%s' "$ANTHROPIC_KEY_INPUT" | tr -d '[:space:]' > "$PREFIX/.anthropic-key"
  fi
  chmod 600 "$PREFIX/.anthropic-key"
fi

# ── LaunchAgent (generic, loopback-bound, no key embedded) ─────────────────
if [ "$DO_LAUNCHAGENT" -eq 1 ]; then
  say "installing LaunchAgent $LABEL (127.0.0.1:$PORT)"
  mkdir -p "$LOG_DIR" "$(dirname "$TARGET_PLIST")"
  xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"; }
  esc() { printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'; }
  render() { esc "$(xml "$1")"; }
  PLIST_TMP="$TARGET_PLIST.new.$$"
  sed -e "s|{{NODE}}|$(render "$NODE_BIN")|g" \
      -e "s|{{HOME}}|$(render "$HOME")|g" \
      -e "s|{{PROJECT}}|$(render "$PREFIX")|g" \
      -e "s|{{LABEL}}|$(render "$LABEL")|g" \
      -e "s|{{PORT}}|$(esc "$PORT")|g" \
      "$PREFIX/launchd/com.helm.app.plist.template" > "$PLIST_TMP"
  mv "$PLIST_TMP" "$TARGET_PLIST"
  PLIST_TMP=""
  PLIST_TOUCHED=1

  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
  sleep 1
  launchctl bootstrap "gui/$UID" "$TARGET_PLIST"
  NEW_SERVICE_LOADED=1
  launchctl enable "gui/$UID/$LABEL"

  # ── Health verification (server generates token + blank DB on boot) ──────
  say "verifying health at $DASHBOARD_URL/api/health"
  ok=0
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null "$DASHBOARD_URL/api/health"; then ok=1; break; fi
    sleep 0.5
  done
  if [ "$ok" -ne 1 ]; then
    echo "Helm did not become healthy. Check $LOG_DIR/helm.err" >&2
    exit 1
  fi
  say "Helm is healthy."
else
  say "skipping LaunchAgent (--no-launchagent); not loading a service."
fi

# ── Hermes MCP registration ────────────────────────────────────────────────
if [ "$DO_HERMES" -eq 1 ] && command -v hermes >/dev/null 2>&1; then
  say "registering Helm's MCP server with Hermes"
  hermes mcp remove helm >/dev/null 2>&1 || true
  hermes mcp add helm --command "$NODE_BIN" \
    --env "DASHBOARD_URL=$DASHBOARD_URL" \
    --args "$PREFIX/mcp/src/index.js" || \
    echo "Hermes registration failed; you can retry: hermes mcp add helm --command node --args $PREFIX/mcp/src/index.js --env DASHBOARD_URL=$DASHBOARD_URL" >&2
elif [ "$DO_HERMES" -eq 1 ]; then
  say "hermes not found on PATH; skipping MCP registration."
fi

# ── Summary ────────────────────────────────────────────────────────────────
say "Done."
if [ -f "$PREFIX/.dashboard-token" ]; then
  TOKEN="$(cat "$PREFIX/.dashboard-token")"
  if command -v open >/dev/null 2>&1; then
    open "$DASHBOARD_URL/?token=$TOKEN" >/dev/null 2>&1 || true
    echo "    Opened the authenticated Helm page in your browser."
  fi
  echo "    Local URL: $DASHBOARD_URL/"
  echo "    Private token remains in $PREFIX/.dashboard-token (not printed)."
fi
echo "    Data lives in $PREFIX/server/data (blank on a fresh install)."
[ -f "$PREFIX/.anthropic-key" ] || echo "    Chat/coach will use this Mac's Claude Code login when available."
