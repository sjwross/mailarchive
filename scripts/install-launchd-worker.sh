#!/usr/bin/env bash
# Install (or reinstall) a macOS LaunchAgent that keeps the mailarchive
# BullMQ worker running in the background.
#
# Usage (from anywhere):
#   ./scripts/install-launchd-worker.sh
#
# Options:
#   --uninstall   Stop and remove the LaunchAgent
#   --no-build    Skip `npm run build -w worker` (use existing dist/)
#
set -euo pipefail

LABEL="com.mailarchive.worker"
PLIST_DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
DOMAIN="gui/$(id -u)"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKER_DIR="$REPO_ROOT/worker"
TEMPLATE="$SCRIPT_DIR/com.mailarchive.worker.plist.template"
ENV_FILE="$REPO_ROOT/.env"

DO_BUILD=1
UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --uninstall) UNINSTALL=1 ;;
    --no-build) DO_BUILD=0 ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "ERROR: node not found on PATH" >&2
  exit 1
fi

unload_agent() {
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    echo "Unloading $LABEL..."
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  fi
}

if [[ "$UNINSTALL" -eq 1 ]]; then
  unload_agent
  rm -f "$PLIST_DEST"
  echo "Removed LaunchAgent $LABEL"
  exit 0
fi

if [[ ! -f "$TEMPLATE" ]]; then
  echo "ERROR: missing template $TEMPLATE" >&2
  exit 1
fi

if [[ "$DO_BUILD" -eq 1 ]]; then
  echo "Building worker..."
  (cd "$REPO_ROOT" && npm run build -w worker)
fi

if [[ ! -f "$WORKER_DIR/dist/index.js" ]]; then
  echo "ERROR: $WORKER_DIR/dist/index.js not found — run without --no-build" >&2
  exit 1
fi

# Stop leftover terminal `npm run dev:worker` / tsx watch so they don't compete.
if PIDS=$(pgrep -f "tsx watch src/index.ts" 2>/dev/null || true); then
  for pid in $PIDS; do
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1 || true)
    if [[ "$cwd" == "$WORKER_DIR" ]]; then
      echo "Stopping leftover worker watcher pid $pid"
      ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
      kill "$pid" 2>/dev/null || true
      if [[ -n "${ppid:-}" && "$ppid" != "1" ]]; then
        pcmd=$(ps -o command= -p "$ppid" 2>/dev/null || true)
        if [[ "$pcmd" == *npm* ]]; then
          kill "$ppid" 2>/dev/null || true
          gppid=$(ps -o ppid= -p "$ppid" 2>/dev/null | tr -d ' ' || true)
          if [[ -n "${gppid:-}" ]]; then
            gpcmd=$(ps -o command= -p "$gppid" 2>/dev/null || true)
            if [[ "$gpcmd" == *dev:worker* ]]; then
              kill "$gppid" 2>/dev/null || true
            fi
          fi
        fi
      fi
    fi
  done
  sleep 1
fi

unload_agent

REDIS_URL="redis://localhost:6379"
if [[ -f "$ENV_FILE" ]]; then
  # Only pull REDIS_URL (avoid sourcing the whole .env).
  line=$(grep -E '^[[:space:]]*REDIS_URL=' "$ENV_FILE" | tail -1 || true)
  if [[ -n "$line" ]]; then
    val="${line#*=}"
    val="${val#\"}"
    val="${val%\"}"
    val="${val#\'}"
    val="${val%\'}"
    if [[ -n "$val" ]]; then
      REDIS_URL="$val"
    fi
  fi
fi

PATH_VALUE="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"
mkdir -p "$HOME/Library/LaunchAgents"

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

NODE_XML="$(xml_escape "$NODE_BIN")"
WORKER_XML="$(xml_escape "$WORKER_DIR")"
PATH_XML="$(xml_escape "$PATH_VALUE")"
REDIS_XML="$(xml_escape "$REDIS_URL")"

sed \
  -e "s|__NODE_BIN__|${NODE_XML}|g" \
  -e "s|__WORKER_DIR__|${WORKER_XML}|g" \
  -e "s|__PATH__|${PATH_XML}|g" \
  -e "s|__REDIS_URL__|${REDIS_XML}|g" \
  "$TEMPLATE" > "$PLIST_DEST"

echo "Wrote $PLIST_DEST"
echo "Loading $LABEL..."
launchctl bootstrap "$DOMAIN" "$PLIST_DEST"

ok=0
for i in $(seq 1 20); do
  if launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -q 'state = running'; then
    if [[ -f /tmp/mailarchive-worker.log ]] && grep -q 'Worker listening for jobs' /tmp/mailarchive-worker.log 2>/dev/null; then
      ok=1
      break
    fi
    # Agent running is enough if log hasn't flushed yet
    sleep 0.5
    if launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -q 'state = running'; then
      # Confirm pid is alive
      wpid=$(launchctl print "$DOMAIN/$LABEL" 2>/dev/null | sed -n 's/^[[:space:]]*pid = \([0-9]*\).*/\1/p' | head -1)
      if [[ -n "$wpid" ]] && kill -0 "$wpid" 2>/dev/null; then
        ok=1
        break
      fi
    fi
  fi
  sleep 0.5
done

if [[ "$ok" -eq 1 ]]; then
  echo "OK — worker LaunchAgent running ($DOMAIN/$LABEL)"
  echo "Logs: /tmp/mailarchive-worker.log  /tmp/mailarchive-worker.err"
  echo "Restart after code changes: npm run build -w worker && launchctl kickstart -k $DOMAIN/$LABEL"
else
  echo "WARN: LaunchAgent may not have started cleanly." >&2
  echo "Check: launchctl print $DOMAIN/$LABEL" >&2
  echo "Logs:  tail /tmp/mailarchive-worker.err /tmp/mailarchive-worker.log" >&2
  exit 1
fi
