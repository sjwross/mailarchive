#!/usr/bin/env bash
# Install (or uninstall) both mailarchive LaunchAgents: API + worker.
#
#   ./scripts/install-launchd.sh
#   ./scripts/install-launchd.sh --uninstall
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec_both() {
  "$SCRIPT_DIR/install-launchd-api.sh" "$@"
  "$SCRIPT_DIR/install-launchd-worker.sh" "$@"
}

exec_both "$@"
