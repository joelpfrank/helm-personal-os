#!/usr/bin/env bash
# Export Helm's publication candidate from an explicit source allow-list.
#
# Usage:
#   bash scripts/export-public-source.sh /absolute/path/to/new-destination
#
# HELM_PUBLIC_SOURCE_ROOT may point at an isolated fixture tree for tests.
# The destination must not already exist. All validation happens before the
# staged tree is atomically renamed into place.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 DESTINATION" >&2
  exit 64
fi

SCRIPT_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
SOURCE_ROOT="${HELM_PUBLIC_SOURCE_ROOT:-$SCRIPT_ROOT}"
if [[ ! -d "$SOURCE_ROOT" || -L "$SOURCE_ROOT" ]]; then
  echo "invalid public source root: $SOURCE_ROOT" >&2
  exit 1
fi
SOURCE_ROOT="$(cd "$SOURCE_ROOT" && pwd -P)"

# Optional operator-specific deny-list. Keep one extended regular expression
# per line in a gitignored file and never commit it. The public exporter ships
# only generic privacy checks; private names, places, organizations, and other
# identifying terms belong in this external file instead of public source.
PRIVATE_PATTERNS_FILE="${HELM_PRIVATE_PATTERNS_FILE:-}"
if [[ -z "$PRIVATE_PATTERNS_FILE" && -f "$SOURCE_ROOT/.helm-private-patterns" ]]; then
  PRIVATE_PATTERNS_FILE="$SOURCE_ROOT/.helm-private-patterns"
fi
if [[ -n "$PRIVATE_PATTERNS_FILE" ]]; then
  if [[ ! -f "$PRIVATE_PATTERNS_FILE" || -L "$PRIVATE_PATTERNS_FILE" ]]; then
    echo "operator privacy-pattern file must be a regular non-symlink file" >&2
    exit 1
  fi
fi

