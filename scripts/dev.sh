#!/usr/bin/env bash
# Start mailarchive in dev: Docker (Postgres + Redis), migrate, then API + worker + web.
# Usage: npm run dev   (from repo root)
# Prerequisites: Docker running, .env with DATABASE_URL and REDIS_URL for localhost.

set -e
cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker is not running. Start Docker Desktop and try again."
  exit 1
fi

echo "Starting Postgres and Redis..."
docker compose up -d

echo "Waiting for Postgres to be ready..."
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U mailarchive 2>/dev/null; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Postgres did not become ready in time."
    exit 1
  fi
  sleep 1
done

echo "Running migrations..."
npm run db:migrate

echo ""
echo "Starting API, worker, and web (Ctrl+C to stop)..."
echo "  API:    http://localhost:3000"
echo "  Web:    http://localhost:5173 (Vite)"
echo ""

exec npx concurrently \
  --names "api,worker,web" \
  "npm run dev:api" \
  "npm run dev:worker" \
  "npm run dev:web"
