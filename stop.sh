#!/bin/bash
cd "$(dirname "$0")"

# State-dir contract: the pidfile lives wherever start.sh put it.
if [ -n "${HELM_STATE_DIR:-}" ]; then
  PIDFILE="$HELM_STATE_DIR/data/helm.pid"
else
  PIDFILE="server/data/helm.pid"
fi
if [ ! -f "$PIDFILE" ]; then
  echo "no pidfile; nothing to stop"
  exit 0
fi

PID=$(cat "$PIDFILE")
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  for i in 1 2 3 4 5; do
    if ! kill -0 "$PID" 2>/dev/null; then break; fi
    sleep 0.2
  done
  if kill -0 "$PID" 2>/dev/null; then
    echo "force-killing pid $PID"
    kill -9 "$PID"
  fi
  echo "stopped pid $PID"
else
  echo "stale pidfile (pid $PID not running)"
fi
rm -f "$PIDFILE"
