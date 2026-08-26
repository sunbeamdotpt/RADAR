#!/usr/bin/env bash
# Bring up the local RADAR dev stack with plain docker (no compose plugin needed):
# a throwaway postgres plus the API server on http://127.0.0.1:8080.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK="radar-dev"
DB_CONTAINER="radar-dev-db"
API_CONTAINER="radar-dev-api"
DB_VOLUME="radar-dev-pgdata"
PG_USER="radar"
PG_PASSWORD="radar-dev"
PG_DB="radar_db"

docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
  docker volume create "$DB_VOLUME" >/dev/null
  docker run -d \
    --name "$DB_CONTAINER" \
    --network "$NETWORK" \
    -e POSTGRES_USER="$PG_USER" \
    -e POSTGRES_PASSWORD="$PG_PASSWORD" \
    -e POSTGRES_DB="$PG_DB" \
    -v "$DB_VOLUME:/var/lib/postgresql" \
    -p 127.0.0.1:5432:5432 \
    postgres:18-alpine >/dev/null
fi

echo "waiting for postgres..."
for _ in $(seq 1 60); do
  if docker exec "$DB_CONTAINER" pg_isready -h 127.0.0.1 -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "building api image..."
docker build -q -f "$ROOT/docker/api.Dockerfile" -t sunbeam-radar-api:dev "$ROOT" >/dev/null

# Always recreate the API container so code changes are reflected immediately.
echo "restarting api container..."
docker rm -f "$API_CONTAINER" >/dev/null 2>&1 || true
docker run -d \
  --name "$API_CONTAINER" \
  --network "$NETWORK" \
  -e STORAGE=postgres \
  -e DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@radar-dev-db:5432/${PG_DB}?sslmode=disable" \
  -e PORT=8080 \
  -p 127.0.0.1:8080:8080 \
  sunbeam-radar-api:dev >/dev/null

echo
echo "stack is up:"
echo "  api:      http://127.0.0.1:8080  (GET /health, /api/v1/inventory)"
echo "  postgres: 127.0.0.1:5432 (user $PG_USER, db $PG_DB)"
echo
echo "next: scripts/dev-job.sh   # run one inventory pass"
