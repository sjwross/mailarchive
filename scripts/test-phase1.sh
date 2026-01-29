#!/usr/bin/env bash
# Phase 1 test: API (auth, connections, rules) and worker (run-archive job).
# Prereqs: npm install, Postgres + Redis running, .env set (or use below defaults).
# Usage: from repo root, ./scripts/test-phase1.sh
# Or: API_URL=http://localhost:3000 ./scripts/test-phase1.sh

set -e
API_URL="${API_URL:-http://localhost:3000}"

echo "=== Phase 1 API tests (API_URL=$API_URL) ==="

echo "1. Health..."
curl -s "$API_URL/api/health" | head -1
echo ""

echo "2. Register user..."
REG=$(curl -s -X POST "$API_URL/api/auth/register" -H "Content-Type: application/json" -d '{"email":"test@example.com","password":"testpass123"}')
echo "$REG" | head -c 120
echo ""

TOKEN=$(echo "$REG" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [ -z "$TOKEN" ]; then
  echo "Register failed or already exists; trying login..."
  LOGIN=$(curl -s -X POST "$API_URL/api/auth/login" -H "Content-Type: application/json" -d '{"email":"test@example.com","password":"testpass123"}')
  TOKEN=$(echo "$LOGIN" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
fi
if [ -z "$TOKEN" ]; then
  echo "Failed to get token. Aborting."
  exit 1
fi
echo "Got token."

echo "3. List connections..."
curl -s "$API_URL/api/connections" -H "Authorization: Bearer $TOKEN" | head -c 200
echo ""

echo "4. Create connection..."
curl -s -X POST "$API_URL/api/connections" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"provider":"s3"}' | head -c 200
echo ""

echo "5. List rules..."
curl -s "$API_URL/api/rules" -H "Authorization: Bearer $TOKEN" | head -c 200
echo ""

echo "6. Create rule..."
RULE=$(curl -s -X POST "$API_URL/api/rules" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"Archive old mail","age_threshold_days":365,"safety_mode":"archive_only","schedule":"weekly"}')
echo "$RULE" | head -c 200
echo ""

echo "7. Get rule by id..."
RID=$(echo "$RULE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$RID" ]; then
  curl -s "$API_URL/api/rules/$RID" -H "Authorization: Bearer $TOKEN" | head -c 200
  echo ""
fi

echo "=== Phase 1 API tests done. ==="
echo "Worker test: run 'npm run enqueue-test -w worker' with the worker running in another terminal."
