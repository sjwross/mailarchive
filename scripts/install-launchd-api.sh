#!/usr/bin/env bash
# Install (or reinstall) a macOS LaunchAgent that keeps the mailarchive API
# running on port 3000 so the 3 AM cron job can reach it.
#
# Usage (from anywhere):
#   ./scripts/install-launchd-api.sh
#
# Options:
#   --uninstall   Stop and remove the LaunchAgent
#   --no-build    Skip `npm run build -w api` (use existing dist/)
#
set -euo pipefail

LABEL="com.mailarchive.api"
PLIST_DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
DOMAIN="gui/$(id -u)"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
API_DIR="$REPO_ROOT/api"
TEMPLATE="$SCRIPT_DIR/com.mailarchive.api.plist.template"

DO_BUILD=1
UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --uninstall) UNINSTALL=1 ;;
    --no-build) DO_BUILD=0 ;;
    -h|--help)
      sed -n '2,15p' "$0"
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
  echo "Building API..."
  (cd "$REPO_ROOT" && npm run build -w api)
fi

if [[ ! -f "$API_DIR/dist/index.js" ]]; then
  echo "ERROR: $API_DIR/dist/index.js not found — run without --no-build" >&2
  exit 1
fi

# Free port 3000 so KeepAlive does not fight an old tsx watch / npm run dev.
if PIDS=$(lsof -tiTCP:3000 -sTCP:LISTEN 2>/dev/null); then
  echo "Stopping process(es) on port 3000: $PIDS"
  # shellcheck disable=SC2086
  kill $PIDS 2>/dev/null || true
  sleep 1
  if PIDS=$(lsof -tiTCP:3000 -sTCP:LISTEN 2>/dev/null); then
    echo "Force-killing stubborn listener(s): $PIDS"
    # shellcheck disable=SC2086
    kill -9 $PIDS 2>/dev/null || true
    sleep 1
  fi
fi

PATH_VALUE="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"
mkdir -p "$HOME/Library/LaunchAgents"

# Escape XML special chars in substituted paths (rare, but safe).
xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

NODE_XML="$(xml_escape "$NODE_BIN")"
API_XML="$(xml_escape "$API_DIR")"
PATH_XML="$(xml_escape "$PATH_VALUE")"

sed \
  -e "s|__NODE_BIN__|${NODE_XML}|g" \
  -e "s|__API_DIR__|${API_XML}|g" \
  -e "s|__PATH__|${PATH_XML}|g" \
  "$TEMPLATE" > "$PLIST_DEST"

echo "Wrote $PLIST_DEST"
unload_agent
echo "Loading $LABEL..."
launchctl bootstrap "$DOMAIN" "$PLIST_DEST"

# Wait for health
ok=0
for i in $(seq 1 20); do
  if curl -sf --connect-timeout 1 "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 0.5
done

if [[ "$ok" -eq 1 ]]; then
  echo "OK — API healthy at http://127.0.0.1:3000/api/health"
  echo "Logs: /tmp/mailarchive-api.log  /tmp/mailarchive-api.err"
  echo "Restart after code changes: npm run build -w api && launchctl kickstart -k $DOMAIN/$LABEL"
else
  echo "WARN: LaunchAgent loaded but health check did not pass yet." >&2
  echo "Check: launchctl print $DOMAIN/$LABEL" >&2
  echo "Logs:  tail /tmp/mailarchive-api.err /tmp/mailarchive-api.log" >&2
  exit 1
fi
