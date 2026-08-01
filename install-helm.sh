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
#   ./install-helm.sh [--prefix PATH] [--state-dir PATH] [--port N] [--upgrade]
#                     [--anthropic-key KEY|FILE] [--dry-run]
#                     [--no-launchagent] [--no-hermes]
#
# Flags:
#   --prefix PATH        install location (default: $HOME/Helm, or $HELM_HOME)
#   --state-dir PATH     absolute external state directory (default: $HELM_STATE_DIR,
#                        else legacy in-prefix layout). Database, tokens, password,
#                        and credentials live there, OUTSIDE the replaceable code
#                        prefix. The installer only ever creates this directory and
#                        (with --anthropic-key) writes the key file into it; code
#                        swaps, upgrades, and rollbacks never modify or delete it.
#   --port N             loopback port (default: 8787, or $HELM_PORT)
#   --upgrade            refresh code over an existing install; data/token kept
#   --anthropic-key X    optional API alternative for in-app Chat/coach. X is a
#                        key or a path to a file containing one. Stored chmod-600,
#                        never in the plist. Otherwise local Claude Code auth is used.
#   --dry-run            print the plan and exit; touch nothing (test hook)
#   --no-launchagent     install files but don't load launchd (isolated test)
#   --no-hermes          skip Hermes MCP registration
#
# Test hooks (never for production use): HELM_INSTALL_TEST_SKIP_BUILD=1 skips
# npm ci + frontend build; HELM_INSTALL_TEST_FAIL_AFTER_SWAP=1 fails right
# after the atomic swap to exercise rollback.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"

PREFIX="${HELM_HOME:-$HOME/Helm}"
STATE_DIR="${HELM_STATE_DIR:-}"
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
    --state-dir)      STATE_DIR="$2"; shift 2 ;;
    --port)           PORT="$2"; shift 2 ;;
    --upgrade)        UPGRADE=1; shift ;;
    --anthropic-key)  ANTHROPIC_KEY_INPUT="$2"; shift 2 ;;
    --dry-run)        DRY=1; shift ;;
    --no-launchagent) DO_LAUNCHAGENT=0; shift ;;
    --no-hermes)      DO_HERMES=0; shift ;;
    -h|--help)        sed -n '2,41p' "$0"; exit 0 ;;
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

