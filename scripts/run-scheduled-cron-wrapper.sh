#!/usr/bin/env bash
# Wrapper for scheduled archive: run this from your HOME or /usr/local so cron can
# execute it (macOS blocks cron from running scripts on external volumes like HubSSD).
#
# Setup:
#   1. Copy this file to your main disk, e.g.:
#        mkdir -p ~/bin
#        cp /Volumes/HubSSD/www/mailarchive/scripts/run-scheduled-cron-wrapper.sh ~/bin/mailarchive-run-scheduled.sh
#        chmod +x ~/bin/mailarchive-run-scheduled.sh
#   2. Create ~/.mailarchive-cron.env with one line (use your real secret from project .env):
#        CRON_SECRET=your-secret-here
#   3. Optional: set API URL if not localhost:3000
#        echo 'MAILARCHIVE_API_URL=http://localhost:3000' >> ~/.mailarchive-cron.env
#   4. Update crontab to call the wrapper instead:
#        crontab -e
#        Replace the path with: 0 3 * * * $HOME/bin/mailarchive-run-scheduled.sh >> /tmp/mailarchive-cron.log 2>&1

set -e
CONFIG="$HOME/.mailarchive-cron.env"
if [ ! -f "$CONFIG" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') ERROR: $CONFIG not found" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$CONFIG"
if [ -z "$CRON_SECRET" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') ERROR: CRON_SECRET not set in $CONFIG" >&2
  exit 1
fi
API_URL="${MAILARCHIVE_API_URL:-http://localhost:3000}"
echo "$(date '+%Y-%m-%d %H:%M:%S') Calling $API_URL/api/jobs/run-scheduled"
# Scheduled archive can take longer than 30s; give curl enough time so
# cron logs don't misleadingly show HTTP 000 timeouts.
curl -sS --connect-timeout 10 -m 600 -X POST "${API_URL}/api/jobs/run-scheduled" \
  -H "X-Cron-Secret: $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}' \
  -w "\nHTTP %{http_code}\n" || echo "curl failed (timeout or connection refused?)"
