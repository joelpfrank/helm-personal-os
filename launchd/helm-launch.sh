#!/usr/bin/env bash
# LaunchAgent entry point for a portable Helm install.
#
# The Anthropic API key is intentionally kept OUT of the LaunchAgent plist
# (plists are world-readable in ~/Library/LaunchAgents). If the user opted to
# add one, it lives in a chmod-600 .anthropic-key file at the project root and
# is loaded into the process environment here, at launch time only.
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
KEYFILE="$PROJECT/.anthropic-key"

if [ -f "$KEYFILE" ]; then
  ANTHROPIC_API_KEY="$(tr -d '[:space:]' < "$KEYFILE")"
  export ANTHROPIC_API_KEY
  # An explicitly supplied API key opts the in-app chat into the API backend.
  # Without one, Helm keeps the default Claude Code subscription backend.
  export LLM_BACKEND=api
fi

exec "${HELM_NODE_BIN:-node}" "$PROJECT/server/src/index.js"