# ── External state-dir contract validation ─────────────────────────────────
# The install prefix may be relative, so canonicalize it before testing
# separation. External state must be absolute and strictly disjoint from the
# replaceable code prefix; otherwise an atomic code swap could move state.
#
# The separation check itself compares PHYSICAL (symlink-resolved) paths, not
# just textually-resolved ones: a symlinked ancestor in either PREFIX or
# STATE_DIR can make two argument strings that share no textual prefix name
# the same, or an overlapping, physical subtree. physical_path handles a
# not-yet-created leaf (the common case for a fresh prefix or state dir) by
# resolving the deepest existing ancestor and re-appending the missing tail.
physical_path() {
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    function physicalPath(input) {
      const abs = path.resolve(input);
      let existing = abs;
      const tail = [];
      for (;;) {
        try {
          const real = fs.realpathSync(existing);
          process.stdout.write(tail.length ? path.join(real, ...tail.reverse()) : real);
          return;
        } catch (err) {
          if (err.code !== "ENOENT" && err.code !== "ENOTDIR") throw err;
          const parent = path.dirname(existing);
          if (parent === existing) throw err;
          tail.push(path.basename(existing));
          existing = parent;
        }
      }
    }
    physicalPath(process.argv[1]);
  ' "$1"
}
PREFIX="$("$NODE_BIN" -e 'process.stdout.write(require("node:path").resolve(process.argv[1]))' "$PREFIX")"
if [ -n "$STATE_DIR" ]; then
  STATE_DIR="${STATE_DIR%/}"
  case "$STATE_DIR" in
    /*) ;;
    *) echo "--state-dir must be an absolute path, got: $STATE_DIR" >&2; exit 2 ;;
  esac
  case "$STATE_DIR" in
    *$'\n'*) echo "--state-dir must not contain control characters" >&2; exit 2 ;;
  esac
  STATE_DIR="$("$NODE_BIN" -e 'process.stdout.write(require("node:path").resolve(process.argv[1]))' "$STATE_DIR")"
  PREFIX_PHYSICAL="$(physical_path "$PREFIX")"
  STATE_DIR_PHYSICAL="$(physical_path "$STATE_DIR")"
  if [ "$STATE_DIR_PHYSICAL" = "$PREFIX_PHYSICAL" ]; then
    echo "--state-dir must differ from the install prefix" >&2; exit 2
  fi
  case "$STATE_DIR_PHYSICAL/" in
    "$PREFIX_PHYSICAL"/*) echo "--state-dir must be outside the install prefix (the prefix is replaced on upgrade)" >&2; exit 2 ;;
  esac
  case "$PREFIX_PHYSICAL/" in
    "$STATE_DIR_PHYSICAL"/*) echo "the install prefix must be outside --state-dir (external state is never swapped)" >&2; exit 2 ;;
  esac
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
plan "state dir:        $([ -n "$STATE_DIR" ] && echo "$STATE_DIR  (external; created 700 if missing, never modified by code swaps or rollback)" || echo 'none (legacy layout: data + tokens inside the prefix)')"
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

# ── External state dir: create-only, never modify ──────────────────────────
# This is the ONLY write the installer performs under the state dir (plus the
# optional --anthropic-key file below). Existing state files are used as-is.
if [ -n "$STATE_DIR" ]; then
  if [ -e "$STATE_DIR" ] && [ ! -d "$STATE_DIR" ]; then
    echo "state dir exists but is not a directory: $STATE_DIR" >&2
    exit 2
  fi
  if [ -e "$STATE_DIR/data/dashboard.db" ] || [ -e "$STATE_DIR/.dashboard-token" ]; then
    say "existing external state detected in $STATE_DIR; it will be used as-is and never overwritten."
  fi
  mkdir -p "$STATE_DIR/data"
  chmod 700 "$STATE_DIR" "$STATE_DIR/data"
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
KEY_DEST=""
KEY_BACKUP=""
KEY_EXISTED=0
KEY_TOUCHED=0
CORE_INSTALL_COMPLETE=0

cleanup_install() {
  status=$?
  trap - EXIT HUP INT TERM
  rollback_failed=0

  if [ "$status" -ne 0 ] && [ "$CORE_INSTALL_COMPLETE" -ne 1 ]; then
    # Never let a failed replacement keep running while its files are rolled
    # back or removed. bootout is best-effort because a crashed service may
    # already have unloaded itself.
    if [ "$NEW_SERVICE_LOADED" -eq 1 ]; then
      launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
      NEW_SERVICE_LOADED=0
    fi

    if [ "$KEY_TOUCHED" -eq 1 ] && [ -n "$KEY_DEST" ]; then
      if [ "$KEY_EXISTED" -eq 1 ] && [ -f "$KEY_BACKUP" ]; then
        key_restore="$KEY_DEST.rollback.$$"
        if cp -p "$KEY_BACKUP" "$key_restore" && mv "$key_restore" "$KEY_DEST"; then
          :
        else
          rm -f "$key_restore"
          rollback_failed=1
          echo "CRITICAL: Anthropic key rollback failed; backup preserved at: $KEY_BACKUP" >&2
        fi
      elif [ "$KEY_EXISTED" -eq 0 ]; then
        rm -f "$KEY_DEST"
      fi
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

if [ "${HELM_INSTALL_TEST_SKIP_BUILD:-0}" = "1" ]; then
  say "TEST HOOK: skipping npm ci + frontend build (HELM_INSTALL_TEST_SKIP_BUILD)"
else
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
fi

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

if [ "${HELM_INSTALL_TEST_FAIL_AFTER_SWAP:-0}" = "1" ]; then
  echo "TEST HOOK: simulated failure after swap (HELM_INSTALL_TEST_FAIL_AFTER_SWAP)" >&2
  exit 1
fi

# ── Optional Anthropic key (kept out of the plist) ─────────────────────────
# Written to the external state dir when one is configured; only an explicit
# --anthropic-key ever writes here.
KEY_DEST="$PREFIX/.anthropic-key"
[ -n "$STATE_DIR" ] && KEY_DEST="$STATE_DIR/.anthropic-key"
if [ -n "$ANTHROPIC_KEY_INPUT" ]; then
  say "storing Anthropic key (chmod 600)"
  if [ -e "$KEY_DEST" ]; then
    KEY_EXISTED=1
    KEY_BACKUP="$RELEASE_ROOT/previous.anthropic-key"
    cp -p "$KEY_DEST" "$KEY_BACKUP"
  fi
  KEY_TOUCHED=1
  umask 077
  if [ -f "$ANTHROPIC_KEY_INPUT" ]; then
    tr -d '[:space:]' < "$ANTHROPIC_KEY_INPUT" > "$KEY_DEST"
  else
    printf '%s' "$ANTHROPIC_KEY_INPUT" | tr -d '[:space:]' > "$KEY_DEST"
  fi
  chmod 600 "$KEY_DEST"
fi

if [ "${HELM_INSTALL_TEST_FAIL_AFTER_KEY_WRITE:-0}" = "1" ]; then
  echo "TEST HOOK: simulated failure after key write (HELM_INSTALL_TEST_FAIL_AFTER_KEY_WRITE)" >&2
  exit 1
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
      -e "s|{{STATE_DIR}}|$(render "$STATE_DIR")|g" \
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

# From this point onward the standalone Helm installation is complete. A
# Hermes registration failure must return nonzero, but it must not roll back
# the installed files that the recovery instructions reference.
CORE_INSTALL_COMPLETE=1

# ── Hermes MCP registration ────────────────────────────────────────────────
# `hermes mcp add` (live Hermes, v0.18.2) asks interactively whether to
# enable all discovered tools before it persists anything. Under this
# installer's non-interactive stdin that prompt used to hit EOF, cancel
# silently, and leave nothing registered — while this script still reported
# success. HERMES_REGISTER_JS answers that prompt itself, bounds every call
# so a stuck or unfamiliar CLI can never hang the installer, and only calls
# it a success once `hermes mcp test` actually confirms the server responds.
# Nothing token-shaped is ever passed to or read from `hermes` here — Helm's
# MCP adapter resolves its own token from the state dir at connect time.
HERMES_STATUS="disabled"
if [ "$DO_HERMES" -eq 1 ]; then
  if command -v hermes >/dev/null 2>&1; then
    say "registering Helm's MCP server with Hermes"
    # BSD mktemp (the macOS default) only substitutes a trailing XXXXXX run.
    # A template ending in `.mjs` is treated literally, so a killed installer
    # can leave that name behind and make every later install fail. Create a
    # unique directory instead and keep the module extension on the child file.
    HERMES_REGISTER_DIR="$(mktemp -d "${TMPDIR:-/tmp}/helm-hermes-register.XXXXXX")"
    HERMES_REGISTER_JS="$HERMES_REGISTER_DIR/register.mjs"
    cat > "$HERMES_REGISTER_JS" <<'HERMES_JS'
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [, , name, command, cmdArg, ...envAssigns] = process.argv;
const ADD_TIMEOUT_MS = Number(process.env.HELM_HERMES_TIMEOUT_MS || 20000);
const TEST_TIMEOUT_MS = Number(process.env.HELM_HERMES_TIMEOUT_MS || 15000);

function run(args, { input, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn('hermes', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    // A CLI that never reads stdin (or exits before we finish writing) would
    // otherwise crash this script on an unhandled EPIPE.
    child.stdin.on('error', () => {});
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 1, out, err: err + String(e), timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code == null ? 1 : code, out, err, timedOut }); });
    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}

async function snapshotHermesConfig() {
  const result = await run(['config', 'path'], { timeoutMs: TEST_TIMEOUT_MS });
  const configPath = result.out.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (result.code !== 0 || result.timedOut || !configPath || !path.isAbsolute(configPath)) {
    throw new Error('could not resolve the active Hermes config path before registration');
  }
  if (!fs.existsSync(configPath)) return { configPath, existed: false };
  const stat = fs.statSync(configPath);
  return { configPath, existed: true, bytes: fs.readFileSync(configPath), mode: stat.mode & 0o777 };
}

function restoreHermesConfig(snapshot) {
  if (!snapshot.existed) {
    fs.rmSync(snapshot.configPath, { force: true });
    return;
  }
  const temp = path.join(
    path.dirname(snapshot.configPath),
    `.helm-config-restore-${process.pid}-${Date.now()}`,
  );
  try {
    fs.writeFileSync(temp, snapshot.bytes, { mode: snapshot.mode });
    fs.chmodSync(temp, snapshot.mode);
    fs.renameSync(temp, snapshot.configPath);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

async function main() {
  // argparse defines --args as REMAINDER, so it must be last. Putting --env
  // after it would silently turn the environment flag into a server argument.
  // Do not remove an existing registration first: discovery-first `mcp add`
  // only saves after it connects, so a timeout/cancellation leaves the known
  // working config intact.
  let configSnapshot;
  try {
    configSnapshot = await snapshotHermesConfig();
  } catch (error) {
    process.stderr.write(`Hermes registration refused before mutation: ${error.message}\n`);
    process.exit(1);
  }

  const addArgs = ['mcp', 'add', name, '--command', command, '--env', ...envAssigns, '--args', cmdArg];
  // The first 'y' accepts replacement when this name already exists; the
  // second accepts Hermes's "Enable all N tools?" discovery prompt. On a
  // fresh registration there is only one prompt and the extra buffered line
  // is harmless. Hermes handlers may return zero after cancellation, so also
  // require the semantic marker proving the replacement was actually saved.
  const add = await run(addArgs, { input: 'y\ny\n', timeoutMs: ADD_TIMEOUT_MS });
  const addText = `${add.out}\n${add.err}`;
  const saved = addText.includes(`Saved '${name}' to `);
  if (add.code !== 0 || !saved) {
    try {
      restoreHermesConfig(configSnapshot);
    } catch (error) {
      process.stderr.write(`CRITICAL: failed to restore the prior Hermes config: ${error.message}\n`);
    }
    process.stderr.write(`hermes mcp add ${name} failed (exit ${add.code}${add.timedOut ? ', timed out' : ''}):\n${(add.err || add.out).trim()}\n`);
    process.exit(1);
  }

  const test = await run(['mcp', 'test', name], { timeoutMs: TEST_TIMEOUT_MS });
  const testText = `${test.out}\n${test.err}`;
  // Hermes v0.18.2 currently exits zero even when `mcp test` prints
  // "Connection failed". Require its positive semantic markers as well as a
  // zero status so a persisted-but-broken registration cannot be called
  // verified.
  const verified = /✓\s*Connected\b/.test(testText)
    && /✓\s*Tools discovered:\s*[1-9]\d*\b/.test(testText);
  if (test.code !== 0 || !verified) {
    try {
      restoreHermesConfig(configSnapshot);
    } catch (error) {
      process.stderr.write(`CRITICAL: failed to restore the prior Hermes config: ${error.message}\n`);
    }
    process.stderr.write(`registered but \`hermes mcp test ${name}\` failed (exit ${test.code}${test.timedOut ? ', timed out' : ''}):\n${(test.err || test.out).trim()}\n`);
    process.exit(1);
  }

  process.stdout.write(`hermes: ${name} registered and verified (${(test.out || '').trim()})\n`);
}

main();
HERMES_JS
    if "$NODE_BIN" "$HERMES_REGISTER_JS" helm "$NODE_BIN" "$PREFIX/mcp/src/index.js" \
      "DASHBOARD_URL=$DASHBOARD_URL" "HELM_STATE_DIR=$STATE_DIR"; then
      HERMES_STATUS="registered"
    else
      HERMES_STATUS="failed"
      echo "Hermes registration did not complete. Register manually, then verify:" >&2
      printf '    hermes mcp add helm --command %q --env %q %q --args %q\n' \
        "$NODE_BIN" "DASHBOARD_URL=$DASHBOARD_URL" "HELM_STATE_DIR=$STATE_DIR" \
        "$PREFIX/mcp/src/index.js" >&2
      echo "    hermes mcp test helm" >&2
      rm -rf "$HERMES_REGISTER_DIR"
      exit 1
    fi
    rm -rf "$HERMES_REGISTER_DIR"
  else
    say "hermes not found on PATH; skipping MCP registration."
    HERMES_STATUS="no-hermes"
  fi
fi

# ── Summary ────────────────────────────────────────────────────────────────
say "Done."
case "$HERMES_STATUS" in
  registered) echo "    Hermes MCP: registered and verified with hermes mcp test helm." ;;
  failed) echo "    Hermes MCP: registration did not complete; use the manual commands above." ;;
  no-hermes) echo "    Hermes MCP: skipped because hermes was not found on PATH." ;;
  disabled) echo "    Hermes MCP: skipped (--no-hermes)." ;;
esac
TOKEN_FILE="$PREFIX/.dashboard-token"
DATA_LOCATION="$PREFIX/server/data"
if [ -n "$STATE_DIR" ]; then
  TOKEN_FILE="$STATE_DIR/.dashboard-token"
  DATA_LOCATION="$STATE_DIR/data"
fi
if [ -f "$TOKEN_FILE" ]; then
  TOKEN="$(cat "$TOKEN_FILE")"
  if command -v open >/dev/null 2>&1; then
    open "$DASHBOARD_URL/?token=$TOKEN" >/dev/null 2>&1 || true
    echo "    Opened the authenticated Helm page in your browser."
  fi
  echo "    Local URL: $DASHBOARD_URL/"
  echo "    Private token remains in $TOKEN_FILE (not printed)."
fi
echo "    Data lives in $DATA_LOCATION (blank on a fresh install)."
[ -f "$KEY_DEST" ] || echo "    Chat/coach will use this Mac's Claude Code login when available."
