#!/bin/bash
# Start Helm in the background and write a pidfile.
set -e
cd "$(dirname "$0")"

mkdir -p server/data
chmod 700 . 2>/dev/null || true

PIDFILE="server/data/helm.pid"
LOGFILE="server/data/helm.log"

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
