#!/usr/bin/env bash
# Build a portable, blank-data Helm archive for handing to another Mac.
#
# The archive is assembled from git-TRACKED files only (via `git ls-files`),
# which is what guarantees no secrets, tokens, live data, or logs leak: every
# sensitive path lives under .gitignore and is therefore never tracked. On top
# of that we (a) hard-fail if any known-sensitive path somehow became tracked,
# and (b) ship only the runtime and portable-install files a recipient needs.
#
# Output (deterministic for a given tracked tree):
#   dist/Helm-portable.zip
#   dist/Helm-portable.zip.sha256
#
# dist/ is gitignored, so nothing here can loop back into a future archive.
#
# Usage:
#   bash scripts/package-helm.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PREFIX="Helm"                      # top-level folder inside the zip
DIST="$ROOT/dist"
ZIP="$DIST/Helm-portable.zip"
SHA="$ZIP.sha256"

# Sensitive paths that must NEVER enter the archive even if accidentally
# `git add`-ed. Matched against each tracked path; any hit aborts the build.
# Note: a real secret env file (.env, .env.local, .env.production) is caught,
# but a committed template (.env.example) is not.
FORBIDDEN='(^|/)(\.dashboard-token|\.dashboard-password|\.mcp-http-token|\.anthropic-key|\.google-credentials\.json|\.env(\.local|\.production)?)$|(^|/)server/data/|\.log$'

# Portable allowlist. Old deployment files, project docs/tests, and sender-only
# integrations are omitted rather than trying to maintain an exclusion list.
INCLUDE='^(package(-lock)?\.json|install-helm\.sh|HERMES-INSTALL\.md|server/|web/|mcp/|launchd/com\.helm\.app\.plist\.template|launchd/helm-launch\.sh)'
EXCLUDE='^mcp/README\.md$'

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
DEST="$STAGE/$PREFIX"

# Redirect into the loop rather than using `mapfile`, which macOS's stock Bash
# 3.2 does not provide. LC_ALL=C fixes ordering deterministically.
git ls-files | LC_ALL=C sort > "$STAGE/tracked-files"

count=0
while IFS= read -r f; do
  if [[ "$f" =~ $FORBIDDEN ]]; then
    echo "refusing to package sensitive tracked file: $f" >&2
    exit 1
  fi
  [[ "$f" =~ $INCLUDE ]] || continue
  [[ "$f" =~ $EXCLUDE ]] && continue
  mkdir -p "$DEST/$(dirname "$f")"
  cp "$f" "$DEST/$f"
  count=$((count + 1))
done < "$STAGE/tracked-files"

# Pin every entry to a fixed timestamp so the checksum depends only on
# content, not on when the build ran.
find "$DEST" -exec touch -t 200001010000 {} +

mkdir -p "$DIST"
rm -f "$ZIP" "$SHA"

# -X drops uid/gid/extra-attribute fields; feeding a pre-sorted file list on
# stdin fixes member order — together these make the archive reproducible.
( cd "$STAGE" && find "$PREFIX" -type f | LC_ALL=C sort | zip -X -q "$ZIP" -@ )

( cd "$DIST" && shasum -a 256 "$(basename "$ZIP")" > "$(basename "$SHA")" )

echo "packaged $count files -> $ZIP"
echo "checksum -> $SHA"
cat "$SHA"
