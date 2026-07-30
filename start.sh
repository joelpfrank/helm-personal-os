#!/bin/bash
# Start Helm in the background and write a pidfile.
set -e
cd "$(dirname "$0")"

chmod 700 . 2>/dev/null || true

# State-dir contract: runtime pid/log follow the database. An empty
# HELM_STATE_DIR means the legacy in-repo layout.
if [ -n "${HELM_STATE_DIR:-}" ]; then
  RUN_DIR="$HELM_STATE_DIR/data"
else
  RUN_DIR="server/data"
fi
mkdir -p "$RUN_DIR"

PIDFILE="$RUN_DIR/helm.pid"
LOGFILE="$RUN_DIR/helm.log"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Helm already running (pid $(cat "$PIDFILE"))"
  exit 0
fi

node server/src/index.js >> "$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"
sleep 0.5
if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Helm started (pid $(cat "$PIDFILE")). logs: $LOGFILE"
else
  echo "Helm failed to start. last log lines:"
  tail -n 20 "$LOGFILE"
  rm -f "$PIDFILE"
  exit 1
fi
