#!/usr/bin/env bash
# Call the mailarchive API to run scheduled archive rules.
# Used by cron. Requires .env with CRON_SECRET and API running (e.g. on port 3000).

set -e
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env file" >&2
  exit 1
fi

# Load CRON_SECRET (strip quotes if present)
export CRON_SECRET
CRON_SECRET=$(grep -E '^CRON_SECRET=' .env 2>/dev/null | sed 's/^CRON_SECRET=//' | tr -d '"' | tr -d "'" || true)
if [ -z "$CRON_SECRET" ]; then
  echo "CRON_SECRET not set in .env" >&2
  exit 1
fi

API_URL="${MAILARCHIVE_API_URL:-http://localhost:3000}"
curl -s -X POST "${API_URL}/api/jobs/run-scheduled" \
  -H "X-Cron-Secret: $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
