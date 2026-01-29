#!/usr/bin/env bash
# Start Postgres and Redis for mailarchive testing.
# Options:
#   1. Docker (if Docker Desktop is running): ./scripts/start-services.sh docker
#   2. Manual: Start your own Postgres/Redis and update .env

set -e

METHOD="${1:-docker}"

if [ "$METHOD" = "docker" ]; then
  echo "Starting services with Docker..."
  
  # Check if Docker is running
  if ! docker info >/dev/null 2>&1; then
    echo "Error: Docker daemon is not running."
    echo "Please start Docker Desktop and try again."
    exit 1
  fi
  
  # Start Postgres
  if ! docker ps --format "{{.Names}}" | grep -q "^mailarchive-postgres$"; then
    echo "Starting Postgres container..."
    docker run -d \
      --name mailarchive-postgres \
      -e POSTGRES_USER=mailarchive \
      -e POSTGRES_PASSWORD=mailarchive \
      -e POSTGRES_DB=mailarchive \
      -p 5432:5432 \
      postgres:16-alpine
    echo "Waiting for Postgres to be ready..."
    sleep 3
  else
    echo "Postgres container already exists, starting it..."
    docker start mailarchive-postgres
  fi
  
  # Start Redis
  if ! docker ps --format "{{.Names}}" | grep -q "^mailarchive-redis$"; then
    echo "Starting Redis container..."
    docker run -d \
      --name mailarchive-redis \
      -p 6379:6379 \
      redis:7-alpine
    echo "Waiting for Redis to be ready..."
    sleep 2
  else
    echo "Redis container already exists, starting it..."
    docker start mailarchive-redis
  fi
  
  echo ""
  echo "Services started!"
  echo "Postgres: postgres://mailarchive:mailarchive@localhost:5432/mailarchive"
  echo "Redis: redis://localhost:6379"
  echo ""
  echo "To stop: docker stop mailarchive-postgres mailarchive-redis"
  echo "To remove: docker rm mailarchive-postgres mailarchive-redis"
  
else
  echo "Manual setup required."
  echo ""
  echo "Please ensure Postgres and Redis are running and update .env with:"
  echo "  DATABASE_URL=postgres://user:password@localhost:5432/mailarchive"
  echo "  REDIS_URL=redis://localhost:6379"
  echo ""
  echo "Then run: npm run db:migrate"
fi
