#!/usr/bin/env bash
# Run one RADAR inventory pass against the dev stack (one-shot job container).
# Extra args are passed to the job, e.g.: scripts/dev-job.sh --bootstrap
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK="radar-dev"
DB_CONTAINER="radar-dev-db"
PG_USER="radar"
PG_PASSWORD="radar-dev"
PG_DB="radar_db"

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "dev stack is not up — run scripts/dev-up.sh first" >&2
  exit 1
fi

echo "building job image..."
docker build -q -f "$ROOT/docker/job.Dockerfile" -t sunbeam-radar-job:dev "$ROOT" >/dev/null

docker volume create radar-dev-data >/dev/null
docker run --rm \
  --network "$NETWORK" \
  -e STORAGE=postgres \
  -e DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@radar-dev-db:5432/${PG_DB}?sslmode=disable" \
  -e DOMAIN_SUFFIX="${DOMAIN_SUFFIX:-sunbeam.pt}" \
  -e GIT_BASE_URL="${GIT_BASE_URL:-https://github.com/sunbeamdotpt/sbbb.git}" \
  -e GIT_BASE_REF="${GIT_BASE_REF:-mainline}" \
  -e GIT_BASE_REQUIRED="${GIT_BASE_REQUIRED:-false}" \
  -e GITHUB_TOKEN="${GITHUB_TOKEN:-}" \
  -e RADAR_OFFLINE="${RADAR_OFFLINE:-false}" \
  -e RADAR_AUTO_DETECT="${RADAR_AUTO_DETECT:-false}" \
  -e RADAR_JSON_PATH=/app/data/component-versions.json \
  -v radar-dev-data:/app/data \
  sunbeam-radar-job:dev "$@"