DESTINATION="$1"
case "$DESTINATION" in
  /*) ;;
  *) DESTINATION="$(pwd -P)/$DESTINATION" ;;
esac
DEST_PARENT="$(dirname "$DESTINATION")"
DEST_NAME="$(basename "$DESTINATION")"

if [[ -e "$DESTINATION" || -L "$DESTINATION" ]]; then
  echo "destination already exists; refusing to replace it: $DESTINATION" >&2
  exit 1
fi
if [[ ! -d "$DEST_PARENT" || -L "$DEST_PARENT" ]]; then
  echo "destination parent must be an existing real directory: $DEST_PARENT" >&2
  exit 1
fi
DEST_PARENT="$(cd "$DEST_PARENT" && pwd -P)"
DESTINATION="$DEST_PARENT/$DEST_NAME"
case "$DESTINATION/" in
  "$SOURCE_ROOT/"*) echo "destination must be outside the private source tree" >&2; exit 1 ;;
esac

REQUIRED_FILES=(
  package.json
  package-lock.json
  server/package.json
  web/package.json
  mcp/package.json
)
REQUIRED_DIRS=(
  server/src
  web/src
  mcp/src
)
OPTIONAL_FILES=(
  .gitignore
  HERMES-INSTALL.md
  install-helm.sh
  start.sh
  stop.sh
  web/index.html
  web/vite.config.js
  launchd/com.helm.app.plist.template
  launchd/helm-launch.sh
  scripts/package-helm.sh
  scripts/export-public-source.sh
  test/cadence-due.test.mjs
  test/coach-briefing-tasks.test.mjs
  test/coach-longitudinal.test.mjs
  test/daily-rhythm-ui.test.mjs
  test/focus-ui.test.mjs
  test/habit-organization.test.mjs
  test/habit-outcomes.test.mjs
  test/hide-calendar.test.mjs
  test/midday-cadence.test.mjs
  test/module-manage.test.mjs
  test/remove-voice-mode.test.mjs
  test/simplified-chat-tools.test.mjs
  test/simplified-nav.test.mjs
  test/simplified-recall-boundary.test.mjs
  test/task-snapshot.test.mjs
  test/workout-rest-timer-server.test.mjs
  test/workout-rest-timer.test.mjs
  test/public-export.test.mjs
)
OPTIONAL_DIRS=(web/public)

LIST_FILE="$(mktemp "${TMPDIR:-/tmp}/helm-public-files.XXXXXX")"
STAGE=""
cleanup() {
  rm -f "$LIST_FILE"
  if [[ -n "$STAGE" && -d "$STAGE" ]]; then rm -rf "$STAGE"; fi
}
trap cleanup EXIT HUP INT TERM

reject_symlink_components() {
  local relative="$1"
  local current="$SOURCE_ROOT"
  local component
  local old_ifs="$IFS"
  IFS='/'
  set -- $relative
  IFS="$old_ifs"
  for component in "$@"; do
    current="$current/$component"
    if [[ -L "$current" ]]; then
      echo "symlink in allowed public source path: $relative" >&2
      exit 1
    fi
  done
}

require_regular_file() {
  local relative="$1"
  local absolute="$SOURCE_ROOT/$relative"
  reject_symlink_components "$relative"
  if [[ ! -f "$absolute" || -L "$absolute" ]]; then
    echo "missing required source path or non-regular file: $relative" >&2
    exit 1
  fi
  printf '%s\n' "$relative" >> "$LIST_FILE"
}

append_tree() {
  local relative="$1"
  local absolute="$SOURCE_ROOT/$relative"
  local entry entry_relative
  reject_symlink_components "$relative"
  if [[ ! -d "$absolute" || -L "$absolute" ]]; then
    echo "missing required source path or unsafe directory: $relative" >&2
    exit 1
  fi
  while IFS= read -r -d '' entry; do
    entry_relative="${entry#"$SOURCE_ROOT/"}"
    case "$entry_relative" in
      *$'\n'*) echo "newline in public source path is not allowed" >&2; exit 1 ;;
    esac
    if [[ -L "$entry" ]]; then
      echo "symlink in allowed public source root: $entry_relative" >&2
      exit 1
    fi
    if [[ -f "$entry" ]]; then printf '%s\n' "$entry_relative" >> "$LIST_FILE"; fi
  done < <(find "$absolute" \( -type f -o -type l \) -print0)
}

for relative in "${REQUIRED_FILES[@]}"; do require_regular_file "$relative"; done
for relative in "${REQUIRED_DIRS[@]}"; do append_tree "$relative"; done
for relative in "${OPTIONAL_FILES[@]}"; do
  if [[ -e "$SOURCE_ROOT/$relative" || -L "$SOURCE_ROOT/$relative" ]]; then
    require_regular_file "$relative"
  fi
done
for relative in "${OPTIONAL_DIRS[@]}"; do
  if [[ -e "$SOURCE_ROOT/$relative" || -L "$SOURCE_ROOT/$relative" ]]; then
    append_tree "$relative"
  fi
done

LC_ALL=C sort -u "$LIST_FILE" -o "$LIST_FILE"
if [[ ! -s "$LIST_FILE" ]]; then
  echo "public allow-list selected no files" >&2
  exit 1
fi

# These checks apply to every selected file. Forbidden private roots may exist in
# the private repository, but the explicit allow-list never selects them.
FORBIDDEN_PATH='(^|/)(\.git|\.hermes|node_modules|dist|backups?|logs?|vendor|generated|coverage)(/|$)|(^|/)server/data(/|$)|(^|/)deploy[.]sh$|(^|/)launchd/install-backup[.]sh$|(^|/)scripts/backup-db[.]sh$|[.](db|sqlite|sqlite3)(-wal|-shm)?$|[.]log$|(^|/)[.]env([.]|$)|(^|/)([.]dashboard-(token|password)|[.]mcp-http-token|[.]anthropic-key|[.]google-credentials[.]json)$|[.](pem|p12|pfx|key)$'
# Generic checks are safe to publish. Operator-specific terms come only from
# HELM_PRIVATE_PATTERNS_FILE or the ignored .helm-private-patterns file.
PRIVATE_PATH='/Us'""'ers/[A-Za-z0-9._-]+/|/ho'""'me/[A-Za-z0-9._-]+/|/(opt|srv|var|tmp)/pri'""'vate(/|$)'
PRIVATE_IDENTIFIER='(^|[^A-Za-z0-9._-])[A-Za-z0-9]+-[A-Za-z0-9.-]+[.]local([^A-Za-z0-9.-]|$)|(^|[^0-9])[+][1-9][0-9]{9,14}([^0-9]|$)|[A-Za-z0-9._%+-]{8,}@[A-Za-z0-9.-]+[.][A-Za-z]{2,}'
SECRET_CONTENT="-----BEGIN ([A-Z ]+ )?PRIVATE KEY-----|s""k-ant-api03-[A-Za-z0-9_-]{16,}|redac""ted:sk[^A-Za-z0-9]*[A-Za-z0-9]{24,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|(api[_-]?(key|token)|access[_-]?token|auth[_-]?token|client[_-]?secret|password|secret)[[:space:]]*[:=][[:space:]]*[\"'][A-Za-z0-9_./+=:-]{16,}|(^|[^A-Za-z0-9_])(api[_-]?(key|token)|access[_-]?token|auth[_-]?token|client[_-]?secret|password|secret)[[:space:]]*=[[:space:]]*[A-Za-z0-9_+/=-]{16,}([^A-Za-z0-9_+/=-]|$)"

while IFS= read -r relative; do
  absolute="$SOURCE_ROOT/$relative"
  reject_symlink_components "$relative"
  if [[ ! -f "$absolute" || -L "$absolute" ]]; then
    echo "selected source changed during validation: $relative" >&2
    exit 1
  fi
  if printf '%s\n' "$relative" | LC_ALL=C grep -Eiq "$FORBIDDEN_PATH"; then
    echo "forbidden public path selected: $relative" >&2
    exit 1
  fi
  if LC_ALL=C grep -Iq . "$absolute"; then
    if LC_ALL=C grep -Enq -- "$PRIVATE_PATH" "$absolute" ||
       LC_ALL=C grep -Einq -- "$PRIVATE_IDENTIFIER" "$absolute" ||
       { [[ -n "$PRIVATE_PATTERNS_FILE" ]] && LC_ALL=C grep -Enq -f "$PRIVATE_PATTERNS_FILE" -- "$absolute"; }; then
      echo "private content marker in selected file: $relative" >&2
      exit 1
    fi
  fi
  if LC_ALL=C grep -aEinq -- "$SECRET_CONTENT" "$absolute"; then
    echo "secret content marker in selected file: $relative" >&2
    exit 1
  fi
done < "$LIST_FILE"

STAGE="$(mktemp -d "$DEST_PARENT/.helm-public-export.XXXXXX")"
while IFS= read -r relative; do
  absolute="$SOURCE_ROOT/$relative"
  mkdir -p "$STAGE/$(dirname "$relative")"
  cp -p "$absolute" "$STAGE/$relative"
done < "$LIST_FILE"

# Re-check the destination immediately before the atomic same-filesystem rename.
if [[ -e "$DESTINATION" || -L "$DESTINATION" ]]; then
  echo "destination appeared during export; refusing to replace it: $DESTINATION" >&2
  exit 1
fi
mv "$STAGE" "$DESTINATION"
STAGE=""

count="$(wc -l < "$LIST_FILE" | tr -d ' ')"
echo "exported $count allow-listed files -> $DESTINATION"
