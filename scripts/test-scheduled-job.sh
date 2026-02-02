#!/usr/bin/env bash
# Test the scheduled job endpoint (same as cron). Run from repo root.
# Usage: ./scripts/test-scheduled-job.sh   or   npm run test:scheduled
# Requires: API running (e.g. on port 3000), CRON_SECRET in .env

set -e
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env file" >&2
  exit 1
fi

CRON_SECRET=$(grep -E '^CRON_SECRET=' .env 2>/dev/null | sed 's/^CRON_SECRET=//' | tr -d '"' | tr -d "'" || true)
if [ -z "$CRON_SECRET" ]; then
  echo "CRON_SECRET not set in .env" >&2
  exit 1
fi

API_URL="${MAILARCHIVE_API_URL:-http://localhost:3000}"
echo "=== Test scheduled job ==="
echo "POST $API_URL/api/jobs/run-scheduled"
echo ""
curl -s -m 30 -X POST "${API_URL}/api/jobs/run-scheduled" \
  -H "X-Cron-Secret: $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}' \
  -w "\nHTTP %{http_code}\n" || { echo "curl failed (timeout or connection refused?)"; exit 1; }
echo ""
echo "=== Done ==="
